# 覆核 9c5799d（vs `_review_grok_v2.md`）

對 `feat/pet-v2-uiux` HEAD（`9c5799d` 修復 + `55bc4be` 只刪審查稿）。只讀程式，不改碼。

**不是 ALL CLEAR。** 原 #3/#4/#5/#8/#10/#12 修好。#1 的統一喚醒把 `NONE` 當成「該醒了」，簡化動畫／收邊會把夜間睡眠掀掉。#6 接上 `followStep` 但手指座標推導會在第一次 MOVE 往左瞬移。#9 沒做 generation token。

---

## #1–#12

| # | 原級 | verdict | 還要修 |
|---|---|---|---|
| 1 | BLOCKER | **fix introduced new bug** | `PetBehaviorController.kt:98-103`：`wokeThisTick = sleeping && decision != SLEEP` 把 `NONE` 當喚醒。關睡眠模式／安靜／省電的原洞有補（有測試）。但 `scheduler.next` 在 `animationLevel != "full"` 或 `collapsed` 時**永遠 `NONE` 且排在 SLEEP 前**（`PetBehaviorScheduler.kt:72-76`）。夜間睡著 → 使用者切「簡化動畫」或系統 reduce-motion → 下一 tick 掀被，之後也再睡不著。收邊同理。舊 `NONE` 分支是 `sleeping && (!sleepEnabled \|\| !shouldStayAsleep)` 才 `wake()`。`pause()` 仍不清 `sleeping`（可以，SCREEN_OFF 本來就不該醒）。 |
| 2 | BLOCKER | **fixed** | STRETCH 已排在 SLEEP 前（`PetBehaviorScheduler.kt:82-94`）。晨伸 `wake(showWakePose=false)`，WAKE(30) 不會蓋 STRETCH(14)。`overnight idle still gets its morning stretch` 有測。STRETCH 與 WAKE 不互搶。 |
| 3 | MAJOR | **fixed** | `FloatingPetService.kt:995-1014`：`onAnimationCancel` 設 `cancelled` + `onWalkFinished()`；`onAnimationEnd` early-return。cancel 不存中途座標、不 `setFacing(false)`、不 `setMood`。`onWalkFinished()` 只清 flag／WALK transient，重入安全。拖曳 `cancel` 在 `request(DRAGGING/FOLLOW_FINGER)` 之前（`495`），不會閃 idle。 |
| 4 | MAJOR | **fixed** | `collapseToEdge`（`590-596`）先 `walkAnimator?.cancel()` 再收邊，不再兩顆 ValueAnimator 搶 `params.x`。用 cancel 比「walking 就 return」好。 |
| 5 | MAJOR | **fixed** | `onConfigurationChanged`（`342-343`）先 cancel snap/walk，再從 normalized 重放。 |
| 6 | MAJOR | **fix introduced new bug** | `followStep` 已接上（`518-528`）。`fingerXPx = dragTargetX + petSizePx/2` 把「黏手指的左上角」當成寵物中心。`followStep` 在 `center <= finger` 時走左側（相等算左，`PetMovementController.kt:113`）。Drag start 時 `dragTarget == params` → 第一個 MOVE 目標 ≈ `petX - petSize/2 - offset/2`。`followFactor=0.35` 仍會跳約 `0.35*(petSize/2+20dp)`；large=80dp、density=3 約 60px+ 往左，跟手指方向無關。Y 推導正確（`targetY = fingerY - petSize/2` = `dragTargetY`）。`clampX/clampY` 本身對；`petSize` 大時是 offset 公式在跳，不是 clamp。非 follow 路徑仍用 ±1/3 出界（`532`），follow 路徑改為完全夾在 safe rect。 |
| 7 | MAJOR | **partially fixed** | `currentSafeRect` 底邊 `h - max(bottomInset(), imeInset())`（`1031`）。`imeInset()`（`1040-1044`）讀 `petView.rootWindowInsets`。這扇窗是 `FLAG_NOT_FOCUSABLE \| FLAG_LAYOUT_NO_LIMITS` overlay，IME insets 實務上常是 0；status/nav 用的是 `windowManager.currentWindowMetrics`（`1140-1154`），IME 沒走同一條。沒有 IME 顯隱 listener，只在 `planWalk` 當下採樣。API 30 以下仍 0（有註解）。 |
| 8 | MAJOR | **fixed** | `dir()` 乘在 `playStretch` / `playSurprised`（`216-217`, `229-230`）。全庫 `scaleX`：root 上只剩這兩條 + `setFacing`；`playIdleTick` 的 `scaleX` 在 **body**（`131-132`）；服務的 `1.1`/`1f` 在 **petView**（`503`,`545`），都不是 root。沒漏。`setFacing` 仍寫 `scaleX = dir()`（±1），伸懶腰中途被 setFacing 會把 0.94 拍回 1，實務幾乎碰不到。 |
| 9 | MAJOR | **not fixed** | `playWalkBob`（`161-176`）沒有 generation token。`ViewPropertyAnimator.withEndAction` 在 `cancel()` 時仍走 AOSP `onAnimationEnd`。`playSurprised` 的 `translationY(0)`（`227-230`）擋不住 hop 的 endAction 再 `start()` 一輪 bob，跟驚訝 scale 互搶。 |
| 10 | MAJOR | **fixed** | `onScreenOn`（`177-179`）`!sleeping` 才打招呼。`screen-on never greets a sleeping pet` 有測。沒查 collapsed；GREET(28) < EDGE_PEEK(50)，收邊時 request 會失敗，無害。 |
| 11 | MAJOR | **partially fixed** | settings 變更會 `behavior.start()`（`950`）。收邊仍 `NONE`（不 blink），只留 30s heartbeat（測試 `collapsed pet keeps exactly one heartbeat pending` 把這定成契約）。`FIRST_TICK_MS` 仍是 6000（`206`），進階 5s 收邊仍先到。`handleStart`（`312`）在 `petView != null` 仍不重踢；SCREEN_OFF 清了 timer 之後若只有重複 START、沒 SCREEN_ON，loop 仍死。`expandFromEdge` 也不 `start()`；長按收邊展開（`470-472`）不走 `onUserInteraction`，要等下一次 30s NONE。 |
| 12 | MAJOR | **fixed** | `src/index.css:112-113` wave 2 次、celebrate 3 次（不是 infinite）。預覽用 `key={`${mood}-${playCount}`}` 重掛（`PetSettings.tsx:133,141`），同一姿再點會重播。 |

