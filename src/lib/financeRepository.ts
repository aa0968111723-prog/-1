/**
 * FinanceRepository — the single data gateway for FinTracker finance state.
 *
 * React components keep using App-level state; this repository is the one
 * place that loads/saves that state and computes shared summaries, so the
 * web UI, the quick-add flow and the native pet bridge all read and write
 * through the same entry point instead of touching localStorage directly.
 */

import {
  Transaction,
  BudgetConfig,
  RecurringTransaction,
  Debt,
  Goal,
  SpreadsheetRecord,
} from '../types';
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export interface TodaySummary {
  date: string; // YYYY-MM-DD
  expenseTotal: number;
  incomeTotal: number;
  count: number;
}

export class FinanceRepository {
  constructor(private storage: Storage | undefined = globalThis.localStorage) {}

  // ---- loads ----
  getTransactions(): Transaction[] {
    return loadJSON<Transaction[]>(STORAGE_KEYS.transactions, [], this.storage);
  }

  getBudgets(): Record<string, BudgetConfig> {
    return loadJSON<Record<string, BudgetConfig>>(STORAGE_KEYS.budgets, {}, this.storage);
  }

  getRecurring(): RecurringTransaction[] {
    return loadJSON<RecurringTransaction[]>(STORAGE_KEYS.recurring, [], this.storage);
  }

  getDebts(): Debt[] {
    return loadJSON<Debt[]>(STORAGE_KEYS.debts, [], this.storage);
  }

  getGoals(): Goal[] {
    return loadJSON<Goal[]>(STORAGE_KEYS.goals, [], this.storage);
  }

  getSpreadsheetRecords(): SpreadsheetRecord[] {
    return loadJSON<SpreadsheetRecord[]>(STORAGE_KEYS.spreadsheetRecords, [], this.storage);
  }

  getMonthlyIncome(): number {
    if (!this.storage) return 0;
    const saved = this.storage.getItem(STORAGE_KEYS.monthlyIncome);
    return saved ? Number(saved) || 0 : 0;
  }

  // ---- saves ----
  saveTransactions(transactions: Transaction[]): void {
    saveJSON(STORAGE_KEYS.transactions, transactions, this.storage);
  }

  saveBudgets(budgets: Record<string, BudgetConfig>): void {
    saveJSON(STORAGE_KEYS.budgets, budgets, this.storage);
  }

  saveRecurring(recurring: RecurringTransaction[]): void {
    saveJSON(STORAGE_KEYS.recurring, recurring, this.storage);
  }

  saveDebts(debts: Debt[]): void {
    saveJSON(STORAGE_KEYS.debts, debts, this.storage);
  }

  saveGoals(goals: Goal[]): void {
    saveJSON(STORAGE_KEYS.goals, goals, this.storage);
  }

  saveSpreadsheetRecords(records: SpreadsheetRecord[]): void {
    saveJSON(STORAGE_KEYS.spreadsheetRecords, records, this.storage);
  }

  saveMonthlyIncome(income: number): void {
    this.storage?.setItem(STORAGE_KEYS.monthlyIncome, income.toString());
  }

  // ---- writes with domain rules ----
  /**
   * Adds a transaction directly to storage (used by tests and non-React
   * callers). The React app applies the identical rules through App state;
   * both paths share applyLinkedEffects so debt/goal integration never forks.
   *
   * Idempotent on id: re-ingesting a transaction whose stable id already
   * exists (e.g. a native outbox entry replayed after a crash-before-ack)
   * returns the existing record and changes nothing — exactly-once semantics
   * for the sync path.
   */
  addTransaction(newTx: Omit<Transaction, 'id'> & { id?: string }): Transaction {
    const existingList = this.getTransactions();
    if (newTx.id) {
      const existing = existingList.find(t => t.id === newTx.id);
      if (existing) return existing;
    }
    const transaction: Transaction = { ...newTx, id: newTx.id ?? crypto.randomUUID() };
    this.saveTransactions([transaction, ...existingList]);

    const { debts, goals } = applyLinkedEffects(transaction, this.getDebts(), this.getGoals());
    this.saveDebts(debts);
    this.saveGoals(goals);
    return transaction;
  }

  deleteTransaction(id: string): void {
    const transactions = this.getTransactions();
    const tx = transactions.find(t => t.id === id);
    if (tx) {
      const { debts, goals } = revertLinkedEffects(tx, this.getDebts(), this.getGoals());
      this.saveDebts(debts);
      this.saveGoals(goals);
    }
    this.saveTransactions(transactions.filter(t => t.id !== id));
  }

  getTodaySummary(now: Date = new Date()): TodaySummary {
    return computeTodaySummary(this.getTransactions(), now);
  }
}

/** Debt/goal deep-integration when a transaction is created. */
export function applyLinkedEffects(
  tx: Pick<Transaction, 'amount' | 'linkedDebtId' | 'linkedGoalId'>,
  debts: Debt[],
  goals: Goal[],
): { debts: Debt[]; goals: Goal[] } {
  let nextDebts = debts;
  let nextGoals = goals;
  if (tx.linkedDebtId && tx.amount > 0) {
    nextDebts = debts.map(d =>
      d.id === tx.linkedDebtId ? { ...d, amount: Math.max(0, d.amount - tx.amount) } : d,
    );
  }
  if (tx.linkedGoalId && tx.amount > 0) {
    nextGoals = goals.map(g =>
      g.id === tx.linkedGoalId ? { ...g, currentAmount: g.currentAmount + tx.amount } : g,
    );
  }
  return { debts: nextDebts, goals: nextGoals };
}

/** Reverses applyLinkedEffects when a transaction is deleted. */
export function revertLinkedEffects(
  tx: Pick<Transaction, 'amount' | 'linkedDebtId' | 'linkedGoalId'>,
  debts: Debt[],
  goals: Goal[],
): { debts: Debt[]; goals: Goal[] } {
  let nextDebts = debts;
  let nextGoals = goals;
  if (tx.linkedDebtId && tx.amount > 0) {
    nextDebts = debts.map(d =>
      d.id === tx.linkedDebtId ? { ...d, amount: d.amount + tx.amount } : d,
    );
  }
  if (tx.linkedGoalId && tx.amount > 0) {
    nextGoals = goals.map(g =>
      g.id === tx.linkedGoalId ? { ...g, currentAmount: Math.max(0, g.currentAmount - tx.amount) } : g,
    );
  }
  return { debts: nextDebts, goals: nextGoals };
}

export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeTodaySummary(transactions: Transaction[], now: Date = new Date()): TodaySummary {
  const today = toLocalDateString(now);
  let expenseTotal = 0;
  let incomeTotal = 0;
  let count = 0;
  for (const t of transactions) {
    if (t.date !== today) continue;
    count += 1;
    if (t.type === 'expense') expenseTotal += t.amount;
    else incomeTotal += t.amount;
  }
  return { date: today, expenseTotal, incomeTotal, count };
}

export const financeRepository = new FinanceRepository();
