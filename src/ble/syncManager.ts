// Transport-agnostic sync + companion functions. All logic lives here, above
// the WatchTransport seam, so the whole flow is emulator-testable.

import { Watch } from '../model/types';
import {
  decodeDigest,
  encodeAbortSync,
  encodeBeginSync,
  encodeCommitSync,
  encodeEventMessage,
  Digest,
} from './scheduleProtocol';
import { BRIDGE_CHAR, TransportError, WatchTransport } from './transport';

const MIN_MTU = 48; // EventRecord message (38 B) + ATT overhead

export interface SyncResult {
  skipped: boolean; // digest already matched
  digest: Digest;
}

export async function syncWatch(transport: WatchTransport, watch: Watch): Promise<SyncResult> {
  if (!watch.deviceId) {
    throw new TransportError('watch is not paired');
  }
  await transport.connect(watch.deviceId);
  try {
    const mtu = await transport.requestMtu(256);
    if (mtu < MIN_MTU) {
      throw new TransportError(`negotiated MTU ${mtu} is too small to sync (need >= ${MIN_MTU})`);
    }

    let digest = decodeDigest(await transport.read(BRIDGE_CHAR.scheduleDigest));
    if (digest.scheduleVersion === watch.scheduleVersion && digest.count === watch.events.length) {
      return { skipped: true, digest };
    }
    const enabledFits = watch.events.length <= digest.capacity;
    if (!enabledFits) {
      throw new TransportError(`schedule has ${watch.events.length} events but the watch holds at most ${digest.capacity}`);
    }

    try {
      await transport.write(BRIDGE_CHAR.scheduleSync, encodeBeginSync(watch.events.length, watch.scheduleVersion));
      for (const [index, event] of watch.events.entries()) {
        await transport.write(BRIDGE_CHAR.scheduleSync, encodeEventMessage(index, event));
      }
      await transport.write(BRIDGE_CHAR.scheduleSync, encodeCommitSync(watch.events.length));
    } catch (e) {
      await transport.write(BRIDGE_CHAR.scheduleSync, encodeAbortSync()).catch(() => undefined);
      throw e;
    }

    // Commit is applied on the watch's system task; poll the digest briefly.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      digest = decodeDigest(await transport.read(BRIDGE_CHAR.scheduleDigest));
      if (digest.scheduleVersion === watch.scheduleVersion && digest.count === watch.events.length) {
        return { skipped: false, digest };
      }
    }
    throw new TransportError(
      `watch did not confirm the sync (wanted v${watch.scheduleVersion}/${watch.events.length}, ` +
        `got v${digest.scheduleVersion}/${digest.count})`
    );
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
