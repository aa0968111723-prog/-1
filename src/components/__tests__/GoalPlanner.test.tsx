import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import GoalPlanner from '../GoalPlanner';
import { Goal } from '../../types';

/*
 * The goal balance must have exactly one writer.
 *
 * This component used to adjust currentAmount by hand AND record a linked
 * transaction whose effect adjusted it again, so a NT$3,000 deposit moved the
 * goal by NT$6,000. The repository tests cover the engine's half; this covers
 * the half that made it double, which no unit test of the engine can see.
 */

const goal: Goal = {
  id: 'g1',
  name: '旅遊基金',
  targetAmount: 50000,
  currentAmount: 10000,
  targetDate: '2027-01-01',
};

function setup() {
  const onUpdate = vi.fn();
  const onAddTransaction = vi.fn();
  render(
    <GoalPlanner
      goals={[goal]}
      debts={[]}
      transactions={[]}
      monthlyIncome={50000}
      budgets={{}}
      onAdd={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={onUpdate}
      onAddTransaction={onAddTransaction}
    />,
  );
  // The deposit/withdraw controls live inside the expanded goal card.
  fireEvent.click(screen.getByText('旅遊基金'));
  return { onUpdate, onAddTransaction };
}

afterEach(cleanup);

describe('moving money in and out of a goal', () => {
  it('records a deposit once and does not also move the balance itself', () => {
    const { onUpdate, onAddTransaction } = setup();

    fireEvent.change(screen.getByPlaceholderText('輸入金額...'), { target: { value: '3000' } });
    fireEvent.click(screen.getByText('存入'));

    expect(onAddTransaction).toHaveBeenCalledTimes(1);
    const tx = onAddTransaction.mock.calls[0][0];
    expect(tx.amount).toBe(3000);
    expect(tx.type).toBe('expense'); // wallet -> goal
    expect(tx.linkedGoalId).toBe('g1');

    // The linked effect owns the balance. A currentAmount write here is the
    // second half of the double-count.
    const balanceWrites = onUpdate.mock.calls.filter(
      ([, updates]) => (updates as Partial<Goal>).currentAmount !== undefined,
    );
    expect(balanceWrites).toEqual([]);
  });

  it('records a withdrawal as income, so the engine debits the goal', () => {
    const { onUpdate, onAddTransaction } = setup();

    fireEvent.change(screen.getByPlaceholderText('輸入金額...'), { target: { value: '3000' } });
    fireEvent.click(screen.getByText('提領'));

    expect(onAddTransaction).toHaveBeenCalledTimes(1);
    expect(onAddTransaction.mock.calls[0][0].type).toBe('income'); // goal -> wallet

    const balanceWrites = onUpdate.mock.calls.filter(
      ([, updates]) => (updates as Partial<Goal>).currentAmount !== undefined,
    );
    expect(balanceWrites).toEqual([]);
  });

  it('ignores an empty or unparseable amount', () => {
    const { onUpdate, onAddTransaction } = setup();

    fireEvent.click(screen.getByText('存入'));
    fireEvent.change(screen.getByPlaceholderText('輸入金額...'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('存入'));

    expect(onAddTransaction).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
