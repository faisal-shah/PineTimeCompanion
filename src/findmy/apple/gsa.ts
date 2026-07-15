// Apple GrandSlam (GSA) authentication: a two round-trip SRP exchange whose
// response carries an encrypted account blob (spd). Port of FindMy.py's
// _gsa_authenticate. On success it yields either a 2FA requirement (with the
// adsid + idms token needed to drive SMS 2FA) or, once the device is trusted,
// the PET token used to obtain the search-party token (mobileme.ts).

import * as plist from 'plist';
import { parsePlist } from './plistParse';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { cbc } from '@noble/ciphers/aes.js';
import { Buffer } from 'buffer';
import { AnisetteData, DeviceIdentity, ANISETTE_CLIENT_INFO, buildCpd } from './anisette';
import { SrpClient, SrpProtocol, encryptPassword } from './srp';

const GSA_ENDPOINT = 'https://gsa.apple.com/grandslam/GsService2';

export interface AccountInfo {
  accountName?: string;
  firstName?: string;
  lastName?: string;
}

export type GsaResult =
  | { kind: '2fa'; trustedDevice: boolean; adsid: string; idmsToken: string; info: AccountInfo }
  | { kind: 'authenticated'; adsid: string; idmsPet: string; info: AccountInfo };

function toBytes(v: unknown): Uint8Array {
  // plist <data> decodes to Uint8Array; be defensive about Buffer too.
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  throw new Error('expected plist data field');
}

/** AES-256-CBC decrypt of the spd blob using the SRP session key (crypto.py). */
function decryptSpd(sessionKey: Uint8Array, data: Uint8Array): Record<string, any> {
  const key = hmac(sha256, sessionKey, new TextEncoder().encode('extra data key:'));
  const iv = hmac(sha256, sessionKey, new TextEncoder().encode('extra data iv:')).slice(0, 16);
  const plain = cbc(key, iv).decrypt(data); // noble strips PKCS7 padding by default
  let xml = Buffer.from(plain).toString('utf8');
  if (!xml.startsWith('<?xml')) {
    xml =
      "<?xml version='1.0' encoding='UTF-8'?>" +
      "<!DOCTYPE plist PUBLIC '-//Apple//DTD PLIST 1.0//EN' 'http://www.apple.com/DTDs/PropertyList-1.0.dtd'>" +
      xml;
  }
  return parsePlist(xml) as Record<string, any>;
}

async function gsaRequest(
  params: Record<string, unknown>,
  anisette: AnisetteData,
  identity: DeviceIdentity,
): Promise<Record<string, any>> {
  const body = plist.build({
    Header: { Version: '1.0.1' },
    Request: { cpd: buildCpd(anisette, identity), ...params },
  } as unknown as plist.PlistValue);
  const resp = await fetch(GSA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/x-xml-plist',
      Accept: '*/*',
      'User-Agent': 'akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0',
      'X-MMe-Client-Info': ANISETTE_CLIENT_INFO,
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`GSA request failed: HTTP ${resp.status}`);
  }
  const parsed = parsePlist(await resp.text()) as Record<string, any>;
  return parsed.Response as Record<string, any>;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis.crypto as Crypto).getRandomValues(b);
  return b;
}

/**
 * Run the SRP login. `anisette` should be freshly fetched by the caller. Throws
 * on bad credentials or protocol errors.
 */
export async function authenticate(
  username: string,
  password: string,
  anisette: AnisetteData,
  identity: DeviceIdentity,
): Promise<GsaResult> {
  const client = new SrpClient(username, randomBytes(256));

  // Round 1 — init.
  const r1 = await gsaRequest(
    { A2k: client.A, u: username, ps: ['s2k', 's2k_fo'], o: 'init' },
    anisette,
    identity,
  );
  if (r1.Status?.ec !== 0) {
    throw new Error(`Sign-in failed: ${r1.Status?.em ?? 'bad email or password'}`);
  }
  const sp = r1.sp as SrpProtocol;
  if (sp !== 's2k' && sp !== 's2k_fo') {
    throw new Error(`Unsupported SRP protocol from Apple: ${sp}`);
  }
  const salt = toBytes(r1.s);
  const B = toBytes(r1.B);
  const iterations = r1.i as number;
  const pk = encryptPassword(password, salt, iterations, sp);
  const { m1 } = client.processChallenge(salt, B, pk);

  // Round 2 — complete.
  const r2 = await gsaRequest({ c: r1.c, M1: m1, u: username, o: 'complete' }, anisette, identity);
  if (r2.Status?.ec !== 0) {
    throw new Error(`Password check failed: ${r2.Status?.em ?? 'incorrect password'}`);
  }
  if (!client.verifyM2(toBytes(r2.M2))) {
    throw new Error('Server identity check (M2) failed');
  }

  const spd = decryptSpd(client.sessionKeyOrThrow(), toBytes(r2.spd));
  const info: AccountInfo = { accountName: spd.acname, firstName: spd.fn, lastName: spd.ln };

  const au = r2.Status?.au as string | undefined;
  if (au === 'secondaryAuth' || au === 'trustedDeviceSecondaryAuth') {
    return {
      kind: '2fa',
      trustedDevice: au === 'trustedDeviceSecondaryAuth',
      adsid: spd.adsid,
      idmsToken: spd.GsIdmsToken,
      info,
    };
  }
  const idmsPet: string = spd?.t?.['com.apple.gs.idms.pet']?.token ?? '';
  if (!idmsPet) {
    throw new Error('No PET token in GSA response');
  }
  return { kind: 'authenticated', adsid: spd.adsid, idmsPet, info };
}
