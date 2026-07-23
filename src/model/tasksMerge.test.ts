import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTasks, looksLikeTaskReset } from './tasksMerge';
import { TaskSyncBase, WatchTask } from './types';

const t = (id: number, title: string, order: number, lastModified: number): WatchTask => ({ id, title, order, lastModified });
const base = (tasks: WatchTask[], syncedAt: number): TaskSyncBase => ({ version: 1, syncedAt, tasks });

test('no base, disjoint ids: union, sorted by order', () => {
  const mine = [t(1, 'A', 1, 100)];
  const theirs = [t(2, 'B', 0, 100)];
  const r = mergeTasks(mine, theirs, undefined);
  assert.deepEqual(r.merged.map((x) => x.title), ['B', 'A']);
  assert.equal(r.needsPush, true); // theirs lacked A
  assert.equal(r.changedLocally, true); // mine lacked B
  assert.equal(r.notices.find((n) => n.kind === 'adopted')?.title, 'B');
});

test('concurrent edit to the same task: newer lastModified wins, flagged conflict', () => {
  const b = base([t(1, 'Old', 0, 50)], 60);
  const mine = [t(1, 'Mine', 0, 70)]; // I edited after last sync
  const theirs = [t(1, 'Theirs', 0, 90)]; // another phone edited later
  const r = mergeTasks(mine, theirs, b);
  assert.equal(r.merged[0].title, 'Theirs');
  assert.equal(r.notices[0].kind, 'conflictResolved');
});

test('unchanged-here vs updated-elsewhere: adopt theirs, notice updatedHere', () => {
  const b = base([t(1, 'Old', 0, 50)], 60);
  const mine = [t(1, 'Old', 0, 50)]; // untouched since sync
  const theirs = [t(1, 'New', 0, 80)];
  const r = mergeTasks(mine, theirs, b);
  assert.equal(r.merged[0].title, 'New');
  assert.equal(r.notices[0].kind, 'updatedHere');
});

test('remote deletion drops an untouched local task', () => {
  const b = base([t(1, 'Keep', 0, 50), t(2, 'Gone', 1, 50)], 60);
  const mine = [t(1, 'Keep', 0, 50), t(2, 'Gone', 1, 50)];
  const theirs = [t(1, 'Keep', 0, 50)]; // task 2 deleted elsewhere
  const r = mergeTasks(mine, theirs, b);
  assert.deepEqual(r.merged.map((x) => x.id), [1]);
  assert.equal(r.notices.find((n) => n.kind === 'deletedHere')?.title, 'Gone');
});

test('a local edit resurrects a task the other device deleted (edit beats delete)', () => {
  const b = base([t(1, 'X', 0, 50)], 60);
  const mine = [t(1, 'X edited', 0, 90)]; // edited here after sync
  const theirs: WatchTask[] = []; // deleted elsewhere
  const r = mergeTasks(mine, theirs, b);
  assert.deepEqual(r.merged.map((x) => x.title), ['X edited']);
  assert.equal(r.needsPush, true);
});

test('nothing changed either side: no push, no local change', () => {
  const tasks = [t(1, 'A', 0, 50), t(2, 'B', 1, 50)];
  const b = base(tasks, 60);
  const r = mergeTasks([...tasks], [...tasks], b);
  assert.equal(r.needsPush, false);
  assert.equal(r.changedLocally, false);
  assert.equal(r.notices.length, 0);
});

test('looksLikeTaskReset: empty watch + v0 + non-empty base', () => {
  assert.equal(looksLikeTaskReset([], 0, base([t(1, 'A', 0, 1)], 1)), true);
  assert.equal(looksLikeTaskReset([], 5, base([t(1, 'A', 0, 1)], 1)), false); // version != 0
  assert.equal(looksLikeTaskReset([], 0, undefined), false); // never synced
});
