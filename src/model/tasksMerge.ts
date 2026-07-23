// Three-way merge for the daily task list — the task-list twin of
// mergeSchedules (model/merge.ts). Same watch-authoritative, newest-edit-wins,
// edits-beat-deletions rules; a task is simpler than an event (title + order,
// no time/rule), and per-task completion is NOT in the record (it lives only on
// the watch), so completion never enters the merge. Pure function, golden-tested.

import { TaskSyncBase, WatchTask } from './types';
import { MergeNotice } from './merge';

export interface TaskMergeResult {
  merged: WatchTask[];
  notices: MergeNotice[];
  /** true when mine and merged differ (this device's list was updated) */
  changedLocally: boolean;
  /** true when theirs and merged differ (a push is required) */
  needsPush: boolean;
}

const byId = (tasks: WatchTask[]) => new Map(tasks.map((t) => [t.id, t]));

const sameTask = (a: WatchTask, b: WatchTask) => a.title === b.title && a.order === b.order;

export function mergeTasks(mine: WatchTask[], theirs: WatchTask[], base: TaskSyncBase | undefined): TaskMergeResult {
  const baseMap = byId(base?.tasks ?? []);
  const syncedAt = base?.syncedAt ?? 0;
  const theirsMap = byId(theirs);
  const mineMap = byId(mine);

  const merged: WatchTask[] = [];
  const notices: MergeNotice[] = [];

  for (const my of mine) {
    const their = theirsMap.get(my.id);
    if (their) {
      if (sameTask(my, their)) {
        merged.push(my.lastModified >= their.lastModified ? my : their);
      } else if (their.lastModified > my.lastModified) {
        merged.push(their);
        notices.push({
          kind: my.lastModified > syncedAt ? 'conflictResolved' : 'updatedHere',
          title: their.title,
          detail: my.lastModified > syncedAt ? 'edited on two devices; the newer edit won' : 'updated from another device',
        });
      } else {
        merged.push(my); // my edit is newer (or equal): mine wins
      }
    } else {
      // Not on the watch. New here, or edited here since my last sync -> keep
      // (an edit resurrects a concurrent remote deletion). Otherwise it was
      // deleted from another device -> drop it here too.
      const inBase = baseMap.has(my.id);
      if (!inBase || my.lastModified > syncedAt) {
        merged.push(my);
      } else {
        notices.push({ kind: 'deletedHere', title: my.title, detail: 'deleted from another device' });
      }
    }
  }

  for (const their of theirs) {
    if (mineMap.has(their.id)) {
      continue;
    }
    const inBase = baseMap.has(their.id);
    if (!inBase || their.lastModified > syncedAt) {
      merged.push(their);
      notices.push({ kind: 'adopted', title: their.title, detail: 'added from another device' });
    }
  }

  merged.sort((a, b) => a.order - b.order || a.id - b.id);

  const sameSet = (a: WatchTask[], b: WatchTask[]) => {
    if (a.length !== b.length) {
      return false;
    }
    const bMap = byId(b);
    return a.every((t) => {
      const other = bMap.get(t.id);
      return other && sameTask(t, other) && t.lastModified === other.lastModified;
    });
  };

  return {
    merged,
    notices,
    changedLocally: !sameSet(mine, merged),
    needsPush: !sameSet(theirs, merged),
  };
}

/** Empty watch + version 0 + non-empty base means the watch was wiped/replaced. */
export function looksLikeTaskReset(theirs: WatchTask[], watchVersion: number, base: TaskSyncBase | undefined): boolean {
  return theirs.length === 0 && watchVersion === 0 && (base?.tasks.length ?? 0) > 0;
}
