package dev.faisal.pinetimecompanion.notifyfwd

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that keeps the process + BLE watch link(s) alive while any
 * watch has forwarding enabled. Type connectedDevice (Android 14+ requires it).
 * Loads the persisted config and hands it to [ConnectionManager]; stops itself
 * if no watch is enabled. START_STICKY so the OS restarts it after a kill.
 */
class ForwarderService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ConnectionManager.init(applicationContext)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val config = ForwarderConfigStore.load(this)
    if (config.enabledWatches.isEmpty()) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        NOTIF_ID,
        buildNotification(config),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
      )
    } catch (e: Exception) {
      // e.g. missing BLUETOOTH_CONNECT on Android 14+ for the connectedDevice type.
      Log.w(TAG, "startForeground failed: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    ConnectionManager.applyConfig(config)
    return START_STICKY
  }

  private fun buildNotification(config: ForwarderConfig) = run {
    ensureChannel()
    val names = config.enabledWatches.joinToString(", ") { it.name.ifBlank { it.deviceId } }
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentTitle("Forwarding notifications")
      .setContentText(if (names.isBlank()) "Watch link active" else "Connected to $names")
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
      mgr.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Watch link", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Keeps forwarding-enabled watches connected"
        },
      )
    }
  }

  companion object {
    private const val TAG = "NotifyFwd/Service"
    private const val CHANNEL_ID = "watch_link"
    private const val NOTIF_ID = 4711

    /** Start (or refresh) the service if any watch is enabled. Safe from a
     *  foreground context or the listener/boot receiver. */
    fun refresh(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, ForwarderService::class.java))
    }
  }
}
