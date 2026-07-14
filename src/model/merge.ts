// Three-way merge for multi-companion sync. The watch is the shared database:
// every sync pulls the watch's schedule ("theirs"), merges it with this
// device's list ("mine") against a snapshot of this device's last successful
// sync ("base"), and pushes the result. See the InfiniTime fork's
// doc/ScheduleService.md, "Multiple companions".
//
// Rules (newest-edit-wins, with edits beating deletions):
//   - id in mine & theirs, both changed -> keep the newer lastModified
//   - id only in mine:  new here (not in base) or edited since my last sync
//                       -> keep;  otherwise someone deleted it -> drop
//   - id only in theirs: new elsewhere (not in base) or edited since my last
//                       sync -> adopt; otherwise I deleted it -> stays deleted
//
// Pure function, no I/O — golden-tested in merge.test.ts.

import { SyncBase, WatchEvent } from './types';

export interface MergeNotice {
  kind: 'adopted' | 'updatedHere' | 'deletedHere' | 'conflictResolved';
  title: string;
  detail?: string;
}

export interface MergeResult {
  merged: WatchEvent[];
  /** human-readable summary of what changed on THIS device */
  notices: MergeNotice[];
  /** true when mine and merged differ (this device's list was updated) */
  changedLocally: boolean;
  /** true when theirs and merged differ (a push is required) */
  needsPush: boolean;
}

const byId = (events: WatchEvent[]) => new Map(events.map((e) => [e.id, e]));

const sameEvent = (a: WatchEvent, b: WatchEvent) =>
  a.title === b.title &&
  a.hour === b.hour &&
  a.minute === b.minute &&
  a.anchorDate === b.anchorDate &&
  a.enabled === b.enabled &&
  JSON.stringify(a.rule) === JSON.stringify(b.rule);

export function mergeSchedules(mine: WatchEvent[], theirs: WatchEvent[], base: SyncBase | undefined): MergeResult {
  const baseMap = byId(base?.events ?? []);
  const syncedAt = base?.syncedAt ?? 0;
  const theirsMap = byId(theirs);
  const mineMap = byId(mine);

  const merged: WatchEvent[] = [];
  const notices: MergeNotice[] = [];

  for (const my of mine) {
    const their = theirsMap.get(my.id);
    if (their) {
      if (sameEvent(my, their)) {
        merged.push(my.lastModified >= their.lastModified ? my : their);
      } else if (their.lastModified > my.lastModified) {
        merged.push(their);
        notices.push({
          kind: my.lastModified > syncedAt ? 'conflictResolved' : 'updatedHere',
          title: their.title,
          detail:
            my.lastModified > syncedAt
              ? 'edited on two devices; the newer edit won'
              : 'updated from another device',
        });
      } else {
        merged.push(my); // my edit is newer (or equal): mine wins, push carries it
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
      continue; // handled above
    }
    // On the watch but not here. New elsewhere, or edited since my last sync
    // -> adopt. Otherwise I deleted it -> leave it out (push propagates that).
    const inBase = baseMap.has(their.id);
    if (!inBase || their.lastModified > syncedAt) {
      merged.push(their);
      notices.push({ kind: 'adopted', title: their.title, detail: 'added from another device' });
    }
  }

  merged.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute) || a.id - b.id);

  const sameSet = (a: WatchEvent[], b: WatchEvent[]) => {
    if (a.length !== b.length) {
      return false;
    }
    const bMap = byId(b);
    return a.every((e) => {
      const other = bMap.get(e.id);
      return other && sameEvent(e, other) && e.lastModified === other.lastModified;
    });
  };

  return {
    merged,
    notices,
    changedLocally: !sameSet(mine, merged),
    needsPush: !sameSet(theirs, merged),
  };
}

/** Empty watch + non-empty base means the watch was wiped/replaced, not that
 *  every event was deliberately deleted one by one. Callers must ask the user. */
export function looksLikeWatchReset(theirs: WatchEvent[], watchVersion: number, base: SyncBase | undefined): boolean {
  return theirs.length === 0 && watchVersion === 0 && (base?.events.length ?? 0) > 0;
}
