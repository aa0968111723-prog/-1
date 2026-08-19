import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceRepository, applyLinkedEffects, revertLinkedEffects, computeTodaySummary, toLocalDateString } from '../financeRepository';
import { STORAGE_KEYS } from '../storage';
import { createMemoryStorage } from './testUtils';
import { Transaction, Debt, Goal } from '../../types';

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
