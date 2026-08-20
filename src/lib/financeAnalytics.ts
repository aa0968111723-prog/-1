/**
 * FinanceAnalyticsEngine — the one place that turns a ledger into numbers.
 *
 * Why this exists: the same three questions ("what did I spend this month",
 * "which category moved", "am I near a budget") were being answered in three
 * places — a 90-line useMemo in Dashboard, the pet's display state, and
 * whatever the AI decided to compute from raw rows. Three implementations of
 * one calculation is three chances to disagree, and the one that disagrees
 * silently is the AI, because nobody checks its arithmetic.
 *
 * So: one deterministic engine, three consumers.
 *
 *     FinanceRepository ──> FinanceAnalyticsEngine ──┬──> UI
 *                                                    ├──> 🐣 Pet
 *                                                    └──> AI
 *
 * Two rules this module keeps:
 *
 *  1. Every "today"/"this week"/"this month" is a LOCAL calendar boundary,
 *     via ./datetime. No toISOString().split('T')[0] anywhere.
 *  2. Every sum goes through ./money's integer-minor-unit helpers. Adding
 *     0.1 + 0.2 in float and showing the user NT$ 0.30000000000000004 is not
 *     a rounding curiosity in a finance app, it is a wrong number.
 *
 * Performance: the constructor makes ONE pass to build day/month/category
 * indexes; every query after that reads the index. See the 10k/50k benchmarks
 * in __tests__/financeAnalytics.perf.test.ts.
 */

import { Transaction, BudgetConfig, Debt, Goal, RecurringTransaction } from '../types';
import { isTombstoned } from './tombstone';
import {
  getLocalDateKey,
  getLocalWeekStartKey,
  getLocalWeekEndKey,
  getMonthStartKey,
  getMonthEndKey,
  previousRange,
  previousMonthRange,
  daysBetween,
} from './datetime';
import { sumAmounts, subtractAmounts } from './money';
import { categoryIdForStored, labelForCategoryId, emojiForCategory } from './categoryCatalog';

// ---------------------------------------------------------------- contracts

export type PeriodKind = 'day' | 'week' | 'month' | 'custom';

export interface PeriodRange {
  kind: PeriodKind;
  startKey: string;
  endKey: string;
  label: string;
}

export interface PeriodTotals {
  period: PeriodRange;
  income: number;
  expense: number;
  netCashflow: number;
  transactionCount: number;
}

export interface PeriodComparison extends PeriodTotals {
  previous: PeriodTotals;
  /** null when the previous period had no spending — "up 100%" from zero is noise, not signal. */
  expenseChangePercent: number | null;
  incomeChangePercent: number | null;
  expenseChangeAmount: number;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  label: string;
  emoji: string;
  amount: number;
  /** 0..1 of the period's total expense. */
  share: number;
  previousAmount: number;
  changeAmount: number;
  changePercent: number | null;
}

export type BudgetState = 'healthy' | 'approaching' | 'over';

export interface BudgetUsageItem {
  categoryId: string;
  label: string;
  budget: number;
  spent: number;
  remaining: number;
  /** 0..1+, can exceed 1 when over budget. */
  usage: number;
  state: BudgetState;
  alertEnabled: boolean;
  alertThreshold: number;
}

export interface GoalProgressItem {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  /** 0..1, clamped. */
  progress: number;
  remaining: number;
  targetDate: string;
  daysLeft: number | null;
  /** What it would take per month to land on time; null when undated or done. */
  requiredPerMonth: number | null;
}

export interface DebtSummaryItem {
  id: string;
  name: string;
  amount: number;
  interestRate: number;
  monthlyPayment: number;
}

export interface DebtSummary {
  totalOutstanding: number;
  totalInitial: number;
  totalPaidOff: number;
  monthlyPaymentTotal: number;
  count: number;
  highestRate: DebtSummaryItem | null;
  items: DebtSummaryItem[];
}

export interface Insight {
  id: string;
  /** 'info' states a fact; 'watch' asks for attention. Neither ever scolds. */
  severity: 'info' | 'watch';
  message: string;
}

