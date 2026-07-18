package dev.faisal.pinetimecompanion.notifyfwd

import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.util.Log

/**
 * Debug-only: hosts a REAL android.media.session.MediaSession so the emulator
 * e2e can exercise the genuine SystemMediaSource path (getActiveSessions ->
 * MediaController -> callbacks -> transportControls) with zero hardware. Every
 * transport command the session receives is logged (tag NotifyFwd/DebugMedia)
 * and recorded for MEDIA_QUERY. Instantiated only from the debug receiver
 * (FLAG_DEBUGGABLE-guarded there).
 */
object DebugMediaSession {
  private const val TAG = "NotifyFwd/DebugMedia"

  private var session: MediaSession? = null
  private val received = mutableListOf<String>()
  private var playing = false
  private var positionMs = 0L

  @Synchronized
  fun start(context: Context) {
    if (session != null) return
    session = MediaSession(context.applicationContext, "NotifyFwdDebug").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = record("play")
        override fun onPause() = record("pause")
        override fun onSkipToNext() = record("skipToNext")
        override fun onSkipToPrevious() = record("skipToPrevious")
      })
      isActive = true
    }
    publishState() // give the session a real state so the pick can prefer it
    Log.i(TAG, "debug media session started")
  }

  @Synchronized
  fun set(artist: String, track: String, album: String, durationS: Long, positionS: Long, isPlaying: Boolean) {
    playing = isPlaying
    positionMs = positionS * 1000
    session?.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
        .putString(MediaMetadata.METADATA_KEY_TITLE, track)
        .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
        .putLong(MediaMetadata.METADATA_KEY_DURATION, durationS * 1000)
        .build(),
    )
    publishState()
    Log.i(TAG, "debug media set: $artist - $track (${durationS}s, playing=$isPlaying)")
  }

  @Synchronized
  fun query(): List<String> = received.toList()

  @Synchronized
  fun stop() {
    session?.release()
    session = null
    received.clear()
  }

  private fun record(cmd: String) {
    synchronized(this) {
      received.add(cmd)
      // Reflect the command in the session state so SystemMediaSource sees the
      // change (like a real player would).
      when (cmd) {
        "play" -> playing = true
        "pause" -> playing = false
      }
      publishState()
    }
    Log.i(TAG, "received transport command: $cmd")
  }

  private fun publishState() {
    session?.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS,
        )
        .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, positionMs, 1.0f)
        .build(),
    )
  }
}
