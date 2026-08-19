/**
 * Quick-add category chips: pinned first, then most-used (recency-weighted),
 * padded with the shared defaults. Chip definitions come from the shared
 * catalog (shared/pet-shared-config.json) so web and native stay identical.
 */

import { Transaction, TransactionType, CATEGORIES } from '../types';
import { CATEGORY_DEFS, QUICK_CHIP_DEFS, categoryIdForStored, emojiForCategory } from './categoryCatalog';
import { STORAGE_KEYS, loadJSON } from './storage';

export interface QuickCategoryChip {
  emoji: string;
  label: string;
  /** The real FinTracker category (label as stored) — never a parallel taxonomy. */
  category: string;
  /** Stable cross-layer category id. */
  categoryId: string;
  /** Optional note auto-filled when the chip is more specific than the category. */
  note?: string;
}

/** Back-compat emoji lookup by stored label/id. */
export const CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  [...CATEGORY_DEFS.expense, ...CATEGORY_DEFS.income].flatMap(d => [
    [d.label, d.emoji],
    [d.id, d.emoji],
  ]),
);

function defaultChips(type: TransactionType): QuickCategoryChip[] {
  return QUICK_CHIP_DEFS[type].map(c => ({
    emoji: c.emoji,
    label: c.label,
    category: CATEGORY_DEFS[type].find(d => d.id === c.categoryId)?.label ?? c.label,
    categoryId: c.categoryId,
    ...(c.note ? { note: c.note } : {}),
  }));
}

/** User-pinned category ids, managed in 桌寵設定 → 快速記帳. */
export function loadPinnedCategoryIds(storage: Storage | undefined = globalThis.localStorage): string[] {
  const pinned = loadJSON<unknown>(STORAGE_KEYS.pinnedCategories, [], storage);
  return Array.isArray(pinned) ? pinned.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * Returns 4-6 chips ordered: pinned -> frequently/recently used (last 60
 * days) -> shared defaults. Chips always map onto the existing CATEGORIES
 * taxonomy.
 */
export function getQuickCategories(
  transactions: Transaction[],
  type: TransactionType,
  now: Date = new Date(),
  max = 6,
  pinnedIds: string[] = loadPinnedCategoryIds(),
): QuickCategoryChip[] {
  const defaults = defaultChips(type);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const scores = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== type || t.date < cutoffStr) continue;
    scores.set(t.category, (scores.get(t.category) ?? 0) + 1);
  }

  const used = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category)
    .filter(c => CATEGORIES[type].includes(c));

  const chips: QuickCategoryChip[] = [];
  const seen = new Set<string>();
  const pushChip = (chip: QuickCategoryChip) => {
    const key = chip.note ? `${chip.categoryId}:${chip.note}` : chip.categoryId;
    if (seen.has(key) || chips.length >= max) return;
    seen.add(key);
    chips.push(chip);
  };
  const chipForCategory = (category: string): QuickCategoryChip => {
    const id = categoryIdForStored(category);
    const preset = defaults.find(d => d.categoryId === id && !d.note);
    return preset ?? { emoji: emojiForCategory(category), label: category.slice(0, 2), category, categoryId: id };
  };

  // 1. pinned
  const typeIds = new Set(CATEGORY_DEFS[type].map(d => d.id));
  for (const id of pinnedIds) {
    if (!typeIds.has(id)) continue;
    const def = CATEGORY_DEFS[type].find(d => d.id === id)!;
    pushChip(chipForCategory(def.label));
  }
  // 2. frequently / recently used
  for (const category of used) pushChip(chipForCategory(category));
  // 3. shared defaults
  for (const chip of defaults) pushChip(chip);
  return chips;
}
