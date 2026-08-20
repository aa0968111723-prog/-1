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
import { FinanceStore, financeStore } from './financeStore';
import { getLocalDateKey, monthKeyOf } from './datetime';
import { addAmounts, subtractAmounts, subtractClampedAtZero, sumAmounts } from './money';

export interface TodaySummary {
  date: string; // YYYY-MM-DD
  expenseTotal: number;
  incomeTotal: number;
  count: number;
}

export class FinanceRepository {
  /**
   * Two backends, one API.
   *
   * With a [store] the durable layer is IndexedDB (see
   * docs/ADR-LOCAL-FIRST-STORAGE.md); without one it is whatever Storage was
   * handed in, which is how every existing test keeps working unchanged with
   * an in-memory Storage. Nothing above this line can tell the difference.
   */
  constructor(
    private storage: Storage | undefined = globalThis.localStorage,
    private store?: FinanceStore,
  ) {}

  private readKey<T>(key: string, fallback: T): T {
    return this.store ? this.store.read(key, fallback) : loadJSON(key, fallback, this.storage);
  }

  private writeKey(key: string, value: unknown): void {
    if (this.store) this.store.write(key, value);
    else saveJSON(key, value, this.storage);
  }

  // ---- loads ----
  getTransactions(): Transaction[] {
    return this.readKey<Transaction[]>(STORAGE_KEYS.transactions, []);
  }

  getBudgets(): Record<string, BudgetConfig> {
    return this.readKey<Record<string, BudgetConfig>>(STORAGE_KEYS.budgets, {});
  }

  getRecurring(): RecurringTransaction[] {
    return this.readKey<RecurringTransaction[]>(STORAGE_KEYS.recurring, []);
  }

  getDebts(): Debt[] {
    return this.readKey<Debt[]>(STORAGE_KEYS.debts, []);
  }

  getGoals(): Goal[] {
    return this.readKey<Goal[]>(STORAGE_KEYS.goals, []);
  }

  getSpreadsheetRecords(): SpreadsheetRecord[] {
    return this.readKey<SpreadsheetRecord[]>(STORAGE_KEYS.spreadsheetRecords, []);
  }

  getMonthlyIncome(): number {
    if (!this.storage) return 0;
    const saved = this.storage.getItem(STORAGE_KEYS.monthlyIncome);
    return saved ? Number(saved) || 0 : 0;
  }

  // ---- saves ----
  saveTransactions(transactions: Transaction[]): void {
    this.writeKey(STORAGE_KEYS.transactions, transactions);
  }

  saveBudgets(budgets: Record<string, BudgetConfig>): void {
    this.writeKey(STORAGE_KEYS.budgets, budgets);
  }

  saveRecurring(recurring: RecurringTransaction[]): void {
    this.writeKey(STORAGE_KEYS.recurring, recurring);
  }

  saveDebts(debts: Debt[]): void {
    this.writeKey(STORAGE_KEYS.debts, debts);
  }

  saveGoals(goals: Goal[]): void {
    this.writeKey(STORAGE_KEYS.goals, goals);
  }

  saveSpreadsheetRecords(records: SpreadsheetRecord[]): void {
    this.writeKey(STORAGE_KEYS.spreadsheetRecords, records);
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
    const base: Transaction = { ...newTx, id: newTx.id ?? crypto.randomUUID() };

    // Apply debt/goal linkage first so the recorded deltas can be stored on
    // the transaction itself, making a later delete exactly reversible.
    const { debts, goals, debtApplied, goalApplied } = applyLinkedEffects(
      base,
      this.getDebts(),
      this.getGoals(),
    );
    const transaction: Transaction = {
      ...base,
      ...(debtApplied !== undefined ? { linkedDebtApplied: debtApplied } : {}),
      ...(goalApplied !== undefined ? { linkedGoalApplied: goalApplied } : {}),
    };
    this.saveTransactions([transaction, ...existingList]);
    this.saveDebts(debts);
    this.saveGoals(goals);
    return transaction;
  }

