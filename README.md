# FinTracker Pro

個人財務追蹤器（Traditional Chinese / TWD），支援收支、預算、循環記帳、負債攤銷、目標規劃、長期試算表，以及 Gemini AI 金流推論。

Android 版內建 **小財桌寵**：真正浮在手機桌面與其他 App 上的財務桌寵，點一下就能快速記帳（見下方〈Android 小財桌寵〉）。

## 下載 Android App

桌寵是手機上的功能。網站的**桌寵**分頁最上方就是下載入口，或直接開
`/app/android`（可以用手機掃 QR Code）。

版本、檔案大小、最低 Android 版本、SHA-256 全部來自 CI 發布的
`latest.json`，網站上沒有硬編碼的版本字串。詳見 `docs/ANDROID_DISTRIBUTION.md`。

> 目前 pipeline 產出的是 **debug 簽章**的 APK，manifest 會如實標示。
> 可以安裝與使用，但不是正式簽章版本。

## 登入與同步

**不登入也完全可用。** FinTracker 是 local-first：桌寵、快速記帳、所有分析在
沒有帳號的情況下一樣運作。登入只多一件事 —— 跨裝置同步。

- 登入方式：Email 驗證碼（不用密碼）
- 登入時**不會覆蓋資料**：本機 200 筆 + 雲端 100 筆 = 300 筆，兩邊都不消失
- 登出**預設保留這台裝置的本機資料**，登出只是停止同步

## 離線

飛航模式下：桌寵記帳、新增／修改／刪除、看 Dashboard 全部照常。
恢復網路後自動在背景補傳。

**同步失敗不等於記帳失敗。** 帳已經安全存在手機裡，所以畫面顯示的是「記好啦」。

## 資料存在哪

| 層 | 位置 |
|---|---|
| 桌寵記的帳 | Kotlin 端 SharedPreferences outbox（同步 commit + 讀回驗證） |
| App 帳本 | IndexedDB（本機 canonical，見 `docs/ADR-LOCAL-FIRST-STORAGE.md`） |
| 舊資料 | 原本的 `finance_*` localStorage 鍵**原封不動保留**，當安全網 |
| 雲端 | Supabase Postgres，登入後才有；每張表都有 RLS |

## 備份

雲端同步**不等於**備份。設定頁的「匯出 JSON」仍然是完整備份，隨時可以帶走。


## 功能特色

- **收支明細**：搜尋、類型/月份/#標籤過濾、CSV 匯出
- **預算規劃**：分類預算 + 月收入設定
- **循環記帳**：每日/每週/每月/每年自動補登
- **負債管理**：利率、每月還款、攤銷推算、負攤銷警告、快速還款（連動交易）
- **目標規劃**：現金流評估、建議每月存入、存入/提領連動
- **長期試算表**：資產/負債紀錄
- **AI 金流推論**：真實呼叫 Gemini 進行深度分析
- **規則式財務健檢**：DTI、現金流餘裕、高利率警告等
- **完整資料備份**：JSON 匯出/匯入（避免 localStorage 遺失）

## 快速開始

```bash
# 安裝依賴
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env，至少填入 GEMINI_API_KEY（若要用 AI 功能）

# 開發模式
npm run dev
# 開啟 http://localhost:3000
```

## 環境變數

見 `.env.example`。主要：

| 變數 | 說明 |
|------|------|
| `GEMINI_API_KEY` | Google Gemini（AI 金流推論與助理） |
| `ELEVENLABS_API_KEY` | 語音合成（選用） |
| `FAL_API_KEY` | 圖片生成（選用） |
| `PINECONE_API_KEY` | 向量資料庫狀態檢查（選用） |
| `SUNO_API_KEY` | 音樂生成（目前為 mock） |

## 技術架構

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Recharts
- **Backend**: Express（代理 Gemini / ElevenLabs 等 API，開發時內嵌 Vite middleware）
- **資料**: 瀏覽器 `localStorage`（請定期使用「資料備份」匯出 JSON）

## 腳本

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發模式（tsx server.ts + Vite） |
| `npm run build` | 建置前端到 `dist/` |
| `npm start` | 啟動伺服器（tsx server.ts） |
| `npm run lint` | TypeScript 型別檢查 |
| `npm run clean` | 清除 dist |

## Android 小財桌寵

小財是浮在 Android 畫面上的財務桌寵（Native `WindowManager` overlay，不是 Widget）。
切到 LINE、Chrome、回到桌面牠都在；點一下立即快速記帳，App 沒開也可以。