---

## 指定項

### #1/#2 `wokeThisTick` + 晨伸

```
wokeThisTick = sleeping && decision.behavior != SLEEP
if (wokeThisTick) wake(showWakePose = decision != STRETCH)
NONE -> {}
```

| 情況 | 結果 |
|---|---|
| 關睡眠模式 / 省電安靜 → BLINK | 醒。原 BLOCKER 修了。 |
| 早上 STRETCH | 不播 WAKE，直接伸懶腰。#2 OK。 |
| 簡化動畫 / reduce-motion → **永遠 NONE**（scheduler 在 SLEEP 之前 return） | **睡著的會被掀被，之後也不再進 SLEEP。** 舊碼 `shouldStayAsleep` 會把夜間留在睡。 |
| collapsed / menu / dragging / !screenOn → NONE | 同邏輯。SCREEN_OFF 有 `removeCallbacks`，不會 tick，OK。collapsed 若已睡著（例如 SCREEN_ON 後 5s 收邊、6s 才 tick），會醒在半藏邊。 |
| 自動收邊 ON | 5s/15s 收邊早於 6min/23:00 睡眠，scheduler 見 collapsed 根本不選 SLEEP（舊行為）。洞主要是「先睡著再切簡化動畫」。 |

還要修：`wokeThisTick` 排除 `NONE`（或恢復「只有不該繼續睡才 wake」）。最好 scheduler 在 reduce-motion 下仍允許 SLEEP／維持現況，不要把「別動」解讀成「醒來」。

### #3 cancel 路徑

`onAnimationCancel` → `onWalkFinished()`（`walking=false`）→ `onAnimationEnd` 若 `cancelled` 則 return。AOSP `ValueAnimator.cancel()` 同步 cancel+end，flag 擋得住。`onWalkFinished` 冪等。OK。

### #6 `fingerXPx`

`dragTarget` 是「若黏在手指上，寵物左上角會在哪」（start = `params.x`，之後 `+= dx`）。

`fingerX = dragTargetX + petSize/2` 把那個左上角換成中心，當手指座標。`followStep` 再要求中心落在手指**側後**，且 `<=` 走左。第一下 MOVE 在原地就認定「該閃到手指左邊」，位移隨 `petSizePx` 變大。公式要嘛改成真正的觸點，要嘛不要把 glued top-left 再加 `petSize/2` 丟進「側後 offset」公式。

