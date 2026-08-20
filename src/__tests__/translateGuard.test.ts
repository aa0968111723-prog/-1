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

/*
 * Startup wiring that is easy to delete and expensive to miss.
 *
 * A module can export a perfectly correct init() that nothing calls; that is
 * exactly how authController.init() sat unused while the account panel would
 * have hung on its loading state. A static check is cheap and catches the
 * regression that unit tests structurally cannot: unit tests exercise the
 * function, not the fact that the app invokes it.
 */
/**
 * Comments stripped before matching.
 *
 * The first version of this guard passed with the call deleted, because the
 * explanatory comment directly above it still contained the words
 * `authController.init()`. A gate that matches its own documentation is not a
 * gate — verified by deleting the call and watching it go red.
 */
function codeOf(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const mainTsx = codeOf('src/main.tsx');

describe('main.tsx startup wiring', () => {
  it('restores the auth session on launch', () => {
    expect(mainTsx).toMatch(/authController\s*\.\s*init\s*\(/);
  });

  it('warms the local store before mounting', () => {
    expect(mainTsx).toMatch(/financeStore\s*[\s\S]{0,20}\.init\s*\(/);
  });

  it('still runs the storage migration before anything reads finance data', () => {
    expect(mainTsx).toContain('runStorageMigration()');
  });
});

/*
 * Sync used to be constructed and driven inside AccountPanel, so it ran only
 * while that settings screen was mounted — a screen that now sits behind the
 * 小財 tab's 進階設定 in a lazy chunk. These assert the wiring stayed where it
 * belongs.
 */
const appTsx = codeOf('src/App.tsx');
const accountPanel = codeOf('src/components/AccountPanel.tsx');

describe('sync is driven by the app, not by a settings panel', () => {
  it('App subscribes to the sync engine and refreshes the ledger', () => {
    expect(appTsx).toMatch(/financeSync\s*\.\s*subscribe\s*\(/);
    expect(appTsx).toContain('syncFromRepository()');
  });

  it('App owns the sync triggers', () => {
    expect(appTsx).toContain('visibilitychange');
    expect(appTsx).toMatch(/financeSync\s*\.\s*sync\s*\(/);
  });

  it('AccountPanel no longer constructs its own engine', () => {
    expect(accountPanel).not.toMatch(/new\s+FinanceSyncEngine/);
  });
});
