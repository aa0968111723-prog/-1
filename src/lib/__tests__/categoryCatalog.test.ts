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

  it('falls back to other_expense for unknown values', () => {
    expect(categoryIdForStored('完全不存在的分類')).toBe('other_expense');
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
