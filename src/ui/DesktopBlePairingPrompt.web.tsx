// Passkey-pairing overlay for the Electron shell (Windows/Linux, where the OS
// doesn't provide the prompt). The watch displays a 6-digit key on its face;
// for kind 'providePin' the user types it here, for 'confirm'/'confirmPin'
// they just confirm (the pin, when given, is shown for comparison). Renders
// nothing in plain browsers or while no pairing is pending.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from './theme';

export function DesktopBlePairingPrompt() {
  const [request, setRequest] = useState<DesktopPairingRequest | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    const bt = window.desktopBluetooth;
    if (!bt) {
      return;
    }
    return bt.onPairingRequest((details) => {
      setPin('');
      setRequest(details);
    });
  }, []);

  if (!request) {
    return null;
  }

  const respond = (confirmed: boolean) => {
    window.desktopBluetooth?.respondPairing(
      confirmed && request.kind === 'providePin' ? { confirmed, pin } : { confirmed },
    );
    setRequest(null);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={() => respond(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Pair with the watch</Text>
          {request.kind === 'providePin' ? (
            <>
              <Text style={styles.body}>Type the 6-digit key shown on the watch screen.</Text>
              <TextInput
                style={styles.pinInput}
                value={pin}
                onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.textDim}
                autoFocus
                testID="ble-pair-pin"
              />
            </>
          ) : (
            <Text style={styles.body}>
              {request.pin ? `Confirm that the watch shows: ${request.pin}` : 'Confirm pairing on the watch.'}
            </Text>
          )}
          <View style={styles.row}>
            <Pressable style={styles.cancel} onPress={() => respond(false)} testID="ble-pair-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, request.kind === 'providePin' && pin.length !== 6 && { opacity: 0.4 }]}
              onPress={() => respond(true)}
              disabled={request.kind === 'providePin' && pin.length !== 6}
              testID="ble-pair-confirm">
              <Text style={styles.confirmText}>Pair</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2), width: 360, maxWidth: '90%' },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing(1) },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing(1.5) },
  pinInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    color: colors.text,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    paddingVertical: spacing(1),
    marginBottom: spacing(1.5),
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2) },
  cancel: { paddingVertical: spacing(1), paddingHorizontal: spacing(1) },
  cancelText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  confirm: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(2.5) },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
