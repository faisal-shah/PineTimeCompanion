// Web/desktop time entry. There is no platform picker here, so this is the
// app's Dialog plus two wheels — spinning columns beat a free-text field
// because they can't produce an invalid time.
//
// Must stay prop-compatible with TimePicker.tsx.

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Dialog, DialogActions, DialogButton, DialogTitle } from './Dialog';
import { colors, spacing } from './theme';
import { prefers24Hour } from '../util/clockFormat';
import type { TimePickerProps } from './TimePicker';

const ROW = 40;

function Wheel({
  values,
  selected,
  onSelect,
  format,
  testID,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  format: (v: number) => string;
  testID: string;
}) {
  return (
    <ScrollView style={styles.wheel} contentContainerStyle={styles.wheelInner} testID={testID}>
      {values.map((v) => (
        <Pressable key={v} onPress={() => onSelect(v)} style={[styles.cell, v === selected && styles.cellOn]}>
          <Text style={[styles.cellText, v === selected && styles.cellTextOn]}>{format(v)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function TimePicker({ visible, hour, minute, onCancel, onConfirm }: TimePickerProps) {
  const [h, setH] = useState(hour);
  const [m, setM] = useState(minute);
  const use24 = prefers24Hour();

  // Reopening on a different row must not show the previous row's time.
  useEffect(() => {
    if (visible) {
      setH(hour);
      setM(minute);
    }
  }, [visible, hour, minute]);

  const hours = use24 ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i));
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  // In 12-hour mode the wheel shows 12,1..11 while `h` stays 0..23.
  const shownHour = use24 ? h : h % 12 === 0 ? 12 : h % 12;
  const isPm = h >= 12;

  const setShownHour = (v: number) => {
    if (use24) {
      setH(v);
      return;
    }
    const base = v === 12 ? 0 : v;
    setH(isPm ? base + 12 : base);
  };

  const setMeridiem = (pm: boolean) => setH(pm ? (h % 12) + 12 : h % 12);

  return (
    <Dialog visible={visible} onDismiss={onCancel}>
      <DialogTitle>Set time</DialogTitle>
      <View style={styles.row}>
        <Wheel values={hours} selected={shownHour} onSelect={setShownHour} format={(v) => String(v)} testID="picker-hour" />
        <Text style={styles.colon}>:</Text>
        <Wheel
          values={minutes}
          selected={m}
          onSelect={setM}
          format={(v) => String(v).padStart(2, '0')}
          testID="picker-minute"
        />
        {!use24 && (
          <View style={styles.meridiem}>
            {[false, true].map((pm) => (
              <Pressable
                key={String(pm)}
                onPress={() => setMeridiem(pm)}
                style={[styles.cell, isPm === pm && styles.cellOn]}
                testID={`picker-${pm ? 'pm' : 'am'}`}>
                <Text style={[styles.cellText, isPm === pm && styles.cellTextOn]}>{pm ? 'PM' : 'AM'}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <DialogActions>
        <DialogButton label="Cancel" onPress={onCancel} />
        <DialogButton label="Set" primary onPress={() => onConfirm(h, m)} testID="picker-set" />
      </DialogActions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing(1), marginVertical: spacing(2) },
  wheel: { height: ROW * 5, width: 72 },
  wheelInner: { paddingVertical: ROW * 2 },
  meridiem: { justifyContent: 'center', gap: spacing(1), marginLeft: spacing(1) },
  cell: { height: ROW, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(1.5) },
  cellOn: { backgroundColor: colors.accent },
  cellText: { color: colors.textDim, fontSize: 20, fontVariant: ['tabular-nums'] },
  cellTextOn: { color: colors.onAccent, fontWeight: '700' },
  colon: { color: colors.text, fontSize: 24, fontWeight: '700' },
});
