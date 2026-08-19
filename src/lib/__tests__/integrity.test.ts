import { describe, it, expect } from 'vitest';
import { checkIntegrity, loadIntegrityReport, runIntegrityCheck } from '../integrity';
import { STORAGE_KEYS } from '../storage';
import { Debt, Goal, Transaction } from '../../types';
import { createMemoryStorage } from './testUtils';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 'tx-1',
    type: 'expense',
    amount: 120,
    category: '餐飲美食',
    date: '2026-08-19',
    note: '午餐',
    ...overrides,
  };
}

const DEBT: Debt = {
  id: 'debt-1',
  name: '信用卡',
  amount: 30000,
  interestRate: 12,
  dueDate: '2026-09-01',
  note: '',
};

const GOAL: Goal = {
  id: 'goal-1',
  name: '旅遊基金',
  targetAmount: 50000,
  currentAmount: 8000,
  targetDate: '2027-01-01',
};

function check(transactions: Transaction[], debts: Debt[] = [], goals: Goal[] = []) {
  return checkIntegrity({ transactions, debts, goals });
}

describe('checkIntegrity', () => {
  it('reports ok on a clean ledger', () => {
    const report = check(
      [
        tx({ id: 'a' }),
        tx({ id: 'b', type: 'income', category: '薪資收入', amount: 52000, date: '2026-08-05' }),
        tx({ id: 'c', linkedDebtId: DEBT.id, linkedGoalId: GOAL.id }),
      ],
      [DEBT],
      [GOAL],
    );

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.transactionCount).toBe(3);
    expect(new Date(report.checkedAt).getTime()).not.toBeNaN();
  });

  it('reports an empty ledger as ok', () => {
    const report = check([]);
    expect(report.ok).toBe(true);
    expect(report.transactionCount).toBe(0);
  });

  it('detects duplicate ids once per duplicated id', () => {
    const report = check([
      tx({ id: 'dup' }),
      tx({ id: 'dup' }),
      tx({ id: 'dup' }),
      tx({ id: 'other-dup' }),
      tx({ id: 'other-dup' }),
      tx({ id: 'unique' }),
    ]);

    const duplicates = report.issues.filter(i => i.kind === 'duplicate_id');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map(i => i.id).sort()).toEqual(['dup', 'other-dup']);
    expect(duplicates.find(i => i.id === 'dup')?.detail).toContain('3');
    expect(report.ok).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['absurdly large', 1e12],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('detects an %s amount', (_label, amount) => {
    const report = check([tx({ id: 'bad-amount', amount })]);
    const issue = report.issues.find(i => i.kind === 'invalid_amount');
    expect(issue).toBeDefined();
    expect(issue?.id).toBe('bad-amount');
    expect(report.ok).toBe(false);
  });

  it('accepts amounts at the ledger boundaries', () => {
    const report = check([tx({ id: 'small', amount: 0.5 }), tx({ id: 'max', amount: 1_000_000_000 })]);
    expect(report.issues.filter(i => i.kind === 'invalid_amount')).toEqual([]);
  });

  it.each(['2026-13-45', '', 'yesterday', '2026-2-3', '2026-02-30'])('detects the invalid date key %p', dateKey => {
    const report = check([tx({ id: 'bad-date', date: dateKey })]);
    const issue = report.issues.find(i => i.kind === 'invalid_date');
    expect(issue).toBeDefined();
    expect(issue?.id).toBe('bad-date');
  });

  it('detects a missing transaction type', () => {
    const report = check([tx({ id: 'no-type', type: undefined as unknown as Transaction['type'] })]);
    expect(report.issues.some(i => i.kind === 'missing_type' && i.id === 'no-type')).toBe(true);
  });

  it('detects a blank category', () => {
    const report = check([tx({ id: 'no-cat', category: '   ' })]);
    expect(report.issues.some(i => i.kind === 'unknown_category' && i.id === 'no-cat')).toBe(true);
  });

  it('detects an orphan linkedDebtId without leaking the amount', () => {
    const report = check([tx({ id: 'orphan', amount: 4321, note: '還卡費', linkedDebtId: 'deleted-debt' })], [DEBT]);

    const issue = report.issues.find(i => i.kind === 'orphan_link');
    expect(issue).toBeDefined();
    expect(issue?.id).toBe('orphan');
    expect(issue?.detail).not.toContain('4321');
    expect(issue?.detail).not.toContain('4,321');
    expect(issue?.detail).not.toContain('還卡費');
    // reads as informational: deleting a debt is a normal user action
    expect(issue?.detail).toContain('正常');
  });

  it('detects an orphan linkedGoalId', () => {
    const report = check([tx({ id: 'orphan-goal', linkedGoalId: 'deleted-goal' })], [], [GOAL]);
    expect(report.issues.some(i => i.kind === 'orphan_link' && i.id === 'orphan-goal')).toBe(true);
  });

  it('does not flag links that still resolve', () => {
    const report = check([tx({ id: 'linked', linkedDebtId: DEBT.id, linkedGoalId: GOAL.id })], [DEBT], [GOAL]);
    expect(report.issues).toEqual([]);
  });

  it('reports every problem on one record', () => {
    const report = check([
      tx({
        id: 'broken',
        type: 'transfer' as unknown as Transaction['type'],
        amount: -1,
        category: '',
        date: 'nope',
        linkedDebtId: 'gone',
      }),
    ]);
    expect(report.issues.map(i => i.kind).sort()).toEqual([
      'invalid_amount',
      'invalid_date',
      'missing_type',
      'orphan_link',
      'unknown_category',
    ]);
  });

  it('locates a record that has no usable id', () => {
    const report = check([tx({ id: 'ok-1' }), tx({ id: '', amount: 0 })]);
    const issue = report.issues.find(i => i.kind === 'invalid_amount');
    expect(issue?.id).toBeUndefined();
    expect(issue?.detail).toContain('第 2 筆');
  });

  it('does not modify the input arrays', () => {
    const transactions = [
      tx({ id: 'dup' }),
      tx({ id: 'dup' }),
      tx({ id: 'bad', amount: -5, date: 'yesterday', linkedDebtId: 'gone' }),
    ];
    const debts = [DEBT];
    const goals = [GOAL];
    const snapshot = structuredClone({ transactions, debts, goals });

    checkIntegrity({ transactions, debts, goals });

    expect({ transactions, debts, goals }).toEqual(snapshot);
    expect(transactions).toHaveLength(3);
  });
});

