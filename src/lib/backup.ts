/**
 * Backup / restore for the full FinTracker dataset as a single JSON file.
 *
 * Import is validate-first and never destructive: a safety copy of the
 * current data is written to localStorage before any replace, and merge
 * mode is idempotent (dedupe by id / key).
 */

import { Transaction, BudgetConfig, RecurringTransaction, Debt, Goal, SpreadsheetRecord } from '../types';
import { isTombstoned } from './tombstone';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, loadJSON, saveJSON } from './storage';
import { PetSettings, loadPetSettings } from './petSettings';
import { CustomCategory } from './categoryRegistry';
import { PaymentMethodPrefs } from './paymentMethods';

export interface FinanceBackup {
  schemaVersion: number;
  exportedAt: string;
  transactions: Transaction[];
  budgets: Record<string, BudgetConfig>;
  recurring: RecurringTransaction[];
  debts: Debt[];
  goals: Goal[];
  spreadsheetRecords: SpreadsheetRecord[];
  monthlyIncome: number;
  petSettings: PetSettings;
  /**
   * The taxonomy the ledger is written in.
   *
   * Optional so an older backup file still imports. Their absence was a real
   * gap: the README calls the export a 完整備份 and tells people to use it
   * when they change device or clear their cache, and every user-defined
   * category, pinned chip and payment-method preference was left behind. The
   * transactions came back referring to categories that no longer existed.
   */
  customCategories?: CustomCategory[];
  pinnedCategories?: string[];
  paymentMethodPrefs?: PaymentMethodPrefs;
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  counts: { transactions: number; budgets: number; debts: number; goals: number; recurring: number };
}

export function createBackup(storage: Storage | undefined = globalThis.localStorage): FinanceBackup {
  return {
    schemaVersion: CURRENT_STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: loadJSON<Transaction[]>(STORAGE_KEYS.transactions, [], storage),
    budgets: loadJSON<Record<string, BudgetConfig>>(STORAGE_KEYS.budgets, {}, storage),
    recurring: loadJSON<RecurringTransaction[]>(STORAGE_KEYS.recurring, [], storage),
    debts: loadJSON<Debt[]>(STORAGE_KEYS.debts, [], storage),
    goals: loadJSON<Goal[]>(STORAGE_KEYS.goals, [], storage),
    spreadsheetRecords: loadJSON<SpreadsheetRecord[]>(STORAGE_KEYS.spreadsheetRecords, [], storage),
    monthlyIncome: Number(storage?.getItem(STORAGE_KEYS.monthlyIncome) ?? 0) || 0,
    petSettings: loadPetSettings(storage),
    customCategories: loadJSON<CustomCategory[]>(STORAGE_KEYS.customCategories, [], storage),
    pinnedCategories: loadJSON<string[]>(STORAGE_KEYS.pinnedCategories, [], storage),
    paymentMethodPrefs: loadJSON<PaymentMethodPrefs>(STORAGE_KEYS.paymentMethodPrefs, {} as PaymentMethodPrefs, storage),
  };
}

export function validateBackup(data: unknown): BackupValidation {
  const errors: string[] = [];
  const counts = { transactions: 0, budgets: 0, debts: 0, goals: 0, recurring: 0 };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['備份檔不是有效的 JSON 物件'], counts };
  }
  const b = data as Partial<FinanceBackup>;
  if (typeof b.schemaVersion !== 'number') errors.push('缺少 schemaVersion');
  if (b.schemaVersion !== undefined && b.schemaVersion > CURRENT_STORAGE_VERSION) {
    errors.push(`備份版本 (${b.schemaVersion}) 比目前 App 支援的版本新`);
  }
  const arrays: Array<[keyof typeof counts, unknown]> = [
    ['transactions', b.transactions],
    ['debts', b.debts],
    ['goals', b.goals],
    ['recurring', b.recurring],
  ];
  for (const [key, value] of arrays) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push(`${key} 不是陣列`);
      continue;
    }
    // Tombstones are carried in the backup so a restore does not resurrect
    // rows the user deleted — but they are not entries, and counting them
    // would tell the user their backup holds more than it does right before
    // they decide whether to replace their data with it.
    counts[key] = key === 'transactions'
      ? (value as Transaction[]).filter(t => !isTombstoned(t)).length
      : value.length;
  }
  if (Array.isArray(b.transactions)) {
    const bad = b.transactions.filter(
      t => !t || typeof t.id !== 'string' || typeof t.amount !== 'number' || (t.type !== 'income' && t.type !== 'expense'),
    );
    if (bad.length > 0) errors.push(`${bad.length} 筆交易格式不正確`);
  }
  if (b.budgets !== undefined) {
    if (b.budgets === null || typeof b.budgets !== 'object' || Array.isArray(b.budgets)) errors.push('budgets 不是物件');
    else counts.budgets = Object.keys(b.budgets).length;
  }
  return { ok: errors.length === 0, errors, counts };
}

