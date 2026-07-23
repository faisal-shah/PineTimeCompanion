// Single authoritative GATT UUID map for every bridge characteristic, shared
// by BleTransport (ble-plx) and WebBluetoothTransport so the two can't drift.
// ALL_SERVICE_UUIDS doubles as the Web Bluetooth `optionalServices` whitelist —
// a service missing from that list is permanently blocked for the grant, so
// every service the app ever touches must be here.

import { BridgeCharId, BRIDGE_CHAR } from './transport';
import { SCHEDULE_SERVICE_UUID, SYNC_COMMAND_CHAR_UUID, DIGEST_CHAR_UUID, EVENT_READ_CHAR_UUID } from './scheduleProtocol';
import { PRAYER_SERVICE_UUID, PRAYER_SETTINGS_CHAR_UUID } from './prayerProtocol';
import { BEACON_SERVICE_UUID, BEACON_KEY_CHAR_UUID, BEACON_CONTROL_CHAR_UUID } from './beaconProtocol';
import { MULTIALARM_SERVICE_UUID, MULTIALARM_CHAR_UUID } from './multiAlarmProtocol';
import { WEATHER_SERVICE_UUID, WEATHER_CHAR_UUID } from './weatherProtocol';
import { MOTION_SERVICE_UUID, STEP_COUNT_CHAR_UUID, STEP_COUNT_YESTERDAY_CHAR_UUID } from './stepsProtocol';
import { TASK_SERVICE_UUID, TASK_SYNC_CHAR_UUID, TASK_DIGEST_CHAR_UUID, TASK_READ_CHAR_UUID } from './tasksProtocol';

// Standard GATT services the companion basics use.
const CTS_SERVICE = '00001805-0000-1000-8000-00805f9b34fb';
const CTS_CURRENT_TIME = '00002a2b-0000-1000-8000-00805f9b34fb';
const ANS_SERVICE = '00001811-0000-1000-8000-00805f9b34fb';
const ANS_NEW_ALERT = '00002a46-0000-1000-8000-00805f9b34fb';
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';

// OTA update surface. DFU is the Nordic-legacy service (blocklisted in real Web
// Bluetooth — reachable only over native BLE or the sim bridge). FS is the
// Adafruit BLE filesystem. DIS carries the firmware version string.
const DFU_SERVICE = '00001530-1212-efde-1523-785feabcd123';
const DFU_CONTROL_POINT = '00001531-1212-efde-1523-785feabcd123';
const DFU_PACKET = '00001532-1212-efde-1523-785feabcd123';
const FS_SERVICE = '0000febb-0000-1000-8000-00805f9b34fb';
const FS_TRANSFER = 'adaf0200-4669-6c65-5472-616e73666572';
const DIS_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const DIS_FIRMWARE_REVISION = '00002a26-0000-1000-8000-00805f9b34fb';

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
  [BRIDGE_CHAR.multiAlarm]: { service: MULTIALARM_SERVICE_UUID, characteristic: MULTIALARM_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.dfuControl]: { service: DFU_SERVICE, characteristic: DFU_CONTROL_POINT, withResponse: true },
  [BRIDGE_CHAR.dfuPacket]: { service: DFU_SERVICE, characteristic: DFU_PACKET, withResponse: false },
  [BRIDGE_CHAR.fsTransfer]: { service: FS_SERVICE, characteristic: FS_TRANSFER, withResponse: true },
  [BRIDGE_CHAR.firmwareRevision]: { service: DIS_SERVICE, characteristic: DIS_FIRMWARE_REVISION, withResponse: true },
  [BRIDGE_CHAR.weather]: { service: WEATHER_SERVICE_UUID, characteristic: WEATHER_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.steps]: { service: MOTION_SERVICE_UUID, characteristic: STEP_COUNT_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.stepsYesterday]: { service: MOTION_SERVICE_UUID, characteristic: STEP_COUNT_YESTERDAY_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.tasksSync]: { service: TASK_SERVICE_UUID, characteristic: TASK_SYNC_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.tasksDigest]: { service: TASK_SERVICE_UUID, characteristic: TASK_DIGEST_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.taskRead]: { service: TASK_SERVICE_UUID, characteristic: TASK_READ_CHAR_UUID, withResponse: true },
};

// The DFU service is on the Web Bluetooth GATT blocklist; requesting it in
// `optionalServices` throws. Keep it (and DIS, which is fine) out of the Web
// Bluetooth whitelist — firmware DFU is native/sim only.
const WEB_BLOCKED_SERVICES = new Set([DFU_SERVICE]);

// Web Bluetooth optionalServices whitelist — excludes blocklisted services
// (which throw if requested). Native BLE has no such restriction.
export const ALL_SERVICE_UUIDS: string[] = [
  ...new Set(Object.values(CHAR_MAP).map((c) => c.service).filter((s) => !WEB_BLOCKED_SERVICES.has(s))),
];

// Advertised name filters for scanning/chooser, one place for all platforms.
export const WATCH_NAME_PATTERN = /InfiniTime|Pinetime/i;
export const WATCH_NAME_PREFIXES = ['InfiniTime', 'Pinetime'];
