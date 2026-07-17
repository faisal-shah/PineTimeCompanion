package dev.faisal.pinetimecompanion.notifyfwd

import dev.faisal.pinetimecompanion.notifyfwd.NotificationFilter.Decision
import dev.faisal.pinetimecompanion.notifyfwd.NotificationFilter.Incoming
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationFilterTest {
  private val own = "dev.faisal.pinetimecompanion"
  private val allowed = setOf("com.whatsapp")

  private fun notif(
    pkg: String = "com.whatsapp",
    title: String = "Alice",
    text: String = "hi",
    isCall: Boolean = false,
    isOngoing: Boolean = false,
    isGroupSummary: Boolean = false,
  ) = Incoming(pkg, title, text, isCall, isOngoing, isGroupSummary)

  private fun filter() = NotificationFilter(own, dedupeTtlMs = 10_000, minGapMs = 500, burst = 3)

  @Test
  fun `allowlisted app forwards title and body`() {
    val d = filter().decide(notif(), allowed, forwardCalls = true, nowMs = 1000)
    assertEquals(Decision.ForwardNotification("Alice", "hi"), d)
  }

  @Test
  fun `app not on the allowlist is dropped`() {
    val d = filter().decide(notif(pkg = "com.spam"), allowed, forwardCalls = true, nowMs = 1000)
    assertEquals("not-allowed", (d as Decision.Drop).reason)
  }

  @Test
  fun `our own package, group summaries, and ongoing are dropped`() {
    val f = filter()
    assertEquals("own", (f.decide(notif(pkg = own), allowed, true, 1000) as Decision.Drop).reason)
    assertEquals("summary", (f.decide(notif(isGroupSummary = true), allowed, true, 1000) as Decision.Drop).reason)
    assertEquals("ongoing", (f.decide(notif(isOngoing = true), allowed, true, 1000) as Decision.Drop).reason)
  }

  @Test
  fun `calls bypass the allowlist but respect the forwardCalls switch`() {
    val call = notif(pkg = "com.android.dialer", title = "Mom", text = "", isCall = true)
    assertEquals(Decision.ForwardCall("Mom"), filter().decide(call, allowed, forwardCalls = true, nowMs = 1000))
    assertEquals("calls-off", (filter().decide(call, allowed, forwardCalls = false, nowMs = 1000) as Decision.Drop).reason)
  }

  @Test
  fun `an ongoing call still forwards (calls are exempt from the ongoing drop)`() {
    val d = filter().decide(notif(title = "Mom", isCall = true, isOngoing = true), allowed, true, 1000)
    assertEquals(Decision.ForwardCall("Mom"), d)
  }

  @Test
  fun `identical content within the TTL is deduped, then allowed again after it`() {
    val f = filter()
    assertTrue(f.decide(notif(), allowed, true, 1000) is Decision.ForwardNotification)
    assertEquals("duplicate", (f.decide(notif(), allowed, true, 2000) as Decision.Drop).reason)
    // After the 10s TTL, the same content forwards again.
    assertTrue(f.decide(notif(), allowed, true, 12_001) is Decision.ForwardNotification)
  }

  @Test
  fun `rate limit drops a burst beyond the token budget`() {
    val f = filter() // burst 3
    // Distinct content (so dedupe doesn't fire) at the same instant.
    val results = (1..5).map { f.decide(notif(text = "m$it"), allowed, true, nowMs = 1000) }
    assertEquals(3, results.count { it is Decision.ForwardNotification })
    assertEquals(2, results.count { it is Decision.Drop && it.reason == "rate" })
  }
}
