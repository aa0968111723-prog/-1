# 資料模型

Schema 定義在 `supabase/migrations/`，那裡是唯一真實來源；本文說明為什麼長這樣。

## 三個關鍵決定

### 1. Entity id 是 TEXT，不是 UUID

本機帳本同時產生兩種 id：

- 一般列：`crypto.randomUUID()`
- 週期性交易：**deterministic** 的 `recurring:<ruleId>:<dateKey>`

第二種的確定性正是「兩台裝置不會各自產生同一筆週期帳」的機制（需求 §31）。
如果雲端用 `uuid` 欄位，每一筆 recurring 都會變成無法同步 —— 那正是要防的
double-apply。

### 2. 兩個時間戳

| 欄位 | 誰寫 | 用途 |
|---|---|---|
| `updated_at` | 伺服器 trigger | pull cursor |
| `client_updated_at` | 裝置 | last-write-wins 決勝 |

### 3. `deleted_at`，不 DELETE

刪除本身也要能同步。

## transactions

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | text PK | 見上 |
| `user_id` | uuid | → `auth.users`，RLS 依據 |
| `type` | text | `income` / `expense`，有 CHECK |
| `amount` | numeric(18,4) | **不用 float**。numeric 是精確十進位 |
| `currency` | text | 預設 TWD |
| `category_id` | text | 穩定 id |
| `category_label_snapshot` | text | 寫入當下的標籤，之後改名不會讓歷史難讀 |
| `payment_method_id` | text | |
| `transaction_date` | date | 使用者本地日曆日 |
| `linked_debt_id` / `linked_goal_id` | text | |
| `linked_debt_applied` / `linked_goal_applied` | numeric | 實際套用的金額（餘額會 clamp 在 0），刪除才能精確還原 |
| `source` | text | `web` / `app` / `pet` / `pet_quick_add` / `pet_voice` / `recurring` / `import` |
| `device_id` | text | 決勝用 |
| `revision` | integer | 伺服器 trigger 遞增 |
| `schema_version` | integer | |

`source` **刻意沒有 CHECK**：新版 client 寫入新的 source 值，不應該被舊 migration
釘死的 schema 拒絕（見下方 additive 規則）。

## 索引

```
(user_id, transaction_date desc)   -- 列表與期間查詢
(user_id, updated_at)              -- sync cursor
(user_id, deleted_at)              -- 過濾 tombstone
```

## Migration 規則：additive first

舊版 App 會在使用者手機上存活很久。Cloud schema 一升級就讓舊 App 完全壞掉是
不能接受的，所以：

- 加欄位要有 default 或允許 null
- 不重新命名既有欄位
- 不加會讓舊 client 寫入被拒的 CHECK
- 真的要破壞性變更時，先加新欄位、雙寫、等舊版淘汰，最後才移除
