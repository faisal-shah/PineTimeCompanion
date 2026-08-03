import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { needsSync, syncedList, withItems } from '../model/listSync';
import { colors, spacing } from '../ui/theme';
import { useCapStyle } from '../ui/Screen';
import { Hint } from '../ui/Hint';
import { formatTime } from '../util/formatTime';
import { showAlert } from '../ui/alert';
import { useWatchOp } from '../ui/useWatchOp';
import { describeRule } from '../model/types';
import { isSpent } from '../model/recurrence';
import { makeTransport } from '../ble/transportFactory';
import { ListResetError, syncSchedule } from '../ble/listSyncManager';
import { pushWeather } from '../weather/pushWeather';

type Props = NativeStackScreenProps<RootStackParamList, 'Schedule'>;

export function ScheduleScreen({ navigation, route }: Props) {
  // One clock for the whole render, refreshed when the screen regains focus, so
  // every row agrees on what has already passed. A one-off tipping over while
  // you stare at the list is not worth a timer.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => navigation.addListener('focus', () => setNow(new Date())), [navigation]);

  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const op = useWatchOp(watch);
  const insets = useSafeAreaInsets();
  const cap = useCapStyle('read'); // events read as a list; centre + cap on wide

  if (!watch) {
    return null;
  }

  const applySync = (result: Awaited<ReturnType<typeof syncSchedule>>) => {
    upsertWatch({ ...watch, schedule: syncedList(result.base, result.digest.capacity), lastSyncAt: new Date().toISOString() });
    if (result.notices.length > 0) {
      showAlert('Merged changes from another device', result.notices.map((n) => `• ${n.title}: ${n.detail}`).join('\n'));
    } else {
      showAlert('Synced', result.skipped ? 'Watch was already up to date.' : `${result.base.items.length} events on the watch.`);
    }
  };

  const doSync = () =>
    op.run(
      'Sync',
      async (deviceId) => {
        applySync(await syncSchedule(makeTransport(deviceId), watch));
        // Refresh the watch's weather on this connect (best-effort, non-blocking).
        void pushWeather(watch).catch(() => undefined);
      },
      (e) => {
        if (!(e instanceof ListResetError)) {
          showAlert('Sync failed', (e as Error).message);
          return;
        }
        const deviceId = watch.deviceId!;
        const empty = { ...watch, schedule: { ...watch.schedule, items: [] } };
        const restore = (from: typeof watch) =>
          void syncSchedule(makeTransport(deviceId), from, true).then(applySync).catch((err) => showAlert('Sync failed', (err as Error).message));
        showAlert(
          'Watch looks new or reset',
          'Its schedule is empty but this phone has synced with it before. Restore this phone’s schedule to the watch?',
          [
            { text: 'Start fresh (keep watch empty)', style: 'destructive', onPress: () => restore(empty) },
            { text: 'Restore from this phone', onPress: () => restore(watch) },
          ],
        );
      },
    );

  const deleteEvent = (eventId: number) => {
    showAlert('Delete event?', 'It will be removed from the watch at the next sync.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => upsertWatch({ ...watch, schedule: withItems(watch.schedule, watch.schedule.items.filter((e) => e.id !== eventId)) }),
      },
    ]);
  };

  const capacity = watch.schedule.capacity ?? 64;
  const atCapacity = watch.schedule.items.length >= capacity;

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
        // flex:1 so the list scrolls; the schedule holds up to 64 events and
        // without this it is clipped by the footer instead. Same fix as Tasks.
        extraData={now}
        style={styles.list}
        data={[...watch.schedule.items].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={[{ padding: spacing(2) }, cap]}
        ListEmptyComponent={<Text style={styles.empty}>No events yet. Add the first one below.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.eventCard}
            onPress={() => navigation.navigate('EventEdit', { watchId: watch.id, eventId: item.id })}
            onLongPress={() => deleteEvent(item.id)}
            testID={`event-${item.title}`}>
            <Text style={[styles.eventTime, isSpent(item, now) && styles.spentTime]}>
              {formatTime(item.hour, item.minute)}
            </Text>
            <View style={{ flex: 1, marginLeft: spacing(2) }}>
              <Text style={[styles.eventTitle, !item.enabled && styles.disabled]}>{item.title}</Text>
              <Text style={styles.eventRule}>{describeRule(item.rule)}</Text>
            </View>
            {/* A one-off that has been and gone will never fire again; it is
                just holding one of the 64 slots. Say so, so it is obvious what
                is safe to long-press away. */}
            {isSpent(item, now) && (
              <View style={styles.spentBadge} testID={`spent-${item.title}`}>
                <Text style={styles.spentBadgeText}>PASSED</Text>
              </View>
            )}
          </Pressable>
        )}
      />

      <Text style={styles.slots} testID="slots-used">
        {watch.schedule.items.length} of {capacity} slots used
      </Text>
      <Hint center>Tap an event to edit it · press and hold to delete</Hint>
      <View style={[styles.bottomRow, cap, { paddingBottom: spacing(2) + insets.bottom }]}>
        <Pressable
          style={[styles.bigButton, { backgroundColor: colors.card }, atCapacity && { opacity: 0.5 }]}
          onPress={addEvent}
          testID="add-event">
          <Text style={styles.bigButtonText}>+ Event</Text>
        </Pressable>
        <Pressable
          style={[styles.bigButton, { backgroundColor: needsSync(watch.schedule) ? colors.accent : colors.accentDim }]}
          onPress={doSync}
          disabled={op.busy !== null}
          testID="sync-watch">
          {op.busy !== null ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.onAccent} />
              <Text style={styles.bigButtonText}>Syncing…</Text>
            </View>
          ) : (
            <Text style={styles.bigButtonText}>{needsSync(watch.schedule) ? 'Sync' : 'Synced ✓'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6), lineHeight: 22 },
  eventCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  eventTime: { color: colors.accent, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eventTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  disabled: { color: colors.textDim, textDecorationLine: 'line-through' },
  spentTime: { color: colors.textDim },
  spentBadge: { backgroundColor: colors.warn, borderRadius: 6, paddingHorizontal: spacing(0.75), paddingVertical: 2, marginLeft: spacing(1) },
  spentBadgeText: { color: colors.background, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  eventRule: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  slots: { color: colors.textDim, fontSize: 13, textAlign: 'center', paddingVertical: spacing(0.5) },
  bottomRow: { flexDirection: 'row', padding: spacing(2), paddingTop: spacing(1), gap: spacing(1) },
  bigButton: { flex: 1, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
