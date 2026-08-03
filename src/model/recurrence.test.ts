import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSpentOneOff, nextOccurrence } from './recurrence';
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
  assert.equal(isSpentOneOff(past, now), true);
  assert.equal(isSpentOneOff(future, now), false);
});

test('a recurring event is never spent, even with an anchor far in the past', () => {
  // nextOccurrence() returning undefined is NOT the test: a disabled event and
  // a weekly rule with no days ticked both do that, and neither is used up.
  const now = new Date(2026, 7, 3, 12, 0, 0);
  const daily = ev({ rule: { kind: 'everyNDays', intervalDays: 1 }, anchorDate: '2020-01-01' });
  const weeklyNoDays = ev({ rule: { kind: 'weekly', weekdayMask: 0 }, anchorDate: '2020-01-01' });
  assert.equal(isSpentOneOff(daily, now), false);
  assert.equal(isSpentOneOff(weeklyNoDays, now), false);
});

test('a disabled one-off in the future is not spent', () => {
  // Switched off is a different state from used up; only the latter gets the badge.
  const now = new Date(2026, 7, 3, 12, 0, 0);
  const off = ev({ rule: { kind: 'once' }, anchorDate: '2027-01-01', enabled: false });
  assert.equal(isSpentOneOff(off, now), false);
  assert.equal(nextOccurrence(off, now), undefined, 'but it still has no next occurrence');
});
