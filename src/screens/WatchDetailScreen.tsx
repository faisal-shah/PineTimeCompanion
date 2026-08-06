import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { showAlert } from '../ui/alert';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { needsSync } from '../model/listSync';
import { managementFromStatus } from '../model/types';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { CardGrid } from '../ui/CardGrid';
import { Button } from '../ui/Button';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
import { Dialog, DialogTitle } from '../ui/Dialog';
import { useWatchOp } from '../ui/useWatchOp';
import { presentWatchOpError } from '../ui/watchOpError';
import { confirm } from '../ui/confirm';
import { WATCH_ACTIVITY_LABEL, useWatchConnectionStatus } from '../ui/useWatchConnectionStatus';
import { makeTransport } from '../ble/transportFactory';
import { readBattery, sendMessageToWatch, setWatchTime } from '../ble/syncManager';
import { readManagementStatus } from '../ble/companionPairing';
import { RepairAdvice, ON_WATCH_FORGET_ALL, decideRepair } from '../ble/repairAdvice';
import { openBluetoothSettings } from '../notifications/forwarder';
import { deleteBeaconPrivateKey } from '../secure/secrets';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchDetail'>;

// The per-watch features, each with its own screen. Large, readable rows —
// this is the watch's home hub.
type FeatureKey = 'Schedule' | 'Tasks' | 'Alarms' | 'PrayerSettings' | 'Beacon' | 'Weather' | 'Steps' | 'Notifications' | 'Update';
const FEATURES: { key: FeatureKey; icon: string; title: string; subtitle: string }[] = [
  { key: 'Schedule', icon: '🗓️', title: 'Schedule', subtitle: 'Recurring reminders' },
  { key: 'Tasks', icon: '✅', title: 'Daily tasks', subtitle: 'A checklist that resets each day' },
  { key: 'Alarms', icon: '⏰', title: 'Alarms', subtitle: 'Up to 5 daily or one-shot' },
  { key: 'PrayerSettings', icon: '🕌', title: 'Prayer times', subtitle: 'Five daily prayers' },
  { key: 'Beacon', icon: '📍', title: 'Find My', subtitle: 'Turn into a locator beacon' },
  { key: 'Weather', icon: '🌤️', title: 'Weather', subtitle: 'Push forecast to the watch' },
  { key: 'Steps', icon: '👣', title: 'Steps', subtitle: 'Daily step history' },
  { key: 'Notifications', icon: '🔔', title: 'Notifications', subtitle: 'Forward phone alerts' },
  { key: 'Update', icon: '⬆️', title: 'Update watch', subtitle: 'Firmware & resources' },
];

// Web/desktop can't drive the OS bond; walk the user through their computer.
const COMPUTER_REPAIR_STEPS =
  'On your computer, open Bluetooth settings and remove (forget) “InfiniTime”, then pick it again from the browser’s Bluetooth chooser. On Windows, remove it under Settings > Bluetooth & devices; a stale pairing can also be cleared from the registry under HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Keys.';

