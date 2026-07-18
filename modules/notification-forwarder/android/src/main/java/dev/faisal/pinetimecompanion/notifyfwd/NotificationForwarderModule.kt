package dev.faisal.pinetimecompanion.notifyfwd

import android.content.Context
import android.content.Intent
import android.provider.Settings
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
      }
      // When empty, the running service stops itself on its next onStartCommand;
      // applyConfig already tore down the connections.
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

    Function("openNotificationAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
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
