import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { useWatchStore } from '../storage/store';
import { WatchTask } from '../model/types';
import { needsSync as listNeedsSync, newItemId, syncedList, withItems } from '../model/listSync';
import { colors, spacing } from '../ui/theme';
import { Hint } from '../ui/Hint';
import { KeyboardStickyFooter } from '../ui/keyboard';
import { useCapStyle } from '../ui/Screen';
import { showAlert } from '../ui/alert';
import { TextPrompt } from '../ui/Dialog';
import { useWatchOp } from '../ui/useWatchOp';
import { makeTransport } from '../ble/transportFactory';
import { ListResetError, syncTasks, setTaskStreak } from '../ble/listSyncManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Tasks'>;

const MAX_TITLE = 23; // 24-byte on-watch field, NUL-terminated
const nowSec = () => Math.floor(Date.now() / 1000); // lastModified is UNIX seconds (like the sync base)

export function TasksScreen({ route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const op = useWatchOp(watch);
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<WatchTask | null>(null);
  const [editText, setEditText] = useState('');
  const [streakOpen, setStreakOpen] = useState(false);
  const [streakText, setStreakText] = useState('');
  const insets = useSafeAreaInsets();
  const cap = useCapStyle('read');

  if (!watch) {
    return null;
  }

  const tasks = [...watch.tasks.items].sort((a, b) => a.order - b.order || a.id - b.id);
  const capacity = watch.tasks.capacity ?? 20;
  const atCapacity = tasks.length >= capacity;
  const needsSync = listNeedsSync(watch.tasks);
  const streak = watch.taskStreak ?? 0;

  const save = (next: WatchTask[]) => upsertWatch({ ...watch, tasks: withItems(watch.tasks, next) });

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    if (atCapacity) {
      showAlert('List is full', `All ${capacity} task slots are used. Delete one first (long-press it).`);
      return;
    }
    const order = tasks.length ? Math.max(...tasks.map((t) => t.order)) + 1 : 0;
    save([...tasks, { id: newItemId(watch.tasks.items), title: title.slice(0, MAX_TITLE), order, lastModified: nowSec() }]);
    setNewTitle('');
  };

  const commitRename = () => {
    const title = editText.trim();
    if (editing && title) {
      save(tasks.map((t) => (t.id === editing.id ? { ...t, title: title.slice(0, MAX_TITLE), lastModified: nowSec() } : t)));
    }
    setEditing(null);
  };

  const remove = (task: WatchTask) => {
    showAlert('Delete task?', `“${task.title}” will be removed from the watch at the next sync.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => save(tasks.filter((t) => t.id !== task.id)) },
    ]);
  };

  // Renumber to the dropped positions. Only rows whose order actually moved are
  // restamped, so a drag doesn't mark the whole list as edited for the merge.
  const reorder = (dropped: WatchTask[]) => {
    const now = nowSec();
    save(dropped.map((t, i) => (t.order === i ? t : { ...t, order: i, lastModified: now })));
  };

  const applySync = (result: Awaited<ReturnType<typeof syncTasks>>) => {
    upsertWatch({
      ...watch,
      tasks: syncedList(result.base, result.digest.capacity),
      taskStreak: result.digest.streak,
      lastSyncAt: new Date().toISOString(),
    });
    if (result.notices.length > 0) {
      showAlert('Merged changes from another device', result.notices.map((n) => `• ${n.title}: ${n.detail}`).join('\n'));
    } else {
      showAlert('Synced', result.skipped ? 'Watch was already up to date.' : `${result.base.items.length} tasks on the watch · streak ${result.digest.streak}.`);
    }
  };

  const doSync = () =>
    op.run(
      'Sync',
      async (deviceId) => applySync(await syncTasks(makeTransport(deviceId), watch)),
      (e) => {
        if (!(e instanceof ListResetError)) {
          showAlert('Sync failed', (e as Error).message);
          return;
        }
        const deviceId = watch.deviceId!;
        const empty = { ...watch, tasks: { ...watch.tasks, items: [] } };
        const restore = (from: typeof watch) =>
          void syncTasks(makeTransport(deviceId), from, true).then(applySync).catch((err) => showAlert('Sync failed', (err as Error).message));
        showAlert('Watch looks new or reset', 'Its task list is empty but this phone has synced with it before. Restore this phone’s tasks to the watch?', [
          { text: 'Start fresh (keep watch empty)', style: 'destructive', onPress: () => restore(empty) },
          { text: 'Restore from this phone', onPress: () => restore(watch) },
        ]);
      },
    );

  const saveStreak = () => {
    const value = Math.max(0, Math.min(0xffff, parseInt(streakText, 10) || 0));
    setStreakOpen(false); // op.busy drives the sync button's spinner from here
    return op.run('Streak update', async (deviceId) => {
      await setTaskStreak(makeTransport(deviceId), deviceId, value);
      upsertWatch({ ...watch, taskStreak: value });
    });
  };

  return (
    <View style={styles.container}>
      <DraggableFlatList
        // flex:1 so the list itself scrolls. Without it the list sizes to its
        // content inside this flex column and simply gets squeezed by the
        // footer once there are more rows than fit -- 20 tasks are allowed and
        // only about 8 were reachable.
        // containerStyle, NOT style: `style` goes to the inner list, so flex:1
        // there collapses the whole thing to zero height. The OUTER container is
        // what has to claim the leftover space for the list to scroll.
        containerStyle={styles.list}
        // Without this the first tap while the keyboard is up only dismisses it,
        // so the button under your finger never fires.
        keyboardShouldPersistTaps="handled"
        data={tasks}
        keyExtractor={(t) => String(t.id)}
        onDragEnd={({ data }) => reorder(data)}
        contentContainerStyle={[{ padding: spacing(2) }, cap]}
        ListEmptyComponent={<Text style={styles.empty}>No tasks yet. Add the first one below.{'\n'}The watch shows them every day to tick off.</Text>}
        ListHeaderComponent={
          <Pressable style={styles.streakRow} onPress={() => { setStreakText(String(streak)); setStreakOpen(true); }} testID="streak-row">
            <Text style={styles.streakLabel}>🔥 Streak</Text>
            <Text style={styles.streakValue}>{streak} day{streak === 1 ? '' : 's'}</Text>
            <Text style={styles.streakEdit}>Edit</Text>
          </Pressable>
        }
        renderItem={({ item, drag, isActive }: RenderItemParams<WatchTask>) => (
          <View style={[styles.taskCard, isActive && styles.taskCardActive]}>
            <Pressable style={styles.taskMain} onPress={() => { setEditing(item); setEditText(item.title); }} onLongPress={() => remove(item)} testID={`task-${item.title}`}>
              <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
            </Pressable>
            <Pressable style={styles.handle} onPressIn={drag} testID={`drag-${item.title}`} accessibilityLabel={`Reorder ${item.title}`}>
              <Text style={styles.handleText}>≡</Text>
            </Pressable>
          </View>
        )}
      />

      <Text style={styles.slots} testID="slots-used">{tasks.length} of {capacity} tasks</Text>
      <Hint center>Tap a task to rename it · press and hold to delete · drag the handle to reorder</Hint>

      {/* Rides the IME so the compose row and Sync button stay reachable. */}
      <KeyboardStickyFooter>
        <View style={[styles.footer, cap, { paddingBottom: spacing(2) + insets.bottom }]}>
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="New task…"
            placeholderTextColor={colors.textDim}
            maxLength={MAX_TITLE}
            onSubmitEditing={addTask}
            returnKeyType="done"
            testID="new-task-input"
          />
          <Pressable style={[styles.addBtn, (atCapacity || !newTitle.trim()) && { opacity: 0.4 }]} onPress={addTask} testID="add-task">
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.syncBtn, { backgroundColor: needsSync ? colors.accent : colors.accentDim }]} onPress={doSync} disabled={op.busy !== null} testID="sync-tasks">
          {op.busy !== null ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.onAccent} />
              <Text style={styles.syncBtnText}>{op.busy}…</Text>
            </View>
          ) : (
            <Text style={styles.syncBtnText}>{needsSync ? 'Sync to watch' : 'Synced ✓'}</Text>
          )}
        </Pressable>
      </View>
      </KeyboardStickyFooter>

      <TextPrompt
        visible={editing !== null}
        title="Rename task"
        value={editText}
        onChangeText={setEditText}
        maxLength={MAX_TITLE}
        onCancel={() => setEditing(null)}
        onConfirm={commitRename}
      />
      <TextPrompt
        visible={streakOpen}
        title="Set streak"
        subtitle="Consecutive all-done days shown on the watch."
        value={streakText}
        onChangeText={setStreakText}
        keyboardType="number-pad"
        onCancel={() => setStreakOpen(false)}
        onConfirm={saveStreak}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6), lineHeight: 22 },
  streakRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  streakLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  streakValue: { color: colors.accent, fontSize: 16, fontWeight: '700', marginLeft: spacing(1), flex: 1 },
  streakEdit: { color: colors.textDim, fontSize: 14 },
  taskCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, marginBottom: spacing(1) },
  taskMain: { flex: 1, padding: spacing(2) },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  taskCardActive: { opacity: 0.92, borderWidth: 1, borderColor: colors.accent },
  handle: { paddingHorizontal: spacing(2), paddingVertical: spacing(2) },
  handleText: { color: colors.textDim, fontSize: 22, lineHeight: 24 },
  slots: { color: colors.textDim, fontSize: 12, textAlign: 'center', paddingVertical: spacing(0.5) },
  footer: { padding: spacing(2), paddingTop: spacing(1), gap: spacing(1) },
  addRow: { flexDirection: 'row', gap: spacing(1) },
  addInput: { flex: 1, height: 48, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: spacing(2), color: colors.text, fontSize: 16 },
  addBtn: { width: 72, height: 48, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  syncBtn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
