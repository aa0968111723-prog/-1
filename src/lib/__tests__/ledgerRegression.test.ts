import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceRepository, applyLinkedEffects, revertLinkedEffects, computeMonthExpense } from '../financeRepository';
import { pendingToTransaction, PendingNativeTransaction } from '../petBridge';
import { getLocalDateKey, parseLocalDateKey } from '../datetime';
import { createMemoryStorage } from './testUtils';
import { Transaction, Debt, Goal, RecurringTransaction } from '../../types';

/**
 * Regression tests for the guarantees the pet depends on:
 * exactly-once ingest, exact undo, and recurring instalments that never
 * regenerate.
 */

const debt: Debt = { id: 'd1', name: '卡債', amount: 10_000, interestRate: 12, dueDate: '2026-12-31', note: '' };
const goal: Goal = { id: 'g1', name: '旅遊', targetAmount: 30_000, currentAmount: 1_000, targetDate: '2026-12-31' };

describe('exactly-once ingest from the native outbox', () => {
  let repo: FinanceRepository;
  beforeEach(() => {
    repo = new FinanceRepository(createMemoryStorage());
  });

  const pending: PendingNativeTransaction = {
    id: 'pet-uuid-1',
    type: 'expense',
    amount: 120,
    category: '餐飲美食',
    date: '2026-08-19',
    note: '午餐',
    paymentMethod: 'easycard',
    createdAt: 1765000000000,
    source: 'pet_quick_add',
    schemaVersion: 2,
    syncState: 'pending',
  };

  it('replaying the same entry after a crash-before-ack adds exactly one row', () => {
    const tx = pendingToTransaction(pending);
    repo.addTransaction(tx);
    // process died before ack -> the outbox still holds it, so we drain again
    repo.addTransaction(tx);
    repo.addTransaction(tx);
    expect(repo.getTransactions()).toHaveLength(1);
    expect(repo.hasTransaction('pet-uuid-1')).toBe(true);
  });

  it('a replay does not re-apply the debt deduction', () => {
    repo.saveDebts([debt]);
    const tx = { ...pendingToTransaction(pending), amount: 2_000, linkedDebtId: 'd1' };
    repo.addTransaction(tx);
    expect(repo.getDebts()[0].amount).toBe(8_000);
    repo.addTransaction(tx); // replay
    expect(repo.getDebts()[0].amount).toBe(8_000);
  });

  it('native and web entries recorded at the same time both survive', () => {
    repo.addTransaction(pendingToTransaction(pending));
    repo.addTransaction({ type: 'expense', amount: 50, category: '交通出行', date: '2026-08-19', note: '' });
    expect(repo.getTransactions()).toHaveLength(2);
  });
});

describe('undo / delete restores linked balances exactly', () => {
  let repo: FinanceRepository;
  beforeEach(() => {
    repo = new FinanceRepository(createMemoryStorage());
    repo.saveDebts([debt]);
    repo.saveGoals([goal]);
  });

  it('debt repayment round-trips', () => {
    const tx = repo.addTransaction({
      type: 'expense', amount: 2_500, category: '負債償還', date: '2026-08-19', note: '', linkedDebtId: 'd1',
    });
    expect(repo.getDebts()[0].amount).toBe(7_500);
    repo.deleteTransaction(tx.id);
    expect(repo.getDebts()[0].amount).toBe(10_000);
  });

  it('an overpayment that clamped at zero is NOT over-credited on undo', () => {
    // 15,000 against a 10,000 debt: only 10,000 can actually be applied.
    const tx = repo.addTransaction({
      type: 'expense', amount: 15_000, category: '負債償還', date: '2026-08-19', note: '', linkedDebtId: 'd1',
    });
    expect(repo.getDebts()[0].amount).toBe(0);
    expect(tx.linkedDebtApplied).toBe(10_000);
    repo.deleteTransaction(tx.id);
    // The debt returns to what it was — not 15,000.
    expect(repo.getDebts()[0].amount).toBe(10_000);
  });

  it('goal deposit round-trips', () => {
    const tx = repo.addTransaction({
      type: 'expense', amount: 3_000, category: '投資理財', date: '2026-08-19', note: '', linkedGoalId: 'g1',
    });
    expect(repo.getGoals()[0].currentAmount).toBe(4_000);
    repo.deleteTransaction(tx.id);
    expect(repo.getGoals()[0].currentAmount).toBe(1_000);
  });

  it('legacy rows without applied metadata still revert by amount', () => {
    const legacy: Transaction = {
      id: 'legacy', type: 'expense', amount: 1_000, category: '負債償還',
      date: '2026-08-19', note: '', linkedDebtId: 'd1',
    };
    const { debts } = revertLinkedEffects(legacy, [{ ...debt, amount: 9_000 }], []);
    expect(debts[0].amount).toBe(10_000);
  });

  it('decimal amounts do not drift through apply/revert', () => {
    const start: Goal = { ...goal, currentAmount: 0 };
    let goals = [start];
    for (let i = 0; i < 10; i++) {
      goals = applyLinkedEffects({ amount: 0.1, linkedGoalId: 'g1' } as Transaction, [], goals).goals;
    }
    expect(goals[0].currentAmount).toBe(1); // not 0.9999999999999999
    for (let i = 0; i < 10; i++) {
      goals = revertLinkedEffects({ amount: 0.1, linkedGoalId: 'g1' } as Transaction, [], goals).goals;
    }
    expect(goals[0].currentAmount).toBe(0);
  });
});

describe('recurring instalments', () => {
  const rule: RecurringTransaction = {
    id: 'r1', type: 'expense', amount: 500, category: '居家生活',
    frequency: 'monthly', startDate: '2026-06-01', nextDate: '2026-06-01', note: '房租',
  };

  /** Mirrors the generator in App.tsx: deterministic ids through the repository. */
  function materialise(repo: FinanceRepository, rt: RecurringTransaction, today: string): string {
    let cursor = rt.nextDate;
    let guard = 0;
    while (cursor <= today && guard < 1000) {
      guard += 1;
      repo.addTransaction({
        id: `recurring:${rt.id}:${cursor}`,
        type: rt.type, amount: rt.amount, category: rt.category,
        date: cursor, note: rt.note, source: 'recurring',
      });
      const next = parseLocalDateKey(cursor);
      next.setMonth(next.getMonth() + 1);
      cursor = getLocalDateKey(next);
    }
    return cursor;
  }

  it('catches up once and never duplicates on a second pass', () => {
    const repo = new FinanceRepository(createMemoryStorage());
    const next = materialise(repo, rule, '2026-08-19');
    expect(repo.getTransactions()).toHaveLength(3); // Jun, Jul, Aug
    expect(next).toBe('2026-09-01');

    // A remount / StrictMode double-invoke replays from the ORIGINAL nextDate.
    materialise(repo, rule, '2026-08-19');
    expect(repo.getTransactions()).toHaveLength(3);
  });

  it('advancing from the stored nextDate adds only the new instalment', () => {
    const repo = new FinanceRepository(createMemoryStorage());
    materialise(repo, rule, '2026-08-19');
    materialise(repo, { ...rule, nextDate: '2026-09-01' }, '2026-09-05');
    expect(repo.getTransactions()).toHaveLength(4);
    expect(computeMonthExpense(repo.getTransactions(), '2026-09')).toBe(500);
  });
});
