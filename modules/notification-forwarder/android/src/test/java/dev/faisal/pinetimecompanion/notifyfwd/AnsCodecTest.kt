package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnsCodecTest {
  // Unsigned byte list, so goldens read like the wire bytes.
  private fun ByteArray.u() = map { it.toInt() and 0xFF }

  @Test
  fun `notification matches the TS encodeMessageAlert layout (header + title NUL body)`() {
    // [0xFA,0x01,0xFF] + "Mom" + 0x00 + "Call me"
    val out = AnsCodec.encodeNotification("Mom", "Call me").u()
    val expected = listOf(0xFA, 0x01, 0xFF) +
      "Mom".toByteArray().u() + listOf(0x00) + "Call me".toByteArray().u()
    assertEquals(expected, out)
  }

  @Test
  fun `incoming call uses category 0x03 and the caller as the whole payload`() {
    val out = AnsCodec.encodeIncomingCall("Alice")
    assertEquals(0x03, out[0].toInt() and 0xFF)
    assertEquals(0x01, out[1].toInt() and 0xFF)
    assertEquals(0xFF, out[2].toInt() and 0xFF)
    assertArrayEquals("Alice".toByteArray(), out.copyOfRange(3, out.size))
  }

  @Test
  fun `payload text is capped at 97 bytes`() {
    val out = AnsCodec.encodeIncomingCall("x".repeat(200))
    assertEquals(3 + 97, out.size)
  }

  @Test
  fun `truncation never splits a multibyte UTF-8 char`() {
    // "é" is 2 bytes (0xC3 0xA9). 50 of them = 100 bytes; cap 97 would land
    // mid-char, so it must drop back to 96 bytes (48 whole chars).
    val bytes = AnsCodec.truncateUtf8("é".repeat(50), 97)
    assertEquals(96, bytes.size)
    // Valid UTF-8 (decodes back cleanly, no replacement char).
    assertTrue(String(bytes, Charsets.UTF_8).all { it == 'é' })
  }
}