`clampX/clampY`：safe 太窄（理論上 IME）時 `right-petSize < left`，clamp 釘在 `left`/`top`，可能再跳一次；目前 IME 多半是 0，這條還沒被真實鍵盤打到。

### #8 `scaleX`

沒漏 root 上的 facing 衝突。OK。

### #16 accessory 預設錢包

`applyAccessory` else → `ic_pet_prop_wallet`，層在 prop/zzz **下面**。睡時 prop=毯子蓋住肚子上的錢包，zzz 在最上面。不會蓋掉睡眠。戰利品 hat/scarf/leaf 取代錢包，不會疊兩件。`showProp("wallet")` 沒人叫；提醒帳本／慶祝帽子走 prop，蓋在 accessory 上。OK。

---

## 修復 diff 引入的新問題（不在原 #1–#12 編號裡）

1. **`wokeThisTick` × `NONE`** — 見 #1。建議測：睡著 + `animationLevel="simple"` 的下一 tick 必須仍 `sleeping`。現有 `reduce motion stops all autonomy` 是從醒著出發，測不到這條。
2. **follow-finger 第一下往左跳** — 見 #6。`PetMovementControllerTest` 傳的是絕對手指座標，測不到服務這層的 `dragTarget+size/2`。
3. **`dismissMenu()` 每次都 `setMood(current())`（`783-788`）** — `onDragStart` 無條件 `dismissMenu()`（`492`）。沒開選單時也會在 `playSurprised` 前寫一次 mood。同 callback 裡隨即被 surprised 蓋掉，多半一幀內結束；若要乾淨，clear SHY 只在 `menuView != null` 時做。
4. **IME 採樣來源與 status/nav 不一致** — `imeInset()` 用 overlay 的 `rootWindowInsets`；`topInset`/`bottomInset` 用 `currentWindowMetrics`。#7 可能整段是空操作。

原 minor 順手看了（不列入 #1–#12 閘門）：

- #13 `release()` 清 `faceRestore`/`propHide` — fixed
- #14 `ToneGenerator` 仍是匿名 `handler.postDelayed`（`910`），`onDestroy` 只 `removeCallbacks(snoozeResumeRunnable)` — **not fixed**
- #15 `w.animation != null` 仍擋不到 VPA — not fixed
- #16 錢包進 accessory — fixed（睡眠／prop 不衝突）
- #17 SHY、FOLLOW_FINGER 已接；`EDGE_REST` 仍無人 `request` — partially
- #18 `lastAutoCollapse` ref 記住 5s/15s — fixed（render 期間寫 ref，能動）
- #19 zzz 改掛 `--dreaming` — fixed
- #20 Hero `animated={loadPetSettings().animation === 'full'}` — fixed（每次 render 讀 localStorage，不訂閱變更）
- #21 仍無 Animator cancel / IME / 收邊×散步 / **簡化動畫+睡眠** 測試 — 補了 sleep-off、晨伸、greet、collapsed heartbeat

---

## 還要改的位置

1. `PetBehaviorController.kt:98-103` — `NONE` 不得 `wake()`。`wokeThisTick` 僅在決策是會取代睡眠的行為（BLINK/LOOK/WALK/STRETCH/CURIOUS）時成立。加測試：sleeping + `animationLevel="simple"`、sleeping + `collapsed=true`，tick 後仍 sleeping。
2. `FloatingPetService.kt:518-522` — 不要用 `dragTarget + petSize/2` 當 `followStep` 的手指點，或改 `followStep` 的相等分支，避免第一下往左跳 `petSize/2`。
3. `DrawablePetRenderer.kt:161-176` — `playWalkBob` generation token；cancel / `playSurprised` 後 endAction 不得再 hop。
4. `FloatingPetService.kt:1040-1044` 與 `275-315` — IME 改走與 status bar 相同的 metrics（並確認 NOT_FOCUSABLE overlay 讀不讀得到）；`handleStart` 在 `petView != null && screenOn` 時 `behavior.start()`。
5. （可選）`PetBehaviorController.kt:206` `FIRST_TICK_MS` 降到小於最小收邊；或 `expandFromEdge` 重踢 tick。不是回歸，是 #11 沒做完。

---

## 總評

**不是 ALL CLEAR。** 兩個 BLOCKER 的主路徑（關睡眠會醒、晨伸不再被 SLEEP 餓死）是真的修了，散步 cancel／旋轉／`dir()`／打招呼／CSS 一次性也過關。不能合進 main 的是 #1 的 `NONE` 誤喚醒，以及 #6 大手勢寵物第一下往左跳。#9 原樣還在。
