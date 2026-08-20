import { describe, it, expect } from 'vitest';
import {
  FinanceAnalyticsEngine,
  analyzeFinances,
  buildInsights,
  AnalyticsInput,
} from '../financeAnalytics';
import { Transaction, BudgetConfig, Debt, Goal, RecurringTransaction } from '../../types';

let seq = 0;
function tx(date: string, amount: number, category = '餐飲美食', type: 'expense' | 'income' = 'expense'): Transaction {
  return { id: `t${++seq}`, type, amount, category, date, note: '' };
}

/** 2026-08-20 is a Thursday, so its Monday-start week is 08-17 .. 08-23. */
const NOW = new Date(2026, 7, 20, 12, 0, 0);

function engine(input: Partial<AnalyticsInput>, now: Date = NOW) {
  return new FinanceAnalyticsEngine({ transactions: [], ...input }, now);
}

describe('period boundaries', () => {
  it('week runs Monday to Sunday, not Sunday to Saturday', () => {
    const e = engine({});
    expect(e.weekRange().startKey).toBe('2026-08-17');
    expect(e.weekRange().endKey).toBe('2026-08-23');
  });

  it('a Sunday belongs to the week that started the previous Monday', () => {
    // 2026-08-23 is a Sunday. getDay() returns 0 for it; a naive
    // "subtract getDay()" would start its week on the 23rd itself.
    const e = engine({}, new Date(2026, 7, 23, 9, 0, 0));
    expect(e.weekRange().startKey).toBe('2026-08-17');
    expect(e.weekRange().endKey).toBe('2026-08-23');
  });

  it('month range covers the whole calendar month', () => {
    const e = engine({});
    expect(e.monthRange().startKey).toBe('2026-08-01');
    expect(e.monthRange().endKey).toBe('2026-08-31');
  });

  it('handles February in a leap year', () => {
    const e = engine({}, new Date(2028, 1, 10, 12, 0, 0));
    expect(e.monthRange().startKey).toBe('2028-02-01');
    expect(e.monthRange().endKey).toBe('2028-02-29');
  });

  it('handles February in a non-leap year', () => {
    const e = engine({}, new Date(2026, 1, 10, 12, 0, 0));
    expect(e.monthRange().endKey).toBe('2026-02-28');
  });
});

describe('totals', () => {
  const input = {
    transactions: [
      tx('2026-08-20', 120),
      tx('2026-08-20', 80),
      tx('2026-08-20', 30000, '薪資收入', 'income'),
      tx('2026-08-18', 500, '交通出行'),
      tx('2026-07-15', 999), // previous month
    ],
  };

  it('today only counts today', () => {
    const t = engine(input).totalsFor(engine(input).dayRange());
    expect(t.expense).toBe(200);
    expect(t.income).toBe(30000);
    expect(t.transactionCount).toBe(3);
  });

  it('month excludes the previous month', () => {
    const m = engine(input).getSummary('month');
    expect(m.expense).toBe(700);
    expect(m.previous.expense).toBe(999);
  });

  it('net cashflow is income minus expense', () => {
    const m = engine(input).getSummary('month');
    expect(m.netCashflow).toBe(30000 - 700);
  });

  it('sums exactly, without float drift', () => {
    const e = engine({ transactions: [tx('2026-08-20', 0.1), tx('2026-08-20', 0.2)] });
    expect(e.totalsFor(e.dayRange()).expense).toBe(0.3);
  });

  it('a month comparison uses the previous CALENDAR month, not 30 days back', () => {
    // 2026-03-01: "30 days earlier" would reach into January and mix two months.
    const e = engine(
      { transactions: [tx('2026-03-05', 100), tx('2026-02-10', 50), tx('2026-01-20', 777)] },
      new Date(2026, 2, 15, 12, 0, 0),
    );
    const s = e.getSummary('month');
    expect(s.expense).toBe(100);
    expect(s.previous.expense).toBe(50); // February only; January must not leak in
  });
});

describe('change percentages', () => {
  it('reports a rise against the previous period', () => {
    const e = engine({ transactions: [tx('2026-08-05', 120), tx('2026-07-05', 100)] });
    expect(e.getSummary('month').expenseChangePercent).toBeCloseTo(20, 5);
  });

  it('returns null instead of Infinity when the baseline was zero', () => {
    // "up ∞%" or "up 100%" from nothing is a dramatic number that means nothing.
    const e = engine({ transactions: [tx('2026-08-05', 120)] });
    expect(e.getSummary('month').expenseChangePercent).toBeNull();
  });
});

