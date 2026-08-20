/**
 * What the AI is allowed to know, and how it is allowed to know it.
 *
 * Two problems this solves.
 *
 * The first is invention. Until now the assistant was handed no financial data
 * whatsoever — just a system prompt telling it to be a financial advisor. Ask
 * it "我這個月花多少" and it has literally nothing to read, so anything
 * number-shaped it produces is fabricated. Grounding is not a refinement here;
 * without it the feature cannot be correct even in principle.
 *
 * The second is over-sharing. The fix for invention must not be "send the
 * whole ledger". Every raw row carries a note and a merchant, which is the
 * most personal part of a finance app — 「給媽媽的醫藥費」, 「離婚律師諮詢」.
 * None of that needs to leave the device to answer "餐飲比上個月多多少".
 *
 * So the default payload is AGGREGATES ONLY, computed locally by
 * FinanceAnalyticsEngine. Individual rows are reachable only through an
 * explicit range lookup, and even then notes are redacted unless the caller
 * opts in.
 */

import {
  FinanceAnalyticsEngine,
  AnalyticsInput,
  PeriodKind,
  CategoryBreakdownItem,
  BudgetUsageItem,
  GoalProgressItem,
  DebtSummary,
} from './financeAnalytics';
import { Transaction } from '../types';
import { getLocalDateKey } from './datetime';

export interface ContextPeriod {
  label: string;
  startKey: string;
  endKey: string;
  income: number;
  expense: number;
  netCashflow: number;
  transactionCount: number;
}

export interface FinanceContext {
  generatedAt: string;
  currency: string;
  today: ContextPeriod;
  thisWeek: ContextPeriod;
  thisMonth: ContextPeriod;
  lastMonth: ContextPeriod;
  expenseChangePercent: number | null;
  categoryChanges: Array<{
    label: string;
    amount: number;
    previousAmount: number;
    changePercent: number | null;
    share: number;
  }>;
  budgets: Array<{ label: string; budget: number; spent: number; usagePercent: number; state: string }>;
  goals: Array<{ name: string; target: number; current: number; progressPercent: number; daysLeft: number | null }>;
  debt: { totalOutstanding: number; count: number; monthlyPaymentTotal: number; highestRateName: string | null };
  fixedCostRatioPercent: number;
  savingsRatePercent: number | null;
}

