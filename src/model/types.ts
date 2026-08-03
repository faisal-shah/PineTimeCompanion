// Data model. A "watch" is one PineTime running our InfiniTime fork; each holds
// several watch-authoritative synced lists (schedule, daily tasks) plus scalar
// settings. The lists all ride the generic list-sync engine (model/listSync.ts).

import { ListItem, SyncedList } from './listSync';

export type RuleKind = 'once' | 'everyNDays' | 'weekly' | 'monthly';

export type PrayerMethod = 'mwl' | 'isna' | 'egyptian' | 'ummAlQura' | 'karachi';
export type AsrMadhab = 'standard' | 'hanafi';

/**
 * Per-watch prayer configuration, mirrored byte-for-byte on the watch
 * (InfiniTime doc/PrayerService.md). Coordinates and offset are kept in the
 * integer wire units (degrees x100, quarter-hours) so app<->watch round trips
 * stay exact.
 */
export type PrayerAlerts = 'off' | 'all' | 'exceptFajr';

export interface PrayerSettings {
  method: PrayerMethod;
  asrMadhab: AsrMadhab;
  /** 'all' vibrates at every prayer; 'exceptFajr' skips the pre-dawn one. */
  alerts: PrayerAlerts;
  /** latitude in degrees x100, north positive (-9000..9000) */
  latE2: number;
  /** longitude in degrees x100, east positive (-18000..18000) */
  lonE2: number;
  /** local clock offset from UTC in quarter hours (-48..+56) */
  utcOffsetQuarters: number;
  /** UNIX seconds of the last edit in this app; drives new-watch prefill */
  editedAt: number;
}

export interface EventRule {
  kind: RuleKind;
  /** everyNDays: interval >= 1 (1 = daily) */
  intervalDays?: number;
  /** weekly: bit 0 = Sunday ... bit 6 = Saturday (matches C tm_wday) */
  weekdayMask?: number;
  /** monthly: 1-31; days past month end clamp to the last day */
  dayOfMonth?: number;
}

export interface WatchEvent extends ListItem {
  // id / title / lastModified come from ListItem (title truncates to 23 UTF-8
  // bytes on sync; lastModified drives merge conflicts).
  hour: number; // 0-23, watch-local
  minute: number; // 0-59
  /**
   * Last day a recurring rule may fire, YYYY-MM-DD local, inclusive. Undefined
   * means it never ends. Meaningless for a one-shot, which ends at its anchor.
   */
  endDate?: string;
  /** rule start date (and the date of a one-shot), YYYY-MM-DD local */
  anchorDate: string;
  rule: EventRule;
  enabled: boolean;
}

/**
 * One item in the daily task checklist. Phone-edited, watch-authoritative,
 * three-way merged across phones like WatchEvent — but a task has no time or
 * recurrence (it's a fixed daily routine). Per-task completion lives ONLY on the
 * watch (resets at midnight) and is never part of this record, so it can't
 * create merge conflicts.
 */
export interface WatchTask extends ListItem {
  // id / title / lastModified come from ListItem.
  /** display order (0..255); the watch lists tasks by it */
  order: number;
}

/** Per-watch FindMy beacon config. Only advertisementKeyB64 goes to the watch. */
export interface BeaconConfig {
  /**
   * 28-byte P-224 private key, base64. Secret — lives in the OS keystore
   * (src/secure/secrets.ts), NOT persisted here. Present only transiently in
   * memory between generate and provision, and blanked by migrateSecrets on
   * older records. Read it via getBeaconPrivateKey(watch.id).
   */
  privateKeyB64?: string;
  advertisementKeyB64: string;
  hashedKeyId: string;
  /** true once the advertisement key has been written to this watch */
  provisioned: boolean;
}

export interface Watch {
  id: string; // app-internal uuid
  name: string; // e.g. "Layla's watch"
  /** BLE device id (MAC) once paired; undefined until then */
  deviceId?: string;
  lastSyncAt?: string; // ISO timestamp
  batteryPercent?: number;
  /** prayer configuration; absent until first configured */
  prayerSettings?: PrayerSettings;
  /** FindMy beacon key; absent until generated */
  beacon?: BeaconConfig;
  /** Forward phone notifications to this watch (Android only, persistent link). */
  forwardNotifications?: boolean;

  /** recurring reminders — watch-authoritative synced list */
  schedule: SyncedList<WatchEvent>;
  /** daily task checklist — watch-authoritative synced list */
  tasks: SyncedList<WatchTask>;
  /** consecutive all-done-days streak, read from the watch; the app may override it */
  taskStreak?: number;
}

export const RULE_KIND_CODES: Record<RuleKind, number> = {
  once: 0,
  everyNDays: 1,
  weekly: 2,
  monthly: 3,
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ruleParamByte(rule: EventRule): number {
  switch (rule.kind) {
    case 'once':
      return 0;
    case 'everyNDays':
      return Math.max(1, rule.intervalDays ?? 1);
    case 'weekly':
      return (rule.weekdayMask ?? 0) & 0x7f;
    case 'monthly':
      return Math.min(31, Math.max(1, rule.dayOfMonth ?? 1));
  }
}

/**
 * The rule line under an event's title, including its end date when it has one.
 *
 * Without the end here, a recurring event that stops next week looks identical
 * to one that runs forever until the day it silently disappears from the watch.
 */
export function describeEvent(event: { rule: EventRule; endDate?: string }, now: Date = new Date()): string {
  const base = describeRule(event.rule);
  if (event.rule.kind === 'once' || event.endDate === undefined) {
    return base;
  }
  const [y, m, d] = event.endDate.split('-').map(Number);
  // Show the year unless it is this one. Without it "until Jun 30" reads the
  // same whether the date passed years ago or is decades away, which is exactly
  // the distinction this line exists to make.
  const until = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(y === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${base} · until ${until}`;
}

export function describeRule(rule: EventRule): string {
  switch (rule.kind) {
    case 'once':
      return 'One time';
    case 'everyNDays':
      return (rule.intervalDays ?? 1) === 1 ? 'Every day' : `Every ${rule.intervalDays} days`;
    case 'weekly': {
      const days = WEEKDAY_LABELS.filter((_, i) => ((rule.weekdayMask ?? 0) >> i) & 1);
      return days.length === 7 ? 'Every day' : days.join(' ');
    }
    case 'monthly':
      return `Monthly on day ${rule.dayOfMonth}`;
  }
}
