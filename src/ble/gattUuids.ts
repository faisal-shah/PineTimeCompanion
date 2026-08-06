// Single authoritative GATT UUID map for every bridge characteristic, shared
// by BleTransport (ble-plx) and WebBluetoothTransport so the two can't drift.
// ALL_SERVICE_UUIDS doubles as the Web Bluetooth `optionalServices` whitelist —
// a service missing from that list is permanently blocked for the grant, so
// every service the app ever touches must be here.

import { BridgeCharId, BRIDGE_CHAR } from './transport';
import { GATT_CHARACTERISTICS } from './generated/companionProtocol';

const spec = GATT_CHARACTERISTICS;
export const DFU_SERVICE = spec.dfuControl.service;

export const CHAR_MAP: Record<BridgeCharId, { service: string; characteristic: string; withResponse: boolean }> = {
  [BRIDGE_CHAR.scheduleSync]: { service: spec.scheduleSync.service, characteristic: spec.scheduleSync.characteristic, withResponse: true },
  [BRIDGE_CHAR.scheduleDigest]: { service: spec.scheduleDigest.service, characteristic: spec.scheduleDigest.characteristic, withResponse: true },
  [BRIDGE_CHAR.currentTime]: { service: spec.currentTime.service, characteristic: spec.currentTime.characteristic, withResponse: true },
  [BRIDGE_CHAR.newAlert]: { service: spec.newAlert.service, characteristic: spec.newAlert.characteristic, withResponse: true },
  [BRIDGE_CHAR.battery]: { service: spec.battery.service, characteristic: spec.battery.characteristic, withResponse: true },
  [BRIDGE_CHAR.eventRead]: { service: spec.eventRead.service, characteristic: spec.eventRead.characteristic, withResponse: true },
  [BRIDGE_CHAR.prayerSettings]: { service: spec.prayerSettings.service, characteristic: spec.prayerSettings.characteristic, withResponse: true },
  [BRIDGE_CHAR.beaconKey]: { service: spec.beaconKey.service, characteristic: spec.beaconKey.characteristic, withResponse: true },
  [BRIDGE_CHAR.beaconControl]: { service: spec.beaconControl.service, characteristic: spec.beaconControl.characteristic, withResponse: true },
  [BRIDGE_CHAR.multiAlarm]: { service: spec.multiAlarm.service, characteristic: spec.multiAlarm.characteristic, withResponse: true },
  [BRIDGE_CHAR.dfuControl]: { service: spec.dfuControl.service, characteristic: spec.dfuControl.characteristic, withResponse: true },
  [BRIDGE_CHAR.dfuPacket]: { service: spec.dfuPacket.service, characteristic: spec.dfuPacket.characteristic, withResponse: false },
  [BRIDGE_CHAR.fsTransfer]: { service: spec.fsTransfer.service, characteristic: spec.fsTransfer.characteristic, withResponse: true },
  [BRIDGE_CHAR.firmwareRevision]: {
    service: spec.firmwareRevision.service,
    characteristic: spec.firmwareRevision.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.weather]: { service: spec.weather.service, characteristic: spec.weather.characteristic, withResponse: true },
  [BRIDGE_CHAR.steps]: { service: spec.steps.service, characteristic: spec.steps.characteristic, withResponse: true },
  [BRIDGE_CHAR.stepsYesterday]: {
    service: spec.stepsYesterday.service,
    characteristic: spec.stepsYesterday.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicStatus]: { service: spec.musicStatus.service, characteristic: spec.musicStatus.characteristic, withResponse: true },
  [BRIDGE_CHAR.musicArtist]: { service: spec.musicArtist.service, characteristic: spec.musicArtist.characteristic, withResponse: true },
  [BRIDGE_CHAR.musicTrack]: { service: spec.musicTrack.service, characteristic: spec.musicTrack.characteristic, withResponse: true },
  [BRIDGE_CHAR.musicAlbum]: { service: spec.musicAlbum.service, characteristic: spec.musicAlbum.characteristic, withResponse: true },
  [BRIDGE_CHAR.musicPosition]: {
    service: spec.musicPosition.service,
    characteristic: spec.musicPosition.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicTotalLength]: {
    service: spec.musicTotalLength.service,
    characteristic: spec.musicTotalLength.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicTrackNumber]: {
    service: spec.musicTrackNumber.service,
    characteristic: spec.musicTrackNumber.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicTrackTotal]: {
    service: spec.musicTrackTotal.service,
    characteristic: spec.musicTrackTotal.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicPlaybackSpeed]: {
    service: spec.musicPlaybackSpeed.service,
    characteristic: spec.musicPlaybackSpeed.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicRepeat]: { service: spec.musicRepeat.service, characteristic: spec.musicRepeat.characteristic, withResponse: true },
  [BRIDGE_CHAR.musicShuffle]: {
    service: spec.musicShuffle.service,
    characteristic: spec.musicShuffle.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.musicEvent]: { service: spec.musicEvent.service, characteristic: spec.musicEvent.characteristic, withResponse: true },
  [BRIDGE_CHAR.callEvent]: { service: spec.callEvent.service, characteristic: spec.callEvent.characteristic, withResponse: true },
  [BRIDGE_CHAR.tasksSync]: { service: spec.tasksSync.service, characteristic: spec.tasksSync.characteristic, withResponse: true },
  [BRIDGE_CHAR.tasksDigest]: { service: spec.tasksDigest.service, characteristic: spec.tasksDigest.characteristic, withResponse: true },
  [BRIDGE_CHAR.taskRead]: { service: spec.taskRead.service, characteristic: spec.taskRead.characteristic, withResponse: true },
  [BRIDGE_CHAR.companionStatus]: {
    service: spec.companionStatus.service,
    characteristic: spec.companionStatus.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.companionVerify]: {
    service: spec.companionVerify.service,
    characteristic: spec.companionVerify.characteristic,
    withResponse: true,
  },
  [BRIDGE_CHAR.familyStateStatus]: {
    service: spec.familyStateStatus.service,
    characteristic: spec.familyStateStatus.characteristic,
    withResponse: true,
  },
};

// The DFU service is on the Web Bluetooth GATT blocklist; requesting it in
// `optionalServices` throws. Keep it (and DIS, which is fine) out of the Web
// Bluetooth whitelist — firmware DFU is native/sim only.
const WEB_BLOCKED_SERVICES = new Set<string>([DFU_SERVICE]);

// Web Bluetooth optionalServices whitelist — excludes blocklisted services
// (which throw if requested). Native BLE has no such restriction.
export const ALL_SERVICE_UUIDS: string[] = [
  ...new Set(Object.values(CHAR_MAP).map((c) => c.service).filter((s) => !WEB_BLOCKED_SERVICES.has(s))),
];

// Advertised name filters for scanning/chooser, one place for all platforms.
export const WATCH_NAME_PATTERN = /InfiniTime|Pinetime/i;
export const WATCH_NAME_PREFIXES = ['InfiniTime', 'Pinetime'];
