// Wires the platform notification-forwarder into the app-wide
// ConnectionCoordinator as its ForwardingGate. Importing this module for its
// side effect installs the gate; do it once at app start.
//
// This is the one file that bridges the coordinator (pure, native-free, under
// the transport seam) to the platform-native forwarder. It lives here, not in
// the coordinator, so the coordinator and everything below the transport seam
// stay importable under plain Node for tests. On web/desktop the forwarder is a
// no-op shadow (forwarder.web.ts), so the installed gate is inert there too.

import { setForwardingGate, type ForwardingGate } from '../ble/connectionCoordinator';
import { pauseConnections, resumeConnections } from './forwarder';

export const forwardingGate: ForwardingGate = {
  pause: (deviceId) => pauseConnections(deviceId),
  resume: (deviceId) => resumeConnections(deviceId),
};

let installed = false;

export function installForwardingGate(): void {
  if (installed) {
    return;
  }
  setForwardingGate(forwardingGate);
  installed = true;
}
