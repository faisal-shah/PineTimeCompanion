// Apple session orchestration + persistence. The whole point of persisting here
// is that the user signs in (and does SMS 2FA) as rarely as possible:
//
//  * The search-party token is long-lived, so day-to-day location fetches use
//    the stored session with NO login at all.
//  * The device identity (anisette.ts) is stable and separate from the session,
//    so even when a re-login is needed Apple still trusts the device and returns
//    NO 2FA challenge — a re-login is password-only.
//  * The session (tokens + identity + account info) is stored in the OS keystore
//    via secrets.ts and survives app restarts.
//
// We deliberately do NOT persist the password. A rare token expiry (fetch 401)
// surfaces as "sign in again" — password only, no SMS — thanks to device trust.

import { getAppleSession, saveAppleSession, clearAppleSession } from '../../secure/secrets';
import { DeviceIdentity, getAnisette, getDeviceIdentity } from './anisette';
import { AccountInfo, authenticate } from './gsa';
import { loginMobileMe } from './mobileme';
import { PhoneNumber, TwoFactorContext, list2faPhoneNumbers, requestSmsCode, submitSmsCode } from './twofa';

export interface AppleSession {
  username: string;
  adsid: string;
  dsid: string;
  searchPartyToken: string;
  identity: DeviceIdentity;
  info: AccountInfo;
  savedAt: number;
}

export interface PendingLogin {
  phoneNumbers: PhoneNumber[];
  // Carried across the 2FA round trip. Password stays in memory only.
  readonly _username: string;
  readonly _password: string;
  readonly _identity: DeviceIdentity;
  readonly _ctx: TwoFactorContext;
  readonly _overrides?: string[];
}

export type LoginResult =
  | { status: 'logged-in'; session: AppleSession }
  | { status: 'needs-2fa'; pending: PendingLogin };

export async function loadSession(): Promise<AppleSession | null> {
  const raw = await getAppleSession();
  return raw ? (JSON.parse(raw) as AppleSession) : null;
}

export async function signOut(): Promise<void> {
  await clearAppleSession();
}

async function finishLogin(
  username: string,
  password: string,
  identity: DeviceIdentity,
  overrides?: string[],
): Promise<AppleSession> {
  const anisette = await getAnisette(overrides);
  const res = await authenticate(username, password, anisette, identity);
  if (res.kind !== 'authenticated') {
    throw new Error('Unexpected 2FA prompt after the code was accepted; please try signing in again.');
  }
  const mm = await loginMobileMe(username, res.adsid, res.idmsPet, anisette, identity);
  const session: AppleSession = {
    username,
    adsid: res.adsid,
    dsid: mm.dsid,
    searchPartyToken: mm.searchPartyToken,
    identity,
    info: res.info,
    savedAt: Date.now(),
  };
  await saveAppleSession(JSON.stringify(session));
  return session;
}

/**
 * Start (or complete, if no 2FA is needed) a sign-in. Returns either a ready
 * session or a PendingLogin to drive the SMS 2FA UI.
 */
export async function login(username: string, password: string, overrides?: string[]): Promise<LoginResult> {
  const identity = await getDeviceIdentity();
  const anisette = await getAnisette(overrides);
  const res = await authenticate(username, password, anisette, identity);

  if (res.kind === 'authenticated') {
    const mm = await loginMobileMe(username, res.adsid, res.idmsPet, anisette, identity);
    const session: AppleSession = {
      username,
      adsid: res.adsid,
      dsid: mm.dsid,
      searchPartyToken: mm.searchPartyToken,
      identity,
      info: res.info,
      savedAt: Date.now(),
    };
    await saveAppleSession(JSON.stringify(session));
    return { status: 'logged-in', session };
  }

  if (res.trustedDevice) {
    throw new Error(
      'This account is set up for trusted-device (push) 2FA, which is not supported. Use a burner Apple ID with SMS-based 2FA.',
    );
  }

  const ctx: TwoFactorContext = { adsid: res.adsid, idmsToken: res.idmsToken, anisette, identity };
  const phoneNumbers = await list2faPhoneNumbers(ctx);
  return {
    status: 'needs-2fa',
    pending: {
      phoneNumbers,
      _username: username,
      _password: password,
      _identity: identity,
      _ctx: ctx,
      _overrides: overrides,
    },
  };
}

/** Send an SMS code to one of the pending login's phone numbers. */
export async function requestSms(pending: PendingLogin, phoneId: number): Promise<void> {
  await requestSmsCode(pending._ctx, phoneId);
}

/** Submit the SMS code and finish login, returning the persisted session. */
export async function submit2fa(pending: PendingLogin, phoneId: number, code: string): Promise<AppleSession> {
  // MUST reuse the SAME anisette captured at login: public anisette servers hand
  // out a fresh machine id (X-Apple-I-MD-M) on every fetch, and Apple binds the
  // SMS challenge to the machine id that requested the code. Refetching here
  // yields a different machine id and Apple rejects the code with HTTP 401.
  await submitSmsCode(pending._ctx, phoneId, code);
  // The session is now trusted server-side; a fresh SRP run yields the tokens.
  return finishLogin(pending._username, pending._password, pending._identity, pending._overrides);
}
