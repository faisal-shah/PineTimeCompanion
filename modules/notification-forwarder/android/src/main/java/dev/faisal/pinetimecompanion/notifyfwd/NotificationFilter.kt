package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Decides whether a posted phone notification should be forwarded to the watch,
 * and as what. Pure and deterministic given the injected `nowMs`, so it unit
 * tests without Android. Holds dedupe + rate-limit state across calls (it runs
 * once per posted notification, upstream of the per-watch fan-out).
 *
 * Rules, in order: drop our own app; drop group summaries; drop ongoing unless
 * it's a call; calls gate on `forwardCalls`, everything else on the allowlist;
 * then dedupe (same content within a TTL) and a token-bucket rate limit (the
 * watch only holds 5 notifications, so a burst is pointless).
 */
class NotificationFilter(
  private val ownPackage: String,
  private val dedupeTtlMs: Long = 10_000,
  private val minGapMs: Long = 500, // ~2 forwards/second sustained
  private val burst: Int = 3,
) {
  data class Incoming(
    val packageName: String,
    val title: String,
    val text: String,
    val isCall: Boolean, // notification.category == CATEGORY_CALL
    val isOngoing: Boolean, // FLAG_ONGOING_EVENT
    val isGroupSummary: Boolean, // FLAG_GROUP_SUMMARY
    // True only when the call is ringing *in*. CATEGORY_CALL covers the whole
    // life of a call, so one you placed yourself, and the ongoing state after
    // answering, both arrive looking identical to an incoming call unless the
    // direction is checked. Last field, with a default, so adding it cannot
    // shift the meaning of any existing positional argument.
    val isIncomingCall: Boolean = true,
  )

  sealed class Decision {
    data class ForwardNotification(val title: String, val body: String) : Decision()
    data class ForwardCall(val caller: String) : Decision()
    data class Drop(val reason: String) : Decision()
  }

  private val recent = HashMap<String, Long>() // content key -> expiry ms
  private var tokens = burst.toDouble()
  private var lastRefill = Long.MIN_VALUE

  /**
   * The rejects that need no configuration, no allocation and no I/O. These MUST
   * be checked before anything with a side effect.
   *
   * Our own foreground-service notification is one of them, and it is not a
   * rare case: posting it re-enters this listener. Doing work before this point
   * — reading config, calling startForegroundService — makes that a loop that
   * sustains itself (service start -> notification posted -> listener ->
   * service start), burning CPU in the app and in system_server for as long as
   * forwarding is enabled.
   *
   * Ongoing notifications land here too, which matters just as much: a media
   * app re-posts its ongoing notification continuously while playing, so every
   * second of video would otherwise mean repeated config parses and
   * ActivityManager round trips.
   *
   * Returns the drop reason, or null if the notification deserves a real look.
   */
  fun cheapDropReason(packageName: String, isCall: Boolean, isOngoing: Boolean, isGroupSummary: Boolean): String? =
    when {
      packageName == ownPackage -> "own"
      isGroupSummary -> "summary"
      isOngoing && !isCall -> "ongoing"
      else -> null
    }

  fun decide(n: Incoming, allowedPackages: Set<String>, forwardCalls: Boolean, nowMs: Long): Decision {
    cheapDropReason(n.packageName, n.isCall, n.isOngoing, n.isGroupSummary)?.let { return Decision.Drop(it) }
    if (n.isCall) {
      if (!forwardCalls) return Decision.Drop("calls-off")
      // Only a ringing call is worth a buzz on the wrist. You already know
      // about the call you just placed, and the ongoing-call notification
      // repeats for the whole conversation.
      if (!n.isIncomingCall) return Decision.Drop("call-not-incoming")
    } else if (n.packageName !in allowedPackages) {
      return Decision.Drop("not-allowed")
    }

    purge(nowMs)
    val key = "${n.packageName}|${n.title}|${n.text}|${n.isCall}"
    if (recent.containsKey(key)) return Decision.Drop("duplicate")
    if (!takeToken(nowMs)) return Decision.Drop("rate")
    recent[key] = nowMs + dedupeTtlMs

    return if (n.isCall) {
      Decision.ForwardCall(caller(n))
    } else {
      Decision.ForwardNotification(n.title, n.text)
    }
  }

  private fun caller(n: Incoming): String =
    n.title.ifBlank { n.text }.ifBlank { "Call" }

  private fun purge(nowMs: Long) {
    val it = recent.entries.iterator()
    while (it.hasNext()) if (it.next().value <= nowMs) it.remove()
  }

  private fun takeToken(nowMs: Long): Boolean {
    if (lastRefill != Long.MIN_VALUE) {
      val refill = (nowMs - lastRefill).toDouble() / minGapMs
      tokens = (tokens + refill).coerceAtMost(burst.toDouble())
    }
    lastRefill = nowMs
    if (tokens >= 1.0) {
      tokens -= 1.0
      return true
    }
    return false
  }
}
