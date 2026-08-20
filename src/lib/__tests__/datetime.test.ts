import { describe, it, expect } from 'vitest';
import {
  getLocalDateKey,
  parseLocalDateKey,
  isValidDateKey,
  addDaysKey,
  getLocalMonthKey,
  monthKeyOf,
  isToday,
  daysBetween,
  RELATIVE_DAY_KEYWORDS,
} from '../datetime';

const ORIGINAL_TZ = process.env.TZ;

/**
 * Runs `fn` with the process timezone temporarily switched. Node re-reads
 * process.env.TZ on the next Date operation, so this genuinely moves the
 * "local" clock — which is what makes the UTC-vs-local divergence real
 * rather than hypothetical.
 */
function withTimeZone(tz: string, fn: () => void): void {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

describe('getLocalDateKey', () => {
  it('uses the LOCAL calendar date at 23:30, not the UTC one', () => {
    const evening = new Date(2026, 7, 19, 23, 30); // 19 Aug 2026, 23:30 local
    expect(getLocalDateKey(evening)).toBe('2026-08-19');
  });

  it('uses the LOCAL calendar date at 00:30, not the UTC one', () => {
    const earlyMorning = new Date(2026, 7, 19, 0, 30);
    expect(getLocalDateKey(earlyMorning)).toBe('2026-08-19');
  });

  it('reads the local getters, never toISOString()', () => {
    // A Date-like whose local calendar day is the 19th while its ISO
    // rendering already says the 20th. The old `toISOString().split('T')[0]`
    // implementation would return '2026-08-20' here.
    const localNineteenIsoTwentieth = {
      getFullYear: () => 2026,
      getMonth: () => 7,
      getDate: () => 19,
      toISOString: () => '2026-08-20T03:30:00.000Z',
    } as unknown as Date;
    expect(getLocalDateKey(localNineteenIsoTwentieth)).toBe('2026-08-19');
    expect(getLocalDateKey(localNineteenIsoTwentieth)).not.toBe(
      localNineteenIsoTwentieth.toISOString().slice(0, 10),
    );
  });

  it('west of UTC: a 23:30 entry stays on today even though ISO says tomorrow', () => {
    withTimeZone('America/New_York', () => {
      const evening = new Date(2026, 7, 19, 23, 30);
      // Sanity: the UTC rendering really has rolled over to the 20th.
      expect(evening.toISOString().slice(0, 10)).toBe('2026-08-20');
      expect(getLocalDateKey(evening)).toBe('2026-08-19');
    });
  });

  it('east of UTC: a 00:30 entry stays on today even though ISO says yesterday', () => {
    withTimeZone('Asia/Taipei', () => {
      const earlyMorning = new Date(2026, 7, 19, 0, 30);
      expect(earlyMorning.toISOString().slice(0, 10)).toBe('2026-08-18');
      expect(getLocalDateKey(earlyMorning)).toBe('2026-08-19');
    });
  });

  it('zero-pads single-digit months and days', () => {
    expect(getLocalDateKey(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('defaults to now', () => {
    const now = new Date();
    expect(getLocalDateKey()).toBe(getLocalDateKey(now));
  });
});

describe('parseLocalDateKey', () => {
  it('produces local midnight, never a UTC-shifted instant', () => {
    const d = parseLocalDateKey('2026-08-19');
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getDate()).toBe(19);
    expect(d.getMonth()).toBe(7);
    expect(d.getFullYear()).toBe(2026);
  });

  it('round-trips through getLocalDateKey', () => {
    for (const key of ['2026-08-19', '2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(getLocalDateKey(parseLocalDateKey(key))).toBe(key);
    }
  });

  it('round-trips in a timezone east of UTC', () => {
    withTimeZone('Asia/Taipei', () => {
      const d = parseLocalDateKey('2026-08-19');
      expect(d.getHours()).toBe(0);
      expect(getLocalDateKey(d)).toBe('2026-08-19');
    });
  });
});

describe('isValidDateKey', () => {
  it('accepts a real local date key', () => {
    expect(isValidDateKey('2026-08-19')).toBe(true);
    expect(isValidDateKey('2028-02-29')).toBe(true); // leap day
  });

  it('rejects empty and free-text input', () => {
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey('yesterday')).toBe(false);
    expect(isValidDateKey('今天')).toBe(false);
  });

  it('rejects out-of-range components that would silently roll over', () => {
    expect(isValidDateKey('2026-13-45')).toBe(false);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('2027-02-29')).toBe(false); // 2027 is not a leap year
  });

  it('rejects malformed shapes', () => {
    expect(isValidDateKey('26-08-19')).toBe(false);
    expect(isValidDateKey('2026-8-19')).toBe(false);
    expect(isValidDateKey('2026/08/19')).toBe(false);
    expect(isValidDateKey('2026-08-19T00:00:00Z')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidDateKey(null as unknown as string)).toBe(false);
    expect(isValidDateKey(undefined as unknown as string)).toBe(false);
    expect(isValidDateKey(20260819 as unknown as string)).toBe(false);
    expect(isValidDateKey({} as unknown as string)).toBe(false);
    expect(isValidDateKey(new Date() as unknown as string)).toBe(false);
  });
});

describe('addDaysKey', () => {
  it('crosses a month boundary', () => {
    expect(addDaysKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysKey('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysKey('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles negative offsets of many days', () => {
    expect(addDaysKey('2026-08-19', -60)).toBe('2026-06-20');
    expect(addDaysKey('2026-01-05', -10)).toBe('2025-12-26');
  });

  it('handles a leap day', () => {
    expect(addDaysKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysKey('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDaysKey('2027-02-28', 1)).toBe('2027-03-01'); // non-leap year
  });

  it('accepts a Date as the base and does not mutate it', () => {
    const base = new Date(2026, 7, 19, 13, 45);
    expect(addDaysKey(base, 1)).toBe('2026-08-20');
    expect(getLocalDateKey(base)).toBe('2026-08-19');
    expect(base.getHours()).toBe(13);
  });

  it('is a no-op for zero', () => {
    expect(addDaysKey('2026-08-19', 0)).toBe('2026-08-19');
  });

  it('survives a DST transition', () => {
    withTimeZone('America/New_York', () => {
      // 8 Mar 2026 is the US spring-forward date.
      expect(addDaysKey('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDaysKey('2026-03-08', 1)).toBe('2026-03-09');
    });
  });
});

describe('getLocalMonthKey / monthKeyOf', () => {
  it('returns YYYY-MM for a Date', () => {
    expect(getLocalMonthKey(new Date(2026, 7, 19, 23, 30))).toBe('2026-08');
    expect(getLocalMonthKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01');
  });

  it('defaults to now and agrees with getLocalDateKey', () => {
    expect(getLocalMonthKey()).toBe(getLocalDateKey().slice(0, 7));
  });

  it('monthKeyOf slices a date key', () => {
    expect(monthKeyOf('2026-08-19')).toBe('2026-08');
    expect(monthKeyOf('2026-12-31')).toBe('2026-12');
  });

  it('monthKeyOf agrees with getLocalMonthKey for the same day', () => {
    const d = new Date(2026, 7, 19, 23, 30);
    expect(monthKeyOf(getLocalDateKey(d))).toBe(getLocalMonthKey(d));
  });
});

describe('daysBetween', () => {
  it('is 0 for the same day', () => {
    expect(daysBetween('2026-08-19', '2026-08-19')).toBe(0);
  });

  it('is 1 for consecutive days', () => {
    expect(daysBetween('2026-08-19', '2026-08-20')).toBe(1);
  });

  it('counts correctly across a month', () => {
    expect(daysBetween('2026-08-01', '2026-09-01')).toBe(31);
    expect(daysBetween('2026-08-19', '2026-09-19')).toBe(31);
  });

  it('counts correctly across a year', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('is negative when reversed', () => {
    expect(daysBetween('2026-08-20', '2026-08-19')).toBe(-1);
    expect(daysBetween('2026-09-01', '2026-08-01')).toBe(-31);
  });

  it('rounds through a DST transition instead of drifting', () => {
    withTimeZone('America/New_York', () => {
      expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
      expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    });
  });
});

describe('isToday', () => {
  it('is true for the key produced from `now`', () => {
    const now = new Date(2026, 7, 19, 23, 30);
    expect(isToday('2026-08-19', now)).toBe(true);
    expect(isToday(getLocalDateKey(now), now)).toBe(true);
  });

  it('is false for neighbouring days', () => {
    const now = new Date(2026, 7, 19, 23, 30);
    expect(isToday('2026-08-18', now)).toBe(false);
    expect(isToday('2026-08-20', now)).toBe(false);
  });

  it('defaults to the real clock', () => {
    expect(isToday(getLocalDateKey())).toBe(true);
    expect(isToday('1999-01-01')).toBe(false);
  });
});

describe('RELATIVE_DAY_KEYWORDS', () => {
  it('maps 今天 / 昨天 / 前天 to 0 / -1 / -2', () => {
    expect(RELATIVE_DAY_KEYWORDS['今天']).toBe(0);
    expect(RELATIVE_DAY_KEYWORDS['昨天']).toBe(-1);
    expect(RELATIVE_DAY_KEYWORDS['前天']).toBe(-2);
  });

  it('includes the 今日 / 昨日 / 明天 variants', () => {
    expect(RELATIVE_DAY_KEYWORDS['今日']).toBe(0);
    expect(RELATIVE_DAY_KEYWORDS['昨日']).toBe(-1);
    expect(RELATIVE_DAY_KEYWORDS['明天']).toBe(1);
  });

  it('composes with addDaysKey to produce real date keys', () => {
    const today = '2026-08-19';
    expect(addDaysKey(today, RELATIVE_DAY_KEYWORDS['今天'])).toBe('2026-08-19');
    expect(addDaysKey(today, RELATIVE_DAY_KEYWORDS['昨天'])).toBe('2026-08-18');
    expect(addDaysKey(today, RELATIVE_DAY_KEYWORDS['前天'])).toBe('2026-08-17');
  });
});
