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
    running = true
    ConnectionManager.init(applicationContext)
  }

  override fun onDestroy() {
    // Without this, refreshIfStopped would refuse to restart the service for the
    // rest of the process's life.
    running = false
    super.onDestroy()
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

    /** Set while the service is up, so callers on hot paths can skip the
     *  ActivityManager round trip that starting it costs. */
    @Volatile
    private var running = false

    /** Start (or refresh) the service if any watch is enabled. Safe from a
     *  foreground context or the listener/boot receiver. */
    fun refresh(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, ForwarderService::class.java))
    }

    /**
     * Stop the service and take its ongoing notification down with it.
     *
     * Called explicitly when forwarding is turned off. The service used to be
     * left to notice an empty config on its next onStartCommand, which only
     * happened because every posted notification poked it -- so once that poke
     * became conditional, nothing stopped it and its notification sat in the
     * shade forever. Turning something off should turn it off, not wait for an
     * unrelated event to notice.
     */
    fun stop(context: Context) {
      context.stopService(Intent(context, ForwarderService::class.java))
    }

    /**
     * Start the service only if it is not already up. For callers that fire per
     * notification: startForegroundService is a binder round trip into
     * ActivityManager and re-posts this service's own notification, so calling
     * it unconditionally on a hot path is both expensive and self-feeding.
     */
    fun refreshIfStopped(context: Context) {
      if (running) return
      refresh(context)
    }
  }
}
