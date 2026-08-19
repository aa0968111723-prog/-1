import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import QuickTransactionForm from '../QuickTransactionForm';
import { toLocalDateString } from '../../lib/financeRepository';

afterEach(cleanup);

describe('QuickTransactionForm', () => {
  it('records an expense via amount + chip + 記下來 (the 2-3 action flow)', () => {
    const onAdd = vi.fn();
    render(
      <QuickTransactionForm transactions={[]} fastMode={false} onAddTransaction={onAdd} />,
    );

    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('餐飲'));
    fireEvent.click(screen.getByText('記下來'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const tx = onAdd.mock.calls[0][0];
    expect(tx.type).toBe('expense');
    expect(tx.amount).toBe(120);
    expect(tx.category).toBe('餐飲美食');
    expect(tx.date).toBe(toLocalDateString(new Date()));
  });

  it('fast mode: tapping a chip submits immediately without 記下來', () => {
    const onAdd = vi.fn();
    const onSaved = vi.fn();
    render(
      <QuickTransactionForm transactions={[]} fastMode={true} onAddTransaction={onAdd} onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '55' } });
    fireEvent.click(screen.getByText('交通'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].category).toBe('交通出行');
    expect(onSaved).toHaveBeenCalled();
  });

  it('does not submit without an amount', () => {
    const onAdd = vi.fn();
    render(
      <QuickTransactionForm transactions={[]} fastMode={false} onAddTransaction={onAdd} />,
    );
    fireEvent.click(screen.getByText('餐飲'));
    fireEvent.click(screen.getByText('記下來'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('parses natural language 午餐120 and submits directly at high confidence', () => {
    const onAdd = vi.fn();
    render(
      <QuickTransactionForm transactions={[]} fastMode={false} onAddTransaction={onAdd} />,
    );
    fireEvent.change(screen.getByLabelText('自然語言記帳'), { target: { value: '午餐120' } });
    fireEvent.click(screen.getByText('解析'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const tx = onAdd.mock.calls[0][0];
    expect(tx.amount).toBe(120);
    expect(tx.category).toBe('餐飲美食');
  });

  it('switches to income and uses income categories', () => {
    const onAdd = vi.fn();
    render(
      <QuickTransactionForm transactions={[]} fastMode={false} onAddTransaction={onAdd} />,
    );
    fireEvent.click(screen.getByText('收入'));
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('獎金'));
    fireEvent.click(screen.getByText('記下來'));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ type: 'income', category: '零星獎金' });
  });
});