export interface AnalysisResult {
  generatedAt: string;
  period: PeriodRange;
  income: number;
  expense: number;
  netCashflow: number;
  transactionCount: number;
  previousPeriodExpense: number;
  previousPeriodIncome: number;
  expenseChangePercent: number | null;
  today: PeriodTotals;
  week: PeriodTotals;
  month: PeriodTotals;
  topCategories: CategoryBreakdownItem[];
  budgetUsage: BudgetUsageItem[];
  /** Recurring commitments as a share of this period's expense, 0..1. */
  fixedCostRatio: number;
  /** (income - expense) / income, 0..1; null when there was no income. */
  savingsRate: number | null;
  debt: DebtSummary;
  goals: GoalProgressItem[];
  insights: Insight[];
}

export interface AnalyticsInput {
  transactions: Transaction[];
  budgets?: Record<string, BudgetConfig>;
  debts?: Debt[];
  goals?: Goal[];
  recurring?: RecurringTransaction[];
}

// ----------------------------------------------------------------- helpers

/**
 * Percentage change, or null when there is no meaningful baseline.
 * Returning Infinity or 100 for "was zero, now something" would render as a
 * dramatic number that means nothing.
 */
function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (subtractAmounts(current, previous) / previous) * 100;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A transaction posted by a recurring rule rather than typed by the user.
 *
 * Two markers because both are load-bearing and neither is guaranteed on old
 * rows: `source` is what App.tsx stamps today, and the deterministic
 * `recurring:<ruleId>:<dateKey>` id is what makes the posting idempotent (and
 * is present on every such row ever written, including before `source` existed).
 */
function isRecurringPosting(t: Transaction): boolean {
  return t.source === 'recurring' || (typeof t.id === 'string' && t.id.startsWith('recurring:'));
}

/**
 * Which of two stored budget keys should represent a category.
 *
 * Canonical label wins, then the id itself, then lexical order — the last one
 * only so that a ledger with two equally-legacy keys still produces the same
 * row on every render instead of following object insertion order.
 */
function preferBudgetKey(candidate: string, incumbent: string, categoryId: string): boolean {
  const rank = (key: string): number => {
    if (key === labelForCategoryId(categoryId)) return 0;
    if (key === categoryId) return 1;
    return 2;
  };
  const [a, b] = [rank(candidate), rank(incumbent)];
  return a !== b ? a < b : candidate < incumbent;
}

// ------------------------------------------------------------------ engine

export class FinanceAnalyticsEngine {
  private readonly txs: Transaction[];
  private readonly budgets: Record<string, BudgetConfig>;
  private readonly debts: Debt[];
  private readonly goals: Goal[];
  private readonly recurring: RecurringTransaction[];
  private readonly now: Date;
  private readonly todayKey: string;

  /** date key -> transactions on that day. Built once. */
  private readonly byDay = new Map<string, Transaction[]>();
  /** Ascending date keys, so a range scan can binary-search its bounds. */
  private readonly sortedDayKeys: string[];

  constructor(input: AnalyticsInput, now: Date = new Date()) {
    this.txs = (input.transactions ?? []).filter(t => !isTombstoned(t));
    this.budgets = input.budgets ?? {};
    this.debts = input.debts ?? [];
    this.goals = input.goals ?? [];
    this.recurring = input.recurring ?? [];
    this.now = now;
    this.todayKey = getLocalDateKey(now);

    for (const t of this.txs) {
      if (!t || typeof t.date !== 'string') continue;
      // A tombstone is a row the user deleted; it stays on disk only so the
      // deletion can sync. Summing one would put deleted money back into
      // every total in the app.
      if (isTombstoned(t)) continue;
      const bucket = this.byDay.get(t.date);
      if (bucket) bucket.push(t);
      else this.byDay.set(t.date, [t]);
    }
    this.sortedDayKeys = Array.from(this.byDay.keys()).sort();
  }

  // ---- ranges ----

  dayRange(d: Date = this.now): PeriodRange {
    const key = getLocalDateKey(d);
    return { kind: 'day', startKey: key, endKey: key, label: '今天' };
  }

  weekRange(d: Date = this.now): PeriodRange {
    return { kind: 'week', startKey: getLocalWeekStartKey(d), endKey: getLocalWeekEndKey(d), label: '本週' };
  }

