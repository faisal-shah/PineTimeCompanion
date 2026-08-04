// One presenter that turns any thrown watch-operation error into the title,
// message, and suggested next action a screen should show. Every feature screen
// used to render `"<label> failed"` with the raw error message; that told a
// user whose watch was simply busy forwarding a notification to go re-pair it.
//
// The classification is the pure BLE classifier (classifyBleError); this file
// only maps each kind to human copy and a recommended action. It stays pure and
// platform-free so it is unit-testable and reused by both useWatchOp and the
// pair/repair screens.

import { classifyBleError, TransportErrorKind } from '../ble/transport';

/**
 * What the UI should offer next, in rough priority order. The screen decides
 * how to render each (a button, a link, a hint); the presenter only recommends.
 *
 * - `retry`            — try the same operation again (transient/busy).
 * - `forwardingOff`    — the watch is likely held by notification forwarding;
 *                        suggest turning forwarding off for it, or waiting.
 * - `pairRepair`       — open the pair/repair flow (authentication failures).
 * - `enableBluetooth`  — the phone's radio is off.
 * - `openPermissions`  — grant a missing BLE/scan permission.
 * - `enableDfuAccess`  — turn on "Firmware & files" access on the watch.
 * - `none`             — nothing actionable (cancelled, not found, unknown).
 */
export type WatchOpAction =
  | 'retry'
  | 'forwardingOff'
  | 'pairRepair'
  | 'enableBluetooth'
  | 'openPermissions'
  | 'enableDfuAccess'
  | 'none';

export interface WatchOpErrorView {
  kind: TransportErrorKind;
  title: string;
  message: string;
  /** The primary suggested action; the screen wires it up if it can. */
  action: WatchOpAction;
}

export interface PresentOptions {
  /** The user-facing verb for the operation, e.g. "Sync" or "Set time". */
  label: string;
  /** DFU/firmware context reclassifies ATT status 8 as "access disabled". */
  context?: 'general' | 'dfu';
}

function viewForKind(kind: TransportErrorKind, label: string, rawMessage: string): WatchOpErrorView {
  switch (kind) {
    case 'transient':
      // "Busy" is the common case: the watch is in range but another op — very
      // often the notification-forwarding link — holds it. Retry or free it;
      // re-pairing is the wrong first move and only makes things worse.
      return {
        kind,
        title: `${label} couldn\u2019t reach the watch`,
        message:
          'The watch is busy or the link dropped. If notifications are forwarding to it, that connection may be in use — wait a moment and try again, or turn forwarding off for this watch first.',
        action: 'retry',
      };
    case 'authentication':
      return {
        kind,
        title: 'The watch needs re-pairing',
        message: 'The watch would not accept this phone as a paired companion. Repair the pairing to continue.',
        action: 'pairRepair',
      };
    case 'authorization':
      return {
        kind,
        title: `${label} was refused`,
        message: 'The watch refused access to this feature. Check that the feature is enabled on the watch.',
        action: 'none',
      };
    case 'dfuDisabled':
      return {
        kind,
        title: 'Firmware access is off',
        message: 'The watch has \u201CFirmware & files\u201D access disabled. Enable it on the watch under Settings, then try again.',
        action: 'enableDfuAccess',
      };
    case 'bluetoothOff':
      return {
        kind,
        title: 'Bluetooth is off',
        message: 'Turn on Bluetooth on this phone, then try again.',
        action: 'enableBluetooth',
      };
    case 'permission':
      return {
        kind,
        title: 'Bluetooth permission needed',
        message: 'This app needs Bluetooth permission to reach the watch. Grant it in system settings, then try again.',
        action: 'openPermissions',
      };
    case 'cancelled':
      return {
        kind,
        title: `${label} cancelled`,
        message: 'The operation was cancelled.',
        action: 'none',
      };
    case 'notFound':
      return {
        kind,
        title: 'Watch not found',
        message: 'The watch is not responding. Make sure it is nearby and awake, then try again.',
        action: 'retry',
      };
    default:
      return {
        kind: 'unknown',
        title: `${label} failed`,
        message: rawMessage || 'Something went wrong.',
        action: 'none',
      };
  }
}

/**
 * Classify a thrown error and return the view to show. `context: 'dfu'` makes
 * an ATT status-8 refusal read as "Firmware & files access disabled" instead of
 * the generic authorization message.
 */
export function presentWatchOpError(err: unknown, opts: PresentOptions): WatchOpErrorView {
  const { kind } = classifyBleError(err, opts.context ?? 'general');
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');
  return viewForKind(kind, opts.label, rawMessage);
}
