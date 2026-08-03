// The one transport-level driver for every watch-authoritative list. Given a
// per-feature ListSpec (which chars, how to encode/decode a record + digest, and
// the merge rules), syncList runs the full multi-companion cycle: read the
// digest, pull the watch's list (unless nobody else wrote since our last sync),
// three-way merge against the stored base, capacity-check, push, and confirm.
// The BLE connection is exclusive, so the whole cycle is atomic.

import { Watch, WatchEvent, WatchTask } from '../model/types';
import { ListItem, ListMergeRules, ListSyncBase, MergeNotice, SyncedList, looksLikeReset, mergeList } from '../model/listSync';
import { ListDigest, encodeAbortSync, encodeBeginSync, encodeCommitSync, encodeRecordMessage } from './listProtocol';
import { BRIDGE_CHAR, BridgeCharId, TransportError, WatchTransport, withConnection } from './transport';
import { SCHEDULE_RECORD_VERSION, decodeDigest, decodeEventRecord, encodeEventRecord } from './scheduleProtocol';
import { TASK_RECORD_VERSION, TaskDigest, decodeTaskDigest, decodeTaskRecord, encodeSetStreak, encodeTaskRecord } from './tasksProtocol';

const MIN_MTU = 50; // largest record message (event: 3 + 43 B) + ATT overhead
const randomVersion = () => 1 + Math.floor(Math.random() * 0xfffffffe);
const nowSec = () => Math.floor(Date.now() / 1000);

/** Empty watch when this device has synced before — probably a wipe, ask the user. */
/**
 * The watch and this app disagree about the record layout. Whichever is older
 * needs updating; the message says which, because "BLE_ATT_ERR_UNLIKELY" does
 * not help anyone.
 */
export class ProtocolVersionError extends TransportError {
  constructor(label: string, expected: number, actual: number) {
    super(
      actual > expected
        ? `This watch's ${label} uses a newer format (v${actual}) than this app understands (v${expected}). Update the app.`
        : `This watch's ${label} uses an older format (v${actual}) than this app speaks (v${expected}). Update the watch firmware.`,
    );
    this.name = 'ProtocolVersionError';
  }
}

export class ListResetError extends TransportError {
  constructor(label: string) {
    super(`the watch ${label} is empty but this device has synced before`);
    this.name = 'ListResetError';
  }
}

/** Everything a list feature needs to ride the generic sync engine. */
export interface ListSpec<T extends ListItem, D extends ListDigest> {
  /** used in user-facing error text, e.g. "schedule", "task list" */
  label: string;
  /**
   * The record layout this app speaks, matched against the byte the watch puts
   * at the front of its digest.
   *
   * The record layout is simultaneously the BLE protocol and the watch's
   * on-flash format, so a mismatch is not a degraded sync, it is two programs
   * disagreeing about where the fields are. Refusing is the only safe answer,
   * and saying which side is behind is the difference between a fixable message
   * and a raw GATT error.
   */
  protocolVersion: number;
  /** The RecordMessage version byte; the watch rejects anything else. */
  recordVersion: number;
  chars: { sync: BridgeCharId; digest: BridgeCharId; read: BridgeCharId };
  rules: ListMergeRules<T>;
  encodeRecord(item: T): Uint8Array;
  decodeRecord(record: Uint8Array): T;
  decodeDigest(payload: Uint8Array): D;
}

export interface SyncListResult<T extends ListItem, D extends ListDigest> {
  /** true when neither side needed anything */
  skipped: boolean;
  /** the new base snapshot to store (its items are the merged list) */
  base: ListSyncBase<T>;
  /** what changed on this device, for the UI */
  notices: MergeNotice[];
  /** the watch's digest (capacity/count/version + any feature extras, e.g. streak) */
  digest: D;
}

async function pullList<T extends ListItem, D extends ListDigest>(transport: WatchTransport, spec: ListSpec<T, D>, count: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    await transport.write(spec.chars.read, new Uint8Array([i]));
    out.push(spec.decodeRecord(await transport.read(spec.chars.read)));
  }
  return out;
}

async function pushList<T extends ListItem, D extends ListDigest>(transport: WatchTransport, spec: ListSpec<T, D>, items: T[], version: number): Promise<void> {
  try {
    await transport.write(spec.chars.sync, encodeBeginSync(items.length, version));
    for (const [index, item] of items.entries()) {
      await transport.write(spec.chars.sync, encodeRecordMessage(index, spec.encodeRecord(item), spec.recordVersion));
    }
    await transport.write(spec.chars.sync, encodeCommitSync(items.length));
  } catch (e) {
    await transport.write(spec.chars.sync, encodeAbortSync()).catch(() => undefined);
    throw e;
  }
  // Commit is applied on the watch's system task; poll the digest briefly.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 150));
    const digest = spec.decodeDigest(await transport.read(spec.chars.digest));
    if (digest.version === version && digest.count === items.length) {
      return;
    }
  }
  throw new TransportError(`watch did not confirm the ${spec.label} sync`);
}

