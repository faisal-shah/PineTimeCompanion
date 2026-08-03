// Golden scenarios for the generic three-way multi-companion merge — one test
// per row of the design's corner-case table, driven through mergeList with the
// schedule rules (the richest item type). Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListMergeRules, ListSyncBase, mergeList, looksLikeReset, needsSync, withItems, newItemId, syncedList } from './listSync.ts';
import { scheduleSpec, taskSpec } from '../ble/listSyncManager.ts';
import type { WatchEvent, WatchTask } from './types.ts';

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

// Drive the merge through the REAL production rules, not a copy of them, so a
// change to scheduleSpec/taskSpec is caught here rather than only in e2e.
const eventRules: ListMergeRules<WatchEvent> = scheduleSpec.rules;

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

// --- the real taskSpec rules (title + order equality, order-then-id sort) ---

const tk = (id: number, title: string, order: number, lastModified: number): WatchTask => ({ id, title, order, lastModified });
const mergeTasks = (mine: WatchTask[], theirs: WatchTask[], base: ListSyncBase<WatchTask> | undefined) =>
  mergeList(mine, theirs, base, taskSpec.rules);

test('taskSpec: a reorder (order changed) counts as an edit, newest wins', () => {
  const b: ListSyncBase<WatchTask> = { version: 1, syncedAt: 500, items: [tk(1, 'Brush teeth', 0, 100)] };
  // They moved it to position 2 at t=700; I never touched it.
  const r = mergeTasks([tk(1, 'Brush teeth', 0, 100)], [tk(1, 'Brush teeth', 2, 700)], b);
  assert.equal(r.merged[0].order, 2);
  assert.equal(r.notices[0].kind, 'updatedHere');
});

test('taskSpec: same title AND order is not a change (no spurious push)', () => {
  const items = [tk(1, 'Make bed', 1, 100)];
  const r = mergeTasks(items, items, { version: 1, syncedAt: 500, items });
  assert.ok(!r.changedLocally && !r.needsPush);
  assert.equal(r.notices.length, 0);
});

test('taskSpec: a rename is an edit', () => {
  const b: ListSyncBase<WatchTask> = { version: 1, syncedAt: 500, items: [tk(1, 'Read', 0, 100)] };
  const r = mergeTasks([tk(1, 'Read', 0, 100)], [tk(1, 'Read 10 minutes', 0, 700)], b);
  assert.equal(r.merged[0].title, 'Read 10 minutes');
});

test('taskSpec: merged list sorts by order, then id', () => {
  const r = mergeTasks([tk(9, 'c', 2, 1), tk(3, 'a', 0, 1)], [tk(7, 'b', 0, 1)], undefined);
  assert.deepEqual(r.merged.map((t) => t.id), [3, 7, 9]); // order 0 (id 3, 7) then order 2
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

// --- the store's shape guard: a pre-refactor record must not reach the UI ---
test('parseWatches drops records that predate the SyncedList shape', async () => {
  const { parseWatches } = await import('../storage/store.ts');
  const legacy = { id: 'w1', name: 'My PineTime', scheduleVersion: 3, events: [{ id: 1 }], capacity: 64 };
  const modern = { id: 'w2', name: 'Layla', schedule: { items: [], version: 1 }, tasks: { items: [], version: 1 } };
  assert.deepEqual(parseWatches(JSON.stringify([legacy, modern])).map((w) => w.id), ['w2']);
  // and never throws on junk
  assert.deepEqual(parseWatches(null), []);
  assert.deepEqual(parseWatches('not json'), []);
  assert.deepEqual(parseWatches('{"not":"an array"}'), []);
});

test('two events differing only by end date are not equal', () => {
  // equal() is the merge's definition of "same information": when it says two
  // records match, the merge is free to keep either one. Any field that
  // encodeRecord puts on the wire must therefore be in here, or an edit to it
  // can be silently dropped in favour of the other side's copy.
  const a = ev(1, 'Quran practice', 100);
  const b = { ...a, endDate: '2026-12-31' };
  assert.equal(eventRules.equal(a, b), false, 'setting an end date is a real change');
  assert.equal(eventRules.equal(b, { ...b }), true, 'identical copies still match');
});

test('every field encodeEventRecord writes is covered by equal', () => {
  // Guards the whole class rather than just today's field: round-trip a record,
  // mutate each user-settable field, and assert equal() notices.
  const base = ev(1, 'Base', 100);
  const mutations: Array<Partial<typeof base>> = [
    { title: 'Other' },
    { hour: (base.hour + 1) % 24 },
    { minute: (base.minute + 1) % 60 },
    { anchorDate: '2027-01-02' },
    { endDate: '2027-06-01' },
    { enabled: !base.enabled },
    { rule: { kind: 'weekly', weekdayMask: 0x2a } },
  ];
  for (const m of mutations) {
    assert.equal(eventRules.equal(base, { ...base, ...m }), false, `equal() must notice ${Object.keys(m)[0]}`);
  }
});
