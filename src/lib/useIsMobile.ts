import { useEffect, useState } from 'react';

/** Tailwind 的 `sm` 斷點：640px 以下算手機。 */
export const MOBILE_QUERY = '(max-width: 639px)';

function matches(query: string): boolean {
  // jsdom（測試）與非瀏覽器環境沒有 matchMedia；當作桌機處理，不要在這裡炸掉。
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * 手機版與桌機版要渲染不同的樹，而不是用 CSS 兩棵都掛上去再藏一棵。
 *
 * 差別是真的：首頁在手機上要 3 秒看完，藏起來的 Dashboard 一樣會建圖表、跑
 * recharts 的量測。用 matchMedia 只掛一棵。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => matches(MOBILE_QUERY));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // 轉螢幕方向或桌機縮視窗都會觸發；初值再取一次，避免掛載前後不一致。
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
