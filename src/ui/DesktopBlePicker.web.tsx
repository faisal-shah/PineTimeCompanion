// Device-chooser overlay for the Electron shell. Electron has no built-in
// Web Bluetooth picker: the main process holds the chooser callback and
// streams discovered devices here over IPC; tapping one answers it. Renders
// nothing in plain browsers (no window.desktopBluetooth) or while no chooser
// is pending.

import React, { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from './theme';

export function DesktopBlePicker() {
  const [devices, setDevices] = useState<DesktopBluetoothDevice[] | null>(null);

  useEffect(() => {
    const bt = window.desktopBluetooth;
    if (!bt) {
      return;
    }
    const offDevices = bt.onDevicesUpdated(setDevices);
    const offClosed = bt.onChooserClosed(() => setDevices(null));
    return () => {
      offDevices();
      offClosed();
    };
  }, []);

  if (!devices) {
    return null;
  }

  const choose = (id: string) => {
    window.desktopBluetooth?.selectDevice(id);
    setDevices(null);
  };
  const cancel = () => {
    window.desktopBluetooth?.cancelSelect();
    setDevices(null);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Choose a Bluetooth device</Text>
          {devices.length === 0 ? (
            <Text style={styles.empty}>Scanning… make sure the watch is awake and nearby.</Text>
          ) : (
            <FlatList
              data={devices}
              keyExtractor={(d) => d.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <Pressable style={styles.device} onPress={() => choose(item.id)} testID={`ble-pick-${item.name}`}>
                  <Text style={styles.deviceName}>{item.name || '(unnamed)'}</Text>
                  <Text style={styles.deviceId}>{item.id}</Text>
                </Pressable>
              )}
            />
          )}
          <Pressable style={styles.cancel} onPress={cancel} testID="ble-pick-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2), width: 360, maxWidth: '90%' },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing(1.5) },
  empty: { color: colors.textDim, fontSize: 14, marginBottom: spacing(1) },
  device: { backgroundColor: colors.background, borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(1) },
  deviceName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  deviceId: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: spacing(1) },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
