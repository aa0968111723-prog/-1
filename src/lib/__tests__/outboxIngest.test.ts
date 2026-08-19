import { describe, it, expect } from 'vitest';
import { FinanceRepository } from '../financeRepository';
import { pendingToTransaction, PendingNativeTransaction } from '../petBridge';
import { createMemoryStorage } from './testUtils';

const nativeTx: PendingNativeTransaction = {
  id: 'native-uuid-1',
  type: 'expense',
  amount: 120,
  category: '餐飲美食',
  date: '2026-08-19',
  note: '午餐',
  paymentMethod: 'cash',
  createdAt: 1765000000000,
  source: 'pet_quick_add',
  schemaVersion: 2,
  syncState: 'pending',
};

describe('native outbox ingest', () => {
  it('converts a v2 outbox entry, preserving the stable id and dropping metadata', () => {
    const tx = pendingToTransaction(nativeTx);
    expect(tx.id).toBe('native-uuid-1');
    expect(tx.amount).toBe(120);
    expect(tx.paymentMethod).toBe('cash');
    expect('createdAt' in tx).toBe(false);
    expect('syncState' in tx).toBe(false);
  });

  it('handles v1 entries without metadata (backward compatible)', () => {
    const v1 = { id: 'old', type: 'expense', amount: 5, category: 'x', date: '2026-01-01', note: '' } as PendingNativeTransaction;
    expect(pendingToTransaction(v1).id).toBe('old');
  });

  it('exactly-once: replaying the same id after crash-before-ack never duplicates', () => {
    const repo = new FinanceRepository(createMemoryStorage());
    const tx = pendingToTransaction(nativeTx);
    repo.addTransaction(tx);
    // crash happened before ack -> web drains the outbox again
    repo.addTransaction(tx);
    repo.addTransaction(tx);
    expect(repo.getTransactions()).toHaveLength(1);
    expect(repo.getTransactions()[0].id).toBe('native-uuid-1');
  });

  it('concurrent native + web entries both persist (no conflict)', () => {
    const repo = new FinanceRepository(createMemoryStorage());
    repo.addTransaction(pendingToTransaction(nativeTx)); // native 120 餐飲
    repo.addTransaction({ type: 'expense', amount: 50, category: '交通出行', date: '2026-08-19', note: '' }); // web 50 交通
    const all = repo.getTransactions();
    expect(all).toHaveLength(2);
    expect(all.map(t => t.amount).sort((a, b) => a - b)).toEqual([50, 120]);
  });
});
