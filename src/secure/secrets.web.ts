// Web implementation of the secrets API. Browsers have no OS keystore, so the
// beacon private key is stored in AsyncStorage (localStorage) instead — a
// documented, accepted downgrade for the web/desktop build: the key must be
// exportable anyway (.keys file), and the web scope excludes the Apple session
// entirely. Keys mirror secrets.ts so nothing else needs to know the platform.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Watch } from '../model/types';

const beaconPrivKey = (watchId: string) => `secret/beaconPriv.${watchId}`;

export async function saveBeaconPrivateKey(watchId: string, privateKeyB64: string): Promise<void> {
  await AsyncStorage.setItem(beaconPrivKey(watchId), privateKeyB64);
}

export async function getBeaconPrivateKey(watchId: string): Promise<string | null> {
  return AsyncStorage.getItem(beaconPrivKey(watchId));
}

export async function deleteBeaconPrivateKey(watchId: string): Promise<void> {
  await AsyncStorage.removeItem(beaconPrivKey(watchId));
}

export async function saveAppleSession(_json: string): Promise<void> {
  throw new Error('Apple Find My is not available on web');
}

export async function getAppleSession(): Promise<string | null> {
  return null;
}

export async function clearAppleSession(): Promise<void> {
  // Nothing stored on web.
}

export async function migrateSecrets(watches: Watch[]): Promise<Watch[]> {
  const migrated: Watch[] = [];
  for (const watch of watches) {
    const priv = watch.beacon?.privateKeyB64;
    if (!priv) {
      continue;
    }
    await saveBeaconPrivateKey(watch.id, priv);
    const { privateKeyB64, ...rest } = watch.beacon!;
    migrated.push({ ...watch, beacon: rest });
  }
  return migrated;
}
