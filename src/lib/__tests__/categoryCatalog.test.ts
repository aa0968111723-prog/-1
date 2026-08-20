import { describe, it, expect } from 'vitest';
import {
  categoryIdForStored,
  labelForCategoryId,
  emojiForCategory,
  isSameCategory,
  CATEGORY_DEFS,
  QUICK_CHIP_DEFS,
} from '../categoryCatalog';
import { CATEGORIES } from '../../types';

describe('categoryCatalog', () => {
  it('covers every existing CATEGORIES label except legacy aliases', () => {
    for (const label of CATEGORIES.expense) {
      const id = categoryIdForStored(label);
      expect(id).toBeTruthy();
      if (label !== 'Loan Repayments') {
        expect(labelForCategoryId(id)).toBe(label);
      }
    }
    for (const label of CATEGORIES.income) {
      expect(categoryIdForStored(label)).toBeTruthy();
    }
  });

  it('maps legacy English labels onto stable ids without data rewrites', () => {
    expect(categoryIdForStored('Loan Repayments')).toBe('debt');
    expect(categoryIdForStored('Investments')).toBe('investment');
    expect(isSameCategory('Loan Repayments', '負債償還')).toBe(true);
    expect(isSameCategory('Investments', '投資理財')).toBe(true);
  });

  it('accepts ids as stored values too (forward compatible)', () => {
    expect(categoryIdForStored('food')).toBe('food');
    expect(labelForCategoryId('food')).toBe('餐飲美食');
  });

  it('keeps an unrecognised value as its own category rather than merging it', () => {
    // This used to return 'other_expense', which merged every user-defined
    // category into one bucket in the analysis while the UI still showed them
    // separately. A category the engine cannot name is still a category.
    expect(categoryIdForStored('完全不存在的分類')).toBe('完全不存在的分類');
    expect(labelForCategoryId('完全不存在的分類')).toBe('完全不存在的分類');
  });

  it('still buckets empty and whitespace-only values, which are corruption', () => {
    expect(categoryIdForStored('')).toBe('other_expense');
    expect(categoryIdForStored('   ')).toBe('other_expense');
  });

  it('every quick chip references a real category of its type', () => {
    for (const type of ['expense', 'income'] as const) {
      const ids = new Set(CATEGORY_DEFS[type].map(d => d.id));
      for (const chip of QUICK_CHIP_DEFS[type]) {
        expect(ids.has(chip.categoryId)).toBe(true);
      }
    }
  });

  it('provides an emoji for every category', () => {
    for (const def of [...CATEGORY_DEFS.expense, ...CATEGORY_DEFS.income]) {
      expect(emojiForCategory(def.label)).not.toBe('🏷️');
    }
  });
});
