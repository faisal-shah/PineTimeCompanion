// Web watch discovery: one-shot navigator.bluetooth.requestDevice. Must run
// directly from the button tap (user-gesture requirement). In plain Chrome
// the browser's chooser appears; in the Electron shell the app's own picker
// overlay does. optionalServices must whitelist every service the app will
// ever touch — access to anything absent is permanently blocked.

import { ALL_SERVICE_UUIDS, WATCH_NAME_PREFIXES } from './gattUuids';
import { registerDevice } from './webDeviceRegistry';

export interface FoundWatch {
  id: string;
  name: string;
  rssi: number | null;
}

export interface ScanHandle {
  stop(): void;
}

export async function scanForWatches(onFound: (f: FoundWatch) => void, onDone: (error?: Error) => void): Promise<ScanHandle> {
  if (!navigator.bluetooth) {
    throw new Error('This browser has no Web Bluetooth (use Chrome or Edge, or the desktop app).');
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: WATCH_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      optionalServices: ALL_SERVICE_UUIDS,
    });
    registerDevice(device);
    onFound({ id: device.id, name: device.name ?? 'PineTime', rssi: null });
    onDone();
  } catch (e) {
    // "NotFoundError: User cancelled" is a normal outcome, not an error.
    if ((e as DOMException).name === 'NotFoundError') {
      onDone();
    } else {
      onDone(e as Error);
    }
  }
  return { stop: () => undefined };
}