export function WatchDetailScreen({ navigation, route }: Props) {
  const { watches, upsertWatch, removeWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const op = useWatchOp(watch);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [repairAdvice, setRepairAdvice] = useState<RepairAdvice | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const activity = useWatchConnectionStatus(watch?.deviceId, op.busy !== null || repairing);

  if (!watch) {
    return null;
  }

  // An op running from this screen: on an authentication failure, open the
  // repair flow (which reads the watch's public status) instead of a dead-end
  // alert; everything else goes through the shared presenter.
  const onOpError = (label: string) => (e: unknown) => {
    const view = presentWatchOpError(e, { label });
    if (view.action === 'pairRepair') {
      void repairPairing();
      return;
    }
    showAlert(view.title, view.message);
  };

  const runOp = (label: string, fn: (deviceId: string) => Promise<void>) => op.run(label, fn, onOpError(label));

  const doSetTime = () =>
    runOp('Set time', async (deviceId) => {
      await setWatchTime(makeTransport(deviceId), deviceId);
      showAlert('Time set', 'Watch clock updated.');
    });

  const doBattery = () =>
    runOp('Battery', async (deviceId) => {
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
    void runOp('Message', async (deviceId) => {
      await sendMessageToWatch(makeTransport(deviceId), deviceId, 'Message', text);
      showAlert('Sent', `On its way to ${watch.name}'s watch.`);
    });
  };

  // Read the watch's public companion status, diagnose why the bond broke, and
  // record the fresh read. Computes the advice from the STORED metadata before
  // overwriting it, so a bumped reset epoch / advanced eviction is still seen.
  const repairPairing = async () => {
    if (!watch.deviceId || repairing || op.busy !== null) {
      return;
    }
    setRepairing(true);
    try {
      const res = await readManagementStatus(makeTransport(watch.deviceId), watch.deviceId, 'status');
      let current: { resetEpoch: number; evictionCount: number } | undefined;
      if (res.kind === 'ok') {
        current = { resetEpoch: res.status.resetEpoch, evictionCount: res.status.evictionCount };
      } else if (res.kind === 'error') {
        const view = presentWatchOpError(res.error, { label: 'Repair' });
        // A radio/permission problem is not a pairing problem: say so and stop.
        if (view.kind === 'bluetoothOff' || view.kind === 'permission') {
          showAlert(view.title, view.message);
          return;
        }
      }
      const advice = decideRepair(
        { resetEpoch: watch.management?.resetEpoch, evictionCount: watch.management?.evictionCount },
        current,
      );
      if (res.kind === 'ok') {
        // Persist the fresh public read; keep the last verified timestamp.
        upsertWatch({
          ...watch,
          management: { ...managementFromStatus(res.status, { verified: false }), verifiedAt: watch.management?.verifiedAt },
        });
      }
      setRepairAdvice(advice);
    } catch (e) {
      const view = presentWatchOpError(e, { label: 'Repair' });
      showAlert(view.title, view.message);
    } finally {
      setRepairing(false);
    }
  };

  const escalateToWatch = async () => {
    setRepairAdvice(null);
    await confirm({ title: ON_WATCH_FORGET_ALL.title, message: ON_WATCH_FORGET_ALL.message, confirmLabel: 'Got it' });
  };

  const paired = !!watch.deviceId;
  const lastSync = watch.lastSyncAt ? new Date(watch.lastSyncAt).toLocaleDateString() : null;

  const removeFromApp = () => {
    showAlert(
      'Remove from app?',
      `${watch.name} stays paired to your phone at the system level, but this app will stop connecting to it. Its schedule, tasks and keys on this phone are kept. Use “Repair pairing” or “Pair” to reconnect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove from app', style: 'destructive', onPress: () => upsertWatch({ ...watch, deviceId: undefined }) },
      ],
    );
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

  // Only the staged lists can be pending; alarms are compare-and-swap and
  // weather/prayer are push-only. So this is the whole mapping.
  const featurePending = (key: FeatureKey) =>
    (key === 'Schedule' && needsSync(watch.schedule)) || (key === 'Tasks' && needsSync(watch.tasks));

  const featureSubtitle = (key: FeatureKey, fallback: string) => {
    if (key === 'Schedule') {
      const n = watch.schedule.items.length;
      return `${n} event${n === 1 ? '' : 's'}`;
    }
    if (key === 'Tasks') {
      const n = watch.tasks.items.length;
      return n === 0 ? fallback : `${n} task${n === 1 ? '' : 's'} · 🔥 ${watch.taskStreak ?? 0}`;
    }
    return fallback;
  };

  const actionsDisabled = op.busy !== null || repairing;

  return (
    <>
      <Dialog visible={composeOpen} onDismiss={() => setComposeOpen(false)}>
        <View style={{ paddingBottom: keyboardHeight }}>
          <DialogTitle>Message to {watch.name}</DialogTitle>
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
      </Dialog>

      <Dialog visible={repairAdvice !== null} onDismiss={() => setRepairAdvice(null)}>
        <DialogTitle>{repairAdvice?.title ?? ''}</DialogTitle>
        <Text style={styles.repairBody}>{repairAdvice?.message ?? ''}</Text>
        {Platform.OS === 'web' && <Text style={styles.repairBody}>{COMPUTER_REPAIR_STEPS}</Text>}
        <View style={styles.repairButtons}>
          {Platform.OS !== 'web' && (
            <Pressable
              style={styles.repairPrimary}
              onPress={openBluetoothSettings}
              testID="repair-open-bt">
              <Text style={styles.repairPrimaryText}>Open Bluetooth settings</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.repairPrimary}
            onPress={() => {
              setRepairAdvice(null);
              navigation.navigate('WatchPair', { watchId: watch.id });
            }}
            testID="repair-pair-again">
            <Text style={styles.repairPrimaryText}>Pair again</Text>
          </Pressable>
        </View>
        <Pressable onPress={escalateToWatch} testID="repair-escalate">
          <Text style={styles.repairEscalate}>Still not pairing? Forget all on the watch…</Text>
        </Pressable>
        <Pressable onPress={() => setRepairAdvice(null)} style={styles.repairClose}>
          <Text style={styles.repairCloseText}>Close</Text>
        </Pressable>
      </Dialog>

      <Screen width="list">
        {/* Status strip */}
        <View style={styles.status}>
          <View style={styles.statusLeft}>
            <View style={[styles.dot, { backgroundColor: paired ? colors.accent : colors.textDim }]} />
            <Text style={styles.statusText}>{paired ? 'Paired' : 'Not paired'}</Text>
            {paired && (
              <Text style={styles.activityText} testID="watch-activity">
                · {WATCH_ACTIVITY_LABEL[activity]}
              </Text>
            )}
          </View>
          <View style={styles.statusRight}>
            {watch.batteryPercent !== undefined && <Text style={styles.statusMeta}>{watch.batteryPercent}%</Text>}
            {lastSync && <Text style={styles.statusMeta}>synced {lastSync}</Text>}
            {paired && (
              <Pressable onPress={removeFromApp} testID="remove-from-app">
                <Text style={styles.removeText}>Remove from app</Text>
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
              {featurePending(f.key) && (
                <Text style={styles.pending} testID={`pending-${f.key}`}>
                  not synced
                </Text>
              )}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </CardGrid>

        {/* Watch actions */}
        <Text style={styles.sectionLabel}>Watch</Text>
        <View style={styles.actions}>
          {paired ? (
            <ActionButton
              icon="🔧"
              label="Repair pairing"
              onPress={repairPairing}
              disabled={actionsDisabled}
              busy={repairing}
              testID="repair-pairing"
            />
          ) : (
            <ActionButton
              icon="🔗"
              label="Pair"
              onPress={() => navigation.navigate('WatchPair', { watchId: watch.id })}
              disabled={actionsDisabled}
              testID="pair"
            />
          )}
          <ActionButton icon="🕑" label="Set time" onPress={doSetTime} disabled={actionsDisabled} busy={op.busy === 'Set time'} />
          <ActionButton icon="🔋" label="Battery" onPress={doBattery} disabled={actionsDisabled} busy={op.busy === 'Battery'} />
          <ActionButton icon="✉️" label="Message" onPress={doMessage} disabled={actionsDisabled} busy={op.busy === 'Message'} />
        </View>

        <View style={styles.deleteWrap}>
          <Button label="Delete watch" variant="danger" onPress={deleteWatch} testID="delete-watch" />
        </View>
      </Screen>
    </>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  busy,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable style={[styles.action, disabled === true && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} testID={testID}>
      {busy === true ? <ActivityIndicator color={colors.accent} style={styles.actionSpinner} /> : <Text style={styles.actionIcon}>{icon}</Text>}
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(2) },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  activityText: { color: colors.textDim, fontSize: 13 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  statusMeta: { color: colors.textDim, fontSize: 13 },
  removeText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

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
  actionSpinner: { height: 26, justifyContent: 'center' },
  // stretch + textAlign so a label that wraps ("Repair pairing" at narrow
  // widths) stays centred. alignItems on the button only centres the Text box;
  // once the box fills the width, the text inside falls back to left.
  actionLabel: { color: colors.text, fontSize: 13, fontWeight: '600', alignSelf: 'stretch', textAlign: 'center', paddingHorizontal: 2 },

  pending: { color: colors.warn, fontSize: 12, marginRight: spacing(1) },
  deleteWrap: { marginTop: spacing(4) },

  repairBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: spacing(1.5) },
  repairButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1), marginTop: spacing(2) },
  repairPrimary: { flexGrow: 1, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1.5), alignItems: 'center' },
  repairPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  repairEscalate: { color: colors.warn, fontSize: 13, marginTop: spacing(2) },
  repairClose: { alignSelf: 'flex-end', marginTop: spacing(1), paddingVertical: spacing(1), paddingHorizontal: spacing(1) },
  repairCloseText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },

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
