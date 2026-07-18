package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicCodecTest {
  @Test
  fun `short strings pass through as raw UTF-8`() {
    assertArrayEquals("Daft Punk".toByteArray(), MusicCodec.encodeString("Daft Punk"))
  }

  @Test
  fun `exactly 40 bytes is not truncated`() {
    val s = "x".repeat(40)
    assertArrayEquals(s.toByteArray(), MusicCodec.encodeString(s))
  }

  @Test
  fun `over 40 bytes truncates to 37 + ellipsis`() {
    val out = MusicCodec.encodeString("y".repeat(50))
    assertEquals(40, out.size)
    assertEquals("y".repeat(37) + "...", String(out, Charsets.UTF_8))
  }

  @Test
  fun `truncation never splits a multibyte codepoint`() {
    // "é" = 2 bytes; 30 of them = 60 bytes. Cut at 37 would split char #19.
    val out = MusicCodec.encodeString("é".repeat(30))
    assertTrue(out.size <= 40)
    val decoded = String(out, Charsets.UTF_8)
    assertTrue(decoded.endsWith("..."))
    assertTrue(decoded.dropLast(3).all { it == 'é' })
  }

  @Test
  fun `u32 big-endian layout including bytes over 0x7F`() {
    assertArrayEquals(byteArrayOf(0, 0, 0, 240.toByte()), MusicCodec.encodeU32BE(240)) // the ARM signed-char trap value
    assertArrayEquals(byteArrayOf(0, 0, 1, 0x2C), MusicCodec.encodeU32BE(300))
    assertArrayEquals(byteArrayOf(0, 1, 0, 0), MusicCodec.encodeU32BE(65536))
    assertArrayEquals(byteArrayOf(0, 0, 0, 0), MusicCodec.encodeU32BE(0))
  }

  @Test
  fun `bool encodes one byte`() {
    assertArrayEquals(byteArrayOf(1), MusicCodec.encodeBool(true))
    assertArrayEquals(byteArrayOf(0), MusicCodec.encodeBool(false))
  }
}
