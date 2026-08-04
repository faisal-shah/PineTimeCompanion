// UUIDs for the InfiniTime Beacon (Find My) Service (doc/BeaconService.md).
// Used only in normal/connectable mode to provision the advertisement key and
// optionally enable beacon mode. The watch does no crypto; it just stores and
// broadcasts the 28-byte key.

import { GATT_CHARACTERISTICS } from './generated/companionProtocol';

export const BEACON_SERVICE_UUID = GATT_CHARACTERISTICS.beaconKey.service;
export const BEACON_KEY_CHAR_UUID = GATT_CHARACTERISTICS.beaconKey.characteristic;
export const BEACON_CONTROL_CHAR_UUID = GATT_CHARACTERISTICS.beaconControl.characteristic;

/** Control-characteristic command: enable beacon mode now (watch goes non-connectable). */
export const BEACON_CONTROL_ENABLE = 0x01;
