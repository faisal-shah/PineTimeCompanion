package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Encoders/decoders for InfiniTime's MusicService. Strings are raw UTF-8; the
 * firmware truncates anything over 40 bytes and overwrites the tail with "..."
 * — which can split a multibyte char — so we pre-truncate at a codepoint
 * boundary <= 37 bytes and append "..." ourselves. Integers are 4-byte
 * BIG-endian (unlike the rest of the watch protocols).
 */
object MusicCodec {
  const val MAX_STRING_BYTES = 40
  private const val TRUNCATED_BODY_BYTES = 37 // + "..." = 40

  // Event byte values (watch -> phone, MusicService event char).
  const val EVENT_OPEN = 0xE0
  const val EVENT_PLAY = 0x00
  const val EVENT_PAUSE = 0x01
  const val EVENT_NEXT = 0x03
  const val EVENT_PREV = 0x04
  const val EVENT_VOLUP = 0x05
  const val EVENT_VOLDOWN = 0x06

  fun encodeString(s: String): ByteArray {
    val bytes = s.toByteArray(Charsets.UTF_8)
    if (bytes.size <= MAX_STRING_BYTES) return bytes
    var end = TRUNCATED_BODY_BYTES
    // Back off continuation bytes (0b10xxxxxx) so no codepoint is split.
    while (end > 0 && (bytes[end].toInt() and 0xC0) == 0x80) {
      end--
    }
    return bytes.copyOfRange(0, end) + "...".toByteArray(Charsets.UTF_8)
  }

  fun encodeU32BE(v: Long): ByteArray = byteArrayOf(
    ((v shr 24) and 0xFF).toByte(),
    ((v shr 16) and 0xFF).toByte(),
    ((v shr 8) and 0xFF).toByte(),
    (v and 0xFF).toByte(),
  )

  fun encodeBool(b: Boolean): ByteArray = byteArrayOf(if (b) 1 else 0)

  fun eventName(event: Int): String = when (event) {
    EVENT_OPEN -> "OPEN"
    EVENT_PLAY -> "PLAY"
    EVENT_PAUSE -> "PAUSE"
    EVENT_NEXT -> "NEXT"
    EVENT_PREV -> "PREV"
    EVENT_VOLUP -> "VOLUP"
    EVENT_VOLDOWN -> "VOLDOWN"
    else -> "UNKNOWN(0x${event.toString(16)})"
  }
}
