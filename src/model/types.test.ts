import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent } from './types';

test('the rule line names the end date when there is one', () => {
  const daily = { rule: { kind: 'everyNDays' as const, intervalDays: 1 } };
  assert.equal(describeEvent(daily), 'Every day');
  assert.match(describeEvent({ ...daily, endDate: '2026-12-31' }), /^Every day · until /);
});

test('a one-time event never claims an end date', () => {
  // It ends at its own date by definition; an "until" here would be noise, and
  // the watch ignores the field for one-shots anyway.
  assert.equal(describeEvent({ rule: { kind: 'once' as const }, endDate: '2026-12-31' }), 'One time');
});

test('the year is shown when the end date is not this year', () => {
  // "until Jun 30" reads identically for 2020 and 2099; the year is what makes
  // the line worth showing.
  const weekly = { rule: { kind: 'weekly' as const, weekdayMask: 0x2a } };
  const now = new Date(2026, 0, 1);
  assert.match(describeEvent({ ...weekly, endDate: '2020-06-30' }, now), /2020/);
  assert.match(describeEvent({ ...weekly, endDate: '2099-06-30' }, now), /2099/);
  // ...and omitted when it is this year, where it would just be noise.
  assert.doesNotMatch(describeEvent({ ...weekly, endDate: '2026-06-30' }, now), /2026/);
});
