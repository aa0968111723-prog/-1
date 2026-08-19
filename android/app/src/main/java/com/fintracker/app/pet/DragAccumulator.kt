package com.fintracker.app.pet

import kotlin.math.abs

/**
 * Turns a stream of float touch positions into whole-pixel window moves
 * without throwing away the remainder.
 *
 * WindowManager.LayoutParams.x/y are ints, but MotionEvent positions are
 * floats. Rounding each delta independently and then advancing the reference
 * point to the raw position discards every sub-pixel movement: during a slow
 * drag (well under 1 px per touch event) the truncated delta is always 0, so
 * the pet stops following the finger entirely, and on a fast drag the
 * discarded remainders accumulate as visible lag.
 *
 * Here the reference point only advances by the amount actually consumed, so
 * the leftover fraction carries into the next event and no motion is lost.
 *
 * Pure logic on purpose — this is the part worth unit testing on the JVM.
 */
class DragAccumulator {

    private var refX = 0f
    private var refY = 0f

    /** Start (or restart) tracking from a touch position, consuming nothing. */
    fun reset(x: Float, y: Float) {
        refX = x
        refY = y
    }

    /**
     * Whole pixels to move for a new touch position, or null when the
     * accumulated movement is still under one pixel on both axes.
     */
    fun consume(x: Float, y: Float): Pair<Int, Int>? {
        val dx = truncate(x - refX)
        val dy = truncate(y - refY)
        if (dx == 0 && dy == 0) return null
        refX += dx
        refY += dy
        return dx to dy
    }

    /** Toward zero, so a remainder never overshoots the finger. */
    private fun truncate(v: Float): Int = if (abs(v) < 1f) 0 else v.toInt()
}
