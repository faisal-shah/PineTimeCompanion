// Transport-agnostic sync + companion functions. All logic lives here, above
// the WatchTransport seam, so the whole flow is emulator-testable.

import { SyncBase, TaskSyncBase, Watch, WatchEvent, WatchTask } from '../model/types';
import { looksLikeTaskReset, mergeTasks } from '../model/tasksMerge';
import {
  decodeTaskDigest,
  decodeTaskRecord,
  encodeAbortSync as encodeTaskAbort,
  encodeBeginSync as encodeTaskBegin,
  encodeCommitSync as encodeTaskCommit,
  encodeSetStreak,
  encodeTaskMessage,
} from './tasksProtocol';
import { decodePrayerSettings, encodePrayerSettings, WireSettings } from './prayerProtocol';
import { CurrentWeather, encodeCurrentWeather, encodeForecast, ForecastDay } from './weatherProtocol';
import { decodeStepCount } from './stepsProtocol';
import { BEACON_CONTROL_ENABLE } from './beaconProtocol';
import { MergeNotice, looksLikeWatchReset, mergeSchedules } from '../model/merge';
import {
  decodeDigest,
  decodeEventRecord,
  encodeAbortSync,
  encodeBeginSync,
  encodeCommitSync,
  encodeEventMessage,
} from './scheduleProtocol';
import { BRIDGE_CHAR, TransportError, WatchTransport } from './transport';

const MIN_MTU = 48; // EventRecord message (42 B) + ATT overhead

export class WatchResetError extends TransportError {
  constructor() {
    super('the watch schedule is empty but this device has synced before');
    this.name = 'WatchResetError';
  }
}

export interface SyncResult {
  /** true when neither side needed anything */
  skipped: boolean;
  /** the merged event list (what is now on the watch AND should be local state) */
  events: WatchEvent[];
  /** the new base snapshot to store */
  base: SyncBase;
  /** what changed on this device, for the UI */
  notices: MergeNotice[];
  /** event slots on the watch, from its Digest */
  capacity: number;
}

const randomVersion = () => 1 + Math.floor(Math.random() * 0xfffffffe);

async function pullEvents(transport: WatchTransport, count: number): Promise<WatchEvent[]> {
  const out: WatchEvent[] = [];
  for (let i = 0; i < count; i++) {
    await transport.write(BRIDGE_CHAR.eventRead, new Uint8Array([i]));
    out.push(decodeEventRecord(await transport.read(BRIDGE_CHAR.eventRead)));
  }
  return out;
}

async function pushEvents(transport: WatchTransport, events: WatchEvent[], version: number): Promise<void> {
  try {
    await transport.write(BRIDGE_CHAR.scheduleSync, encodeBeginSync(events.length, version));
    for (const [index, event] of events.entries()) {
      await transport.write(BRIDGE_CHAR.scheduleSync, encodeEventMessage(index, event));
    }
    await transport.write(BRIDGE_CHAR.scheduleSync, encodeCommitSync(events.length));
  } catch (e) {
    await transport.write(BRIDGE_CHAR.scheduleSync, encodeAbortSync()).catch(() => undefined);
    throw e;
  }
  // Commit is applied on the watch's system task; poll the digest briefly.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 150));
    const digest = decodeDigest(await transport.read(BRIDGE_CHAR.scheduleDigest));
    if (digest.scheduleVersion === version && digest.count === events.length) {
      return;
    }
  }
  throw new TransportError('watch did not confirm the sync');
}

/**
 * Multi-companion sync: pull the watch's schedule, three-way merge with this
 * device's list against the last-synced base, push the merged set. The BLE
 * connection is exclusive, so the whole cycle is atomic.
 *
 * `acceptWatchReset`: an empty watch (version 0) when this device has synced
 * before usually means the watch was wiped. Pass false to get WatchResetError
 * (ask the user), true to restore this device's schedule to the watch.
 */
