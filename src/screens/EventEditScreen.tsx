import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { newEventId, useWatchStore, withEvents } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { RuleKind, WEEKDAY_LABELS, WatchEvent } from '../model/types';
import { upcoming } from '../model/recurrence';

type Props = NativeStackScreenProps<RootStackParamList, 'EventEdit'>;

const RULE_OPTIONS: { kind: RuleKind; label: string }[] = [
  { kind: 'once', label: 'Once' },
  { kind: 'everyNDays', label: 'Every N days' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'monthly', label: 'Monthly' },
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function EventEditScreen({ navigation, route }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const existing = watch?.events.find((e) => e.id === route.params.eventId);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [hour, setHour] = useState(existing?.hour ?? 8);
  const [minute, setMinute] = useState(existing?.minute ?? 0);
  const [kind, setKind] = useState<RuleKind>(existing?.rule.kind ?? 'everyNDays');
  const [intervalDays, setIntervalDays] = useState(existing?.rule.intervalDays ?? 1);
  const [weekdayMask, setWeekdayMask] = useState(existing?.rule.weekdayMask ?? 0x3e); // Mon-Fri
  const [dayOfMonth, setDayOfMonth] = useState(existing?.rule.dayOfMonth ?? 1);
  const [anchorDate, setAnchorDate] = useState(existing?.anchorDate ?? todayIso());
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const draft: WatchEvent = useMemo(
    () => ({
      id: existing?.id ?? (watch ? newEventId(watch) : 1),
      title: title.trim() || 'Untitled',
      hour,
      minute,
      anchorDate,
      enabled,
      lastModified: 0, // stamped at save time
      rule:
        kind === 'once'
          ? { kind }
          : kind === 'everyNDays'
            ? { kind, intervalDays }
            : kind === 'weekly'
              ? { kind, weekdayMask }
              : { kind, dayOfMonth },
    }),
    [existing, watch, title, hour, minute, anchorDate, enabled, kind, intervalDays, weekdayMask, dayOfMonth]
  );

  const preview = useMemo(() => upcoming(draft, new Date(), 3), [draft]);

  if (!watch) {
    return null;
  }

  const save = () => {
    const others = watch.events.filter((e) => e.id !== draft.id);
    const stamped = { ...draft, lastModified: Math.floor(Date.now() / 1000) };
    upsertWatch(withEvents(watch, [...others, stamped]));
    navigation.goBack();
  };

  return (
    <Screen width="read">

      <Text style={styles.label}>Title (shown on the watch)</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Brush teeth"
        placeholderTextColor={colors.textDim}
        maxLength={23}
        testID="event-title"
      />

      <Text style={styles.label}>Time</Text>
      <View style={styles.row}>
        <Stepper value={hour} setValue={setHour} min={0} max={23} width={2} testID="hour" />
        <Text style={styles.timeColon}>:</Text>
        <Stepper value={minute} setValue={setMinute} min={0} max={59} step={5} width={2} testID="minute" />
      </View>

      <Text style={styles.label}>Repeats</Text>
      <View style={styles.segmentRow}>
        {RULE_OPTIONS.map((option) => (
          <Pressable
            key={option.kind}
            style={[styles.segment, kind === option.kind && styles.segmentActive]}
            onPress={() => setKind(option.kind)}
            testID={`rule-${option.kind}`}>
            <Text style={[styles.segmentText, kind === option.kind && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {kind === 'everyNDays' && (
        <View style={styles.row}>
          <Text style={styles.inlineLabel}>Every</Text>
          <Stepper value={intervalDays} setValue={setIntervalDays} min={1} max={99} />
          <Text style={styles.inlineLabel}>day(s)</Text>
        </View>
      )}

      {kind === 'weekly' && (
        <View style={styles.segmentRow}>
          {WEEKDAY_LABELS.map((day, i) => {
            const active = ((weekdayMask >> i) & 1) === 1;
            return (
              <Pressable
                key={day}
                style={[styles.day, active && styles.segmentActive]}
                onPress={() => setWeekdayMask(weekdayMask ^ (1 << i))}
                testID={`day-${day}`}>
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{day[0]}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {kind === 'monthly' && (
        <View style={styles.row}>
          <Text style={styles.inlineLabel}>On day</Text>
          <Stepper value={dayOfMonth} setValue={setDayOfMonth} min={1} max={31} />
          <Text style={styles.inlineLabel}>(31 = month end)</Text>
        </View>
      )}

      <Text style={styles.label}>{kind === 'once' ? 'Date' : 'Starting from'}</Text>
      <TextInput
        style={styles.input}
        value={anchorDate}
        onChangeText={setAnchorDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textDim}
        testID="anchor-date"
      />

      <View style={[styles.row, { justifyContent: 'space-between', marginTop: spacing(1) }]}>
        <Text style={styles.inlineLabel}>Enabled</Text>
        <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.accent }} />
      </View>

      <Text style={styles.label}>Next occurrences</Text>
      {preview.length === 0 ? (
        <Text style={styles.previewNone}>never (check the rule and date)</Text>
      ) : (
        preview.map((d) => (
          <Text key={d.toISOString()} style={styles.preview}>
            {d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        ))
      )}

      <Button label="Save" onPress={save} testID="save-event" style={{ marginVertical: spacing(3) }} />
    </Screen>
  );
}

function Stepper({
  value,
  setValue,
  min,
  max,
  step = 1,
  width,
  testID,
}: {
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  width?: number;
  testID?: string;
}) {
  const fmt = width ? String(value).padStart(width, '0') : String(value);
  const bump = (delta: number) => setValue(Math.min(max, Math.max(min, value + delta)));
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => bump(-step)} style={styles.stepButton} testID={testID ? `${testID}-minus` : undefined}>
        <Text style={styles.stepButtonText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{fmt}</Text>
      <Pressable onPress={() => bump(step)} style={styles.stepButton} testID={testID ? `${testID}-plus` : undefined}>
        <Text style={styles.stepButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textDim, marginTop: spacing(2), marginBottom: spacing(1), fontSize: 13, textTransform: 'uppercase' },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 10, paddingHorizontal: spacing(2), height: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  timeColon: { color: colors.text, fontSize: 24, fontWeight: '700' },
  inlineLabel: { color: colors.text, fontSize: 15 },
  segmentRow: { flexDirection: 'row', gap: spacing(0.5), flexWrap: 'wrap' },
  segment: { backgroundColor: colors.card, borderRadius: 8, paddingVertical: spacing(1), paddingHorizontal: spacing(1.5) },
  day: { backgroundColor: colors.card, borderRadius: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textDim, fontSize: 14 },
  segmentTextActive: { color: '#fff', fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10 },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  stepValue: { color: colors.text, fontSize: 20, minWidth: 40, textAlign: 'center', fontVariant: ['tabular-nums'] },
  preview: { color: colors.text, fontSize: 15, marginBottom: 4 },
  previewNone: { color: colors.warn, fontSize: 15 },
});
