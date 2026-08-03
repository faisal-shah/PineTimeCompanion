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
    isIncomingCall: Boolean = true,
  ) = Incoming(
    packageName = pkg,
    title = title,
    text = text,
    isCall = isCall,
    isOngoing = isOngoing,
    isGroupSummary = isGroupSummary,
    isIncomingCall = isIncomingCall,
  )

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
  fun `a missed call is an ordinary notification and needs the dialer allowlisted`() {
    // isCall mirrors Notification.CATEGORY_CALL, which a *ringing* call sets and
    // a missed-call/voicemail post does not. So the calls switch alone is not
    // enough for those -- the UI says as much, and this pins it.
    val missed = notif(pkg = "com.android.dialer", title = "Missed call", text = "Mom", isCall = false)
    assertEquals("not-allowed", (filter().decide(missed, allowed, forwardCalls = true, nowMs = 1000) as Decision.Drop).reason)

    val withDialerAllowed = allowed + "com.android.dialer"
    assertTrue(filter().decide(missed, withDialerAllowed, forwardCalls = false, nowMs = 1000) is Decision.ForwardNotification)
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

  // --- the cheap pre-filter, which runs before any side effect ---

  @Test
  fun `our own foreground-service notification is rejected by the cheap filter`() {
    // The loop this guards: posting the service notification re-enters the
    // listener, which restarts the service, which re-posts the notification.
    // The reject has to be reachable without reading config or touching the
    // service, which is what cheapDropReason is for.
    val f = NotificationFilter(own)
    assertEquals("own", f.cheapDropReason(own, isCall = false, isOngoing = false, isGroupSummary = false))
    assertEquals("own", f.cheapDropReason(own, isCall = false, isOngoing = true, isGroupSummary = false))
  }

  @Test
  fun `ongoing media notifications are rejected by the cheap filter`() {
    // A media app re-posts its ongoing notification continuously while playing.
    val f = NotificationFilter(own)
    assertEquals("ongoing", f.cheapDropReason("com.spotify.music", isCall = false, isOngoing = true, isGroupSummary = false))
    assertEquals("summary", f.cheapDropReason("com.whatsapp", isCall = false, isOngoing = false, isGroupSummary = true))
  }

  @Test
  fun `an ongoing call still passes the cheap filter`() {
    // Ringing calls are ongoing but must survive to the real decision.
    val f = NotificationFilter(own)
    assertEquals(null, f.cheapDropReason("com.android.dialer", isCall = true, isOngoing = true, isGroupSummary = false))
  }

  @Test
  fun `cheap filter agrees with decide on every reason it claims`() {
    // One source of truth: decide delegates to cheapDropReason, so a drift
    // between them would silently reintroduce the loop.
    val f = NotificationFilter(own)
    val cases = listOf(
      Triple(own, false, false),
      Triple("com.whatsapp", false, true),
      Triple("com.spotify.music", false, false),
    )
    for ((pkg, isCall, isSummary) in cases) {
      val ongoing = pkg == "com.spotify.music"
      val cheap = f.cheapDropReason(pkg, isCall, ongoing, isSummary)
      val d = f.decide(notif(pkg = pkg, isCall = isCall, isOngoing = ongoing, isGroupSummary = isSummary), allowed, true, 0L)
      assertTrue("cheap=$cheap decide=$d", cheap == null || (d is Decision.Drop && d.reason == cheap))
    }
  }

  // --- call direction ---

  @Test
  fun `an outgoing call is not forwarded`() {
    // Reported from hardware: placing a call buzzed the watch as though someone
    // were calling in. CATEGORY_CALL spans the whole life of a call, so the
    // direction has to be checked separately.
    val f = NotificationFilter(own)
    val d = f.decide(
      notif(pkg = "com.google.android.dialer", isCall = true, isOngoing = true, isIncomingCall = false),
      allowed,
      forwardCalls = true,
      nowMs = 0L,
    )
    assertTrue(d is Decision.Drop)
    assertEquals("call-not-incoming", (d as Decision.Drop).reason)
  }

  @Test
  fun `a ringing call is still forwarded`() {
    val f = NotificationFilter(own)
    val d = f.decide(
      notif(pkg = "com.google.android.dialer", title = "Alice", isCall = true, isOngoing = true, isIncomingCall = true),
      allowed,
      forwardCalls = true,
      nowMs = 0L,
    )
    assertTrue("a ringing call must survive: $d", d is Decision.ForwardCall)
  }

  @Test
  fun `a ringing call from an unlisted dialer still survives the cheap filter`() {
    // Calls bypass the app allowlist, and the cheap filter runs first, so the
    // ongoing flag on a ringing call must not knock it out before that.
    val f = NotificationFilter(own)
    assertEquals(null, f.cheapDropReason("com.some.dialer", isCall = true, isOngoing = true, isGroupSummary = false))
  }

  @Test
  fun `a call whose direction the dialer left unknown is still forwarded`() {
    // CALL_TYPE_UNKNOWN is 0, and the extra defaults to it. Treating that as
    // "not incoming" would silently drop real incoming calls from any dialer
    // that sets CallStyle without stating a direction.
    val f = NotificationFilter(own)
    val d = f.decide(
      notif(pkg = "com.some.dialer", title = "Alice", isCall = true, isOngoing = true, isIncomingCall = true),
      allowed,
      forwardCalls = true,
      nowMs = 0L,
    )
    assertTrue("an unknown-direction call must not be dropped: $d", d is Decision.ForwardCall)
  }
}
