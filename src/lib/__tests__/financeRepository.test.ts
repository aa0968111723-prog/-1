import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceRepository, applyLinkedEffects, revertLinkedEffects, computeTodaySummary, toLocalDateString } from '../financeRepository';
import { STORAGE_KEYS } from '../storage';
import { createMemoryStorage } from './testUtils';
import { Transaction, Debt, Goal } from '../../types';
import { FinanceAnalyticsEngine } from '../financeAnalytics';

const debt: Debt = { id: 'd1', name: '卡債', amount: 10000, interestRate: 12, dueDate: '2026-12-31', note: '' };
const goal: Goal = { id: 'g1', name: '旅遊基金', targetAmount: 30000, currentAmount: 1000, targetDate: '2026-12-31' };

describe('FinanceRepository', () => {
  let storage: Storage;
  let repo: FinanceRepository;

  beforeEach(() => {
    storage = createMemoryStorage();
    repo = new FinanceRepository(storage);
  });

  it('adds a transaction and persists it under the legacy key', () => {
    const tx = repo.addTransaction({ type: 'expense', amount: 120, category: '餐飲美食', date: '2026-08-19', note: '午餐' });
    expect(tx.id).toBeTruthy();
    expect(repo.getTransactions()).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.transactions)!)[0].amount).toBe(120);
  });

  it('preserves a provided id (native pending import)', () => {
    const tx = repo.addTransaction({ id: 'native-1', type: 'expense', amount: 50, category: '交通出行', date: '2026-08-19', note: '' });
    expect(tx.id).toBe('native-1');
  });

  it('applies and reverts linked debt/goal effects on add/delete', () => {
    repo.saveDebts([debt]);
    repo.saveGoals([goal]);
    const tx = repo.addTransaction({
      type: 'expense', amount: 2000, category: '負債償還', date: '2026-08-19', note: '', linkedDebtId: 'd1',
    });
    expect(repo.getDebts()[0].amount).toBe(8000);
    repo.deleteTransaction(tx.id);
    expect(repo.getDebts()[0].amount).toBe(10000);
    expect(repo.getTransactions()).toHaveLength(0);
  });

  it('computes today summary', () => {
    const today = toLocalDateString(new Date());
    repo.addTransaction({ type: 'expense', amount: 120, category: '餐飲美食', date: today, note: '' });
    repo.addTransaction({ type: 'income', amount: 500, category: '其他收入', date: today, note: '' });
    repo.addTransaction({ type: 'expense', amount: 999, category: '餐飲美食', date: '2000-01-01', note: '' });
    const summary = repo.getTodaySummary();
    expect(summary.count).toBe(2);
    expect(summary.expenseTotal).toBe(120);
    expect(summary.incomeTotal).toBe(500);
  });
});

describe('linked effects (pure)', () => {
  it('deducts a linked debt but never below zero', () => {
    const { debts } = applyLinkedEffects({ amount: 15000, linkedDebtId: 'd1' } as Transaction, [debt], []);
    expect(debts[0].amount).toBe(0);
  });

  it('adds to a linked goal and reverts symmetrically', () => {
    const applied = applyLinkedEffects({ amount: 500, linkedGoalId: 'g1' } as Transaction, [], [goal]);
    expect(applied.goals[0].currentAmount).toBe(1500);
    const reverted = revertLinkedEffects({ amount: 500, linkedGoalId: 'g1' } as Transaction, [], applied.goals);
    expect(reverted.goals[0].currentAmount).toBe(1000);
  });
});

describe('computeTodaySummary', () => {
  it('uses local date, not UTC', () => {
    const now = new Date(2026, 7, 19, 0, 30); // local midnight-ish
    const txs: Transaction[] = [
      { id: '1', type: 'expense', amount: 10, category: 'x', date: '2026-08-19', note: '' },
    ];
    expect(computeTodaySummary(txs, now).count).toBe(1);
  });
});

/*
 * Deleting has to be a fact the other devices can learn, not an absence they
 * can never notice. merge.ts has carried the tombstone machinery since sync
 * was written; deleteTransaction was still doing filter(t => t.id !== id), so
 * nothing ever produced one.
 */
