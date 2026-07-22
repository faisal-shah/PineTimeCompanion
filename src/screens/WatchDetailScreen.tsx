import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { showAlert } from '../ui/alert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { CardGrid } from '../ui/CardGrid';
import { Button } from '../ui/Button';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
import { makeTransport } from '../ble/transportFactory';
import { readBattery, sendMessageToWatch, setWatchTime } from '../ble/syncManager';
import { deleteBeaconPrivateKey } from '../secure/secrets';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchDetail'>;

// The four peer features, each with its own screen. Large, readable rows —
// this is the watch's home hub.
type FeatureKey = 'Schedule' | 'Alarms' | 'PrayerSettings' | 'Beacon' | 'Weather' | 'Steps' | 'Notifications' | 'Update';
const FEATURES: { key: FeatureKey; icon: string; title: string; subtitle: string }[] = [
  { key: 'Schedule', icon: '🗓️', title: 'Schedule', subtitle: 'Recurring reminders' },
  { key: 'Alarms', icon: '⏰', title: 'Alarms', subtitle: 'Up to 5 daily or one-shot' },
  { key: 'PrayerSettings', icon: '🕌', title: 'Prayer times', subtitle: 'Five daily prayers' },
  { key: 'Beacon', icon: '📍', title: 'Find My', subtitle: 'Turn into a locator beacon' },
  { key: 'Weather', icon: '🌤️', title: 'Weather', subtitle: 'Push forecast to the watch' },
  { key: 'Steps', icon: '👣', title: 'Steps', subtitle: 'Daily step history' },
  { key: 'Notifications', icon: '🔔', title: 'Notifications', subtitle: 'Forward phone alerts' },
  { key: 'Update', icon: '⬆️', title: 'Update watch', subtitle: 'Firmware & resources' },
];

