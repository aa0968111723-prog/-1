package com.fintracker.app.pet

import android.animation.ValueAnimator
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.fintracker.app.MainActivity
import com.fintracker.app.R
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * Foreground service that owns the floating pet overlay.
 *
 * Responsibilities (and nothing more): create/remove the overlay windows,
 * drive gestures + edge snapping, persist position, show the
 * foreground notification and honour Android 14/15/16 foreground-service
 * rules. Finance business logic never lives here — the pet only renders the
 * non-sensitive display state the web domain layer pushed via
 * FinancePetPlugin. Animation arbitration is delegated to
 * [PetStateMachine] so feedback animations are never cut short by
 * decorations.
 */
class FloatingPetService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var prefs: PetPrefs
    private val handler = Handler(Looper.getMainLooper())

    private var petView: FloatingPetView? = null
    private var petParams: WindowManager.LayoutParams? = null
    private var renderer: PetRenderer = DrawablePetRenderer()
    private val stateMachine = PetStateMachine()

    private var bubbleView: TextView? = null
    private var menuView: View? = null

    private var settings: PetSettingsSnapshot = PetSettingsSnapshot()
    private var petSizePx: Int = 0
    private var collapsed = false
    private var dragging = false
    private var quickAddVisible = false
    private var snoozed = false
    private var screenOn = true
    private var powerSave = false
    private var snapAnimator: ValueAnimator? = null
    private var walkAnimator: ValueAnimator? = null
    private var lastUserInteractionMs = System.currentTimeMillis()
    /** Follow-finger accumulated target (window coords) while dragging. */
    private var dragTargetX = 0
    private var dragTargetY = 0

    /** V2: the pet's autonomous life (walks, naps, greetings) — one timer, ever. */
    private val behavior = PetBehaviorController(stateMachine = stateMachine)

    /** Wall-clock deadline for a timed snooze; 0 means "until I turn it back on". */
    private var snoozeUntilEpochMs: Long = 0L

    /**
     * Stops every animation while the screen is off and resumes when it comes
     * back. Nothing here holds a WakeLock or wakes the device — the pet must
     * cost nothing while the phone is in a pocket.
     */
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    screenOn = false
                    handler.removeCallbacks(behaviorTickRunnable)
                    handler.removeCallbacks(collapseRunnable)
                    handler.removeCallbacks(moodRestoreRunnable)
                    snapAnimator?.cancel()
                    walkAnimator?.cancel()
                    behavior.pause()
                    runCatching { dismissBubble() }
                    runCatching { dismissMenu() }
                }
                Intent.ACTION_SCREEN_ON -> {
                    screenOn = true
                    // A timed snooze may have expired while the device slept
                    // (see snooze()); the screen coming back on is the first
                    // moment the pet would be seen again anyway.
                    if (snoozed && snoozeUntilEpochMs > 0L &&
                        System.currentTimeMillis() >= snoozeUntilEpochMs
                    ) {
                        runCatching { resumeFromSnooze() }
                    }
                    if (petView != null) {
                        behavior.onScreenOn(
                            greetingsEnabled = settings.greetings,
                            powerSave = powerSave,
                        )
                        scheduleAutoCollapse()
                    }
                }
            }
        }
    }

    /** The single autonomous-life timer (V2). Replaces the old idleRunnable. */
    private val behaviorTickRunnable = Runnable { runCatching { behavior.tick() } }

    private val collapseRunnable = Runnable { runCatching { collapseToEdge() } }
    private val snoozeResumeRunnable = Runnable { runCatching { resumeFromSnooze() } }
    private val bubbleDismissRunnable = Runnable { runCatching { dismissBubble() } }

    /** Restores the base mood after a success/error flash (named → clearable). */
    private val moodRestoreRunnable = Runnable { runCatching { renderer.setMood(stateMachine.current()) } }

    /** Battery Saver → the pet automatically goes quiet (spec §三十). */
    private val powerSaveReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshPowerSave()
        }
    }

    private fun refreshPowerSave() {
        powerSave = runCatching {
            (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isPowerSaveMode
        }.getOrDefault(false)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        prefs = PetPrefs(this)
        ContextCompat.registerReceiver(
            this,
            screenReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ContextCompat.registerReceiver(
            this,
            powerSaveReceiver,
            IntentFilter(android.os.PowerManager.ACTION_POWER_SAVE_MODE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        refreshPowerSave()
        wireBehaviorController()
    }

    /** Connects the pure behaviour brain to this service's windows/animators. */
    private fun wireBehaviorController() {
        behavior.contextProvider = PetBehaviorController.ContextProvider {
            PetBehaviorScheduler.Context(
                nowMs = System.currentTimeMillis(),
                hourOfDay = Calendar.getInstance().get(Calendar.HOUR_OF_DAY),
                screenOn = screenOn,
                quickAddOpen = quickAddVisible,
                menuOpen = menuView != null,
                dragging = dragging,
                collapsed = collapsed,
                powerSave = powerSave,
                animationLevel = effectiveAnimationLevel(),
                activityLevel = settings.activityLevel,
                autonomousEnabled = settings.autonomousMovement,
                sleepEnabled = settings.sleepMode,
                lastUserInteractionMs = lastUserInteractionMs,
                lastWalkMs = behavior.lastWalkMs(),
                lastStretchDayOfYear = behavior.lastStretchDayTag(),
                baseMood = stateMachine.baseMood,
            )
        }
        behavior.effects = object : PetBehaviorController.Effects {
            override fun scheduleNextTick(delayMs: Long) {
                handler.removeCallbacks(behaviorTickRunnable)
                if (screenOn && petView != null) handler.postDelayed(behaviorTickRunnable, delayMs)
            }

            override fun showTransient(state: String, durationMs: Long) {
                renderer.setMood(state)
            }

            override fun playMicroAnimation(kind: String) {
                if (collapsed || dragging) return
                when (kind) {
                    PetBehaviorScheduler.Behavior.CURIOUS -> renderer.playCurious()
                    else -> renderer.playIdleTick()
                }
            }

            override fun startWalk() {
                runCatching { performWalk() }.onFailure { behavior.onWalkFinished() }
            }

            override fun enterSleep() {
                renderer.setSleeping(true)
            }

            override fun exitSleep() {
                renderer.setSleeping(false)
                renderer.setMood(stateMachine.current())
            }

            override fun playGreeting() {
                renderer.playWave()
                showBubbleMessage(if (Random.nextBoolean()) "嗨～ 👋" else "回來啦～")
            }

            override fun playStretch() {
                renderer.playStretch()
                val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                if (hour in 7..10) showBubbleMessage("早安 ☀️")
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A malformed intent must never crash-loop the pet.
        runCatching {
            when (intent?.action) {
                ACTION_START -> handleStart()
                ACTION_STOP -> handleStop(userInitiated = true)
                ACTION_UPDATE_SETTINGS -> handleSettingsChanged()
                ACTION_UPDATE_STATE -> applyPetState()
                ACTION_SHOW_SUCCESS -> showSuccess(intent.getStringExtra(EXTRA_MESSAGE) ?: "記好啦！")
                ACTION_SHOW_ERROR -> showSaveFailed(
                    intent.getStringExtra(EXTRA_MESSAGE) ?: "這筆還沒存成功，再試一次",
                )
                ACTION_SNOOZE -> snooze(intent.getLongExtra(EXTRA_SNOOZE_MINUTES, 30L))
                ACTION_QUICKADD_SHOWN -> {
                    quickAddVisible = true
                    // Recording beats every animation, including sleep (§四十).
                    behavior.onQuickAddOpened()
                }
                ACTION_QUICKADD_HIDDEN -> {
                    quickAddVisible = false
                    scheduleAutoCollapse()
                }
                else -> handleStart()
            }
        }.onFailure { Log.e(TAG, "onStartCommand(${intent?.action}) failed", it) }
        return START_STICKY
    }

    // ---- lifecycle ----

    private fun handleStart() {
        if (!OverlayPermissionManager.canDrawOverlays(this)) {
            // Permission was revoked while we were down — never crash, just stop.
            Log.w(TAG, "Overlay permission missing; stopping service")
            stopSelf()
            return
        }
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(snoozed = false),
                // API 34 constant; inlined at compile time and ignored by
                // ServiceCompat on older platforms (minSdk 24).
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } catch (e: Exception) {
            // Android 12+ can throw ForegroundServiceStartNotAllowedException when a
            // background start slips through; never hack around it — just stop.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                e is ForegroundServiceStartNotAllowedException
            ) {
                Log.w(TAG, "FGS start not allowed from this context", e)
            } else {
                Log.e(TAG, "startForeground failed", e)
            }
            // Whatever the reason, we are not in the foreground. Rethrowing would
            // only be swallowed by onStartCommand's runCatching and leave a
            // started-but-not-foreground service, which the platform kills with
            // ForegroundServiceDidNotStartInTimeException — and START_STICKY would
            // walk straight back into the same path. Stop cleanly instead.
            stopSelf()
            return
        }
        snoozed = false
        handler.removeCallbacks(snoozeResumeRunnable)
        settings = prefs.settings()
        if (petView == null) addPetWindow()
        applyPetState()
        running = true
    }

    private fun handleStop(userInitiated: Boolean) {
        if (userInitiated) {
            prefs.enabled = false
            PetActionBridge.emit(PetActionBridge.EVENT_PET_STOPPED)
        }
        removeAllWindows()
        running = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        removeAllWindows()
        handler.removeCallbacks(snoozeResumeRunnable)
        runCatching { unregisterReceiver(screenReceiver) }
        runCatching { unregisterReceiver(powerSaveReceiver) }
        running = false
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Screen rotated or resized: re-derive pixels from the normalized position.
        val params = petParams ?: return
        val view = petView ?: return
        val (w, h) = screenSize()
        val pos = PetPositionManager.toPixels(prefs.loadPosition(), w, usableHeight(h), petSizePx)
        params.x = pos.x
        params.y = pos.y + topInset()
        collapsed = false
        view.alpha = settings.alpha()
        safeUpdate(view, params)
        scheduleAutoCollapse()
    }

    // ---- 暫停 30 分鐘（相機 / 遊戲情境） ----

    /**
     * Hides the overlay without touching any data. [minutes] of 0 means
     * "until I turn it back on" — the notification's 恢復 action is then the
     * only way back, which is exactly what a long gaming or camera session
     * wants.
     */
    private fun snooze(minutes: Long) {
        snoozed = true
        removePetWindowsOnly()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(snoozed = true))
        handler.removeCallbacks(snoozeResumeRunnable)
        // Handler delays run on uptimeMillis, which stops while the device is in
        // deep sleep — a pocketed phone would stretch "30 分鐘" into hours. Record
        // the wall-clock deadline as well and re-check it when the screen comes
        // back on. Deliberately no AlarmManager: waking a sleeping phone just to
        // draw a pet nobody is looking at is exactly the battery cost we refuse.
        snoozeUntilEpochMs = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else 0L
        if (minutes > 0) handler.postDelayed(snoozeResumeRunnable, minutes * 60_000L)
    }

    private fun resumeFromSnooze() {
        if (!snoozed) return
        snoozed = false
        snoozeUntilEpochMs = 0L
        if (!prefs.enabled || !OverlayPermissionManager.canDrawOverlays(this)) return
        if (petView == null) addPetWindow()
        applyPetState()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(snoozed = false))
    }

    // ---- overlay windows ----

    private fun addPetWindow() {
        settings = prefs.settings()
        petSizePx = dp(settings.sizeDp())
        val view = FloatingPetView(this, renderer, petCallback)
        renderer.setAnimationLevel(effectiveAnimationLevel())

        val (w, h) = screenSize()
        val stored = prefs.loadPosition()
        val edge = PetPositionManager.resolveEdge(settings.edge, stored.edge)
        val startPos = PetPositionManager.toPixels(stored.copy(edge = edge), w, usableHeight(h), petSizePx)
        // Write the resolved edge back, so the stored position and the placement
        // never disagree about which side the pet lives on.
        if (edge != stored.edge) prefs.savePosition(stored.x, stored.y, edge)

        val params = WindowManager.LayoutParams(
            petSizePx,
            petSizePx,
            overlayWindowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = startPos.x
            y = startPos.y + topInset()
        }

        try {
            windowManager.addView(view, params)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add pet window", e)
            stopSelf()
            return
        }
        petView = view
        petParams = params
        view.alpha = settings.alpha()
        behavior.start()
        scheduleAutoCollapse()
    }

    private fun removePetWindowsOnly() {
        handler.removeCallbacks(behaviorTickRunnable)
        handler.removeCallbacks(collapseRunnable)
        handler.removeCallbacks(moodRestoreRunnable)
        behavior.pause()
        snapAnimator?.cancel()
        walkAnimator?.cancel()
        dismissMenu()
        dismissBubble()
        petView?.let { runCatching { windowManager.removeView(it) } }
        petView = null
        petParams = null
        renderer.release()
        renderer = DrawablePetRenderer()
        collapsed = false
        dragging = false
    }

    private fun removeAllWindows() = removePetWindowsOnly()

    // ---- gestures ----

    private val petCallback = object : FloatingPetView.Callback {
        override fun onTap() {
            noteInteraction()
            behavior.onUserInteraction()
            if (collapsed) {
                // V2: one tap does the job — slide out AND open the sheet.
                // Recording must never cost a second tap (spec §四十一).
                expandFromEdge()
            }
            PetActionBridge.emit(PetActionBridge.EVENT_PET_TAPPED)
            openQuickAdd(settings.defaultType)
        }

        override fun onLongPress() {
            if (collapsed) {
                expandFromEdge()
                return
            }
            noteInteraction()
            behavior.onUserInteraction()
            petView?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            showMenu()
        }

        override fun onDragStart() {
            noteInteraction()
            behavior.onDragStart()
            dragging = true
            dragTargetX = petParams?.x ?: 0
            dragTargetY = petParams?.y ?: 0
            if (collapsed) {
                collapsed = false
                petView?.alpha = 1f
            }
            dismissMenu()
            dismissBubble()
            snapAnimator?.cancel()
            walkAnimator?.cancel()
            stateMachine.request(PetState.DRAGGING, 120_000L)
            // 被拿起來：驚訝表情 + 稍微放大 + 輕觸覺（spec §十一/§四十六）
            renderer.playSurprised()
            petView?.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            petView?.animate()?.scaleX(1.1f)?.scaleY(1.1f)?.setDuration(120)?.start()
        }

        override fun onDragBy(dx: Int, dy: Int) {
            val params = petParams ?: return
            val view = petView ?: return
            val (w, h) = screenSize()
            val top = topInset()
            val bottom = bottomInset()
            if (settings.followFinger) {
                // 跟著手指（spec §十）：累積手指目標，每個事件只追一部分，
                // 形成柔軟的落後追趕感；touch move 頻率高，殘差很快收斂，
                // 不需要任何額外 timer。
                dragTargetX += dx
                dragTargetY += dy
                params.x = params.x + ((dragTargetX - params.x) * FOLLOW_CATCH_UP).toInt()
                params.y = params.y + ((dragTargetY - params.y) * FOLLOW_CATCH_UP).toInt()
            } else {
                params.x += dx
                params.y += dy
            }
            params.x = max(-petSizePx / 3, min(w - petSizePx + petSizePx / 3, params.x))
            // 不停進 status bar / 手勢區
            params.y = max(top, min(h - petSizePx - bottom, params.y))
            renderer.wiggleWings()
            safeUpdate(view, params)
        }

        override fun onDragEnd() {
            dragging = false
            stateMachine.clearTransient(PetState.DRAGGING)
            // 放開：小跳一下 → 吸邊 + 輕觸覺（spec §十一/§四十六）
            petView?.animate()?.scaleX(1f)?.scaleY(1f)?.setDuration(150)?.start()
            renderer.playSuccessHop()
            petView?.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            snapToNearestEdge()
        }
    }

    private fun snapToNearestEdge() {
        val params = petParams ?: return
        val view = petView ?: return
        val (w, h) = screenSize()
        val naturalEdge = PetPositionManager.nearestEdge(params.x, w, petSizePx)
        val edge = PetPositionManager.resolveEdge(settings.edge, naturalEdge)
        val targetX = PetPositionManager.snapTargetX(edge, w, petSizePx)

        snapAnimator?.cancel()
        snapAnimator = ValueAnimator.ofInt(params.x, targetX).apply {
            duration = if (effectiveAnimationLevel() == "full") 260 else 120
            interpolator = OvershootInterpolator(1.1f)
            addUpdateListener { anim ->
                params.x = anim.animatedValue as Int
                safeUpdate(view, params)
            }
            start()
        }

        val normalized = PetPositionManager.normalize(
            targetX, params.y - topInset(), w, usableHeight(h), petSizePx,
        )
        prefs.savePosition(normalized.x, normalized.y, edge)
        scheduleAutoCollapse()
    }

    // ---- collapse to edge (半隱藏 / edge peek) ----

    private fun scheduleAutoCollapse() {
        handler.removeCallbacks(collapseRunnable)
        settings.autoCollapseMillis()?.let { handler.postDelayed(collapseRunnable, it) }
    }

    private fun noteInteraction() {
        lastUserInteractionMs = System.currentTimeMillis()
        scheduleAutoCollapse()
    }

    private fun collapseToEdge() {
        // Never peek away mid-interaction: not while dragging, not while the
        // quick add sheet or long-press menu is open.
        if (collapsed || dragging || quickAddVisible || menuView != null) return
        val params = petParams ?: return
        val view = petView ?: return
        if (!stateMachine.request(PetState.EDGE_PEEK, 60_000L)) return
        val (w, _) = screenSize()
        val edge = currentEdge()
        collapsed = true
        val targetX = if (edge == PetPositionManager.EDGE_LEFT) -petSizePx / 2 else w - petSizePx / 2
        animateX(view, params, targetX)
        view.alpha = settings.alpha() * 0.75f
    }

    private fun expandFromEdge() {
        val params = petParams ?: return
        val view = petView ?: return
        val (w, _) = screenSize()
        val edge = currentEdge()
        collapsed = false
        stateMachine.clearTransient(PetState.EDGE_PEEK)
        view.alpha = settings.alpha()
        animateX(view, params, PetPositionManager.snapTargetX(edge, w, petSizePx))
        scheduleAutoCollapse()
    }

    private fun animateX(view: View, params: WindowManager.LayoutParams, targetX: Int) {
        snapAnimator?.cancel()
        snapAnimator = ValueAnimator.ofInt(params.x, targetX).apply {
            duration = 220
            addUpdateListener { anim ->
                params.x = anim.animatedValue as Int
                safeUpdate(view, params)
            }
            start()
        }
    }

    // ---- quick add / actions ----

    private fun openQuickAdd(type: String, voice: Boolean = false) {
        val intent = Intent(this, QuickAddActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(QuickAddActivity.EXTRA_TYPE, type)
            if (voice) putExtra(QuickAddActivity.EXTRA_VOICE, true)
        }
        // With a visible TYPE_APPLICATION_OVERLAY window + SYSTEM_ALERT_WINDOW the
        // app qualifies for the background-activity-launch exemption (this holds
        // on Android 15/16, where the overlay must actually be visible); still
        // guard so a policy change never crashes the pet.
        runCatching { startActivity(intent) }
            .onFailure { Log.w(TAG, "QuickAdd launch blocked", it) }
        if (type == "expense") PetActionBridge.emit(PetActionBridge.EVENT_QUICK_EXPENSE)
        else PetActionBridge.emit(PetActionBridge.EVENT_QUICK_INCOME)
    }

    private fun openMainApp(event: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(EXTRA_PET_EVENT, event)
        }
        runCatching { startActivity(intent) }
        PetActionBridge.emit(event)
    }

    // ---- long-press menu (its own overlay window) ----

    private fun showMenu() {
        if (menuView != null) return
        val params = petParams ?: return
        val (w, _) = screenSize()
        val onLeft = params.x + petSizePx / 2 <= w / 2

        val menu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        fun addItem(label: String, action: () -> Unit) {
            val item = TextView(this@FloatingPetService).apply {
                text = label
                textSize = 14f
                setTextColor(0xFF5C5248.toInt())
                setBackgroundResource(R.drawable.pet_menu_item_bg)
                minHeight = dp(44)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(10), dp(16), dp(10))
                contentDescription = label
                setOnClickListener {
                    dismissMenu()
                    action()
                }
            }
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dp(6) }
            menu.addView(item, lp)
        }
        addItem("💸 ＋支出") { openQuickAdd("expense") }
        addItem("💰 ＋收入") { openQuickAdd("income") }
        addItem("🎙 語音記帳") { openQuickAdd("expense", voice = true) }
        addItem("📊 財務總覽") { openMainApp(PetActionBridge.EVENT_OPEN_DASHBOARD) }
        addItem("⚙️ 桌寵設定") { openMainApp(EVENT_OPEN_PET_SETTINGS) }
        addItem("⏸ 暫停") { showSnoozeMenu() }

        val menuParams = WindowManager.LayoutParams(
            dp(160),
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayWindowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (onLeft) params.x + petSizePx + dp(8) else max(0, params.x - dp(160) - dp(8))
            y = max(topInset(), params.y - dp(80))
        }

        menu.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) {
                dismissMenu()
                true
            } else false
        }

        runCatching { windowManager.addView(menu, menuParams) }
            .onSuccess { menuView = menu }
    }

    /** Second-level menu: 暫停 30 分鐘 / 1 小時 / 直到我重新開啟 / 關閉桌寵. */
    private fun showSnoozeMenu() {
        dismissMenu()
        val params = petParams ?: return
        val (w, _) = screenSize()
        val onLeft = params.x + petSizePx / 2 <= w / 2

        val menu = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun addItem(label: String, action: () -> Unit) {
            val item = TextView(this@FloatingPetService).apply {
                text = label
                textSize = 14f
                setTextColor(0xFF5C5248.toInt())
                setBackgroundResource(R.drawable.pet_menu_item_bg)
                minHeight = dp(44)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(10), dp(16), dp(10))
                contentDescription = label
                setOnClickListener {
                    dismissMenu()
                    action()
                }
            }
            menu.addView(
                item,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dp(6) },
            )
        }
        addItem(getString(R.string.pet_snooze_30m)) { snooze(30) }
        addItem(getString(R.string.pet_snooze_1h)) { snooze(60) }
        // "Until I turn it back on": hide the overlay but keep the service and
        // all data; the notification's 恢復 action brings the pet back.
        addItem(getString(R.string.pet_snooze_until_resume)) { snooze(0) }
        addItem("✕ 關閉桌寵") { handleStop(userInitiated = true) }

        val menuParams = WindowManager.LayoutParams(
            dp(170),
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayWindowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (onLeft) params.x + petSizePx + dp(8) else max(0, params.x - dp(170) - dp(8))
            y = max(topInset(), params.y - dp(40))
        }
        menu.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) {
                dismissMenu()
                true
            } else false
        }
        runCatching { windowManager.addView(menu, menuParams) }.onSuccess { menuView = menu }
    }

    private fun dismissMenu() {
        menuView?.let { runCatching { windowManager.removeView(it) } }
        menuView = null
    }

    // ---- bubble (its own overlay window so the pet never shifts) ----

    private fun showBubbleMessage(message: String, durationMs: Long = 1800L) {
        if (message.isBlank()) return
        dismissBubble()
        val params = petParams ?: return
        val (w, _) = screenSize()

        val bubble = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(0xFF5C5248.toInt())
            setBackgroundResource(R.drawable.pet_bubble_bg)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            maxWidth = dp(200)
        }
        val onLeft = params.x + petSizePx / 2 <= w / 2
        val bubbleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayWindowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (onLeft) params.x + petSizePx + dp(4) else max(0, params.x - dp(160))
            y = max(topInset(), params.y - dp(20))
        }
        runCatching { windowManager.addView(bubble, bubbleParams) }
            .onSuccess {
                bubbleView = bubble
                // Named runnable, not a fresh lambda: an earlier bubble's timer
                // would otherwise still be in flight and cut this one short — a
                // 3s save-failure message dismissed by a 1.8s success timer.
                handler.postDelayed(bubbleDismissRunnable, durationMs)
            }
    }

    private fun dismissBubble() {
        handler.removeCallbacks(bubbleDismissRunnable)
        bubbleView?.let { runCatching { windowManager.removeView(it) } }
        bubbleView = null
    }

    // ---- pet state ----

    private fun applyPetState() {
        val state = runCatching { JSONObject(prefs.petStateJson) }.getOrElse { JSONObject() }
        val mood = state.optString("mood", PetState.IDLE)
        val message = state.optString("message", "")
        stateMachine.baseMood = mood
        renderer.setMood(stateMachine.current())
        renderer.setAnimationLevel(effectiveAnimationLevel())
        renderer.setAccessory(accessoryForLevel(state.optInt("level", 1)))

        // Event-style reactions (spec §十九/§十八/§三十四): a NEW milestone or
        // gentle nudge gets one short animation + bubble, then quiet again.
        if (message.isNotBlank() && message != lastEventMessage && screenOn && !collapsed && !quickAddVisible) {
            when (mood) {
                PetState.CELEBRATE -> {
                    lastEventMessage = message
                    if (stateMachine.request(PetState.CELEBRATE, 2_500L)) {
                        renderer.setMood(PetState.CELEBRATE)
                        renderer.playCelebrate()
                        showBubbleMessage(message, 2_500L)
                        handler.removeCallbacks(moodRestoreRunnable)
                        handler.postDelayed(moodRestoreRunnable, 2_600L)
                    }
                }
                PetState.CAUTION -> if (settings.reminders) {
                    lastEventMessage = message
                    if (stateMachine.request(PetState.REMINDER, 2_500L)) {
                        // 拿著小帳本輕聲提醒，永遠不生氣（spec §十八）。
                        renderer.setMood(PetState.REMINDER)
                        renderer.showProp("notebook", 2_500L)
                        showBubbleMessage(message, 2_500L)
                        handler.removeCallbacks(moodRestoreRunnable)
                        handler.postDelayed(moodRestoreRunnable, 2_600L)
                    }
                }
            }
        }
    }

    /** Last event message already shown, so a state re-push never repeats it. */
    private var lastEventMessage: String = ""

    /**
     * Cosmetics unlocked by the habit level the web layer computes. They are
     * earned by recording consistently — never by spending less.
     */
    private fun accessoryForLevel(level: Int): String? = when {
        level >= 5 -> "hat"
        level >= 3 -> "scarf"
        level >= 2 -> "leaf"
        else -> null
    }

    /** Shown only after a durable write actually succeeded. */
    private fun showSuccess(message: String) {
        if (collapsed) expandFromEdge()
        if (stateMachine.request(PetState.SUCCESS, 2_000L)) {
            renderer.setMood(PetState.SUCCESS)
            renderer.playSuccess()
        }
        showBubbleMessage(message)
        // Success haptic on the pet itself (spec §四十六).
        petView?.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.LONG_PRESS,
        )
        // 小音效（spec §四十七）：預設關閉；開啟時輕輕一聲「叮」，no asset needed.
        if (settings.soundEffects) {
            runCatching {
                android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 55)
                    .apply {
                        startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 90)
                        handler.postDelayed({ runCatching { release() } }, 300)
                    }
            }
        }
        handler.removeCallbacks(moodRestoreRunnable)
        handler.postDelayed(moodRestoreRunnable, 2_100L)
        scheduleAutoCollapse()
    }

    /**
     * The write did NOT persist. The pet must never claim success it did not
     * achieve — quick add keeps the user's input so they can retry.
     */
    private fun showSaveFailed(message: String) {
        if (collapsed) expandFromEdge()
        if (stateMachine.request(PetState.ERROR, 3_000L)) {
            renderer.setMood(PetState.ERROR)
        }
        showBubbleMessage(message, 3_000L)
        handler.removeCallbacks(moodRestoreRunnable)
        handler.postDelayed(moodRestoreRunnable, 3_100L)
    }

    private fun handleSettingsChanged() {
        val newSettings = prefs.settings()
        val sizeChanged = newSettings.sizeDp() != settings.sizeDp()
        settings = newSettings
        renderer.setAnimationLevel(effectiveAnimationLevel())
        if (sizeChanged && petView != null) {
            removeAllWindows()
            addPetWindow()
            // The teardown replaced the renderer, so mood and the earned
            // accessory have to be re-applied or the pet comes back blank
            // until the web layer next pushes a state update.
            applyPetState()
        } else {
            snapToCurrentEdgeSetting()
            scheduleAutoCollapse()
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(snoozed))
    }

    private fun snapToCurrentEdgeSetting() {
        val params = petParams ?: return
        val view = petView ?: return
        val (w, _) = screenSize()
        val stored = prefs.loadPosition()
        val edge = PetPositionManager.resolveEdge(settings.edge, stored.edge)
        animateX(view, params, PetPositionManager.snapTargetX(edge, w, petSizePx))
        prefs.savePosition(stored.x, stored.y, edge)
    }

    // ---- autonomous life (V2: scheduler-driven, one timer, battery friendly) ----

    /**
     * One short stroll (spec §五/§八): plan inside the safe area, run a single
     * ValueAnimator with foot-bob, then return to complete stillness.
     */
    private fun performWalk() {
        val params = petParams ?: run { behavior.onWalkFinished(); return }
        val view = petView ?: run { behavior.onWalkFinished(); return }
        val plan = PetMovementController.planWalk(
            currentXPx = params.x,
            petSizePx = petSizePx,
            density = resources.displayMetrics.density,
            safe = currentSafeRect(),
        )
        if (plan == null) {
            behavior.onWalkFinished()
            return
        }
        renderer.setFacing(left = plan.facingLeft)
        renderer.playWalkBob(plan.hops, plan.durationMs)
        walkAnimator?.cancel()
        walkAnimator = ValueAnimator.ofInt(plan.fromX, plan.toX).apply {
            duration = plan.durationMs
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            addUpdateListener { anim ->
                params.x = anim.animatedValue as Int
                safeUpdate(view, params)
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    // Persist where the stroll ended so rotation keeps the spot.
                    val (w, h) = screenSize()
                    val normalized = PetPositionManager.normalize(
                        params.x, params.y - topInset(), w, usableHeight(h), petSizePx,
                    )
                    prefs.savePosition(normalized.x, normalized.y, normalized.edge)
                    renderer.setFacing(left = false)
                    behavior.onWalkFinished()
                    renderer.setMood(stateMachine.current())
                }
            })
            start()
        }
    }

    /**
     * The walkable world (spec §七): the screen minus status bar, nav/gesture
     * zone and display cutouts — derived from real WindowInsets, never
     * hard-coded pixels.
     */
    private fun currentSafeRect(): PetMovementController.SafeRect {
        val (w, h) = screenSize()
        return PetMovementController.SafeRect(
            left = 0,
            top = topInset(),
            right = w,
            bottom = h - bottomInset(),
        )
    }

    /** Simplified animations when the user chose so OR the system disabled animator scale (reduced motion). */
    private fun effectiveAnimationLevel(): String {
        if (settings.animation != "full") return "simple"
        val reduced = runCatching {
            Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
        return if (reduced) "simple" else "full"
    }

    // ---- notification ----

    private fun buildNotification(snoozed: Boolean): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "小財桌寵", NotificationManager.IMPORTANCE_MIN).apply {
                    description = "桌寵懸浮視窗執行中的常駐通知"
                    setShowBadge(false)
                },
            )
        }
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val quickAddIntent = PendingIntent.getActivity(
            this,
            2,
            Intent(this, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, FloatingPetService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val resumeIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, FloatingPetService::class.java).setAction(ACTION_START),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // 暫停 must mean pause: hide the overlay but keep the pet enabled, so the
        // web toggle stays on and PetBootReceiver still restores it. Wiring this
        // to ACTION_STOP would silently turn the feature off for good.
        val snoozeIntent = PendingIntent.getService(
            this,
            4,
            Intent(this, FloatingPetService::class.java)
                .setAction(ACTION_SNOOZE)
                .putExtra(EXTRA_SNOOZE_MINUTES, 0L),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val petName = prefs.settings().petName.ifBlank { "小財" }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_pet_notification)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
        if (snoozed) {
            builder.setContentTitle("🐣 $petName 暫停中")
                .setContentText("點「恢復」讓小財回來")
                .addAction(0, "恢復", resumeIntent)
                .addAction(0, "關閉桌寵", stopIntent)
        } else {
            builder.setContentTitle("🐣 $petName 正在陪你記帳")
                .setContentText("點擊開啟 FinTracker")
                .addAction(0, getString(R.string.pet_notification_add), quickAddIntent)
                .addAction(0, "暫停桌寵", snoozeIntent)
        }
        return builder.build()
    }

    // ---- helpers ----

    private fun screenSize(): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            bounds.width() to bounds.height()
        } else {
            @Suppress("DEPRECATION")
            val display = windowManager.defaultDisplay
            val size = android.graphics.Point()
            @Suppress("DEPRECATION")
            display.getSize(size)
            size.x to size.y
        }
    }

    /** Status bar / display cutout inset — the pet never docks over it. */
    private fun topInset(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val insets = windowManager.currentWindowMetrics.windowInsets
                .getInsetsIgnoringVisibility(WindowInsets.Type.statusBars() or WindowInsets.Type.displayCutout())
            return insets.top
        }
        return dp(24)
    }

    /** Navigation bar / gesture area inset — the pet never blocks it. */
    private fun bottomInset(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val insets = windowManager.currentWindowMetrics.windowInsets
                .getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars())
            return insets.bottom
        }
        return dp(24)
    }

    /** Height available to normalized positioning (between the insets). */
    private fun usableHeight(screenH: Int): Int = max(1, screenH - topInset() - bottomInset())

    private fun safeUpdate(view: View, params: WindowManager.LayoutParams) {
        runCatching { windowManager.updateViewLayout(view, params) }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    /**
     * The docking edge actually in effect. The user's explicit left/right
     * setting wins over wherever the pet happens to have been left; "auto"
     * falls back to the stored edge. Every place that moves the pet sideways
     * must agree on this, otherwise the pet is placed on one edge and peeks
     * away to the other.
     */
    private fun currentEdge(): String =
        PetPositionManager.resolveEdge(settings.edge, prefs.loadPosition().edge)

    /**
     * Window type for every overlay this service adds.
     *
     * TYPE_APPLICATION_OVERLAY only exists from API 26. minSdk here is 24, and
     * on 24/25 the window manager rejects that type outright
     * (BadTokenException, "permission denied for window type 2038"), so the pet
     * would never appear on Android 7.x. TYPE_PHONE is the deprecated
     * predecessor and is what SYSTEM_ALERT_WINDOW actually grants there.
     */
    @Suppress("DEPRECATION")
    private val overlayWindowType: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

    companion object {
        /** Follow-finger catch-up per touch event — the soft chase feel (§十). */
        private const val FOLLOW_CATCH_UP = 0.55f

        const val ACTION_START = "com.fintracker.app.pet.START"
        const val ACTION_STOP = "com.fintracker.app.pet.STOP"
        const val ACTION_UPDATE_SETTINGS = "com.fintracker.app.pet.UPDATE_SETTINGS"
        const val ACTION_UPDATE_STATE = "com.fintracker.app.pet.UPDATE_STATE"
        const val ACTION_SHOW_SUCCESS = "com.fintracker.app.pet.SHOW_SUCCESS"
        const val ACTION_SHOW_ERROR = "com.fintracker.app.pet.SHOW_ERROR"
        const val ACTION_SNOOZE = "com.fintracker.app.pet.SNOOZE"
        const val ACTION_QUICKADD_SHOWN = "com.fintracker.app.pet.QUICKADD_SHOWN"
        const val ACTION_QUICKADD_HIDDEN = "com.fintracker.app.pet.QUICKADD_HIDDEN"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_SNOOZE_MINUTES = "snoozeMinutes"
        const val EXTRA_PET_EVENT = "petEvent"
        const val EVENT_OPEN_PET_SETTINGS = "openPetSettingsRequested"

        private const val TAG = "FinancePetService"
        private const val CHANNEL_ID = "finance_pet"
        private const val NOTIFICATION_ID = 4741

        /** Volatile, in-process running flag for getPetStatus. */
        @Volatile
        var running: Boolean = false
            private set
    }
}
