import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSpent, nextOccurrence } from './recurrence';
import type { WatchEvent } from './types';

// The field name is anchorDate, not anchor -- getting that wrong makes every
// event fall back to the default and the tests pass for the wrong reason.
const ev = (extra: Partial<WatchEvent> = {}): WatchEvent => ({
  id: 1,
  title: 'Event',
  hour: 9,
  minute: 0,
  anchorDate: '2026-07-14',
  rule: { kind: 'once' },
  enabled: true,
  lastModified: 0,
  ...extra,
});

test('a one-off is spent once its moment has passed', () => {
  // The point of the badge: this event will never fire again and is only
  // holding one of the watch's 64 slots.
  const past = ev({ rule: { kind: 'once' }, anchorDate: '2026-01-01', hour: 9, minute: 0 });
  const future = ev({ rule: { kind: 'once' }, anchorDate: '2027-01-01', hour: 9, minute: 0 });
  const now = new Date(2026, 7, 3, 12, 0, 0);
  assert.equal(isSpent(past, now), true);
  assert.equal(isSpent(future, now), false);
});

test('a recurring event with no end date is never spent', () => {
  // nextOccurrence() returning undefined is NOT the test: a disabled event and
  // a weekly rule with no days ticked both do that, and neither is used up.
  const now = new Date(2026, 7, 3, 12, 0, 0);
  const daily = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2020-01-01' });
  const weeklyNoDays = ev({ rule: { kind: 'weekly', weekdayMask: 0 }, anchorDate: '2020-01-01' });
  assert.equal(isSpent(daily, now), false);
  assert.equal(isSpent(weeklyNoDays, now), false);
});

test('a disabled one-off in the future is not spent', () => {
  // Switched off is a different state from used up; only the latter gets the badge.
  const now = new Date(2026, 7, 3, 12, 0, 0);
  const off = ev({ rule: { kind: 'once' }, anchorDate: '2027-01-01', enabled: false });
  assert.equal(isSpent(off, now), false);
  assert.equal(nextOccurrence(off, now), undefined, 'but it still has no next occurrence');
});

test('a recurring event is spent once its end date has passed', () => {
  const now = new Date(2026, 7, 3, 12, 0, 0);
  const ended = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2026-07-01', endDate: '2026-08-01' });
  const running = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2026-07-01', endDate: '2026-12-31' });
  assert.equal(isSpent(ended, now), true);
  assert.equal(isSpent(running, now), false);
});

test('the end date is inclusive, and nothing fires after it', () => {
  const daily = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2026-08-01', hour: 8, minute: 0, endDate: '2026-08-03' });
  // The end date itself still fires...
  const onEndDay = nextOccurrence(daily, new Date(2026, 7, 3, 0, 0, 0));
  assert.ok(onEndDay !== undefined && onEndDay.getDate() === 3, 'the end date itself must fire');
  // ...and nothing after it does.
  assert.equal(nextOccurrence(daily, new Date(2026, 7, 3, 9, 0, 0)), undefined);
  assert.equal(nextOccurrence(daily, new Date(2026, 7, 4, 0, 0, 0)), undefined);
});

test('an end date does not affect a rule that has none', () => {
  const daily = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2020-01-01', hour: 8, minute: 0 });
  assert.notEqual(nextOccurrence(daily, new Date(2030, 0, 1, 0, 0, 0)), undefined);
});
