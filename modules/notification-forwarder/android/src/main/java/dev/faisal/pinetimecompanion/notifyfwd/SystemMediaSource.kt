package dev.faisal.pinetimecompanion.notifyfwd

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.HandlerThread
import android.util.Log

/**
 * Production [MediaSource]: follows the phone's active media sessions via
 * MediaSessionManager (allowed because our NotificationListenerService is
 * granted) and relays metadata/playback to the listener; transport commands go
 * to the active session's controls, volume to STREAM_MUSIC.
 *
 * Thin framework adapter — reviewed, not unit-tested (the session-pick rule is
 * the pure [pickController] tested indirectly via MusicBridgeTest patterns).
 */
class SystemMediaSource(private val context: Context) : MediaSource {
  private companion object {
    const val TAG = "NotifyFwd/Media"
    const val REPICK_WINDOW_MS = 300L
  }

  private val thread = HandlerThread("NotifyFwdMedia").apply { start() }
  private val handler = Handler(thread.looper)
  private var listener: MediaSource.Listener? = null
  private var controller: MediaController? = null
  // Thin watchers on EVERY session: a playback-state change on a non-followed
  // session (e.g. another app starts playing) must trigger a re-pick, because
  // OnActiveSessionsChanged only fires for list changes, not state changes.
  private val watched = HashMap<android.media.session.MediaSession.Token, MediaController>()
  private var manager: MediaSessionManager? = null
  private var component: ComponentName? = null

  private val repickCallback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) {
      requestRepick()
    }
  }

  // onPlaybackStateChanged fires continuously while anything is playing — a
  // video player re-publishes state as its position advances. repick() calls
  // MediaSessionManager.getActiveSessions, which is a binder round trip into
  // system_server that builds a controller per session, so running it per
  // callback puts sustained load on the whole device rather than just this app.
  // Coalesce to one repick per window; a re-pick that lands 300 ms late is
  // invisible, since it only decides which session we follow.
  private var repickPending = false

  private fun requestRepick() {
    if (repickPending) return
    repickPending = true
    handler.postDelayed({
      repickPending = false
      repick()
    }, REPICK_WINDOW_MS)
  }

  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { sessions ->
    val list = sessions ?: emptyList()
    Log.i(TAG, "sessions changed: ${list.joinToString { it.packageName + "/" + (it.playbackState?.state ?: -1) }}")
    updateWatchers(list)
    adopt(pickController(list))
  }

  private fun updateWatchers(list: List<MediaController>) {
    val tokens = list.map { it.sessionToken }.toSet()
    val stale = watched.keys - tokens
    for (t in stale) watched.remove(t)?.unregisterCallback(repickCallback)
    for (c in list) {
      if (watched.putIfAbsent(c.sessionToken, c) == null) {
        c.registerCallback(repickCallback, handler)
      }
    }
  }

  private fun repick() {
    val mgr = manager ?: return
    val comp = component ?: return
    try {
      adopt(pickController(mgr.getActiveSessions(comp)))
    } catch (_: SecurityException) {
    }
  }

  private val controllerCallback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) {
      Log.i(TAG, "metadata changed: ${metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)}")
      pushMetadata(metadata)
    }

    override fun onPlaybackStateChanged(state: PlaybackState?) {
      pushPlayback(state)
    }

    override fun onSessionDestroyed() {
      adopt(null)
    }
  }

  override fun start(listener: MediaSource.Listener) {
    this.listener = listener
    val mgr = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    val comp = ComponentName(context, NotifListenerService::class.java)
    manager = mgr
    component = comp
    try {
      mgr.addOnActiveSessionsChangedListener(sessionsChanged, comp, handler)
      val sessions = mgr.getActiveSessions(comp)
      Log.i(TAG, "started; ${sessions.size} active session(s): ${sessions.joinToString { it.packageName }}")
      updateWatchers(sessions)
      adopt(pickController(sessions))
    } catch (e: SecurityException) {
      // Notification access revoked; forwarding is equally dead, so just idle.
      Log.w(TAG, "no media session access: ${e.message}")
    }
  }

  override fun stop() {
    try {
      (context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager)
        .removeOnActiveSessionsChangedListener(sessionsChanged)
    } catch (_: Exception) {
    }
    for ((_, c) in watched) c.unregisterCallback(repickCallback)
    watched.clear()
    adopt(null)
    listener = null
  }

  /** PLAYING first; else a session with a real playback state (assistant/system
   *  sessions often sit at the priority head with STATE_NONE); else the head. */
  private fun pickController(sessions: List<MediaController>): MediaController? =
    sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
      ?: sessions.firstOrNull { (it.playbackState?.state ?: PlaybackState.STATE_NONE) != PlaybackState.STATE_NONE }
      ?: sessions.firstOrNull()

  private fun adopt(next: MediaController?) {
    val prev = controller
    if (prev?.sessionToken == next?.sessionToken) {
      return
    }
    prev?.unregisterCallback(controllerCallback)
    controller = next
    if (next == null) {
      Log.i(TAG, "no active media session")
      listener?.onSessionGone()
      return
    }
    Log.i(TAG, "following media session of ${next.packageName}")
    next.registerCallback(controllerCallback, handler)
    pushMetadata(next.metadata)
    pushPlayback(next.playbackState)
  }

  private fun pushMetadata(metadata: MediaMetadata?) {
    if (metadata == null) return
    listener?.onTrack(
      metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)
        ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: "",
      metadata.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "",
      metadata.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "",
      metadata.getLong(MediaMetadata.METADATA_KEY_DURATION) / 1000,
    )
  }

  private fun pushPlayback(state: PlaybackState?) {
    if (state == null) return
    val speed = if (state.playbackSpeed > 0f) (state.playbackSpeed * 100).toLong() else 100L
    listener?.onPlayback(
      state.state == PlaybackState.STATE_PLAYING,
      state.position / 1000,
      speed,
    )
  }

  override fun play() {
    controller?.transportControls?.play()
  }

  override fun pause() {
    controller?.transportControls?.pause()
  }

  override fun next() {
    controller?.transportControls?.skipToNext()
  }

  override fun previous() {
    controller?.transportControls?.skipToPrevious()
  }

  override fun adjustVolume(up: Boolean) {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audio.adjustStreamVolume(
      AudioManager.STREAM_MUSIC,
      if (up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
      0,
    )
  }
}
