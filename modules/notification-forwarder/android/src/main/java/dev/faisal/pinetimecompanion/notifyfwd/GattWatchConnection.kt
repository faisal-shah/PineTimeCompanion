package dev.faisal.pinetimecompanion.notifyfwd

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.ArrayDeque
import java.util.UUID

/**
 * Persistent BLE link to a real watch. Owns an Android [BluetoothGatt] client
 * directly (not react-native-ble-plx) so forwarding keeps working with the RN
 * app swiped away. Writes the ANS New Alert char (0x2A46) with serialized GATT
 * writes, subscribes to the call-event char to log accept/reject/mute, and
 * reconnects with backoff (autoConnect=true) after a drop.
 *
 * Hardware-verified path (the emulator e2e uses [SimTcpWatchConnection]).
 */
@SuppressLint("MissingPermission") // BLUETOOTH_CONNECT guarded via try/catch(SecurityException)
class GattWatchConnection(
  private val context: Context,
  private val device: BluetoothDevice,
  override val deviceId: String,
  private val onState: (String, ConnState) -> Unit,
  private val onCallEvent: (String, Int) -> Unit,
) : WatchConnection {
  private companion object {
    const val TAG = "NotifyFwd/Gatt"
    val ANS_SERVICE: UUID = UUID.fromString("00001811-0000-1000-8000-00805f9b34fb")
    val NEW_ALERT: UUID = UUID.fromString("00002a46-0000-1000-8000-00805f9b34fb")
    val CALL_EVENT: UUID = UUID.fromString("00020001-78fc-48fe-8e23-433b3a1942d0")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    val ENABLE_NOTIFY = byteArrayOf(0x01, 0x00)
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val backoff = Backoff()
  private val queue = ArrayDeque<ByteArray>()
  private val lock = Any()

  @Volatile private var running = false
  @Volatile private var current = ConnState.IDLE
  @Volatile private var inFlight = false
  private var gatt: BluetoothGatt? = null
  private var alertChar: BluetoothGattCharacteristic? = null

  override fun state(): ConnState = current

  private fun setState(s: ConnState) {
    current = s
    onState(deviceId, s)
  }

  override fun start() {
    if (running) return
    running = true
    connect(autoConnect = false)
  }

  override fun stop() {
    running = false
    closeGatt()
    scope.cancel()
  }

  override fun send(payload: ByteArray) {
    synchronized(lock) {
      if (queue.size >= 16) queue.pollFirst() // drop oldest
      queue.addLast(payload)
    }
    pump()
  }

  private fun connect(autoConnect: Boolean) {
    try {
      setState(ConnState.CONNECTING)
      gatt = device.connectGatt(context, autoConnect, callback, BluetoothDevice.TRANSPORT_LE)
    } catch (e: SecurityException) {
      Log.w(TAG, "no BLUETOOTH_CONNECT for $deviceId: ${e.message}")
      setState(ConnState.BACKOFF)
    }
  }

  private fun scheduleReconnect() {
    if (!running) return
    setState(ConnState.BACKOFF)
    scope.launch {
      delay(backoff.nextDelayMs())
      if (running) connect(autoConnect = true) // stack-level resilience after first attempt
    }
  }

  private fun closeGatt() {
    try {
      gatt?.close()
    } catch (_: SecurityException) {
    }
    gatt = null
    alertChar = null
    inFlight = false
  }

  private fun pump() {
    if (current != ConnState.READY || inFlight) return
    val char = alertChar ?: return
    val next = synchronized(lock) { queue.pollFirst() } ?: return
    inFlight = true
    try {
      writeChar(char, next)
    } catch (e: SecurityException) {
      inFlight = false
    }
  }

  @Suppress("DEPRECATION")
  private fun writeChar(char: BluetoothGattCharacteristic, value: ByteArray) {
    val g = gatt ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeCharacteristic(char, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
    } else {
      char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      char.value = value
      g.writeCharacteristic(char)
    }
  }

  @Suppress("DEPRECATION")
  private fun writeCccd(g: BluetoothGatt, desc: BluetoothGattDescriptor) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeDescriptor(desc, ENABLE_NOTIFY)
    } else {
      desc.value = ENABLE_NOTIFY
      g.writeDescriptor(desc)
    }
  }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothGatt.STATE_CONNECTED -> try {
          g.discoverServices()
        } catch (_: SecurityException) {
        }
        BluetoothGatt.STATE_DISCONNECTED -> {
          closeGatt()
          if (running) scheduleReconnect()
        }
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val service = g.getService(ANS_SERVICE)
      alertChar = service?.getCharacteristic(NEW_ALERT)
      if (alertChar == null) {
        Log.w(TAG, "$deviceId has no ANS New Alert char; will retry")
        try { g.disconnect() } catch (_: SecurityException) {}
        return
      }
      // Subscribe to the call-event char (best effort). READY is set here or in
      // onDescriptorWrite once the CCCD lands.
      val eventChar = service.getCharacteristic(CALL_EVENT)
      val cccd = eventChar?.getDescriptor(CCCD)
      if (eventChar != null && cccd != null) {
        try {
          g.setCharacteristicNotification(eventChar, true)
          writeCccd(g, cccd)
        } catch (_: SecurityException) {
          becomeReady()
        }
      } else {
        becomeReady()
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      becomeReady()
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      inFlight = false
      pump()
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (characteristic.uuid == CALL_EVENT) {
        val v = characteristic.value
        if (v != null && v.isNotEmpty()) onCallEvent(deviceId, v[0].toInt() and 0xFF)
      }
    }

    // API 33+ delivers the value as a parameter.
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid == CALL_EVENT && value.isNotEmpty()) onCallEvent(deviceId, value[0].toInt() and 0xFF)
    }
  }

  private fun becomeReady() {
    backoff.reset()
    setState(ConnState.READY)
    pump()
  }
}
