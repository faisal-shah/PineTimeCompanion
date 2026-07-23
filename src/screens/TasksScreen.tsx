import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore, withTasks, newTaskId } from '../storage/store';
import { WatchTask } from '../model/types';
import { colors, spacing } from '../ui/theme';
import { useCapStyle } from '../ui/Screen';
import { showAlert } from '../ui/alert';
import { makeTransport } from '../ble/transportFactory';
import { TaskResetError, syncTasks, setTaskStreak } from '../ble/syncManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Tasks'>;

const MAX_TITLE = 23; // 24-byte on-watch field, NUL-terminated

export function TasksScreen({ route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const [busy, setBusy] = useState(false);
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

  const tasks = [...(watch.tasks ?? [])].sort((a, b) => a.order - b.order || a.id - b.id);
  const capacity = watch.taskCapacity ?? 20;
  const atCapacity = tasks.length >= capacity;
  const needsSync = watch.taskSyncBase === undefined || (watch.taskVersion ?? 1) !== watch.taskSyncBase.version;
  const streak = watch.taskStreak ?? 0;

  const save = (next: WatchTask[]) => upsertWatch(withTasks(watch, next));

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
    save([...tasks, { id: newTaskId(watch), title: title.slice(0, MAX_TITLE), order, lastModified: Date.now() }]);
    setNewTitle('');
  };

  const commitRename = () => {
    const title = editText.trim();
    if (editing && title) {
      save(tasks.map((t) => (t.id === editing.id ? { ...t, title: title.slice(0, MAX_TITLE), lastModified: Date.now() } : t)));
    }
    setEditing(null);
  };

  const remove = (task: WatchTask) => {
    showAlert('Delete task?', `“${task.title}” will be removed from the watch at the next sync.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => save(tasks.filter((t) => t.id !== task.id)) },
    ]);
  };

  // Reorder by swapping the two tasks' order fields (both count as edits).
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= tasks.length) {
      return;
    }
    const a = tasks[index];
    const b = tasks[j];
    const now = Date.now();
    save(
      tasks.map((t) => {
        if (t.id === a.id) return { ...t, order: b.order, lastModified: now };
        if (t.id === b.id) return { ...t, order: a.order, lastModified: now };
        return t;
      }),
    );
  };

  const applySync = (result: Awaited<ReturnType<typeof syncTasks>>) => {
    upsertWatch({
      ...watch,
      tasks: result.tasks,
      taskVersion: result.base.version,
      taskSyncedVersion: result.base.version,
      taskSyncBase: result.base,
      taskCapacity: result.capacity,
      taskStreak: result.streak,
      lastSyncAt: new Date().toISOString(),
    });
    if (result.notices.length > 0) {
      showAlert('Merged changes from another device', result.notices.map((n) => `• ${n.title}: ${n.detail}`).join('\n'));
    } else {
      showAlert('Synced', result.skipped ? 'Watch was already up to date.' : `${result.tasks.length} tasks on the watch · streak ${result.streak}.`);
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
      applySync(await syncTasks(makeTransport(deviceId), watch));
    } catch (e) {
      if (e instanceof TaskResetError) {
        showAlert('Watch looks new or reset', 'Its task list is empty but this phone has synced with it before. Restore this phone’s tasks to the watch?', [
          {
            text: 'Start fresh (keep watch empty)',
            style: 'destructive',
            onPress: () => void syncTasks(makeTransport(deviceId), { ...watch, tasks: [] }, true).then(applySync).catch((err) => showAlert('Sync failed', (err as Error).message)),
          },
          {
            text: 'Restore from this phone',
            onPress: () => void syncTasks(makeTransport(deviceId), watch, true).then(applySync).catch((err) => showAlert('Sync failed', (err as Error).message)),
          },
        ]);
      } else {
        showAlert('Sync failed', (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveStreak = async () => {
    const value = Math.max(0, Math.min(0xffff, parseInt(streakText, 10) || 0));
    setStreakOpen(false);
    if (!watch.deviceId) {
      showAlert('Not paired', 'Pair this watch first to change the streak.');
      return;
    }
    setBusy(true);
    try {
      await setTaskStreak(makeTransport(watch.deviceId), watch.deviceId, value);
      upsertWatch({ ...watch, taskStreak: value });
    } catch (e) {
      showAlert('Streak update failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={[{ padding: spacing(2) }, cap]}
        ListEmptyComponent={<Text style={styles.empty}>No tasks yet. Add the first one below.{'\n'}The watch shows them every day to tick off.</Text>}
        ListHeaderComponent={
          <Pressable style={styles.streakRow} onPress={() => { setStreakText(String(streak)); setStreakOpen(true); }} testID="streak-row">
            <Text style={styles.streakLabel}>🔥 Streak</Text>
            <Text style={styles.streakValue}>{streak} day{streak === 1 ? '' : 's'}</Text>
            <Text style={styles.streakEdit}>Edit</Text>
          </Pressable>
        }
        renderItem={({ item, index }) => (
          <View style={styles.taskCard}>
            <Pressable style={styles.taskMain} onPress={() => { setEditing(item); setEditText(item.title); }} onLongPress={() => remove(item)} testID={`task-${item.title}`}>
              <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
            </Pressable>
            <Pressable style={styles.arrow} onPress={() => move(index, -1)} disabled={index === 0} testID={`up-${item.title}`}>
              <Text style={[styles.arrowText, index === 0 && styles.arrowDisabled]}>▲</Text>
            </Pressable>
            <Pressable style={styles.arrow} onPress={() => move(index, 1)} disabled={index === tasks.length - 1} testID={`down-${item.title}`}>
              <Text style={[styles.arrowText, index === tasks.length - 1 && styles.arrowDisabled]}>▼</Text>
            </Pressable>
          </View>
        )}
      />

      <Text style={styles.slots} testID="slots-used">{tasks.length} of {capacity} tasks · tap to rename, long-press to delete</Text>

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
        <Pressable style={[styles.syncBtn, { backgroundColor: needsSync ? colors.accent : colors.accentDim }]} onPress={doSync} disabled={busy} testID="sync-tasks">
          <Text style={styles.syncBtnText}>{busy ? 'Working…' : needsSync ? 'Sync to watch' : 'Synced ✓'}</Text>
        </Pressable>
      </View>

      <TextPromptModal
        visible={editing !== null}
        title="Rename task"
        value={editText}
        onChangeText={setEditText}
        maxLength={MAX_TITLE}
        onCancel={() => setEditing(null)}
        onConfirm={commitRename}
      />
      <TextPromptModal
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

function TextPromptModal(props: {
  visible: boolean;
  title: string;
  subtitle?: string;
  value: string;
  onChangeText: (t: string) => void;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={props.onCancel}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          {props.subtitle ? <Text style={styles.modalSubtitle}>{props.subtitle}</Text> : null}
          <TextInput
            style={styles.modalInput}
            value={props.value}
            onChangeText={props.onChangeText}
            maxLength={props.maxLength}
            keyboardType={props.keyboardType ?? 'default'}
            autoFocus
            onSubmitEditing={props.onConfirm}
            returnKeyType="done"
            testID="prompt-input"
          />
          <View style={styles.modalButtons}>
            <Pressable style={styles.modalBtn} onPress={props.onCancel}>
              <Text style={styles.modalBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, { backgroundColor: colors.accent }]} onPress={props.onConfirm} testID="prompt-confirm">
              <Text style={[styles.modalBtnText, { color: '#fff' }]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(6), lineHeight: 22 },
  streakRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  streakLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  streakValue: { color: colors.accent, fontSize: 16, fontWeight: '700', marginLeft: spacing(1), flex: 1 },
  streakEdit: { color: colors.textDim, fontSize: 14 },
  taskCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, marginBottom: spacing(1) },
  taskMain: { flex: 1, padding: spacing(2) },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  arrow: { paddingHorizontal: spacing(1.5), paddingVertical: spacing(2) },
  arrowText: { color: colors.accent, fontSize: 16 },
  arrowDisabled: { color: colors.textDim, opacity: 0.4 },
  slots: { color: colors.textDim, fontSize: 12, textAlign: 'center', paddingVertical: spacing(0.5) },
  footer: { padding: spacing(2), paddingTop: spacing(1), gap: spacing(1) },
  addRow: { flexDirection: 'row', gap: spacing(1) },
  addInput: { flex: 1, height: 48, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: spacing(2), color: colors.text, fontSize: 16 },
  addBtn: { width: 72, height: 48, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  syncBtn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing(3) },
  modalCard: { backgroundColor: colors.card, borderRadius: 16, padding: spacing(3) },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalSubtitle: { color: colors.textDim, fontSize: 13, marginTop: spacing(0.5), lineHeight: 18 },
  modalInput: { height: 48, backgroundColor: colors.background, borderRadius: 12, paddingHorizontal: spacing(2), color: colors.text, fontSize: 16, marginTop: spacing(2) },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(1), marginTop: spacing(2) },
  modalBtn: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: 10 },
  modalBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