describe('category breakdown', () => {
  const input = {
    transactions: [
      tx('2026-08-10', 300, '餐飲美食'),
      tx('2026-08-11', 100, '餐飲美食'),
      tx('2026-08-12', 100, '交通出行'),
      tx('2026-07-10', 200, '餐飲美食'),
    ],
  };

  it('ranks by amount and computes share of the period', () => {
    const rows = engine(input).getCategoryBreakdown('month');
    expect(rows[0].label).toBe('餐飲美食');
    expect(rows[0].amount).toBe(400);
    expect(rows[0].share).toBeCloseTo(0.8, 5);
    expect(rows[1].amount).toBe(100);
  });

  it('compares each category against the same category last period', () => {
    const rows = engine(input).getCategoryBreakdown('month');
    const food = rows.find(r => r.label === '餐飲美食')!;
    expect(food.previousAmount).toBe(200);
    expect(food.changeAmount).toBe(200);
    expect(food.changePercent).toBeCloseTo(100, 5);
  });

  it('folds legacy English labels into the same category as their zh-TW name', () => {
    const e = engine({
      transactions: [tx('2026-08-10', 100, '負債償還'), tx('2026-08-11', 50, 'Loan Repayments')],
    });
    const rows = e.getCategoryBreakdown('month');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(150);
  });

  it('income never appears in the expense breakdown', () => {
    const e = engine({ transactions: [tx('2026-08-10', 50000, '薪資收入', 'income')] });
    expect(e.getCategoryBreakdown('month')).toEqual([]);
  });
});

describe('budget status', () => {
  const budgets: Record<string, BudgetConfig> = {
    餐飲美食: { amount: 5000, alertEnabled: true, alertThreshold: 80 },
    交通出行: { amount: 2000, alertEnabled: true, alertThreshold: 80 },
  };

  it('classifies healthy, approaching and over', () => {
    const e = engine({
      transactions: [tx('2026-08-10', 1000, '餐飲美食'), tx('2026-08-10', 2500, '交通出行')],
      budgets,
    });
    const rows = e.getBudgetStatus('month');
    const food = rows.find(r => r.label === '餐飲美食')!;
    const transport = rows.find(r => r.label === '交通出行')!;
    expect(food.state).toBe('healthy');
    expect(transport.state).toBe('over');
    expect(transport.remaining).toBe(-500);
  });

  it('approaching starts exactly at the configured threshold', () => {
    const e = engine({ transactions: [tx('2026-08-10', 4000, '餐飲美食')], budgets });
    expect(e.getBudgetStatus('month').find(r => r.label === '餐飲美食')!.state).toBe('approaching');
  });

  it('ignores categories with no budget set', () => {
    const e = engine({ transactions: [tx('2026-08-10', 900, '購物消費')], budgets });
    expect(e.getBudgetStatus('month').some(r => r.label === '購物消費')).toBe(false);
  });
});

describe('goals and debts', () => {
  const goals: Goal[] = [
    { id: 'g1', name: '日本旅行', targetAmount: 60000, currentAmount: 48000, targetDate: '2026-11-20' },
  ];
  const debts: Debt[] = [
    { id: 'd1', name: '卡循', amount: 30000, initialAmount: 50000, interestRate: 15, monthlyPayment: 5000, dueDate: '2026-09-01', note: '' },
    { id: 'd2', name: '學貸', amount: 100000, initialAmount: 100000, interestRate: 1.15, monthlyPayment: 2000, dueDate: '2026-09-05', note: '' },
  ];

  it('reports goal progress and what it takes per month', () => {
    const g = engine({ goals }).getGoalStatus()[0];
    expect(g.progress).toBeCloseTo(0.8, 5);
    expect(g.remaining).toBe(12000);
    expect(g.daysLeft).toBe(92);
    expect(g.requiredPerMonth).toBeGreaterThan(0);
  });

  it('clamps progress at 1 for an over-funded goal', () => {
    const g = engine({
      goals: [{ id: 'g2', name: '備用金', targetAmount: 1000, currentAmount: 2500, targetDate: '' }],
    }).getGoalStatus()[0];
    expect(g.progress).toBe(1);
    expect(g.remaining).toBe(0);
    expect(g.requiredPerMonth).toBeNull();
  });

  it('summarises debt and finds the highest rate', () => {
    const d = engine({ debts }).getDebtSummary();
    expect(d.totalOutstanding).toBe(130000);
    expect(d.totalPaidOff).toBe(20000);
    expect(d.monthlyPaymentTotal).toBe(7000);
    expect(d.highestRate!.name).toBe('卡循');
  });
});

