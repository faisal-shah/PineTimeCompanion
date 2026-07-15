// Anisette headers for Apple GrandSlam, sourced from PUBLIC anisette-v3 servers
// over HTTPS (no on-device generation, no native code). We only trust two fields
// from the server (X-Apple-I-MD, X-Apple-I-MD-M) and synthesize the rest locally,
// exactly like FindMy.py / macless-haystack.
//
// Session-persistence note: the device identity (deviceId + userId UUIDs) is the
// fingerprint Apple ties "this device is trusted" to. It is generated ONCE and
// kept in AsyncStorage, separate from the session tokens, so it survives sign-out
// and re-login — that is what stops Apple from re-prompting SMS 2FA every time.
// We also remember the last anisette server that worked and prefer it, to keep
// the machine identity as stable as we can across logins.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';

const DEVICE_KEY = 'pinetime-companion/apple-device/v1';
const LAST_SERVER_KEY = 'pinetime-companion/apple-anisette-server/v1';

/** SideStore public anisette-v3 servers (https only). Fetched live too; this is the fallback. */
export const DEFAULT_ANISETTE_SERVERS = [
  'https://ani.sidestore.io',
  'https://ani.sidestore.app',
  'https://ani.sidestore.zip',
  'https://ani3server.fly.dev',
  'https://anisette.crystall1ne.dev',
];

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/SideStore/anisette-servers/main/servers.json';

export interface AnisetteData {
  /** X-Apple-I-MD — the anisette one-time password (base64). */
  md: string;
  /** X-Apple-I-MD-M — the anisette machine id (base64). */
  machine: string;
}

export interface DeviceIdentity {
  /** Stable per-install UUID → X-Mme-Device-Id (uppercased). */
  deviceId: string;
  /** Stable per-install UUID → X-Apple-I-MD-LU (base64 of this). */
  userId: string;
}

function uuid4(): string {
  const b = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Load the stable device identity, generating + persisting it once. Never rotates. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const raw = await AsyncStorage.getItem(DEVICE_KEY);
  if (raw) {
    return JSON.parse(raw) as DeviceIdentity;
  }
  const identity: DeviceIdentity = { deviceId: uuid4(), userId: uuid4() };
  await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(identity));
  return identity;
}

async function serverCandidates(overrides?: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (url?: string | null) => {
    if (!url) return;
    const u = url.trim().replace(/\/+$/, '');
    if (u.startsWith('https://') && !seen.has(u)) {
      seen.add(u);
      ordered.push(u);
    }
  };

  add(await AsyncStorage.getItem(LAST_SERVER_KEY)); // prefer last-good for identity stability
  overrides?.forEach(add); // user setting (§ FindMySettings)
  DEFAULT_ANISETTE_SERVERS.forEach(add);
  // Best-effort live list merge; ignore failures.
  try {
    const r = await fetchWithTimeout(SERVER_LIST_URL, {}, 5000);
    if (r.ok) {
      const json = (await r.json()) as { servers?: { address?: string }[] };
      json.servers?.forEach((s) => add(s.address));
    }
  } catch {
    /* offline or list down — the defaults still stand */
  }
  return ordered;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Fetch anisette from the first responsive server; remembers the one that worked. */
export async function getAnisette(overrides?: string[]): Promise<AnisetteData> {
  const candidates = await serverCandidates(overrides);
  let lastErr: unknown;
  for (const server of candidates) {
    try {
      const r = await fetchWithTimeout(server, { headers: { Accept: 'application/json' } }, 5000);
      if (!r.ok) {
        continue;
      }
      const data = (await r.json()) as Record<string, string>;
      const md = data['X-Apple-I-MD'];
      const machine = data['X-Apple-I-MD-M'];
      if (md && machine) {
        await AsyncStorage.setItem(LAST_SERVER_KEY, server);
        return { md, machine };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`No anisette server responded (${candidates.length} tried)${lastErr ? `: ${lastErr}` : ''}`);
}

const CLIENT_INFO = '<MacBookPro18,3> <Mac OS X;13.4.1;22F8> <com.apple.AOSKit/282 (com.apple.dt.Xcode/3594.4.19)>';

/** The full anisette header set forwarded to Apple. */
export function buildHeaders(
  anisette: AnisetteData,
  identity: DeviceIdentity,
  opts: { withClientInfo?: boolean } = {},
): Record<string, string> {
  const now = new Date();
  now.setMilliseconds(0);
  const headers: Record<string, string> = {
    'X-Apple-I-Client-Time': now.toISOString().replace('.000Z', 'Z'),
    'X-Apple-I-TimeZone': 'UTC',
    loc: 'en_US',
    'X-Apple-Locale': 'en_US',
    'X-Apple-I-MD': anisette.md,
    'X-Apple-I-MD-LU': Buffer.from(identity.userId).toString('base64'),
    'X-Apple-I-MD-M': anisette.machine,
    'X-Apple-I-MD-RINFO': '17106176',
    'X-Mme-Device-Id': identity.deviceId.toUpperCase(),
    'X-Apple-I-SRL-NO': '0',
  };
  if (opts.withClientInfo) {
    headers['X-Mme-Client-Info'] = CLIENT_INFO;
    headers['X-Apple-App-Info'] = 'com.apple.gs.xcode.auth';
    headers['X-Xcode-Version'] = '11.2 (11B41)';
  }
  return headers;
}

export const ANISETTE_CLIENT_INFO = CLIENT_INFO;

/** cpd block embedded in every GSA request. */
export function buildCpd(anisette: AnisetteData, identity: DeviceIdentity): Record<string, unknown> {
  return {
    bootstrap: true,
    icscrec: true,
    pbe: false,
    prkgen: true,
    svct: 'iCloud',
    ...buildHeaders(anisette, identity),
  };
}
