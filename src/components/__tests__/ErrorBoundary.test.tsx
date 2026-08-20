import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

const BOOM = '面板炸了';

// 模組層旗標：讓同一個子元件第一次 render 丟錯、之後恢復正常，藉此測試「回到上一頁」。
let shouldThrow = true;

function Boom() {
  if (shouldThrow) throw new Error(BOOM);
  return <p>帳本內容</p>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  shouldThrow = true;
  localStorage.clear();
  // React 會把 boundary 攔下的錯誤再印一次，這裡靜音預期中的噪音。
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('帳本內容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('這個畫面出了點狀況')).toBeTruthy();
    expect(screen.queryByText('帳本內容')).toBeNull();
    expect(screen.getByText('重新載入')).toBeTruthy();
    expect(screen.getByText('回到上一頁')).toBeTruthy();
  });

  it('uses fallbackTitle when provided', () => {
    render(
      <ErrorBoundary fallbackTitle="負債面板出了點狀況">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('負債面板出了點狀況')).toBeTruthy();
  });

  it('shows the error message text in the fallback', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(BOOM)).toBeTruthy();
  });

  it('logs the failure with a stable tag', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const tagged = consoleErrorSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === '[FinTracker.ErrorBoundary]',
    );
    expect(tagged.length).toBe(1);
    expect((tagged[0][1] as Error).message).toBe(BOOM);
  });

  it('clicking 回到上一頁 clears the error state and re-renders children', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('回到上一頁'));

    expect(screen.getByText('帳本內容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves localStorage untouched when a child throws and when recovering', () => {
    localStorage.setItem('finance_transactions', '[{"id":"t1","amount":120}]');
    localStorage.setItem('finance_monthly_income', '48000');

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(localStorage.getItem('finance_transactions')).toBe('[{"id":"t1","amount":120}]');
    expect(localStorage.getItem('finance_monthly_income')).toBe('48000');
    expect(localStorage.length).toBe(2);

    shouldThrow = false;
    fireEvent.click(screen.getByText('回到上一頁'));

    expect(localStorage.getItem('finance_transactions')).toBe('[{"id":"t1","amount":120}]');
    expect(localStorage.getItem('finance_monthly_income')).toBe('48000');
    expect(localStorage.length).toBe(2);
  });
});
