package com.fintracker.app.pet

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.FrameLayout
import kotlin.math.hypot

/**
 * The floating pet's window view: hosts the renderer's character view and
 * turns raw touches into semantic gestures (tap / drag / long-press) using
 * proper slop + timeout thresholds so a drag never accidentally opens
 * quick add.
 *
 * All window positioning is delegated to the host (FloatingPetService)
 * through [Callback] — the view never touches WindowManager itself. The
 * message bubble and long-press menu live in their own overlay windows so
 * they can never shift the pet.
 */
@SuppressLint("ViewConstructor")
class FloatingPetView(
    context: Context,
    renderer: PetRenderer,
    private val callback: Callback,
) : FrameLayout(context) {

    interface Callback {
        fun onTap()
        fun onLongPress()
        fun onDragStart()
        fun onDragBy(dx: Int, dy: Int)
        fun onDragEnd()
    }

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()

    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var dragging = false
    private var longPressFired = false
    private val longPressRunnable = Runnable {
        if (!dragging) {
            longPressFired = true
            callback.onLongPress()
        }
    }

    init {
        addView(
            renderer.createView(context),
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
        contentDescription = "小財桌寵"
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX
                downY = event.rawY
                lastX = event.rawX
                lastY = event.rawY
                dragging = false
                longPressFired = false
                postDelayed(longPressRunnable, longPressTimeout)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val totalDx = event.rawX - downX
                val totalDy = event.rawY - downY
                if (!dragging && !longPressFired && hypot(totalDx, totalDy) > touchSlop) {
                    dragging = true
                    removeCallbacks(longPressRunnable)
                    callback.onDragStart()
                }
                if (dragging) {
                    val dx = (event.rawX - lastX).toInt()
                    val dy = (event.rawY - lastY).toInt()
                    if (dx != 0 || dy != 0) callback.onDragBy(dx, dy)
                }
                lastX = event.rawX
                lastY = event.rawY
                return true
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longPressRunnable)
                when {
                    longPressFired -> Unit // menu already opened
                    dragging -> callback.onDragEnd()
                    else -> callback.onTap()
                }
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                removeCallbacks(longPressRunnable)
                if (dragging && !longPressFired) callback.onDragEnd()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(longPressRunnable)
        super.onDetachedFromWindow()
    }
}
