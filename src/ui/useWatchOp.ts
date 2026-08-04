// One place for "run a watch operation from a screen": guard on pairing, track
// which operation is in flight, and surface failures the same way everywhere.
// Every feature screen had re-implemented this setBusy/try/catch/finally dance.
//
// Failures go through the shared presenter (watchOpError) so the same error —
// "the watch is busy forwarding a notification", say — reads the same helpful
// way everywhere, instead of a raw ble-plx string that sent users to re-pair a
// watch that was merely in use.

import { useCallback, useState } from 'react';
import { Watch } from '../model/types';
import { showAlert } from './alert';
import { presentWatchOpError } from './watchOpError';

export interface WatchOp {
  /** Label of the operation currently running, or null when idle. */
  busy: string | null;
  /**
   * Run `fn` against the watch's deviceId. No-ops with a "not paired" alert if
   * the watch has never been paired. Failures are classified and shown with the
   * shared presenter; pass `onError` to handle them yourself instead (e.g. the
   * schedule/task reset-recovery flow, or the pair/repair flow).
   */
  run(label: string, fn: (deviceId: string) => Promise<void>, onError?: (e: unknown) => void): Promise<void>;
}

export function useWatchOp(watch: Watch | undefined): WatchOp {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, fn: (deviceId: string) => Promise<void>, onError?: (e: unknown) => void) => {
      const deviceId = watch?.deviceId;
      if (deviceId === undefined) {
        showAlert('Not paired', 'Pair this watch first (from the watch screen).');
        return;
      }
      setBusy(label);
      try {
        await fn(deviceId);
      } catch (e) {
        if (onError !== undefined) {
          onError(e);
        } else {
          const view = presentWatchOpError(e, { label });
          showAlert(view.title, view.message);
        }
      } finally {
        setBusy(null);
      }
    },
    [watch?.deviceId],
  );

  return { busy, run };
}
