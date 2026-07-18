package dev.faisal.pinetimecompanion.notifyfwd

import java.util.UUID

/**
 * Watch characteristics the native forwarder talks to, with both addressings:
 * the InfiniSim bridge charId (TCP dev path) and the real GATT UUID (BLE path).
 * Bridge ids are locked to InfiniSim's sim/gatt_bridge.h enum.
 */
enum class WatchChar(val simCharId: Int, val gattUuid: UUID) {
  // Alert Notification Service.
  NEW_ALERT(3, uuid("00002a46-0000-1000-8000-00805f9b34fb")),
  CALL_EVENT(29, uuid("00020001-78fc-48fe-8e23-433b3a1942d0")), // notify

  // MusicService (service 00000000-78fc-...).
  MUSIC_EVENT(28, uuid("00000001-78fc-48fe-8e23-433b3a1942d0")), // notify
  MUSIC_STATUS(17, uuid("00000002-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_ARTIST(18, uuid("00000003-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_TRACK(19, uuid("00000004-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_ALBUM(20, uuid("00000005-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_POSITION(21, uuid("00000006-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_TOTAL_LENGTH(22, uuid("00000007-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_TRACK_NUMBER(23, uuid("00000008-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_TRACK_TOTAL(24, uuid("00000009-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_PLAYBACK_SPEED(25, uuid("0000000a-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_REPEAT(26, uuid("0000000b-78fc-48fe-8e23-433b3a1942d0")),
  MUSIC_SHUFFLE(27, uuid("0000000c-78fc-48fe-8e23-433b3a1942d0"));

  companion object {
    val ANS_SERVICE: UUID = uuid("00001811-0000-1000-8000-00805f9b34fb")
    val MUSIC_SERVICE: UUID = uuid("00000000-78fc-48fe-8e23-433b3a1942d0")

    fun bySimCharId(id: Int): WatchChar? = entries.firstOrNull { it.simCharId == id }
  }
}

private fun uuid(s: String): UUID = UUID.fromString(s)
