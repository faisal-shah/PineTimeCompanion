package dev.faisal.pinetimecompanion.notifyfwd

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-wide owner of the watch connections. The listener service calls
 * [broadcast] for every forwardable notification; [applyConfig] diffs the
 * desired watch set against the live connections and starts/stops them. A
 * "host:port" deviceId gets a [SimTcpWatchConnection] (emulator tests), a MAC a
 * [GattWatchConnection]. Reconnect backoffs are kicked when the screen turns on
 * or Bluetooth is re-enabled.
 */
object ConnectionManager {
  private const val TAG = "NotifyFwd/ConnMgr"

  private val connections = ConcurrentHashMap<String, WatchConnection>()
  private val paused = ConcurrentHashMap.newKeySet<String>()
  @Volatile private var appContext: Context? = null
  @Volatile private var lastConfig = ForwarderConfig()
  @Volatile private var receiverRegistered = false

  /** Optional sinks so the module can emit JS events when the runtime is alive. */
  @Volatile var onConnectionState: ((String, ConnState) -> Unit)? = null
  @Volatile var onCallEvent: ((String, Int) -> Unit)? = null

  fun init(context: Context) {
    if (appContext == null) appContext = context.applicationContext
    registerReceiver()
  }

  @Synchronized
  fun applyConfig(config: ForwarderConfig) {
    lastConfig = config
    val desired = config.enabledWatches.associateBy { it.deviceId }
    // Stop connections no longer wanted.
    for (id in connections.keys.toList()) {
      if (id !in desired) connections.remove(id)?.stop()
    }
    // Start newly wanted (unless paused for a JS-driven op).
    for ((id, watch) in desired) {
      if (id in paused) continue
      if (connections[id] == null) {
        val conn = createConnection(id)
        connections[id] = conn
        conn.start()
      }
    }
    Log.i(TAG, "applyConfig: ${config.enabledWatches.size} desired, ${connections.size} live connection(s)")
  }

  fun broadcast(payload: ByteArray) {
    for (conn in connections.values) conn.send(payload)
  }

  fun hasEnabledWatches(): Boolean = lastConfig.enabledWatches.isNotEmpty()

  /** Pause a watch's forwarding link so JS-driven BLE ops (sync, DFU) get
   *  exclusive access; resume re-establishes it from the last config. */
  @Synchronized
  fun pause(deviceId: String) {
    paused.add(deviceId)
    connections.remove(deviceId)?.stop()
  }

  @Synchronized
  fun resume(deviceId: String) {
    paused.remove(deviceId)
    applyConfig(lastConfig)
  }

  fun status(): List<Pair<String, ConnState>> =
    connections.map { it.key to it.value.state() }

  private fun createConnection(deviceId: String): WatchConnection {
    val ctx = appContext!!
    val dispatchState: (String, ConnState) -> Unit = { id, s -> onConnectionState?.invoke(id, s) }
    val dispatchCall: (String, Int) -> Unit = { id, e ->
      Log.i(TAG, "call event from $id: $e")
      onCallEvent?.invoke(id, e)
    }
    val parts = deviceId.split(":")
    return if (parts.size == 2) {
      SimTcpWatchConnection(deviceId, parts[0], parts[1].toInt(), dispatchState, dispatchCall)
    } else {
      val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
      val device = adapter.getRemoteDevice(deviceId)
      GattWatchConnection(ctx, device, deviceId, dispatchState, dispatchCall)
    }
  }

  @Synchronized
  private fun kickReconnects() {
    for ((id, conn) in connections.toMap()) {
      if (conn.state() == ConnState.BACKOFF) {
        conn.stop()
        val fresh = createConnection(id)
        connections[id] = fresh
        fresh.start()
      }
    }
  }

  private fun registerReceiver() {
    if (receiverRegistered) return
    val ctx = appContext ?: return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
    }
    ctx.registerReceiver(object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
          val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)
          if (state != BluetoothAdapter.STATE_ON) return
        }
        kickReconnects()
      }
    }, filter)
    receiverRegistered = true
  }
}
