# 雲端同步架構

## 一句話

**本機先存成功 > 資料不遺失 > 跨裝置同步。** 同步失敗永遠不等於記帳失敗。

## 資料流

```
Kotlin FloatingPetService ──> SharedPreferences outbox ──┐
     （WebView 之外，同步 commit + 讀回驗證）              │
                                                         ▼
React ──> FinanceRepository ──> FinanceStore ──> IndexedDB（本機 canonical）
                │                                        │
                │                              FinanceSyncEngine
                │                                        │
                └──────────────> Analytics               ▼
                                                   Supabase Postgres
                                                   （跨裝置共享層）
```

雲端是**共享層**，不是權威來源。斷網時本機就是完整的帳本。

## 一個同步循環

```
pull（updated_at > cursor 的列）
   → merge（依 id，client edit time 決勝）
   → 寫入本機
   → push（雲端沒有或比較舊的列）
   → 最後才推進 cursor
```

順序不是隨便排的：

- **先寫本機再 push**：反過來會出現「雲端已收下、本機卻沒存到」的視窗。
- **cursor 最後推進**：中途崩潰只會重拉同一個區間，而重拉會被 id-based merge
  吸收。先推進 cursor 則會永久跳過那些列。
- **cursor 取自回傳資料裡的 server `updated_at`**，不是裝置時鐘。裝置時鐘不準
  只會影響它自己，不會讓某些列對其他裝置隱形。

## 衝突處理

`src/lib/cloud/merge.ts` 是純函式，沒有網路、沒有儲存、沒有自己的時鐘。

| 情況 | 結果 |
|---|---|
| 只有本機有 | 保留，並排入 push |
| 只有雲端有 | 採用 |
| 兩邊都有、版本相同 | 不動 |
| 兩邊都改過 | **client edit time 較新者勝** |
| 時間完全相同 | 依 `deviceId` → `id` 決定，兩台裝置會得到同一個答案 |

為什麼比較的是 client edit time 而不是 server write time：離線在 09:00 改、
18:00 才推上去的那一筆，不應該贏過線上 17:00 的修改。這就是 schema 同時存
`updated_at`（伺服器寫、當 cursor）和 `client_updated_at`（裝置寫、決勝）的原因。

**刪除一律 tombstone。** 硬刪在另一台裝置看起來和「還沒同步到」完全一樣，
結果就是刪掉的帳自己長回來。

**刪除不會自動蓋過較新的編輯。** 「delete always wins」會讓舊裝置的誤刪
在新裝置上無法挽回。

## Guest → 登入

最危險的情境，也是設計的主要理由：

```
手機 200 筆本機帳 + 帳號 100 筆雲端帳 → 300 筆，兩邊都不消失
```

`merge.test.ts` 直接測這一條。200 筆純本機的列必須被 push 上去，否則帳號會
安靜地少掉 200 筆。

## 觸發時機

App 啟動、回到前景、新增交易後、登入成功、使用者手動、網路恢復。
**沒有輪詢。**

## 同步狀態怎麼呈現

平常不講。只有以下三種情況才出現：等待同步筆數、同步失敗（附重試）、衝突。

`sync()` **永遠不會 throw**，只透過 status 回報。這是刻意的：呼叫端可能在存檔
路徑上，絕對不能讓同步問題把一次成功的本機寫入變成使用者眼中的失敗。