### 安裝

```bash
npm install
npm run android:sync      # 建置 web + 複製共用設定 + Capacitor sync
npx cap open android      # Android Studio → Run（實機或 Emulator）
```

或直接下載 CI 產出的 `app-debug.apk`（GitHub Actions → 最新 CI run → Artifacts → `app-debug-apk`），
在手機上允許安裝未知來源後安裝。

### 權限

| 權限 | 用途 | 必要性 |
|------|------|--------|
| 顯示在其他應用程式上層 | 桌寵懸浮視窗 | 開啟桌寵時必要；拒絕不影響 App 本體 |
| 通知 | 前景服務常駐通知（含「記一筆」「暫停」） | 建議允許 |
| 生物辨識 | App 鎖定（選用） | 只在開啟 App 鎖定時使用 |

### 如何開啟

App → 🐣 桌寵分頁 → 開啟桌寵 → 依 onboarding 指示允許「顯示在上層」→ 桌寵出現。

### 快速記帳

- **點桌寵** → 輸入金額 → 點分類 → 記下來（快速模式下點分類直接完成，附幾秒復原）
- **長按桌寵** → ＋支出／＋收入／🎙 語音記帳／財務總覽／桌寵設定／暫停（30 分鐘 / 1 小時 / 直到我重新開啟）／關閉
- **自然語言**（離線可用，不呼叫 AI）：
  `午餐120`、`捷運50悠遊卡`、`早餐65`、`薪水35000`、`全聯850信用卡`、`昨天晚餐180`、`8/17 晚餐 200`
  認不出分類時**不會亂猜**——會顯示「分類：請選擇」讓你點一下（例如 `小明120`、`7-11 85`）
- 只有在資料**真的寫入手機**之後才會顯示「記好啦！」；寫入失敗會保留你輸入的內容讓你重按一次
- App 沒開時記的帳存在手機端 outbox，下次開 App 自動進入帳本（不重複、不遺失）

### 手機版 App

即使停用桌寵，App 本身在手機上也好用：底部導覽（總覽／明細／＋／目標／更多），中央 ＋ 就是快速記帳。

### 如何暫停或關閉

**暫停**（先躲起來，之後還會回來，資料完全不動）：
通知列 → 暫停桌寵（直到你重新開啟，通知會變成帶「恢復」的樣子）；
或長按桌寵 → ⏸ 暫停 → 30 分鐘 / 1 小時 / 直到我重新開啟。

**關閉**（桌寵開關轉為關閉，開機也不再自動出現）：
長按桌寵 → ✕ 關閉桌寵；或暫停中的通知 → 關閉桌寵；或 App → 桌寵分頁 → 關閉桌寵。

### 桌寵設定

設定分為六區：**桌寵**（大小／停靠／自動收邊／動畫／透明度／名稱）、**快速記帳**（預設類型／快速模式／釘選分類／自訂分類／支付方式）、**隱私**（泡泡顯示程度／App 鎖定）、**資料**（匯出／匯入 JSON）、**進階**（權限健康、待同步筆數、上次同步、桌寵位置）。

### 疑難排解

- **桌寵不見了**：檢查 桌寵分頁 → 進階 的權限狀態；權限被關會安全停止，重新允許後再開啟即可。
- **重開機後沒出現**：部分機型限制開機自啟，會改發「小財想回來陪你」通知，點一下恢復。
- **OPPO / realme / Xiaomi**：這些機型的背景管理較嚴格，若服務常被終止，請於系統的電池/背景管理中放行 FinTracker（詳見 `docs/DEVICE_TEST_CHECKLIST.md`）。
- **記的帳沒出現在 App**：開啟 App 後會自動同步；桌寵分頁 → 進階 可看「待同步筆數」。

## 資料備份

所有財務資料（交易、預算、負債、目標、循環、試算表）都存在本機 localStorage。

建議定期點擊導覽列的 **資料備份** 匯出 JSON 檔案；換裝置或清快取後可用「匯入」還原。

## 注意事項

- 資料僅存在瀏覽器，無雲端同步；請養成匯出習慣。
- 部分元件（`AIAssistant`、`ApiPlayground`、`ApiMonitor`、`DirectorStudio`）為歷史殘留，目前未掛載到主介面。
- 生產環境請妥善保護 API Key，並考慮加上 rate limit / 認證。
- Gemini 模型名稱以 `server.ts` 為準，若 API 報錯請確認模型是否仍可用。

## License

Private.
