import { describe, it, expect } from 'vitest';
import { computePetFinanceState, computeStreak, levelForXp } from '../petFinanceState';
import { toLocalDateString } from '../financeRepository';
import { Transaction } from '../../types';

const NOW = new Date(2026, 7, 19, 12, 0); // 2026-08-19 noon local

function tx(date: string, amount = 100, type: 'income' | 'expense' = 'expense'): Transaction {
  return { id: `${date}-${Math.random()}`, type, amount, category: '餐飲美食', date, note: '' };
}

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    const txs = [tx('2026-08-19'), tx('2026-08-18'), tx('2026-08-17'), tx('2026-08-14')];
    expect(computeStreak(txs, NOW)).toBe(3);
  });

  it('survives when today has no entry yet (counts from yesterday)', () => {
    const txs = [tx('2026-08-18'), tx('2026-08-17')];
    expect(computeStreak(txs, NOW)).toBe(2);
  });

  it('is zero after a gap', () => {
    expect(computeStreak([tx('2026-08-10')], NOW)).toBe(0);
  });
});

describe('computePetFinanceState', () => {
  const base = { goals: [], monthlyIncome: 50000, showAmounts: false, now: NOW };

  it('celebrates a reached goal above all else', () => {
    const state = computePetFinanceState({
      ...base,
      transactions: [tx('2026-08-19', 99999)],
      budgets: { 餐飲美食: { amount: 100, alertEnabled: true, alertThreshold: 80 } },
      goals: [{ id: 'g', name: 'x', targetAmount: 1000, currentAmount: 1000, targetDate: '2026-12-31' }],
    });
    expect(state.mood).toBe('celebrate');
  });

  it('warns gently near budget without shaming', () => {
    const state = computePetFinanceState({
      ...base,
      transactions: [tx('2026-08-19', 90)],
      budgets: { 餐飲美食: { amount: 100, alertEnabled: true, alertThreshold: 80 } },
    });
    expect(state.mood).toBe('warning');
    expect(state.message).not.toMatch(/亂花|太多|控制不了/);
  });

  it('hides amounts in privacy mode', () => {
    const state = computePetFinanceState({
      ...base,
      transactions: [tx('2026-08-19', 320), tx('2026-08-19', 80)],
      budgets: {},
    });
    expect(state.mood).toBe('happy');
    expect(state.message).toContain('2 筆');
    expect(state.message).not.toContain('NT$');
  });

  it('shows amounts when the user opted in', () => {
    const state = computePetFinanceState({
      ...base,
      showAmounts: true,
      transactions: [tx('2026-08-19', 320)],
      budgets: {},
    });
    expect(state.message).toContain('NT$320');
  });

  it('is sleepy late at night with no entries', () => {
    const state = computePetFinanceState({
      ...base,
      now: new Date(2026, 7, 19, 23, 30),
      transactions: [],
      budgets: {},
    });
    expect(state.mood).toBe('sleepy');
  });

  it('computes habit-based xp and level', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(40)).toBe(3);
    const state = computePetFinanceState({ ...base, transactions: [tx('2026-08-19')], budgets: {} });
    expect(state.xp).toBeGreaterThan(0);
    expect(state.level).toBeGreaterThanOrEqual(1);
  });
});
