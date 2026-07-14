import React, { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore, withEvents } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
import { describeRule } from '../model/types';
import { makeTransport } from '../ble/transportFactory';
import { WatchResetError } from '../ble/syncManager';
import { readBattery, sendMessageToWatch, setWatchTime, syncWatch } from '../ble/syncManager';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchDetail'>;

export function WatchDetailScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [busy, setBusy] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  if (!watch) {
    return null;
  }

  const withTransport = async (label: string, fn: (deviceId: string) => Promise<void>) => {
    if (!watch.deviceId) {
      Alert.alert('Not paired', 'Pair this watch first (Pair button above).');
      return;
    }
    setBusy(label);
    try {
      await fn(watch.deviceId);
    } catch (e) {
      Alert.alert(`${label} failed`, (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applySync = (result: Awaited<ReturnType<typeof syncWatch>>) => {
    upsertWatch({
      ...watch,
      events: result.events,
      scheduleVersion: result.base.version,
      syncedVersion: result.base.version,
      syncBase: result.base,
      lastSyncAt: new Date().toISOString(),
    });
    if (result.notices.length > 0) {
      Alert.alert(
        'Merged changes from another device',
        result.notices.map((n) => `• ${n.title}: ${n.detail}`).join('\n')
      );
    } else {
      Alert.alert('Synced', result.skipped ? 'Watch was already up to date.' : `${result.events.length} events on the watch.`);
    }
  };

  const doSync = () =>
    withTransport('Sync', async (deviceId) => {
      try {
        applySync(await syncWatch(makeTransport(deviceId), watch));
      } catch (e) {
        if (e instanceof WatchResetError) {
          Alert.alert(
            'Watch looks new or reset',
            'Its schedule is empty but this phone has synced with it before. Restore this phone\u2019s schedule to the watch?',
            [
              { text: 'Start fresh (keep watch empty)', style: 'destructive',
                onPress: () => void syncWatch(makeTransport(deviceId), { ...watch, events: [] }, true)
                  .then(applySync).catch((err) => Alert.alert('Sync failed', (err as Error).message)) },
              { text: 'Restore from this phone',
                onPress: () => void syncWatch(makeTransport(deviceId), watch, true)
                  .then(applySync).catch((err) => Alert.alert('Sync failed', (err as Error).message)) },
            ]
          );
          return;
        }
        throw e;
      }
    });

  const doSetTime = () =>
    withTransport('Set time', async (deviceId) => {
      await setWatchTime(makeTransport(deviceId), deviceId);
      Alert.alert('Time set', 'Watch clock updated.');
    });

  const doBattery = () =>
    withTransport('Battery', async (deviceId) => {
      const percent = await readBattery(makeTransport(deviceId), deviceId);
      upsertWatch({ ...watch, batteryPercent: percent });
    });

  const doMessage = () => {
    if (!watch.deviceId) {
      Alert.alert('Not paired', 'Pair this watch first (Pair button above).');
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
      Alert.alert('Sent', `On its way to ${watch.name}'s watch.`);
    });
  };

  const deleteEvent = (eventId: number) => {
    Alert.alert('Delete event?', 'It will be removed from the watch at the next sync.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => upsertWatch(withEvents(watch, watch.events.filter((e) => e.id !== eventId))),
      },
    ]);
  };

  const needsSync = watch.syncBase === undefined || watch.scheduleVersion !== watch.syncBase.version;

  return (
    <View style={styles.container}>
      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        {/* paddingBottom shrinks the centering area to the space above the
            keyboard so the auto-focused card stays fully visible. */}
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
      <View style={styles.toolbar}>
        <ToolbarButton
          label={watch.deviceId ? 'Re-pair' : 'Pair'}
          onPress={() => navigation.navigate('WatchPair', { watchId: watch.id })}
        />
        <ToolbarButton label="Set time" onPress={doSetTime} disabled={busy !== null} />
        <ToolbarButton label="Battery" onPress={doBattery} disabled={busy !== null} />
        <ToolbarButton label="Message" onPress={doMessage} disabled={busy !== null} />
      </View>

      <FlatList
        data={[...watch.events].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: spacing(2) }}
        ListEmptyComponent={<Text style={styles.empty}>No events. Add the first one below.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.eventCard}
            onPress={() => navigation.navigate('EventEdit', { watchId: watch.id, eventId: item.id })}
            onLongPress={() => deleteEvent(item.id)}
            testID={`event-${item.title}`}>
            <Text style={styles.eventTime}>
              {String(item.hour).padStart(2, '0')}:{String(item.minute).padStart(2, '0')}
            </Text>
            <View style={{ flex: 1, marginLeft: spacing(2) }}>
              <Text style={[styles.eventTitle, !item.enabled && styles.disabled]}>{item.title}</Text>
              <Text style={styles.eventRule}>{describeRule(item.rule)}</Text>
            </View>
          </Pressable>
        )}
      />

      <View style={[styles.bottomRow, { paddingBottom: spacing(2) + insets.bottom }]}>
        <Pressable
          style={[styles.bigButton, { backgroundColor: colors.card }]}
          onPress={() => navigation.navigate('EventEdit', { watchId: watch.id })}
          testID="add-event">
          <Text style={styles.bigButtonText}>+ Event</Text>
        </Pressable>
        <Pressable
          style={[styles.bigButton, { backgroundColor: needsSync ? colors.accent : colors.accentDim }]}
          onPress={doSync}
          disabled={busy !== null}
          testID="sync-watch">
          <Text style={styles.bigButtonText}>{busy ?? (needsSync ? 'Sync' : 'Synced ✓')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ToolbarButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.toolbarButton, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      <Text style={styles.toolbarButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', gap: spacing(1), padding: spacing(2), paddingBottom: 0 },
  toolbarButton: {
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
  },
  toolbarButtonText: { color: colors.text, fontSize: 13 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6) },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1.5),
  },
  eventTime: { color: colors.accent, fontSize: 20, fontVariant: ['tabular-nums'], fontWeight: '700' },
  eventTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  disabled: { textDecorationLine: 'line-through', color: colors.textDim },
  eventRule: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  bottomRow: { flexDirection: 'row', gap: spacing(1.5), padding: spacing(2) },
  bigButton: { flex: 1, borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  bigButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center', padding: spacing(3) },
  composeCard: { backgroundColor: colors.card, borderRadius: 16, padding: spacing(2.5), width: '100%' },
  composeTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing(1.5) },
  composeInput: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 10,
    padding: spacing(1.5),
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  composeCount: { color: colors.textDim, fontSize: 12, textAlign: 'right', marginTop: 4 },
  composeButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2), marginTop: spacing(1.5) },
  composeCancel: { paddingVertical: spacing(1), paddingHorizontal: spacing(1.5) },
  composeCancelText: { color: colors.textDim, fontSize: 15 },
  composeSend: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(3) },
  composeSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
