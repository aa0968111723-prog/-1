import { describe, it, expect } from 'vitest';
import { runStorageMigration, STORAGE_KEYS, CURRENT_STORAGE_VERSION, loadJSON, saveJSON } from '../storage';
import { createMemoryStorage } from './testUtils';

describe('runStorageMigration', () => {
  it('stamps the version on a fresh install without touching anything', () => {
    const storage = createMemoryStorage();
    const result = runStorageMigration(storage);
    expect(result.fromVersion).toBe(0);
    expect(result.repairedKeys).toEqual([]);
    expect(storage.getItem(STORAGE_KEYS.storageVersion)).toBe(String(CURRENT_STORAGE_VERSION));
  });

  it('preserves valid legacy data byte-for-byte', () => {
    const transactions = JSON.stringify([
      { id: '1', type: 'expense', amount: 120, category: '餐飲美食', date: '2026-08-19', note: '午餐' },
    ]);
    const budgets = JSON.stringify({ 餐飲美食: { amount: 5000, alertEnabled: true, alertThreshold: 80 } });
    const storage = createMemoryStorage({
      [STORAGE_KEYS.transactions]: transactions,
      [STORAGE_KEYS.budgets]: budgets,
      [STORAGE_KEYS.monthlyIncome]: '50000',
    });

    const result = runStorageMigration(storage);

    expect(result.repairedKeys).toEqual([]);
    expect(storage.getItem(STORAGE_KEYS.transactions)).toBe(transactions);
    expect(storage.getItem(STORAGE_KEYS.budgets)).toBe(budgets);
    expect(storage.getItem(STORAGE_KEYS.monthlyIncome)).toBe('50000');
    expect(storage.getItem(STORAGE_KEYS.storageVersion)).toBe(String(CURRENT_STORAGE_VERSION));
  });

  it('backs up corrupted data instead of deleting it', () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.transactions]: '{not json[',
      [STORAGE_KEYS.goals]: '"a string, not an array"',
    });

    const result = runStorageMigration(storage);

    expect(result.repairedKeys).toContain(STORAGE_KEYS.transactions);
    expect(result.repairedKeys).toContain(STORAGE_KEYS.goals);
    expect(storage.getItem(`${STORAGE_KEYS.transactions}__backup_v0`)).toBe('{not json[');
    expect(storage.getItem(`${STORAGE_KEYS.goals}__backup_v0`)).toBe('"a string, not an array"');
    expect(storage.getItem(STORAGE_KEYS.transactions)).toBe('[]');
    expect(storage.getItem(STORAGE_KEYS.goals)).toBe('[]');
  });

  it('is idempotent once versioned', () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.transactions]: '[]' });
    runStorageMigration(storage);
    storage.setItem(STORAGE_KEYS.transactions, '[{"id":"x"}]');
    const second = runStorageMigration(storage);
    expect(second.fromVersion).toBe(CURRENT_STORAGE_VERSION);
    expect(storage.getItem(STORAGE_KEYS.transactions)).toBe('[{"id":"x"}]');
  });

  it('repairs a non-numeric monthly income with backup', () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.monthlyIncome]: 'oops' });
    runStorageMigration(storage);
    expect(storage.getItem(STORAGE_KEYS.monthlyIncome)).toBe('0');
    expect(storage.getItem(`${STORAGE_KEYS.monthlyIncome}__backup_v0`)).toBe('oops');
  });
});

describe('loadJSON / saveJSON', () => {
  it('round-trips values and falls back on parse errors', () => {
    const storage = createMemoryStorage();
    saveJSON('k', { a: 1 }, storage);
    expect(loadJSON('k', {}, storage)).toEqual({ a: 1 });
    storage.setItem('bad', '{');
    expect(loadJSON('bad', 'fallback', storage)).toBe('fallback');
  });
});
