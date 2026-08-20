import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 這一組測試守的是那個 Android 崩潰的**真正原因**。
 *
 * `Failed to execute 'removeChild' on 'Node': The node to be removed is not a
 * child of this node` 只出現在手機、而且只出現在這個全中文的介面上，因為
 * index.html 宣告 `lang="en"`：Chrome 於是判定這是一頁需要翻譯的外文網頁，
 * Google 翻譯把 React 管理的文字節點換成 `<font>` 包起來的節點，React 下一次
 * 要移除原本那個節點時就找不到它了。
 *
 * 修法是不要讓 DOM 被改，而不是把錯誤吞掉。所以這些標記一旦有人拿掉，
 * 崩潰就會回來 —— 用測試把它們釘住。
 */
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('index.html translate guard', () => {
  it('declares the page as Traditional Chinese', () => {
    expect(html).toMatch(/<html[^>]*\blang="zh-Hant-TW"/);
    expect(html).not.toMatch(/<html[^>]*\blang="en"/);
  });

  it('opts the document out of translation', () => {
    expect(html).toMatch(/<html[^>]*\btranslate="no"/);
    expect(html).toMatch(/<meta\s+name="google"\s+content="notranslate"\s*\/?>/);
  });

  it('marks the React root notranslate', () => {
    // 這是最後一道：就算使用者手動按下翻譯，React 掛載的子樹也不會被改寫。
    expect(html).toMatch(/<div\s+id="root"[^>]*class="[^"]*\bnotranslate\b/);
  });

  it('keeps viewport-fit=cover so the bottom nav clears the gesture bar', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
});