describe('derived ratios', () => {
  it('savings rate is null when there was no income', () => {
    expect(engine({ transactions: [tx('2026-08-10', 100)] }).getSavingsRate('month')).toBeNull();
  });

  it('savings rate is the share of income not spent', () => {
    const e = engine({
      transactions: [tx('2026-08-01', 40000, '薪資收入', 'income'), tx('2026-08-10', 10000)],
    });
    expect(e.getSavingsRate('month')).toBeCloseTo(0.75, 5);
  });

  it('normalises recurring commitments to a monthly figure', () => {
    const recurring: RecurringTransaction[] = [
      { id: 'r1', type: 'expense', amount: 1200, category: '居家生活', frequency: 'monthly', startDate: '2026-01-01', nextDate: '2026-09-01', note: '房租' },
      { id: 'r2', type: 'expense', amount: 12000, category: '學習進修', frequency: 'yearly', startDate: '2026-01-01', nextDate: '2027-01-01', note: '年費' },
    ];
    const e = engine({ transactions: [tx('2026-08-10', 4400)], recurring });
    // 1200 + 12000/12 = 2200 against 4400 spent
    expect(e.getFixedCostRatio('month')).toBeCloseTo(0.5, 5);
  });

  it('fixed cost ratio is zero rather than dividing by zero spending', () => {
    expect(engine({ recurring: [] }).getFixedCostRatio('month')).toBe(0);
  });
});

describe('insights never shame', () => {
  const banned = ['亂花', '浪費', '太多', '不該', '又花', '失控', '差勁', '糟糕'];

  it('avoids judgemental wording even when far over budget', () => {
    const e = engine({
      transactions: [tx('2026-08-10', 99999, '餐飲美食'), tx('2026-07-10', 100, '餐飲美食')],
      budgets: { 餐飲美食: { amount: 3000, alertEnabled: true, alertThreshold: 80 } },
    });
    const messages = e.analyze('month').insights.map(i => i.message).join(' ');
    for (const word of banned) expect(messages).not.toContain(word);
  });

  it('states the budget fact without a verdict', () => {
    const e = engine({
      transactions: [tx('2026-08-10', 5000, '餐飲美食')],
      budgets: { 餐飲美食: { amount: 3000, alertEnabled: true, alertThreshold: 80 } },
    });
    const msg = e.analyze('month').insights.find(i => i.id.startsWith('budget:'))!.message;
    expect(msg).toContain('餐飲美食');
    expect(msg).toContain('超過');
  });

  it('says nothing about budgets the user muted', () => {
    const e = engine({
      transactions: [tx('2026-08-10', 5000, '餐飲美食')],
      budgets: { 餐飲美食: { amount: 3000, alertEnabled: false, alertThreshold: 80 } },
    });
    expect(e.analyze('month').insights.some(i => i.id.startsWith('budget:'))).toBe(false);
  });

  it('buildInsights on an empty ledger returns nothing rather than filler', () => {
    const empty = analyzeFinances({ transactions: [] }, 'month', NOW);
    expect(empty.insights).toEqual([]);
    expect(empty.expense).toBe(0);
    expect(empty.savingsRate).toBeNull();
  });
});

describe('analyze()', () => {
  it('returns today, week and month side by side', () => {
    const e = engine({
      transactions: [
        tx('2026-08-20', 100), // today
        tx('2026-08-18', 200), // this week
        tx('2026-08-03', 300), // this month, earlier week
      ],
    });
    const r = e.analyze('month');
    expect(r.today.expense).toBe(100);
    expect(r.week.expense).toBe(300);
    expect(r.month.expense).toBe(600);
  });

  it('tolerates malformed rows instead of throwing', () => {
    const bad: Transaction[] = [
      { id: 'x', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' },
      { id: 'y', type: 'expense', amount: 50, category: '餐飲美食', note: '' } as unknown as Transaction,
      null as unknown as Transaction,
    ];
    const r = analyzeFinances({ transactions: bad }, 'month', NOW);
    expect(r.month.expense).toBe(100);
  });
});

describe('buildInsights is pure', () => {
  it('can be called directly with hand-built inputs', () => {
    const out = buildInsights({
      summary: {
        period: { kind: 'month', startKey: '2026-08-01', endKey: '2026-08-31', label: '本月' },
        income: 0, expense: 100, netCashflow: -100, transactionCount: 1,
        previous: { period: { kind: 'month', startKey: '2026-07-01', endKey: '2026-07-31', label: '上個月' }, income: 0, expense: 200, netCashflow: -200, transactionCount: 1 },
        expenseChangePercent: -50, incomeChangePercent: null, expenseChangeAmount: -100,
      },
      topCategories: [],
      budgetUsage: [],
      goals: [],
    });
    expect(out.some(i => i.id === 'expense:down')).toBe(true);
  });
});
