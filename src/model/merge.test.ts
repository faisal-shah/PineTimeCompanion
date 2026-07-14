// Golden scenarios for the three-way multi-companion merge — one test per row
// of the design's corner-case table. Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSchedules, looksLikeWatchReset } from './merge.ts';
import type { SyncBase, WatchEvent } from './types.ts';

const ev = (id: number, title: string, lastModified: number, extra: Partial<WatchEvent> = {}): WatchEvent => ({
  id,
  title,
  hour: 8,
  minute: 0,
  anchorDate: '2026-07-14',
  rule: { kind: 'everyNDays', intervalDays: 1 },
  enabled: true,
  lastModified,
  ...extra,
});

const base = (syncedAt: number, events: WatchEvent[]): SyncBase => ({ version: 111, syncedAt, events });

const ids = (events: WatchEvent[]) => events.map((e) => e.id).sort((a, b) => a - b);

test('fresh second phone adopts the watch schedule and adds its own', () => {
  // Phone B: never synced (no base), has 1 local event; watch holds A's 3.
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100), ev(3, 'Brush teeth', 100)];
  const mine = [ev(4, 'Soccer canceled', 200)];
  const r = mergeSchedules(mine, theirs, undefined);
  assert.deepEqual(ids(r.merged), [1, 2, 3, 4]);
  assert.equal(r.notices.filter((n) => n.kind === 'adopted').length, 3);
  assert.ok(r.needsPush && r.changedLocally);
});

test('deletion on one phone propagates to the other', () => {
  // I synced {1,2} at t=500. Someone deleted 2 from the watch. I sync.
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)];
  const theirs = [ev(1, 'Fajr', 100)];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1]);
  assert.equal(r.notices[0].kind, 'deletedHere');
  assert.ok(r.changedLocally);
});

test('my deletion propagates to the watch', () => {
  // I synced {1,2}, then deleted 2 locally. Watch still has both.
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100)];
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1]);
  assert.ok(r.needsPush);
  assert.ok(!r.changedLocally);
});

test('both edited the same event: newest wins, with a conflict notice', () => {
  // Base at t=500. I moved lunch to 12:00 at t=600; wife moved it to 12:30 at t=700.
  const myBase = base(500, [ev(1, 'Lunch', 100, { hour: 11 })]);
  const mine = [ev(1, 'Lunch', 600, { hour: 12, minute: 0 })];
  const theirs = [ev(1, 'Lunch', 700, { hour: 12, minute: 30 })];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.equal(r.merged[0].minute, 30);
  assert.equal(r.notices[0].kind, 'conflictResolved');

  // Mirror: my edit is newer -> mine wins, no local notice, push needed.
  const r2 = mergeSchedules([ev(1, 'Lunch', 800, { hour: 12 })], theirs, myBase);
  assert.equal(r2.merged[0].hour, 12);
  assert.equal(r2.notices.length, 0);
  assert.ok(r2.needsPush);
});

test('remote edit updates me without conflict when I did not touch it', () => {
  const myBase = base(500, [ev(1, 'Lunch', 100)]);
  const mine = [ev(1, 'Lunch', 100)];
  const theirs = [ev(1, 'Lunch', 700, { minute: 30 })];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.equal(r.merged[0].minute, 30);
  assert.equal(r.notices[0].kind, 'updatedHere');
});

test('my edit after their deletion resurrects the event', () => {
  // Base t=500 had event 2. Wife deleted it; I edited it at t=800 (> syncedAt).
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100), ev(2, 'Quran moved', 800)];
  const theirs = [ev(1, 'Fajr', 100)];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1, 2]);
  assert.ok(r.needsPush);
});

test('their edit after my deletion resurrects the event for me', () => {
  // I deleted event 2 locally after my last sync (t=500); wife edited it at t=800.
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100)];
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran moved', 800)];
  const r = mergeSchedules(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1, 2]);
  assert.equal(r.notices[0].kind, 'adopted');
});

test('no changes anywhere: nothing to do', () => {
  const events = [ev(1, 'Fajr', 100)];
  const r = mergeSchedules(events, events, base(500, events));
  assert.ok(!r.changedLocally && !r.needsPush);
  assert.equal(r.notices.length, 0);
});

test('watch reset detection', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100)]);
  assert.ok(looksLikeWatchReset([], 0, myBase));
  assert.ok(!looksLikeWatchReset([], 0, undefined)); // never synced: empty is normal
  assert.ok(!looksLikeWatchReset([ev(1, 'x', 1)], 0, myBase)); // not empty
  // Deliberate empty sync from another phone carries a nonzero version.
  assert.ok(!looksLikeWatchReset([], 777, myBase));
});

test('three devices converge through the watch', () => {
  // A pushes {1}. B (fresh) adopts and adds {2}. C (fresh) adopts both, deletes 1.
  const a1 = [ev(1, 'Fajr', 100)];
  const b = mergeSchedules([ev(2, 'Quran', 200)], a1, undefined);
  assert.deepEqual(ids(b.merged), [1, 2]);
  const c0 = mergeSchedules([], b.merged, undefined);
  assert.deepEqual(ids(c0.merged), [1, 2]); // C adopted everything
  // C deletes 1 locally (after its sync at t=1000), syncs again:
  const cBase = base(1000, c0.merged);
  const c1 = mergeSchedules(c0.merged.filter((e) => e.id !== 1), c0.merged, cBase);
  assert.deepEqual(ids(c1.merged), [2]);
  // A syncs afterwards: pulls {2}, its base was {1} at t=900.
  const aBase = base(900, a1);
  const a2 = mergeSchedules(a1, c1.merged, aBase);
  assert.deepEqual(ids(a2.merged), [2]); // A's event-1 deletion adopted, B's event kept
});
