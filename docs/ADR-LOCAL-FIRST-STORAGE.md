# ADR: Local-first storage for FinTracker

- 狀態：Accepted
- 日期：2026-08-20
- 取代：`docs/ADR-001-canonical-storage.md`（該決策在只有 Web + 桌寵、沒有雲端的前提下是對的；前提變了）

## 背景

上一版的結論是「Web localStorage 當 canonical + 原生 durable outbox」，理由是
React 的讀取路徑全是同步的，改動風險大於收益。那個判斷在當時成立。

現在有兩件事變了：

1. **要加雲端同步。** 每一列需要 `updated_at`、`deleted_at`、`sync_state` 這類
   逐列 metadata，而且要能用 cursor 增量拉取。
2. **要求 10,000 / 50,000 筆的效能驗證**（需求 §72）。

第 2 點直接推翻了 localStorage。粗估一筆交易序列化後約 200–250 bytes，
50,000 筆就是 10–12 MB，而 localStorage 的配額普遍是 5 MB 左右。超過時
`setItem` 丟 `QuotaExceededError` —— 那不是「變慢」，那是**寫入失敗、資料遺失**，
正好踩到優先順序的第一條。所以這一次不是為了架構美感重構，是原本的容器裝不下。

## 選項

### A. 維持 localStorage canonical + 原生 outbox

- ✅ 零遷移風險，現有 252 條測試不用動
- ✅ 同步讀取，React 資料流不變
- ❌ **5 MB 天花板 = 資料遺失**，無法滿足 §72
- ❌ 整包字串讀寫，每次存檔都要序列化整個 array

### B. Android SQLite / Room 當 canonical，Web 走 bridge

- ✅ Android 端最強：交易式寫入、索引、大資料集無壓力
- ✅ 原生 Quick Add 可以直接寫 canonical store，不需要 outbox
- ❌ **Web 就沒有 canonical store 了**。瀏覽器版是這個產品的一半，不能只靠
  「連到手機」才有帳本
- ❌ 需要 Capacitor SQLite plugin：本機環境編譯不了 Android（proxy 擋
  dl.google.com），每次迭代都要等 CI，而且要維護 web / native 兩套資料存取
- ❌ 遷移風險最高

### C. IndexedDB 當 app 端 canonical，兩個平台同一套實作

- ✅ **瀏覽器和 Android WebView 是同一個 API**，一套實作兩邊都跑
- ✅ 配額是幾百 MB 起跳，50,000 筆不是問題
- ✅ 逐列存取 + 索引，正好是 sync cursor 需要的形狀
- ✅ 不需要新的原生 plugin，不增加 Android 編譯風險
- ❌ 非同步 API，而現有 React 讀取路徑全是同步的
- ❌ 原生 Kotlin 桌寵**碰不到 IndexedDB**（它在 WebView 之外的 foreground
  service 裡跑），所以原生 outbox 必須保留

## 決策

**選 C，但用一個同步的記憶體快取包起來。**

```
Kotlin FloatingPetService ──> SharedPreferences outbox ──┐
                                （維持不變，已強化過）      │
                                                          ▼
React ──> FinanceRepository ──> FinanceStore ──> IndexedDB（canonical）
             （同步 API 不變）      │
                                   └─ localStorage（僅遷移來源 / 後備）
```

關鍵在於 `FinanceStore` 的形狀：

```ts
await store.init();        // 唯一的非同步點，開機時呼叫一次
store.read<T>(key, fb);    // 同步，從記憶體快取讀
store.write(key, value);   // 同步更新快取，非同步落盤
```

這樣一來：

- `FinanceRepository` 的**公開 API 一個字都不用改**，既有元件與測試全部照舊
- 只有 `main.tsx` 開機時多一個 `await`
- 真正的持久層換成 IndexedDB，天花板消失

### 為什麼不直接讓 Repository 變 async

因為那會同時改掉八個主要元件的資料流，而這些元件上一輪才剛穩定下來。
同步 API + 開機載入一次，是「換掉地基但不動房子」的做法。

### 誠實記下這個做法的代價

`write()` 是「同步更新快取、非同步落盤」，所以理論上存在一個視窗：寫入已經反映
在 UI 上，但 IndexedDB 交易還沒 commit，此時行程被砍掉就會丟掉那一筆。

緩解，以及為什麼可以接受：

1. 落盤走**序列化佇列**，不會有交錯寫入互相覆蓋
2. `visibilitychange` / `pagehide` 時主動 flush
3. 這個視窗是毫秒級，而且**桌寵那條路徑完全不受影響** —— 原生 Quick Add 寫的是
   Kotlin 端的 SharedPreferences outbox，那是同步 commit + 讀回驗證的，
   「小財記的帳」的durability 不依賴這裡
4. 相較之下，localStorage 在超過配額時是**必然**失敗，不是機率視窗

換句話說：這個改動把「資料量一大就一定壞」換成「行程在毫秒視窗內被砍才可能掉一筆」。

### localStorage 不會被刪掉

遷移把資料**複製**進 IndexedDB，`finance_*` 原鍵**原封不動留著**。
遷移後如果 IndexedDB 讀不到（瀏覽器清資料、私密模式、IDB 被停用），
自動退回 localStorage 後備路徑。舊資料是安全網，不是要清掉的垃圾。

## 後果

- 需要 `FinanceStore` 抽象與 IndexedDB 後端，加上 localStorage 後備
- 需要一次性遷移：偵測 legacy → 複製 → 驗證筆數 → 標記完成
- 每一列要加 sync metadata（`updatedAt` / `deletedAt` / `syncState`）
- 刪除從「陣列移除」改成 tombstone，否則刪除無法同步（見 §15）
- 原生 outbox 維持不變，`drainOutbox` 的 persist → verify → ack 順序照舊

## 什麼情況下要重新評估

1. 單一使用者資料量超過 IndexedDB 也吃不下的規模（不太可能，個人財務）
2. 需要在原生層做複雜查詢（目前原生只寫入，不查詢）
3. Web 端出現必須在 worker 中做大量聚合的需求
4. 出現一個穩定、支援 Capacitor 8 的 SQLite plugin，且 web 端有等價實作
