import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

const BOOM = '面板炸了';

// 模組層旗標：讓同一個子元件第一次 render 丟錯、之後恢復正常，藉此測試「回上一頁」。
let shouldThrow = true;
let thrown: Error = new Error(BOOM);

function Boom() {
  if (shouldThrow) throw thrown;
  return <p>帳本內容</p>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

/** jsdom 的 location.reload 不能被 spyOn（不可重新定義），只能整顆換掉。 */
function stubReload() {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, href: window.location.href, reload });
  return reload;
}

beforeEach(() => {
  shouldThrow = true;
  thrown = new Error(BOOM);
  localStorage.clear();
  // React 會把 boundary 攔下的錯誤再印一次，這裡靜音預期中的噪音。
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    expect(screen.getByText('回上一頁')).toBeTruthy();
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

  it('clicking 回上一頁 really calls history.back(), not just setState', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('回上一頁'));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByText('帳本內容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('回上一頁 falls back to reload when there is no previous page', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const reload = stubReload();

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('回上一頁'));

    // 沒有上一頁時按鈕不能是啞的：要嘛回上一頁，要嘛重新載入，不能兩者都沒發生。
    expect(back).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clicking 重新載入 reloads the page', () => {
    const reload = stubReload();

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('重新載入'));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe('DOM desync (外部改動 DOM，例如手機瀏覽器的網頁翻譯)', () => {
    const DESYNC_MESSAGES = [
      "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
    ];

    for (const message of DESYNC_MESSAGES) {
      it(`shows 畫面需要重新同步 for: ${message.slice(18, 40)}…`, () => {
        thrown = new Error(message);

        render(
          <ErrorBoundary>
            <Boom />
          </ErrorBoundary>,
        );

        expect(screen.getByText('畫面需要重新同步')).toBeTruthy();
        expect(screen.getByText('重新載入')).toBeTruthy();
        expect(screen.getByText('回上一頁')).toBeTruthy();
      });
    }

    it('treats a NotFoundError DOMException as desync', () => {
      const e = new Error('The node to be removed is not a child of this node.');
      e.name = 'NotFoundError';
      thrown = e;

      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      expect(screen.getByText('畫面需要重新同步')).toBeTruthy();
    });

    it('desync wording overrides a caller-supplied fallbackTitle', () => {
      thrown = new Error(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      );

      render(
        <ErrorBoundary fallbackTitle="負債面板出了點狀況">
          <Boom />
        </ErrorBoundary>,
      );

      // 這一類錯誤跟哪個面板無關，是整棵 DOM 對不上，所以要講真正發生的事。
      expect(screen.getByText('畫面需要重新同步')).toBeTruthy();
      expect(screen.queryByText('負債面板出了點狀況')).toBeNull();
    });

    it('an ordinary error is NOT reported as desync', () => {
      thrown = new Error('Cannot read properties of undefined (reading amount)');

      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      expect(screen.queryByText('畫面需要重新同步')).toBeNull();
      expect(screen.getByText('這個畫面出了點狀況')).toBeTruthy();
    });
  });

  it('leaves localStorage untouched when a child throws and when recovering', () => {
    localStorage.setItem('finance_transactions', '[{"id":"t1","amount":120}]');
    localStorage.setItem('finance_monthly_income', '48000');
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    vi.spyOn(window.history, 'back').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(localStorage.getItem('finance_transactions')).toBe('[{"id":"t1","amount":120}]');
    expect(localStorage.getItem('finance_monthly_income')).toBe('48000');
    expect(localStorage.length).toBe(2);

    shouldThrow = false;
    fireEvent.click(screen.getByText('回上一頁'));

    expect(localStorage.getItem('finance_transactions')).toBe('[{"id":"t1","amount":120}]');
    expect(localStorage.getItem('finance_monthly_income')).toBe('48000');
    expect(localStorage.length).toBe(2);
  });
});
