/**
 * Money helpers.
 *
 * Amounts are persisted as they always have been (a `number` of TWD, the
 * legacy shape — rewriting stored amounts would risk the ledger for no user
 * benefit). What changes here is that all *arithmetic* goes through integer
 * minor units so repeated addition can never drift the way `0.1 + 0.2` does,
 * and all *rendering* goes through one formatter.
 */

export const DEFAULT_CURRENCY = 'TWD';

/** TWD has no minor unit in practice, but the schema keeps the door open. */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * 120.5 -> 12050. Rounds half AWAY FROM ZERO in both directions.
 *
 * Math.round alone rounds half toward +∞, which silently drops a negative
 * half-cent (-0.005 would become -0) and rounds -0.015 to -1 instead of -2.
 * Negative amounts reach here through subtractAmounts and refunds.
 */
export function toMinor(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const scaled = amount * MINOR_UNITS_PER_MAJOR;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** 12050 -> 120.5 */
export function fromMinor(minor: number): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/** Exact sum: adds in integer space, returns a major-unit number. */
export function sumAmounts(amounts: readonly number[]): number {
  let minor = 0;
  for (const a of amounts) minor += toMinor(a);
  return fromMinor(minor);
}

/** Exact a + b. */
export function addAmounts(a: number, b: number): number {
  return fromMinor(toMinor(a) + toMinor(b));
}

/** Exact a - b. */
export function subtractAmounts(a: number, b: number): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Exact a - b, clamped at zero (debt paydown, goal withdrawal). */
export function subtractClampedAtZero(a: number, b: number): number {
  return fromMinor(Math.max(0, toMinor(a) - toMinor(b)));
}

export interface FormatMoneyOptions {
  /** Include the NT$ prefix (default true). */
  symbol?: boolean;
  /** Force decimals; by default whole amounts render without them. */
  decimals?: number;
  currency?: string;
}

/**
 * The single money formatter: "NT$ 1,280" (or "NT$ 1,280.50" when the amount
 * actually has cents). Every screen renders money through this.
 */
export function formatMoney(amount: number, options: FormatMoneyOptions = {}): string {
  const { symbol = true, decimals, currency = DEFAULT_CURRENCY } = options;
  const value = Number.isFinite(amount) ? amount : 0;
  const fractionDigits = decimals ?? (Number.isInteger(value) ? 0 : 2);
  const body = value.toLocaleString('zh-TW', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  if (!symbol) return body;
  return currency === DEFAULT_CURRENCY ? `NT$ ${body}` : `${currency} ${body}`;
}

/** Compact form for tight overlay bubbles and chart axes: "NT$ 1.2萬". */
export function formatMoneyCompact(amount: number): string {
  if (Math.abs(amount) >= 10_000) {
    const wan = amount / 10_000;
    return `NT$ ${wan.toFixed(Math.abs(wan) >= 100 ? 0 : 1)}萬`;
  }
  return formatMoney(amount);
}

/**
 * Parses user input into a positive amount, or null when it is not a usable
 * number. Rejects 0, negatives, NaN, Infinity and absurd magnitudes so a
 * mistyped entry can never corrupt the ledger.
 */
export const MAX_TRANSACTION_AMOUNT = 1_000_000_000;

export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, '').replace(/^NT\$/i, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TRANSACTION_AMOUNT) return null;
  /*
   * Validate the rounded value, not the raw one.
   *
   * The guard above ran BEFORE rounding, so 0.001 passed it and then rounded
   * to 0 — the function returned a zero amount while documenting that it
   * rejects zero, and callers that only check for null happily recorded a
   * NT$0 transaction.
   */
  const rounded = fromMinor(toMinor(value));
  return rounded > 0 ? rounded : null;
}
