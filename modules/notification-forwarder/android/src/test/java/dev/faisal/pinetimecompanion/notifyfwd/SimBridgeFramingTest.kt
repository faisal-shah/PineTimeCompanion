package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SimBridgeFramingTest {
  @Test
  fun `encodeRequest lays out charId, op, LE length, then data`() {
    val f = SimBridgeFraming.encodeRequest(3, SimBridgeFraming.OP_WRITE, byteArrayOf(0xAA.toByte(), 0xBB.toByte()))
    assertEquals(listOf(3, 0, 2, 0, 0xAA, 0xBB), f.map { it.toInt() and 0xFF })
  }

  @Test
  fun `parser reassembles a response frame`() {
    // status=0, len=3, payload=[1,2,3]
    val frames = SimBridgeFraming.Parser().feed(byteArrayOf(0, 3, 0, 1, 2, 3))
    assertEquals(1, frames.size)
    val r = frames[0] as SimBridgeFraming.Frame.Response
    assertEquals(0, r.status)
    assertArrayEquals(byteArrayOf(1, 2, 3), r.payload)
  }

  @Test
  fun `parser distinguishes notify frames by the 0xF0 marker`() {
    // [0xF0, charId=3, len=1, payload=[5]]
    val frames = SimBridgeFraming.Parser().feed(byteArrayOf(0xF0.toByte(), 3, 1, 0, 5))
    val n = frames[0] as SimBridgeFraming.Frame.Notify
    assertEquals(3, n.charId)
    assertArrayEquals(byteArrayOf(5), n.payload)
  }

  @Test
  fun `parser reassembles across arbitrary chunk splits`() {
    val p = SimBridgeFraming.Parser()
    // A response [0,2,0,9,9] delivered one byte at a time.
    val whole = byteArrayOf(0, 2, 0, 9, 9)
    val collected = mutableListOf<SimBridgeFraming.Frame>()
    for (b in whole) collected += p.feed(byteArrayOf(b))
    assertEquals(1, collected.size)
    assertArrayEquals(byteArrayOf(9, 9), (collected[0] as SimBridgeFraming.Frame.Response).payload)
  }

  @Test
  fun `parser yields two frames merged in one chunk`() {
    val a = SimBridgeFraming.encodeRequest(0, 0, byteArrayOf()) // not a response, but reuse shape
    // Build two responses manually: [0,0,0][0,1,0,7]
    val frames = SimBridgeFraming.Parser().feed(byteArrayOf(0, 0, 0, 0, 1, 0, 7))
    assertEquals(2, frames.size)
    assertTrue(frames.all { it is SimBridgeFraming.Frame.Response })
    assertArrayEquals(byteArrayOf(7), (frames[1] as SimBridgeFraming.Frame.Response).payload)
  }
}
