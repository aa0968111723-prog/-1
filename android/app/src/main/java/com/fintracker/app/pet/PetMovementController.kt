package com.fintracker.app.pet

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * Movement math for the pet's small autonomous strolls (spec §5/§8/§38).
 *
 * Pure Kotlin — no WindowManager, no animators. The service asks for a
 * [WalkPlan], runs ONE ValueAnimator for it (the same mechanism edge-snap
 * already uses), and goes back to complete stillness when it ends. IDLE
 * therefore costs zero position updates (spec §28).
 *
 * Hard rules encoded here:
 *  - a stroll is 50–120dp, never a screen crossing (spec §5)
 *  - duration 300–800ms scaled by distance (spec §8)
 *  - the pet stays inside [SafeRect] — status bar / nav / gesture zones and
 *    (when known) the keyboard are simply outside the walkable world (§7/§32)
 */
object PetMovementController {

    /** Walkable bounds in window pixels, already inset by system bars etc. */
    data class SafeRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        fun clampX(x: Int, petSizePx: Int): Int = max(left, min(x, right - petSizePx))
        fun clampY(y: Int, petSizePx: Int): Int = max(top, min(y, bottom - petSizePx))
        fun width(): Int = max(0, right - left)
        fun height(): Int = max(0, bottom - top)
    }

    /** One short stroll: where to go, how long, and how many little hops. */
    data class WalkPlan(
        val fromX: Int,
        val toX: Int,
        val durationMs: Long,
        /** Foot-bob cycles the renderer should play while moving. */
        val hops: Int,
        /** true → pet faces left while walking. */
        val facingLeft: Boolean,
    )

    const val MIN_STEP_DP = 50
    const val MAX_STEP_DP = 120
    const val MIN_DURATION_MS = 300L
    const val MAX_DURATION_MS = 800L

    /**
     * Plans a small horizontal stroll from [currentXPx], or null when there is
     * no room to walk anywhere (tiny safe area — e.g. keyboard up).
     */
    fun planWalk(
        currentXPx: Int,
        petSizePx: Int,
        density: Float,
        safe: SafeRect,
        random: Random = Random.Default,
    ): WalkPlan? {
        if (safe.width() < petSizePx + (MIN_STEP_DP * density).toInt()) return null

        val minStepPx = (MIN_STEP_DP * density).toInt()
        val maxStepPx = (MAX_STEP_DP * density).toInt()
        val stepPx = minStepPx + random.nextInt(max(1, maxStepPx - minStepPx))

        val roomLeft = currentXPx - safe.left
        val roomRight = (safe.right - petSizePx) - currentXPx
        // Prefer the side with room; when both fit, pick randomly so the pet
        // doesn't drift to one corner over a day.
        val goLeft = when {
            roomLeft < stepPx && roomRight < stepPx -> return null
            roomLeft < stepPx -> false
            roomRight < stepPx -> true
            else -> random.nextBoolean()
        }
        val target = if (goLeft) currentXPx - stepPx else currentXPx + stepPx
        val clamped = safe.clampX(target, petSizePx)
        if (abs(clamped - currentXPx) < minStepPx / 2) return null

        return WalkPlan(
            fromX = currentXPx,
            toX = clamped,
            durationMs = durationFor(abs(clamped - currentXPx), maxStepPx),
            hops = max(2, abs(clamped - currentXPx) / max(1, (28 * density).toInt())),
            facingLeft = goLeft,
        )
    }

    /** 300–800ms, proportional to how far the stroll actually is (spec §8). */
    fun durationFor(distancePx: Int, maxStepPx: Int): Long {
        if (maxStepPx <= 0) return MIN_DURATION_MS
        val t = min(1f, distancePx.toFloat() / maxStepPx)
        return (MIN_DURATION_MS + t * (MAX_DURATION_MS - MIN_DURATION_MS)).toLong()
    }

    /**
     * Follow-finger trailing position (spec §10): the pet aims for a point
     * OFFSET behind the finger, and only covers [followFactor] of the gap per
     * update, which is what makes it feel like a chase instead of a sticker.
     */
    fun followStep(
        petXPx: Int,
        petYPx: Int,
        fingerXPx: Int,
        fingerYPx: Int,
        petSizePx: Int,
        density: Float,
        safe: SafeRect,
        followFactor: Float = 0.35f,
        offsetDp: Int = 40,
    ): PetPositionManager.PixelPosition {
        val trailPx = (offsetDp * density).toInt()
        val cx = petXPx + petSizePx / 2
        val cy = petYPx + petSizePx / 2
        // The pet keeps whatever gap it already has, capped at the trailing
        // distance: grabbing it never teleports it sideways, small jiggles do
        // nothing, and a real drag settles into a steady offsetDp lag on the
        // side the pet naturally ended up on.
        val targetCx = fingerXPx + (cx - fingerXPx).coerceIn(-trailPx, trailPx)
        val targetCy = fingerYPx + (cy - fingerYPx).coerceIn(-trailPx, trailPx)
        val nextX = petXPx + ((targetCx - petSizePx / 2 - petXPx) * followFactor).toInt()
        val nextY = petYPx + ((targetCy - petSizePx / 2 - petYPx) * followFactor).toInt()
        return PetPositionManager.PixelPosition(
            safe.clampX(nextX, petSizePx),
            safe.clampY(nextY, petSizePx),
        )
    }
}
