# 小財 — Android Floating Finance Pet

真正浮在 Android 桌面與其他 App 上的財務桌寵，使用 Native `WindowManager` +
`TYPE_APPLICATION_OVERLAY` 實作（不是 Widget、不是 PWA、不是網頁內的 floating button）。

核心體驗：**看到小財 → 點一下 → 幾秒鐘記完帳。**

## 架構總覽

```
React / Vite (現有 FinTracker，完整保留)
   │  FinanceRepository / storage.ts   ← 單一資料入口 + finance_storage_version 遷移
   │  petFinanceState.ts               ← 財務 → 心情/訊息 的唯一計算（Native 不重算）
   │  petBridge.ts (FinancePet plugin) ← 唯一 web ↔ native 通道，web 平台自動降級 no-op
   ▼
Capacitor 8 (android/, compileSdk 36 / targetSdk 36, minSdk 24)
   │  FinancePetPlugin.kt              ← startPet/stopPet/getPetStatus/updatePetState/
   │                                     getPendingTransactions/ackPendingTransactions + petEvent
   ▼
Native Overlay 層 (com.fintracker.app.pet)
   FloatingPetService.kt   specialUse 前景服務：建立/移除 overlay、通知、lifecycle、螢幕開關
   FloatingPetView.kt      tap / drag / long-press 手勢（touch slop + long-press timeout）
   PetStateMachine.kt      動畫狀態機與優先權仲裁（純邏輯，可 JVM 測試）
   PetBehaviorScheduler.kt V2：自主行為決策（眨眼/張望/散步/睡覺/打招呼；純邏輯）
   PetBehaviorController.kt V2：行為編排與中斷規則（drag/QuickAdd/省電壓過一切；純邏輯）
   PetMovementController.kt V2：散步與跟手指的位移數學（50–120dp、300–800ms；純邏輯）
   PetRenderer.kt          動畫抽象（預留 Rive/Lottie/Live2D）；DrawablePetRenderer 為第一版
   PetPositionManager.kt   正規化座標 (0..1 + edge)，跨解析度/旋轉恢復位置（純邏輯）
   PendingTransactionCodec / Queue     durable outbox（純邏輯 codec + SharedPreferences commit）
   PetSharedConfig(Core).kt            共用設定資產讀取（分類／chips／支付／解析規則）
   NativeQuickParser.kt    以共用設定驅動的離線 NL 解析（與 web 同規則，可 JVM 測試）
   OverlayPermissionManager.kt         SYSTEM_ALERT_WINDOW 檢查與導向
   PetActionBridge.kt      Native → Plugin 的語意事件匯流排
   QuickAddActivity.kt     透明 bottom-sheet 快速記帳容器（無 WebView、無 splash）
   PetBootReceiver.kt      開機恢復（失敗時降級為通知，不用 hack）
```

## 資料流（絕不分裂成兩套帳）

Web `localStorage`（`finance_transactions` 等原 key）是唯一 source of truth；
決策理由與被否決的 SQLite 方案見 `docs/ADR-001-canonical-storage.md`。

**寫入與確認的順序就是不漏帳的關鍵**：

```
QuickAddActivity
  → PendingTransactionQueue.add()   commit() + 讀回驗證；失敗就不宣告成功
  → 只有成功才顯示「記好啦！」
  → WebView 存活時發 transactionQueued 事件，否則等下次開 App
  → drainNativeOutbox():
       repository.addTransaction(tx)   同步寫 localStorage，對 id 冪等
       repository.hasTransaction(id)   確認真的落盤
       syncFromRepository()            UI 從 storage 讀回
       ackPendingTransactions(ids)     ← 最後才讓 outbox 忘記
```

任何一步崩潰只會造成 replay，而 replay 被 id 冪等吸收 → **exactly-once**。

Web → Native 只推送 `PetDisplayState`（mood / message / streak / 今日筆數 / level），
不含交易明細、餘額或負債；Native 從不重算財務。

## Storage migration

`src/lib/storage.ts`：`finance_storage_version`（目前 v1）。v0→v1 驗證所有既有 key，
損壞資料先備份到 `<key>__backup_v0` 再重設，合法資料原封不動。絕不歸零帳本。

## Overlay 權限流程

1. 使用者在「🐣 桌寵」分頁按「開啟桌寵」→ 先顯示自家 onboarding 說明。
2. 確認後才導向 `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`。
3. 返回後檢查 `Settings.canDrawOverlays()`：成功 → 立即啟動；拒絕 → FinTracker 完全照常，
   桌寵永遠不是必要依賴。

## Android 14 / 15 / 16 相容性

