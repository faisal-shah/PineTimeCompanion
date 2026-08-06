import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { showAlert } from '../ui/alert';
import { confirm } from '../ui/confirm';
import { SIMULATOR_DEVICE_ID, makeTransport } from '../ble/transportFactory';
import { FoundWatch, ScanHandle, scanForWatches } from '../ble/pairScan';
import { PairingOutcome, VerifyMismatch, runVerifiedPairing } from '../ble/companionPairing';
import { presentWatchOpError } from '../ui/watchOpError';
import { managementFromStatus } from '../model/types';
import type { FamilyStateStatus } from '../ble/familyStateProtocol';
import { RECORDS } from '../ble/generated/companionProtocol';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchPair'>;

const MISMATCH_COPY: Record<VerifyMismatch, string> = {
  resetEpoch: 'The watch cleared its pairings while you were pairing. Start again.',
  capacity: 'The watch reported an unexpected capacity. It may be running incompatible firmware.',
  policy: 'The watch reported an unexpected eviction policy. It may be running incompatible firmware.',
  countRegressed: 'The watch\u2019s companion count changed in a way the app did not expect. Start again.',
  evictionRegressed: 'The watch\u2019s eviction count changed in a way the app did not expect. Start again.',
};

export function WatchPairScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [found, setFound] = useState<FoundWatch[]>([]);
  const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
  const [error, setError] = useState('');
  // The device currently being paired, so duplicate taps are ignored and every
  // control is disabled until the verified flow finishes.
  const [pairing, setPairing] = useState<string | null>(null);

  const scanRef = useRef<ScanHandle | null>(null);

  useEffect(() => () => scanRef.current?.stop(), []);

  const scan = async () => {
    setError('');
    setFound([]);
    setScanState('scanning');
    try {
      scanRef.current = await scanForWatches(
        // Upsert rather than ignore repeats: a watch is often matched on its
        // advertised service before the scan response carrying the name has
        // arrived, and the second report is what fills the name in.
        (f) =>
          setFound((prev) => {
            const at = prev.findIndex((p) => p.id === f.id);
            if (at === -1) {
              return [...prev, f];
            }
            const next = [...prev];
            next[at] = { ...next[at], name: f.name, rssi: f.rssi ?? next[at].rssi };
            return next;
          }),
        (scanError) => {
          setScanState('idle');
          if (scanError) {
            setError(scanError.message);
          }
        },
      );
    } catch (e) {
      setScanState('idle');
      setError((e as Error).message);
    }
  };

  // Persist a verified pairing. The deviceId is saved only here and in
  // finishLegacy — never on mere selection — so an existing entry is never
  // overwritten until verification (or an explicit legacy accept) succeeds.
  const finishVerified = (
    deviceId: string,
    status: Parameters<typeof managementFromStatus>[0],
    familyStatus?: FamilyStateStatus,
  ) => {
    if (!watch) {
      return;
    }
    const preserveCutover =
      familyStatus !== undefined &&
      watch.deviceId === deviceId &&
      watch.familyCutoverClearedAt !== undefined;
    upsertWatch({
      ...watch,
      deviceId,
      management: managementFromStatus(status, { verified: true }),
      familyProtocol:
        !preserveCutover
          ? undefined
          : {
              protocolVersion: RECORDS.family_state.protocol_version,
              snapshotSchemaVersion: RECORDS.family_state.snapshot_schema_version,
              activeGeneration: familyStatus.activeGeneration,
              confirmedAt: new Date().toISOString(),
            },
      familyCutoverClearedAt: preserveCutover
        ? watch.familyCutoverClearedAt
        : undefined,
    });
    navigation.goBack();
  };

  const finishLegacy = (deviceId: string) => {
    if (!watch) {
      return;
    }
    // Legacy: no verification was possible, so record no management metadata.
    // The deviceId is still saved (the user explicitly accepted), but nothing
    // claims the bond was proven.
    upsertWatch({
      ...watch,
      deviceId,
      management: undefined,
      familyProtocol: undefined,
      familyCutoverClearedAt: undefined,
    });
    navigation.goBack();
  };

  const handleOutcome = async (deviceId: string, outcome: PairingOutcome) => {
    switch (outcome.kind) {
      case 'verified':
        finishVerified(deviceId, outcome.status, outcome.familyStatus);
        return;
      case 'cancelled':
        // The user declined the eviction confirmation: leave the app unchanged.
        return;
      case 'mismatch':
        showAlert('Couldn\u2019t verify the watch', MISMATCH_COPY[outcome.mismatch]);
        return;
      case 'error': {
        const view = presentWatchOpError(outcome.error, { label: 'Pairing' });
        showAlert(view.title, view.message);
        return;
      }
      case 'legacy': {
        const proceed = await confirm({
          title: 'This watch can\u2019t confirm pairing',
          message:
            'This watch\u2019s firmware is older and does not support pairing verification. You can still pair, but the app cannot confirm the watch will remember this phone. Pair anyway?',
          confirmLabel: 'Pair anyway',
        });
        if (proceed) {
          finishLegacy(deviceId);
        }
        return;
      }
    }
  };

  const pair = async (deviceId: string) => {
    if (!watch || pairing !== null) {
      return;
    }
    scanRef.current?.stop();
    setScanState('idle');
    setPairing(deviceId);
    try {
      const outcome = await runVerifiedPairing(makeTransport(deviceId), deviceId, {
        confirmEviction: (status) =>
          confirm({
            title: 'The watch is full',
            message:
              `This watch already remembers ${status.capacity} phones, the most it can. Pairing this phone will make it forget the one it has not connected to in the longest time. Cancel to leave everything unchanged.`,
            confirmLabel: 'Pair anyway',
            destructive: true,
          }),
      });
      await handleOutcome(deviceId, outcome);
    } catch (e) {
      const view = presentWatchOpError(e, { label: 'Pairing' });
      showAlert(view.title, view.message);
    } finally {
      setPairing(null);
    }
  };

  const busy = pairing !== null;

  return (
    <Screen width="read">
      <Pressable
        style={[styles.simButton, busy && styles.disabled]}
        onPress={() => pair(SIMULATOR_DEVICE_ID)}
        disabled={busy}
        testID="pair-simulator">
        <Text style={styles.simButtonTitle}>Use simulator</Text>
        <Text style={styles.simButtonSub}>InfiniSim GATT bridge at {SIMULATOR_DEVICE_ID} (dev)</Text>
      </Pressable>

      <Button
        label={
          scanState === 'scanning'
            ? 'Scanning\u2026'
            : Platform.OS === 'web'
              ? 'Choose a real watch (Bluetooth)'
              : 'Scan for real watches'
        }
        onPress={scan}
        disabled={scanState === 'scanning' || busy}
        busy={scanState === 'scanning'}
        testID="pair-scan"
        style={{ marginBottom: spacing(2) }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {busy && (
        <Text style={styles.pairingNote}>{'Verifying with the watch\u2026 approve the pairing request if your phone asks.'}</Text>
      )}

      {found.map((item) => (
        <Pressable
          key={item.id}
          style={[styles.deviceCard, busy && styles.disabled]}
          onPress={() => pair(item.id)}
          disabled={busy}
          testID={`pair-device-${item.id}`}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMeta}>
            {item.id} {item.rssi != null ? `(${item.rssi} dBm)` : ''}
          </Text>
          {pairing === item.id && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(1) }} />}
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  simButton: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  simButtonTitle: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  simButtonSub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  error: { color: colors.danger, marginTop: spacing(1), marginBottom: spacing(1) },
  pairingNote: { color: colors.textDim, fontSize: 13, marginBottom: spacing(1) },
  disabled: { opacity: 0.5 },
  deviceCard: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  deviceName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  deviceMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
