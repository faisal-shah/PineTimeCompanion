// Native date entry. Values are exchanged as YYYY-MM-DD, which is what the
// schedule's anchorDate stores — the picker replaces a free-text field that had
// no validation at all.
//
// Paired with DatePicker.web.tsx; same props.

import React from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { isoToDate, dateToIso } from '../util/isoDate';

export interface DatePickerProps {
  visible: boolean;
  /** YYYY-MM-DD. */
  value: string;
  onCancel: () => void;
  onConfirm: (iso: string) => void;
}

export function DatePicker({ visible, value, onCancel, onConfirm }: DatePickerProps) {
  if (!visible) {
    return null;
  }
  return (
    // onValueChange fires only on OK; cancelling routes to onDismiss.
    <DateTimePicker
      mode="date"
      value={isoToDate(value)}
      onValueChange={(_event, picked) => onConfirm(dateToIso(picked))}
      onDismiss={onCancel}
    />
  );
}
