import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { SIMULATOR_DEVICE_ID } from '../ble/transportFactory';
import { FoundWatch, ScanHandle, scanForWatches } from '../ble/pairScan';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchPair'>;

export function WatchPairScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const insets = useSafeAreaInsets();
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
        (f) => setFound((prev) => (prev.some((p) => p.id === f.id) ? prev : [...prev, f])),
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
    <View style={styles.container}>
      <Pressable style={styles.simButton} onPress={() => pair(SIMULATOR_DEVICE_ID)} testID="pair-simulator">
        <Text style={styles.simButtonTitle}>Use simulator</Text>
        <Text style={styles.simButtonSub}>InfiniSim GATT bridge at {SIMULATOR_DEVICE_ID} (dev)</Text>
      </Pressable>

      <Pressable style={styles.scanButton} onPress={scan} disabled={scanState === 'scanning'} testID="pair-scan">
        <Text style={styles.scanButtonText}>
          {scanState === 'scanning' ? 'Scanning…' : Platform.OS === 'web' ? 'Choose a real watch (Bluetooth)' : 'Scan for real watches'}
        </Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={found}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}
        renderItem={({ item }) => (
          <Pressable style={styles.deviceCard} onPress={() => pair(item.id)}>
            <Text style={styles.deviceName}>{item.name}</Text>
            <Text style={styles.deviceMeta}>
              {item.id} {item.rssi != null ? `(${item.rssi} dBm)` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing(2) },
  simButton: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  simButtonTitle: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  simButtonSub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  scanButton: { backgroundColor: colors.accent, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  scanButtonText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.danger, marginTop: spacing(1) },
  deviceCard: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  deviceName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  deviceMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
