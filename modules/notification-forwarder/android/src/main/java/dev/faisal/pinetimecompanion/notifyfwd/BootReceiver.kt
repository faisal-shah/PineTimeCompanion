package dev.faisal.pinetimecompanion.notifyfwd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms forwarding after a reboot: if any watch is enabled in the persisted
 * config, start the foreground service (which reconnects the watches).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (ForwarderConfigStore.load(context).enabledWatches.isNotEmpty()) {
      ForwarderService.refresh(context)
    }
  }
}