export async function syncWatch(transport: WatchTransport, watch: Watch, acceptWatchReset = false): Promise<SyncResult> {
  if (!watch.deviceId) {
    throw new TransportError('watch is not paired');
  }
  await transport.connect(watch.deviceId);
  try {
    const mtu = await transport.requestMtu(256);
    if (mtu < MIN_MTU) {
      throw new TransportError(`negotiated MTU ${mtu} is too small to sync (need >= ${MIN_MTU})`);
    }

    const digest = decodeDigest(await transport.read(BRIDGE_CHAR.scheduleDigest));
    const base = watch.syncBase;
    const nobodyElseWrote = base !== undefined && digest.scheduleVersion === base.version;

    let theirs: WatchEvent[];
    if (nobodyElseWrote) {
      theirs = base.events; // watch still holds exactly what we last pushed
    } else {
      theirs = await pullEvents(transport, digest.count);
      if (!acceptWatchReset && looksLikeWatchReset(theirs, digest.scheduleVersion, base)) {
        throw new WatchResetError();
      }
    }

    const result = mergeSchedules(watch.events, theirs, acceptWatchReset ? undefined : base);

    if (result.merged.length > digest.capacity) {
      throw new TransportError(
        `merged schedule has ${result.merged.length} events but the watch holds at most ${digest.capacity}; ` +
          'delete some events and sync again'
      );
    }

    if (!result.needsPush && nobodyElseWrote && !result.changedLocally) {
      return {
        skipped: true,
        events: result.merged,
        base,
        notices: [],
        capacity: digest.capacity,
      };
    }

    const version = randomVersion();
    await pushEvents(transport, result.merged, version);
    return {
      skipped: false,
      events: result.merged,
      base: { version, syncedAt: Math.floor(Date.now() / 1000), events: result.merged },
      notices: result.notices,
      capacity: digest.capacity,
    };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

// ---- Daily task checklist sync (the twin of the schedule sync above) ----

export class TaskResetError extends TransportError {
  constructor() {
    super('the watch task list is empty but this device has synced before');
    this.name = 'TaskResetError';
  }
}

export interface SyncTasksResult {
  skipped: boolean;
  tasks: WatchTask[];
  base: TaskSyncBase;
  notices: MergeNotice[];
  capacity: number;
  /** the streak the watch reports (the app displays it; may later override it) */
  streak: number;
}

async function pullTasks(transport: WatchTransport, count: number): Promise<WatchTask[]> {
  const out: WatchTask[] = [];
  for (let i = 0; i < count; i++) {
    await transport.write(BRIDGE_CHAR.taskRead, new Uint8Array([i]));
    out.push(decodeTaskRecord(await transport.read(BRIDGE_CHAR.taskRead)));
  }
  return out;
}

async function pushTasks(transport: WatchTransport, tasks: WatchTask[], version: number): Promise<void> {
  try {
    await transport.write(BRIDGE_CHAR.tasksSync, encodeTaskBegin(tasks.length, version));
    for (const [index, task] of tasks.entries()) {
      await transport.write(BRIDGE_CHAR.tasksSync, encodeTaskMessage(index, task));
    }
    await transport.write(BRIDGE_CHAR.tasksSync, encodeTaskCommit(tasks.length));
  } catch (e) {
    await transport.write(BRIDGE_CHAR.tasksSync, encodeTaskAbort()).catch(() => undefined);
    throw e;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 150));
    const digest = decodeTaskDigest(await transport.read(BRIDGE_CHAR.tasksDigest));
    if (digest.taskVersion === version && digest.count === tasks.length) {
      return;
    }
  }
  throw new TransportError('watch did not confirm the task sync');
}

/**
 * Multi-companion sync of the task DEFINITIONS (title/order), mirroring
 * syncWatch: read the task digest, three-way merge against the last base, push.
 * The streak is read from the digest and returned (completion itself never
 * crosses — it lives only on the watch). `acceptWatchReset` works like syncWatch.
 */
