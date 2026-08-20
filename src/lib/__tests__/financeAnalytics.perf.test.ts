import { describe, it, expect } from 'vitest';
import { FinanceAnalyticsEngine } from '../financeAnalytics';
import { Transaction, BudgetConfig } from '../../types';

/**
 * Scale check for the analytics engine.
 *
 * The point is not to pin an exact millisecond count — CI runners vary far too
 * much for that to be anything but a flaky test. The point is to catch a
 * change in COMPLEXITY: if someone replaces the day-bucket index with a scan
 * over every transaction per query, 50k rows stops being interactive and this
 * test fails loudly instead of the app quietly janking on a real ledger.
 *
 * Thresholds are deliberately generous (a slow shared runner should still
 * pass) while being far below what an accidental O(n) per query would cost.
 */

const CATEGORIES = ['餐飲美食', '交通出行', '休閒娛樂', '購物消費', '居家生活', '水電網費'];

/** Deterministic pseudo-random so a failure reproduces exactly. */
function makeLedger(count: number, endDate = new Date(2026, 7, 20)): Transaction[] {
  const out: Transaction[] = new Array(count);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    // Spread across ~3 years so month/week queries hit realistic bucket counts.
    const daysBack = Math.floor(rand() * 1095);
    const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - daysBack);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const isIncome = rand() < 0.05;
    out[i] = {
      id: `perf-${i}`,
      type: isIncome ? 'income' : 'expense',
      amount: Math.round(rand() * 200000) / 100,
      category: isIncome ? '薪資收入' : CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
      date: `${y}-${m}-${day}`,
      note: '',
    };
  }
  return out;
}

const budgets: Record<string, BudgetConfig> = Object.fromEntries(
  CATEGORIES.map(c => [c, { amount: 8000, alertEnabled: true, alertThreshold: 80 }]),
);

function bench(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  // Printed so the numbers land in the CI log as a record, per the benchmark ask.
  console.log(`[analytics perf] ${label}: ${ms.toFixed(1)}ms`);
  return ms;
}

describe('analytics at scale', () => {
  it('indexes 10,000 transactions and answers a full analyze() quickly', () => {
    const transactions = makeLedger(10_000);
    let engine!: FinanceAnalyticsEngine;
    const build = bench('10k build index', () => {
      engine = new FinanceAnalyticsEngine({ transactions, budgets }, new Date(2026, 7, 20, 12));
    });
    const analyze = bench('10k analyze(month)', () => {
      engine.analyze('month');
    });
    expect(build).toBeLessThan(1500);
    expect(analyze).toBeLessThan(500);
  });

  it('handles 50,000 transactions without falling off a cliff', () => {
    const transactions = makeLedger(50_000);
    let engine!: FinanceAnalyticsEngine;
    const build = bench('50k build index', () => {
      engine = new FinanceAnalyticsEngine({ transactions, budgets }, new Date(2026, 7, 20, 12));
    });
    const analyze = bench('50k analyze(month)', () => {
      engine.analyze('month');
    });
    expect(build).toBeLessThan(4000);
    expect(analyze).toBeLessThan(500);
  });

  it('a month query costs what the month holds, not what the ledger holds', () => {
    // The real complexity guard, and it has to be built carefully to BE one.
    //
    // Comparing "5k ledger" against "50k ledger" over the same date span proves
    // nothing: the bigger ledger also has ~10x more rows inside the queried
    // month, so honest per-row work already explains a 10x difference and a
    // full scan would hide inside it.
    //
    // So: hold the queried month CONSTANT at 2,000 rows in both ledgers, and
    // vary only how much history sits outside it. Same answer, same in-range
    // work — any extra time in the large case is the implementation touching
    // rows it was never asked about.
    const august = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${tag}-aug-${i}`,
        type: 'expense' as const,
        amount: 100,
        category: '餐飲美食',
        date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
        note: '',
      }));

    const history = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${tag}-old-${i}`,
        type: 'expense' as const,
        amount: 100,
        category: '交通出行',
        // Spread over 2024-2025 only, so it never lands in the queried month.
        date: `${2024 + (i % 2)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        note: '',
      }));

    const now = new Date(2026, 7, 20, 12);
    const lean = new FinanceAnalyticsEngine(
      { transactions: [...august(2_000, 'lean'), ...history(3_000, 'lean')], budgets }, now);
    const heavy = new FinanceAnalyticsEngine(
      { transactions: [...august(2_000, 'heavy'), ...history(48_000, 'heavy')], budgets }, now);

    // Same question, and it must have the same answer in both.
    expect(lean.getSummary('month').expense).toBe(heavy.getSummary('month').expense);
    expect(lean.getSummary('month').transactionCount).toBe(2_000);

    const runs = 20;
    const leanMs = bench('lean(3k history) x20 getSummary', () => {
      for (let i = 0; i < runs; i++) lean.getSummary('month');
    });
    const heavyMs = bench('heavy(48k history) x20 getSummary', () => {
      for (let i = 0; i < runs; i++) heavy.getSummary('month');
    });

    // 16x the out-of-range history, identical in-range work. A per-query full
    // scan would blow straight through this; index lookup barely moves.
    expect(heavyMs).toBeLessThan(Math.max(25, leanMs * 3));
  });

  it('category breakdown over a full year stays interactive', () => {
    const engine = new FinanceAnalyticsEngine(
      { transactions: makeLedger(50_000), budgets },
      new Date(2026, 7, 20, 12),
    );
    const ms = bench('50k breakdown x12 months', () => {
      for (let m = 0; m < 12; m++) engine.getCategoryBreakdown('month');
    });
    expect(ms).toBeLessThan(1000);
  });
});