function period(label: string, t: { period: { startKey: string; endKey: string }; income: number; expense: number; netCashflow: number; transactionCount: number }): ContextPeriod {
  return {
    label,
    startKey: t.period.startKey,
    endKey: t.period.endKey,
    income: t.income,
    expense: t.expense,
    netCashflow: t.netCashflow,
    transactionCount: t.transactionCount,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * The whole default payload. Aggregates only — no note, no merchant, no
 * individual transaction, no id.
 */
export function buildFinanceContext(input: AnalyticsInput, now: Date = new Date()): FinanceContext {
  const engine = new FinanceAnalyticsEngine(input, now);
  const month = engine.getSummary('month');
  const breakdown = engine.getCategoryBreakdown('month', 8);
  const savings = engine.getSavingsRate('month');
  const debt = engine.getDebtSummary();

  return {
    generatedAt: now.toISOString(),
    currency: 'TWD',
    today: period('今天', engine.totalsFor(engine.dayRange())),
    thisWeek: period('本週', engine.totalsFor(engine.weekRange())),
    thisMonth: period('本月', month),
    lastMonth: period('上個月', month.previous),
    expenseChangePercent: month.expenseChangePercent === null ? null : round1(month.expenseChangePercent),
    categoryChanges: breakdown.map(c => ({
      label: c.label,
      amount: c.amount,
      previousAmount: c.previousAmount,
      changePercent: c.changePercent === null ? null : round1(c.changePercent),
      share: round1(c.share * 100),
    })),
    budgets: engine.getBudgetStatus('month').map(b => ({
      label: b.label,
      budget: b.budget,
      spent: b.spent,
      usagePercent: round1(b.usage * 100),
      state: b.state,
    })),
    goals: engine.getGoalStatus().map(g => ({
      name: g.name,
      target: g.targetAmount,
      current: g.currentAmount,
      progressPercent: round1(g.progress * 100),
      daysLeft: g.daysLeft,
    })),
    debt: {
      totalOutstanding: debt.totalOutstanding,
      count: debt.count,
      monthlyPaymentTotal: debt.monthlyPaymentTotal,
      highestRateName: debt.highestRate?.name ?? null,
    },
    fixedCostRatioPercent: round1(engine.getFixedCostRatio('month') * 100),
    savingsRatePercent: savings === null ? null : round1(savings * 100),
  };
}

// ------------------------------------------------- the function layer (§46)

export interface RedactedTransaction {
  date: string;
  type: string;
  amount: number;
  category: string;
  /** Present only when the caller explicitly asked for notes. */
  note?: string;
}

/**
 * Structured accessors. The model never reads storage; it asks for one of
 * these, and each one returns a bounded, already-computed answer.
 */
export class FinanceFunctions {
  private engine: FinanceAnalyticsEngine;

  constructor(private input: AnalyticsInput, private now: Date = new Date()) {
    this.engine = new FinanceAnalyticsEngine(input, now);
  }

  getFinanceSummary(period: PeriodKind = 'month') {
    const s = this.engine.getSummary(period);
    return {
      period: s.period.label,
      income: s.income,
      expense: s.expense,
      netCashflow: s.netCashflow,
      transactionCount: s.transactionCount,
      previousExpense: s.previous.expense,
      expenseChangePercent: s.expenseChangePercent === null ? null : round1(s.expenseChangePercent),
    };
  }

  getCategoryBreakdown(period: PeriodKind = 'month', limit = 10): CategoryBreakdownItem[] {
    return this.engine.getCategoryBreakdown(period, limit);
  }

  getBudgetStatus(): BudgetUsageItem[] {
    return this.engine.getBudgetStatus('month');
  }

  getGoalStatus(): GoalProgressItem[] {
    return this.engine.getGoalStatus();
  }

  getDebtSummary(): DebtSummary {
    return this.engine.getDebtSummary();
  }

  /**
   * The only path to individual rows, and it is deliberately awkward.
   *
   * Notes stay redacted unless [includeNotes] is passed, and the result is
   * capped — "show me everything" must not become a way to exfiltrate the
   * whole ledger one broad range at a time.
   */
  getTransactionsByRange(
    startKey: string,
    endKey: string,
    options: { includeNotes?: boolean; limit?: number } = {},
  ): RedactedTransaction[] {
    const limit = Math.min(options.limit ?? 50, 200);
    return this.engine
      .getTransactionsByRange(startKey, endKey)
      .slice(0, limit)
      .map((t: Transaction) => ({
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: t.category,
        ...(options.includeNotes && t.note ? { note: t.note } : {}),
      }));
  }
}

/**
 * The system prompt.
 *
 * Everything here exists because of a specific failure mode:
 *
 *  - "只依據提供的資料" stops the model answering from its training data.
 *  - "不要自己重新計算大型總和" stops it re-adding numbers that were already
 *    computed exactly in integer minor units. An LLM summing 300 figures in
 *    prose will be wrong, and confidently.
 *  - "不知道就說不知道" is the one that matters most in a finance app. A
 *    plausible invented number is worse than an admission, because the user
 *    cannot tell the difference.
 *  - The no-shaming rule matches the insight engine; the assistant must not be
 *    the one place in the product that judges people.
 */
export const FINANCE_SYSTEM_PROMPT = `你是 FinTracker 的財務助理。使用繁體中文，簡潔、具體。

【資料來源】
使用者訊息會附上一份 FINANCE_CONTEXT JSON，那是由本機的分析引擎精確計算出來的。
- 只依據 FINANCE_CONTEXT 回答財務數字。
- FINANCE_CONTEXT 裡沒有的東西，就說你手上沒有那項資料，並說明使用者可以去哪裡看。
- 絕對不要編造交易、金額、日期或分類。
- 不要自己重新加總大量數字。引擎已經算好了（而且是用整數精確運算），
  直接引用 income / expense / categoryChanges 等欄位。你可以做簡單的比較與百分比說明。
- 金額一律寫成 NT$ 加千分位，例如 NT$ 1,280。

【隱私】
FINANCE_CONTEXT 只包含彙總數字，不含備註與商家名稱。
使用者若問到某一筆的細節，請告訴他在「收支明細」可以看到，不要猜內容。

【語氣】
陳述事實，不評價。不要說「亂花」「浪費」「太多」「不該」這類字眼，
也不要暗示使用者做錯了。使用者要的是看清楚自己的錢，不是被自己的記帳軟體訓話。
提出建議時給具體可執行的做法，並說清楚那是根據哪個數字。`;

/** Wraps the user's question with the grounding payload. */
export function buildGroundedMessage(question: string, context: FinanceContext): string {
  return `FINANCE_CONTEXT:\n${JSON.stringify(context, null, 1)}\n\n使用者問題：${question}`;
}
