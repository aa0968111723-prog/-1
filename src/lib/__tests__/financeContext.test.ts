import { describe, it, expect } from 'vitest';
import {
  buildFinanceContext,
  buildGroundedMessage,
  FinanceFunctions,
  FINANCE_SYSTEM_PROMPT,
} from '../financeContext';
import { Transaction, BudgetConfig } from '../../types';

const NOW = new Date(2026, 7, 20, 12, 0, 0);
let seq = 0;
const tx = (date: string, amount: number, category = '餐飲美食', type: 'expense' | 'income' = 'expense', note = ''): Transaction =>
  ({ id: `t${++seq}`, type, amount, category, date, note });

const ledger = {
  transactions: [
    tx('2026-08-20', 120, '餐飲美食', 'expense', '和媽媽吃飯'),
    tx('2026-08-18', 300, '交通出行', 'expense', '計程車去醫院'),
    tx('2026-08-01', 40000, '薪資收入', 'income'),
    tx('2026-07-15', 200, '餐飲美食'),
  ],
  budgets: { 餐飲美食: { amount: 3000, alertEnabled: true, alertThreshold: 80 } } as Record<string, BudgetConfig>,
};

describe('the default payload is aggregates only', () => {
  const ctx = buildFinanceContext(ledger, NOW);

  it('carries the numbers an assistant needs', () => {
    expect(ctx.thisMonth.expense).toBe(420);
    expect(ctx.thisMonth.income).toBe(40000);
    expect(ctx.lastMonth.expense).toBe(200);
    expect(ctx.categoryChanges[0].label).toBe('交通出行');
  });

  it('contains no note text anywhere', () => {
    // The most personal part of a finance app. 「和媽媽吃飯」and
    // 「計程車去醫院」must not leave the device to answer "本月花多少".
    const serialised = JSON.stringify(ctx);
    expect(serialised).not.toContain('和媽媽吃飯');
    expect(serialised).not.toContain('計程車去醫院');
  });

  it('contains no individual transaction rows or ids', () => {
    const serialised = JSON.stringify(ctx);
    expect(serialised).not.toContain('t1');
    expect(serialised).not.toContain('"id"');
  });

  it('rounds percentages so the model is not handed 17 decimal places', () => {
    expect(ctx.expenseChangePercent).toBe(110);
    for (const c of ctx.categoryChanges) {
      if (c.changePercent !== null) expect(Number.isInteger(c.changePercent * 10)).toBe(true);
    }
  });

  it('reports a null baseline rather than a fake percentage', () => {
    const fresh = buildFinanceContext({ transactions: [tx('2026-08-05', 50)] }, NOW);
    expect(fresh.expenseChangePercent).toBeNull();
    expect(fresh.savingsRatePercent).toBeNull();
  });
});

describe('the function layer', () => {
  const fns = new FinanceFunctions(ledger, NOW);

  it('answers a summary from computed values', () => {
    const s = fns.getFinanceSummary('month');
    expect(s.expense).toBe(420);
    expect(s.previousExpense).toBe(200);
    expect(s.expenseChangePercent).toBe(110);
  });

  it('redacts notes from row lookups by default', () => {
    const rows = fns.getTransactionsByRange('2026-08-01', '2026-08-31');
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.note === undefined)).toBe(true);
  });

  it('includes notes only when explicitly asked', () => {
    const rows = fns.getTransactionsByRange('2026-08-01', '2026-08-31', { includeNotes: true });
    expect(rows.some(r => r.note === '和媽媽吃飯')).toBe(true);
  });

  it('caps a row lookup so a broad range cannot drain the ledger', () => {
    const many = { transactions: Array.from({ length: 500 }, (_, i) => tx('2026-08-10', i + 1)) };
    const wide = new FinanceFunctions(many, NOW);
    expect(wide.getTransactionsByRange('2000-01-01', '2100-01-01')).toHaveLength(50);
    expect(wide.getTransactionsByRange('2000-01-01', '2100-01-01', { limit: 9999 })).toHaveLength(200);
  });

  it('exposes budgets, goals and debt without raw rows', () => {
    expect(fns.getBudgetStatus()[0].label).toBe('餐飲美食');
    expect(fns.getGoalStatus()).toEqual([]);
    expect(fns.getDebtSummary().count).toBe(0);
  });
});

describe('the grounded prompt', () => {
  it('forbids invention and re-computation, and requires admitting ignorance', () => {
    expect(FINANCE_SYSTEM_PROMPT).toContain('不要編造');
    expect(FINANCE_SYSTEM_PROMPT).toContain('不要自己重新加總');
    expect(FINANCE_SYSTEM_PROMPT).toContain('沒有那項資料');
  });

  it('carries the same no-shaming rule as the insight engine', () => {
    for (const word of ['亂花', '浪費', '太多', '不該']) {
      expect(FINANCE_SYSTEM_PROMPT).toContain(word); // named as forbidden
    }
    expect(FINANCE_SYSTEM_PROMPT).toContain('不評價');
  });

  it('wraps the question with the context so the model cannot miss it', () => {
    const msg = buildGroundedMessage('我這個月花多少？', buildFinanceContext(ledger, NOW));
    expect(msg).toContain('FINANCE_CONTEXT:');
    expect(msg).toContain('我這個月花多少？');
    expect(msg).toContain('"expense": 420');
  });
});