- 前景服務型別：`specialUse`，manifest 宣告 `FOREGROUND_SERVICE`、
  `FOREGROUND_SERVICE_SPECIAL_USE` 與 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`
  （"user-enabled persistent floating personal finance quick-entry companion overlay"）。
- 啟動桌寵一律發生在 App 前景（使用者按鈕），不會觸發
  `ForegroundServiceStartNotAllowedException`；服務仍以 try/catch 防禦並乾淨停止。
- Android 15 起僅持有 SYSTEM_ALERT_WINDOW 不再豁免背景 FGS 啟動（需可見 overlay）；
  開機恢復依 BOOT_COMPLETED 對 specialUse 的允許進行，失敗時降級為可點擊通知。
- 桌寵點擊開啟 QuickAddActivity 時，可見 overlay + SAW 滿足 background-activity-launch 豁免。

## 省電

無 WakeLock、無輪詢、無永久動畫：閒置動畫為 8–20 秒一次的單發短動畫（動畫完成即停止），
財務狀態只在 web 資料變動時推送（300ms debounce）。

## 共用設定（web/native 永不漂移）

`shared/pet-shared-config.json` 是分類目錄（stable id + 繁中 label + emoji）、
快速分類 chips、支付方式與 NL 解析關鍵字的唯一來源：web 直接 import，
`npm run sync:shared` 複製為 Android asset（CI 以 `cmp` 驗證兩份一致）。
Native Quick Add 的分類優先使用 web 同步的使用頻率排序（`syncQuickCategories`），
沒有同步過才用 bundled 預設 —— Kotlin 内不硬編分類。

## Outbox（App 沒開也能記帳）

Native Quick Add → 持久化 outbox（schema v2：id/createdAt/source/schemaVersion/
syncState，`commit()` 寫入）→ 成功 UI（含幾秒復原）→ WebView 存活時立即 drain、
否則下次開 App drain → 走原本 `addTransaction`（以 stable id 冪等，crash-before-ack
重放不重複）→ ack 移除。損壞的 queue payload 會備份到獨立 key 後重建，
絕不因壞資料讓服務起不來。

## 動畫仲裁與自主行為（V2）

`PetStateMachine`：priority state machine（error > success/celebrate > saving >
dragging/followFinger > edge > reminder/mood > autonomous(walk/stretch/curious) >
idle decorations），成功動畫不會被眨眼蓋掉、記帳永遠壓過睡覺與散步。

`PetBehaviorScheduler` + `PetBehaviorController`（V2）：桌寵的「生活」。
- 單一 Handler timer：每次 tick 恰好重排一次，timer 永不累積（soak 測試鎖定）。
- 活躍程度 安靜/自然/活潑；Battery Saver 自動降為安靜；系統關閉動畫縮放
  （Reduce Motion）時停用所有自主動作。
- 散步：50–120dp、300–800ms、AccelerateDecelerate + 腳步 bob，只在安全區內
  （WindowInsets 推導，永不進 status bar / 手勢區）；IDLE 時零 position 更新。
- 睡覺：夜間 (23:00–07:00) 或久未互動 → 蓋小被子 + zzz 靜態層；點牠即醒且
  同一下就開 Quick Add。
- 打招呼：亮屏後機率性揮手（45 分鐘冷卻，永不每次都出現）。
- 拖曳：驚訝表情、翅膀輕拍、跟手指柔軟追趕（55%/事件收斂）、放開小跳＋輕觸覺。

## 已知限制

- 桌寵記的帳在 App 下次開啟（或 WebView 存活時即時）進入正式帳本 —— 這是刻意的
  hand-off 設計，避免兩套資料（已評估 SQLite：目前 web-authoritative + durable
  outbox 的一致性已足夠，不為外觀重構資料庫）。
- 全螢幕 App 偵測不透過 Accessibility Service（不申請敏感權限），以自動收邊 +
  「暫停 30 分鐘」降低干擾。
- 完整 `gradlew test / assembleDebug / lintDebug` 由 GitHub Actions CI 執行並上傳
  `app-debug.apk` artifact；純邏輯 Kotlin 測試（58 條，含 V2 行為/移動/soak）
  已在 JVM 上通過。實機矩陣見 `docs/DEVICE_TEST_CHECKLIST.md`。
- minSdk 宣告 24，但 API 24/25 的相容路徑（`TYPE_PHONE`、以及 API 26 才有的
  padding 屬性）沒有在任何 7.x 裝置或模擬器上驗證過。詳見
  `docs/REAL_DEVICE_TESTING.md` 的「minSdk 24 的特別注意」。

## 本機建置

```bash
npm install
npm run android:sync        # vite build + npx cap sync android
npx cap open android        # Android Studio → Run
```
