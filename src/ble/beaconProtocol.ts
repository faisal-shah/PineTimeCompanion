// UUIDs for the InfiniTime Beacon (Find My) Service (doc/BeaconService.md).
// Used only in normal/connectable mode to provision the advertisement key and
// optionally enable beacon mode. The watch does no crypto; it just stores and
// broadcasts the 28-byte key.

export const BEACON_SERVICE_UUID = '00080000-78fc-48fe-8e23-433b3a1942d0';
export const BEACON_KEY_CHAR_UUID = '00080001-78fc-48fe-8e23-433b3a1942d0';
export const BEACON_CONTROL_CHAR_UUID = '00080002-78fc-48fe-8e23-433b3a1942d0';

/** Control-characteristic command: enable beacon mode now (watch goes non-connectable). */
export const BEACON_CONTROL_ENABLE = 0x01;
