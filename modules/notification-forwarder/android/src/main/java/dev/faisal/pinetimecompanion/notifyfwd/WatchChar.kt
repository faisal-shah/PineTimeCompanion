package dev.faisal.pinetimecompanion.notifyfwd

import java.util.UUID

/**
 * Watch characteristics the native forwarder talks to, with both addressings:
 * the InfiniSim bridge charId (TCP dev path) and the real GATT UUID (BLE path).
 * Bridge ids are locked to InfiniSim's sim/gatt_bridge.h enum.
 */
enum class WatchChar(val simCharId: Int, val gattUuid: UUID) {
  // Alert Notification Service.
  NEW_ALERT(GeneratedCompanionProtocol.NEW_ALERT_BRIDGE_ID, GeneratedCompanionProtocol.NEW_ALERT_UUID),
  CALL_EVENT(GeneratedCompanionProtocol.CALL_EVENT_BRIDGE_ID, GeneratedCompanionProtocol.CALL_EVENT_UUID), // notify

  // MusicService (service 00000000-78fc-...).
  MUSIC_EVENT(GeneratedCompanionProtocol.MUSIC_EVENT_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_EVENT_UUID), // notify
  MUSIC_STATUS(GeneratedCompanionProtocol.MUSIC_STATUS_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_STATUS_UUID),
  MUSIC_ARTIST(GeneratedCompanionProtocol.MUSIC_ARTIST_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_ARTIST_UUID),
  MUSIC_TRACK(GeneratedCompanionProtocol.MUSIC_TRACK_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_TRACK_UUID),
  MUSIC_ALBUM(GeneratedCompanionProtocol.MUSIC_ALBUM_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_ALBUM_UUID),
  MUSIC_POSITION(GeneratedCompanionProtocol.MUSIC_POSITION_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_POSITION_UUID),
  MUSIC_TOTAL_LENGTH(GeneratedCompanionProtocol.MUSIC_TOTAL_LENGTH_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_TOTAL_LENGTH_UUID),
  MUSIC_TRACK_NUMBER(GeneratedCompanionProtocol.MUSIC_TRACK_NUMBER_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_TRACK_NUMBER_UUID),
  MUSIC_TRACK_TOTAL(GeneratedCompanionProtocol.MUSIC_TRACK_TOTAL_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_TRACK_TOTAL_UUID),
  MUSIC_PLAYBACK_SPEED(GeneratedCompanionProtocol.MUSIC_PLAYBACK_SPEED_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_PLAYBACK_SPEED_UUID),
  MUSIC_REPEAT(GeneratedCompanionProtocol.MUSIC_REPEAT_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_REPEAT_UUID),
  MUSIC_SHUFFLE(GeneratedCompanionProtocol.MUSIC_SHUFFLE_BRIDGE_ID, GeneratedCompanionProtocol.MUSIC_SHUFFLE_UUID);

  companion object {
    val ANS_SERVICE: UUID = GeneratedCompanionProtocol.NEW_ALERT_SERVICE_UUID
    val MUSIC_SERVICE: UUID = GeneratedCompanionProtocol.MUSIC_EVENT_SERVICE_UUID

    fun bySimCharId(id: Int): WatchChar? = entries.firstOrNull { it.simCharId == id }
  }
}
