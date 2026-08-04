// A live, event-driven view of what a watch's exclusive BLE link is doing right
// now, for the WatchDetail status strip. It folds three sources into one small
// enum (see watchActivity.ts for the pure derivation):
//
//   - the app-wide ConnectionCoordinator ownership (a JS op holds the link and
//     has paused forwarding), via subscribeForwardingOwnership;
//   - the native forwarder connection state (CONNECTING / READY / BACKOFF), via
//     onConnectionState;
//   - the caller's own in-flight op flag (`busy`), the "transient operation"
//     this screen started.
//
// It reads the native status exactly once on mount and is otherwise purely
// event-driven — no polling. On web/desktop the forwarder is a no-op (getStatus
// returns nothing, onConnectionState is inert), so this settles to 'idle' or
// 'busy' and stays coherent.

import { useEffect, useState } from 'react';
import type { ConnState } from '../../modules/notification-forwarder';
import { forwardingOwnership, getStatus, onConnectionState, subscribeForwardingOwnership } from '../notifications/forwarder';
import { WatchActivity, deriveActivity } from './watchActivity';

export { WATCH_ACTIVITY_LABEL } from './watchActivity';
export type { WatchActivity } from './watchActivity';

export function useWatchConnectionStatus(deviceId: string | undefined, busy: boolean): WatchActivity {
  const [connState, setConnState] = useState<ConnState | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (deviceId === undefined) {
      setConnState(null);
      setHeld(false);
      return;
    }
    let mounted = true;
    // Seed from the coordinator snapshot synchronously and the native status
    // once; everything after is event-driven.
    setHeld(forwardingOwnership().some((h) => h.deviceId === deviceId));
    getStatus()
      .then((st) => {
        if (!mounted) {
          return;
        }
        setConnState(st.connections.find((c) => c.deviceId === deviceId)?.state ?? null);
        setHeld((prev) => prev || st.pausedDeviceIds.includes(deviceId));
      })
      .catch(() => undefined);

    const connSub = onConnectionState((e) => {
      if (e.deviceId === deviceId) {
        setConnState(e.state);
      }
    });
    const ownSub = subscribeForwardingOwnership((holds) => {
      setHeld(holds.some((h) => h.deviceId === deviceId));
    });
    return () => {
      mounted = false;
      connSub.remove();
      ownSub();
    };
  }, [deviceId]);

  return deriveActivity(busy, held, connState);
}
