package dev.faisal.pinetimecompanion.notifyfwd

import android.app.Notification
import android.os.Build
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
    // Access may have just been granted; the media source needs it.
    ConnectionManager.restartMusicSource()
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
    val n = sbn.notification
    // Cheap rejects BEFORE any side effect. Reading config or touching the
    // service above this line makes our own foreground notification re-enter
    // this callback and drive a self-sustaining loop; see cheapDropReason.
    // extract() is below it too, because it can hit PackageManager for a label.
    if (filter.cheapDropReason(
        sbn.packageName,
        n.category == Notification.CATEGORY_CALL,
        (n.flags and Notification.FLAG_ONGOING_EVENT) != 0,
        (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
      ) != null
    ) {
      return
    }

    val config = ForwarderConfigStore.load(this)
    if (config.enabledWatches.isEmpty()) return

    ConnectionManager.init(applicationContext)
    // Only if it isn't already up: startForegroundService is a round trip
    // through ActivityManager, not a cheap idempotent poke.
    try {
      ForwarderService.refreshIfStopped(applicationContext)
    } catch (e: Exception) {
      Log.w(TAG, "could not refresh service: ${e.message}")
    }

    val incoming = extract(sbn)
    val d = filter.decide(incoming, config.allowedPackages, config.forwardCalls, System.currentTimeMillis())
    Log.d(TAG, "posted ${sbn.packageName} '${incoming.title}' -> ${d::class.simpleName}")
    when (d) {
      is NotificationFilter.Decision.ForwardNotification ->
        ConnectionManager.broadcast(WatchChar.NEW_ALERT, AnsCodec.encodeNotification(d.title, d.body))
      is NotificationFilter.Decision.ForwardCall ->
        ConnectionManager.broadcast(WatchChar.NEW_ALERT, AnsCodec.encodeIncomingCall(d.caller))
      is NotificationFilter.Decision.Drop -> {}
    }
  }

  /**
   * Is this call ringing in, as opposed to one being placed or already running?
   *
   * Android 12 added CallStyle, which states the direction outright in
   * EXTRA_CALL_TYPE; that is the answer whenever the dialer uses it. Older or
   * non-CallStyle dialers say nothing, so fall back to the full-screen intent:
   * a ringing call declares one to throw up the incoming-call UI, an outgoing
   * or ongoing call has no reason to.
   */
  private fun isIncomingCall(n: Notification): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val callType = n.extras.getInt(Notification.EXTRA_CALL_TYPE, -1)
      if (callType != -1) {
        return callType == Notification.CallStyle.CALL_TYPE_INCOMING
      }
    }
    return n.fullScreenIntent != null
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
      isIncomingCall = isIncomingCall(n),
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
