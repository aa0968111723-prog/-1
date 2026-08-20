package com.fintracker.app.pet

import kotlin.random.Random

/**
 * Decides the pet's next autonomous behaviour — the "life" layer.
 *
 * Design contract (spec §6/§9/§28):
 *  - This class OWNS NO TIMERS. It is a pure decision function: the service
 *    asks "what next, and in how long?", keeps exactly one pending callback,
 *    and asks again when that fires or when context changes. Timers can
 *    therefore never accumulate.
 *  - Deterministic under an injected [Random] and clock, so every rule here
 *    is JVM-testable.
 *  - It only ever proposes AUTONOMOUS-band behaviours. Anything the user or
 *    the finance flow triggers goes straight to the state machine and wins
 *    by priority; the scheduler simply gets rescheduled afterwards.
 *
 * Activity levels (spec §9): quiet = blink only; natural = occasional small
 * walks; lively = more frequent, still polite.
 */
class PetBehaviorScheduler(
    private val random: Random = Random.Default,
) {

    /** Everything the scheduler may look at. Assembled by the service. */
    data class Context(
        val nowMs: Long,
        val hourOfDay: Int,
        val screenOn: Boolean,
        val quickAddOpen: Boolean,
        val menuOpen: Boolean,
        val dragging: Boolean,
        val collapsed: Boolean,
        val powerSave: Boolean,
        /** "full" or "simple" — simple also means reduce-motion (spec §48). */
        val animationLevel: String,
        /** quiet | natural | lively (spec §9). */
        val activityLevel: String,
        /** Autonomous walking master switch (小財互動頁). */
        val autonomousEnabled: Boolean,
        /** Sleep-mode master switch. */
        val sleepEnabled: Boolean,
        val lastUserInteractionMs: Long,
        val lastWalkMs: Long,
        val lastStretchDayOfYear: Int,
        val baseMood: String,
    )

    /** What to do, and when. The service schedules exactly one of these. */
    data class Decision(val behavior: String, val delayMs: Long)

    object Behavior {
        const val NONE = "none"
        const val BLINK = "blink"
        const val LOOK = "look"
        const val WALK = "walk"
        const val STRETCH = "stretch"
        const val SLEEP = "sleep"
        const val CURIOUS = "curious"
    }

    /**
     * The next autonomous behaviour for [ctx], or a NONE decision with a
     * re-check delay when the pet must hold still.
     */
    fun next(ctx: Context): Decision {
        // Hard stops: nothing autonomous while the screen is off, the user is
        // mid-entry, mid-drag, or the pet is tucked away. Recheck lazily —
        // the service also re-asks on every state change, so a long delay
        // here costs nothing.
        if (!ctx.screenOn || ctx.quickAddOpen || ctx.menuOpen || ctx.dragging || ctx.collapsed) {
            return Decision(Behavior.NONE, RECHECK_MS)
        }
        // Reduce-motion / simple animation: functional feedback only (§48).
        if (ctx.animationLevel != "full") return Decision(Behavior.NONE, RECHECK_MS)

        val effectiveLevel = if (ctx.powerSave) LEVEL_QUIET else ctx.activityLevel
        val night = ctx.hourOfDay >= NIGHT_START_HOUR || ctx.hourOfDay < NIGHT_END_HOUR
        val idleMs = ctx.nowMs - ctx.lastUserInteractionMs

        // Morning stretch, once per day, only when actually morning (§15).
        // Checked BEFORE sleep: after a whole night of no interaction idleMs
        // is huge, and sleep would otherwise win every morning forever.
        if (ctx.hourOfDay in MORNING_HOURS && ctx.lastStretchDayOfYear != dayOfYearTag(ctx)) {
            return Decision(Behavior.STRETCH, between(2_000L, 6_000L))
        }

        // Night or a long stretch of no interaction → sleep (spec §14/§15),
        // unless the user turned sleep mode off. (After the morning stretch
        // the pet is allowed to doze back off if the user stays away.)
        if (ctx.sleepEnabled && (night || idleMs >= SLEEP_AFTER_IDLE_MS)) {
            return Decision(Behavior.SLEEP, between(4_000L, 9_000L))
        }

        // Quiet: blinks only, spaced far apart (§9).
        if (effectiveLevel == LEVEL_QUIET) {
            return Decision(Behavior.BLINK, between(14_000L, 30_000L))
        }

        val lively = effectiveLevel == LEVEL_LIVELY
        val walkCooldownMs = if (lively) WALK_COOLDOWN_LIVELY_MS else WALK_COOLDOWN_NATURAL_MS
        val walkAllowed = ctx.autonomousEnabled && ctx.nowMs - ctx.lastWalkMs >= walkCooldownMs

        // Weighted pick. Walks stay rare even on lively — life comes from
        // many small motions, not from pacing around (spec §5).
        val roll = random.nextInt(100)
        return when {
            walkAllowed && roll < (if (lively) 22 else 12) ->
                Decision(Behavior.WALK, between(if (lively) 45_000L else 75_000L, if (lively) 90_000L else 180_000L))
            roll < 40 -> Decision(Behavior.LOOK, between(20_000L, 60_000L))
            roll < 52 -> Decision(Behavior.CURIOUS, between(25_000L, 70_000L))
            else -> Decision(Behavior.BLINK, between(8_000L, 22_000L))
        }
    }

    /** Greeting roll on screen-on / return (spec §13): sometimes, never always. */
    fun shouldGreet(nowMs: Long, lastGreetMs: Long, greetingsEnabled: Boolean, powerSave: Boolean): Boolean {
        if (!greetingsEnabled || powerSave) return false
        if (nowMs - lastGreetMs < GREET_MIN_INTERVAL_MS) return false
        return random.nextInt(100) < GREET_CHANCE_PERCENT
    }

    private fun between(min: Long, max: Long): Long =
        if (max <= min) min else min + random.nextLong(max - min)

    private fun dayOfYearTag(ctx: Context): Int =
        // Cheap same-day tag derived from the clock; the service stores what
        // this returned when the stretch actually played.
        ((ctx.nowMs + LOCAL_EPOCH_BIAS_MS) / DAY_MS).toInt()

    companion object {
        const val LEVEL_QUIET = "quiet"
        const val LEVEL_NATURAL = "natural"
        const val LEVEL_LIVELY = "lively"

        /** Delay used when autonomous life is paused; context changes re-ask sooner. */
        const val RECHECK_MS = 30_000L

        const val NIGHT_START_HOUR = 23
        const val NIGHT_END_HOUR = 7
        private val MORNING_HOURS = 7..10

        const val SLEEP_AFTER_IDLE_MS = 6 * 60_000L
        const val WALK_COOLDOWN_NATURAL_MS = 90_000L
        const val WALK_COOLDOWN_LIVELY_MS = 45_000L

        const val GREET_MIN_INTERVAL_MS = 45 * 60_000L
        const val GREET_CHANCE_PERCENT = 30

        private const val DAY_MS = 24 * 60 * 60 * 1000L
        private const val LOCAL_EPOCH_BIAS_MS = 8 * 60 * 60 * 1000L // UTC+8 households

        /** How this scheduler-day is computed, exposed for the service. */
        fun dayTag(nowMs: Long): Int = ((nowMs + LOCAL_EPOCH_BIAS_MS) / DAY_MS).toInt()
    }
}
