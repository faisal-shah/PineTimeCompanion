// Data model. A "watch" is one PineTime running our InfiniTime fork; each has
// its own schedule of recurring events, synced via the Schedule Service
// (InfiniTime doc/ScheduleService.md).

export type RuleKind = 'once' | 'everyNDays' | 'weekly' | 'monthly';

export type PrayerMethod = 'mwl' | 'isna' | 'egyptian' | 'ummAlQura' | 'karachi';
export type AsrMadhab = 'standard' | 'hanafi';

/**
 * Per-watch prayer configuration, mirrored byte-for-byte on the watch
 * (InfiniTime doc/PrayerService.md). Coordinates and offset are kept in the
 * integer wire units (degrees x100, quarter-hours) so app<->watch round trips
 * stay exact.
 */
export interface PrayerSettings {
  method: PrayerMethod;
  asrMadhab: AsrMadhab;
  alertsEnabled: boolean;
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

export interface WatchEvent {
  /** random 16-bit id, unique per watch across ALL companions (not sequential) */
  id: number;
  title: string; // shown on the watch; truncated to 23 UTF-8 bytes on sync
  hour: number; // 0-23, watch-local
  minute: number; // 0-59
  /** rule start date (and the date of a one-shot), YYYY-MM-DD local */
  anchorDate: string;
  rule: EventRule;
  enabled: boolean;
  /** UNIX seconds (UTC) of the last edit on any companion; drives merge conflicts */
  lastModified: number;
}

/** What this device last successfully synced — the "base" of the three-way merge. */
export interface SyncBase {
  /** schedule version we committed */
  version: number;
  /** UNIX seconds when the sync happened */
  syncedAt: number;
  events: WatchEvent[];
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
  /** monotonically increasing; the watch echoes it in its Digest */
  scheduleVersion: number;
  /** version last confirmed on the watch (undefined = never synced) */
  syncedVersion?: number;
  lastSyncAt?: string; // ISO timestamp
  /** last successful sync snapshot; absent until the first sync */
  syncBase?: SyncBase;
  batteryPercent?: number;
  /** event slots on the watch, from its Digest; unknown until the first sync */
  capacity?: number;
  /** prayer configuration; absent until first configured */
  prayerSettings?: PrayerSettings;
  /** FindMy beacon key; absent until generated */
  beacon?: BeaconConfig;
  events: WatchEvent[];
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
