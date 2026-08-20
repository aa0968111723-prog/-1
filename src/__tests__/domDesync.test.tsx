import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

/**
 * 這一檔是那個 Android 崩潰的**可執行證據**，不是描述。
 *
 * 手機 Chrome 的網頁翻譯會把 React 管理的文字節點換成 `<font>` 包起來的節點。
 * React 的 fiber 還記著原本那個 text node，下一次要移除它時就丟
 * `NotFoundError: The node to be removed is not a child of this node.` ——
 * 也就是使用者看到的 `Failed to execute 'removeChild' on 'Node'`。
 *
 * 底下第一個測試重現它；第二個測試說明為什麼 TransactionList 把兩個相鄰的
 * 裸文字節點各自包進 `<span>`：包起來之後，同樣的外部改寫不再讓 React 掉節點。
 */

/** 忠實重現翻譯工具的動作：每個文字節點都換成一個帶樣式的 `<font>`。 */
function translateLikeMutation(root: ParentNode): number {
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

/** 相鄰的裸文字節點 —— 修好之前 TransactionList 的金額就長這樣：{符號}{金額}。 */
function BareAdjacentText() {
  const [show, setShow] = useState(true);
  return (
    <div>
      <button onClick={() => setShow(s => !s)}>切換</button>
      <p>{show ? <>{'-'}{'1,200'}</> : null}</p>
    </div>
  );
}

/** 同樣的內容，但兩段文字各自有自己的元素包著。 */
function WrappedAdjacentText() {
  const [show, setShow] = useState(true);
  return (
    <div>
      <button onClick={() => setShow(s => !s)}>切換</button>
      <p>
        {show ? (
          <>
            <span>{'-'}</span>
            <span>{'1,200'}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

let caught: Error[] = [];

function captureBoundaryErrors() {
  caught = [];
  return vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] === '[FinTracker.ErrorBoundary]') caught.push(args[1] as Error);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('external DOM mutation', () => {
  it('breaks React when adjacent text nodes are left bare, and the boundary names it correctly', async () => {
    captureBoundaryErrors();

    const { container } = render(
      <ErrorBoundary>
        <BareAdjacentText />
      </ErrorBoundary>,
    );
    expect(translateLikeMutation(container)).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('切換'));
    await act(async () => {});

    // 這就是使用者手機上那一行錯誤。
    expect(caught.length).toBeGreaterThan(0);
    expect(caught[0].name).toBe('NotFoundError');
    expect(caught[0].message).toMatch(/not a child of this node/);

    // 而且畫面沒有變成白的：邊界把它接住，並且說的是實話。
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('畫面需要重新同步')).toBeTruthy();
    expect(screen.getByText('回上一頁')).toBeTruthy();
  });

  it('survives the same mutation when each text node has its own element', async () => {
    captureBoundaryErrors();

    const { container } = render(
      <ErrorBoundary>
        <WrappedAdjacentText />
      </ErrorBoundary>,
    );
    expect(translateLikeMutation(container)).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('切換'));
    await act(async () => {});

    expect(caught).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