  monthRange(d: Date = this.now): PeriodRange {
    return { kind: 'month', startKey: getMonthStartKey(d), endKey: getMonthEndKey(d), label: '本月' };
  }

  private rangeFor(kind: PeriodKind): PeriodRange {
    if (kind === 'day') return this.dayRange();
    if (kind === 'week') return this.weekRange();
    return this.monthRange();
  }

  /**
   * The comparable previous range. For months this is the previous CALENDAR
   * month, not "31 days earlier" — comparing March with "February plus a bit"
   * is a quietly wrong comparison.
   */
  private previousRangeFor(range: PeriodRange): PeriodRange {
    if (range.kind === 'month') {
      const p = previousMonthRange(range.startKey);
      return { kind: 'month', startKey: p.startKey, endKey: p.endKey, label: '上個月' };
    }
    const p = previousRange(range.startKey, range.endKey);
    return { kind: range.kind, startKey: p.startKey, endKey: p.endKey, label: range.kind === 'day' ? '昨天' : '上一期' };
  }

  // ---- primitives ----

  /** All (non-deleted) transactions in an inclusive local-date range. */
  getTransactionsByRange(startKey: string, endKey: string): Transaction[] {
    const out: Transaction[] = [];
    // Scanning the sorted key list beats scanning every transaction: a month
    // query on a 50k ledger touches ~30 buckets instead of 50k rows.
    for (const key of this.sortedDayKeys) {
      if (key < startKey) continue;
      if (key > endKey) break;
      const bucket = this.byDay.get(key);
      if (bucket) out.push(...bucket);
    }
    return out;
  }

  totalsFor(range: PeriodRange): PeriodTotals {
    const rows = this.getTransactionsByRange(range.startKey, range.endKey);
    const income = sumAmounts(rows.filter(t => t.type === 'income').map(t => t.amount));
    const expense = sumAmounts(rows.filter(t => t.type === 'expense').map(t => t.amount));
    return {
      period: range,
      income,
      expense,
      netCashflow: subtractAmounts(income, expense),
      transactionCount: rows.length,
    };
  }

  // ---- the function layer the AI and the UI both call ----

  getSummary(kind: PeriodKind = 'month'): PeriodComparison {
    const range = this.rangeFor(kind);
    const current = this.totalsFor(range);
    const previous = this.totalsFor(this.previousRangeFor(range));
    return {
      ...current,
      previous,
      expenseChangePercent: percentChange(current.expense, previous.expense),
      incomeChangePercent: percentChange(current.income, previous.income),
      expenseChangeAmount: subtractAmounts(current.expense, previous.expense),
    };
  }

  getCategoryBreakdown(kind: PeriodKind = 'month', limit = 0): CategoryBreakdownItem[] {
    const range = this.rangeFor(kind);
    const prev = this.previousRangeFor(range);
    const current = this.sumByCategory(range);
    const previous = this.sumByCategory(prev);
    const total = sumAmounts(Array.from(current.values()));

    const items: CategoryBreakdownItem[] = [];
    for (const [categoryId, amount] of current) {
      const previousAmount = previous.get(categoryId) ?? 0;
      items.push({
        categoryId,
        label: labelForCategoryId(categoryId),
        emoji: emojiForCategory(categoryId),
        amount,
        share: total > 0 ? amount / total : 0,
        previousAmount,
        changeAmount: subtractAmounts(amount, previousAmount),
        changePercent: percentChange(amount, previousAmount),
      });
    }
    items.sort((a, b) => b.amount - a.amount);
    return limit > 0 ? items.slice(0, limit) : items;
  }

  private sumByCategory(range: PeriodRange): Map<string, number> {
    const perCategory = new Map<string, number[]>();
    for (const t of this.getTransactionsByRange(range.startKey, range.endKey)) {
      if (t.type !== 'expense') continue;
      const id = t.categoryId ?? categoryIdForStored(t.category);
      const bucket = perCategory.get(id);
      if (bucket) bucket.push(t.amount);
      else perCategory.set(id, [t.amount]);
    }
    const out = new Map<string, number>();
    for (const [id, amounts] of perCategory) out.set(id, sumAmounts(amounts));
    return out;
  }

