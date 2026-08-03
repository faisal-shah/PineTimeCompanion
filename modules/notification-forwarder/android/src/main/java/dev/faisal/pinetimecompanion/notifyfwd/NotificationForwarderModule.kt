package dev.faisal.pinetimecompanion.notifyfwd

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.format.DateFormat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for phone-notification forwarding. JS only pushes config and reads
 * status/permission state; the capture + BLE forwarding runs in the native
 * services so it survives the RN app being swiped away.
 */
class NotificationForwarderModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotificationForwarder")
    Events("onConnectionState", "onCallEvent", "onNowPlaying")

    OnCreate {
      ConnectionManager.init(context)
      ConnectionManager.onConnectionState = { id, state ->
        sendEvent("onConnectionState", mapOf("deviceId" to id, "state" to state.name))
      }
      ConnectionManager.onCallEvent = { id, event ->
        sendEvent("onCallEvent", mapOf("deviceId" to id, "event" to event))
      }
      ConnectionManager.onNowPlaying = { np ->
        sendEvent("onNowPlaying", mapOf("nowPlaying" to np?.let { mapOf("artist" to it.first, "track" to it.second, "playing" to it.third) }))
      }
    }

    Function("ping") { "pong" }

    // Persist config, then start/refresh or stop the forwarding service.
    AsyncFunction("setConfig") { config: Map<String, Any?> ->
      val cfg = configFromMap(config)
      ForwarderConfigStore.save(context, cfg)
      ConnectionManager.applyConfig(cfg)
      if (cfg.enabledWatches.isNotEmpty()) {
        ForwarderService.refresh(context)
      } else {
        // Stop it here rather than waiting for the service to notice on some
        // later onStartCommand: nothing is guaranteed to poke it, and its
        // ongoing notification stays in the shade until something does.
        ForwarderService.stop(context)
      }
    }

    AsyncFunction("getConfig") {
      val c = ForwarderConfigStore.load(context)
      mapOf(
        "enabledWatches" to c.enabledWatches.map { mapOf("deviceId" to it.deviceId, "name" to it.name) },
        "allowedPackages" to c.allowedPackages.toList(),
        "forwardCalls" to c.forwardCalls,
      )
    }

    AsyncFunction("isNotificationAccessGranted") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    // The phone's system-wide "Use 24-hour format" toggle. JS Intl follows the
    // *locale*, which disagrees with this whenever the user has overridden it.
    Function("is24HourFormat") {
      DateFormat.is24HourFormat(context)
    }

    // Prefer this app's own listener page (API 30+); the global list makes the
    // user hunt for us among every installed app.
    Function("openNotificationAccessSettings") {
      val component = ComponentName(context, NotifListenerService::class.java).flattenToString()
      val direct = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val fallback = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val target = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
        direct.resolveActivity(context.packageManager) != null
      ) direct else fallback
      context.startActivity(target)
    }

    // App info -> the overflow menu here is the only place "Allow restricted
    // settings" appears, and Android 13+ hides notification access behind it
    // for any sideloaded app.
    Function("openAppInfoSettings") {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.fromParts("package", context.packageName, null))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("getInstalledApps") {
      val pm = context.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .asSequence()
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .distinctBy { it.first }
        .filter { it.first != context.packageName }
        .sortedBy { it.second.lowercase() }
        .map { mapOf("packageName" to it.first, "label" to it.second) }
        .toList()
    }

    AsyncFunction("getStatus") {
      mapOf(
        "serviceRunning" to ConnectionManager.hasEnabledWatches(),
        "connections" to ConnectionManager.status().map {
          mapOf("deviceId" to it.first, "state" to it.second.name)
        },
        "nowPlaying" to ConnectionManager.musicBridge()?.nowPlaying()?.let {
          mapOf("artist" to it.first, "track" to it.second, "playing" to it.third)
        },
      )
    }

    AsyncFunction("pauseConnections") { deviceId: String -> ConnectionManager.pause(deviceId) }
    AsyncFunction("resumeConnections") { deviceId: String -> ConnectionManager.resume(deviceId) }

    // Dev helper: inject an incoming-call alert (calls can't be posted via the
    // normal notification API in a test).
    AsyncFunction("debugInjectCall") { caller: String ->
      ConnectionManager.broadcast(WatchChar.NEW_ALERT, AnsCodec.encodeIncomingCall(caller))
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun configFromMap(config: Map<String, Any?>): ForwarderConfig {
    val watches = (config["enabledWatches"] as? List<Map<String, Any?>>).orEmpty().map {
      EnabledWatch(it["deviceId"].toString(), it["name"]?.toString() ?: "")
    }
    val pkgs = (config["allowedPackages"] as? List<Any?>).orEmpty().map { it.toString() }.toSet()
    val forwardCalls = config["forwardCalls"] as? Boolean ?: true
    return ForwarderConfig(watches, pkgs, forwardCalls)
  }
}
