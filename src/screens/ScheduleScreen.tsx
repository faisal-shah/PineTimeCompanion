import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore, withEvents } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { showAlert } from '../ui/alert';
import { describeRule } from '../model/types';
import { makeTransport } from '../ble/transportFactory';
import { WatchResetError, syncWatch } from '../ble/syncManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Schedule'>;

export function ScheduleScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  if (!watch) {
    return null;
  }

  const applySync = (result: Awaited<ReturnType<typeof syncWatch>>) => {
    upsertWatch({
      ...watch,
      events: result.events,
      scheduleVersion: result.base.version,
      syncedVersion: result.base.version,
      syncBase: result.base,
      capacity: result.capacity,
      lastSyncAt: new Date().toISOString(),
    });
    if (result.notices.length > 0) {
      showAlert('Merged changes from another device', result.notices.map((n) => `• ${n.title}: ${n.detail}`).join('\n'));
    } else {
      showAlert('Synced', result.skipped ? 'Watch was already up to date.' : `${result.events.length} events on the watch.`);
    }
  };

  const doSync = async () => {
    if (!watch.deviceId) {
      showAlert('Not paired', 'Pair this watch first (from the watch screen).');
      return;
    }
    const deviceId = watch.deviceId;
    setBusy(true);
    try {
      applySync(await syncWatch(makeTransport(deviceId), watch));
    } catch (e) {
      if (e instanceof WatchResetError) {
        showAlert(
          'Watch looks new or reset',
          'Its schedule is empty but this phone has synced with it before. Restore this phone’s schedule to the watch?',
          [
            {
              text: 'Start fresh (keep watch empty)',
              style: 'destructive',
              onPress: () =>
                void syncWatch(makeTransport(deviceId), { ...watch, events: [] }, true)
                  .then(applySync)
                  .catch((err) => showAlert('Sync failed', (err as Error).message)),
            },
            {
              text: 'Restore from this phone',
              onPress: () =>
                void syncWatch(makeTransport(deviceId), watch, true)
                  .then(applySync)
                  .catch((err) => showAlert('Sync failed', (err as Error).message)),
            },
          ],
        );
      } else {
        showAlert('Sync failed', (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = (eventId: number) => {
    showAlert('Delete event?', 'It will be removed from the watch at the next sync.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => upsertWatch(withEvents(watch, watch.events.filter((e) => e.id !== eventId))),
      },
    ]);
  };

  const needsSync = watch.syncBase === undefined || watch.scheduleVersion !== watch.syncBase.version;
  const capacity = watch.capacity ?? 64;
  const atCapacity = watch.events.length >= capacity;

  const addEvent = () => {
    if (atCapacity) {
      showAlert('Watch is full', `All ${capacity} event slots are used. Delete an event first (long-press one).`);
      return;
    }
    navigation.navigate('EventEdit', { watchId: watch.id });
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[...watch.events].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: spacing(2) }}
        ListEmptyComponent={<Text style={styles.empty}>No events yet. Add the first one below.</Text>}
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

      <Text style={styles.slots} testID="slots-used">
        {watch.events.length} of {capacity} slots used
      </Text>
      <View style={[styles.bottomRow, { paddingBottom: spacing(2) + insets.bottom }]}>
        <Pressable
          style={[styles.bigButton, { backgroundColor: colors.card }, atCapacity && { opacity: 0.5 }]}
          onPress={addEvent}
          testID="add-event">
          <Text style={styles.bigButtonText}>+ Event</Text>
        </Pressable>
        <Pressable
          style={[styles.bigButton, { backgroundColor: needsSync ? colors.accent : colors.accentDim }]}
          onPress={doSync}
          disabled={busy}
          testID="sync-watch">
          <Text style={styles.bigButtonText}>{busy ? 'Syncing…' : needsSync ? 'Sync' : 'Synced ✓'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6), lineHeight: 22 },
  eventCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  eventTime: { color: colors.accent, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eventTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  disabled: { color: colors.textDim, textDecorationLine: 'line-through' },
  eventRule: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  slots: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingVertical: spacing(0.5) },
  bottomRow: { flexDirection: 'row', padding: spacing(2), paddingTop: spacing(1), gap: spacing(1) },
  bigButton: { flex: 1, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
