package dev.faisal.pinetimecompanion.notifyfwd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Re-arms forwarding after a reboot: if any watch is enabled in the persisted
// config, start the ForwarderService. Phase 1 stub; Phase 2 adds the config
// check + startForegroundService.
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {}
}