  getBudgetStatus(kind: PeriodKind = 'month'): BudgetUsageItem[] {
    const spentByCategory = this.sumByCategory(this.rangeFor(kind));
    const items: BudgetUsageItem[] = [];

    /*
     * Several stored keys can name one category — a budget saved under the
     * legacy 'Loan Repayments' and another under 負債償還 both resolve to
     * `debt`. Emitting a row each charged the SAME spend to both, so NT$3,000
     * showed up as NT$6,000 of consumption across the two rows and the user
     * looked over budget when they were not.
     *
     * Keep one row per category and prefer the key that is the category's
     * current label (then its id, then lexical order, so the choice is
     * deterministic rather than dependent on object key order). The legacy
     * alias is by definition the old name, so preferring the canonical one
     * keeps the budget the user most recently meant.
     */
    const byCategory = new Map<string, [string, BudgetConfig]>();
    for (const entry of Object.entries(this.budgets)) {
      const [storedKey, config] = entry;
      if (!config || !(config.amount > 0)) continue;
      const categoryId = categoryIdForStored(storedKey);
      const existing = byCategory.get(categoryId);
      if (!existing || preferBudgetKey(storedKey, existing[0], categoryId)) {
        byCategory.set(categoryId, entry);
      }
    }

    for (const [categoryId, [, config]] of byCategory) {
      const spent = spentByCategory.get(categoryId) ?? 0;
      const usage = config.amount > 0 ? spent / config.amount : 0;
      const threshold = config.alertThreshold > 0 ? config.alertThreshold : 80;
      items.push({
        categoryId,
        label: labelForCategoryId(categoryId),
        budget: config.amount,
        spent,
        remaining: subtractAmounts(config.amount, spent),
        usage,
        state: usage >= 1 ? 'over' : usage * 100 >= threshold ? 'approaching' : 'healthy',
        alertEnabled: config.alertEnabled !== false,
        alertThreshold: threshold,
      });
    }
    items.sort((a, b) => b.usage - a.usage);
    return items;
  }

  getGoalStatus(): GoalProgressItem[] {
    return this.goals.map(g => {
      const remaining = Math.max(0, subtractAmounts(g.targetAmount, g.currentAmount));
      const daysLeft = g.targetDate ? daysBetween(this.todayKey, g.targetDate) : null;
      // Only meaningful while there is both something left to save and time left.
      const requiredPerMonth =
        daysLeft !== null && daysLeft > 0 && remaining > 0 ? remaining / Math.max(1, daysLeft / 30) : null;
      return {
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        progress: g.targetAmount > 0 ? clamp01(g.currentAmount / g.targetAmount) : 0,
        remaining,
        targetDate: g.targetDate,
        daysLeft,
        requiredPerMonth,
      };
    });
  }

