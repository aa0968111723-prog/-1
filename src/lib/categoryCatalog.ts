/**
 * Category catalog — the single web/native-shared taxonomy.
 *
 * Stable ids identify categories across layers; the existing localStorage
 * data keeps storing the Chinese labels (backward compatible — nothing is
 * rewritten), and this module owns the id<->label mapping including legacy
 * English labels ("Loan Repayments", "Investments").
 *
 * The source of truth is shared/pet-shared-config.json, which is also
 * bundled into the Android app as an asset (see npm run sync:shared) so the
 * native Quick Add always shows the identical taxonomy.
 */

import sharedConfig from '../../shared/pet-shared-config.json';
import { TransactionType } from '../types';

export interface CategoryDef {
  id: string;
  label: string;
  emoji: string;
}

export interface QuickChipDef {
  categoryId: string;
  label: string;
  emoji: string;
  note?: string;
}

export const SHARED_CONFIG_SCHEMA_VERSION: number = sharedConfig.schemaVersion;

export const CATEGORY_DEFS: Record<TransactionType, CategoryDef[]> = {
  expense: sharedConfig.categories.expense,
  income: sharedConfig.categories.income,
};

export const QUICK_CHIP_DEFS: Record<TransactionType, QuickChipDef[]> = {
  expense: sharedConfig.quickChips.expense,
  income: sharedConfig.quickChips.income,
};

export const PAYMENT_METHOD_DEFS: Array<{ id: string; label: string }> = sharedConfig.paymentMethods;

const ALL_DEFS: CategoryDef[] = [...CATEGORY_DEFS.expense, ...CATEGORY_DEFS.income];

const byId = new Map<string, CategoryDef>(ALL_DEFS.map(d => [d.id, d]));
const byLabel = new Map<string, CategoryDef>(ALL_DEFS.map(d => [d.label, d]));

export const LEGACY_ALIASES: Record<string, string> = sharedConfig.legacyLabelAliases;

/**
 * Resolves a stored category value (label, legacy label, or id) to a stable id.
 *
 * An unrecognised value becomes its OWN id rather than collapsing into
 * 'other_expense'. It used to collapse, which merged every user-defined
 * category into one bucket: 心理諮商 1000 + 寵物用品 500 + a real 其他支出 300
 * came out of getCategoryBreakdown as a single 其他支出 1800, and a budget set
 * on 心理諮商 was charged for all three. The user could see their custom
 * categories everywhere in the UI (describeCategory resolves them through the
 * registry) and yet never in the analysis.
 *
 * Passing the value through keeps each one distinct and self-labelling, with
 * no dependency from this module on the storage-backed registry — which is
 * what made the collapse hard to fix before. Empty and whitespace-only values
 * still bucket, since they are corruption rather than a category.
 */
export function categoryIdForStored(stored: string): string {
  if (byId.has(stored)) return stored;
  const direct = byLabel.get(stored);
  if (direct) return direct.id;
  const alias = LEGACY_ALIASES[stored];
  if (alias) return alias;
  return stored.trim() === '' ? 'other_expense' : stored;
}

/** The label to persist/display for a category id (falls back to the id itself). */
export function labelForCategoryId(id: string): string {
  return byId.get(id)?.label ?? byLabel.get(id)?.label ?? id;
}

export function emojiForCategory(stored: string): string {
  return byId.get(categoryIdForStored(stored))?.emoji ?? '🏷️';
}

/** True when two stored values refer to the same category (label/id/legacy alias). */
export function isSameCategory(a: string, b: string): boolean {
  return categoryIdForStored(a) === categoryIdForStored(b);
}
