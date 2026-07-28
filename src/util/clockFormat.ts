// Whether this phone is set to 24-hour time.
//
// Deliberately reads Android's system-wide "Use 24-hour format" toggle rather
// than the locale: JS `toLocaleTimeString` follows the *locale*, and the two
// disagree the moment a user overrides the toggle. Shadowed by
// clockFormat.web.ts, which has no such toggle to read.
//
// The watch keeps its own Settings -> Time format; neither device mirrors the
// other, and the app deliberately has no time-format preference of its own.

import Native from '../../modules/notification-forwarder';

export function prefers24Hour(): boolean {
  return Native.is24HourFormat();
}
