# FinTracker Pro

個人財務追蹤器（Traditional Chinese / TWD），支援收支、預算、循環記帳、負債攤銷、目標規劃、長期試算表，以及 Gemini AI 金流推論。

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
