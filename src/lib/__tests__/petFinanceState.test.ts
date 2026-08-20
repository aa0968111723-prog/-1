import { describe, it, expect } from 'vitest';
import { computePetFinanceState, computeStreak, levelForXp, pickMoodAndMessage } from '../petFinanceState';
import { FinanceAnalyticsEngine } from '../financeAnalytics';
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

/*
 * The pet must not run its own finance maths.
 *
 * It used to: month expense summed in floating point over an unguarded
 * `t.date.startsWith(...)`, and budget pressure computed as ALL month expense
 * divided by the sum of only the BUDGETED categories. Every one of those
 * disagreed with FinanceAnalyticsEngine, which is what the home screen, the
 * budget page and the AI all read.
 */
describe('the pet agrees with the analytics engine', () => {
  const NOW = new Date(2026, 7, 20, 12, 0, 0);
  const spend = (amount: number, category: string, date = '2026-08-10'): Transaction => ({
    id: `${category}-${amount}`,
    type: 'expense',
    amount,
    category,
    date,
    note: '',
  });
  const base = { goals: [], monthlyIncome: 0, showAmounts: true, now: NOW };

  it('does not warn about a budget because of spending outside it', () => {
    // 餐飲 budgeted at 10000 with only 1000 spent — comfortably fine — plus
    // 20000 of rent that is not budgeted at all. The old maths divided all
    // 21000 by the 10000 of budgets that exist and got 2.1, so the pet warned
    // the user was over budget while the budget page showed 10%.
    const input = {
      ...base,
      transactions: [spend(1000, '餐飲美食'), spend(20000, '居家生活')],
      budgets: { 餐飲美食: { amount: 10000, alertEnabled: true, alertThreshold: 80 } },
    };
    const engine = new FinanceAnalyticsEngine(
      { transactions: input.transactions, budgets: input.budgets },
      NOW,
    );

    expect(engine.getBudgetStatus('month')[0].usage).toBeCloseTo(0.1, 5);
    expect(computePetFinanceState(input).mood).not.toBe('warning');
    // And the month figure is the engine's, to the cent.
    expect(computePetFinanceState(input).monthExpense).toBe(
      engine.totalsFor(engine.monthRange()).expense,
    );
  });

  it('sees the pressure that a duplicated budget key used to hide', () => {
    // 負債償還 is budgeted at 8000 with 7500 spent — 94%, worth a word. The
    // old maths also counted the legacy 'Loan Repayments' key, giving a 13000
    // denominator and 58%, so the pet said nothing at all.
    const input = {
      ...base,
      transactions: [spend(7500, '負債償還')],
      budgets: {
        'Loan Repayments': { amount: 5000, alertEnabled: true, alertThreshold: 80 },
        負債償還: { amount: 8000, alertEnabled: true, alertThreshold: 80 },
      },
    };
    const engine = new FinanceAnalyticsEngine(
      { transactions: input.transactions, budgets: input.budgets },
      NOW,
    );

    expect(engine.getBudgetStatus('month')).toHaveLength(1);
    expect(computePetFinanceState(input).mood).toBe('warning');
  });

  it('survives a row with no date instead of throwing at the native bridge', () => {
    // `t.date.startsWith(...)` threw here, on the path that pushes state to
    // the overlay service.
    const input = {
      ...base,
      transactions: [{ id: 'bad', type: 'expense', amount: 100, category: '餐飲美食', note: '' } as unknown as Transaction],
      budgets: {},
    };
    expect(() => computePetFinanceState(input)).not.toThrow();
    expect(computePetFinanceState(input).monthExpense).toBe(0);
  });

  it('says a budget was exceeded rather than that it is nearby', () => {
    const over = pickMoodAndMessage({
      hour: 12,
      goalReached: false,
      goalClose: false,
      budgetRatio: 1.2,
      hasBudget: true,
      todayCount: 1,
      todayExpense: 100,
      streak: 1,
      showAmounts: true,
    });
    expect(over.message).toContain('超過');
    // Still no judgement — the rule is about blame, not about accuracy.
    for (const word of ['亂花', '浪費', '太多', '不該']) {
      expect(over.message).not.toContain(word);
    }
  });
});
