package dev.faisal.pinetimecompanion.notifyfwd

import android.app.Service
import android.content.Intent
import android.os.IBinder

// Foreground service that keeps the process + BLE watch connection(s) alive
// while any watch has forwarding enabled. Phase 1 stub; Phase 2 adds
// startForeground(connectedDevice) + ConnectionManager wiring.
class ForwarderService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
}
