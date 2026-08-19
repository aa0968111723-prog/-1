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
 * Responsibilities (and nothing more): create/remove the TYPE_APPLICATION_OVERLAY
 * windows, drive gestures + edge snapping, persist position, show the
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
    private var snapAnimator: ValueAnimator? = null

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
                    handler.removeCallbacks(idleRunnable)
                    handler.removeCallbacks(collapseRunnable)
                    snapAnimator?.cancel()
                    runCatching { dismissBubble() }
                    runCatching { dismissMenu() }
                }
                Intent.ACTION_SCREEN_ON -> {
                    screenOn = true
                    if (petView != null) {
                        scheduleIdle()
                        scheduleAutoCollapse()
                    }
                }
            }
        }
    }

    private val idleRunnable = object : Runnable {
        override fun run() {
            runCatching { idleTick() }
            scheduleIdle()
        }
    }

    private val collapseRunnable = Runnable { runCatching { collapseToEdge() } }
    private val snoozeResumeRunnable = Runnable { runCatching { resumeFromSnooze() } }

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
                ACTION_QUICKADD_SHOWN -> quickAddVisible = true
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
                stopSelf()
                return
            }
            throw e
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
        if (minutes > 0) handler.postDelayed(snoozeResumeRunnable, minutes * 60_000L)
    }

    private fun resumeFromSnooze() {
        if (!snoozed) return
        snoozed = false
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
        val startPos = PetPositionManager.toPixels(
            stored.copy(edge = PetPositionManager.resolveEdge(settings.edge, stored.edge)),
            w, usableHeight(h), petSizePx,
        )

        val params = WindowManager.LayoutParams(
            petSizePx,
            petSizePx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
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
        scheduleIdle()
        scheduleAutoCollapse()
    }

    private fun removePetWindowsOnly() {
        handler.removeCallbacks(idleRunnable)
        handler.removeCallbacks(collapseRunnable)
        snapAnimator?.cancel()
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
            if (collapsed) {
                expandFromEdge()
                return
            }
            noteInteraction()
            PetActionBridge.emit(PetActionBridge.EVENT_PET_TAPPED)
            openQuickAdd("expense")
        }

        override fun onLongPress() {
            if (collapsed) {
                expandFromEdge()
                return
            }
            noteInteraction()
            petView?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            showMenu()
        }

        override fun onDragStart() {
            noteInteraction()
            dragging = true
            if (collapsed) {
                collapsed = false
                petView?.alpha = 1f
            }
            dismissMenu()
            dismissBubble()
            snapAnimator?.cancel()
            stateMachine.request(PetState.DRAGGING, 120_000L)
            // 拖曳中稍微放大，有「被拿起來」的感覺
            petView?.animate()?.scaleX(1.1f)?.scaleY(1.1f)?.setDuration(120)?.start()
        }

        override fun onDragBy(dx: Int, dy: Int) {
            val params = petParams ?: return
            val view = petView ?: return
            val (w, h) = screenSize()
            val top = topInset()
            val bottom = bottomInset()
            params.x = max(-petSizePx / 3, min(w - petSizePx + petSizePx / 3, params.x + dx))
            // 不停進 status bar / 手勢區
            params.y = max(top, min(h - petSizePx - bottom, params.y + dy))
            safeUpdate(view, params)
        }

        override fun onDragEnd() {
            dragging = false
            stateMachine.clearTransient(PetState.DRAGGING)
            petView?.animate()?.scaleX(1f)?.scaleY(1f)?.setDuration(150)?.start()
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
        val edge = prefs.loadPosition().edge
        collapsed = true
        val targetX = if (edge == PetPositionManager.EDGE_LEFT) -petSizePx / 2 else w - petSizePx / 2
        animateX(view, params, targetX)
        view.alpha = settings.alpha() * 0.75f
    }

    private fun expandFromEdge() {
        val params = petParams ?: return
        val view = petView ?: return
        val (w, _) = screenSize()
        val edge = prefs.loadPosition().edge
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
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
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
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
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
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
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
                handler.postDelayed({ dismissBubble() }, durationMs)
            }
    }

    private fun dismissBubble() {
        bubbleView?.let { runCatching { windowManager.removeView(it) } }
        bubbleView = null
    }

    // ---- pet state ----

    private fun applyPetState() {
        val state = runCatching { JSONObject(prefs.petStateJson) }.getOrElse { JSONObject() }
        stateMachine.baseMood = state.optString("mood", "idle")
        renderer.setMood(stateMachine.current())
        renderer.setAnimationLevel(effectiveAnimationLevel())
    }

    /** Shown only after a durable write actually succeeded. */
    private fun showSuccess(message: String) {
        if (collapsed) expandFromEdge()
        if (stateMachine.request(PetState.SUCCESS, 2_000L)) {
            renderer.setMood(PetState.SUCCESS)
            renderer.playSuccess()
        }
        showBubbleMessage(message)
        handler.postDelayed({ runCatching { renderer.setMood(stateMachine.current()) } }, 2_100L)
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
        handler.postDelayed({ runCatching { renderer.setMood(stateMachine.current()) } }, 3_100L)
    }

    private fun handleSettingsChanged() {
        val newSettings = prefs.settings()
        val sizeChanged = newSettings.sizeDp() != settings.sizeDp()
        settings = newSettings
        renderer.setAnimationLevel(effectiveAnimationLevel())
        if (sizeChanged && petView != null) {
            removeAllWindows()
            addPetWindow()
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

    // ---- idle animation (event-driven, low frequency, battery friendly) ----

    private fun idleTick() {
        if (collapsed || dragging) return
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val night = hour >= 23 || hour < 7
        if (night) {
            // 夜間休息：睡覺表情、幾乎不動。點擊仍照常記帳。
            if (stateMachine.baseMood == "idle") renderer.setMood("sleepy")
            return
        }
        if (!stateMachine.idleTickAllowed()) return
        renderer.playIdleTick()
    }

    private fun scheduleIdle() {
        handler.removeCallbacks(idleRunnable)
        // No animation work at all while the screen is off or animations are simplified.
        if (!screenOn || effectiveAnimationLevel() != "full") return
        handler.postDelayed(idleRunnable, (8_000L + Random.nextLong(12_000L)))
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
                .addAction(0, "暫停桌寵", stopIntent)
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

    companion object {
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
