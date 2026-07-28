// Web/desktop date entry: a month grid in the app's Dialog. Prop-compatible
// with DatePicker.tsx.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Dialog, DialogActions, DialogButton, DialogTitle } from './Dialog';
import { colors, spacing } from './theme';
import { dateToIso, isoToDate } from '../util/isoDate';
import type { DatePickerProps } from './DatePicker';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function DatePicker({ visible, value, onCancel, onConfirm }: DatePickerProps) {
  const [cursor, setCursor] = useState(() => isoToDate(value));
  const [picked, setPicked] = useState(() => isoToDate(value));

  useEffect(() => {
    if (visible) {
      setCursor(isoToDate(value));
      setPicked(isoToDate(value));
    }
  }, [visible, value]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS weeks start Sunday; this grid starts Monday.
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const isPicked = (d: number) =>
    picked.getFullYear() === year && picked.getMonth() === month && picked.getDate() === d;

  return (
    <Dialog visible={visible} onDismiss={onCancel}>
      <DialogTitle>Pick a date</DialogTitle>

      <View style={styles.header}>
        <Pressable onPress={() => setCursor(new Date(year, month - 1, 1))} testID="date-prev" style={styles.nav}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <Pressable onPress={() => setCursor(new Date(year, month + 1, 1))} testID="date-next" style={styles.nav}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={styles.weekday}>
            {w}
          </Text>
        ))}
        {cells.map((d, i) => (
          <View key={i} style={styles.cellWrap}>
            {d !== null && (
              <Pressable
                onPress={() => setPicked(new Date(year, month, d))}
                style={[styles.cell, isPicked(d) && styles.cellOn]}
                testID={isPicked(d) ? 'date-selected' : undefined}>
                <Text style={[styles.cellText, isPicked(d) && styles.cellTextOn]}>{d}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      <DialogActions>
        <DialogButton label="Cancel" onPress={onCancel} />
        <DialogButton label="Set" primary onPress={() => onConfirm(dateToIso(picked))} testID="date-set" />
      </DialogActions>
    </Dialog>
  );
}

const CELL = 34;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(1) },
  nav: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  navText: { color: colors.accent, fontSize: 24, lineHeight: 26 },
  month: { color: colors.text, fontSize: 16, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL * 7, alignSelf: 'center', marginVertical: spacing(1) },
  weekday: { width: CELL, textAlign: 'center', color: colors.textDim, fontSize: 12, marginBottom: spacing(0.5) },
  cellWrap: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  cell: { width: CELL - 4, height: CELL - 4, borderRadius: (CELL - 4) / 2, alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: colors.accent },
  cellText: { color: colors.text, fontSize: 14 },
  cellTextOn: { color: colors.onAccent, fontWeight: '700' },
});
