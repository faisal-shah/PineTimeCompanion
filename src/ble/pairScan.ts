// Native watch discovery for the pair screen: Android runtime permissions +
// a ble-plx scan filtered to InfiniTime/PineTime names. ble-plx is loaded
// lazily so this module stays importable everywhere. The web sibling
// (pairScan.web.ts) implements the same signature over Web Bluetooth.

import { PermissionsAndroid, Platform } from 'react-native';
import { isWatchAdvertisement, watchDisplayName } from './watchAdvertisement';

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
  const { BleManager, ScanMode } = await import('react-native-ble-plx');
  const manager = new BleManager();
  // id -> whether the entry we already reported carried a real name.
  const reported = new Map<string, boolean>();
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
  manager.startDeviceScan(
    null,
    // LowLatency, not ble-plx's LowPower default: this scan runs because
    // someone is standing there waiting for their watch to appear, for twelve
    // seconds. A duty-cycled scan misses the scan response that carries the
    // name, and misses whole advertisements from a watch that has settled to
    // its one-second idle interval.
    //
    // allowDuplicates so a watch first seen without a name can be reported
    // again once its scan response arrives. Suppressing duplicates meant a
    // nameless first sighting was the only sighting.
    { allowDuplicates: true, scanMode: ScanMode.LowLatency },
    (scanError, device) => {
      if (scanError) {
        finish(scanError);
        return;
      }
      if (!device || !isWatchAdvertisement(device)) {
        return;
      }
      const name = watchDisplayName(device);
      const named = device.name != null || device.localName != null;
      const alreadyNamed = reported.get(device.id);
      if (alreadyNamed === undefined || (named && !alreadyNamed)) {
        reported.set(device.id, named);
        onFound({ id: device.id, name, rssi: device.rssi });
      }
    },
  );
  return { stop: () => finish() };
}