describe('deleting writes a tombstone', () => {
  function seeded() {
    const r = new FinanceRepository(createMemoryStorage());
    r.addTransaction({ id: 'keep', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' });
    r.addTransaction({ id: 'gone', type: 'expense', amount: 250, category: '交通出行', date: '2026-08-20', note: '' });
    return r;
  }

  it('hides the row from readers but keeps it on disk', () => {
    const r = seeded();
    r.deleteTransaction('gone');

    expect(r.getTransactions().map(t => t.id)).toEqual(['keep']);
    expect(r.getAllTransactionsIncludingDeleted().map(t => t.id).sort()).toEqual(['gone', 'keep']);
  });

  it('stamps deletedAt and moves updatedAt so the deletion can win a merge', () => {
    const r = seeded();
    r.deleteTransaction('gone');

    const row = r.getAllTransactionsIncludingDeleted().find(t => t.id === 'gone') as
      Transaction & { deletedAt?: string; updatedAt?: string };
    expect(row.deletedAt).toBeTruthy();
    expect(row.updatedAt).toBe(row.deletedAt);
  });

  it('keeps the deleted money out of every total', () => {
    const r = seeded();
    r.deleteTransaction('gone');
    const engine = new FinanceAnalyticsEngine({ transactions: r.getAllTransactionsIncludingDeleted() });
    // Even handed the raw list, the engine must not sum a tombstone — the
    // repository is not the only way rows reach it (backup import, sync).
    expect(engine.getAllTimeTotals().expense).toBe(100);
  });

  it('still reverses the linked debt or goal effect exactly once', () => {
    const r = new FinanceRepository(createMemoryStorage());
    r.saveDebts([{ id: 'd1', name: '車貸', amount: 10000, interestRate: 5, monthlyPayment: 1000 } as Debt]);
    const tx = r.addTransaction({
      id: 'pay', type: 'expense', amount: 3000, category: '負債償還',
      date: '2026-08-20', note: '', linkedDebtId: 'd1',
    } as never);
    expect(r.getDebts()[0].amount).toBe(7000);

    r.deleteTransaction(tx.id);
    expect(r.getDebts()[0].amount).toBe(10000);

    // A second delete must be a no-op, or the balance would be credited twice.
    r.deleteTransaction(tx.id);
    expect(r.getDebts()[0].amount).toBe(10000);
  });

  it('does not let a replayed outbox entry resurrect a deleted row', () => {
    const r = seeded();
    r.deleteTransaction('gone');

    expect(r.hasTransaction('gone')).toBe(true);
    r.addTransaction({ id: 'gone', type: 'expense', amount: 250, category: '交通出行', date: '2026-08-20', note: '' });
    expect(r.getTransactions().map(t => t.id)).toEqual(['keep']);
  });

  it('prunes only tombstones the cloud has already confirmed', () => {
    const r = seeded();
    const old = '2020-01-01T00:00:00.000Z';
    r.saveTransactions([
      { id: 'confirmed-old', type: 'expense', amount: 1, category: '餐飲美食', date: '2020-01-01', note: '', deletedAt: old, syncedAt: old },
      { id: 'never-synced', type: 'expense', amount: 1, category: '餐飲美食', date: '2020-01-01', note: '', deletedAt: old },
      { id: 'keep', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' },
    ] as Transaction[]);

    expect(r.pruneTombstones(new Date('2026-08-20T00:00:00Z'))).toBe(1);
    // A device that has been offline for a year still needs to hear about the
    // one that never reached the cloud.
    expect(r.getAllTransactionsIncludingDeleted().map(t => t.id).sort()).toEqual(['keep', 'never-synced']);
  });
});

/*
 * Moving money in and out of a savings goal.
 *
 * Two implementations were running at once: GoalPlanner adjusted the balance
 * by hand AND recorded a linked transaction, whose effect adjusted it again.
 * Depositing NT$3,000 into a NT$10,000 goal left it at NT$16,000. Withdrawing
 * NT$3,000 left it at NT$10,000, because applyLinkedEffects ignored the
 * transaction type and credited the goal for a withdrawal, cancelling the
 * manual debit exactly. DebtManager's quick repay never had the bug — it
 * records the transaction and lets the engine move the balance.
 */
describe('goal deposits and withdrawals', () => {
  const goalAt = (currentAmount: number): Goal => ({
    id: 'g1',
    name: '旅遊基金',
    targetAmount: 50000,
    currentAmount,
    targetDate: '2027-01-01',
  });

  function withGoal(currentAmount = 10000) {
    const r = new FinanceRepository(createMemoryStorage());
    r.saveGoals([goalAt(currentAmount)]);
    return r;
  }

  const deposit = { type: 'expense' as const, category: 'Investments', date: '2026-08-20', note: '存入目標', linkedGoalId: 'g1' };
  const withdraw = { type: 'income' as const, category: 'Investments', date: '2026-08-20', note: '目標提領', linkedGoalId: 'g1' };

  it('a deposit credits the goal exactly once', () => {
    const r = withGoal();
    r.addTransaction({ ...deposit, amount: 3000 });
    expect(r.getGoals()[0].currentAmount).toBe(13000);
  });

  it('a withdrawal debits the goal instead of crediting it', () => {
    const r = withGoal();
    r.addTransaction({ ...withdraw, amount: 3000 });
    expect(r.getGoals()[0].currentAmount).toBe(7000);
  });

  it('undoing a withdrawal puts the money back', () => {
    const r = withGoal();
    const tx = r.addTransaction({ ...withdraw, amount: 3000 });
    r.deleteTransaction(tx.id);
    expect(r.getGoals()[0].currentAmount).toBe(10000);
  });

  it('an over-withdrawal clamps at zero and undo restores what was taken', () => {
    const r = withGoal();
    const tx = r.addTransaction({ ...withdraw, amount: 99999 });
    expect(r.getGoals()[0].currentAmount).toBe(0);

    // Restores 10000, not 99999: the recorded delta is what the goal could
    // actually give back, not what was asked for.
    r.deleteTransaction(tx.id);
    expect(r.getGoals()[0].currentAmount).toBe(10000);
  });

  it('records the direction so an old positive delta still reads as a deposit', () => {
    const r = withGoal();
    const tx = r.addTransaction({ ...deposit, amount: 3000 });
    const stored = r.getTransactions().find(t => t.id === tx.id) as Transaction & { linkedGoalApplied?: number };
    expect(stored.linkedGoalApplied).toBe(3000);

    const out = r.addTransaction({ ...withdraw, amount: 1000 });
    const storedOut = r.getTransactions().find(t => t.id === out.id) as Transaction & { linkedGoalApplied?: number };
    expect(storedOut.linkedGoalApplied).toBe(-1000);
  });

  it('reverts a legacy row that predates signed deltas', () => {
    const r = withGoal();
    // Written before linkedGoalApplied existed: positive amount, deposit.
    r.saveTransactions([
      { id: 'legacy', type: 'expense', amount: 2000, category: 'Investments', date: '2026-08-01', note: '', linkedGoalId: 'g1' } as Transaction,
    ]);
    r.deleteTransaction('legacy');
    expect(r.getGoals()[0].currentAmount).toBe(8000);
  });
});
