package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.Closeable
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

class ActiveSocketGateTest {
  private class CountingCloseable : Closeable {
    var closes = 0
    override fun close() {
      closes++
    }
  }

  @Test
  fun `stop closes the published socket synchronously`() {
    val gate = ActiveSocketGate()
    val sock = CountingCloseable()
    assertTrue(gate.publish(sock))
    gate.stop()
    assertEquals("stop must close the retained socket", 1, sock.closes)
    assertTrue(gate.isStopped)
  }

  @Test
  fun `after stop no new socket may be published`() {
    val gate = ActiveSocketGate()
    gate.stop()
    val sock = CountingCloseable()
    assertFalse("publishing after stop is refused", gate.publish(sock))
    // The gate does not retain or close it — the caller owns closing it.
    assertEquals(0, sock.closes)
    // A second stop closes nothing new and stays stopped (idempotent).
    gate.stop()
    assertTrue(gate.isStopped)
  }

  @Test
  fun `clear only drops the socket when it is the current one`() {
    val gate = ActiveSocketGate()
    val first = CountingCloseable()
    val second = CountingCloseable()
    gate.publish(first)
    gate.publish(second) // replaces first
    gate.clear(first) // stale, must not drop the current socket
    gate.stop()
    assertEquals("stale clear must not have unretained the live socket", 1, second.closes)
    assertEquals(0, first.closes)
  }

  @Test
  fun `clearing the current socket means stop has nothing to close`() {
    val gate = ActiveSocketGate()
    val sock = CountingCloseable()
    gate.publish(sock)
    gate.clear(sock)
    gate.stop()
    assertEquals("already cleared, so stop closes nothing", 0, sock.closes)
    assertTrue(gate.isStopped)
  }

  @Test
  fun `stop is idempotent and only closes once`() {
    val gate = ActiveSocketGate()
    val sock = CountingCloseable()
    gate.publish(sock)
    gate.stop()
    gate.stop()
    gate.stop()
    assertEquals(1, sock.closes)
  }

  @Test
  fun `stop closes a real socket, unblocking a parked blocking read`() {
    val server = ServerSocket(0)
    val readReturned = java.util.concurrent.CountDownLatch(1)
    val gate = ActiveSocketGate()
    val client = Socket()
    client.connect(InetSocketAddress("127.0.0.1", server.localPort), 2000)
    val accepted = server.accept()
    assertTrue(gate.publish(client))

    // Park a thread in a blocking read; only closing the socket can return it.
    val reader = Thread {
      try {
        client.getInputStream().read()
      } catch (_: Exception) {
        // Expected: closing the socket aborts the blocking read.
      } finally {
        readReturned.countDown()
      }
    }
    reader.start()
    // Give the reader a moment to actually block.
    Thread.sleep(100)
    assertEquals("reader must still be blocked before stop", 1, readReturned.count)

    gate.stop()

    assertTrue("stop() must unblock the parked read", readReturned.await(2, java.util.concurrent.TimeUnit.SECONDS))
    assertTrue("the socket must be closed after stop", client.isClosed)
    reader.join(1000)
    accepted.close()
    server.close()
  }
}
