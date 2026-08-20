/**
 * Date helpers — the single place that decides what "today" means.
 *
 * Every date key stored in FinTracker is a LOCAL calendar date (YYYY-MM-DD in
 * the device's timezone). `new Date().toISOString().split('T')[0]` is a bug for
 * this purpose: in UTC+8 an early-morning entry (00:30) shifts back to
 * YESTERDAY's UTC date, and in UTC-5 a late-evening entry (23:00) shifts
 * forward to TOMORROW's. Either way it lands on a day that the "today",
 * streak and monthly readers never look at. Nothing outside this module
 * should format date keys.
 */

/** YYYY-MM-DD in the device's local timezone. */
export function getLocalDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses a YYYY-MM-DD key into a local-midnight Date (never UTC-shifted). */
export function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = parseLocalDateKey(key);
  return !Number.isNaN(d.getTime()) && getLocalDateKey(d) === key;
}

/** Local date key N days from `from` (negative = past). */
export function addDaysKey(from: Date | string, days: number): string {
  const base = typeof from === 'string' ? parseLocalDateKey(from) : new Date(from);
  base.setDate(base.getDate() + days);
  return getLocalDateKey(base);
}

/** YYYY-MM for month-scoped aggregation, local timezone. */
export function getLocalMonthKey(d: Date = new Date()): string {
  return getLocalDateKey(d).slice(0, 7);
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function isToday(dateKey: string, now: Date = new Date()): boolean {
  return dateKey === getLocalDateKey(now);
}

/** Whole days between two local date keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const da = parseLocalDateKey(a).getTime();
  const db = parseLocalDateKey(b).getTime();
  return Math.round((db - da) / msPerDay);
}

/** 今天 / 昨天 / 前天 — used by the natural-language parser. */
export const RELATIVE_DAY_KEYWORDS: Record<string, number> = {
  今天: 0,
  今日: 0,
  昨天: -1,
  昨日: -1,
  前天: -2,
  明天: 1,
};

/**
 * Monday-start week. Taiwan (and ISO) treat Monday as the first day; JS
 * getDay() returns 0 for Sunday, so Sunday has to map to 6, not 0 — getting
 * that wrong silently shifts every weekly total by a day.
 */
export function getLocalWeekStartKey(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? parseLocalDateKey(d) : new Date(d.getTime());
  const dayIndex = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  date.setDate(date.getDate() - dayIndex);
  return getLocalDateKey(date);
}

/** Last day (inclusive) of the Monday-start week containing the given day. */
export function getLocalWeekEndKey(d: Date | string = new Date()): string {
  return addDaysKey(getLocalWeekStartKey(d), 6);
}

/** First day of the month containing the given day. */
export function getMonthStartKey(d: Date | string = new Date()): string {
  const key = typeof d === 'string' ? d : getLocalDateKey(d);
  return `${key.slice(0, 7)}-01`;
}

/**
 * Last day (inclusive) of the month containing the given day. Day 0 of the
 * NEXT month is the last day of this one, which also handles February and
 * leap years without a table.
 */
export function getMonthEndKey(d: Date | string = new Date()): string {
  const start = parseLocalDateKey(getMonthStartKey(d));
  return getLocalDateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0));
}

/** The same-length period immediately before [startKey, endKey]. */
export function previousRange(startKey: string, endKey: string): { startKey: string; endKey: string } {
  const span = daysBetween(startKey, endKey); // inclusive length - 1
  return {
    startKey: addDaysKey(startKey, -(span + 1)),
    endKey: addDaysKey(startKey, -1),
  };
}

/**
 * The previous CALENDAR month, which is not the same as "30 days earlier".
 * Comparing March against "February plus a couple of days" is the kind of
 * off-by-a-bit that makes a spending comparison quietly wrong.
 */
export function previousMonthRange(d: Date | string = new Date()): { startKey: string; endKey: string } {
  const start = parseLocalDateKey(getMonthStartKey(d));
  const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  return { startKey: getLocalDateKey(prev), endKey: getMonthEndKey(getLocalDateKey(prev)) };
}

/** Inclusive [start, end] containment for date keys (lexicographic works for YYYY-MM-DD). */
export function isWithin(dateKey: string, startKey: string, endKey: string): boolean {
  return dateKey >= startKey && dateKey <= endKey;
}
