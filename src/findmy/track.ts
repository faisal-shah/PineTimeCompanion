// Assemble a watch's location track: fetch encrypted reports for its key(s),
// decrypt each with the matching private key, merge into the stored history, and
// return the sorted fixes. Built to work over a SET of keys (one today) so
// rotating keys need no change beyond providing more ids/keys.

import { Watch } from '../model/types';
import { getBeaconPrivateKey } from '../secure/secrets';
import { appendFixes } from '../storage/locationStore';
import { AppleSession } from './apple/session';
import { LocationFix, decryptReport } from './decrypt';
import { fetchReports } from './fetch';

export interface TrackResult {
  fixes: LocationFix[];
  /** How many encrypted reports Apple returned (before dedupe). */
  reportsFetched: number;
}

/**
 * Fetch + decrypt this watch's location reports and merge them into history.
 * Returns the full merged history (oldest → newest). Requires a provisioned
 * beacon key and a private key in the keystore.
 */
export async function getWatchLocations(
  watch: Watch,
  session: AppleSession,
  overrides?: string[],
): Promise<TrackResult> {
  if (!watch.beacon?.hashedKeyId) {
    throw new Error('This watch has no Find My key yet.');
  }
  const priv = await getBeaconPrivateKey(watch.id);
  if (!priv) {
    throw new Error('The private key for this watch is missing (it was generated on another phone).');
  }

  // hashedKeyId → private key. One entry today; a rotating set would add more.
  const keyById = new Map<string, string>([[watch.beacon.hashedKeyId, priv]]);
  const ids = Array.from(keyById.keys());

  const raw = await fetchReports(ids, session, overrides);

  const fresh: LocationFix[] = [];
  for (const report of raw) {
    const key = keyById.get(report.hashedKeyId);
    if (!key) {
      continue;
    }
    try {
      fresh.push(decryptReport(report.payloadB64, key));
    } catch {
      // Wrong key / malformed report — skip it.
    }
  }

  const fixes = await appendFixes(watch.id, fresh);
  return { fixes, reportsFetched: raw.length };
}