  getDebtSummary(): DebtSummary {
    const items: DebtSummaryItem[] = this.debts.map(d => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
      interestRate: d.interestRate ?? 0,
      monthlyPayment: d.monthlyPayment ?? 0,
    }));
    const totalOutstanding = sumAmounts(items.map(i => i.amount));
    const totalInitial = sumAmounts(this.debts.map(d => d.initialAmount ?? d.amount));
    let highestRate: DebtSummaryItem | null = null;
    for (const i of items) if (!highestRate || i.interestRate > highestRate.interestRate) highestRate = i;
    return {
      totalOutstanding,
      totalInitial,
      totalPaidOff: Math.max(0, subtractAmounts(totalInitial, totalOutstanding)),
      monthlyPaymentTotal: sumAmounts(items.map(i => i.monthlyPayment)),
      count: items.length,
      highestRate,
      items,
    };
  }

  /**
   * How much of what was actually spent this period was a fixed commitment.
   *
   * This used to divide a MONTHLY commitment total by the selected period's
   * spend, whatever that period was. The numerator ignored `kind` entirely, so
   * 'day' and 'week' returned the same number as 'month' — meaningless — and
   * even 'month' was unbounded: NT$20,000 of rent against NT$300 logged so far
   * this month gave 66.7, which reached the assistant as
   * "fixedCostRatioPercent: 6666.7".
   *
   * Recurring rules are materialised into real transactions (App.tsx posts
   * them with source 'recurring' and a deterministic `recurring:<rule>:<date>`
   * id), so the money is already in the denominator. Counting the posted rows
   * instead of re-deriving a monthly equivalent makes the numerator and
   * denominator the same period, the same rows and the same units — the result
   * is in [0, 1] by construction, for every period.
   */
  /**
   * Total monthly-equivalent value of the user's recurring commitments.
   *
   * Split out from getFixedCostRatio so the forward-looking number — "NT$2,200
   * a month is already spoken for" — survives as its own answer. It is a
   * currency amount, not a ratio, so there is no period for it to disagree
   * with and no way for it to render as 6666%.
   */
  getMonthlyCommitment(): number {
    return sumAmounts(this.recurring.filter(r => r.type === 'expense').map(r => monthlyEquivalent(r)));
  }

  getFixedCostRatio(kind: PeriodKind = 'month'): number {
    const range = this.rangeFor(kind);
    const expense = this.totalsFor(range).expense;
    if (expense <= 0) return 0;
    const fixed = sumAmounts(
      this.getTransactionsByRange(range.startKey, range.endKey)
        .filter(t => t?.type === 'expense' && isRecurringPosting(t))
        .map(t => t.amount),
    );
    return fixed / expense;
  }

  getSavingsRate(kind: PeriodKind = 'month'): number | null {
    const { income, expense } = this.totalsFor(this.rangeFor(kind));
    if (income <= 0) return null;
    return subtractAmounts(income, expense) / income;
  }

  /**
   * Lifetime totals. Dashboard shows these as the headline balance, and they
   * are NOT a period query — "本月結餘" and "總結餘" are different questions
   * and conflating them is how a dashboard shows a number nobody can reconcile.
   */
  getAllTimeTotals(): { income: number; expense: number; balance: number; transactionCount: number } {
    const income = sumAmounts(this.txs.filter(t => t?.type === 'income').map(t => t.amount));
    const expense = sumAmounts(this.txs.filter(t => t?.type === 'expense').map(t => t.amount));
    return { income, expense, balance: subtractAmounts(income, expense), transactionCount: this.txs.length };
  }

  /** Expense share by category over the whole ledger, largest first. */
  getAllTimeCategoryTotals(): Array<{ name: string; value: number }> {
    const per = new Map<string, number[]>();
    for (const t of this.txs) {
      if (t?.type !== 'expense') continue;
      const id = t.categoryId ?? categoryIdForStored(t.category);
      const bucket = per.get(id);
      if (bucket) bucket.push(t.amount);
      else per.set(id, [t.amount]);
    }
    return Array.from(per.entries())
      .map(([id, amounts]) => ({ name: labelForCategoryId(id), value: sumAmounts(amounts) }))
      .sort((a, b) => b.value - a.value);
  }

  /**
   * The last [months] calendar months, oldest first, including months with no
   * activity — a trend chart that silently omits empty months misrepresents
   * the shape of the trend.
   */
  getMonthlyTrend(months = 6): Array<{ name: string; income: number; expense: number }> {
    const out: Array<{ name: string; income: number; expense: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(this.now.getFullYear(), this.now.getMonth() - i, 1);
      const range: PeriodRange = {
        kind: 'month',
        startKey: getMonthStartKey(getLocalDateKey(d)),
        endKey: getMonthEndKey(getLocalDateKey(d)),
        label: '',
      };
      const t = this.totalsFor(range);
      out.push({ name: range.startKey.slice(0, 7), income: t.income, expense: t.expense });
    }
    return out;
  }

  /** Mean daily spend so far this month — divided by days ELAPSED, not 30. */
  getAverageDailySpend(): number {
    const spent = this.totalsFor(this.monthRange()).expense;
    const dayOfMonth = this.now.getDate();
    return dayOfMonth > 0 ? spent / dayOfMonth : 0;
  }

  /** The largest individual expenses this month. */
  getTopExpenses(limit = 3): Transaction[] {
    const range = this.monthRange();
    return this.getTransactionsByRange(range.startKey, range.endKey)
      .filter(t => t.type === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }

  /** Recurring rules falling due within [days]. */
  getUpcomingRecurring(days = 3): Array<RecurringTransaction & { daysLeft: number }> {
    return this.recurring
      .map(rt => ({ ...rt, daysLeft: daysBetween(this.todayKey, rt.nextDate) }))
      .filter(rt => rt.daysLeft >= 0 && rt.daysLeft <= days)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  // ---- the whole picture ----

  analyze(kind: PeriodKind = 'month'): AnalysisResult {
    const range = this.rangeFor(kind);
    const summary = this.getSummary(kind);
    const topCategories = this.getCategoryBreakdown(kind, 8);
    const budgetUsage = this.getBudgetStatus(kind);
    const goals = this.getGoalStatus();
    const debt = this.getDebtSummary();

    return {
      generatedAt: this.now.toISOString(),
      period: range,
      income: summary.income,
      expense: summary.expense,
      netCashflow: summary.netCashflow,
      transactionCount: summary.transactionCount,
      previousPeriodExpense: summary.previous.expense,
      previousPeriodIncome: summary.previous.income,
      expenseChangePercent: summary.expenseChangePercent,
      today: this.totalsFor(this.dayRange()),
      week: this.totalsFor(this.weekRange()),
      month: this.totalsFor(this.monthRange()),
      topCategories,
      budgetUsage,
      fixedCostRatio: this.getFixedCostRatio(kind),
      savingsRate: this.getSavingsRate(kind),
      debt,
      goals,
      insights: buildInsights({ summary, topCategories, budgetUsage, goals }),
    };
  }
}

/** A recurring rule's cost normalised to one month. */
function monthlyEquivalent(r: RecurringTransaction): number {
  switch (r.frequency) {
    case 'daily':
      return r.amount * 30;
    case 'weekly':
      return (r.amount * 52) / 12;
    case 'yearly':
      return r.amount / 12;
    case 'monthly':
    default:
      return r.amount;
  }
}

/**
 * Observations, never verdicts.
 *
 * Everything here states what the numbers did and stops. No "你又亂花錢",
 * no "太浪費了", no implied grade. A person opening a finance app after a
 * heavy spending week already knows; being told off by their own software is
 * how the app gets deleted.
 */
export function buildInsights(input: {
  summary: PeriodComparison;
  topCategories: CategoryBreakdownItem[];
  budgetUsage: BudgetUsageItem[];
  goals: GoalProgressItem[];
}): Insight[] {
  const out: Insight[] = [];
  const { summary, topCategories, budgetUsage, goals } = input;

  const nearBudget = budgetUsage.filter(b => b.alertEnabled && b.state !== 'healthy');
  for (const b of nearBudget.slice(0, 2)) {
    out.push({
      id: `budget:${b.categoryId}`,
      severity: 'watch',
      message:
        b.state === 'over'
          ? `${b.label}這個月已經超過你設定的範圍了。`
          : `${b.label}這個月接近你設定的範圍囉。`,
    });
  }

  const biggestRise = topCategories
    .filter(c => c.changePercent !== null && c.changeAmount > 0)
    .sort((a, b) => b.changeAmount - a.changeAmount)[0];
  if (biggestRise) {
    out.push({
      id: `rise:${biggestRise.categoryId}`,
      severity: 'info',
      message: `${biggestRise.label}比上一期多了 ${Math.round(biggestRise.changePercent ?? 0)}%。`,
    });
  }

  if (summary.expenseChangePercent !== null && summary.expenseChangePercent < -5) {
    out.push({
      id: 'expense:down',
      severity: 'info',
      message: `這一期的支出比上一期少了 ${Math.abs(Math.round(summary.expenseChangePercent))}%。`,
    });
  }

  const closest = goals
    .filter(g => g.progress > 0 && g.progress < 1)
    .sort((a, b) => b.progress - a.progress)[0];
  if (closest) {
    out.push({
      id: `goal:${closest.id}`,
      severity: 'info',
      message: `「${closest.name}」已經走到 ${Math.round(closest.progress * 100)}%。`,
    });
  }

  return out;
}

/** Convenience for callers that just want the numbers once. */
export function analyzeFinances(input: AnalyticsInput, kind: PeriodKind = 'month', now?: Date): AnalysisResult {
  return new FinanceAnalyticsEngine(input, now).analyze(kind);
}
