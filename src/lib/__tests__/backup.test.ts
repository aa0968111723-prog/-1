import { describe, it, expect } from 'vitest';
import { createBackup, validateBackup, applyBackup, FinanceBackup } from '../backup';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, loadJSON, saveJSON } from '../storage';
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

describe('a tombstone is not an entry', () => {
  it('does not count deleted rows in the import preview', () => {
    // The count is shown right before the user chooses 取代 or 合併. Saying
    // "322 筆" when 50 of them are deletions overstates what they are about
    // to restore. The rows still travel — they just are not entries.
    const backup = {
      schemaVersion: CURRENT_STORAGE_VERSION,
      transactions: [
        { id: 'a', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' },
        { id: 'b', type: 'expense', amount: 250, category: '交通出行', date: '2026-08-20', note: '', deletedAt: '2026-08-20T10:00:00Z' },
      ],
    };

    const result = validateBackup(backup);

    expect(result.counts.transactions).toBe(1);
  });
});

/*
 * The README tells people the JSON export is a 完整備份 and to use it when
 * they change device or clear their cache. It was leaving the taxonomy behind:
 * transactions came back referring to custom categories that no longer
 * existed, with the pinned chips and payment-method preferences gone too.
 */
describe('a backup carries the taxonomy the ledger is written in', () => {
  function seededStorage() {
    const storage = createMemoryStorage();
    saveJSON(STORAGE_KEYS.customCategories, [
      { id: 'custom:心理諮商', label: '心理諮商', emoji: '🛋️', type: 'expense', custom: true, createdAt: '2026-01-01T00:00:00Z' },
    ], storage);
    saveJSON(STORAGE_KEYS.pinnedCategories, ['food', 'custom:心理諮商'], storage);
    saveJSON(STORAGE_KEYS.paymentMethodPrefs, { enabled: ['cash', 'credit'], defaultId: 'credit' }, storage);
    return storage;
  }

  it('exports custom categories, pinned chips and payment preferences', () => {
    const backup = createBackup(seededStorage());

    expect(backup.customCategories?.[0].label).toBe('心理諮商');
    expect(backup.pinnedCategories).toEqual(['food', 'custom:心理諮商']);
    expect(backup.paymentMethodPrefs).toEqual({ enabled: ['cash', 'credit'], defaultId: 'credit' });
  });

  it('restores them onto a clean device', () => {
    const backup = createBackup(seededStorage());
    const fresh = createMemoryStorage();

    applyBackup(backup, 'replace', fresh);

    expect(loadJSON(STORAGE_KEYS.customCategories, [], fresh)).toHaveLength(1);
    expect(loadJSON(STORAGE_KEYS.pinnedCategories, [], fresh)).toEqual(['food', 'custom:心理諮商']);
    expect(loadJSON(STORAGE_KEYS.paymentMethodPrefs, {}, fresh)).toEqual({ enabled: ['cash', 'credit'], defaultId: 'credit' });
  });

  it('merging keeps the categories this device already had', () => {
    const backup = createBackup(seededStorage());
    const other = createMemoryStorage();
    saveJSON(STORAGE_KEYS.customCategories, [
      { id: 'custom:寵物', label: '寵物', emoji: '🐾', type: 'expense', custom: true, createdAt: '2026-02-01T00:00:00Z' },
    ], other);

    applyBackup(backup, 'merge', other);

    const ids = loadJSON<Array<{ id: string }>>(STORAGE_KEYS.customCategories, [], other).map(c => c.id).sort();
    expect(ids).toEqual(['custom:寵物', 'custom:心理諮商']);
  });

  it('still imports a file written before the taxonomy was included', () => {
    const legacy = { ...createBackup(seededStorage()) } as Partial<FinanceBackup>;
    delete legacy.customCategories;
    delete legacy.pinnedCategories;
    delete legacy.paymentMethodPrefs;

    const fresh = createMemoryStorage();
    expect(() => applyBackup(legacy as FinanceBackup, 'replace', fresh)).not.toThrow();
    expect(loadJSON(STORAGE_KEYS.customCategories, [], fresh)).toEqual([]);
  });
});
