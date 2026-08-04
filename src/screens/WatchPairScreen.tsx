import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { SIMULATOR_DEVICE_ID } from '../ble/transportFactory';
import { FoundWatch, ScanHandle, scanForWatches } from '../ble/pairScan';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchPair'>;

export function WatchPairScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [found, setFound] = useState<FoundWatch[]>([]);
  const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
  const [error, setError] = useState('');

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

  const pair = (deviceId: string) => {
    if (!watch) {
      return;
    }
    scanRef.current?.stop();
    upsertWatch({ ...watch, deviceId });
    navigation.goBack();
  };

  return (
    <Screen width="read">
      <Pressable style={styles.simButton} onPress={() => pair(SIMULATOR_DEVICE_ID)} testID="pair-simulator">
        <Text style={styles.simButtonTitle}>Use simulator</Text>
        <Text style={styles.simButtonSub}>InfiniSim GATT bridge at {SIMULATOR_DEVICE_ID} (dev)</Text>
      </Pressable>

      <Button
        label={scanState === 'scanning' ? 'Scanning…' : Platform.OS === 'web' ? 'Choose a real watch (Bluetooth)' : 'Scan for real watches'}
        onPress={scan}
        disabled={scanState === 'scanning'}
        busy={scanState === 'scanning'}
        testID="pair-scan"
        style={{ marginBottom: spacing(2) }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}

      {found.map((item) => (
        <Pressable key={item.id} style={styles.deviceCard} onPress={() => pair(item.id)}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMeta}>
            {item.id} {item.rssi != null ? `(${item.rssi} dBm)` : ''}
          </Text>
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
  deviceCard: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  deviceName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  deviceMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
