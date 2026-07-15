// Secret storage backed by the OS keystore (Android Keystore / iOS Keychain) via
// expo-secure-store. The beacon private key (which decrypts the watch's location
// reports) and the Apple session tokens must not sit in the plaintext AsyncStorage
// blob, so they live here. Non-secret data (hashedKeyId, provisioned flag,
// location history) stays in AsyncStorage.
//
// SecureStore keys may only contain [A-Za-z0-9._-]; watch ids are
// "<base36>-<base36>", so `beaconPriv.<watchId>` is valid.

import * as SecureStore from 'expo-secure-store';
import { Watch } from '../model/types';

const beaconPrivKey = (watchId: string) => `beaconPriv.${watchId}`;
const APPLE_SESSION_KEY = 'appleSession';

export async function saveBeaconPrivateKey(watchId: string, privateKeyB64: string): Promise<void> {
  await SecureStore.setItemAsync(beaconPrivKey(watchId), privateKeyB64);
}

export async function getBeaconPrivateKey(watchId: string): Promise<string | null> {
  return SecureStore.getItemAsync(beaconPrivKey(watchId));
}

export async function deleteBeaconPrivateKey(watchId: string): Promise<void> {
  await SecureStore.deleteItemAsync(beaconPrivKey(watchId));
}

export async function saveAppleSession(json: string): Promise<void> {
  await SecureStore.setItemAsync(APPLE_SESSION_KEY, json);
}

export async function getAppleSession(): Promise<string | null> {
  return SecureStore.getItemAsync(APPLE_SESSION_KEY);
}

export async function clearAppleSession(): Promise<void> {
  await SecureStore.deleteItemAsync(APPLE_SESSION_KEY);
}

/**
 * One-shot migration: move any beacon private key still embedded in the
 * AsyncStorage watch blob into the keystore, then blank it out of the blob.
 * Idempotent — a watch whose key is already migrated (privateKeyB64 absent) is
 * skipped. Returns the watches that changed so the caller can persist them.
 */
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
