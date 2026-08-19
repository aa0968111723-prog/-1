/** Quick-add category chips: most-used first, sensible defaults for new users. */

import { Transaction, TransactionType, CATEGORIES } from '../types';

export interface QuickCategoryChip {
  emoji: string;
  label: string;
  /** The real FinTracker category this chip writes — never a parallel taxonomy. */
  category: string;
  /** Optional note auto-filled when the chip is more specific than the category. */
  note?: string;
}

export const CATEGORY_EMOJI: Record<string, string> = {
  餐飲美食: '🍱',
  交通出行: '🚌',
  休閒娛樂: '🎮',
  購物消費: '🛍️',
  居家生活: '🏠',
  水電網費: '💡',
  醫療保健: '💊',
  學習進修: '📚',
  負債償還: '💳',
  其他支出: '📦',
  'Loan Repayments': '💳',
  薪資收入: '💰',
  投資理財: '📈',
  零星獎金: '🧧',
  其他收入: '✨',
  Investments: '📈',
};

const DEFAULT_EXPENSE_CHIPS: QuickCategoryChip[] = [
  { emoji: '🍱', label: '餐飲', category: '餐飲美食' },
  { emoji: '🥤', label: '飲料', category: '餐飲美食', note: '飲料' },
  { emoji: '🚌', label: '交通', category: '交通出行' },
  { emoji: '🛍️', label: '購物', category: '購物消費' },
  { emoji: '🎮', label: '娛樂', category: '休閒娛樂' },
];

const DEFAULT_INCOME_CHIPS: QuickCategoryChip[] = [
  { emoji: '💰', label: '薪資', category: '薪資收入' },
  { emoji: '🧧', label: '獎金', category: '零星獎金' },
  { emoji: '📈', label: '投資', category: '投資理財' },
  { emoji: '✨', label: '其他', category: '其他收入' },
];

/**
 * Returns 4-6 chips: categories the user actually uses most (last 60 days,
 * weighted toward recency) padded with defaults. Chips always map onto the
 * existing CATEGORIES taxonomy.
 */
export function getQuickCategories(
  transactions: Transaction[],
  type: TransactionType,
  now: Date = new Date(),
  max = 6,
): QuickCategoryChip[] {
  const defaults = type === 'expense' ? DEFAULT_EXPENSE_CHIPS : DEFAULT_INCOME_CHIPS;
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
    const key = chip.note ? `${chip.category}:${chip.note}` : chip.category;
    if (seen.has(key) || chips.length >= max) return;
    seen.add(key);
    chips.push(chip);
  };

  for (const category of used) {
    const preset = defaults.find(d => d.category === category && !d.note);
    pushChip(preset ?? { emoji: CATEGORY_EMOJI[category] ?? '🏷️', label: category.slice(0, 2), category });
  }
  for (const chip of defaults) pushChip(chip);
  return chips;
}
