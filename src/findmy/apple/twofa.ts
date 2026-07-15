// SMS two-factor authentication for GrandSlam. This is the only 2FA path a
// device-less client can complete: trusted-device/push 2FA needs an existing
// Apple device to approve the prompt, which we don't have. Port of FindMy.py's
// _sms_2fa_request / get_2fa_methods / sms_2fa_submit.
//
// Submitting the code does NOT itself return tokens — it only marks the session
// trusted server-side. The caller must then re-run gsa.authenticate (which now
// returns the PET token) and mobileme login. See session.ts.

import { Buffer } from 'buffer';
import { AnisetteData, DeviceIdentity, buildHeaders } from './anisette';

const METHODS_URL = 'https://gsa.apple.com/auth';
const SMS_REQUEST_URL = 'https://gsa.apple.com/auth/verify/phone';
const SMS_SUBMIT_URL = 'https://gsa.apple.com/auth/verify/phone/securitycode';

export interface TwoFactorContext {
  adsid: string;
  idmsToken: string;
  anisette: AnisetteData;
  identity: DeviceIdentity;
}

export interface PhoneNumber {
  id: number;
  /** Masked display form, e.g. "+1 (•••) •••-••12". */
  numberWithDialCode: string;
}

function headersFor(ctx: TwoFactorContext, extra: Record<string, string> = {}): Record<string, string> {
  const identityToken = Buffer.from(`${ctx.adsid}:${ctx.idmsToken}`).toString('base64');
  return {
    'User-Agent': 'Xcode',
    'Accept-Language': 'en-us',
    'X-Apple-Identity-Token': identityToken,
    ...buildHeaders(ctx.anisette, ctx.identity, { withClientInfo: true }),
    ...extra,
  };
}

/** List the SMS-capable trusted phone numbers on the account. */
export async function list2faPhoneNumbers(ctx: TwoFactorContext): Promise<PhoneNumber[]> {
  const resp = await fetch(METHODS_URL, { method: 'GET', headers: headersFor(ctx) });
  if (!resp.ok) {
    throw new Error(`Could not load 2FA methods: HTTP ${resp.status}`);
  }
  const html = await resp.text();
  const m = html.match(/<script[^>]*class="boot_args"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    throw new Error('Could not find phone numbers on the Apple sign-in page');
  }
  const data = JSON.parse(m[1]);
  const numbers = data?.direct?.phoneNumberVerification?.trustedPhoneNumbers ?? [];
  return numbers.map((n: any) => ({ id: n.id ?? -1, numberWithDialCode: n.numberWithDialCode ?? '—' }));
}

/** Trigger an SMS code to the given phone-number id. */
export async function requestSmsCode(ctx: TwoFactorContext, phoneId: number): Promise<void> {
  const resp = await fetch(SMS_REQUEST_URL, {
    method: 'PUT',
    headers: headersFor(ctx, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ phoneNumber: { id: phoneId }, mode: 'sms' }),
  });
  if (!resp.ok) {
    throw new Error(`Could not send the SMS code: HTTP ${resp.status}`);
  }
}

/**
 * Submit the SMS code. Returns nothing on success (the session is now trusted);
 * the caller re-runs authentication to collect tokens.
 */
export async function submitSmsCode(ctx: TwoFactorContext, phoneId: number, code: string): Promise<void> {
  const resp = await fetch(SMS_SUBMIT_URL, {
    method: 'POST',
    headers: headersFor(ctx, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ phoneNumber: { id: phoneId }, securityCode: { code: String(code) }, mode: 'sms' }),
  });
  if (!resp.ok) {
    throw new Error(`The code was not accepted: HTTP ${resp.status}`);
  }
}
