// Deciding whether a scan result is one of our watches.
//
// The watch cannot fit its name in the advertisement: 31 bytes are already
// spent on flags, the heart-rate UUID, the 128-bit DFU UUID and TX power. The
// name therefore rides in the *scan response*, a second packet the scanner only
// receives if it happens to be listening at the right moment.
//
// Matching on the name alone made discovery a coin flip. Android's default scan
// mode duty-cycles, so a watch is routinely reported with no name at all --
// and with duplicate reports suppressed, that first nameless sighting was the
// only one, so the watch never appeared. Resetting it made discovery work only
// because a freshly booted watch advertises every 20 ms instead of every
// second, which makes catching the scan response near-certain.
//
// The service UUID is in the advertisement itself, so it is there on the first
// packet, every time. Name matching stays as a fallback rather than a
// requirement.

import { DFU_SERVICE, WATCH_NAME_PATTERN } from './gattUuids';

/** What a scan reports; only the fields that decide the match. */
export interface ScanResultLike {
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
}

/** Shown when the scan response has not arrived yet, so the row is still usable. */
export const UNNAMED_WATCH = 'PineTime';

export function advertisesWatchService(result: ScanResultLike): boolean {
  const wanted = DFU_SERVICE.toLowerCase();
  return (result.serviceUUIDs ?? []).some(uuid => uuid.toLowerCase() === wanted);
}

export function isWatchAdvertisement(result: ScanResultLike): boolean {
  if (advertisesWatchService(result)) {
    return true;
  }
  const name = result.name ?? result.localName ?? '';
  return name !== '' && WATCH_NAME_PATTERN.test(name);
}

/** The label to show, which may be a placeholder until the scan response lands. */
export function watchDisplayName(result: ScanResultLike): string {
  return result.name ?? result.localName ?? UNNAMED_WATCH;
}
