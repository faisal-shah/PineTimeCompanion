package dev.faisal.pinetimecompanion.notifyfwd

/**
 * The pure core of music control: glue between a [MediaSource] (phone media)
 * and the watch MusicService. Phone-side: tracks desired state, writes only
 * chars whose encoded value changed (positions within +/-2s of what the watch
 * extrapolates are skipped). Watch-side: dispatches control events to the
 * MediaSource; an OPEN event (or a fresh connection) forces a full snapshot,
 * because the watch may have rebooted or just entered the Music app.
 *
 * Deterministic and JUnit-tested: the writer, source, and clock are injected.
 * Thread-safety via a single lock — callbacks arrive from binder/handler
 * threads; writes go to the serialized per-connection queues downstream.
 */
class MusicBridge(
  private val writer: (WatchChar, ByteArray) -> Unit,
  private val source: MediaSource,
  private val clock: () -> Long = System::currentTimeMillis,
  private val onNowPlayingChanged: (Triple<String, String, Boolean>?) -> Unit = {},
) : MediaSource.Listener {
  private val lock = Any()

  // Desired state (what the phone's media session says).
  private var artist = ""
  private var track = ""
  private var album = ""
  private var durationS = 0L
  private var playing = false
  private var positionS = 0L
  private var speedX100 = 100L
  private var hasSession = false

  // Last written bytes per char (null = never written / cache cleared).
  private val sent = HashMap<WatchChar, ByteArray>()
  // Watch-side position extrapolation anchor for the +/-2s skip.
  private var anchorPositionS = -1L
  private var anchorAtMs = 0L
  private var anchorPlaying = false

  fun start() {
    source.start(this)
  }

  fun stop() {
    source.stop()
    synchronized(lock) { sent.clear() }
  }

  /** Now-playing summary for the companion UI, or null when idle. */
  fun nowPlaying(): Triple<String, String, Boolean>? = synchronized(lock) {
    if (!hasSession) null else Triple(artist, track, playing)
  }

  // --- MediaSource.Listener (phone -> watch) ---

  override fun onTrack(artist: String, track: String, album: String, durationSeconds: Long) {
    synchronized(lock) {
      hasSession = true
      this.artist = artist
      this.track = track
      this.album = album
      this.durationS = durationSeconds
      flushLocked()
    }
    onNowPlayingChanged(nowPlaying())
  }

  override fun onPlayback(playing: Boolean, positionSeconds: Long, speedX100: Long) {
    synchronized(lock) {
      hasSession = true
      this.playing = playing
      this.positionS = positionSeconds
      this.speedX100 = speedX100
      flushLocked()
    }
    onNowPlayingChanged(nowPlaying())
  }

  override fun onSessionGone() {
    synchronized(lock) {
      hasSession = false
      playing = false
      artist = ""
      track = ""
      album = ""
      // Tell the watch playback stopped; keep the last track text on-screen.
      writeIfChangedLocked(WatchChar.MUSIC_STATUS, MusicCodec.encodeBool(false))
    }
    onNowPlayingChanged(null)
  }

  // --- Watch events (watch -> phone) ---

  fun onWatchEvent(event: Int) {
    when (event) {
      MusicCodec.EVENT_PLAY -> source.play()
      MusicCodec.EVENT_PAUSE -> source.pause()
      MusicCodec.EVENT_NEXT -> source.next()
      MusicCodec.EVENT_PREV -> source.previous()
      MusicCodec.EVENT_VOLUP -> source.adjustVolume(true)
      MusicCodec.EVENT_VOLDOWN -> source.adjustVolume(false)
      MusicCodec.EVENT_OPEN -> snapshot() // Music app opened: refresh everything
    }
  }

  /** A watch connection became READY (fresh link — it may have rebooted). */
  fun onConnectionReady() {
    snapshot()
  }

  private fun snapshot() {
    synchronized(lock) {
      sent.clear() // force every char to rewrite
      anchorPositionS = -1
      if (hasSession) flushLocked()
    }
  }

  // --- internals ---

  private fun flushLocked() {
    writeIfChangedLocked(WatchChar.MUSIC_STATUS, MusicCodec.encodeBool(playing))
    writeIfChangedLocked(WatchChar.MUSIC_ARTIST, MusicCodec.encodeString(artist))
    writeIfChangedLocked(WatchChar.MUSIC_TRACK, MusicCodec.encodeString(track))
    writeIfChangedLocked(WatchChar.MUSIC_ALBUM, MusicCodec.encodeString(album))
    writeIfChangedLocked(WatchChar.MUSIC_TOTAL_LENGTH, MusicCodec.encodeU32BE(durationS))
    writeIfChangedLocked(WatchChar.MUSIC_PLAYBACK_SPEED, MusicCodec.encodeU32BE(speedX100))
    maybeWritePositionLocked()
  }

  private fun maybeWritePositionLocked() {
    // The watch extrapolates position locally from its last anchor while
    // playing; only rewrite when our value drifts >2s from that extrapolation
    // (seek, track change, pause/resume).
    if (anchorPositionS >= 0 && anchorPlaying == playing) {
      val extrapolated = if (playing) {
        anchorPositionS + ((clock() - anchorAtMs) * speedX100 / 100) / 1000
      } else {
        anchorPositionS
      }
      if (kotlin.math.abs(extrapolated - positionS) <= 2) {
        return
      }
    }
    writer(WatchChar.MUSIC_POSITION, MusicCodec.encodeU32BE(positionS))
    anchorPositionS = positionS
    anchorAtMs = clock()
    anchorPlaying = playing
  }

  private fun writeIfChangedLocked(char: WatchChar, bytes: ByteArray) {
    val prev = sent[char]
    if (prev != null && prev.contentEquals(bytes)) {
      return
    }
    sent[char] = bytes
    writer(char, bytes)
  }
}
