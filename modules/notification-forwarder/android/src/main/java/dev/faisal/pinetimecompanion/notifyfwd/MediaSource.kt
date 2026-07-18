package dev.faisal.pinetimecompanion.notifyfwd

/**
 * Seam between the music bridge and Android's media stack. The production
 * implementation is [SystemMediaSource] (MediaSessionManager/MediaController);
 * tests use a fake; debug builds can host a real MediaSession via
 * DebugMediaSession. All callbacks may arrive on any thread.
 */
interface MediaSource {
  interface Listener {
    fun onTrack(artist: String, track: String, album: String, durationSeconds: Long)
    fun onPlayback(playing: Boolean, positionSeconds: Long, speedX100: Long)
    fun onSessionGone()
  }

  fun start(listener: Listener)
  fun stop()

  fun play()
  fun pause()
  fun next()
  fun previous()
  fun adjustVolume(up: Boolean)
}
