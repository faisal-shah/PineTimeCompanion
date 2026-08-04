// InfiniTime MotionService step-count characteristic (00030001). The read value
// is today's cumulative step count as a uint32 little-endian. The watch keeps
// only today+yesterday in RAM, so the companion stores the durable history.

import { GATT_CHARACTERISTICS } from './generated/companionProtocol';

export const MOTION_SERVICE_UUID = GATT_CHARACTERISTICS.steps.service;
export const STEP_COUNT_CHAR_UUID = GATT_CHARACTERISTICS.steps.characteristic;
export const STEP_COUNT_YESTERDAY_CHAR_UUID = GATT_CHARACTERISTICS.stepsYesterday.characteristic;

/** Decode the 4-byte little-endian step count. */
export function decodeStepCount(bytes: Uint8Array): number {
  if (bytes.length < 4) {
    throw new Error(`step count blob too short (${bytes.length} bytes)`);
  }
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}
