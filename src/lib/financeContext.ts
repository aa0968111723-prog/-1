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
 *
 * "Aggregates only" has to include the names the USER typed, which is where
 * this module previously fell short: goal names and debt names went out
 * verbatim. 「離婚基金」 as a goal name is exactly as revealing as 「離婚律師
 * 諮詢」 as a note — the field it lives in does not make it less personal.
 * So user-authored names are replaced with positional labels (目標 1, 負債 2)
 * unless the caller explicitly opts in, and the payload states which of the
 * two it is so the model never presents a pseudonym as the user's own word.
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
import { DebtSummaryItem } from './financeAnalytics';
import { Transaction } from '../types';
import { getLocalDateKey } from './datetime';
import { CATEGORY_DEFS } from './categoryCatalog';

// One copy, shared with server.ts — see financeSystemPrompt.ts for why.
export { FINANCE_SYSTEM_PROMPT } from './financeSystemPrompt';

/** Labels from the shared catalog are a closed set; anything else is the user's own words. */
const CATALOG_LABELS: ReadonlySet<string> = new Set(
  [...CATEGORY_DEFS.expense, ...CATEGORY_DEFS.income].map(d => d.label),
);

function safeCategoryLabel(stored: string): string {
  return CATALOG_LABELS.has(stored) ? stored : '自訂分類';
}

/**
 * Pseudonymises user-defined category labels, consistently within one payload.
 *
 * Built-in labels come from shared/pet-shared-config.json — a closed set, safe
 * to send. Anything else is a name the user typed, and 「心理諮商」 is no less
 * personal for being a category rather than a note. The same custom category
 * must get the same stand-in everywhere in the payload, or the model will read
 * one category as two.
 */
function categoryRedactor(includeUserNames: boolean): (label: string) => string {
  if (includeUserNames) return label => label;
  const assigned = new Map<string, string>();
  return label => {
    if (CATALOG_LABELS.has(label)) return label;
    const existing = assigned.get(label);
    if (existing) return existing;
    const name = pseudonym('自訂分類', assigned.size);
    assigned.set(label, name);
    return name;
  };
}

export interface ContextOptions {
  /**
   * Send the names the user typed (goal names, debt names) instead of
   * positional labels. Off by default; this is the user's own choice to make,
   * not a default we make for them.
   */
  includeUserNames?: boolean;
}

