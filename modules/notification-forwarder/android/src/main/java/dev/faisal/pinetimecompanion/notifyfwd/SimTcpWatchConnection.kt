package dev.faisal.pinetimecompanion.notifyfwd

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Connects to the InfiniSim TCP GATT bridge and writes watch characteristics
 * (ANS alerts, music metadata) using [SimBridgeFraming]. This is the transport
 * the emulator e2e exercises, so the whole native pipeline (listener/media ->
 * connection) is verifiable headlessly against a live simulator. Inbound notify
 * frames are routed by bridge charId: call events -> [onCallEvent], music
 * events -> [onMusicEvent].
 */
class SimTcpWatchConnection(
  override val deviceId: String, // "host:port"
  private val host: String,
  private val port: Int,
  private val onState: (String, ConnState) -> Unit,
  private val onCallEvent: (String, Int) -> Unit,
  private val onMusicEvent: (String, Int) -> Unit = { _, _ -> },
) : WatchConnection {
  private companion object {
    const val TAG = "NotifyFwd/SimTcp"
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val queue = Channel<Pair<WatchChar, ByteArray>>(capacity = 32, onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST)
  private val backoff = Backoff()
  @Volatile private var running = false
  @Volatile private var current: ConnState = ConnState.IDLE

  override fun state(): ConnState = current

  private fun setState(s: ConnState) {
    current = s
    onState(deviceId, s)
  }

  override fun start() {
    if (running) return
    running = true
    scope.launch { runLoop() }
  }

  override fun stop() {
    running = false
    scope.cancel()
  }

  override fun send(char: WatchChar, payload: ByteArray) {
    queue.trySend(char to payload)
  }

  private suspend fun runLoop() {
    while (running && scope.isActive) {
      try {
        setState(ConnState.CONNECTING)
        Socket().use { socket ->
          socket.connect(InetSocketAddress(host, port), 8000)
          backoff.reset()
          setState(ConnState.READY)
          Log.i(TAG, "connected to sim $deviceId")
          serve(socket)
        }
      } catch (e: Exception) {
        Log.w(TAG, "sim link to $deviceId dropped: ${e.message}")
      }
      if (!running) break
      setState(ConnState.BACKOFF)
      delay(backoff.nextDelayMs())
    }
    setState(ConnState.IDLE)
  }

  private suspend fun serve(socket: Socket) {
    val input = socket.getInputStream()
    val output = socket.getOutputStream()
    val parser = SimBridgeFraming.Parser()

    // Writer: forward queued alerts (op 0 = write with response; the read loop
    // below consumes the ack frame). A dead socket makes output.write throw,
    // which ends this coroutine.
    val writer: Job = scope.launch {
      try {
        for ((char, payload) in queue) {
          if (!running) break
          output.write(SimBridgeFraming.encodeRequest(char.simCharId, SimBridgeFraming.OP_WRITE, payload))
          output.flush()
          Log.d(TAG, "wrote ${payload.size}B to ${char.name} on $deviceId")
        }
      } catch (_: Exception) {
        // socket died mid-write; the read loop will also unblock and reconnect.
      }
    }

    try {
      // Primary loop: blocking reads. Returns on EOF/error, which is how we
      // detect the sim went away (even with an idle write queue) and reconnect.
      val buf = ByteArray(512)
      while (running && scope.isActive) {
        val n = input.read(buf)
        if (n < 0) break
        for (frame in parser.feed(buf.copyOfRange(0, n))) {
          if (frame is SimBridgeFraming.Frame.Notify && frame.payload.isNotEmpty()) {
            when (frame.charId) {
              WatchChar.CALL_EVENT.simCharId -> onCallEvent(deviceId, frame.payload[0].toInt() and 0xFF)
              WatchChar.MUSIC_EVENT.simCharId -> onMusicEvent(deviceId, frame.payload[0].toInt() and 0xFF)
              else -> Log.d(TAG, "unhandled notify charId ${frame.charId}")
            }
          }
        }
      }
    } finally {
      writer.cancelAndJoin()
    }
  }
}
