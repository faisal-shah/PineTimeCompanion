import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateToIso, isoToDate } from './isoDate';

test('round-trips through local components, not UTC', () => {
  // `new Date('2026-07-14')` is UTC midnight, which is 13 Jul west of
  // Greenwich. The schedule anchor must not drift a day.
  assert.equal(dateToIso(isoToDate('2026-07-14')), '2026-07-14');
  assert.equal(dateToIso(isoToDate('2026-01-01')), '2026-01-01');
  assert.equal(dateToIso(isoToDate('2026-12-31')), '2026-12-31');

  const d = isoToDate('2026-07-14');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 0);
});

test('zero-pads single-digit months and days', () => {
  assert.equal(dateToIso(new Date(2026, 0, 5)), '2026-01-05');
});

test('impossible and malformed dates fall back to today rather than rolling over', () => {
  const today = dateToIso(new Date());
  // Date would silently roll 2026-02-31 into March.
  assert.equal(dateToIso(isoToDate('2026-02-31')), today);
  assert.equal(dateToIso(isoToDate('not-a-date')), today);
  assert.equal(dateToIso(isoToDate('')), today);
  assert.equal(dateToIso(isoToDate('2026-7-4')), today); // unpadded is not the stored form
});

test('accepts a real leap day', () => {
  assert.equal(dateToIso(isoToDate('2028-02-29')), '2028-02-29');
});
