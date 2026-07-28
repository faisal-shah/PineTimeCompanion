// Native time entry. The platform picker already speaks the phone's 12/24-hour
// setting and its own locale, so nothing here formats anything.
//
// Paired with TimePicker.web.tsx — same props, different implementation. The
// two must stay interchangeable; the app has no other component split this way.

import React from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';

export interface TimePickerProps {
  visible: boolean;
  /** Initial value. */
  hour: number;
  minute: number;
  onCancel: () => void;
  onConfirm: (hour: number, minute: number) => void;
}

export function TimePicker({ visible, hour, minute, onCancel, onConfirm }: TimePickerProps) {
  if (!visible) {
    return null;
  }
  const value = new Date();
  value.setHours(hour, minute, 0, 0);

  return (
    // Android renders its own modal, so this component draws nothing itself.
    // onValueChange fires only on OK; cancelling routes to onDismiss.
    <DateTimePicker
      mode="time"
      value={value}
      onValueChange={(_event, picked) => onConfirm(picked.getHours(), picked.getMinutes())}
      onDismiss={onCancel}
    />
  );
}
