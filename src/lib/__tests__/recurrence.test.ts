import { describe, it, expect } from 'vitest';
import { nextOccurrence, dueOccurrences, anchorDayOf } from '../recurrence';
import { RecurringTransaction } from '../../types';

function rule(over: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: 'r1',
    type: 'expense',
    amount: 20000,
    category: '居家生活',
    frequency: 'monthly',
    startDate: '2026-01-31',
    nextDate: '2026-01-31',
    note: '房租',
    ...over,
  };
}

/** Walk a rule forward n times, the way the app does. */
function walk(frequency: RecurringTransaction['frequency'], start: string, n: number): string[] {
  const anchor = anchorDayOf({ startDate: start });
  const out = [start];
  let cursor = start;
  for (let i = 0; i < n; i++) {
    cursor = nextOccurrence(frequency, cursor, anchor);
    out.push(cursor);
  }
  return out;
}

describe('a monthly rule anchored at the end of the month', () => {
  it('does not skip February, and does not move the anchor', () => {
    // Date.setMonth(+1) on 2026-01-31 lands on 2026-03-03: February skipped,
    // and every later posting inherits the 3rd. Rent on the last day of the
    // month is ordinary, and the app was quietly rewriting it.
    expect(walk('monthly', '2026-01-31', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('returns to the anchor after any short month, not just February', () => {
    // 2026-03-31 -> setMonth(+1) -> 2026-05-01, so April vanished too.
    expect(walk('monthly', '2026-03-31', 2)).toEqual(['2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('handles the 29th and 30th the same way', () => {
    expect(walk('monthly', '2026-01-29', 2)).toEqual(['2026-01-29', '2026-02-28', '2026-03-29']);
    expect(walk('monthly', '2026-01-30', 2)).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('uses the real February in a leap year', () => {
    expect(walk('monthly', '2028-01-31', 1)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('rolls the year at December', () => {
    expect(walk('monthly', '2026-12-31', 1)).toEqual(['2026-12-31', '2027-01-31']);
  });
});

describe('the other frequencies', () => {
  it('daily and weekly are plain day arithmetic', () => {
    expect(walk('daily', '2026-02-27', 2)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(walk('weekly', '2026-02-25', 1)).toEqual(['2026-02-25', '2026-03-04']);
  });

  it('a yearly rule on the leap day clamps instead of sliding into March', () => {
    expect(walk('yearly', '2028-02-29', 2)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });
});

describe('catching up', () => {
  it('returns every date the rule owes, oldest first', () => {
    const { dates, nextDate } = dueOccurrences(rule({ nextDate: '2026-01-31' }), '2026-04-15');

    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(nextDate).toBe('2026-04-30');
  });

  it('owes nothing when the next date is still in the future', () => {
    const { dates, nextDate } = dueOccurrences(rule({ nextDate: '2026-09-30' }), '2026-08-20');

    expect(dates).toEqual([]);
    expect(nextDate).toBe('2026-09-30');
  });

  it('posts exactly once on the due day itself', () => {
    const { dates } = dueOccurrences(rule({ nextDate: '2026-08-20' }), '2026-08-20');
    expect(dates).toEqual(['2026-08-20']);
  });

  it('terminates on a rule with an unrecognised frequency', () => {
    // It falls back to monthly rather than refusing to advance. The property
    // that matters is that the cursor always moves, so a corrupt row cannot
    // hang the app in a loop that never posts.
    const broken = rule({ frequency: 'fortnightly' as never, nextDate: '2020-01-01' });
    const { dates, nextDate } = dueOccurrences(broken, '2026-08-20');

    expect(dates.length).toBe(79); // 2020-01-31 .. 2026-07-31, monthly
    expect(nextDate > '2026-08-20').toBe(true);
  });

  it('bounds a very stale daily rule instead of generating unbounded rows', () => {
    const { dates } = dueOccurrences(
      rule({ frequency: 'daily', startDate: '1990-01-01', nextDate: '1990-01-01' }),
      '2026-08-20',
    );
    expect(dates.length).toBe(1000);
  });
});

describe('the anchor comes from the rule, not the cursor', () => {
  it('reads the start date', () => {
    expect(anchorDayOf({ startDate: '2026-01-31' })).toBe(31);
    expect(anchorDayOf({ startDate: '2026-06-05' })).toBe(5);
  });

  it('does not let a clamped February become the new anchor', () => {
    // The whole failure mode in one assertion: advance from the clamped 28th
    // and March must be the 31st again, not the 28th.
    expect(nextOccurrence('monthly', '2026-02-28', 31)).toBe('2026-03-31');
  });
});
