package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PauseCounterTest {
  @Test
  fun `first acquire pauses, nested acquire does not`() {
    val c = PauseCounter()
    assertTrue("0 -> 1 should pause", c.acquire("AA:BB"))
    assertFalse("1 -> 2 must not pause again", c.acquire("AA:BB"))
    assertFalse("2 -> 3 must not pause again", c.acquire("AA:BB"))
    assertEquals(3, c.depth("AA:BB"))
    assertTrue(c.isPaused("AA:BB"))
  }

  @Test
  fun `only the last release resumes`() {
    val c = PauseCounter()
    c.acquire("AA:BB"); c.acquire("AA:BB"); c.acquire("AA:BB") // depth 3
    assertFalse("3 -> 2 must not resume", c.release("AA:BB"))
    assertFalse("2 -> 1 must not resume", c.release("AA:BB"))
    assertTrue("1 -> 0 resumes", c.release("AA:BB"))
    assertFalse(c.isPaused("AA:BB"))
    assertEquals(0, c.depth("AA:BB"))
  }

  @Test
  fun `an extra release does not underflow or resume`() {
    val c = PauseCounter()
    c.acquire("AA:BB")
    assertTrue(c.release("AA:BB")) // back to 0
    // Extra release with no matching acquire: ignored, no resume, no negative.
    assertFalse(c.release("AA:BB"))
    assertEquals(0, c.depth("AA:BB"))
    assertFalse(c.isPaused("AA:BB"))
  }

  @Test
  fun `release before any acquire is a no-op`() {
    val c = PauseCounter()
    assertFalse(c.release("never-paused"))
    assertEquals(0, c.depth("never-paused"))
    assertTrue(c.pausedDevices().isEmpty())
  }

  @Test
  fun `counts are independent per device`() {
    val c = PauseCounter()
    assertTrue(c.acquire("A"))
    assertFalse(c.acquire("A"))
    assertTrue(c.acquire("B")) // B's first acquire still pauses B
    assertEquals(2, c.depth("A"))
    assertEquals(1, c.depth("B"))
    assertEquals(setOf("A", "B"), c.pausedDevices())
    assertEquals(mapOf("A" to 2, "B" to 1), c.pausedDepths())

    assertFalse(c.release("A")) // A: 2 -> 1
    assertTrue(c.release("B"))  // B: 1 -> 0 resumes
    assertEquals(setOf("A"), c.pausedDevices())
  }

  @Test
  fun `a resumed device drops out of the paused set`() {
    val c = PauseCounter()
    c.acquire("A")
    assertTrue(c.pausedDevices().contains("A"))
    c.release("A")
    assertFalse(c.pausedDevices().contains("A"))
    assertTrue(c.pausedDepths().isEmpty())
  }
}
