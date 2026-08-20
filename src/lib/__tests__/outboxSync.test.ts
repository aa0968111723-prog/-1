import { describe, it, expect, vi } from 'vitest';
import { drainOutbox, OutboxPort } from '../outboxSync';
import { FinanceRepository } from '../financeRepository';
import { PendingNativeTransaction } from '../petBridge';
import { createMemoryStorage } from './testUtils';

function entry(id: string, amount = 120): PendingNativeTransaction {
  return {
    id,
    type: 'expense',
    amount,
    category: '餐飲美食',
    date: '2026-08-19',
    note: '午餐',
    paymentMethod: 'easycard',
    createdAt: 1765000000000,
    source: 'pet_quick_add',
    schemaVersion: 2,
    syncState: 'pending',
  };
}

/** A fake native outbox that records the exact call order. */
function fakePort(pending: PendingNativeTransaction[], calls: string[]): OutboxPort & { acked: string[] } {
  const acked: string[] = [];
  return {
    acked,
    async getPendingTransactions() {
      calls.push('get');
      return { transactions: pending };
    },
    async ackPendingTransactions({ ids }) {
      calls.push(`ack:${ids.join(',')}`);
      acked.push(...ids);
      // A real ack removes them from the outbox.
      for (const id of ids) {
        const i = pending.findIndex(p => p.id === id);
        if (i >= 0) pending.splice(i, 1);
      }
    },
  };
}

describe('drainOutbox ordering guarantee', () => {
  it('persists and verifies BEFORE acknowledging', async () => {
    const calls: string[] = [];
    const storage = createMemoryStorage();
    const repo = new FinanceRepository(storage);
    const originalAdd = repo.addTransaction.bind(repo);
    vi.spyOn(repo, 'addTransaction').mockImplementation(tx => {
      calls.push('persist');
      return originalAdd(tx);
    });
    const port = fakePort([entry('a'), entry('b')], calls);

    await drainOutbox(port, repo);

    // Both writes must land before the single ack.
    expect(calls).toEqual(['get', 'persist', 'persist', 'ack:a,b']);
    expect(repo.getTransactions()).toHaveLength(2);
  });

  it('a crash before ack leaves the entry in the outbox and re-drains to one row', async () => {
    const storage = createMemoryStorage();
    const repo = new FinanceRepository(storage);
    const pending = [entry('a')];
    const calls: string[] = [];
    const crashingPort: OutboxPort = {
      getPendingTransactions: async () => ({ transactions: pending }),
      ackPendingTransactions: async () => {
        throw new Error('process died before ack');
      },
    };

    await expect(drainOutbox(crashingPort, repo)).rejects.toThrow('process died');
    // The write already happened, and the outbox still holds the entry.
    expect(repo.getTransactions()).toHaveLength(1);
    expect(pending).toHaveLength(1);

    // Next launch drains again: idempotent, so still exactly one row.
    const port = fakePort(pending, calls);
    await drainOutbox(port, repo);
    expect(repo.getTransactions()).toHaveLength(1);
    expect(port.acked).toEqual(['a']);
  });

  it('does not acknowledge an entry that failed to persist', async () => {
    const storage = createMemoryStorage();
    const repo = new FinanceRepository(storage);
    vi.spyOn(repo, 'addTransaction').mockImplementation(() => {
      throw new Error('storage full');
    });
    const calls: string[] = [];
    const pending = [entry('a')];
    const port = fakePort(pending, calls);

    const result = await drainOutbox(port, repo);

    expect(result.importedIds).toEqual([]);
    expect(result.failedIds).toEqual(['a']);
    expect(port.acked).toEqual([]);
    expect(pending).toHaveLength(1); // kept for a retry
    expect(calls.some(c => c.startsWith('ack'))).toBe(false);
  });

  it('acknowledges only the entries that made it', async () => {
    const storage = createMemoryStorage();
    const repo = new FinanceRepository(storage);
    const originalAdd = repo.addTransaction.bind(repo);
    vi.spyOn(repo, 'addTransaction').mockImplementation(tx => {
      if (tx.id === 'bad') throw new Error('nope');
      return originalAdd(tx);
    });
    const calls: string[] = [];
    const pending = [entry('good1'), entry('bad'), entry('good2')];
    const port = fakePort(pending, calls);

    const result = await drainOutbox(port, repo);

    expect(result.importedIds).toEqual(['good1', 'good2']);
    expect(result.failedIds).toEqual(['bad']);
    expect(pending.map(p => p.id)).toEqual(['bad']);
  });

  it('an empty outbox does not call ack at all', async () => {
    const calls: string[] = [];
    const repo = new FinanceRepository(createMemoryStorage());
    const port = fakePort([], calls);
    const result = await drainOutbox(port, repo);
    expect(result.importedIds).toEqual([]);
    expect(calls).toEqual(['get']);
  });

  it('carries the native payment method and date through unchanged', async () => {
    const repo = new FinanceRepository(createMemoryStorage());
    const port = fakePort([entry('a')], []);
    await drainOutbox(port, repo);
    const tx = repo.getTransactions()[0];
    expect(tx.paymentMethod).toBe('easycard');
    expect(tx.date).toBe('2026-08-19');
    expect(tx.amount).toBe(120);
  });
});
