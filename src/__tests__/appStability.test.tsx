import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import App from '../App';

/**
 * 這一檔測的是「畫面會不會炸」，不是財務邏輯。
 *
 * 使用者回報的崩潰是 `Failed to execute 'removeChild' on 'Node'`，發生在切分頁、
 * 開關 Modal、提示訊息出現又消失這些最平常的操作上。真正的成因（瀏覽器翻譯改寫
 * DOM）由 translateGuard.test.ts 守住；這裡守的是操作本身：反覆做這些動作不能留下
 * 錯誤畫面，而且就算某一頁真的壞了，底部導覽也必須還在。
 */

function stubMatchMedia(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query.includes('639'),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
}

/** 錯誤邊界的 fallback 有 role="alert"；任何一次操作後都不該出現。 */
function expectNoErrorCard() {
  expect(screen.queryByRole('alert')).toBeNull();
}

function bottomNav() {
  return screen.getByRole('navigation', { name: '主要導覽' });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia(true);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.useRealTimers();
  cleanup();
});

describe('mobile shell', () => {
  it('opens on 首頁 with exactly four tabs', async () => {
    render(<App />);

    const nav = bottomNav();
    const labels = within(nav)
      .getAllByRole('button')
      .map(b => b.textContent?.trim());
    expect(labels).toEqual(['🏠首頁', '🧾明細', '小財', '更多']);

    expect(await screen.findByText('＋ 快速記帳')).toBeTruthy();
    expect(screen.getByText('今日支出')).toBeTruthy();
    expectNoErrorCard();
  });

  it('keeps the bottom nav outside <main>, so a page crash cannot take it down', () => {
    render(<App />);

    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    // 每頁自己的 ErrorBoundary 在 <main> 裡面；導覽在外面。順序反過來的話，
    // 一頁壞掉就會變成整個畫面只剩一張錯誤卡片，使用者連切走都做不到。
    expect(main!.contains(bottomNav())).toBe(false);
  });

  it('survives 20 rounds of switching every tab', async () => {
    render(<App />);

    for (let round = 0; round < 20; round++) {
      for (const label of ['明細', '小財', '更多', '首頁']) {
        fireEvent.click(within(bottomNav()).getByText(label));
        // lazy 分頁：等 Suspense 解開再繼續，否則測的只是 fallback。
        await act(async () => {});
        expectNoErrorCard();
      }
    }

    expect(await screen.findByText('今日支出')).toBeTruthy();
  });

  it('survives 20 rounds of opening and closing the quick-add modal', async () => {
    render(<App />);

    for (let round = 0; round < 20; round++) {
      fireEvent.click(await screen.findByText('＋ 快速記帳'));
      expect(screen.getByLabelText('金額')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('關閉'));
      await act(async () => {});
      expect(screen.queryByLabelText('金額')).toBeNull();
      expectNoErrorCard();
    }
  });

  it('mounts and unmounts the undo toast without desyncing the tree', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App />);

    fireEvent.click(await screen.findByText('＋ 快速記帳'));
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('餐飲'));
    fireEvent.click(screen.getByText('記下來'));

    // 提示出現：這是最常見的「掛上去又拿掉」節點。
    expect(screen.getByText('復原')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText('復原')).toBeNull();
    expectNoErrorCard();
    // 記帳本身沒有因為 UI 動作被影響。
    expect(JSON.parse(localStorage.getItem('finance_transactions') ?? '[]')).toHaveLength(1);
  });

  it('does the same under StrictMode double-invocation', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    for (const label of ['明細', '小財', '更多', '首頁']) {
      fireEvent.click(within(bottomNav()).getByText(label));
      await act(async () => {});
      expectNoErrorCard();
    }

    fireEvent.click(await screen.findByText('＋ 快速記帳'));
    fireEvent.click(screen.getByLabelText('關閉'));
    await act(async () => {});
    expectNoErrorCard();
  });
});

describe('external DOM mutation (what Google Translate does)', () => {
  /**
   * 忠實重現翻譯擴充功能的行為：把每個文字節點換成一個 `<font>` 元素。
   * React 的 fiber 還記著原本那個 text node，下一次要移除它時就會找不到。
   */
  function translateLikeMutation(root: ParentNode) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);

    let replaced = 0;
    for (const node of texts) {
      if (!node.textContent?.trim() || !node.parentNode) continue;
      const font = document.createElement('font');
      font.setAttribute('style', 'vertical-align: inherit;');
      font.textContent = node.textContent;
      node.parentNode.replaceChild(font, node);
      replaced++;
    }
    return replaced;
  }

  it('never leaves a blank screen: either it survives, or the desync card explains it', async () => {
    const { container } = render(<App />);
    await screen.findByText('＋ 快速記帳');

    const replaced = translateLikeMutation(container);
    expect(replaced).toBeGreaterThan(0);

    // 換分頁 = 大量節點移除，正是崩潰會發生的時機。
    fireEvent.click(within(bottomNav()).getByText('明細'));
    await act(async () => {});
    fireEvent.click(within(bottomNav()).getByText('首頁'));
    await act(async () => {});

    // 白畫面是唯一不能接受的結果。
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);

    const alert = screen.queryByRole('alert');
    if (alert) {
      // 有炸的話，訊息必須是講真話的那一句，而且要留一條路出去。
      expect(within(alert).getByText('畫面需要重新同步')).toBeTruthy();
      expect(within(alert).getByText('回上一頁')).toBeTruthy();
      // 導覽在 <main> 外面，所以還在。
      expect(bottomNav()).toBeTruthy();
    }
  });
});
