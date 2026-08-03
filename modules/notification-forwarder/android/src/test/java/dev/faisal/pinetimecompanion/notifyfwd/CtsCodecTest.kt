package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.util.Calendar

class CtsCodecTest {
  private fun at(year: Int, month1: Int, day: Int, hour: Int, minute: Int, second: Int): Long {
    val c = Calendar.getInstance()
    c.set(year, month1 - 1, day, hour, minute, second)
    c.set(Calendar.MILLISECOND, 0)
    return c.timeInMillis
  }

  @Test
  fun `encodes the standard 10-byte CTS payload`() {
    // Sunday 2 August 2026, 18:45:21 — the case that exposed this.
    val b = CtsCodec.encode(at(2026, 8, 2, 18, 45, 21))
    assertEquals(10, b.size)
    assertEquals(2026, (b[0].toInt() and 0xff) or ((b[1].toInt() and 0xff) shl 8))
    assertEquals(8, b[2].toInt())
    assertEquals(2, b[3].toInt())
    assertEquals(18, b[4].toInt())
    assertEquals(45, b[5].toInt())
    assertEquals(21, b[6].toInt())
    assertEquals("CTS day-of-week is Monday=1..Sunday=7", 7, b[7].toInt())
    assertEquals(0, b[9].toInt())
  }

  @Test
  fun `monday encodes as 1, not as the Calendar value`() {
    // Calendar.MONDAY is 2; getting this wrong shifts the watch's weekday name.
    val b = CtsCodec.encode(at(2026, 8, 3, 12, 0, 0)) // Monday
    assertEquals(1, b[7].toInt())
  }

  @Test
  fun `the date travels, not just the time of day`() {
    // The failure this exists to stop: a watch showing the correct time on
    // 1 January because its clock was never set.
    val jan = CtsCodec.encode(at(2026, 1, 1, 18, 45, 0))
    val aug = CtsCodec.encode(at(2026, 8, 2, 18, 45, 0))
    assertEquals(jan[4], aug[4])
    assertEquals(jan[5], aug[5])
    assertNotEquals(jan[2], aug[2])
    assertNotEquals(jan[3], aug[3])
  }
}