export async function syncTasks(transport: WatchTransport, watch: Watch, acceptWatchReset = false): Promise<SyncTasksResult> {
  if (!watch.deviceId) {
    throw new TransportError('watch is not paired');
  }
  const mine = watch.tasks ?? [];
  await transport.connect(watch.deviceId);
  try {
    const mtu = await transport.requestMtu(256);
    if (mtu < MIN_MTU) {
      throw new TransportError(`negotiated MTU ${mtu} is too small to sync (need >= ${MIN_MTU})`);
    }

    const digest = decodeTaskDigest(await transport.read(BRIDGE_CHAR.tasksDigest));
    const base = watch.taskSyncBase;
    const nobodyElseWrote = base !== undefined && digest.taskVersion === base.version;

    let theirs: WatchTask[];
    if (nobodyElseWrote) {
      theirs = base.tasks;
    } else {
      theirs = await pullTasks(transport, digest.count);
      if (!acceptWatchReset && looksLikeTaskReset(theirs, digest.taskVersion, base)) {
        throw new TaskResetError();
      }
    }

    const result = mergeTasks(mine, theirs, acceptWatchReset ? undefined : base);

    if (result.merged.length > digest.capacity) {
      throw new TransportError(
        `merged task list has ${result.merged.length} tasks but the watch holds at most ${digest.capacity}; delete some and sync again`,
      );
    }

    if (!result.needsPush && nobodyElseWrote && !result.changedLocally) {
      return { skipped: true, tasks: result.merged, base, notices: [], capacity: digest.capacity, streak: digest.streak };
    }

    const version = randomVersion();
    await pushTasks(transport, result.merged, version);
    return {
      skipped: false,
      tasks: result.merged,
      base: { version, syncedAt: Math.floor(Date.now() / 1000), tasks: result.merged },
      notices: result.notices,
      capacity: digest.capacity,
      streak: digest.streak,
    };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/** Override the watch's streak counter (parent forgives a missed day / sets a reward). */
export async function setTaskStreak(transport: WatchTransport, deviceId: string, streak: number): Promise<void> {
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.tasksSync, encodeSetStreak(streak));
    // confirm by read-back
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      const digest = decodeTaskDigest(await transport.read(BRIDGE_CHAR.tasksDigest));
      if (digest.streak === (streak & 0xffff)) {
        return;
      }
    }
    throw new TransportError('watch did not confirm the streak change');
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/** Standard CTS 0x2A2B write (year LE, month, day, h, m, s, dow 1=Mon..7=Sun, frac256, reason). */
export function encodeCurrentTime(now: Date): Uint8Array {
  const b = new Uint8Array(10);
  const year = now.getFullYear();
  b[0] = year & 0xff;
  b[1] = year >> 8;
  b[2] = now.getMonth() + 1;
  b[3] = now.getDate();
  b[4] = now.getHours();
  b[5] = now.getMinutes();
  b[6] = now.getSeconds();
  b[7] = ((now.getDay() + 6) % 7) + 1;
  b[8] = Math.floor((now.getMilliseconds() * 256) / 1000);
  b[9] = 0;
  return b;
}

/** New Alert (0x2A46) the way Gadgetbridge sends notifications to InfiniTime. */
export function encodeMessageAlert(title: string, body: string): Uint8Array {
  const text = new TextEncoder().encode(`${title}\0${body}`).slice(0, 97);
  const out = new Uint8Array(3 + text.length);
  out[0] = 0xfa; // category: CustomHuami
  out[1] = 0x01; // one alert
  out[2] = 0xff; // no custom icon
  out.set(text, 3);
  return out;
}

export async function setWatchTime(transport: WatchTransport, deviceId: string): Promise<void> {
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.currentTime, encodeCurrentTime(new Date()));
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

export async function sendMessageToWatch(transport: WatchTransport, deviceId: string, title: string, body: string): Promise<void> {
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.newAlert, encodeMessageAlert(title, body));
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

export async function readBattery(transport: WatchTransport, deviceId: string): Promise<number> {
  await transport.connect(deviceId);
  try {
    const payload = await transport.read(BRIDGE_CHAR.battery);
    if (payload.length < 1) {
      throw new TransportError('empty battery read');
    }
    return payload[0];
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Push current weather + a 5-day forecast to the watch (SimpleWeatherService,
 * two write messages on one write-only char). The watch drops weather older
 * than 24h, so call this on each connect.
 */
export async function writeWeather(
  transport: WatchTransport,
  deviceId: string,
  current: CurrentWeather,
  forecast: ForecastDay[],
): Promise<void> {
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.weather, encodeCurrentWeather(current));
    await transport.write(BRIDGE_CHAR.weather, encodeForecast(current.timestamp, forecast));
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Read the watch's step counts (MotionService). Returns today's running total
 * and yesterday's final total in one connection. Yesterday lets the app backfill
 * the previous day's accurate total (the watch rolls today into yesterday at
 * midnight and only keeps those two). Older firmware without the yesterday char
 * fails that read; we degrade to today-only rather than error.
 */
export async function readStepCounts(
  transport: WatchTransport,
  deviceId: string,
): Promise<{ today: number; yesterday: number | null }> {
  await transport.connect(deviceId);
  try {
    const today = decodeStepCount(await transport.read(BRIDGE_CHAR.steps));
    let yesterday: number | null = null;
    try {
      yesterday = decodeStepCount(await transport.read(BRIDGE_CHAR.stepsYesterday));
    } catch {
      yesterday = null; // firmware predates the yesterday characteristic
    }
    return { today, yesterday };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Write prayer settings and verify by read-back. The watch commits the write
 * asynchronously on its SystemTask, so the read-back retries briefly before
 * concluding the write was lost.
 */
export async function writePrayerSettings(transport: WatchTransport, deviceId: string, settings: WireSettings): Promise<void> {
  const blob = encodePrayerSettings(settings);
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.prayerSettings, blob);
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      const echoed = await transport.read(BRIDGE_CHAR.prayerSettings);
      if (echoed.length === blob.length && echoed.every((b, i) => b === blob[i])) {
        return;
      }
    }
    throw new TransportError('watch did not confirm the prayer settings');
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/** Read the watch's current prayer settings (covers on-watch edits). */
export async function readPrayerSettings(transport: WatchTransport, deviceId: string): Promise<WireSettings> {
  await transport.connect(deviceId);
  try {
    return decodePrayerSettings(await transport.read(BRIDGE_CHAR.prayerSettings));
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Provision the FindMy advertisement key to the watch (Beacon Service). Writes
 * the 28-byte key and confirms via the read-back status byte (hasKey == 1).
 * Normal/connectable mode only.
 */
export async function writeBeaconKey(transport: WatchTransport, deviceId: string, advKey: Uint8Array): Promise<void> {
  if (advKey.length !== 28) {
    throw new TransportError(`advertisement key must be 28 bytes, got ${advKey.length}`);
  }
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.beaconKey, advKey);
    const status = await transport.read(BRIDGE_CHAR.beaconKey);
    if (status.length < 1 || status[0] !== 1) {
      throw new TransportError('watch did not confirm the beacon key');
    }
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Enable beacon mode now. The watch becomes non-connectable immediately, so the
 * connection is expected to drop right after the write; that is success, not an
 * error. Turning beacon mode OFF is only possible on the watch itself.
 */
export async function enableBeacon(transport: WatchTransport, deviceId: string): Promise<void> {
  await transport.connect(deviceId);
  try {
    await transport.write(BRIDGE_CHAR.beaconControl, Uint8Array.of(BEACON_CONTROL_ENABLE));
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}