  /** True when a transaction with this id is already in the ledger. */
  hasTransaction(id: string): boolean {
    return this.getTransactions().some(t => t.id === id);
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

export interface LinkedEffectResult {
  debts: Debt[];
  goals: Goal[];
  /** What was actually applied, so a later revert can be exact. */
  debtApplied?: number;
  goalApplied?: number;
}

/**
 * Debt/goal deep-integration when a transaction is created.
 *
 * Balances clamp at zero, so the applied delta can be smaller than the
 * transaction amount. The caller stores the returned `debtApplied` /
 * `goalApplied` on the transaction; [revertLinkedEffects] then restores the
 * previous balance exactly instead of over-crediting on delete.
 */
export function applyLinkedEffects(
  tx: Pick<Transaction, 'amount' | 'linkedDebtId' | 'linkedGoalId'>,
  debts: Debt[],
  goals: Goal[],
): LinkedEffectResult {
  let nextDebts = debts;
  let nextGoals = goals;
  let debtApplied: number | undefined;
  let goalApplied: number | undefined;

  if (tx.linkedDebtId && tx.amount > 0) {
    nextDebts = debts.map(d => {
      if (d.id !== tx.linkedDebtId) return d;
      const next = subtractClampedAtZero(d.amount, tx.amount);
      debtApplied = subtractAmounts(d.amount, next); // what the debt actually absorbed
      return { ...d, amount: next };
    });
  }
  if (tx.linkedGoalId && tx.amount > 0) {
    nextGoals = goals.map(g => {
      if (g.id !== tx.linkedGoalId) return g;
      goalApplied = tx.amount;
      return { ...g, currentAmount: addAmounts(g.currentAmount, tx.amount) };
    });
  }
  return { debts: nextDebts, goals: nextGoals, debtApplied, goalApplied };
}

/**
 * Reverses applyLinkedEffects when a transaction is deleted or undone,
 * using the recorded applied deltas (falling back to `amount` for rows
 * written before that metadata existed).
 */
export function revertLinkedEffects(
  tx: Pick<Transaction, 'amount' | 'linkedDebtId' | 'linkedGoalId' | 'linkedDebtApplied' | 'linkedGoalApplied'>,
  debts: Debt[],
  goals: Goal[],
): { debts: Debt[]; goals: Goal[] } {
  let nextDebts = debts;
  let nextGoals = goals;
  const debtDelta = tx.linkedDebtApplied ?? tx.amount;
  const goalDelta = tx.linkedGoalApplied ?? tx.amount;

  if (tx.linkedDebtId && debtDelta > 0) {
    nextDebts = debts.map(d =>
      d.id === tx.linkedDebtId ? { ...d, amount: addAmounts(d.amount, debtDelta) } : d,
    );
  }
  if (tx.linkedGoalId && goalDelta > 0) {
    nextGoals = goals.map(g =>
      g.id === tx.linkedGoalId
        ? { ...g, currentAmount: subtractClampedAtZero(g.currentAmount, goalDelta) }
        : g,
    );
  }
  return { debts: nextDebts, goals: nextGoals };
}

/** @deprecated use getLocalDateKey from ./datetime — kept as a re-export. */
export const toLocalDateString = getLocalDateKey;

export function computeTodaySummary(transactions: Transaction[], now: Date = new Date()): TodaySummary {
  const today = getLocalDateKey(now);
  const expenses: number[] = [];
  const incomes: number[] = [];
  for (const t of transactions) {
    if (t.date !== today) continue;
    if (t.type === 'expense') expenses.push(t.amount);
    else incomes.push(t.amount);
  }
  return {
    date: today,
    expenseTotal: sumAmounts(expenses),
    incomeTotal: sumAmounts(incomes),
    count: expenses.length + incomes.length,
  };
}

/** Exact month total (YYYY-MM), integer-minor summed. */
export function computeMonthExpense(transactions: Transaction[], monthKey: string): number {
  return sumAmounts(
    transactions.filter(t => t.type === 'expense' && monthKeyOf(t.date) === monthKey).map(t => t.amount),
  );
}

// The app-wide instance is IndexedDB-backed. financeStore.init() must have
// resolved before this is read from; main.tsx awaits it before rendering.
export const financeRepository = new FinanceRepository(globalThis.localStorage, financeStore);
