import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CURRENCY,
  MINOR_UNITS_PER_MAJOR,
  MAX_TRANSACTION_AMOUNT,
  toMinor,
  fromMinor,
  sumAmounts,
  addAmounts,
  subtractAmounts,
  subtractClampedAtZero,
  formatMoney,
  formatMoneyCompact,
  parseAmountInput,
} from '../money';

describe('toMinor / fromMinor', () => {
  it('converts major to minor units', () => {
    expect(toMinor(120)).toBe(12000);
    expect(toMinor(120.5)).toBe(12050);
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(0)).toBe(0);
  });

  it('rounds 0.005 up instead of losing it', () => {
    expect(toMinor(0.005)).toBe(1);
    expect(fromMinor(toMinor(0.005))).toBe(0.01);
  });

  it('round-trips', () => {
    for (const v of [0, 120, 120.5, 0.1, 0.01, 1280, 999999.99]) {
      expect(fromMinor(toMinor(v))).toBe(v);
    }
  });

  it('0.005 does not round-trip to itself — it rounds to a whole cent', () => {
    expect(fromMinor(toMinor(0.005))).not.toBe(0.005);
    expect(fromMinor(toMinor(0.005))).toBe(0.01);
  });

  it('treats non-finite input as 0', () => {
    expect(toMinor(NaN)).toBe(0);
    expect(toMinor(Infinity)).toBe(0);
    expect(toMinor(-Infinity)).toBe(0);
  });

  it('exposes the scale it uses', () => {
    expect(MINOR_UNITS_PER_MAJOR).toBe(100);
    expect(fromMinor(MINOR_UNITS_PER_MAJOR)).toBe(1);
    expect(DEFAULT_CURRENCY).toBe('TWD');
  });
});

describe('sumAmounts', () => {
  it('is exact where naive float addition is not — this is the whole point', () => {
    // Documents why the helper exists:
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
  });

  it('sums 1000 one-cent amounts to exactly 10', () => {
    const cents = Array.from({ length: 1000 }, () => 0.01);
    expect(cents.reduce((a, b) => a + b, 0)).not.toBe(10); // naive drift
    expect(sumAmounts(cents)).toBe(10);
  });

  it('sums an empty list to 0', () => {
    expect(sumAmounts([])).toBe(0);
  });

  it('sums realistic ledger amounts', () => {
    expect(sumAmounts([1280, 65, 35.5, 120.25])).toBe(1500.75);
  });

  it('handles mixed signs', () => {
    expect(sumAmounts([100, -30.3, -0.7])).toBe(69);
  });

  it('ignores non-finite entries rather than poisoning the total', () => {
    expect(sumAmounts([10, NaN, 20])).toBe(30);
    expect(sumAmounts([10, Infinity])).toBe(10);
  });
});

describe('addAmounts / subtractAmounts / subtractClampedAtZero', () => {
  it('adds exactly', () => {
    expect(addAmounts(0.1, 0.2)).toBe(0.3);
    expect(addAmounts(1280, 0.5)).toBe(1280.5);
    expect(addAmounts(0, 0)).toBe(0);
  });

  it('subtracts exactly', () => {
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(subtractAmounts(0.3, 0.1)).toBe(0.2);
    expect(subtractAmounts(1280.5, 0.5)).toBe(1280);
  });

  it('allows subtractAmounts to go negative', () => {
    expect(subtractAmounts(10, 25)).toBe(-15);
  });

  it('subtractClampedAtZero never returns a negative', () => {
    expect(subtractClampedAtZero(10, 25)).toBe(0);
    expect(subtractClampedAtZero(0, 0.01)).toBe(0);
    expect(subtractClampedAtZero(0.1, 0.2)).toBe(0);
    expect(subtractClampedAtZero(1000, 1000)).toBe(0);
  });

  it('subtractClampedAtZero is exact when it does not clamp', () => {
    expect(subtractClampedAtZero(0.3, 0.1)).toBe(0.2);
    expect(subtractClampedAtZero(5000, 1234.56)).toBe(3765.44);
  });

  it('repeated paydowns land exactly on zero', () => {
    let balance = 100;
    for (let i = 0; i < 1000; i += 1) balance = subtractClampedAtZero(balance, 0.1);
    expect(balance).toBe(0);
  });
});

describe('formatMoney', () => {
  it('renders a whole amount with no decimals', () => {
    expect(formatMoney(1280)).toBe('NT$ 1,280');
  });

  it('renders cents with exactly two decimals', () => {
    expect(formatMoney(1280.5)).toBe('NT$ 1,280.50');
    expect(formatMoney(0.05)).toBe('NT$ 0.05');
  });

  it('renders zero', () => {
    expect(formatMoney(0)).toBe('NT$ 0');
  });

  it('renders negatives with a minus sign', () => {
    expect(formatMoney(-1280)).toBe('NT$ -1,280');
    expect(formatMoney(-1280)).toContain('-');
    expect(formatMoney(-0.5)).toBe('NT$ -0.50');
  });

  it('drops the prefix with { symbol: false }', () => {
    expect(formatMoney(1280, { symbol: false })).toBe('1,280');
    expect(formatMoney(1280.5, { symbol: false })).toBe('1,280.50');
  });

  it('honours an explicit decimals override', () => {
    expect(formatMoney(1280, { decimals: 2 })).toBe('NT$ 1,280.00');
    expect(formatMoney(1280.55, { decimals: 0 })).toBe('NT$ 1,281');
  });

  it('uses the currency code as prefix for a non-default currency', () => {
    expect(formatMoney(1280, { currency: 'USD' })).toBe('USD 1,280');
  });

  it('renders NaN and Infinity as NT$ 0 rather than garbage', () => {
    expect(formatMoney(NaN)).toBe('NT$ 0');
    expect(formatMoney(Infinity)).toBe('NT$ 0');
    expect(formatMoney(-Infinity)).toBe('NT$ 0');
    expect(formatMoney(NaN, { symbol: false })).toBe('0');
  });
});

