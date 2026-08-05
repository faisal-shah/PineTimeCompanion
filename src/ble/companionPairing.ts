// The verified-pairing flow, above the transport seam so it is emulator- and
// unit-testable. Selecting a scanned device must NOT immediately trust it: the
// app first reads the watch's public companion-management status, and only
// after an authenticated verify read that proves the watch remembers this phone
// does it save the deviceId.
//
// The whole flow rides the coordinated connection seam (withConnection ->
// ConnectionCoordinator): each read is a pause-forwarding / connect / read /
// disconnect / resume cycle, so it never fights the native forwarder for the
// exclusive BLE link. Two separate cycles are used on purpose — read the public
// status and drop the link, then reconnect for the authenticated verify — which
// is also where the OS pairing/passkey prompt happens.

import { WatchTransport, withConnection, classifyBleError } from './transport';
import {
  CompanionManagementStatus,
  ManagementProtocolError,
  MANAGEMENT_STATUS_CHAR,
  MANAGEMENT_VERIFY_CHAR,
  decodeCompanionManagementStatus,
} from './companionManagementProtocol';

/**
 * Reading either management characteristic yields one of three qualitatively
 * different results, and the pairing flow branches on which:
 *
 * - `ok`          — a valid, in-contract status payload came back.
 * - `unsupported` — the characteristic is absent or answered with a payload
 *                   this build cannot parse. This is the older-firmware signal:
 *                   the watch predates the companion-management service, so the
 *                   app must fall back to an explicit legacy pairing rather than
 *                   pretend it verified anything.
 * - `error`       — an operational failure (link drop, Bluetooth off, missing
 *                   permission, cancelled, or — on the authenticated verify read
 *                   — a failed pairing/passkey). The caller surfaces it; it is
 *                   never treated as a verification.
 */
export type ManagementReadResult =
  | { kind: 'ok'; status: CompanionManagementStatus }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; error: unknown };

// Kinds that mean "the watch is reachable but this characteristic operation
// failed operationally"; they must be surfaced, not read as unsupported.
const OPERATIONAL_KINDS = new Set(['transient', 'bluetoothOff', 'permission', 'cancelled', 'authentication']);

/**
 * Read and decode one management characteristic over its own coordinated
 * connection. A structurally invalid payload or a non-operational read failure
 * (a characteristic the firmware does not expose) becomes `unsupported`;
 * operational failures become `error`.
 */
function classifyReadFailure(e: unknown): ManagementReadResult {
  const { kind } = classifyBleError(e);
  if (OPERATIONAL_KINDS.has(kind)) {
    return { kind: 'error', error: e };
  }
  // notFound / authorization / unknown from a plain characteristic read is how
  // firmware without this service shows up: the characteristic isn't there.
  return { kind: 'unsupported', reason: (e as Error)?.message ?? String(e) };
}

function decodeManagementPayload(raw: Uint8Array): ManagementReadResult {
  try {
    return { kind: 'ok', status: decodeCompanionManagementStatus(raw) };
  } catch (e) {
    if (e instanceof ManagementProtocolError) {
      return { kind: 'unsupported', reason: e.message };
    }
    throw e;
  }
}

/** Read and decode one management characteristic on a link that is already open. */
async function readManagementOnLink(transport: WatchTransport, which: 'status' | 'verify'): Promise<ManagementReadResult> {
  const charId = which === 'status' ? MANAGEMENT_STATUS_CHAR : MANAGEMENT_VERIFY_CHAR;
  let raw: Uint8Array;
  try {
    raw = await transport.read(charId);
  } catch (e) {
    return classifyReadFailure(e);
  }
  return decodeManagementPayload(raw);
}

export async function readManagementStatus(
  transport: WatchTransport,
  deviceId: string,
  which: 'status' | 'verify',
): Promise<ManagementReadResult> {
  try {
    return await withConnection(transport, deviceId, () => readManagementOnLink(transport, which));
  } catch (e) {
    // Only the connect half can reach here; read failures are returned as values.
    return classifyReadFailure(e);
  }
}

/**
 * Why a verify payload was rejected against the public status read taken moments
 * earlier. `resetEpoch`, `capacity`, and `policy` must be identical — a change
 * means the watch is not the same trust anchor the status came from. `count`
 * and `evictionCount` are allowed to advance by the one step a sixth pairing
 * causes (the watch evicts its least-recently-used companion and admits this
 * phone), but never to move backwards.
 */
export type VerifyMismatch =
  | 'resetEpoch'
  | 'capacity'
  | 'policy'
  | 'countRegressed'
  | 'evictionRegressed';

export interface VerifyCheck {
  ok: boolean;
  mismatch?: VerifyMismatch;
}

/**
 * Confirm the authenticated verify payload is consistent with the public status
 * captured before pairing. Pure comparison; no I/O.
 */
