import { describe, it, expect } from 'vitest';
import { computeTodaySummary, toLocalDateString } from '../financeRepository';
import { computePetFinanceState } from '../petFinanceState';
import { getQuickCategories } from '../quickCategories';
import { Transaction, CATEGORIES } from '../../types';

function generateTransactions(count: number, now: Date): Transaction[] {
  const txs: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (i % 365));
    txs.push({
      id: `perf-${i}`,
      type: i % 7 === 0 ? 'income' : 'expense',
      amount: (i % 900) + 20,
      category: CATEGORIES.expense[i % CATEGORIES.expense.length],
      date: toLocalDateString(d),
      note: `entry ${i}`,
    });
  }
  return txs;
}

describe('large dataset performance (10k transactions)', () => {
  const now = new Date(2026, 7, 19, 12, 0);
  const txs = generateTransactions(10_000, now);

  it('today summary + pet state + quick categories stay fast', () => {
    const start = performance.now();
    const summary = computeTodaySummary(txs, now);
    const state = computePetFinanceState({
      transactions: txs,
      budgets: {},
      goals: [],
      monthlyIncome: 50000,
      showAmounts: false,
      now,
    });
    const chips = getQuickCategories(txs, 'expense', now, 6, []);
    const elapsed = performance.now() - start;

    expect(summary.count).toBeGreaterThan(0);
    expect(state.xp).toBeGreaterThan(0);
    expect(chips.length).toBeGreaterThan(0);
    // generous bound: these are O(n) passes over 10k rows; anything slower
    // than 500ms would signal an accidental O(n^2) regression
    expect(elapsed).toBeLessThan(500);
  });

  it('JSON round-trip of 10k transactions stays reasonable', () => {
    const start = performance.now();
    const parsed = JSON.parse(JSON.stringify(txs));
    expect(parsed).toHaveLength(10_000);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
