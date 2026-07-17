package dev.faisal.pinetimecompanion.notifyfwd

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.NotificationListenerService.RankingMap
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Captures posted phone notifications (once the user grants Notification Access)
 * and forwards the allowed ones to the watch. Extracts title/body, runs the
 * shared [NotificationFilter], encodes with [AnsCodec], and hands the bytes to
 * [ConnectionManager]. Stateful filter is kept as a member so dedupe/rate-limit
 * persist across posts.
 */
class NotifListenerService : NotificationListenerService() {
  private companion object {
    const val TAG = "NotifyFwd/Listener"
  }

  private val filter by lazy { NotificationFilter(applicationContext.packageName) }

  override fun onListenerConnected() {
    Log.i(TAG, "listener connected")
    ConnectionManager.init(applicationContext)
    // Sync whatever is already showing when forwarding (re)starts, so the watch
    // catches up on notifications posted while it was disconnected. Dedupe keeps
    // this from double-sending against the live onNotificationPosted callback.
    try {
      activeNotifications?.forEach { onNotificationPosted(it) }
    } catch (_: Exception) {
    }
  }

  // The framework calls the RankingMap overload; override it directly so the
  // callback fires regardless of base-class delegation.
  override fun onNotificationPosted(sbn: StatusBarNotification, rankingMap: RankingMap) {
    onNotificationPosted(sbn)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val config = ForwarderConfigStore.load(this)
    if (config.enabledWatches.isEmpty()) return

    ConnectionManager.init(applicationContext)
    // Defensively make sure the link-holding service is up.
    try {
      ForwarderService.refresh(applicationContext)
    } catch (e: Exception) {
      Log.w(TAG, "could not refresh service: ${e.message}")
    }

    val incoming = extract(sbn)
    val d = filter.decide(incoming, config.allowedPackages, config.forwardCalls, System.currentTimeMillis())
    Log.d(TAG, "posted ${sbn.packageName} '${incoming.title}' -> ${d::class.simpleName}")
    when (d) {
      is NotificationFilter.Decision.ForwardNotification ->
        ConnectionManager.broadcast(AnsCodec.encodeNotification(d.title, d.body))
      is NotificationFilter.Decision.ForwardCall ->
        ConnectionManager.broadcast(AnsCodec.encodeIncomingCall(d.caller))
      is NotificationFilter.Decision.Drop -> {}
    }
  }

  private fun extract(sbn: StatusBarNotification): NotificationFilter.Incoming {
    val n = sbn.notification
    val extras = n.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.takeIf { it.isNotBlank() }
      ?: appLabel(sbn.packageName)
    val text = (extras.getCharSequence(Notification.EXTRA_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))?.toString().orEmpty()
    return NotificationFilter.Incoming(
      packageName = sbn.packageName,
      title = title,
      text = text,
      isCall = n.category == Notification.CATEGORY_CALL,
      isOngoing = (n.flags and Notification.FLAG_ONGOING_EVENT) != 0,
      isGroupSummary = (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
    )
  }

  private fun appLabel(pkg: String): String = try {
    val pm = packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }
}
