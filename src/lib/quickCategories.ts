/**
 * Quick-add chip ranking.
 *
 * Deterministic and explainable — no opaque model. The order is
 *   pinned  >  time-of-day context  >  frequency (60d)  >  recency  >  defaults
 * and the same ranked list is pushed to the Android quick add sheet so both
 * surfaces show the same five or six chips.
 */

import { Transaction, TransactionType } from '../types';
import { CATEGORY_DEFS, QUICK_CHIP_DEFS, categoryIdForStored, emojiForCategory } from './categoryCatalog';
import { listCategories } from './categoryRegistry';
import { STORAGE_KEYS, loadJSON } from './storage';
import { getLocalDateKey, addDaysKey, daysBetween } from './datetime';

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

/** How many days of history feed the frequency score. */
const HISTORY_DAYS = 60;

const PINNED_WEIGHT = 1_000_000;
const CONTEXT_WEIGHT = 500;
const FREQUENCY_WEIGHT = 10;
const RECENCY_WEIGHT = 30;

/**
 * Time-of-day nudges. Deliberately tiny and legible — only the two patterns
 * that are actually reliable: meals around eating hours, transport around
 * commuting hours. Nothing else is inferred, and nothing is learned in a way
 * the user cannot predict.
 */
export function contextBoostForHour(hour: number): Record<string, number> {
  const boosts: Record<string, number> = {};
  const isMealTime = (hour >= 6 && hour <= 9) || (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21);
  const isCommute = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  if (isMealTime) boosts.food = 2;
  if (isCommute) boosts.transport = 1;
  return boosts;
}

export function loadPinnedCategoryIds(storage: Storage | undefined = globalThis.localStorage): string[] {
  const pinned = loadJSON<unknown>(STORAGE_KEYS.pinnedCategories, [], storage);
  return Array.isArray(pinned) ? pinned.filter((p): p is string => typeof p === 'string') : [];
}

function defaultChips(type: TransactionType): QuickCategoryChip[] {
  return QUICK_CHIP_DEFS[type].map(c => ({
    emoji: c.emoji,
    label: c.label,
    category: CATEGORY_DEFS[type].find(d => d.id === c.categoryId)?.label ?? c.label,
    categoryId: c.categoryId,
    ...(c.note ? { note: c.note } : {}),
  }));
}

export interface RankedCategory {
  categoryId: string;
  label: string;
  emoji: string;
  score: number;
  /** Why it ranked here — surfaced in tests and the debug panel. */
  reasons: string[];
}

/** The scoring pass, exposed for tests and diagnostics. */
export function rankCategories(
  transactions: Transaction[],
  type: TransactionType,
  now: Date = new Date(),
  pinnedIds: string[] = loadPinnedCategoryIds(),
  storage: Storage | undefined = globalThis.localStorage,
): RankedCategory[] {
  const available = listCategories(type, storage);
  const availableIds = new Set(available.map(c => c.id));
  const cutoff = addDaysKey(now, -HISTORY_DAYS);
  const todayKey = getLocalDateKey(now);
  const context = contextBoostForHour(now.getHours());

  const counts = new Map<string, number>();
  const lastUsed = new Map<string, string>();
  for (const t of transactions) {
    if (t.type !== type || t.date < cutoff) continue;
    const id = t.categoryId ?? categoryIdForStored(t.category);
    if (!availableIds.has(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const prev = lastUsed.get(id);
    if (!prev || t.date > prev) lastUsed.set(id, t.date);
  }

  return available
    .map(def => {
      const reasons: string[] = [];
      let score = 0;

      const pinnedIndex = pinnedIds.indexOf(def.id);
      if (pinnedIndex >= 0) {
        score += PINNED_WEIGHT - pinnedIndex;
        reasons.push(`pinned#${pinnedIndex + 1}`);
      }

      const boost = context[def.id];
      if (boost) {
        score += boost * CONTEXT_WEIGHT;
        reasons.push('context');
      }

      const count = counts.get(def.id) ?? 0;
      if (count > 0) {
        score += count * FREQUENCY_WEIGHT;
        reasons.push(`used×${count}`);
      }

      const last = lastUsed.get(def.id);
      if (last) {
        const age = Math.max(0, daysBetween(last, todayKey));
        score += Math.max(0, RECENCY_WEIGHT - age);
        reasons.push(`recent-${age}d`);
      }

      return { categoryId: def.id, label: def.label, emoji: def.emoji, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'zh-TW'));
}

/**
 * Returns the chips the quick-add surfaces show: ranked real usage first,
 * padded with the shared defaults so a brand-new user still gets a usable row.
 */
export function getQuickCategories(
  transactions: Transaction[],
  type: TransactionType,
  now: Date = new Date(),
  max = 5,
  pinnedIds: string[] = loadPinnedCategoryIds(),
  storage: Storage | undefined = globalThis.localStorage,
): QuickCategoryChip[] {
  const defaults = defaultChips(type);
  const ranked = rankCategories(transactions, type, now, pinnedIds, storage).filter(r => r.score > 0);

  const chips: QuickCategoryChip[] = [];
  const seen = new Set<string>();
  const pushChip = (chip: QuickCategoryChip) => {
    const key = chip.note ? `${chip.categoryId}:${chip.note}` : chip.categoryId;
    if (seen.has(key) || chips.length >= max) return;
    seen.add(key);
    chips.push(chip);
  };

  for (const r of ranked) {
    const preset = defaults.find(d => d.categoryId === r.categoryId && !d.note);
    pushChip(
      preset ?? {
        emoji: r.emoji || emojiForCategory(r.label),
        label: r.label.slice(0, 3),
        category: r.label,
        categoryId: r.categoryId,
      },
    );
  }
  for (const chip of defaults) pushChip(chip);
  return chips;
}
