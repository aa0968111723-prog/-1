# Android 發布與下載

## 為什麼不用 GitHub Release

這個 repository 是 **private**。private repo 的 Release asset URL 需要帶 token
才能下載，不能直接給一般使用者。所以 APK 與版本資訊放在 Supabase Storage 的
public bucket。

```
app-releases/                       （public read，只有 CI 的 service role 能寫）
  android/
    latest.json                     ← 下載中心讀這一份
    1.0.0/
      fintracker-1.0.0.apk
      manifest.json
```

CI artifact 仍然保留，但那是工程用途。一般使用者不需要走
GitHub → Actions → Run → Artifacts 才能拿到 App。

## latest.json

```json
{
  "version": "1.1.0",
  "versionCode": 10100,
  "platform": "android",
  "minAndroid": 24,
  "channel": "production",
  "apkUrl": "https://…/app-releases/android/1.1.0/fintracker-1.1.0.apk",
  "sha256": "…64 hex…",
  "size": 4251880,
  "releasedAt": "2026-08-20T00:00:00.000Z",
  "notes": "…",
  "commit": "…"
}
```

網站上**沒有任何硬編碼的版本字串**。版本、大小、最低 Android、SHA-256、發布
時間、更新說明全部來自這份 manifest。硬編碼版本是網站在三個版本之後還在宣傳
1.0.0、而下載連結指向早就不存在的 APK 的原因。

沒有 `sha256`（或長度不是 64）的 manifest 會被前端當成**格式錯誤**而拒絕，
不會退而求其次照樣給使用者下載連結。

## 版本號

`package.json` 是唯一真實來源。

```
versionCode = major*10000 + minor*100 + patch
1.0.0 -> 10000    1.2.3 -> 10203    1.3.0 -> 10300
```

`scripts/sync-version.mjs` 產生 `versionName` 與 `versionCode`；
`npm run android:sync` 會跑它，CI 用 `--check` 驗證沒有漂移。

手改 `build.gradle` 是「發布了 1.1.0，但手機因為 versionCode 還是 1 而拒絕
升級」的來源。Android 用 versionCode 判斷是不是升級，不看名字。

## Channel

| Channel | 觸發 | 對 latest.json 的影響 |
|---|---|---|
| `production` | push tag `v*.*.*` | **更新** latest.json |
| `internal` | 手動 workflow_dispatch | 上傳但**不動** latest.json |

所以內部測試版可以被安裝與測試，但下載頁永遠不會把測試版交給一般訪客。

**每次 main push 不會發布。** tag 才是那個刻意的動作。

## 需要的 secrets

| Secret | 用途 |
|---|---|
| `SUPABASE_URL` | Storage endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | 上傳（繞過 RLS，**只在 CI**） |
| `SUPABASE_PUBLISHABLE_KEY` | build 時給前端 |
| `RELEASE_PUBLIC_BASE` | 選填，manifest 內 apkUrl 的前綴 |

沒有設定 `SUPABASE_SERVICE_ROLE_KEY` 時，workflow **不會失敗**：它會發出警告、
照樣把 APK 和 manifest 留成 build artifact。

## 簽章

pipeline 會在有 keystore 時做正式簽章，沒有時退回 debug 簽章：

| Secret | 說明 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` 的輸出 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密碼 |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key 密碼 |

建立 keystore：

```bash
keytool -genkeypair -v -keystore release.keystore \
  -alias fintracker -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore    # 貼進 ANDROID_KEYSTORE_BASE64
```

**keystore 本身絕對不進 repo。**

### 為什麼這件事比「不夠正式」嚴重

Gradle 在找不到 debug keystore 時會**自己產生一個**，而全新的 CI runner 永遠沒有。
所以每一次發布的簽章憑證都不一樣，而 Android 拒絕簽章改變的覆蓋安裝
（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）—— 使用者每次更新都得先移除舊版。

設了 keystore 之後就穩定了，可以直接覆蓋更新。沒設的話 workflow 仍會發布，
但 manifest 會標 `signing: debug`，下載頁也會說明要先移除舊版。

## 簽章：先前的說明

**目前沒有 production signing key。** 未簽章的 release build 無法安裝，所以
pipeline 現在產出的是 **debug 簽章**的 APK，並且在 manifest 的 `channel`
如實標示。

**這不是正式版。** debug 簽章的 APK：

- 可以安裝、可以正常使用
- 但和未來用正式 key 簽的版本**簽章不同**，屆時必須先移除再安裝
- 不應該當成正式發行版對外散布

要轉成正式發行：建立 keystore，把它與密碼放進 GitHub Secrets（**絕不進 repo**），
在 `android/app/build.gradle` 加上 `signingConfigs`，把 workflow 的
`assembleDebug` 換成 `assembleRelease`。

## Rollback

最新版有嚴重問題時，把上一個穩定版的 `manifest.json` 覆蓋回
`android/latest.json` 即可 —— 下載頁立刻回到舊版。

**不會**自動降級已安裝的 App。Android 本來就不允許降級安裝，而且悄悄把使用者
的 App 換掉不是可以接受的行為。

## 安裝說明的用詞

側載會讓 Android 詢問「允許從此來源安裝」。文案照實說明：這只影響「從這個來源
安裝」這一項，**不會關閉手機任何安全防護**，之後也能改回來。

不使用「關閉 Android 安全保護」這類措辭 —— 那既不準確，也在訓練使用者忽略
真正的安全提示。
