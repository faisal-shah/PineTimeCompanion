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
  )

  sealed class Decision {
    data class ForwardNotification(val title: String, val body: String) : Decision()
    data class ForwardCall(val caller: String) : Decision()
    data class Drop(val reason: String) : Decision()
  }

  private val recent = HashMap<String, Long>() // content key -> expiry ms
  private var tokens = burst.toDouble()
  private var lastRefill = Long.MIN_VALUE

  fun decide(n: Incoming, allowedPackages: Set<String>, forwardCalls: Boolean, nowMs: Long): Decision {
    if (n.packageName == ownPackage) return Decision.Drop("own")
    if (n.isGroupSummary) return Decision.Drop("summary")
    if (n.isOngoing && !n.isCall) return Decision.Drop("ongoing")
    if (n.isCall) {
      if (!forwardCalls) return Decision.Drop("calls-off")
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
