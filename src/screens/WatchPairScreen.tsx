import React, { useEffect, useRef, useState } from 'react';
import { FlatList, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { SIMULATOR_DEVICE_ID } from '../ble/transportFactory';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchPair'>;

interface Found {
  id: string;
  name: string;
  rssi: number | null;
}

export function WatchPairScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [found, setFound] = useState<Found[]>([]);
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [error, setError] = useState('');

  const managerRef = useRef<import('react-native-ble-plx').BleManager | null>(null);

  const stopScan = () => {
    managerRef.current?.stopDeviceScan();
  };

  useEffect(() => stopScan, []);

  const scan = async () => {
    setError('');
    setFound([]);
    try {
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
      managerRef.current ??= new BleManager();
      setScanState('scanning');
      managerRef.current.startDeviceScan(null, { allowDuplicates: false }, (scanError, device) => {
        if (scanError) {
          setScanState('error');
          setError(scanError.message);
          stopScan();
          return;
        }
        if (device?.name && /InfiniTime|Pinetime/i.test(device.name)) {
          setFound((prev) =>
            prev.some((f) => f.id === device.id) ? prev : [...prev, { id: device.id, name: device.name!, rssi: device.rssi }]
          );
        }
      });
      setTimeout(() => {
        stopScan();
        setScanState('idle');
      }, 12000);
    } catch (e) {
      setScanState('error');
      setError((e as Error).message);
    }
  };

  const pair = (deviceId: string) => {
    if (!watch) {
      return;
    }
    stopScan();
    upsertWatch({ ...watch, deviceId });
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.simButton} onPress={() => pair(SIMULATOR_DEVICE_ID)} testID="pair-simulator">
        <Text style={styles.simButtonTitle}>Use simulator</Text>
        <Text style={styles.simButtonSub}>InfiniSim GATT bridge at {SIMULATOR_DEVICE_ID} (dev)</Text>
      </Pressable>

      <Pressable style={styles.scanButton} onPress={scan} disabled={scanState === 'scanning'}>
        <Text style={styles.scanButtonText}>{scanState === 'scanning' ? 'Scanning…' : 'Scan for real watches'}</Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={found}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: spacing(2) }}
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
