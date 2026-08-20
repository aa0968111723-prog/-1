import { RecurringTransaction } from '../types';
import { getLocalDateKey, parseLocalDateKey } from './datetime';

/**
 * When a recurring rule falls due, and on what day.
 *
 * This was inline arithmetic in App.tsx, which meant it was untested, and it
 * was wrong in a way that quietly rewrites the user's intent:
 *
 *   rent on 2026-01-31, advanced with Date.setMonth(+1)
 *     -> 2026-03-03 -> 2026-04-03 -> 2026-05-03 -> ...
 *
 * February is skipped outright, and the anchor moves to the 3rd permanently.
 * It is not only February either — a rule on the 31st drifts every time it
 * meets a 30-day month (2026-03-31 -> 2026-05-01, April gone). Setting rent or
 * salary for the last day of the month is completely ordinary, and the app
 * silently converted it into "the 3rd, from now on".
 *
 * The fix is to keep the anchor day from the rule's start date and clamp it to
 * each target month, so a 31st rule posts on the 28th in February and returns
 * to the 31st in March. The cursor never becomes the new anchor.
 */

/** The day of the month the user actually chose. */
export function anchorDayOf(rule: Pick<RecurringTransaction, 'startDate'>): number {
  const d = parseLocalDateKey(rule.startDate);
  const day = d.getDate();
  return Number.isFinite(day) && day >= 1 ? day : 1;
}

/** Last calendar day of the month containing `year`/`monthIndex`. */
function lastDayOfMonth(year: number, monthIndex: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * The occurrence after [cursor], honouring the rule's anchor day.
 *
 * [anchorDay] is passed in rather than read from the cursor: reading it from
 * the cursor is exactly how the drift compounds, because February's clamped
 * 28th would become the anchor for March.
 */
export function nextOccurrence(
  frequency: RecurringTransaction['frequency'],
  cursorKey: string,
  anchorDay: number,
): string {
  const cursor = parseLocalDateKey(cursorKey);

  if (frequency === 'daily') {
    cursor.setDate(cursor.getDate() + 1);
    return getLocalDateKey(cursor);
  }
  if (frequency === 'weekly') {
    cursor.setDate(cursor.getDate() + 7);
    return getLocalDateKey(cursor);
  }

  const monthsToAdd = frequency === 'yearly' ? 12 : 1;
  const year = cursor.getFullYear();
  const targetMonth = cursor.getMonth() + monthsToAdd;
  // Normalised by the Date constructor, so December + 1 rolls the year.
  const normalised = new Date(year, targetMonth, 1);
  const day = Math.min(
    anchorDay,
    lastDayOfMonth(normalised.getFullYear(), normalised.getMonth()),
  );
  return getLocalDateKey(new Date(normalised.getFullYear(), normalised.getMonth(), day));
}

export interface DueOccurrences {
  /** Date keys to post, oldest first. */
  dates: string[];
  /** Where the rule's cursor should be left. */
  nextDate: string;
}

/** Guard against a corrupt rule spinning forever; ~3 years of daily postings. */
const MAX_CATCHUP = 1000;

/**
 * Every occurrence of [rule] that is due on or before [todayKey].
 *
 * Returns the dates rather than writing them, so the caller keeps ownership of
 * the deterministic `recurring:<ruleId>:<dateKey>` id and its idempotency.
 */
export function dueOccurrences(rule: RecurringTransaction, todayKey: string): DueOccurrences {
  const anchorDay = anchorDayOf(rule);
  const dates: string[] = [];
  let cursor = rule.nextDate;

  while (cursor <= todayKey && dates.length < MAX_CATCHUP) {
    dates.push(cursor);
    const advanced = nextOccurrence(rule.frequency, cursor, anchorDay);
    // A frequency we do not understand would otherwise loop forever on an
    // unchanged cursor.
    if (advanced <= cursor) break;
    cursor = advanced;
  }

  return { dates, nextDate: cursor };
}
