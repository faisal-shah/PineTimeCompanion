// The one watch-authoritative list-sync engine. Every bounded, phone-edited,
// watch-authoritative list — the schedule, the daily tasks, the alarms — is an
// instance of this: a three-way merge across companions with the watch as the
// shared database. Pure, no I/O — golden-tested in listSync.test.ts.
//
// Merge rules (newest-edit-wins, edits beat deletions), where "base" is this
// device's last successful sync:
//   - id in mine & theirs, both changed -> keep the newer lastModified
//   - id only in mine:   new here (not in base) or edited since my last sync
//                        -> keep;  otherwise someone deleted it -> drop
//   - id only in theirs: new elsewhere (not in base) or edited since my last
//                        sync -> adopt; otherwise I deleted it -> stays deleted

export interface ListItem {
  /** random 16-bit id, unique per watch across ALL companions (not sequential) */
  id: number;
  /** shown on the watch, and used in merge notices */
  title: string;
  /** UNIX seconds (UTC) of the last edit on any companion; drives conflicts */
  lastModified: number;
}

/** What this device last successfully synced — the "base" of the three-way merge. */
export interface ListSyncBase<T extends ListItem> {
  /** the list version we committed to the watch */
  version: number;
  /** UNIX seconds when the sync happened */
  syncedAt: number;
  items: T[];
}

/** A watch-authoritative synced list, as stored on a Watch. */
export interface SyncedList<T extends ListItem> {
  items: T[];
  /** local version; bumped on every edit; the watch echoes it in its digest */
  version: number;
  /** version last confirmed on the watch (undefined = never synced) */
  syncedVersion?: number;
  /** last successful sync snapshot; absent until the first sync */
  base?: ListSyncBase<T>;
  /** slots on the watch, from its digest; unknown until the first sync */
  capacity?: number;
}

export interface MergeNotice {
  kind: 'adopted' | 'updatedHere' | 'deletedHere' | 'conflictResolved';
  title: string;
  detail?: string;
}

export interface MergeResult<T extends ListItem> {
  merged: T[];
  /** human-readable summary of what changed on THIS device */
  notices: MergeNotice[];
  /** true when mine and merged differ (this device's list was updated) */
  changedLocally: boolean;
  /** true when theirs and merged differ (a push is required) */
  needsPush: boolean;
}

/** Per-list specialization: field equality (excludes lastModified) + display order. */
export interface ListMergeRules<T extends ListItem> {
  equal(a: T, b: T): boolean;
  compare(a: T, b: T): number;
}

const byId = <T extends ListItem>(items: T[]) => new Map(items.map((i) => [i.id, i]));

export function mergeList<T extends ListItem>(
  mine: T[],
  theirs: T[],
  base: ListSyncBase<T> | undefined,
  rules: ListMergeRules<T>,
): MergeResult<T> {
  const baseMap = byId(base?.items ?? []);
  const syncedAt = base?.syncedAt ?? 0;
  const theirsMap = byId(theirs);
  const mineMap = byId(mine);

  const merged: T[] = [];
  const notices: MergeNotice[] = [];

  for (const my of mine) {
    const their = theirsMap.get(my.id);
    if (their) {
      if (rules.equal(my, their)) {
        merged.push(my.lastModified >= their.lastModified ? my : their);
      } else if (their.lastModified > my.lastModified) {
        merged.push(their);
        notices.push({
          kind: my.lastModified > syncedAt ? 'conflictResolved' : 'updatedHere',
          title: their.title,
          detail: my.lastModified > syncedAt ? 'edited on two devices; the newer edit won' : 'updated from another device',
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

  merged.sort(rules.compare);

  const sameSet = (a: T[], b: T[]) => {
    if (a.length !== b.length) {
      return false;
    }
    const bMap = byId(b);
    return a.every((i) => {
      const other = bMap.get(i.id);
      return other !== undefined && rules.equal(i, other) && i.lastModified === other.lastModified;
    });
  };

  return {
    merged,
    notices,
    changedLocally: !sameSet(mine, merged),
    needsPush: !sameSet(theirs, merged),
  };
}

/** Empty watch + version 0 + non-empty base means the watch was wiped/replaced,
 *  not that every item was deliberately deleted one by one. Callers must ask. */
export function looksLikeReset<T extends ListItem>(theirs: T[], watchVersion: number, base: ListSyncBase<T> | undefined): boolean {
  return theirs.length === 0 && watchVersion === 0 && (base?.items.length ?? 0) > 0;
}

// ---- store helpers (used by every list feature) ----

export function emptyList<T extends ListItem>(): SyncedList<T> {
  return { items: [], version: 1 };
}

/** True when local edits haven't been confirmed on the watch yet. */
export function needsSync<T extends ListItem>(list: SyncedList<T>): boolean {
  return list.base === undefined || list.version !== list.base.version;
}

/** Replace a list's items and bump its version so the watch digest goes stale. */
export function withItems<T extends ListItem>(list: SyncedList<T>, items: T[]): SyncedList<T> {
  return { ...list, items, version: list.version + 1 };
}

/** Random 16-bit id so items created on different phones never collide. */
export function newItemId<T extends ListItem>(items: T[]): number {
  for (;;) {
    const id = 1 + Math.floor(Math.random() * 0xfffe);
    if (!items.some((i) => i.id === id)) {
      return id;
    }
  }
}

/** The stored SyncedList after a successful sync (shared by every list screen). */
export function syncedList<T extends ListItem>(base: ListSyncBase<T>, capacity: number): SyncedList<T> {
  return { items: base.items, version: base.version, syncedVersion: base.version, base, capacity };
}
