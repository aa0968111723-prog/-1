# ADR-001：帳本權威來源維持在 Web localStorage，Native 只做持久化 outbox

- **狀態**：Accepted
- **日期**：2026-08-19
- **影響範圍**：`src/lib/storage.ts`、`src/lib/financeRepository.ts`、`src/App.tsx` 的 drain 流程、
  `android/.../pet/PendingTransactionQueue.kt`、`PendingTransactionCodec.kt`、`QuickAddActivity.kt`
- **取代**：無

## 背景

小財（Floating Pet）的快速記帳可以在 **WebView 根本不存在** 的情況下發生：使用者把 FinTracker
從 Recent Apps 滑掉之後，前景服務與 overlay 仍然活著，點一下桌寵開的是 `QuickAddActivity`
（一個沒有 WebView 的透明 Activity）。也就是說，Native 端一定需要一個自己能寫、而且斷電也不會消失的地方。

同時，FinTracker 的既有帳本（交易、預算、負債、目標、循環、試算表）全部存在 WebView 的
`localStorage`，key 就是 `finance_*` 那一組，已經有真實使用者資料。

因此問題不是「Native 要不要能寫資料」，而是「**哪一份是權威來源（source of truth）**」。

### 考慮過的選項

| 選項 | 內容 | 主要優點 | 主要代價 |
|---|---|---|---|
| 1. Room / SQLite 單一權威 DB | 兩端都讀寫同一個 SQLite；`localStorage` 廢除或降為快取 | 真正單一資料庫、原子交易、可索引查詢、不需要 hand-off | Web 端所有讀取都要改成非同步；一次性重寫整個資料流 |
| 2. Web 權威 + Native 持久化 outbox（**採用**） | `localStorage` 是帳本；Native 只寫一個待同步佇列，由 Web 匯入 | 改動面小、既有帳本零風險、Native 端邏輯簡單到可以在 JVM 上完整測試 | 桌寵記的帳要等 WebView 下次活著才進帳本；兩個 store 並存 |
| 3. Native 權威 + Web 鏡像 | SQLite 為主，Web 端維持一份唯讀鏡像 | Native 端即時、不需要 hand-off | 同時擁有選項 1 的重寫成本 **和** 選項 2 的雙 store 問題，且鏡像同步方向更難推理 |

## 決策

**維持 Web `localStorage` 作為帳本的唯一權威來源，並把力氣放在強化 Native 端的持久化 outbox。
本次迭代不導入 Room / SQLite。**

## 理由

### 為什麼現在不做 Room

**1. React 端每一條讀取路徑都是同步的。**
現況是元件的 `useState` initialiser 直接讀 `localStorage`（經由 `FinanceRepository`），
渲染時資料就已經在手上。把權威來源換成 SQLite，代表所有讀取都必須穿過 Capacitor bridge 變成
`Promise`，而 bridge 是非同步的、沒有例外。這會一次性逼迫改寫
`Dashboard`、`TransactionList`、`BudgetSettings`、`DebtManager`、`GoalPlanner`、`GoalSandbox`、
`Spreadsheet`、`DebtAdvice` 的資料流——loading 狀態、race condition、初次渲染的空資料閃爍全部要重做。
爆炸半徑正好落在「唯一絕對不能壞的東西」上：帳本。

**2. 本開發環境根本編譯不了 Android。**
proxy 擋掉 `dl.google.com`，Android SDK / AGP 抓不到，所以 `gradlew assembleDebug` 在本機不可能跑。
唯一的編譯器是 GitHub Actions CI，每次回饋以分鐘計。把 Room + KSP annotation processing +
schema migration 放到這種回饋迴圈後面，等於在看不見的地方寫資料庫遷移——那正是掉資料的 bug
最會躲的地方。相對地，目前的 Native outbox 是純邏輯（`PendingTransactionCodec` /
`PendingTransactionQueue` / `PetPositionManager`），可以在 JVM 上直接跑單元測試，不需要 Android SDK。

**3. 誠實地說，這個決策確實有代價。**
以下不是被忽略，而是被接受的缺點：

- `localStorage` 每次寫入都是整個陣列重新序列化（`saveTransactions` 寫全量），是 O(n) 而不是 O(1)。
- `localStorage` 有配額上限，而且 WebView 資料可能被使用者在系統設定「清除資料」時整包清掉，
  也可能在裝置空間不足時被系統回收。目前唯一的防線是 `src/lib/backup.ts` 的 JSON 匯出／匯入，
  這是使用者的責任，不是系統保證——這是本決策最實在的弱點。
- 帳本的「完整狀態」實際上是「`localStorage` ∪ Native outbox」兩個 store 的聯集，
  而不是單一資料庫。要正確推理必須同時看兩邊。

