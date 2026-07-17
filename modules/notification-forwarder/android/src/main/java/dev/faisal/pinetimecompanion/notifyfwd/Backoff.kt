package dev.faisal.pinetimecompanion.notifyfwd

import kotlin.random.Random

/**
 * Exponential reconnect backoff with jitter: 5s, 10s, 20s, ... capped at 10min.
 * Reset on a successful connect (or on screen-on / Bluetooth-adapter-on, which
 * the ConnectionManager treats as a hint that a retry is worth it now).
 */
class Backoff(
  private val baseMs: Long = 5_000,
  private val capMs: Long = 10 * 60_000,
  private val random: Random = Random.Default,
) {
  private var attempt = 0

  /** Next delay in ms, then advances the attempt counter. */
  fun nextDelayMs(): Long {
    val exp = baseMs shl attempt.coerceAtMost(20) // avoid overflow
    val capped = exp.coerceAtMost(capMs).coerceAtLeast(baseMs)
    attempt++
    // Full jitter in [capped/2, capped] so retries don't synchronize.
    val half = capped / 2
    return half + random.nextLong(half + 1)
  }

  fun reset() {
    attempt = 0
  }
}
