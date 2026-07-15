// Single authoritative GATT UUID map for every bridge characteristic, shared
// by BleTransport (ble-plx) and WebBluetoothTransport so the two can't drift.
// ALL_SERVICE_UUIDS doubles as the Web Bluetooth `optionalServices` whitelist —
// a service missing from that list is permanently blocked for the grant, so
// every service the app ever touches must be here.

import { BridgeCharId, BRIDGE_CHAR } from './transport';
import { SCHEDULE_SERVICE_UUID, SYNC_COMMAND_CHAR_UUID, DIGEST_CHAR_UUID, EVENT_READ_CHAR_UUID } from './scheduleProtocol';
import { PRAYER_SERVICE_UUID, PRAYER_SETTINGS_CHAR_UUID } from './prayerProtocol';
import { BEACON_SERVICE_UUID, BEACON_KEY_CHAR_UUID, BEACON_CONTROL_CHAR_UUID } from './beaconProtocol';

// Standard GATT services the companion basics use.
const CTS_SERVICE = '00001805-0000-1000-8000-00805f9b34fb';
const CTS_CURRENT_TIME = '00002a2b-0000-1000-8000-00805f9b34fb';
const ANS_SERVICE = '00001811-0000-1000-8000-00805f9b34fb';
const ANS_NEW_ALERT = '00002a46-0000-1000-8000-00805f9b34fb';
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';

export const CHAR_MAP: Record<BridgeCharId, { service: string; characteristic: string; withResponse: boolean }> = {
  [BRIDGE_CHAR.scheduleSync]: { service: SCHEDULE_SERVICE_UUID, characteristic: SYNC_COMMAND_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.scheduleDigest]: { service: SCHEDULE_SERVICE_UUID, characteristic: DIGEST_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.currentTime]: { service: CTS_SERVICE, characteristic: CTS_CURRENT_TIME, withResponse: true },
  [BRIDGE_CHAR.newAlert]: { service: ANS_SERVICE, characteristic: ANS_NEW_ALERT, withResponse: true },
  [BRIDGE_CHAR.battery]: { service: BATTERY_SERVICE, characteristic: BATTERY_LEVEL, withResponse: true },
  [BRIDGE_CHAR.eventRead]: { service: SCHEDULE_SERVICE_UUID, characteristic: EVENT_READ_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.prayerSettings]: { service: PRAYER_SERVICE_UUID, characteristic: PRAYER_SETTINGS_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.beaconKey]: { service: BEACON_SERVICE_UUID, characteristic: BEACON_KEY_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.beaconControl]: { service: BEACON_SERVICE_UUID, characteristic: BEACON_CONTROL_CHAR_UUID, withResponse: true },
};

export const ALL_SERVICE_UUIDS: string[] = [...new Set(Object.values(CHAR_MAP).map((c) => c.service))];

// Advertised name filters for scanning/chooser, one place for all platforms.
export const WATCH_NAME_PATTERN = /InfiniTime|Pinetime/i;
export const WATCH_NAME_PREFIXES = ['InfiniTime', 'Pinetime'];
