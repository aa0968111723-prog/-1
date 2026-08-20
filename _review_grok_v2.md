# PR #9 對抗審查（工程）feat/pet-v2-uiux vs main

美術不評。財務 push（`App.tsx:357-381`）本 PR 未改，OK。Native tap 路徑無 I/O；`onUserInteraction` 同步 <1ms。`postDelayed` 在 `release()` 後**不 NPE**（capture 的是 ImageView；`applyMood()` 早退）。

---

## 發現

1. **BLOCKER** `PetBehaviorController.kt:125-128` + `:76-78`  
   關掉睡眠模式／安靜／省電時，BLINK/LOOK **不 wake**。`pause()` 也不清 `sleeping`。Quiet 永無 WALK/STRETCH → 被子可以蓋到死。  
   修：scheduler 不再出 SLEEP 就 `wake()`；`pause()` 維持 pose 但 SCREEN_ON／設定變更要重評。

2. **BLOCKER** `PetBehaviorScheduler.kt:84-90`  
   SLEEP 排在 STRETCH 前。過夜 `idleMs` 極大 → 晨間伸懶腰（§15）**永遠不會發生**。  
   修：晨間先 STRETCH（順便 wake），再決定是否睡回去。

3. **MAJOR** `FloatingPetService.kt:967-978`  
   `ValueAnimator.cancel()` 仍觸發 `onAnimationEnd`（AOSP 會 notify end）。SCREEN_OFF／拖曳取消散步會：存中途座標、`setFacing(false)`、`setMood`。拖曳時這發生在 `request(DRAGGING)` **之前**（`476-490`），臉會閃 idle。  
   修：`onAnimationEnd` 若 `isCanceled` 或 `animation !== walkAnimator` 則 return；只用 `onWalkFinished()`。

4. **MAJOR** `FloatingPetService.kt:571-584`  
   `collapseToEdge` 不看 `behavior.walking`、不 cancel `walkAnimator`。預設 15s 收邊 vs 首次 tick 6s、blink 延遲 8–22s → 兩顆 ValueAnimator 搶 `params.x`。  
   修：`if (behavior.walking) return`；收邊前 `walkAnimator?.cancel()` + `onWalkFinished()`。

5. **MAJOR** `FloatingPetService.kt:337-350`  
   旋轉不 cancel `walkAnimator`。新螢幕重放位置後，舊像素插值繼續跑，可出安全區。  
   修：config change 先停 walk/snap。

6. **MAJOR** `FloatingPetService.kt:503-510` vs `PetMovementController.kt:100-121`  
   §10 的 `followStep`（offset 40dp）**只有測試在用**。服務是 55% 追 raw 手指，沒有落後點。  
   修：`onDragBy` 改呼叫 `followStep`。

7. **MAJOR** `FloatingPetService.kt:989-996`  
   `currentSafeRect` 只有 status/nav，**沒有 IME**（§7/§32 只寫在註解）。鍵盤升起仍可走進去。`planWalk` 的「太窄就 null」從未被真實鍵盤觸發。  
   修：safe rect 加 `WindowInsets.Type.ime()`（或 IME 可見時禁止散步）。

8. **MAJOR** `DrawablePetRenderer.kt:132-135` + `:197-206` + `:188-194`  
   `setFacing` 寫 `root.scaleX = ±1`；`playSurprised`/`playStretch` 動畫到 `scaleX(1f)` → 走路朝左被拖曳／伸懶腰翻正。父層 `petView.scaleX(1.1)`（`494`）是另一個 view，**不衝突**；衝突在 root 自己。  
   修：面向用 `scaleX = dir * abs(scale)`，或面向放在內層、scale 放在外層。

9. **MAJOR** `DrawablePetRenderer.kt:137-152`  
   `playWalkBob` 的 `withEndAction` 在 `animate().cancel()` 時仍會跑（拖曳 `playSurprised` 會 cancel）。translationY hop 疊上 scale，散步 bob 在拖曳中續命。  
   修：generation token；cancel 路徑不 bob。

10. **MAJOR** `PetBehaviorController.kt:170-178`  
    SCREEN_ON 打招呼不檢查 `sleeping`／collapsed。GREET(28) > DEEP_SLEEP(25) 蓋掉睡眠 transient，但 `sleeping` 仍 true、毯子還在 → 揮手蓋被。  
    修：睡著就 skip greet，或先 `wake()`。

