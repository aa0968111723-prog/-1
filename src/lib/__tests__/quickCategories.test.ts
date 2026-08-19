import { describe, it, expect } from 'vitest';
import { getQuickCategories } from '../quickCategories';
import { Transaction } from '../../types';

const NOW = new Date(2026, 7, 19);

function tx(category: string, date = '2026-08-15', type: 'income' | 'expense' = 'expense'): Transaction {
  return { id: `${category}-${Math.random()}`, type, amount: 100, category, date, note: '' };
}

describe('getQuickCategories', () => {
  it('returns sensible defaults for a new user', () => {
    const chips = getQuickCategories([], 'expense', NOW);
    expect(chips.length).toBeGreaterThanOrEqual(4);
    expect(chips.length).toBeLessThanOrEqual(6);
    expect(chips[0].category).toBe('餐飲美食');
    expect(chips.every(c => c.category)).toBe(true);
  });

  it('ranks the user\'s most-used categories first', () => {
    const txs = [
      tx('醫療保健'), tx('醫療保健'), tx('醫療保健'),
      tx('交通出行'),
    ];
    const chips = getQuickCategories(txs, 'expense', NOW);
    expect(chips[0].category).toBe('醫療保健');
  });

  it('ignores stale usage older than 60 days', () => {
    const chips = getQuickCategories([tx('醫療保健', '2020-01-01')], 'expense', NOW);
    expect(chips[0].category).toBe('餐飲美食');
  });

  it('provides income chips mapped to real income categories', () => {
    const chips = getQuickCategories([], 'income', NOW);
    expect(chips.map(c => c.category)).toContain('薪資收入');
  });

  it('never exceeds max and never duplicates', () => {
    const txs = ['餐飲美食', '交通出行', '購物消費', '休閒娛樂', '居家生活', '水電網費', '醫療保健']
      .flatMap(c => [tx(c), tx(c)]);
    const chips = getQuickCategories(txs, 'expense', NOW, 6);
    expect(chips).toHaveLength(6);
    const keys = chips.map(c => `${c.category}:${c.note ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