/** Positional stand-ins. Stable within one payload, meaningless outside it. */
function pseudonym(kind: string, index: number): string {
  return `${kind} ${index + 1}`;
}

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
  /**
   * false = every `name` below is a positional stand-in, not what the user
   * called it. The model is told to phrase answers accordingly.
   */
  userNamesIncluded: boolean;
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
  debt: {
    totalOutstanding: number;
    count: number;
    monthlyPaymentTotal: number;
    highestRateName: string | null;
    /** Always sent: the rate identifies the debt usefully without naming it. */
    highestRateAnnualPercent: number | null;
  };
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
export function buildFinanceContext(
  input: AnalyticsInput,
  now: Date = new Date(),
  options: ContextOptions = {},
): FinanceContext {
  const includeUserNames = options.includeUserNames === true;
  const safeCategory = categoryRedactor(includeUserNames);
  const engine = new FinanceAnalyticsEngine(input, now);
  const month = engine.getSummary('month');
  const breakdown = engine.getCategoryBreakdown('month', 8);
  const savings = engine.getSavingsRate('month');
  const debt = engine.getDebtSummary();

  return {
    generatedAt: now.toISOString(),
    currency: 'TWD',
    userNamesIncluded: includeUserNames,
    today: period('今天', engine.totalsFor(engine.dayRange())),
    thisWeek: period('本週', engine.totalsFor(engine.weekRange())),
    thisMonth: period('本月', month),
    lastMonth: period('上個月', month.previous),
    expenseChangePercent: month.expenseChangePercent === null ? null : round1(month.expenseChangePercent),
    categoryChanges: breakdown.map(c => ({
      label: safeCategory(c.label),
      amount: c.amount,
      previousAmount: c.previousAmount,
      changePercent: c.changePercent === null ? null : round1(c.changePercent),
      share: round1(c.share * 100),
    })),
    budgets: engine.getBudgetStatus('month').map(b => ({
      label: safeCategory(b.label),
      budget: b.budget,
      spent: b.spent,
      usagePercent: round1(b.usage * 100),
      state: b.state,
    })),
    goals: engine.getGoalStatus().map((g, i) => ({
      name: includeUserNames ? g.name : pseudonym('目標', i),
      target: g.targetAmount,
      current: g.currentAmount,
      progressPercent: round1(g.progress * 100),
      daysLeft: g.daysLeft,
    })),
    debt: {
      totalOutstanding: debt.totalOutstanding,
      count: debt.count,
      monthlyPaymentTotal: debt.monthlyPaymentTotal,
      highestRateName: includeUserNames ? (debt.highestRate?.name ?? null) : null,
      highestRateAnnualPercent:
        debt.highestRate === null ? null : round1(debt.highestRate.interestRate),
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
  private readonly includeUserNames: boolean;

  constructor(
    private input: AnalyticsInput,
    private now: Date = new Date(),
    options: ContextOptions = {},
  ) {
    this.engine = new FinanceAnalyticsEngine(input, now);
    this.includeUserNames = options.includeUserNames === true;
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
    const safe = categoryRedactor(this.includeUserNames);
    return this.engine.getCategoryBreakdown(period, limit).map(c => ({
      ...c,
      categoryId: CATALOG_LABELS.has(c.label) ? c.categoryId : '',
      label: safe(c.label),
    }));
  }

  getBudgetStatus(): BudgetUsageItem[] {
    const safe = categoryRedactor(this.includeUserNames);
    return this.engine.getBudgetStatus('month').map(b => ({
      ...b,
      // A custom category's id IS its label, so the id leaks the same text.
      categoryId: CATALOG_LABELS.has(b.label) ? b.categoryId : '',
      label: safe(b.label),
    }));
  }

  /**
   * Ids are dropped and names are pseudonymised by default.
   *
   * This layer leaked more than the default payload did: it returned the raw
   * engine types, so every goal name, every debt name and every internal id
   * went out whole. The model has no use for a uuid, and the name is the
   * user's to share.
   */
  getGoalStatus(): GoalProgressItem[] {
    return this.engine.getGoalStatus().map((g, i) => ({
      ...g,
      id: '',
      name: this.includeUserNames ? g.name : pseudonym('目標', i),
    }));
  }

  getDebtSummary(): DebtSummary {
    const summary = this.engine.getDebtSummary();
    const rename = (d: DebtSummaryItem, i: number): DebtSummaryItem => ({
      ...d,
      id: '',
      name: this.includeUserNames ? d.name : pseudonym('負債', i),
    });
    const items = summary.items.map(rename);
    // Keep the highest-rate pointer consistent with the renamed list rather
    // than renaming it separately, or the model sees two names for one debt.
    const highestIndex = summary.highestRate
      ? summary.items.findIndex(d => d.id === summary.highestRate!.id)
      : -1;
    return {
      ...summary,
      items,
      highestRate: highestIndex >= 0 ? items[highestIndex] : null,
    };
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
        // A stored category is a zh-TW label, and for a user-defined category
        // that label is user-authored text. Resolve through the catalog so
        // only closed-set labels leave; anything unrecognised is generic.
        category: safeCategoryLabel(t.category),
        ...(options.includeNotes && t.note ? { note: t.note } : {}),
      }));
  }
}

/** Wraps the user's question with the grounding payload. */
export function buildGroundedMessage(question: string, context: FinanceContext): string {
  return `FINANCE_CONTEXT:\n${JSON.stringify(context, null, 1)}\n\n使用者問題：${question}`;
}
