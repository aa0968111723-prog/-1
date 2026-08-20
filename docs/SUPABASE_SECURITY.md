# Supabase 安全性

## 金鑰

| 金鑰 | 可以出現在哪 | 為什麼 |
|---|---|---|
| Publishable（`sb_publishable_…`） | JS bundle、APK、前端程式碼 | **設計上就是公開的**。它只是「你敲得到門」，決定你看得到哪些列的是 RLS |
| Service role | **只有 CI secrets** | 完全繞過 RLS。放進 bundle 等於把整個資料庫交出去 |

Service role key 目前唯一的用途是 release workflow 上傳 APK 到 Storage。
它不在 `.env.example`、不在任何 `VITE_*` 變數、不在 repo 任何地方。

任何 `VITE_` 開頭的變數都會在 build 時被 inline 進 bundle，而那個 bundle 會
原封不動進到 APK。**把 server secret 放進 VITE_ 變數 = 公開它。**

## RLS

12 張表全部 `enable` **且** `force` row level security。每張表 4 條 policy：

```sql
using      (user_id = (select auth.uid()))   -- select / update / delete
with check (user_id = (select auth.uid()))   -- insert / update
```

`force` 很重要：沒有它，table owner 會繞過 RLS。

### 自己驗證

```sql
-- 每張表都應該 rls_enabled = true、rls_forced = true、policies = 4
select c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.policyname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
group by 1,2,3 order by 1;
```

實際執行過的強制性測試（不是只看設定，是真的試著讀寫）：

```sql
set local role authenticated;   -- 已登入但沒有 subject，auth.uid() 為 null
select count(*) from public.transactions;                    -- 必須是 0
insert into public.transactions (...) values (...);          -- 必須被拒
```

結果：看得到 0 列、insert 被擋、沒有留下探測列。

### Contract probe（對真實資料庫跑過）

`supabase/tests/contract_probe.sql`

單元測試全部打在 fake cloud 上 —— 那是測 merge 邏輯的正確方式，但也代表
`toCloudRow()` 與真實 schema 之間的落差（欄位改名、型別被拒、主鍵放不下
deterministic 的 recurring id）在使用者第一次真的同步之前完全看不見。

這個 probe 補上那一段。它建立兩個拋棄式使用者、**在 RLS 生效的狀態下**用真正的
寫入路徑操作，然後把自己建立的東西全部刪掉。實際跑過的結果：

- client 送出的完整欄位組合被接受
- `recurring:rule-9:2026-08-01` 這種 id 可以當主鍵寫進去（證實 TEXT 而非 UUID
  的決定是必要的）
- upsert on conflict 可重放
- tombstone update 正常
- **換成另一個 authenticated 使用者後，讀到 0 列**
- 結束後 `rows_left = 0`、`probe_users_left = 0`

### CI 的守門

`scripts/check-migrations.mjs` 會在每次 CI 檢查：任何被建立的財務表，
如果沒有對應的 RLS 敘述就**讓 build 失敗**。這條規則是驗證過的 —— 加入一張
沒有 RLS 的表，檢查會確實報錯。忘記加 RLS 是唯一一種「在 review 裡看起來完全
正常、但會把別人的帳本公開出去」的錯誤，所以由機器擋。

## Token 儲存的威脅模型

Session 存在 localStorage（`fintracker.auth`）。

- **Android**：localStorage 位於 App 私有資料目錄。未 root 的裝置上，其他 App
  讀不到。
- **瀏覽器**：受同源政策保護。**XSS 就能讀到** —— 這是所有以 localStorage 存
  token 的網頁應用的共同前提，不是這個專案獨有的弱點。
- **不保護**：已 root 的裝置、實體取得未鎖定的手機、惡意瀏覽器擴充套件。

沒有假裝這是「安全儲存」。真正需要更強保護時的方向是 Android Keystore，
但那需要一個原生 plugin，而且只保護 Android 那一半 —— 網頁版仍在同一個
威脅模型下。誠實的現況：**這是標準的 web session 儲存，不是硬體級保護。**

## AI 金鑰

```
App → 自家後端 endpoint → AI provider
```

App 從不持有 AI 供應商的金鑰。`vite.config.ts` 曾經有一個會把 `GEMINI_API_KEY`
inline 進 bundle 的 `define`，已經移除，該檔案留有一行說明為什麼不能加回來。

發版前檢查：`grep -r "GEMINI_API_KEY\|service_role\|sb_secret" dist/` 必須是空的。
