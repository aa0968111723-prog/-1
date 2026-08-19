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
