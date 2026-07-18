package dev.faisal.pinetimecompanion.notifyfwd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicBridgeTest {
  private class FakeSource : MediaSource {
    val commands = mutableListOf<String>()
    var listener: MediaSource.Listener? = null
    override fun start(listener: MediaSource.Listener) { this.listener = listener }
    override fun stop() { listener = null }
    override fun play() { commands += "play" }
    override fun pause() { commands += "pause" }
    override fun next() { commands += "next" }
    override fun previous() { commands += "previous" }
    override fun adjustVolume(up: Boolean) { commands += if (up) "vol+" else "vol-" }
  }

  private class Recorder {
    val writes = mutableListOf<Pair<WatchChar, ByteArray>>()
    fun writer(char: WatchChar, bytes: ByteArray) { writes += char to bytes }
    fun of(char: WatchChar) = writes.filter { it.first == char }
    fun clear() = writes.clear()
  }

  private fun harness(clockMs: () -> Long = { 0L }): Triple<MusicBridge, FakeSource, Recorder> {
    val source = FakeSource()
    val rec = Recorder()
    val bridge = MusicBridge(rec::writer, source, clockMs)
    bridge.start()
    return Triple(bridge, source, rec)
  }

  @Test
  fun `track metadata writes all changed chars`() {
    val (_, source, rec) = harness()
    source.listener!!.onTrack("Queen", "Bohemian Rhapsody", "A Night at the Opera", 354)
    val chars = rec.writes.map { it.first }
    assertTrue(WatchChar.MUSIC_ARTIST in chars)
    assertTrue(WatchChar.MUSIC_TRACK in chars)
    assertTrue(WatchChar.MUSIC_ALBUM in chars)
    assertTrue(WatchChar.MUSIC_TOTAL_LENGTH in chars)
    assertEquals("Queen", String(rec.of(WatchChar.MUSIC_ARTIST).last().second))
  }

  @Test
  fun `unchanged values are not rewritten (change detection)`() {
    val (_, source, rec) = harness()
    source.listener!!.onTrack("Queen", "Track A", "Album", 300)
    rec.clear()
    source.listener!!.onTrack("Queen", "Track B", "Album", 300)
    // Artist/album/length unchanged -> only the track rewrites.
    assertEquals(0, rec.of(WatchChar.MUSIC_ARTIST).size)
    assertEquals(0, rec.of(WatchChar.MUSIC_ALBUM).size)
    assertEquals(0, rec.of(WatchChar.MUSIC_TOTAL_LENGTH).size)
    assertEquals(1, rec.of(WatchChar.MUSIC_TRACK).size)
    assertEquals("Track B", String(rec.of(WatchChar.MUSIC_TRACK).last().second))
  }

  @Test
  fun `position within 2s of watch extrapolation is skipped, seeks rewrite`() {
    var now = 0L
    val (_, source, rec) = harness { now }
    source.listener!!.onPlayback(playing = true, positionSeconds = 10, speedX100 = 100)
    assertEquals(1, rec.of(WatchChar.MUSIC_POSITION).size) // first anchor

    now += 5000 // watch extrapolates 10 + 5 = 15
    source.listener!!.onPlayback(playing = true, positionSeconds = 15, speedX100 = 100)
    assertEquals(1, rec.of(WatchChar.MUSIC_POSITION).size) // within tolerance, skipped

    now += 1000 // extrapolated 16
    source.listener!!.onPlayback(playing = true, positionSeconds = 200, speedX100 = 100) // seek
    assertEquals(2, rec.of(WatchChar.MUSIC_POSITION).size)
  }

  @Test
  fun `every watch event maps to the right media action`() {
    val (bridge, source, _) = harness()
    bridge.onWatchEvent(MusicCodec.EVENT_PLAY)
    bridge.onWatchEvent(MusicCodec.EVENT_PAUSE)
    bridge.onWatchEvent(MusicCodec.EVENT_NEXT)
    bridge.onWatchEvent(MusicCodec.EVENT_PREV)
    bridge.onWatchEvent(MusicCodec.EVENT_VOLUP)
    bridge.onWatchEvent(MusicCodec.EVENT_VOLDOWN)
    assertEquals(listOf("play", "pause", "next", "previous", "vol+", "vol-"), source.commands)
  }

  @Test
  fun `OPEN event and connection-ready force a full snapshot`() {
    val (bridge, source, rec) = harness()
    source.listener!!.onTrack("A", "T", "L", 100)
    source.listener!!.onPlayback(true, 5, 100)
    rec.clear()

    bridge.onWatchEvent(MusicCodec.EVENT_OPEN) // watch opened the Music app
    assertTrue(rec.of(WatchChar.MUSIC_ARTIST).isNotEmpty()) // rewritten despite no change
    assertTrue(rec.of(WatchChar.MUSIC_STATUS).isNotEmpty())

    rec.clear()
    bridge.onConnectionReady() // watch reconnected (maybe rebooted)
    assertTrue(rec.of(WatchChar.MUSIC_TRACK).isNotEmpty())
  }

  @Test
  fun `session gone writes Status=0 and clears nowPlaying`() {
    val (bridge, source, rec) = harness()
    source.listener!!.onTrack("A", "T", "L", 100)
    source.listener!!.onPlayback(true, 0, 100)
    rec.clear()
    source.listener!!.onSessionGone()
    val status = rec.of(WatchChar.MUSIC_STATUS)
    assertEquals(1, status.size)
    assertEquals(0, status.last().second[0].toInt())
    assertNull(bridge.nowPlaying())
  }

  @Test
  fun `nowPlaying reflects the session`() {
    val (bridge, source, _) = harness()
    assertNull(bridge.nowPlaying())
    source.listener!!.onTrack("Queen", "Bo Rhap", "Opera", 354)
    source.listener!!.onPlayback(true, 10, 100)
    assertEquals(Triple("Queen", "Bo Rhap", true), bridge.nowPlaying())
  }

  @Test
  fun `no writes before any session appears`() {
    val (bridge, _, rec) = harness()
    bridge.onConnectionReady()
    assertEquals(0, rec.writes.size)
  }
}
