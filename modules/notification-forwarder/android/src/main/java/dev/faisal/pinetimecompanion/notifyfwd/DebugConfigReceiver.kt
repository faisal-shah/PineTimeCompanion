package dev.faisal.pinetimecompanion.notifyfwd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import org.json.JSONObject

/**
 * Debug-only adb lever for the headless emulator+sim e2e. INERT in release
 * builds (guarded on FLAG_DEBUGGABLE). Lets a test push config and inject a call
 * (which `cmd notification post` cannot express as CATEGORY_CALL) without the RN
 * app being foreground:
 *
 *   adb shell am broadcast -a dev.faisal.pinetimecompanion.notifyfwd.SET_CONFIG \
 *     --es config '{"enabledWatches":[{"deviceId":"10.0.2.2:18632","name":"Sim"}],"allowedPackages":["com.android.shell"],"forwardCalls":true}'
 *   adb shell am broadcast -a dev.faisal.pinetimecompanion.notifyfwd.INJECT_CALL --es caller Mom
 */
class DebugConfigReceiver : BroadcastReceiver() {
  private companion object {
    const val TAG = "NotifyFwd/Debug"
    const val ACTION_SET_CONFIG = "dev.faisal.pinetimecompanion.notifyfwd.SET_CONFIG"
    const val ACTION_INJECT_CALL = "dev.faisal.pinetimecompanion.notifyfwd.INJECT_CALL"
    const val ACTION_INJECT_NOTIF = "dev.faisal.pinetimecompanion.notifyfwd.INJECT_NOTIF"
    const val ACTION_MEDIA_START = "dev.faisal.pinetimecompanion.notifyfwd.MEDIA_START"
    const val ACTION_MEDIA_SET = "dev.faisal.pinetimecompanion.notifyfwd.MEDIA_SET"
    const val ACTION_MEDIA_QUERY = "dev.faisal.pinetimecompanion.notifyfwd.MEDIA_QUERY"
    const val ACTION_MEDIA_STOP = "dev.faisal.pinetimecompanion.notifyfwd.MEDIA_STOP"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (!debuggable) return
    ConnectionManager.init(context.applicationContext)
    when (intent.action) {
      ACTION_SET_CONFIG -> {
        // Prefer base64 (survives adb's double shell parsing); fall back to raw.
        val json = intent.getStringExtra("config_b64")
          ?.let { String(android.util.Base64.decode(it, android.util.Base64.DEFAULT)) }
          ?: intent.getStringExtra("config")
          ?: return
        val cfg = try {
          ForwarderConfigStore.parse(JSONObject(json))
        } catch (e: Exception) {
          Log.w(TAG, "bad config: ${e.message}"); return
        }
        ForwarderConfigStore.save(context, cfg)
        ForwarderService.refresh(context)
        ConnectionManager.applyConfig(cfg)
        Log.i(TAG, "config applied: ${cfg.enabledWatches.size} watch(es)")
      }
      ACTION_INJECT_CALL -> {
        val caller = intent.getStringExtra("caller") ?: "Test"
        ConnectionManager.broadcast(WatchChar.NEW_ALERT, AnsCodec.encodeIncomingCall(caller))
        Log.i(TAG, "injected call from $caller")
      }
      ACTION_INJECT_NOTIF -> {
        // Bypasses the listener to prove the transport+render path directly.
        val title = intent.getStringExtra("title") ?: "Test"
        val body = intent.getStringExtra("body") ?: ""
        ConnectionManager.broadcast(WatchChar.NEW_ALERT, AnsCodec.encodeNotification(title, body))
        Log.i(TAG, "injected notification '$title'")
      }
      // Debug media session: lets the e2e exercise the REAL SystemMediaSource
      // path (getActiveSessions -> MediaController -> transportControls).
      ACTION_MEDIA_START -> DebugMediaSession.start(context)
      ACTION_MEDIA_SET -> DebugMediaSession.set(
        artist = intent.getStringExtra("artist") ?: "",
        track = intent.getStringExtra("track") ?: "",
        album = intent.getStringExtra("album") ?: "",
        durationS = intent.getIntExtra("duration", 0).toLong(),
        positionS = intent.getIntExtra("position", 0).toLong(),
        isPlaying = intent.getIntExtra("playing", 1) != 0,
      )
      ACTION_MEDIA_QUERY -> {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val vol = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
        Log.i(TAG, "media query: commands=${DebugMediaSession.query()} volume=$vol nowPlaying=${ConnectionManager.musicBridge()?.nowPlaying()}")
      }
      ACTION_MEDIA_STOP -> DebugMediaSession.stop()
    }
  }
}
