import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { makeTransport } from '../ble/transportFactory';
import { readSteps } from '../ble/syncManager';
import { appendSteps, dateKey, getSteps, StepSample } from '../storage/stepsStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Steps'>;

const GOAL = 10000; // matches InfiniTime's default steps goal
const WINDOW_DAYS = 14;
const CHART_H = 150;

// Build a continuous last-N-days series (0 for days with no reading).
function windowSeries(history: StepSample[]): { date: string; steps: number; label: string; isToday: boolean }[] {
  const byDate = new Map(history.map((s) => [s.date, s.steps]));
  const today = dateKey();
  const out = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    out.push({ date: key, steps: byDate.get(key) ?? 0, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), isToday: key === today });
  }
  return out;
}

export function StepsScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { watches } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);

  const [history, setHistory] = useState<StepSample[]>([]);
  const [today, setToday] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null); // bar index tapped

  const refresh = useCallback(async () => {
    if (!watch) return;
    setHistory(await getSteps(watch.id)); // show stored history immediately
    if (!watch.deviceId) {
      setError('Pair this watch to read its steps.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const count = await readSteps(makeTransport(watch.deviceId), watch.deviceId);
      setToday(count);
      setHistory(await appendSteps(watch.id, dateKey(), count));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [watch]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const series = useMemo(() => windowSeries(history), [history]);
  const scaleMax = useMemo(() => Math.max(GOAL, ...series.map((d) => d.steps), 1), [series]);
  const todayCount = today ?? series.find((d) => d.isToday)?.steps ?? 0;

  if (!watch) return null;

  const sel = selected != null ? series[selected] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}>
      {/* Headline */}
      <View style={styles.hero}>
        <Text style={styles.heroSteps}>{todayCount.toLocaleString()}</Text>
        <Text style={styles.heroLabel}>steps today · goal {GOAL.toLocaleString()}</Text>
        <View style={styles.goalTrack}>
          <View style={[styles.goalFill, { width: `${Math.min(100, (todayCount / GOAL) * 100)}%` }]} />
        </View>
      </View>

      {/* Selected-bar readout (tap a bar) */}
      <Text style={styles.selReadout} testID="steps-readout">
        {sel
          ? `${new Date(sel.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} — ${sel.steps.toLocaleString()} steps`
          : 'Last 14 days — tap a bar for the count'}
      </Text>

      {/* Bar chart */}
      <View style={styles.chart}>
        <View style={[styles.goalLine, { bottom: (GOAL / scaleMax) * CHART_H }]} />
        {series.map((d, i) => (
          <Pressable key={d.date} style={styles.barCol} onPress={() => setSelected(i)} testID={`steps-bar-${i}`}>
            <View style={styles.barArea}>
              <View
                style={[
                  styles.bar,
                  { height: Math.max(d.steps > 0 ? 3 : 0, (d.steps / scaleMax) * CHART_H) },
                  d.isToday ? styles.barToday : styles.barPast,
                  selected === i && styles.barSelected,
                ]}
              />
            </View>
            <Text style={[styles.barLabel, d.isToday && styles.barLabelToday]}>{d.label}</Text>
          </Pressable>
        ))}
      </View>

      {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(2) }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.note}>
        The watch counts steps on its own; this reads today&rsquo;s total and keeps the daily history here (the watch only
        remembers today and yesterday). Refreshes each time you open this screen.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  hero: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2.5), alignItems: 'center' },
  heroSteps: { color: colors.text, fontSize: 44, fontWeight: '800' },
  heroLabel: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden', alignSelf: 'stretch', marginTop: spacing(1.5) },
  goalFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },

  selReadout: { color: colors.textDim, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: spacing(2.5), marginBottom: spacing(1) },

  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H + 20, paddingTop: spacing(0.5) },
  goalLine: { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: 1, borderTopColor: colors.accentDim, borderStyle: 'dashed', marginBottom: 20 },
  barCol: { flex: 1, alignItems: 'center', marginHorizontal: 1 },
  barArea: { height: CHART_H, justifyContent: 'flex-end', alignSelf: 'stretch', alignItems: 'center' },
  bar: { width: '78%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barPast: { backgroundColor: colors.accentDim },
  barToday: { backgroundColor: colors.accent },
  barSelected: { backgroundColor: colors.text },
  barLabel: { color: colors.textDim, fontSize: 10, marginTop: 4 },
  barLabelToday: { color: colors.text, fontWeight: '700' },

  error: { color: colors.danger, fontSize: 14, marginTop: spacing(2), textAlign: 'center' },
  note: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing(2.5) },
});
