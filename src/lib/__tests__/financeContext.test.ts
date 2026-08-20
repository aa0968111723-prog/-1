import { describe, it, expect } from 'vitest';
import {
  buildFinanceContext,
  buildGroundedMessage,
  FinanceFunctions,
  FINANCE_SYSTEM_PROMPT,
} from '../financeContext';
import { Transaction, BudgetConfig, Goal, Debt } from '../../types';

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

  it('exposes budgets without raw rows', () => {
    expect(fns.getBudgetStatus()[0].label).toBe('餐飲美食');
  });
});

/*
 * The ledger above has no goals, no debts and no custom category, so every
 * "aggregates only" assertion written against it passed without ever touching
 * the fields that actually leaked. This fixture exists to exercise them.
 */
const PRIVATE_NAMES = {
  goal: '離婚基金',
  debt: '媽媽的醫藥費借款',
  category: '心理諮商',
};

const sensitiveLedger = {
  transactions: [
    tx('2026-08-20', 120, '餐飲美食'),
    // A user-defined category: the label IS user-authored free text.
    tx('2026-08-19', 2400, PRIVATE_NAMES.category),
    tx('2026-08-01', 40000, '薪資收入', 'income'),
  ],
  goals: [
    {
      id: 'g1',
      name: PRIVATE_NAMES.goal,
      targetAmount: 300000,
      currentAmount: 90000,
      targetDate: '2027-06-30',
    },
  ] as Goal[],
  debts: [
    {
      id: 'd1',
      name: PRIVATE_NAMES.debt,
      amount: 180000,
      interestRate: 12.5,
      monthlyPayment: 6000,
    },
  ] as Debt[],
};

describe('names the user typed do not leave the device by default', () => {
  it('keeps goal and debt names out of the default payload', () => {
    const serialised = JSON.stringify(buildFinanceContext(sensitiveLedger, NOW));
    for (const secret of Object.values(PRIVATE_NAMES)) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('substitutes positional labels so the model can still refer to them', () => {
    const ctx = buildFinanceContext(sensitiveLedger, NOW);
    expect(ctx.userNamesIncluded).toBe(false);
    expect(ctx.goals[0].name).toBe('目標 1');
    // Progress is still real — redaction costs the name, not the numbers.
    expect(ctx.goals[0].target).toBe(300000);
    expect(ctx.goals[0].current).toBe(90000);
  });

  it('identifies the worst debt by its rate instead of its name', () => {
    const ctx = buildFinanceContext(sensitiveLedger, NOW);
    expect(ctx.debt.highestRateName).toBeNull();
    expect(ctx.debt.highestRateAnnualPercent).toBe(12.5);
    expect(ctx.debt.totalOutstanding).toBe(180000);
  });

  it('sends the real names only when the caller explicitly opts in', () => {
    const ctx = buildFinanceContext(sensitiveLedger, NOW, { includeUserNames: true });
    expect(ctx.userNamesIncluded).toBe(true);
    expect(ctx.goals[0].name).toBe(PRIVATE_NAMES.goal);
    expect(ctx.debt.highestRateName).toBe(PRIVATE_NAMES.debt);
  });

  it('redacts the function layer too, including internal ids', () => {
    const fns = new FinanceFunctions(sensitiveLedger, NOW);
    const serialised = JSON.stringify({
      goals: fns.getGoalStatus(),
      debt: fns.getDebtSummary(),
      rows: fns.getTransactionsByRange('2026-08-01', '2026-08-31'),
    });

    for (const secret of Object.values(PRIVATE_NAMES)) {
      expect(serialised).not.toContain(secret);
    }
    // uuids are not personal, but they are not the model's business either.
    expect(serialised).not.toContain('g1');
    expect(serialised).not.toContain('d1');

    expect(fns.getGoalStatus()[0].name).toBe('目標 1');
    expect(fns.getDebtSummary().items[0].name).toBe('負債 1');
    // The highest-rate pointer must not carry a second, different name.
    expect(fns.getDebtSummary().highestRate?.name).toBe('負債 1');
  });

  it('replaces a user-defined category label in row lookups', () => {
    const fns = new FinanceFunctions(sensitiveLedger, NOW);
    const rows = fns.getTransactionsByRange('2026-08-01', '2026-08-31');
    expect(rows.some(r => r.category === '餐飲美食')).toBe(true);
    expect(rows.some(r => r.category === '自訂分類')).toBe(true);
    expect(rows.some(r => r.category === PRIVATE_NAMES.category)).toBe(false);
  });
});

describe('the grounded prompt', () => {
  it('forbids invention and re-computation, and requires admitting ignorance', () => {
    expect(FINANCE_SYSTEM_PROMPT).toContain('不要編造');
    expect(FINANCE_SYSTEM_PROMPT).toContain('不要自己重新加總');
    expect(FINANCE_SYSTEM_PROMPT).toContain('沒有那項資料');
  });

  it('tells the model the names are pseudonyms, so it does not invent one', () => {
    expect(FINANCE_SYSTEM_PROMPT).toContain('userNamesIncluded');
    expect(FINANCE_SYSTEM_PROMPT).toContain('位置代號');
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
