// Native watch discovery for the pair screen: Android runtime permissions +
// a ble-plx scan filtered to InfiniTime/PineTime names. ble-plx is loaded
// lazily so this module stays importable everywhere. The web sibling
// (pairScan.web.ts) implements the same signature over Web Bluetooth.

import { PermissionsAndroid, Platform } from 'react-native';
import { WATCH_NAME_PATTERN } from './gattUuids';

export interface FoundWatch {
  id: string;
  name: string;
  rssi: number | null;
}

export interface ScanHandle {
  stop(): void;
}

const SCAN_TIMEOUT_MS = 12000;

/**
 * Start discovering watches. `onFound` fires once per device; `onDone` fires
 * exactly once when the scan ends (timeout, stop, or radio error — passed as
 * `error`). Rejects only on pre-scan failures (permission denial).
 */
export async function scanForWatches(onFound: (f: FoundWatch) => void, onDone: (error?: Error) => void): Promise<ScanHandle> {
  if (Platform.OS === 'android') {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    if (Object.values(results).some((r) => r !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error('Bluetooth permissions denied');
    }
  }
  const { BleManager } = await import('react-native-ble-plx');
  const manager = new BleManager();
  const seen = new Set<string>();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (error?: Error) => {
    if (!finished) {
      finished = true;
      clearTimeout(timer);
      manager.stopDeviceScan();
      onDone(error);
    }
  };
  timer = setTimeout(finish, SCAN_TIMEOUT_MS);
  manager.startDeviceScan(null, { allowDuplicates: false }, (scanError, device) => {
    if (scanError) {
      finish(scanError);
      return;
    }
    if (device?.name && WATCH_NAME_PATTERN.test(device.name) && !seen.has(device.id)) {
      seen.add(device.id);
      onFound({ id: device.id, name: device.name, rssi: device.rssi });
    }
  });
  return { stop: () => finish() };
}
