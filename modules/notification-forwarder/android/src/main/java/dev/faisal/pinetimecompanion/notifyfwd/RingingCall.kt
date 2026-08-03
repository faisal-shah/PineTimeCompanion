package dev.faisal.pinetimecompanion.notifyfwd

import android.app.Notification
import android.app.PendingIntent
import android.os.Build
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * The call that is ringing right now, and the buttons the dialer offered for it.
 *
 * Android 12's CallStyle publishes the dialer's own decline and answer actions in
 * the notification extras (EXTRA_DECLINE_INTENT, EXTRA_ANSWER_INTENT). Firing one
 * is exactly what tapping that button on the phone would do, and notification
 * access -- which the forwarder already needs -- is enough to do it. No
 * ANSWER_PHONE_CALLS, no InCallService, no dialer role.
 *
 * Only one call can ring at a time, so a single slot is enough. It is cleared
 * when the notification goes away, so a stale intent can never be fired at a
 * call that has already ended.
 */
object RingingCall {
  private const val TAG = "NotifyFwd/Call"

  @Volatile
  private var key: String? = null

  @Volatile
  private var decline: PendingIntent? = null

  /** Remember a ringing call's actions. Non-CallStyle dialers offer none. */
  fun remember(sbn: StatusBarNotification) {
    val declineIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      @Suppress("DEPRECATION")
      sbn.notification.extras.getParcelable(Notification.EXTRA_DECLINE_INTENT) as? PendingIntent
    } else {
      null
    }
    key = sbn.key
    decline = declineIntent
    if (declineIntent == null) {
      Log.i(TAG, "ringing call from ${sbn.packageName} exposes no decline action; reject from the watch will not work")
    }
  }

  /** Forget it once the call is over, so nothing stale can be fired later. */
  fun forget(sbn: StatusBarNotification) {
    if (sbn.key == key) {
      key = null
      decline = null
    }
  }

  fun clear() {
    key = null
    decline = null
  }

  /** True when the call was actually declined. */
  fun reject(): Boolean {
    val intent = decline ?: return false
    return try {
      intent.send()
      Log.i(TAG, "declined the ringing call from the watch")
      clear()
      true
    } catch (e: PendingIntent.CanceledException) {
      // The call ended between the watch press and here.
      Log.i(TAG, "decline intent was already cancelled: ${e.message}")
      clear()
      false
    }
  }
}
