// TypeScript twin of the watch's recurrence math (InfiniTime
// src/components/schedule/ScheduleRules.h) for the "next occurrences" preview
// in the editor. Must agree with the firmware; the firmware side is covered by
// its own host unit tests against the same semantics.

import { EventRule, WatchEvent } from './types';

function anchorDateTime(event: WatchEvent): Date {
  const [y, m, d] = event.anchorDate.split('-').map(Number);
  return new Date(y, m - 1, d, event.hour, event.minute, 0, 0);
}

function atEventTime(base: Date, event: WatchEvent): Date {
  const d = new Date(base);
  d.setHours(event.hour, event.minute, 0, 0);
  return d;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

const lastDayOfMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

/** First occurrence at or after `from`, or undefined. */
export function nextOccurrence(event: WatchEvent, from: Date): Date | undefined {
  if (!event.enabled) {
    return undefined;
  }
  const anchor = anchorDateTime(event);
  const rule: EventRule = event.rule;

  switch (rule.kind) {
    case 'once':
      return anchor >= from ? anchor : undefined;

    case 'everyNDays': {
      const n = Math.max(1, rule.intervalDays ?? 1);
      if (anchor >= from) {
        return anchor;
      }
      const days = Math.floor((from.getTime() - anchor.getTime()) / 86400000);
      let candidate = atEventTime(addDays(anchor, Math.floor(days / n) * n), event);
      while (candidate < from) {
        candidate = atEventTime(addDays(candidate, n), event);
      }
      return candidate;
    }

    case 'weekly': {
      const mask = (rule.weekdayMask ?? 0) & 0x7f;
      if (mask === 0) {
        return undefined;
      }
      let candidate = anchor >= from ? anchor : atEventTime(from, event);
      for (let i = 0; i < 8; i++) {
        if (candidate >= from && candidate >= anchor && (mask >> candidate.getDay()) & 1) {
          return candidate;
        }
        candidate = atEventTime(addDays(candidate, 1), event);
      }
      return undefined;
    }

    case 'monthly': {
      const dom = Math.min(31, Math.max(1, rule.dayOfMonth ?? 1));
      const base = from > anchor ? from : anchor;
      for (let i = 0; i < 14; i++) {
        const year = base.getFullYear();
        const month = base.getMonth() + i;
        const day = Math.min(dom, lastDayOfMonth(year, month));
        const candidate = new Date(year, month, day, event.hour, event.minute, 0, 0);
        if (candidate >= from && candidate >= anchor) {
          return candidate;
        }
      }
      return undefined;
    }
  }
}

/** The next `max` occurrences after `from` (for the editor preview). */
export function upcoming(event: WatchEvent, from: Date, max: number): Date[] {
  const out: Date[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < max; i++) {
    const t = nextOccurrence(event, cursor);
    if (!t) {
      break;
    }
    out.push(t);
    cursor = new Date(t.getTime() + 1000);
  }
  return out;
}
