// Turns a failed authentication into a specific, honest repair instruction.
//
// When a normal watch operation fails because the link is no longer bonded, the
// app reads the watch's *public* companion status (no pairing needed) and
// compares it to what it saw the last time pairing worked. Three distinct
// stories explain the failure, and each has different words and — crucially —
// the same real fix: forget the watch in the phone's system Bluetooth settings,
// then pair again. There are no hidden Android bond-removal APIs here; the user
// is walked through the OS UI.
//
// Pure: takes the stored metadata and the freshly-read status (or nothing, when
// even the public read failed) and returns copy. No I/O, no platform calls.

export type RepairReason =
  | 'resetEpochChanged'
  | 'evictionAdvanced'
  | 'outOfSync'
  | 'unknown';

export interface RepairAdvice {
  reason: RepairReason;
  title: string;
  /** One or two short sentences: what happened, then what to do. */
  message: string;
  /** True when the standard fix is "system Forget, then Pair again". */
  offerBluetoothSettings: boolean;
}

/** The subset of persisted management metadata the decision needs. */
export interface StoredManagement {
  resetEpoch?: number;
  evictionCount?: number;
}

/** The subset of a freshly-read public status the decision needs. */
export interface CurrentManagement {
  resetEpoch: number;
  evictionCount: number;
}

const FORGET_THEN_PAIR = 'Open your phone\u2019s Bluetooth settings, forget \u201CInfiniTime\u201D, then tap Pair again here.';

/**
 * Decide how to explain an authentication failure and what to tell the user to
 * do. `current` is undefined when even the public status read failed (the watch
 * was unreachable, off, or too far); the advice then falls back to the generic
 * out-of-sync instruction.
 */
export function decideRepair(stored: StoredManagement, current?: CurrentManagement): RepairAdvice {
  if (current === undefined) {
    return {
      reason: 'unknown',
      title: 'Pairing needs repair',
      message: `This phone and the watch no longer trust each other. ${FORGET_THEN_PAIR}`,
      offerBluetoothSettings: true,
    };
  }
  if (stored.resetEpoch !== undefined && current.resetEpoch !== stored.resetEpoch) {
    return {
      reason: 'resetEpochChanged',
      title: 'The watch cleared its pairings',
      message: `The watch has forgotten every paired phone (its pairings were reset). ${FORGET_THEN_PAIR}`,
      offerBluetoothSettings: true,
    };
  }
  if (stored.evictionCount !== undefined && current.evictionCount > stored.evictionCount) {
    return {
      reason: 'evictionAdvanced',
      title: 'The watch forgot this phone',
      message:
        `The watch remembers a limited number of phones and paired a new one, so this phone — the least recently used — was dropped. ${FORGET_THEN_PAIR}`,
      offerBluetoothSettings: true,
    };
  }
  return {
    reason: 'outOfSync',
    title: 'Pairing is out of sync',
    message: `The bond between this phone and the watch is no longer valid. ${FORGET_THEN_PAIR}`,
    offerBluetoothSettings: true,
  };
}

/**
 * The last-resort escalation, offered only after the normal Forget/Pair repair
 * has already failed. Clearing all bonds on the watch affects every phone paired
 * to it, so the warning is explicit.
 */
export const ON_WATCH_FORGET_ALL: { title: string; message: string } = {
  title: 'Still not pairing?',
  message:
    'On the watch, open Settings > Bluetooth and choose \u201CForget all\u201D, then pair again from this app. This makes the watch forget every phone, not just this one.',
};
