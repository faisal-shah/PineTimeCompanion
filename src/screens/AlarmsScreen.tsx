import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { showAlert } from '../ui/alert';
import { makeTransport } from '../ble/transportFactory';
import { Alarm, MultiAlarmState } from '../ble/multiAlarmProtocol';
import { readAlarms, setAlarm, setAlarmEnabled } from '../ble/multiAlarmSync';

type Props = NativeStackScreenProps<RootStackParamList, 'Alarms'>;

const pad = (n: number) => String(n).padStart(2, '0');

export function AlarmsScreen({ route }: Props) {
  const { watches } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);

  const [state, setState] = useState<MultiAlarmState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftHour, setDraftHour] = useState('0');
  const [draftMinute, setDraftMinute] = useState('0');
  const [draftDaily, setDraftDaily] = useState(false);

  const load = useCallback(async () => {
    if (!watch?.deviceId) {
      return;
    }
    setBusy('Loading');
    try {
      setState(await readAlarms(makeTransport(watch.deviceId), watch.deviceId));
    } catch (e) {
      showAlert('Could not load alarms', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [watch?.deviceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!watch) {
    return null;
  }
  if (!watch.deviceId) {
    return (
      <Screen width="read">
        <Text style={styles.hint}>Pair this watch first (from its watch screen) to manage alarms.</Text>
      </Screen>
    );
  }

  const runEdit = async (index: number, next: Alarm) => {
    setBusy('Saving');
    try {
      setState(await setAlarm(makeTransport(watch.deviceId!), watch.deviceId!, index, next));
      setEditing(null);
    } catch (e) {
      showAlert('Save failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (index: number, enabled: boolean) => {
    setBusy('Saving');
    try {
      setState(await setAlarmEnabled(makeTransport(watch.deviceId!), watch.deviceId!, index, enabled));
    } catch (e) {
      showAlert('Save failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openEditor = (index: number, alarm: Alarm) => {
    setDraftHour(String(alarm.hour));
    setDraftMinute(String(alarm.minute));
    setDraftDaily(alarm.mode === 'daily');
    setEditing(index);
  };

  const saveEditor = () => {
    if (editing === null) {
      return;
    }
    const hour = Math.max(0, Math.min(23, parseInt(draftHour, 10) || 0));
    const minute = Math.max(0, Math.min(59, parseInt(draftMinute, 10) || 0));
    // Editing an alarm enables it (matches the on-watch editor).
    void runEdit(editing, { hour, minute, mode: draftDaily ? 'daily' : 'once', enabled: true });
  };

  return (
    <Screen width="read">
      <Text style={styles.body}>
        Up to 5 alarms, each daily or one-shot. Managed on the watch — edits here sync over Bluetooth and won't clobber
        another phone's changes.
      </Text>

      {state === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>{busy === 'Loading' ? 'Reading alarms from the watch…' : 'No data'}</Text>
        </View>
      ) : (
        state.alarms.map((alarm, index) =>
          editing === index ? (
            <View key={index} style={styles.card} testID={`alarm-editor-${index}`}>
              <View style={styles.editRow}>
                <TextInput
                  style={styles.timeInput}
                  value={draftHour}
                  onChangeText={(t) => setDraftHour(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                  testID={`alarm-hour-${index}`}
                />
                <Text style={styles.colon}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  value={draftMinute}
                  onChangeText={(t) => setDraftMinute(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                  testID={`alarm-minute-${index}`}
                />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.modeLabel}>Repeat daily</Text>
                <Switch
                  value={draftDaily}
                  onValueChange={setDraftDaily}
                  trackColor={{ true: colors.accent }}
                  testID={`alarm-daily-${index}`}
                />
              </View>
              <View style={styles.editButtons}>
                <Pressable style={styles.secondary} onPress={() => setEditing(null)}>
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.save} onPress={saveEditor} disabled={busy !== null} testID={`alarm-save-${index}`}>
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={index} style={styles.row} testID={`alarm-row-${index}`}>
              <Switch
                value={alarm.enabled}
                onValueChange={(v) => toggle(index, v)}
                disabled={busy !== null}
                trackColor={{ true: colors.accent }}
                testID={`alarm-toggle-${index}`}
              />
              <Pressable style={styles.rowMain} onPress={() => openEditor(index, alarm)} testID={`alarm-edit-${index}`}>
                <Text style={[styles.time, !alarm.enabled && styles.dim]}>
                  {pad(alarm.hour)}:{pad(alarm.minute)}
                </Text>
                <Text style={styles.mode}>{alarm.mode === 'daily' ? 'Daily' : 'Once'}</Text>
              </Pressable>
            </View>
          ),
        )
      )}

      {busy === 'Saving' && <Text style={styles.hint}>Syncing to the watch…</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing(2) },
  center: { alignItems: 'center', marginTop: spacing(4), gap: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing(1.5),
    marginBottom: spacing(1),
    gap: spacing(2),
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  time: { color: colors.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dim: { color: colors.textDim },
  mode: { color: colors.textDim, fontSize: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1) },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(1.5) },
  timeInput: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 10,
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    width: 90,
    paddingVertical: spacing(1),
  },
  colon: { color: colors.text, fontSize: 34, fontWeight: '700', marginHorizontal: spacing(1) },
  modeLabel: { color: colors.text, fontSize: 16 },
  editButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2), marginTop: spacing(1) },
  secondary: { paddingVertical: spacing(1), paddingHorizontal: spacing(2) },
  secondaryText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  save: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(3) },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: spacing(1) },
});
