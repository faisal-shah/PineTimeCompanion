package dev.faisal.pinetimecompanion.notifyfwd

enum class ConnState { IDLE, CONNECTING, READY, BACKOFF }

/**
 * A long-lived link to one watch that accepts ANS payloads and reconnects on
 * its own. Two implementations: [GattWatchConnection] (real watch over BLE) and
 * [SimTcpWatchConnection] (InfiniSim over TCP, for emulator tests). Selected by
 * deviceId shape in [ConnectionManager]: "host:port" => sim, a MAC => GATT.
 */
interface WatchConnection {
  val deviceId: String

  /** Begin connecting and keep the link up (reconnect with backoff on drop). */
  fun start()

  /** Tear down for good. */
  fun stop()

  /** Queue an ANS payload; sent when the link is READY, dropped-oldest if the
   *  queue overflows (the watch only holds 5 notifications anyway). */
  fun send(payload: ByteArray)

  fun state(): ConnState
}
