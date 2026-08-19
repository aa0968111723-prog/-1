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

  let mood: PetMood;
  let message: string;
  const hour = now.getHours();

  if (goalReached) {
    mood = 'celebrate';
    message = '🎉 達成儲蓄目標了，太棒了！';
  } else if (budgetRatio >= 1 && totalBudget > 0) {
    mood = 'warning';
    message = '這個月預算滿了，接下來我陪你慢慢來～';
  } else if (budgetRatio >= 0.85 && totalBudget > 0) {
    mood = 'warning';
    message = '今天稍微注意一下錢包哦～';
  } else if (goalClose) {
    mood = 'saving';
    message = '離目標更近一步了！';
  } else if (today.count > 0) {
    mood = 'happy';
    message = input.showAmounts
      ? `今天記了 ${today.count} 筆，共 NT$${today.expenseTotal.toLocaleString()} ✨`
      : `今天記了 ${today.count} 筆 ✨`;
  } else if (hour >= 22 || hour < 6) {
    mood = 'sleepy';
    message = '夜深了，記完帳早點休息哦 🌙';
  } else {
    mood = 'idle';
    message = streak > 1 ? `連續記帳 ${streak} 天，繼續保持！` : '點我一下，快速記一筆吧';
  }

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
