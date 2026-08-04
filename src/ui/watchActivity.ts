// Pure derivation of a watch's live BLE-link activity, kept free of React and
// the native forwarder so it is unit-testable under plain Node. The hook
// (useWatchConnectionStatus) wires the event sources to this.

import type { ConnState } from '../../modules/notification-forwarder';

export type WatchActivity = 'busy' | 'held' | 'connecting' | 'reconnecting' | 'connected' | 'idle';

export const WATCH_ACTIVITY_LABEL: Record<WatchActivity, string> = {
  busy: 'Working\u2026',
  held: 'In use (forwarding paused)',
  connecting: 'Connecting\u2026',
  reconnecting: 'Reconnecting\u2026',
  connected: 'Forwarding connected',
  idle: 'Idle',
};

/**
 * Fold the three inputs into one activity, in precedence order: the app's own
 * in-flight op (busy) wins, then a coordinator hold, then the native forwarder
 * connection state.
 */
export function deriveActivity(busy: boolean, held: boolean, connState: ConnState | null): WatchActivity {
  if (busy) {
    return 'busy';
  }
  if (held) {
    return 'held';
  }
  switch (connState) {
    case 'CONNECTING':
      return 'connecting';
    case 'BACKOFF':
      return 'reconnecting';
    case 'READY':
      return 'connected';
    default:
      return 'idle';
  }
}
