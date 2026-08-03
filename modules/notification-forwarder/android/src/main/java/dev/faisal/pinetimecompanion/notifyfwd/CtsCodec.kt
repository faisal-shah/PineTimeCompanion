package dev.faisal.pinetimecompanion.notifyfwd

import java.util.Calendar

/**
 * Current Time Service (0x2A2B) payload, the standard 10-byte layout InfiniTime
 * parses in CurrentTimeService::OnCurrentTimeAccessed.
 *
 * The watch has no backup battery for its clock: it lives in RAM, is copied to
 * no-init RAM every state tick and restored on a soft reset, but a power loss or
 * a firmware image whose memory layout moved leaves it at 1 January of the build
 * year. Nothing on the watch can tell that state from a real date — it will show
 * the wrong day, and compute prayer times for it, perfectly confidently.
 *
 * The forwarder is the natural place to correct that: it reconnects whenever the
 * watch reboots, and this characteristic needs no pairing.
 */
object CtsCodec {
  /** Local wall-clock time, as the watch displays it. */
  fun encode(millis: Long): ByteArray {
    val c = Calendar.getInstance()
    c.timeInMillis = millis
    val year = c.get(Calendar.YEAR)
    // Calendar: Sunday = 1. CTS: Monday = 1 .. Sunday = 7.
    val dayOfWeek = ((c.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1
    return byteArrayOf(
      (year and 0xff).toByte(),
      ((year shr 8) and 0xff).toByte(),
      (c.get(Calendar.MONTH) + 1).toByte(),
      c.get(Calendar.DAY_OF_MONTH).toByte(),
      c.get(Calendar.HOUR_OF_DAY).toByte(),
      c.get(Calendar.MINUTE).toByte(),
      c.get(Calendar.SECOND).toByte(),
      dayOfWeek.toByte(),
      ((c.get(Calendar.MILLISECOND) * 256) / 1000).toByte(),
      0, // adjust reason
    )
  }
}