describe('runIntegrityCheck / loadIntegrityReport', () => {
  it('persists the report and reads it back', () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.transactions]: JSON.stringify([tx({ id: 'a' }), tx({ id: 'a' })]),
      [STORAGE_KEYS.debts]: JSON.stringify([DEBT]),
      [STORAGE_KEYS.goals]: JSON.stringify([GOAL]),
    });

    const report = runIntegrityCheck(storage);

    expect(report.ok).toBe(false);
    expect(report.transactionCount).toBe(2);
    expect(storage.getItem(STORAGE_KEYS.integrityReport)).not.toBeNull();

    const loaded = loadIntegrityReport(storage);
    expect(loaded).toEqual(report);
  });

  it('never touches the ledger it inspects', () => {
    const transactions = JSON.stringify([tx({ id: 'a', amount: -5, linkedDebtId: 'gone' })]);
    const storage = createMemoryStorage({
      [STORAGE_KEYS.transactions]: transactions,
      [STORAGE_KEYS.debts]: '[]',
      [STORAGE_KEYS.goals]: '[]',
    });

    const report = runIntegrityCheck(storage);

    expect(report.ok).toBe(false);
    expect(storage.getItem(STORAGE_KEYS.transactions)).toBe(transactions);
    expect(storage.getItem(STORAGE_KEYS.debts)).toBe('[]');
    expect(storage.getItem(STORAGE_KEYS.goals)).toBe('[]');
  });

  it('reports ok on a fresh install', () => {
    const storage = createMemoryStorage();
    const report = runIntegrityCheck(storage);
    expect(report.ok).toBe(true);
    expect(report.transactionCount).toBe(0);
    expect(loadIntegrityReport(storage)?.ok).toBe(true);
  });

  it('returns null when no report was ever stored', () => {
    expect(loadIntegrityReport(createMemoryStorage())).toBeNull();
  });

  it('returns null when the stored report is unreadable', () => {
    const broken = createMemoryStorage({ [STORAGE_KEYS.integrityReport]: '{not json[' });
    expect(loadIntegrityReport(broken)).toBeNull();

    const wrongShape = createMemoryStorage({ [STORAGE_KEYS.integrityReport]: '[1,2,3]' });
    expect(loadIntegrityReport(wrongShape)).toBeNull();
  });
});

describe('integrity check performance', () => {
  it('handles 5000 transactions well under a second', () => {
    const transactions: Transaction[] = [];
    for (let i = 0; i < 5000; i += 1) {
      transactions.push(
        tx({
          id: `perf-${i}`,
          amount: (i % 900) + 20,
          date: `2026-0${(i % 9) + 1}-1${i % 9}`,
          ...(i % 100 === 0 ? { linkedDebtId: DEBT.id } : {}),
        }),
      );
    }

    const start = performance.now();
    const report = checkIntegrity({ transactions, debts: [DEBT], goals: [GOAL] });
    const elapsed = performance.now() - start;

    expect(report.transactionCount).toBe(5000);
    expect(report.ok).toBe(true);
    // single O(n) sweep; anything near 250ms would signal an O(n^2) regression
    expect(elapsed).toBeLessThan(250);
  });
});
