package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Encodes InfiniTime Alert Notification Service (0x1811 / New Alert 0x2A46)
 * payloads. Wire format the firmware expects (AlertNotificationService.cpp):
 *
 *   [category][count][icon] + utf8(title + NUL + body)
 *
 * The firmware reads byte 0 (category), skips bytes 1-2, then copies from byte 3
 * and truncates the text at 100 bytes; it splits title/body on the first NUL.
 * Category 0xFA renders as a plain notification (SimpleAlert); 0x03 renders the
 * incoming-call screen (rings + accept/reject/mute). This mirrors the
 * companion's TS `encodeMessageAlert` (src/ble/syncManager.ts) byte-for-byte for
 * ASCII, but truncates the text on a UTF-8 character boundary so a multibyte
 * char is never split.
 */
object AnsCodec {
  private const val CATEGORY_NOTIFICATION = 0xFA
  private const val CATEGORY_CALL = 0x03
  private const val COUNT = 0x01
  private const val NO_ICON = 0xFF
  const val MAX_TEXT_BYTES = 97 // 100-byte firmware cap minus the 3-byte header
  private val NUL = Char(0) // title/body separator the firmware splits on

  /** Plain notification. Title and body are NUL-separated (the firmware splits
   *  on the first NUL: text before it is the bold title, after it the body). */
  fun encodeNotification(title: String, body: String): ByteArray =
    frame(CATEGORY_NOTIFICATION, title + NUL + body)

  /** Incoming call: the caller name is the body; category 0x03 rings the watch. */
  fun encodeIncomingCall(caller: String): ByteArray = frame(CATEGORY_CALL, caller)

  private fun frame(category: Int, text: String): ByteArray {
    val payload = truncateUtf8(text, MAX_TEXT_BYTES)
    val out = ByteArray(3 + payload.size)
    out[0] = category.toByte()
    out[1] = COUNT.toByte()
    out[2] = NO_ICON.toByte()
    payload.copyInto(out, 3)
    return out
  }

  /**
   * UTF-8 bytes of [s], truncated to at most [maxBytes] without splitting a
   * multibyte sequence (drops back to the last lead byte).
   */
  fun truncateUtf8(s: String, maxBytes: Int): ByteArray {
    val bytes = s.toByteArray(Charsets.UTF_8)
    if (bytes.size <= maxBytes) return bytes
    var end = maxBytes
    // Continuation bytes are 0b10xxxxxx; back up until the next byte starts a char.
    while (end > 0 && (bytes[end].toInt() and 0xC0) == 0x80) {
      end--
    }
    return bytes.copyOfRange(0, end)
  }
}
