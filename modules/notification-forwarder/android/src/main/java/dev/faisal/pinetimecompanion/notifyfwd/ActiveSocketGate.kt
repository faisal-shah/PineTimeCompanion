package dev.faisal.pinetimecompanion.notifyfwd

import java.io.Closeable

/**
 * Retains the socket a connection loop is currently using so [stop] can close
 * it synchronously.
 *
 * Coroutine cancellation cannot interrupt a thread parked in a blocking socket
 * read, so the only way to make a paused sim link actually release is to close
 * its socket out from under the read — which requires holding a reference to
 * that socket outside the loop. This gate is that reference. It also latches
 * "stopped": once stopped, no new socket may be published, so the loop cannot
 * reconnect after [stop] and hand back a usable link.
 *
 * Pure JVM ([Closeable] only, no Android), so the close-on-stop and
 * no-reconnect-after-stop rules are unit-testable without a live simulator.
 */
class ActiveSocketGate {
  private val lock = Any()
  private var current: Closeable? = null
  private var stopped = false

  /** True once [stop] has run; the loop must not open a new socket. */
  val isStopped: Boolean
    get() = synchronized(lock) { stopped }

  /**
   * Publish the socket the loop just created so [stop] can reach it. Returns
   * false (and retains nothing) if already stopped — the caller must close the
   * socket it passed in and abort the loop. A prior socket, if any, is replaced.
   */
  fun publish(socket: Closeable): Boolean = synchronized(lock) {
    if (stopped) {
      false
    } else {
      current = socket
      true
    }
  }

  /** Drop the retained socket if it is still [socket] (end of a loop iteration). */
  fun clear(socket: Closeable) {
    synchronized(lock) {
      if (current === socket) current = null
    }
  }

  /**
   * Latch stopped and close the retained socket synchronously. Idempotent, and
   * safe to call from a different thread than the loop: the close is what
   * unblocks a read parked in [serve]. Never throws — a socket that is already
   * dead is fine.
   */
  fun stop() {
    val toClose: Closeable?
    synchronized(lock) {
      stopped = true
      toClose = current
      current = null
    }
    toClose?.let { runCatching { it.close() } }
  }
}
