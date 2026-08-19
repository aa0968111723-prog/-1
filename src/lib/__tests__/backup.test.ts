import { describe, it, expect } from 'vitest';
import { createBackup, validateBackup, applyBackup, FinanceBackup } from '../backup';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION } from '../storage';
import { createMemoryStorage } from './testUtils';
import { Transaction } from '../../types';

function tx(id: string, amount = 100): Transaction {
  return { id, type: 'expense', amount, category: '餐飲美食', date: '2026-08-19', note: '' };
}

function seeded(): Storage {
  const s = createMemoryStorage();
  s.setItem(STORAGE_KEYS.transactions, JSON.stringify([tx('a'), tx('b')]));
  s.setItem(STORAGE_KEYS.budgets, JSON.stringify({ 餐飲美食: { amount: 5000, alertEnabled: true, alertThreshold: 80 } }));
  s.setItem(STORAGE_KEYS.monthlyIncome, '40000');
  return s;
}

describe('backup', () => {
  it('creates a complete, valid backup', () => {
    const backup = createBackup(seeded());
    expect(backup.schemaVersion).toBe(CURRENT_STORAGE_VERSION);
    expect(backup.transactions).toHaveLength(2);
    expect(backup.monthlyIncome).toBe(40000);
    const v = validateBackup(backup);
    expect(v.ok).toBe(true);
    expect(v.counts.transactions).toBe(2);
  });

  it('rejects malformed payloads with reasons', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
    expect(validateBackup({ schemaVersion: 'x' }).ok).toBe(false);
    const badTx = validateBackup({ schemaVersion: 1, transactions: [{ id: 1 }] });
    expect(badTx.ok).toBe(false);
    expect(badTx.errors.join()).toContain('交易');
  });

  it('rejects backups newer than the app supports', () => {
    const v = validateBackup({ schemaVersion: CURRENT_STORAGE_VERSION + 1 });
    expect(v.ok).toBe(false);
  });

  it('merge is idempotent and never duplicates by id', () => {
    const storage = seeded();
    const backup = createBackup(storage);
    applyBackup(backup, 'merge', storage);
    applyBackup(backup, 'merge', storage); // second import of the same file
    const after = JSON.parse(storage.getItem(STORAGE_KEYS.transactions)!);
    expect(after).toHaveLength(2);
  });

  it('merge adds only new ids and keeps existing budgets', () => {
    const storage = seeded();
    const incoming: FinanceBackup = {
      ...createBackup(createMemoryStorage()),
      transactions: [tx('a'), tx('c', 999)],
      budgets: { 餐飲美食: { amount: 1, alertEnabled: false, alertThreshold: 50 } },
    };
    applyBackup(incoming, 'merge', storage);
    const txs = JSON.parse(storage.getItem(STORAGE_KEYS.transactions)!);
    expect(txs.map((t: Transaction) => t.id).sort()).toEqual(['a', 'b', 'c']);
    const budgets = JSON.parse(storage.getItem(STORAGE_KEYS.budgets)!);
    expect(budgets['餐飲美食'].amount).toBe(5000); // existing wins on merge
  });

  it('replace overwrites but writes a safety backup first', () => {
    const storage = seeded();
    const incoming: FinanceBackup = {
      ...createBackup(createMemoryStorage()),
      transactions: [tx('z')],
    };
    applyBackup(incoming, 'replace', storage);
    const txs = JSON.parse(storage.getItem(STORAGE_KEYS.transactions)!);
    expect(txs).toHaveLength(1);
    expect(txs[0].id).toBe('z');
    const safety = JSON.parse(storage.getItem(STORAGE_KEYS.importSafetyBackup)!);
    expect(safety.transactions).toHaveLength(2); // original data recoverable
  });
});
