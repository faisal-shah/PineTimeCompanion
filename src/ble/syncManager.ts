// Transport-agnostic companion operations that aren't list syncs (time, alerts,
// battery, weather, steps, prayer, beacon). All logic lives above the
// WatchTransport seam, so the whole flow is emulator-testable. The
// watch-authoritative list syncs (schedule, tasks, alarms) live in
// listSyncManager.ts on the generic engine.

import { decodePrayerSettings, encodePrayerSettings, WireSettings } from './prayerProtocol';
import { CurrentWeather, encodeCurrentWeather, encodeForecast, ForecastDay } from './weatherProtocol';
import { decodeStepCount } from './stepsProtocol';
import { BEACON_CONTROL_ENABLE } from './beaconProtocol';
import { BRIDGE_CHAR, TransportError, WatchTransport, withConnection } from './transport';
import { encodeCurrentTime } from './ctsProtocol';
import {
  decodeFamilyStateStatus,
  FamilyStateStatus,
  waitForFamilyStateCommit,
} from './familyStateProtocol';
import { familyStateMutationToken } from './familyStateMutationToken';

export { encodeCurrentTime };

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
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.currentTime, encodeCurrentTime(new Date()));
  });
}

export async function sendMessageToWatch(transport: WatchTransport, deviceId: string, title: string, body: string): Promise<void> {
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.newAlert, encodeMessageAlert(title, body));
  });
}

export async function readBattery(transport: WatchTransport, deviceId: string): Promise<number> {
  return withConnection(transport, deviceId, async () => {
    const payload = await transport.read(BRIDGE_CHAR.battery);
    if (payload.length < 1) {
      throw new TransportError('empty battery read');
    }
    return payload[0];
  });
}

export async function readFamilyStateStatus(
  transport: WatchTransport,
  deviceId: string,
): Promise<FamilyStateStatus> {
  return withConnection(transport, deviceId, async () => {
    return decodeFamilyStateStatus(await transport.read(BRIDGE_CHAR.familyStateStatus));
  });
}

export async function readFirmwareFamilyState(
  transport: WatchTransport,
  deviceId: string,
): Promise<{ revision: string; status: FamilyStateStatus }> {
  return withConnection(transport, deviceId, async () => {
    const revision = new TextDecoder()
      .decode(await transport.read(BRIDGE_CHAR.firmwareRevision))
      .replace(/\0+$/, '')
      .trim();
    const status = decodeFamilyStateStatus(
      await transport.read(BRIDGE_CHAR.familyStateStatus),
    );
    return { revision, status };
  });
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
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.weather, encodeCurrentWeather(current));
    await transport.write(BRIDGE_CHAR.weather, encodeForecast(current.timestamp, forecast));
  });
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
  return withConnection(transport, deviceId, async () => {
    const today = decodeStepCount(await transport.read(BRIDGE_CHAR.steps));
    let yesterday: number | null = null;
    try {
      yesterday = decodeStepCount(await transport.read(BRIDGE_CHAR.stepsYesterday));
    } catch {
      yesterday = null; // firmware predates the yesterday characteristic
    }
    return { today, yesterday };
  });
}

/**
 * Write prayer settings and wait for the matching durable family-state commit.
 */
export async function writePrayerSettings(transport: WatchTransport, deviceId: string, settings: WireSettings): Promise<void> {
  const blob = encodePrayerSettings(settings);
  const token = familyStateMutationToken(blob);
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.prayerSettings, blob);
    await waitForFamilyStateCommit(transport, 'prayer_settings', token);
    const echoed = await transport.read(BRIDGE_CHAR.prayerSettings);
    if (echoed.length !== blob.length || !echoed.every((b, i) => b === blob[i])) {
      throw new TransportError('watch published different prayer settings');
    }
  });
}

/** Read the watch's current prayer settings (covers on-watch edits). */
export async function readPrayerSettings(transport: WatchTransport, deviceId: string): Promise<WireSettings> {
  return withConnection(transport, deviceId, async () => {
    return decodePrayerSettings(await transport.read(BRIDGE_CHAR.prayerSettings));
  });
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
  const token = familyStateMutationToken(advKey);
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.beaconKey, advKey);
    await waitForFamilyStateCommit(transport, 'beacon_key', token);
    const status = await transport.read(BRIDGE_CHAR.beaconKey);
    if (status.length < 1 || status[0] !== 1) {
      throw new TransportError('watch did not confirm the beacon key');
    }
  });
}

/**
 * Enable beacon mode now. The watch becomes non-connectable immediately, so the
 * connection is expected to drop right after the write; that is success, not an
 * error. Turning beacon mode OFF is only possible on the watch itself.
 */
export async function enableBeacon(transport: WatchTransport, deviceId: string): Promise<void> {
  return withConnection(transport, deviceId, async () => {
    await transport.write(BRIDGE_CHAR.beaconControl, Uint8Array.of(BEACON_CONTROL_ENABLE));
  });
}
