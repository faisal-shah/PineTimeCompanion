package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class BackoffTest {
  // Deterministic "no jitter" random: always returns 0 so delay == capped/2.
  private fun noJitter() = object : Random() {
    override fun nextBits(bitCount: Int) = 0
    override fun nextLong(until: Long) = 0L
  }

  @Test
  fun `delays grow exponentially then clamp at the cap`() {
    val b = Backoff(baseMs = 5_000, capMs = 600_000, random = noJitter())
    // capped/2 with no jitter: 2500, 5000, 10000, ... clamps at 300000.
    val seq = (0 until 10).map { b.nextDelayMs() }
    assertEquals(2_500, seq[0])
    assertEquals(5_000, seq[1])
    assertEquals(10_000, seq[2])
    assertEquals(300_000, seq.last()) // 600000/2 cap
    assertTrue(seq.zipWithNext().all { (a, c) -> c >= a }) // monotonic non-decreasing
  }

  @Test
  fun `reset restarts the sequence`() {
    val b = Backoff(baseMs = 5_000, random = noJitter())
    b.nextDelayMs(); b.nextDelayMs(); b.nextDelayMs()
    b.reset()
    assertEquals(2_500, b.nextDelayMs())
  }

  @Test
  fun `jitter keeps the delay between half-cap and cap`() {
    val b = Backoff(baseMs = 5_000, capMs = 600_000)
    repeat(50) {
      val d = b.nextDelayMs()
      assertTrue(d in 2_500..600_000)
    }
  }
}