export type ImportMode = 'merge' | 'replace';

/**
 * Applies a validated backup. Before any change the entire current dataset
 * is snapshotted to STORAGE_KEYS.importSafetyBackup — a bad import is always
 * recoverable. Merge dedupes by id (transactions/debts/goals/recurring/
 * spreadsheet) and by key (budgets, existing wins); replace overwrites.
 */
export function applyBackup(
  backup: FinanceBackup,
  mode: ImportMode,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  // safety snapshot first
  saveJSON(STORAGE_KEYS.importSafetyBackup, createBackup(storage), storage);

  const mergeById = <T extends { id: string }>(current: T[], incoming: T[] | undefined): T[] => {
    const list = incoming ?? [];
    if (mode === 'replace') return list;
    const existing = new Set(current.map(i => i.id));
    return [...current, ...list.filter(i => !existing.has(i.id))];
  };

  const currentTx = loadJSON<Transaction[]>(STORAGE_KEYS.transactions, [], storage);
  saveJSON(STORAGE_KEYS.transactions, mergeById(currentTx, backup.transactions), storage);
  saveJSON(STORAGE_KEYS.recurring, mergeById(loadJSON<RecurringTransaction[]>(STORAGE_KEYS.recurring, [], storage), backup.recurring), storage);
  saveJSON(STORAGE_KEYS.debts, mergeById(loadJSON<Debt[]>(STORAGE_KEYS.debts, [], storage), backup.debts), storage);
  saveJSON(STORAGE_KEYS.goals, mergeById(loadJSON<Goal[]>(STORAGE_KEYS.goals, [], storage), backup.goals), storage);
  saveJSON(STORAGE_KEYS.spreadsheetRecords, mergeById(loadJSON<SpreadsheetRecord[]>(STORAGE_KEYS.spreadsheetRecords, [], storage), backup.spreadsheetRecords), storage);

  const currentBudgets = loadJSON<Record<string, BudgetConfig>>(STORAGE_KEYS.budgets, {}, storage);
  const nextBudgets = mode === 'replace' ? (backup.budgets ?? {}) : { ...(backup.budgets ?? {}), ...currentBudgets };
  saveJSON(STORAGE_KEYS.budgets, nextBudgets, storage);

  if (mode === 'replace' || !storage.getItem(STORAGE_KEYS.monthlyIncome)) {
    storage.setItem(STORAGE_KEYS.monthlyIncome, String(backup.monthlyIncome ?? 0));
  }
  if (mode === 'replace' && backup.petSettings) {
    saveJSON(STORAGE_KEYS.petSettings, backup.petSettings, storage);
  }

  /*
   * The taxonomy. Merged by id on 合併 so a device that already has its own
   * custom categories does not lose them to an older file, and an id present
   * on both sides keeps the local definition (same rule as transactions).
   */
  if (backup.customCategories) {
    const current = loadJSON<CustomCategory[]>(STORAGE_KEYS.customCategories, [], storage);
    saveJSON(STORAGE_KEYS.customCategories, mergeById(current, backup.customCategories), storage);
  }
  if (backup.pinnedCategories) {
    const current = loadJSON<string[]>(STORAGE_KEYS.pinnedCategories, [], storage);
    const next = mode === 'replace'
      ? backup.pinnedCategories
      : [...current, ...backup.pinnedCategories.filter(id => !current.includes(id))];
    saveJSON(STORAGE_KEYS.pinnedCategories, next, storage);
  }
  if (backup.paymentMethodPrefs && (mode === 'replace' || !storage.getItem(STORAGE_KEYS.paymentMethodPrefs))) {
    saveJSON(STORAGE_KEYS.paymentMethodPrefs, backup.paymentMethodPrefs, storage);
  }
}
