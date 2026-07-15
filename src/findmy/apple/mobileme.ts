// Exchange the PET token for the search-party token used to fetch location
// reports. Port of FindMy.py's _login_mobileme.

import * as plist from 'plist';
import { parsePlist } from './plistParse';
import { Buffer } from 'buffer';
import { AnisetteData, DeviceIdentity, buildHeaders } from './anisette';

const MOBILEME_ENDPOINT = 'https://setup.icloud.com/setup/iosbuddy/loginDelegates';

export interface MobileMeResult {
  dsid: string;
  searchPartyToken: string;
}

export async function loginMobileMe(
  username: string,
  adsid: string,
  idmsPet: string,
  anisette: AnisetteData,
  identity: DeviceIdentity,
): Promise<MobileMeResult> {
  const body = plist.build({
    'apple-id': username,
    delegates: { 'com.apple.mobileme': {} },
    password: idmsPet,
    'client-id': identity.userId,
  } as unknown as plist.PlistValue);

  const auth = 'Basic ' + Buffer.from(`${username}:${idmsPet}`).toString('base64');
  const resp = await fetch(MOBILEME_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'X-Apple-ADSID': adsid,
      'User-Agent': 'com.apple.iCloudHelper/282 CFNetwork/1408.0.4 Darwin/22.5.0',
      'X-Mme-Client-Info': '<MacBookPro18,3> <Mac OS X;13.4.1;22F8> <com.apple.AOSKit/282 (com.apple.accountsd/113)>',
      ...buildHeaders(anisette, identity),
    },
    body,
  });
  const data = parsePlist(await resp.text()) as Record<string, any>;

  const mm = data?.delegates?.['com.apple.mobileme'] ?? {};
  const status = mm.status ?? data.status;
  if (status !== 0) {
    const message = mm['status-message'] ?? data['status-message'] ?? 'unknown error';
    throw new Error(`iCloud login failed (status ${status}): ${message}`);
  }
  const token = mm['service-data']?.tokens?.searchPartyToken;
  if (!data.dsid || !token) {
    throw new Error('iCloud login did not return a search-party token');
  }
  return { dsid: String(data.dsid), searchPartyToken: token };
}
