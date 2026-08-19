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
   FloatingPetService.kt   specialUse 前景服務：建立/移除 overlay、通知、lifecycle
   FloatingPetView.kt      tap / drag / long-press 手勢（touch slop + long-press timeout）
   PetRenderer.kt          動畫抽象（預留 Rive/Lottie/Live2D）；DrawablePetRenderer 為第一版
   PetPositionManager.kt   正規化座標 (0..1 + edge)，跨解析度/旋轉恢復位置（純邏輯，可 JVM 測試）
   PendingTransactionCodec / Queue     WebView 不在時的交易暫存佇列（純邏輯 + SharedPreferences）
   OverlayPermissionManager.kt         SYSTEM_ALERT_WINDOW 檢查與導向
   PetActionBridge.kt      Native → Plugin 的語意事件匯流排
   QuickAddActivity.kt     透明 bottom-sheet 快速記帳容器（無 WebView、無 splash）
   PetBootReceiver.kt      開機恢復（失敗時降級為通知，不用 hack）
```

## 資料流（絕不分裂成兩套帳）

- Web `localStorage`（`finance_transactions` 等原 key）是唯一 source of truth。
- 桌寵記帳（App 沒開）：QuickAddActivity → `PendingTransactionQueue`（SharedPreferences）
  → WebView 下次存活時 `getPendingTransactions` → 走原本 `addTransaction` → `ackPendingTransactions`。
  UUID 保留，drain 具冪等性，不會重複匯入。
- App 開著時：`transactionQueued` 事件即時 drain，Dashboard / 收支明細 / Budget 立即同步。
- Web → Native：`updatePetState` 推送 `petFinanceState` 計算結果（心情、訊息、streak、XP），
  Native 只負責顯示，不重寫財務邏輯。

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

## 已知限制

- Native QuickAdd 的分類為固定常用清單（web 端才有依使用頻率排序 + 自然語言解析）。
- 桌寵記的帳在 App 下次開啟（或 WebView 存活時即時）進入正式帳本 —— 這是刻意的
  hand-off 設計，避免兩套資料。
- 全螢幕 App 偵測不透過 Accessibility Service（不申請敏感權限），以自動收邊降低干擾。
- 本開發環境無法連 dl.google.com（Android SDK / AGP），`gradle build` 需在本機
  Android Studio 驗證；純邏輯 Kotlin 測試已在 JVM 上通過。

## 本機建置

```bash
npm install
npm run android:sync        # vite build + npx cap sync android
npx cap open android        # Android Studio → Run
```