export function checkVerifyConsistency(before: CompanionManagementStatus, after: CompanionManagementStatus): VerifyCheck {
  if (after.resetEpoch !== before.resetEpoch) {
    return { ok: false, mismatch: 'resetEpoch' };
  }
  if (after.capacity !== before.capacity) {
    return { ok: false, mismatch: 'capacity' };
  }
  if (after.evictionPolicy !== before.evictionPolicy) {
    return { ok: false, mismatch: 'policy' };
  }
  // A pairing can only add this phone: the count rises by one (or holds at
  // capacity when the LRU peer is evicted to make room). It must not regress.
  if (after.count < before.count) {
    return { ok: false, mismatch: 'countRegressed' };
  }
  // The sixth pairing evicts the LRU companion, so evictionCount may rise by
  // one. It must never go backwards.
  if (after.evictionCount < before.evictionCount) {
    return { ok: false, mismatch: 'evictionRegressed' };
  }
  return { ok: true };
}

/**
 * The result of a pairing attempt, for the screen to act on:
 *
 * - `verified` — the watch proved the bond; save the deviceId and metadata.
 * - `cancelled` — the user declined the at-capacity eviction confirmation; the
 *                 app is left exactly as it was (no deviceId saved).
 * - `legacy` — the firmware has no companion-management service; the caller must
 *              offer an explicit, clearly-labelled legacy pairing (unverified),
 *              never a silent success.
 * - `mismatch` — the verify payload was inconsistent with the pre-pairing
 *                status; do not save.
 * - `error` — an operational failure (surface it; do not save).
 */
export type PairingOutcome =
  | { kind: 'verified'; status: CompanionManagementStatus }
  | { kind: 'cancelled' }
  | { kind: 'legacy'; reason: string }
  | { kind: 'mismatch'; before: CompanionManagementStatus; after: CompanionManagementStatus; mismatch: VerifyMismatch }
  | { kind: 'error'; error: unknown };

export interface PairingHooks {
  /**
   * Called only when the public status shows the watch is full (count ===
   * capacity), before any authenticated read. Resolve true to proceed knowing
   * the watch will forget its least-recently-used companion; false to abort
   * with the app unchanged.
   */
  confirmEviction(status: CompanionManagementStatus): Promise<boolean>;
}

/**
 * Run the verified-pairing flow for a freshly-selected device:
 *
 *   1. read the public companion status (its own connect/disconnect cycle);
 *   2. if the watch is at capacity, ask the caller to confirm the eviction;
 *   3. read the authenticated verify payload — this is where the OS pairing /
 *      passkey happens — and require a valid, consistent payload;
 *   4. report `verified` so, and only so, the caller saves the deviceId.
 *
 * The transport and deviceId are the newly-scanned candidate; nothing is
 * persisted here.
 */
export async function runVerifiedPairing(
  transport: WatchTransport,
  deviceId: string,
  hooks: PairingHooks,
): Promise<PairingOutcome> {
  // Both reads share one link unless a prompt has to come between them.
  //
  // The watch serves a single connection and has to get back to advertising
  // before it can accept another, so every extra connect/disconnect cycle is a
  // chance to race that teardown -- the simulator now models the same limit and
  // resets the link when a second connection arrives mid-pairing. Reading the
  // authenticated verify on the link that produced the public status also makes
  // the consistency check below stronger, not weaker: both halves demonstrably
  // came from one session with one trust anchor.
  let pub: ManagementReadResult;
  let ver: ManagementReadResult | undefined;
  try {
    const pair = await withConnection(transport, deviceId, async () => {
      const status = await readManagementOnLink(transport, 'status');
      // Stop here if the caller has to be asked something: the link must not be
      // held open across a human decision while it is the watch's only one.
      if (status.kind !== 'ok' || status.status.atCapacity) {
        return { status, verify: undefined };
      }
      return { status, verify: await readManagementOnLink(transport, 'verify') };
    });
    pub = pair.status;
    ver = pair.verify;
  } catch (e) {
    return { kind: 'error', error: e };
  }

  if (pub.kind === 'error') {
    return { kind: 'error', error: pub.error };
  }
  if (pub.kind === 'unsupported') {
    // Old firmware: no management service to verify against. The caller decides
    // whether to allow an explicit legacy pairing.
    return { kind: 'legacy', reason: pub.reason };
  }

  if (pub.status.atCapacity) {
    const proceed = await hooks.confirmEviction(pub.status);
    if (!proceed) {
      return { kind: 'cancelled' };
    }
  }

  ver = ver ?? (await readManagementStatus(transport, deviceId, 'verify'));
  if (ver.kind === 'error') {
    return { kind: 'error', error: ver.error };
  }
  if (ver.kind === 'unsupported') {
    // The public status parsed but the authenticated verify did not — treat as
    // a firmware that cannot prove the bond, i.e. legacy, rather than a success.
    return { kind: 'legacy', reason: ver.reason };
  }

  const check = checkVerifyConsistency(pub.status, ver.status);
  if (!check.ok) {
    return { kind: 'mismatch', before: pub.status, after: ver.status, mismatch: check.mismatch! };
  }
  return { kind: 'verified', status: ver.status };
}
