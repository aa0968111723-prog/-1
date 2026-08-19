package com.fintracker.app.pet

import android.animation.ValueAnimator
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.pm.ServiceInfoCompat
import com.fintracker.app.MainActivity
import com.fintracker.app.R
import org.json.JSONObject
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
 * state snapshot the web domain layer pushed via FinancePetPlugin.
 */
class FloatingPetService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var prefs: PetPrefs
    private val handler = Handler(Looper.getMainLooper())

    private var petView: FloatingPetView? = null
    private var petParams: WindowManager.LayoutParams? = null
    private var renderer: PetRenderer = DrawablePetRenderer()

    private var bubbleView: TextView? = null
    private var menuView: View? = null

    private var settings: PetSettingsSnapshot = PetSettingsSnapshot()
    private var petSizePx: Int = 0
    private var collapsed = false
    private var snapAnimator: ValueAnimator? = null

    private val idleRunnable = object : Runnable {
        override fun run() {
            if (!collapsed) renderer.playIdleTick()
            scheduleIdle()
        }
    }

    private val collapseRunnable = Runnable { collapseToEdge() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        prefs = PetPrefs(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart()
            ACTION_STOP -> handleStop(userInitiated = true)
            ACTION_UPDATE_SETTINGS -> handleSettingsChanged()
            ACTION_UPDATE_STATE -> applyPetState(showBubble = false)
            ACTION_SHOW_SUCCESS -> showSuccess(intent.getStringExtra(EXTRA_MESSAGE) ?: "記好啦！")
            else -> handleStart()
        }
        return START_STICKY
    }

    // ---- lifecycle ----

    private fun handleStart() {
        if (!OverlayPermissionManager.canDrawOverlays(this)) {
            // Permission was revoked while we were down — never crash, just stop.
            stopSelf()
            return
        }
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfoCompat.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } catch (e: Exception) {
            // Android 12+ can throw ForegroundServiceStartNotAllowedException when a
            // background start slips through; never hack around it — just stop.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                e is ForegroundServiceStartNotAllowedException
            ) {
                stopSelf()
                return
            }
            throw e
        }
        settings = prefs.settings()
        if (petView == null) addPetWindow()
        applyPetState(showBubble = false)
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
        running = false
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Screen rotated or resized: re-derive pixels from the normalized position.
        val params = petParams ?: return
        val view = petView ?: return
        val (w, h) = screenSize()
        val pos = PetPositionManager.toPixels(prefs.loadPosition(), w, h, petSizePx)
        params.x = pos.x
        params.y = pos.y
        collapsed = false
        safeUpdate(view, params)
        scheduleAutoCollapse()
    }

    // ---- overlay windows ----

    private fun addPetWindow() {
        settings = prefs.settings()
        petSizePx = dp(settings.sizeDp())
        val view = FloatingPetView(this, renderer, petCallback)
        renderer.setAnimationLevel(settings.animation)

        val (w, h) = screenSize()
        val stored = prefs.loadPosition()
        val startPos = PetPositionManager.toPixels(
            stored.copy(edge = PetPositionManager.resolveEdge(settings.edge, stored.edge)),
            w, h, petSizePx,
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
            y = startPos.y
        }

        try {
            windowManager.addView(view, params)
        } catch (e: Exception) {
            stopSelf()
            return
        }
        petView = view
        petParams = params
        scheduleIdle()
        scheduleAutoCollapse()
    }

    private fun removeAllWindows() {
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
    }

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
            showMenu()
        }

        override fun onDragStart() {
            noteInteraction()
            if (collapsed) collapsed = false
            dismissMenu()
            dismissBubble()
            snapAnimator?.cancel()
        }

        override fun onDragBy(dx: Int, dy: Int) {
            val params = petParams ?: return
            val view = petView ?: return
            val (w, h) = screenSize()
            params.x = max(-petSizePx / 3, min(w - petSizePx + petSizePx / 3, params.x + dx))
            params.y = max(0, min(h - petSizePx, params.y + dy))
            safeUpdate(view, params)
        }

        override fun onDragEnd() {
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
            duration = 260
            interpolator = OvershootInterpolator(1.1f)
            addUpdateListener { anim ->
                params.x = anim.animatedValue as Int
                safeUpdate(view, params)
            }
            start()
        }

        val normalized = PetPositionManager.normalize(targetX, params.y, w, h, petSizePx)
        prefs.savePosition(normalized.x, normalized.y, edge)
        scheduleAutoCollapse()
    }

    // ---- collapse to edge (半隱藏) ----

    private fun scheduleAutoCollapse() {
        handler.removeCallbacks(collapseRunnable)
        settings.autoCollapseMillis()?.let { handler.postDelayed(collapseRunnable, it) }
    }

    private fun noteInteraction() {
        scheduleAutoCollapse()
    }

    private fun collapseToEdge() {
        if (collapsed || menuView != null) return
        val params = petParams ?: return
        val view = petView ?: return
        val (w, _) = screenSize()
        val edge = prefs.loadPosition().edge
        collapsed = true
        val targetX = if (edge == PetPositionManager.EDGE_LEFT) -petSizePx / 2 else w - petSizePx / 2
        animateX(view, params, targetX)
        view.alpha = 0.75f
    }

    private fun expandFromEdge() {
        val params = petParams ?: return
        val view = petView ?: return
        val (w, _) = screenSize()
        val edge = prefs.loadPosition().edge
        collapsed = false
        view.alpha = 1f
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

    private fun openQuickAdd(type: String) {
        val intent = Intent(this, QuickAddActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(QuickAddActivity.EXTRA_TYPE, type)
        }
        // With a visible TYPE_APPLICATION_OVERLAY window + SYSTEM_ALERT_WINDOW the
        // app qualifies for the background-activity-launch exemption (this holds
        // on Android 15/16, where the overlay must actually be visible); still
        // guard so a policy change never crashes the pet.
        runCatching { startActivity(intent) }
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
                setPadding(dp(16), dp(10), dp(16), dp(10))
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
        addItem("📊 財務總覽") { openMainApp(PetActionBridge.EVENT_OPEN_DASHBOARD) }
        addItem("⚙️ 桌寵設定") { openMainApp(EVENT_OPEN_PET_SETTINGS) }
        addItem("✕ 關閉桌寵") { handleStop(userInitiated = true) }

        val menuParams = WindowManager.LayoutParams(
            dp(150),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (onLeft) params.x + petSizePx + dp(8) else max(0, params.x - dp(150) - dp(8))
            y = max(0, params.y - dp(40))
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
            y = max(0, params.y - dp(20))
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

    private fun applyPetState(showBubble: Boolean) {
        val state = runCatching { JSONObject(prefs.petStateJson) }.getOrElse { JSONObject() }
        val mood = state.optString("mood", "idle")
        renderer.setMood(mood)
        renderer.setAnimationLevel(prefs.settings().animation)
        if (showBubble) {
            val message = state.optString("message", "")
            showBubbleMessage(message)
        }
    }

    private fun showSuccess(message: String) {
        if (collapsed) expandFromEdge()
        renderer.setMood("success")
        renderer.playSuccess()
        showBubbleMessage(message)
        scheduleAutoCollapse()
    }

    private fun handleSettingsChanged() {
        val newSettings = prefs.settings()
        val sizeChanged = newSettings.sizeDp() != settings.sizeDp()
        settings = newSettings
        renderer.setAnimationLevel(newSettings.animation)
        if (sizeChanged && petView != null) {
            removeAllWindows()
            addPetWindow()
        } else {
            snapToCurrentEdgeSetting()
            scheduleAutoCollapse()
        }
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

    private fun scheduleIdle() {
        handler.removeCallbacks(idleRunnable)
        if (settings.animation != "full") return
        handler.postDelayed(idleRunnable, (8_000L + Random.nextLong(12_000L)))
    }

    // ---- notification ----

    private fun buildNotification(): Notification {
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
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, FloatingPetService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val petName = prefs.settings().petName.ifBlank { "小財" }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_pet_notification)
            .setContentTitle("🐣 $petName 正在陪你記帳")
            .setContentText("點擊開啟 FinTracker")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .addAction(0, "暫停桌寵", stopIntent)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
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
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_PET_EVENT = "petEvent"
        const val EVENT_OPEN_PET_SETTINGS = "openPetSettingsRequested"

        private const val CHANNEL_ID = "finance_pet"
        private const val NOTIFICATION_ID = 4741

        /** Volatile, in-process running flag for getPetStatus. */
        @Volatile
        var running: Boolean = false
            private set
    }
}
