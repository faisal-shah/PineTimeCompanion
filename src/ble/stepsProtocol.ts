// InfiniTime MotionService step-count characteristic (00030001). The read value
// is today's cumulative step count as a uint32 little-endian. The watch keeps
// only today+yesterday in RAM, so the companion stores the durable history.

export const MOTION_SERVICE_UUID = '00030000-78fc-48fe-8e23-433b3a1942d0';
export const STEP_COUNT_CHAR_UUID = '00030001-78fc-48fe-8e23-433b3a1942d0';
export const STEP_COUNT_YESTERDAY_CHAR_UUID = '00030003-78fc-48fe-8e23-433b3a1942d0';

/** Decode the 4-byte little-endian step count. */
export function decodeStepCount(bytes: Uint8Array): number {
  if (bytes.length < 4) {
    throw new Error(`step count blob too short (${bytes.length} bytes)`);
  }
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}
