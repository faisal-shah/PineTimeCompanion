package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Frame codec for InfiniSim's TCP GATT bridge — the Kotlin twin of
 * src/ble/bridgeFraming.ts (kept byte-compatible). Lets the native forwarder
 * drive the simulator over TCP for headless emulator tests.
 *
 *   Request  (client -> bridge): [charId, op, lenLo, lenHi, ...data]
 *     op: 0 = write (expects a response), 1 = read, 2 = write-without-response
 *   Response (bridge -> client): [status, lenLo, lenHi, ...payload]
 *   Notify   (bridge -> client): [0xF0, charId, lenLo, lenHi, ...payload]
 *     0xF0 is not a valid ATT status, so byte 0 disambiguates the two shapes.
 */
object SimBridgeFraming {
  const val OP_WRITE = 0
  const val OP_READ = 1
  const val OP_WRITE_NO_RESPONSE = 2
  private const val NOTIFY_MARKER = 0xF0

  fun encodeRequest(charId: Int, op: Int, data: ByteArray): ByteArray {
    val frame = ByteArray(4 + data.size)
    frame[0] = charId.toByte()
    frame[1] = op.toByte()
    frame[2] = (data.size and 0xFF).toByte()
    frame[3] = ((data.size shr 8) and 0xFF).toByte()
    data.copyInto(frame, 4)
    return frame
  }

  sealed class Frame {
    data class Response(val status: Int, val payload: ByteArray) : Frame()
    data class Notify(val charId: Int, val payload: ByteArray) : Frame()
  }

  /** Reassembles inbound frames from a byte stream across arbitrary chunk splits. */
  class Parser {
    private var buffer = ByteArray(0)

    fun feed(chunk: ByteArray): List<Frame> {
      buffer += chunk
      val frames = mutableListOf<Frame>()
      while (true) {
        if (buffer.isNotEmpty() && (buffer[0].toInt() and 0xFF) == NOTIFY_MARKER) {
          if (buffer.size < 4) break
          val len = u16(buffer, 2)
          if (buffer.size < 4 + len) break
          frames += Frame.Notify(buffer[1].toInt() and 0xFF, buffer.copyOfRange(4, 4 + len))
          buffer = buffer.copyOfRange(4 + len, buffer.size)
          continue
        }
        if (buffer.size < 3) break
        val len = u16(buffer, 1)
        if (buffer.size < 3 + len) break
        frames += Frame.Response(buffer[0].toInt() and 0xFF, buffer.copyOfRange(3, 3 + len))
        buffer = buffer.copyOfRange(3 + len, buffer.size)
      }
      return frames
    }

    fun reset() {
      buffer = ByteArray(0)
    }

    private fun u16(b: ByteArray, off: Int): Int =
      (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8)
  }
}
