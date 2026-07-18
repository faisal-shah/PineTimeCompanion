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
 * app swiped away. Writes are addressed per [WatchChar] (ANS alerts, music
 * metadata) through one serialized queue; notifications are subscribed on the
 * call-event and music-event chars (chained CCCD writes) and routed by UUID.
 * Reconnects with backoff (autoConnect=true) after a drop. A watch on older
 * firmware without the music service just has those writes dropped silently.
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
  private val onMusicEvent: (String, Int) -> Unit = { _, _ -> },
) : WatchConnection {
  private companion object {
    const val TAG = "NotifyFwd/Gatt"
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    val ENABLE_NOTIFY = byteArrayOf(0x01, 0x00)
    const val QUEUE_DEPTH = 32 // a music snapshot is ~7 writes; must not evict alerts
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val backoff = Backoff()
  private val queue = ArrayDeque<Pair<WatchChar, ByteArray>>()
  private val lock = Any()

  @Volatile private var running = false
  @Volatile private var current = ConnState.IDLE
  @Volatile private var inFlight = false
  private var gatt: BluetoothGatt? = null
  private var chars = HashMap<WatchChar, BluetoothGattCharacteristic>()
  private val pendingSubscribes = ArrayDeque<WatchChar>()

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

  override fun send(char: WatchChar, payload: ByteArray) {
    synchronized(lock) {
      if (queue.size >= QUEUE_DEPTH) queue.pollFirst() // drop oldest
      queue.addLast(char to payload)
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
    chars = HashMap()
    pendingSubscribes.clear()
    inFlight = false
  }

  private fun pump() {
    if (current != ConnState.READY || inFlight) return
    val next = synchronized(lock) {
      // Skip chars this watch doesn't have (older firmware without music).
      while (true) {
        val head = queue.peekFirst() ?: break
        if (chars[head.first] != null) break
        queue.pollFirst()
      }
      queue.pollFirst()
    } ?: return
    val char = chars[next.first] ?: return
    inFlight = true
    try {
      writeChar(char, next.second)
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

  /** Subscribe the next pending notify char; returns false when none left. */
  private fun subscribeNext(g: BluetoothGatt): Boolean {
    while (true) {
      val wc = pendingSubscribes.pollFirst() ?: break
      val char = chars[wc] ?: continue
      val cccd = char.getDescriptor(CCCD) ?: continue
      try {
        g.setCharacteristicNotification(char, true)
        writeCccd(g, cccd)
        return true
      } catch (_: SecurityException) {
        // fall through to the next candidate
      }
    }
    return false
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
      val map = HashMap<WatchChar, BluetoothGattCharacteristic>()
      val ans = g.getService(WatchChar.ANS_SERVICE)
      val music = g.getService(WatchChar.MUSIC_SERVICE)
      for (wc in WatchChar.entries) {
        val service = when {
          ans?.getCharacteristic(wc.gattUuid) != null -> ans
          music?.getCharacteristic(wc.gattUuid) != null -> music
          else -> null
        }
        service?.getCharacteristic(wc.gattUuid)?.let { map[wc] = it }
      }
      chars = map
      if (map[WatchChar.NEW_ALERT] == null) {
        Log.w(TAG, "$deviceId has no ANS New Alert char; will retry")
        try { g.disconnect() } catch (_: SecurityException) {}
        return
      }
      if (music == null) {
        Log.i(TAG, "$deviceId has no music service (older firmware); music writes will be dropped")
      }
      // Chain the CCCD subscribes (call event, then music event); READY once the
      // last one lands (or none are available).
      pendingSubscribes.clear()
      pendingSubscribes.add(WatchChar.CALL_EVENT)
      pendingSubscribes.add(WatchChar.MUSIC_EVENT)
      if (!subscribeNext(g)) {
        becomeReady()
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (!subscribeNext(g)) {
        becomeReady()
      }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      inFlight = false
      pump()
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      val v = characteristic.value
      if (v != null && v.isNotEmpty()) routeNotify(characteristic.uuid, v[0].toInt() and 0xFF)
    }

    // API 33+ delivers the value as a parameter.
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (value.isNotEmpty()) routeNotify(characteristic.uuid, value[0].toInt() and 0xFF)
    }
  }

  private fun routeNotify(uuid: UUID, byte: Int) {
    when (uuid) {
      WatchChar.CALL_EVENT.gattUuid -> onCallEvent(deviceId, byte)
      WatchChar.MUSIC_EVENT.gattUuid -> onMusicEvent(deviceId, byte)
    }
  }

  private fun becomeReady() {
    backoff.reset()
    setState(ConnState.READY)
    pump()
  }
}
