// Golden scenarios for the generic three-way multi-companion merge — one test
// per row of the design's corner-case table, driven through mergeList with the
// schedule rules (the richest item type). Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListMergeRules, ListSyncBase, mergeList, looksLikeReset, needsSync, withItems, newItemId, syncedList } from './listSync.ts';
import type { WatchEvent } from './types.ts';

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

// The schedule's field-equality + display order, mirrored from scheduleSpec.
const eventRules: ListMergeRules<WatchEvent> = {
  equal: (a, b) =>
    a.title === b.title &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.anchorDate === b.anchorDate &&
    a.enabled === b.enabled &&
    JSON.stringify(a.rule) === JSON.stringify(b.rule),
  compare: (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute) || a.id - b.id,
};

const merge = (mine: WatchEvent[], theirs: WatchEvent[], base: ListSyncBase<WatchEvent> | undefined) => mergeList(mine, theirs, base, eventRules);

const base = (syncedAt: number, items: WatchEvent[]): ListSyncBase<WatchEvent> => ({ version: 111, syncedAt, items });

const ids = (events: WatchEvent[]) => events.map((e) => e.id).sort((a, b) => a - b);

test('fresh second phone adopts the watch list and adds its own', () => {
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100), ev(3, 'Brush teeth', 100)];
  const mine = [ev(4, 'Soccer canceled', 200)];
  const r = merge(mine, theirs, undefined);
  assert.deepEqual(ids(r.merged), [1, 2, 3, 4]);
  assert.equal(r.notices.filter((n) => n.kind === 'adopted').length, 3);
  assert.ok(r.needsPush && r.changedLocally);
});

test('deletion on one phone propagates to the other', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)];
  const theirs = [ev(1, 'Fajr', 100)];
  const r = merge(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1]);
  assert.equal(r.notices[0].kind, 'deletedHere');
  assert.ok(r.changedLocally);
});

test('my deletion propagates to the watch', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100)];
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)];
  const r = merge(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1]);
  assert.ok(r.needsPush);
  assert.ok(!r.changedLocally);
});

test('both edited the same item: newest wins, with a conflict notice', () => {
  const myBase = base(500, [ev(1, 'Lunch', 100, { hour: 11 })]);
  const mine = [ev(1, 'Lunch', 600, { hour: 12, minute: 0 })];
  const theirs = [ev(1, 'Lunch', 700, { hour: 12, minute: 30 })];
  const r = merge(mine, theirs, myBase);
  assert.equal(r.merged[0].minute, 30);
  assert.equal(r.notices[0].kind, 'conflictResolved');

  const r2 = merge([ev(1, 'Lunch', 800, { hour: 12 })], theirs, myBase);
  assert.equal(r2.merged[0].hour, 12);
  assert.equal(r2.notices.length, 0);
  assert.ok(r2.needsPush);
});

test('remote edit updates me without conflict when I did not touch it', () => {
  const myBase = base(500, [ev(1, 'Lunch', 100)]);
  const mine = [ev(1, 'Lunch', 100)];
  const theirs = [ev(1, 'Lunch', 700, { minute: 30 })];
  const r = merge(mine, theirs, myBase);
  assert.equal(r.merged[0].minute, 30);
  assert.equal(r.notices[0].kind, 'updatedHere');
});

test('my edit after their deletion resurrects the item', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100), ev(2, 'Quran moved', 800)];
  const theirs = [ev(1, 'Fajr', 100)];
  const r = merge(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1, 2]);
  assert.ok(r.needsPush);
});

test('their edit after my deletion resurrects the item for me', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100), ev(2, 'Quran', 100)]);
  const mine = [ev(1, 'Fajr', 100)];
  const theirs = [ev(1, 'Fajr', 100), ev(2, 'Quran moved', 800)];
  const r = merge(mine, theirs, myBase);
  assert.deepEqual(ids(r.merged), [1, 2]);
  assert.equal(r.notices[0].kind, 'adopted');
});

test('no changes anywhere: nothing to do', () => {
  const events = [ev(1, 'Fajr', 100)];
  const r = merge(events, events, base(500, events));
  assert.ok(!r.changedLocally && !r.needsPush);
  assert.equal(r.notices.length, 0);
});

test('reset detection', () => {
  const myBase = base(500, [ev(1, 'Fajr', 100)]);
  assert.ok(looksLikeReset([], 0, myBase));
  assert.ok(!looksLikeReset([], 0, undefined)); // never synced: empty is normal
  assert.ok(!looksLikeReset([ev(1, 'x', 1)], 0, myBase)); // not empty
  assert.ok(!looksLikeReset([], 777, myBase)); // deliberate empty sync carries a version
});

test('three devices converge through the watch', () => {
  const a1 = [ev(1, 'Fajr', 100)];
  const b = merge([ev(2, 'Quran', 200)], a1, undefined);
  assert.deepEqual(ids(b.merged), [1, 2]);
  const c0 = merge([], b.merged, undefined);
  assert.deepEqual(ids(c0.merged), [1, 2]);
  const cBase = base(1000, c0.merged);
  const c1 = merge(c0.merged.filter((e) => e.id !== 1), c0.merged, cBase);
  assert.deepEqual(ids(c1.merged), [2]);
  const aBase = base(900, a1);
  const a2 = merge(a1, c1.merged, aBase);
  assert.deepEqual(ids(a2.merged), [2]);
});

// --- generic over any ListItem: a minimal item proves the abstraction ---
interface Note {
  id: number;
  title: string;
  lastModified: number;
  body: string;
}
const noteRules: ListMergeRules<Note> = { equal: (a, b) => a.body === b.body, compare: (a, b) => a.id - b.id };

test('mergeList is generic: works for an arbitrary item + equality', () => {
  const mine: Note[] = [{ id: 1, title: 'x', lastModified: 100, body: 'mine' }];
  const theirs: Note[] = [{ id: 1, title: 'x', lastModified: 300, body: 'theirs' }];
  // I haven't touched it since my last sync (syncedAt 200 > my 100), so their
  // newer edit updates me without conflict.
  const r = mergeList(mine, theirs, { version: 1, syncedAt: 200, items: mine }, noteRules);
  assert.equal(r.merged[0].body, 'theirs');
  assert.equal(r.notices[0].kind, 'updatedHere');
});

// --- store helpers ---
test('store helpers: needsSync / withItems / newItemId / syncedList', () => {
  const items = [ev(1, 'a', 1)];
  const b: ListSyncBase<WatchEvent> = { version: 5, syncedAt: 1, items };
  assert.equal(needsSync({ items, version: 5, base: b }), false);
  assert.equal(needsSync({ items, version: 6, base: b }), true);
  assert.equal(needsSync({ items, version: 1 }), true); // never synced

  const bumped = withItems({ items, version: 5, base: b }, []);
  assert.equal(bumped.version, 6);
  assert.deepEqual(bumped.items, []);

  const id = newItemId(items);
  assert.ok(id >= 1 && id <= 0xffff && id !== 1);

  const synced = syncedList(b, 20);
  assert.deepEqual(synced, { items, version: 5, syncedVersion: 5, base: b, capacity: 20 });
});
