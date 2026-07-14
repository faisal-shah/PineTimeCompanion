// Transport-agnostic sync + companion functions. All logic lives here, above
// the WatchTransport seam, so the whole flow is emulator-testable.

import { SyncBase, Watch, WatchEvent } from '../model/types';
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
