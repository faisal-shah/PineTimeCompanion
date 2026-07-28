// The one place the app turns a time into text.
//
// Follows the phone's own clock format (see clockFormat.ts). Times that come
// from the watch are stored as numeric hour/minute, so they are formatted here
// rather than round-tripped through Date.
//
// renderTime() is the pure core; this layer applies the phone's setting.

import { prefers24Hour } from './clockFormat';
import { renderTime } from './renderTime';

/** A stored hour/minute, in the phone's clock format. */
export function formatTime(hour: number, minute: number): string {
  return renderTime(hour, minute, prefers24Hour());
}

/** Minutes since local midnight — the prayer-times representation. */
export function formatMinutesOfDay(minutes: number): string {
  return formatTime(Math.floor(minutes / 60) % 24, minutes % 60);
}

/** Clock time of a Date, in the phone's format. */
export function formatTimeOf(date: Date): string {
  return formatTime(date.getHours(), date.getMinutes());
}

/** "14 Jul, 9:05 PM" — a timestamp with its date, for sync stamps. */
export function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${formatTimeOf(date)}`;
}

/** "Tue, 14 Jul, 9:05 PM" — the schedule preview's fuller form. */
export function formatWeekdayDateTime(date: Date): string {
  const d = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${d}, ${formatTimeOf(date)}`;
}