Room 能解掉上面三點。我們仍然選擇不做，是因為**現在**做的風險（一次性重寫帳本讀寫路徑，
而且看不到編譯器）大於它能解掉的問題；不是因為那些問題不存在。

### 真正造成掉單／重複的原因不是儲存引擎，是順序

實務上「桌寵記的帳不見了」或「同一筆記了兩次」，幾乎都不是 SQLite 或 localStorage 的差別造成的，
而是 **持久化（persist）與確認（acknowledge）的先後順序** 寫反了。
換成 Room 而順序仍然錯，照樣掉資料。所以本次迭代把順序當成契約明確固定下來：

#### Native 端寫入（`PendingTransactionQueue.add`）

1. 讀出目前 outbox 內容（payload 損壞時先備份到 `pending_transactions_corrupt_backup` 再重建，
   絕不因為壞資料讓服務起不來）。
2. 以 **`commit()`（同步）而非 `apply()`（非同步）** 寫入 SharedPreferences。
   outbox 的寫入本身就是耐久性保證，不能是「排程稍後寫」。
3. `commit()` 回傳 false 一律視為失敗。
4. **讀回**（read-back）確認該筆 id 真的在 payload 裡。
5. 只有到這裡才允許 UI 顯示「記好啦」與復原列。使用者看到成功，就代表資料已經落地。

#### Web 端匯入（`App.tsx` 的 `drainNativeOutbox`）

1. `FinancePet.getPendingTransactions()` 取出待同步清單。
2. 逐筆呼叫 `financeRepository.addTransaction(tx)` 寫入帳本。
   這一步以 **Native 產生的 stable id 冪等**：id 已存在就回傳既有那筆，什麼都不動。
3. 用 `financeRepository.hasTransaction(tx.id)` **確認真的在儲存體上**，成功才把 id 收進
   `persistedIds`；寫入丟例外的那筆不會進清單。
4. `syncFromRepository()` 把 React state 從儲存體重新鏡像出來（而不是從記憶體推測）。
5. **最後**才 `FinancePet.ackPendingTransactions({ ids: persistedIds })` 把已確認的項目從 outbox 移除。

#### 為什麼這個順序安全

ack 永遠是最後一步，所以任何一個時間點崩潰，最壞的結果都只是「這批項目還留在 outbox，下次重放」，
而重放會被第 2 步的 id 冪等吸收。**任何 crash 只會導致重播，不會導致遺失。**
反過來寫（先 ack 再寫帳本）則會製造一個無法補救的窗口。

## 後果

**正面**

- 既有帳本的讀寫路徑完全沒有動，回歸風險趨近於零。
- Native 端只需要理解一個 append-only 佇列，不需要理解財務語意（負債／目標連動一律由
  `FinanceRepository.applyLinkedEffects` 在 Web 端計算，兩端不會分裂成兩套規則）。
- 未來要遷移到 SQLite 仍然可行，因為 `FinanceRepository` 已經是唯一的資料入口——
  要換引擎是換它的實作，不是全app搜尋 `localStorage`。

**負面（明確接受）**

- App 關閉期間記的帳，要等到 WebView 下次執行才會出現在帳本。這是**刻意的 hand-off 設計，不是 bug**，
  必須寫進使用者說明（README 與桌寵分頁的「待同步筆數」）。
- outbox 的長度上限實質上取決於「使用者多久沒開 App」。這是有界的，但界線由使用者行為決定，不由我們決定。
- 桌寵分頁的「待同步筆數」是這個設計的必要 UI，不是可選的除錯資訊。
- 統計／報表永遠只反映已匯入帳本的資料，不含 outbox 內容。

## 重新評估此決策的觸發條件

出現下列任何一項，就應該重開這個 ADR 並認真評估 Room：

1. **需要多行程並行寫入**：例如 Native 端出現「不經過 Web 也要修改既有交易／負債餘額」的需求，
   SharedPreferences 的單檔 append 模型會不夠用。
2. **出現會寫入的 Widget 或 Quick Settings tile**：多了第二個非 WebView 的寫入者之後，
   「一個 outbox、一個匯入者」的模型就不成立了。
3. **交易量級到 5 萬筆以上**：全陣列重新序列化的寫入成本會開始在低階機型上被感知
   （`src/lib/__tests__/performance.test.ts` 是目前的觀測點）。
4. **Web 端因為其他理由改成非同步資料存取**：例如導入雲端同步或 IndexedDB。
   非同步化的成本一旦已經付掉，Room 的最大阻力就消失了。
5. **需要 Native 端即時顯示真實帳本數字**（而不是目前推送的精簡顯示狀態）：
   那代表 Native 必須能讀帳本，hand-off 模型就不夠了。
6. **實機測試證實 outbox 在特定 OEM 上會遺失資料**：若 SharedPreferences 的耐久性假設被推翻，
   就必須換成有 WAL 的儲存引擎。
