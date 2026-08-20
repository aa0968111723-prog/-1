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
import { isTombstoned, TOMBSTONE_RETENTION_DAYS } from './tombstone';

export { isTombstoned, TOMBSTONE_RETENTION_DAYS };

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
  /**
   * The ledger as the user sees it. Tombstones are storage, not content.
   *
   * Filtering here rather than at each call site is deliberate: analytics, the
   * dashboard, the pet, the AI context and the CSV export all read through
   * this one method, and any of them that forgot would quietly add deleted
   * money back into a total. The sync engine is the only caller that needs the
   * deleted rows, and it asks for them by name.
   */
  getTransactions(): Transaction[] {
    return this.readAllTransactions().filter(t => !isTombstoned(t));
  }

  /**
   * Every row on disk, tombstones included. For the sync engine only: a
   * deletion has to keep travelling, or the next pull resurrects the row from
   * a device that never heard about it.
   */
  getAllTransactionsIncludingDeleted(): Transaction[] {
    return this.readAllTransactions();
  }

  private readAllTransactions(): Transaction[] {
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
    // The raw list: writing back a filtered one would erase every tombstone,
    // and matching ids against a filtered one would let a replayed outbox
    // entry resurrect a row the user deleted.
    const existingList = this.readAllTransactions();
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

  /**
   * True when this id has ever been recorded — including as a tombstone.
   *
   * Idempotency has to outlive deletion: if the native outbox replays an entry
   * the user has since deleted, "already known" is the correct answer, and
   * re-adding it would look like the app undoing the user's delete on its own.
   */
  hasTransaction(id: string): boolean {
    return this.readAllTransactions().some(t => t.id === id);
  }

  /**
   * Deletes by tombstoning, not by removing.
   *
   * A hard delete is invisible to every other device: the row is still in the
   * cloud and still on the tablet, so the next pull brings it back and the
   * user watches a transaction they deleted reappear. merge.ts has had the
   * tombstone machinery all along — nothing in the app ever called it.
   *
   * The row keeps its id and its linked-effect record so a later merge can
   * still reason about it; only `deletedAt` decides visibility.
   */
  deleteTransaction(id: string): void {
    const transactions = this.readAllTransactions();
    const tx = transactions.find(t => t.id === id);
    if (!tx || isTombstoned(tx)) return;

    const { debts, goals } = revertLinkedEffects(tx, this.getDebts(), this.getGoals());
    this.saveDebts(debts);
    this.saveGoals(goals);

    const at = new Date().toISOString();
    this.saveTransactions(
      transactions.map(t => (t.id === id ? { ...t, deletedAt: at, updatedAt: at } : t)),
    );
  }

  /**
   * Drops tombstones that have outlived their purpose.
   *
   * A tombstone only has to survive long enough for every device to see it.
   * Keeping them forever would grow the store without bound for a user who
   * deletes a lot, which is the objection that made hard deletes tempting in
   * the first place. Anything already confirmed by the cloud is safe to drop
   * after the retention window; anything never synced is kept, because a
   * device that has been offline for months still needs to hear about it.
   */
  pruneTombstones(now: Date = new Date(), retentionDays = TOMBSTONE_RETENTION_DAYS): number {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const all = this.readAllTransactions();
    const kept = all.filter(t => {
      if (!isTombstoned(t)) return true;
      const row = t as Transaction & { deletedAt?: string; syncedAt?: string };
      if (!row.syncedAt) return true;
      return (row.deletedAt ?? '') > cutoff;
    });
    if (kept.length !== all.length) this.saveTransactions(kept);
    return all.length - kept.length;
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