11. **MAJOR** `PetBehaviorController.kt:206` + `FloatingPetService.kt:426`  
    `FIRST_TICK_MS=6000` > 進階「5 秒收邊」。收邊後 scheduler 見 `collapsed` 回 NONE → **5s 檔自主生活全死**（只剩點一下記帳）。`behavior.start()` **只**在 `addPetWindow:426`；`handleStart` 在 `petView != null`、`handleSettingsChanged` 非改尺寸、都不重踢。重複 START 且 timer 已被 SCREEN_OFF `pause()` 時，要等 SCREEN_ON。  
    修：收邊後仍允許 blink；`handleStart`/`settings` 在 `petView != null && screenOn` 時 `behavior.start()`；FIRST_TICK < 最小收邊。

12. **MAJOR** `src/index.css:112-113` + `PetSettings.tsx:116-130`  
    §27「點一下播放」：`--wave`/`--celebrate` 是 **infinite**。預覽會一直跳。  
    修：`animation-iteration-count: 1`。

13. **MINOR** `DrawablePetRenderer.kt:231,265` + `:268-282`  
    `showProp`/`playCelebrate` 的 `postDelayed` 在 `release()` 未 `removeCallbacks`。不 NPE，但短泄漏離場 View。  
    修：release 時 `p.removeCallbacks(null)`。

14. **MINOR** `FloatingPetService.kt:880-887`  
    `ToneGenerator.release` 是匿名 `handler.postDelayed`，`onDestroy` 沒 `removeCallbacksAndMessages(null)`。  
    修：具名 Runnable，teardown 清掉。

15. **MINOR** `DrawablePetRenderer.kt:209-216`  
    `w.animation != null` 擋不到 ViewPropertyAnimator（那是舊 Animation API）。靠 `rotation != 0` 將就。

16. **MINOR** native idle **從不** `showProp("wallet")`；web `PetSprite` 錢包常駐。角色契約破圖。

17. **MINOR** `SHY` / `EDGE_REST` / `FOLLOW_FINGER` 狀態機有、無人 `request`。

18. **MINOR** `PetSettings.tsx:409-410` 互動「自動收邊」ON 強制 `15s`，會蓋掉進階 5s。

19. **MINOR** `src/index.css:116` `.pet-zzz` 不掛 `--animated`；夜間 Hero（`HomeScreen.tsx:85` 預設 animated）zzz 無限轉。Nav `animated={false}` OK；**沒有**列表上的 infinite sprite。

20. **MINOR** `HomeScreen.tsx:85` 不理 `settings.animation`（§48 只套 overlay）。

21. **MINOR** soak/controller 測試不到 Animator cancel、IME、收邊×散步、設定關睡眠。§53 清單綠 ≠ 服務正確。

22. **OK** Quick Add：`onTap:453-463` 只多同步 wake + 收邊時 `expandFromEdge`（非阻塞）。無新增 await。`defaultType` 修正是加分。

23. **OK** `petSettings.ts:76-84` `{...DEFAULT, ...saved}` 舊檔拿到 V2 預設；`optBoolean(..., true)` 與 web 一致。

---

## Spec 覆蓋缺口（§1–65，repo 無全文；依程式 § 引用 + PR 誠實列）

**有實作：** §3/6 編排、§5/8 步幅時長、§9 活躍度、§11/46 拖曳戲+觸覺、§13 打招呼（冷卻/機率有；睡著衝突見 #10）、§14 夜睡、§18/19/34 提醒泡泡、§22–24 首頁 Hero/三卡/最近、§26 互動開關、§28/55 單 timer+soak（純邏輯）、§30 省電→安靜、§39/40 優先權+QA 贏、§41 收邊單擊直開、§47 音效預設關、§50/51 色票/icon、§53 JVM 行為測。

**宣稱有、實際沒接或反了：**

| § | 缺口 |
|---|---|
| 7/32 | 安全區無 IME |
| 10 | `followStep` 未接線 |
| 15 | 晨間伸懶腰被 SLEEP 餓死 |
| 27 | 預覽不是一次性 |
| 28 | web Hero 四條 infinite CSS（native idle 尚可） |
| 48 | web 不理 animation/simple |
| 54 | 實機矩陣未跑（PR 自承） |
| 58 | 完成畫面：晨伸/跟手指/鍵盤避開都缺 |

**完全沒對應程式（至少）：** §12 長按新戲、§16 亮屏必醒、§17 羞辱（靠舊訊息引擎，本 PR 沒碰）、§20–21/25 桌機資訊架構、§29 無 WakeLock（沿用）、§31/33 挖孔與全螢幕偵測（仍 snooze+收邊）、§35–37 更多事件表情、§42–45 延遲 KPI 實測、§49 字體、§52 Rive/Lottie 資產（介面 no-op）、§56–57 a11y、§59–65 發佈/隱私/OEM（文件舊、本 PR 沒加測項）。

`edgeRest`/`shy` 是規格幽靈狀態。錢包 drawable 未進 idle 層。