/**
 * Multi-companion sync of one watch-authoritative list. `acceptReset`: an empty
 * watch (version 0) when this device has synced before usually means the watch
 * was wiped — pass false to get ListResetError (ask the user), true to restore
 * this device's list to the watch.
 */
export async function syncList<T extends ListItem, D extends ListDigest>(
  transport: WatchTransport,
  deviceId: string | undefined,
  spec: ListSpec<T, D>,
  list: SyncedList<T>,
  acceptReset = false,
): Promise<SyncListResult<T, D>> {
  if (!deviceId) {
    throw new TransportError('watch is not paired');
  }
  return withConnection(transport, deviceId, async () => {
    const mtu = await transport.requestMtu(256);
    if (mtu < MIN_MTU) {
      throw new TransportError(`negotiated MTU ${mtu} is too small to sync (need >= ${MIN_MTU})`);
    }

    const digest = spec.decodeDigest(await transport.read(spec.chars.digest));
    if (digest.protocolVersion !== spec.protocolVersion) {
      throw new ProtocolVersionError(spec.label, spec.protocolVersion, digest.protocolVersion);
    }
    const base = list.base;
    const nobodyElseWrote = base !== undefined && digest.version === base.version;

    let theirs: T[];
    if (nobodyElseWrote) {
      theirs = base.items; // watch still holds exactly what we last pushed
    } else {
      theirs = await pullList(transport, spec, digest.count);
      if (!acceptReset && looksLikeReset(theirs, digest.version, base)) {
        throw new ListResetError(spec.label);
      }
    }

    const result = mergeList(list.items, theirs, acceptReset ? undefined : base, spec.rules);

    if (result.merged.length > digest.capacity) {
      throw new TransportError(
        `merged ${spec.label} has ${result.merged.length} items but the watch holds at most ${digest.capacity}; delete some and sync again`,
      );
    }

    if (!result.needsPush && nobodyElseWrote && !result.changedLocally) {
      return { skipped: true, base, notices: [], digest };
    }

    const version = randomVersion();
    await pushList(transport, spec, result.merged, version);
    return { skipped: false, base: { version, syncedAt: nowSec(), items: result.merged }, notices: result.notices, digest };
  });
}

// ---- concrete list specs ----

export const scheduleSpec: ListSpec<WatchEvent, ListDigest> = {
  protocolVersion: 2, // 43-byte records, with the recurring end date
  recordVersion: SCHEDULE_RECORD_VERSION,
  label: 'schedule',
  chars: { sync: BRIDGE_CHAR.scheduleSync, digest: BRIDGE_CHAR.scheduleDigest, read: BRIDGE_CHAR.eventRead },
  rules: {
    equal: (a, b) =>
      a.title === b.title &&
      a.hour === b.hour &&
      a.minute === b.minute &&
      a.anchorDate === b.anchorDate &&
      a.enabled === b.enabled &&
      JSON.stringify(a.rule) === JSON.stringify(b.rule),
    compare: (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute) || a.id - b.id,
  },
  encodeRecord: encodeEventRecord,
  decodeRecord: decodeEventRecord,
  decodeDigest,
};

export const taskSpec: ListSpec<WatchTask, TaskDigest> = {
  protocolVersion: 1,
  recordVersion: TASK_RECORD_VERSION,
  label: 'task list',
  chars: { sync: BRIDGE_CHAR.tasksSync, digest: BRIDGE_CHAR.tasksDigest, read: BRIDGE_CHAR.taskRead },
  rules: {
    equal: (a, b) => a.title === b.title && a.order === b.order,
    compare: (a, b) => a.order - b.order || a.id - b.id,
  },
  encodeRecord: encodeTaskRecord,
  decodeRecord: decodeTaskRecord,
  decodeDigest: decodeTaskDigest,
};

// ---- thin per-feature entry points used by the screens ----

export function syncSchedule(transport: WatchTransport, watch: Watch, acceptReset = false): Promise<SyncListResult<WatchEvent, ListDigest>> {
  return syncList(transport, watch.deviceId, scheduleSpec, watch.schedule, acceptReset);
}

export function syncTasks(transport: WatchTransport, watch: Watch, acceptReset = false): Promise<SyncListResult<WatchTask, TaskDigest>> {
  return syncList(transport, watch.deviceId, taskSpec, watch.tasks, acceptReset);
}

/** Override the watch's streak counter (parent forgives a missed day / sets a reward). */
export async function setTaskStreak(transport: WatchTransport, deviceId: string, streak: number): Promise<void> {
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.tasksSync, encodeSetStreak(streak));
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      const digest = decodeTaskDigest(await transport.read(BRIDGE_CHAR.tasksDigest));
      if (digest.streak === (streak & 0xffff)) {
        return;
      }
    }
    throw new TransportError('watch did not confirm the streak change');
  });
}