export function WatchDetailScreen({ navigation, route }: Props) {
  const { watches, upsertWatch, removeWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [busy, setBusy] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const keyboardHeight = useKeyboardHeight();

  if (!watch) {
    return null;
  }

  const withTransport = async (label: string, fn: (deviceId: string) => Promise<void>) => {
    if (!watch.deviceId) {
      showAlert('Not paired', 'Pair this watch first.');
      return;
    }
    setBusy(label);
    try {
      await fn(watch.deviceId);
    } catch (e) {
      showAlert(`${label} failed`, (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doSetTime = () =>
    withTransport('Set time', async (deviceId) => {
      await setWatchTime(makeTransport(deviceId), deviceId);
      showAlert('Time set', 'Watch clock updated.');
    });

  const doBattery = () =>
    withTransport('Battery', async (deviceId) => {
      const percent = await readBattery(makeTransport(deviceId), deviceId);
      upsertWatch({ ...watch, batteryPercent: percent });
    });

  const doMessage = () => {
    if (!watch.deviceId) {
      showAlert('Not paired', 'Pair this watch first.');
      return;
    }
    setComposeText('');
    setComposeOpen(true);
  };

  const sendComposed = () => {
    const text = composeText.trim();
    if (!text) {
      return;
    }
    setComposeOpen(false);
    void withTransport('Message', async (deviceId) => {
      await sendMessageToWatch(makeTransport(deviceId), deviceId, 'Message', text);
      showAlert('Sent', `On its way to ${watch.name}'s watch.`);
    });
  };

  const paired = !!watch.deviceId;
  const lastSync = watch.lastSyncAt ? new Date(watch.lastSyncAt).toLocaleDateString() : null;

  const unpair = () => {
    showAlert('Unpair this watch?', `${watch.name} will be forgotten as a connection. The watch itself keeps its data; you can pair again anytime.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpair', style: 'destructive', onPress: () => upsertWatch({ ...watch, deviceId: undefined }) },
    ]);
  };

  const deleteWatch = () => {
    showAlert('Delete this watch?', `Removes ${watch.name} and its schedule/keys from this phone. The physical watch is not affected. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteBeaconPrivateKey(watch.id).catch(() => undefined); // best-effort secret cleanup
          removeWatch(watch.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const featureSubtitle = (key: FeatureKey, fallback: string) =>
    key === 'Schedule'
      ? `${watch.events.length} event${watch.events.length === 1 ? '' : 's'}`
      : fallback;

  return (
    <>
      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]}>
          <View style={styles.composeCard}>
            <Text style={styles.composeTitle}>Message to {watch.name}</Text>
            <TextInput
              style={styles.composeInput}
              value={composeText}
              onChangeText={setComposeText}
              placeholder="e.g. Come down for dinner"
              placeholderTextColor={colors.textDim}
              multiline
              maxLength={90}
              autoFocus
              testID="compose-text"
            />
            <Text style={styles.composeCount}>{composeText.trim().length}/90</Text>
            <View style={styles.composeButtons}>
              <Pressable style={styles.composeCancel} onPress={() => setComposeOpen(false)}>
                <Text style={styles.composeCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.composeSend, !composeText.trim() && { opacity: 0.4 }]}
                onPress={sendComposed}
                disabled={!composeText.trim()}
                testID="compose-send">
                <Text style={styles.composeSendText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Screen width="list">
        {/* Status strip */}
        <View style={styles.status}>
          <View style={styles.statusLeft}>
            <View style={[styles.dot, { backgroundColor: paired ? colors.accent : colors.textDim }]} />
            <Text style={styles.statusText}>{paired ? 'Paired' : 'Not paired'}</Text>
          </View>
          <View style={styles.statusRight}>
            {watch.batteryPercent !== undefined && <Text style={styles.statusMeta}>{watch.batteryPercent}%</Text>}
            {lastSync && <Text style={styles.statusMeta}>synced {lastSync}</Text>}
            {paired && (
              <Pressable onPress={unpair} testID="unpair">
                <Text style={styles.unpairText}>Unpair</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Feature peers — a responsive grid: multi-column on a wide screen, one
            full-width column on a phone. */}
        <CardGrid>
          {FEATURES.map((f) => (
            <Pressable
              key={f.key}
              style={styles.featureRow}
              onPress={() => navigation.navigate(f.key, { watchId: watch.id })}
              testID={`feature-${f.key}`}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureSubtitle}>{featureSubtitle(f.key, f.subtitle)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </CardGrid>

        {/* Watch actions */}
        <Text style={styles.sectionLabel}>Watch</Text>
        <View style={styles.actions}>
          <ActionButton
            icon="🔗"
            label={paired ? 'Re-pair' : 'Pair'}
            onPress={() => navigation.navigate('WatchPair', { watchId: watch.id })}
          />
          <ActionButton icon="🕑" label={busy === 'Set time' ? '…' : 'Set time'} onPress={doSetTime} disabled={busy !== null} />
          <ActionButton icon="🔋" label={busy === 'Battery' ? '…' : 'Battery'} onPress={doBattery} disabled={busy !== null} />
          <ActionButton icon="✉️" label="Message" onPress={doMessage} disabled={busy !== null} />
        </View>

        <View style={styles.deleteWrap}>
          <Button label="Delete watch" variant="danger" onPress={deleteWatch} testID="delete-watch" />
        </View>
      </Screen>
    </>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.action, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(2) },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  statusMeta: { color: colors.textDim, fontSize: 13 },
  unpairText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(2),
  },
  featureIcon: { fontSize: 28, width: 44, textAlign: 'center' },
  featureBody: { flex: 1, marginLeft: spacing(1) },
  featureTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  featureSubtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 28, marginLeft: spacing(1) },

  sectionLabel: {
    color: colors.textDim,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing(2),
    marginBottom: spacing(1),
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  action: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 74,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    gap: 4,
  },
  actionIcon: { fontSize: 22 },
  actionLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },

  deleteWrap: { marginTop: spacing(4) },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing(2) },
  composeCard: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2), width: '100%', maxWidth: 420 },
  composeTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing(1.5) },
  composeInput: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 10,
    padding: spacing(1.5),
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  composeCount: { color: colors.textDim, fontSize: 12, textAlign: 'right', marginTop: spacing(0.5) },
  composeButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2), marginTop: spacing(1) },
  composeCancel: { paddingVertical: spacing(1), paddingHorizontal: spacing(1) },
  composeCancelText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  composeSend: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(3) },
  composeSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
