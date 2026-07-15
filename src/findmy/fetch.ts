// Fetch encrypted location reports from Apple for a set of hashed advertisement
// key ids. Port of FindMy.py's fetch_raw_reports, with the older acsnservice
// endpoint as a fallback for accounts still served by it.
//
// Auth is HTTP Basic (dsid, searchPartyToken) plus fresh anisette headers. The
// id list is the watch's hashed key id(s) — one today, but the signature takes
// a set so rotating keys need no change here.

import { Buffer } from 'buffer';
import { getAnisette, buildHeaders } from './apple/anisette';
import { AppleSession } from './apple/session';

const PRIMARY_ENDPOINT = 'https://gateway.icloud.com/findmyservice/v2/fetch';
const FALLBACK_ENDPOINT = 'https://gateway.icloud.com/acsnservice/fetch';
const MAX_IDS_PER_REQUEST = 290;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface RawReport {
  /** base64 SHA-256 of the advertisement public key — matches a provisioned key. */
  hashedKeyId: string;
  /** base64 encrypted report payload. */
  payloadB64: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function authHeaders(session: AppleSession, anisette: Awaited<ReturnType<typeof getAnisette>>): Record<string, string> {
  return {
    Authorization: 'Basic ' + Buffer.from(`${session.dsid}:${session.searchPartyToken}`).toString('base64'),
    'Content-Type': 'application/json',
    ...buildHeaders(anisette, session.identity),
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  // Apple occasionally returns HTTP 200 with an empty body (FindMy.py #185); retry.
  let attempt = 0;
  for (;;) {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (resp.status !== 200) {
      return resp;
    }
    const text = await resp.clone().text();
    if (text.trim()) {
      return resp;
    }
    if (attempt >= 4) {
      return resp;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    attempt += 1;
  }
}

async function fetchPrimary(
  ids: string[],
  session: AppleSession,
  anisette: Awaited<ReturnType<typeof getAnisette>>,
): Promise<RawReport[]> {
  const now = Date.now();
  const out: RawReport[] = [];
  for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
    const body = {
      clientContext: { clientBundleIdentifier: 'com.apple.icloud.searchpartyuseragent', policy: 'foregroundClient' },
      fetch: [
        {
          ownedDeviceIds: [],
          keyType: 1,
          startDate: now - WINDOW_MS,
          startDateSecondary: now - WINDOW_MS,
          endDate: now,
          primaryIds: batch,
          secondaryIds: [],
        },
      ],
    };
    const resp = await postJson(PRIMARY_ENDPOINT, authHeaders(session, anisette), body);
    if (resp.status === 401) {
      throw new UnauthorizedError();
    }
    if (!resp.ok) {
      throw new Error(`report fetch failed: HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as any;
    const payloads = json?.acsnLocations?.locationPayload ?? [];
    for (const entry of payloads) {
      for (const payloadB64 of entry.locationInfo ?? []) {
        out.push({ hashedKeyId: entry.id, payloadB64 });
      }
    }
  }
  return out;
}

async function fetchFallback(
  ids: string[],
  session: AppleSession,
  anisette: Awaited<ReturnType<typeof getAnisette>>,
): Promise<RawReport[]> {
  const out: RawReport[] = [];
  for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
    const resp = await postJson(FALLBACK_ENDPOINT, authHeaders(session, anisette), {
      search: [{ startDate: 1, ids: batch }],
    });
    if (resp.status === 401) {
      throw new UnauthorizedError();
    }
    if (!resp.ok) {
      throw new Error(`report fetch (fallback) failed: HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as any;
    for (const r of json?.results ?? []) {
      out.push({ hashedKeyId: r.id, payloadB64: r.payload });
    }
  }
  return out;
}

/** Thrown when the search-party token is no longer valid (needs re-login). */
export class UnauthorizedError extends Error {
  constructor() {
    super('Apple session expired — please sign in again.');
    this.name = 'UnauthorizedError';
  }
}

/** Fetch raw encrypted reports for the given hashed key ids. */
export async function fetchReports(ids: string[], session: AppleSession, overrides?: string[]): Promise<RawReport[]> {
  if (ids.length === 0) {
    return [];
  }
  const anisette = await getAnisette(overrides);
  try {
    return await fetchPrimary(ids, session, anisette);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      throw e;
    }
    // The primary endpoint moved for some accounts; try the legacy one before giving up.
    return await fetchFallback(ids, session, anisette);
  }
}
