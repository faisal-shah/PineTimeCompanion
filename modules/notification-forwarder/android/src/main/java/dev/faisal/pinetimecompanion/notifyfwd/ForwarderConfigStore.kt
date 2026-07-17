package dev.faisal.pinetimecompanion.notifyfwd

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class EnabledWatch(val deviceId: String, val name: String)

data class ForwarderConfig(
  val enabledWatches: List<EnabledWatch> = emptyList(),
  val allowedPackages: Set<String> = emptySet(),
  val forwardCalls: Boolean = true,
)

/**
 * Persists the forwarder config as one JSON blob in SharedPreferences so the
 * services and BootReceiver can read it after the JS runtime is gone (process
 * death, reboot). JS pushes it via NotificationForwarderModule.setConfig.
 */
object ForwarderConfigStore {
  private const val PREFS = "notification_forwarder"
  private const val KEY = "config/v1"

  fun load(context: Context): ForwarderConfig {
    val raw = prefs(context).getString(KEY, null) ?: return ForwarderConfig()
    return try {
      parse(JSONObject(raw))
    } catch (_: Exception) {
      ForwarderConfig()
    }
  }

  fun save(context: Context, config: ForwarderConfig) {
    prefs(context).edit().putString(KEY, serialize(config).toString()).apply()
  }

  fun serialize(config: ForwarderConfig): JSONObject {
    val watches = JSONArray()
    for (w in config.enabledWatches) {
      watches.put(JSONObject().put("deviceId", w.deviceId).put("name", w.name))
    }
    val pkgs = JSONArray()
    for (p in config.allowedPackages) pkgs.put(p)
    return JSONObject()
      .put("enabledWatches", watches)
      .put("allowedPackages", pkgs)
      .put("forwardCalls", config.forwardCalls)
  }

  fun parse(json: JSONObject): ForwarderConfig {
    val watches = mutableListOf<EnabledWatch>()
    json.optJSONArray("enabledWatches")?.let { arr ->
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        watches += EnabledWatch(o.getString("deviceId"), o.optString("name", ""))
      }
    }
    val pkgs = mutableSetOf<String>()
    json.optJSONArray("allowedPackages")?.let { arr ->
      for (i in 0 until arr.length()) pkgs += arr.getString(i)
    }
    return ForwarderConfig(watches, pkgs, json.optBoolean("forwardCalls", true))
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
