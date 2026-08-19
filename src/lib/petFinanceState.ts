/**
 * Pet finance state — the single domain computation that turns finance data
 * into the pet's mood + message. Native never re-implements this; the web
 * pushes the computed result over the bridge.
 *
 * Messages are deliberately encouraging: no financial shaming, ever.
 */

import { Transaction, BudgetConfig, Goal } from '../types';
import { computeTodaySummary, toLocalDateString } from './financeRepository';

export type PetMood =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'saving'
  | 'success'
  | 'warning'
  | 'sleepy'
  | 'celebrate';

export interface PetFinanceState {
  mood: PetMood;
  message: string;
  streak: number;
  todayCount: number;
  todayExpense: number;
  monthExpense: number;
  xp: number;
  level: number;
}

/**
 * The ONLY data pushed to the native overlay. Deliberately non-sensitive:
 * no transactions, debts, goals or monetary totals — amounts appear solely
 * inside the message string, and only when the user opted in (showAmounts).
 */
export interface PetDisplayState {
  mood: PetMood;
  message: string;
  streak: number;
  todayCount: number;
  level: number;
  showAmounts: boolean;
  petName: string;
}

export function toPetDisplayState(
  state: PetFinanceState,
  options: { showAmounts: boolean; petName: string },
): PetDisplayState {
  return {
    mood: state.mood,
    message: state.message,
    streak: state.streak,
    todayCount: state.todayCount,
    level: state.level,
    showAmounts: options.showAmounts,
    petName: options.petName,
  };
}

export interface PetFinanceInput {
  transactions: Transaction[];
  budgets: Record<string, BudgetConfig>;
  goals: Goal[];
  monthlyIncome: number;
  showAmounts: boolean;
  now?: Date;
}

/** Consecutive days (ending today or yesterday) with at least one transaction. */
export function computeStreak(transactions: Transaction[], now: Date = new Date()): number {
  const days = new Set(transactions.map(t => t.date));
  const cursor = new Date(now);
  if (!days.has(toLocalDateString(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // streak survives until end of today
    if (!days.has(toLocalDateString(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(toLocalDateString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 1 XP per transaction + streak bonus. Purely habit-based, never spend-based. */
export function computeXp(transactions: Transaction[], streak: number): number {
  return transactions.length + streak * 2;
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 10)) + 1);
}

interface MessageContext {
  hour: number;
  goalReached: boolean;
  goalClose: boolean;
  budgetRatio: number;
  hasBudget: boolean;
  todayCount: number;
  todayExpense: number;
  streak: number;
  showAmounts: boolean;
}

const STREAK_MILESTONES = [30, 14, 7, 3];

/**
 * Message engine: mood + message from finance signals and time of day.
 * Deterministic (same input → same output) so it is testable, and strictly
 * non-shaming — money worries get gentle company, never blame.
 */
export function pickMoodAndMessage(ctx: MessageContext): { mood: PetMood; message: string } {
  if (ctx.goalReached) {
    return { mood: 'celebrate', message: '🎉 達成儲蓄目標了，太棒了！' };
  }
  const milestone = STREAK_MILESTONES.find(m => ctx.streak === m);
  if (milestone) {
    return { mood: 'celebrate', message: `連續 ${milestone} 天有記帳 ✨ 好習慣養成中！` };
  }
  if (ctx.budgetRatio >= 1 && ctx.hasBudget) {
    return { mood: 'warning', message: '這個月支出比較接近預算了，要一起看看嗎？' };
  }
  if (ctx.budgetRatio >= 0.85 && ctx.hasBudget) {
    return { mood: 'warning', message: '今天稍微注意一下錢包哦～' };
  }
  if (ctx.goalClose) {
    return { mood: 'saving', message: '離目標更近一步了！' };
  }
  if (ctx.todayCount > 0) {
    if (ctx.hour >= 20) {
      return {
        mood: 'happy',
        message: ctx.showAmounts
          ? `今天記了 ${ctx.todayCount} 筆（NT$${ctx.todayExpense.toLocaleString()}），辛苦啦 🌙`
          : `今天記了 ${ctx.todayCount} 筆，辛苦啦 🌙`,
      };
    }
    return {
      mood: 'happy',
      message: ctx.showAmounts
        ? `今天記了 ${ctx.todayCount} 筆，共 NT$${ctx.todayExpense.toLocaleString()} ✨`
        : `今天記了 ${ctx.todayCount} 筆 ✨`,
    };
  }
  // 今天還沒記帳：依時段給不同的溫柔提示
  if (ctx.hour >= 22 || ctx.hour < 6) {
    return { mood: 'sleepy', message: '夜深了，記完帳早點休息哦 🌙' };
  }
  if (ctx.hour < 11) {
    return { mood: 'idle', message: '早安～今天也一起照顧錢包 ☀️' };
  }
  if (ctx.hour < 14) {
    return { mood: 'idle', message: '午餐記下來就不用晚上回想啦 🍱' };
  }
  if (ctx.streak > 1) {
    return { mood: 'idle', message: `連續記帳 ${ctx.streak} 天，繼續保持！` };
  }
  return { mood: 'idle', message: '點我一下，快速記一筆吧' };
}

export function computePetFinanceState(input: PetFinanceInput): PetFinanceState {
  const now = input.now ?? new Date();
  const today = computeTodaySummary(input.transactions, now);
  const monthPrefix = toLocalDateString(now).slice(0, 7);
  const monthExpense = input.transactions
    .filter(t => t.type === 'expense' && t.date.startsWith(monthPrefix))
    .reduce((sum, t) => sum + t.amount, 0);
  const streak = computeStreak(input.transactions, now);
  const xp = computeXp(input.transactions, streak);
  const level = levelForXp(xp);

  const totalBudget = Object.values(input.budgets).reduce((sum, b) => sum + (b.amount || 0), 0);
  const budgetRatio = totalBudget > 0 ? monthExpense / totalBudget : 0;

  const goalReached = input.goals.some(g => g.targetAmount > 0 && g.currentAmount >= g.targetAmount);
  const goalClose = input.goals.some(
    g => g.targetAmount > 0 && g.currentAmount < g.targetAmount && g.currentAmount / g.targetAmount >= 0.9,
  );

  const { mood, message } = pickMoodAndMessage({
    hour: now.getHours(),
    goalReached,
    goalClose,
    budgetRatio,
    hasBudget: totalBudget > 0,
    todayCount: today.count,
    todayExpense: today.expenseTotal,
    streak,
    showAmounts: input.showAmounts,
  });

  return {
    mood,
    message,
    streak,
    todayCount: today.count,
    todayExpense: today.expenseTotal,
    monthExpense,
    xp,
    level,
  };
}