describe('formatMoneyCompact', () => {
  it('uses 萬 at and above ten thousand', () => {
    expect(formatMoneyCompact(12000)).toContain('萬');
    expect(formatMoneyCompact(12000)).toBe('NT$ 1.2萬');
    expect(formatMoneyCompact(10000)).toBe('NT$ 1.0萬');
  });

  it('drops the decimal at and above 100萬', () => {
    expect(formatMoneyCompact(1_000_000)).toBe('NT$ 100萬');
  });

  it('falls back to the plain form below ten thousand', () => {
    expect(formatMoneyCompact(9999)).toBe('NT$ 9,999');
    expect(formatMoneyCompact(9999)).not.toContain('萬');
    expect(formatMoneyCompact(0)).toBe('NT$ 0');
  });

  it('compacts large negatives too', () => {
    expect(formatMoneyCompact(-12000)).toBe('NT$ -1.2萬');
  });
});

describe('parseAmountInput', () => {
  it('parses plain digits', () => {
    expect(parseAmountInput('120')).toBe(120);
  });

  it('tolerates surrounding whitespace and thousands separators', () => {
    expect(parseAmountInput(' 1,280 ')).toBe(1280);
    expect(parseAmountInput('1 280')).toBe(1280);
  });

  it('strips an NT$ prefix', () => {
    expect(parseAmountInput('NT$120')).toBe(120);
    expect(parseAmountInput('nt$1,280')).toBe(1280);
  });

  it('parses decimals', () => {
    expect(parseAmountInput('120.5')).toBe(120.5);
  });

  it('rounds to at most 2 decimals', () => {
    expect(parseAmountInput('12.345')).toBe(12.35);
    expect(parseAmountInput('12.344')).toBe(12.34);
  });

  it('rejects empty, zero, negative and non-numeric input', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('   ')).toBeNull();
    expect(parseAmountInput('0')).toBeNull();
    expect(parseAmountInput('0.00')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('NT$')).toBeNull();
  });

  it('rejects magnitudes that overflow into Infinity', () => {
    expect(parseAmountInput('1e999')).toBeNull();
  });

  it('enforces the MAX_TRANSACTION_AMOUNT boundary', () => {
    expect(MAX_TRANSACTION_AMOUNT).toBe(1_000_000_000);
    expect(parseAmountInput(String(MAX_TRANSACTION_AMOUNT))).toBe(MAX_TRANSACTION_AMOUNT);
    expect(parseAmountInput(String(MAX_TRANSACTION_AMOUNT + 1))).toBeNull();
    expect(parseAmountInput(String(MAX_TRANSACTION_AMOUNT - 1))).toBe(MAX_TRANSACTION_AMOUNT - 1);
  });

  it('round-trips a parsed amount back through the formatter', () => {
    const parsed = parseAmountInput('NT$ 1,280.50');
    expect(parsed).toBe(1280.5);
    expect(formatMoney(parsed as number)).toBe('NT$ 1,280.50');
  });
});

describe('toMinor rounds half away from zero in both directions', () => {
  it('does not swallow a negative half-cent', () => {
    // Math.round alone rounds half toward +Infinity, which turns -0.005 into
    // -0 (the cent vanishes) and -0.015 into -1 instead of -2. Negative
    // amounts reach toMinor through subtractAmounts and refunds.
    expect(toMinor(-0.005)).toBe(-1);
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(-0.015)).toBe(-2);
    expect(toMinor(0.015)).toBe(2);
  });

  it('keeps subtraction symmetric around zero', () => {
    expect(subtractAmounts(0, 0.005)).toBe(-0.01);
    expect(addAmounts(-0.005, 0.005)).toBe(0);
  });
});

describe('parseAmountInput rejects what rounds away to nothing', () => {
  it('returns null for a sub-cent amount instead of zero', () => {
    // The > 0 guard ran before rounding, so these passed it and came back as
    // 0. Three of the five call sites only check for null, so a NT$0
    // transaction was recordable.
    expect(parseAmountInput('0.001')).toBeNull();
    expect(parseAmountInput('0.004')).toBeNull();
  });

  it('still accepts the smallest amount that survives rounding', () => {
    expect(parseAmountInput('0.005')).toBe(0.01);
    expect(parseAmountInput('0.01')).toBe(0.01);
  });

  it('keeps the ordinary cases working', () => {
    expect(parseAmountInput('1,234')).toBe(1234);
    expect(parseAmountInput('NT$250')).toBe(250);
    expect(parseAmountInput('  ')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
  });
});
