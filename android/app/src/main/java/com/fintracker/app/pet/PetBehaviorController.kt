package com.fintracker.app.pet

import kotlin.random.Random

/**
 * Orchestrates the pet's autonomous life (spec §三/§六/§三十九).
 *
 * Sits between [PetBehaviorScheduler] (pure decisions) and the service
 * (windows, animators). All framework side-effects go through [Effects] so
 * every rule in here — including "drag overrides walk" and "quick add
 * overrides sleep" — is JVM-testable with fakes.
 *
 * Threading: everything runs on the service's main-thread Handler; there is
 * exactly ONE pending scheduled tick at any moment (spec §二十八/§五十五).
 */
class PetBehaviorController(
    private val stateMachine: PetStateMachine,
    private val scheduler: PetBehaviorScheduler = PetBehaviorScheduler(),
    private val random: Random = Random.Default,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {

    /** Framework side the service implements. Each call is short and one-shot. */
    interface Effects {
        /** Re-arm the single behaviour timer. Replaces any previous one. */
        fun scheduleNextTick(delayMs: Long)
        /** Show a face/pose for a bounded moment (already accepted by the machine). */
        fun showTransient(state: String, durationMs: Long)
        /** Play one blink / look / curious micro-animation. */
        fun playMicroAnimation(kind: String)
        /**
         * Plan + run one short stroll (the service knows pixels/insets). Must
         * end by itself and report back via [onWalkFinished]; when no walk is
         * possible (e.g. keyboard shrank the safe area) call it immediately.
         */
        fun startWalk()
        /** Enter the deep-sleep pose (zzz layer on, no loops). */
        fun enterSleep()
        /** Leave sleep (stretch + wake face). */
        fun exitSleep()
        /** Wave + optional greeting bubble (spec §十三). */
        fun playGreeting()
        /** Morning stretch one-shot (spec §十五). */
        fun playStretch()
    }

    /** The service rebuilds this snapshot whenever asked. */
    fun interface ContextProvider {
        fun snapshot(): PetBehaviorScheduler.Context
    }

    var effects: Effects? = null
    var contextProvider: ContextProvider? = null

    /** True while a stroll animator is running (drag/tap must cancel it). */
    @Volatile
    var walking: Boolean = false
        private set

    @Volatile
    var sleeping: Boolean = false
        private set

    private var lastWalkMs: Long = 0L
    private var lastGreetMs: Long = 0L
    private var lastStretchDayTag: Int = -1

    // --- lifecycle ----------------------------------------------------------

    /** Kick (or re-kick) the loop. Safe to call repeatedly. */
    fun start() {
        effects?.scheduleNextTick(FIRST_TICK_MS)
    }

    /** Screen off / service teardown: stop everything, forget nothing. */
    fun pause() {
        walking = false
        // Sleep pose may persist visually; timers are the service's to clear.
    }

    // --- the single tick ----------------------------------------------------

    /** Called by the service when the behaviour timer fires. */
    fun tick() {
        val fx = effects ?: return
        val ctx = contextProvider?.snapshot() ?: return

        if (walking) { // A stroll is still in flight; just come back later.
            fx.scheduleNextTick(PetBehaviorScheduler.RECHECK_MS)
            return
        }

        val decision = scheduler.next(ctx)
        when (decision.behavior) {
            PetBehaviorScheduler.Behavior.NONE -> if (sleeping && (!ctx.sleepEnabled || !shouldStayAsleep(ctx))) wake()

            PetBehaviorScheduler.Behavior.SLEEP -> if (!sleeping) {
                if (stateMachine.request(PetState.DEEP_SLEEP, SLEEP_HOLD_MS)) {
                    sleeping = true
                    fx.enterSleep()
                }
            }

            PetBehaviorScheduler.Behavior.STRETCH -> {
                if (sleeping) wake()
                if (stateMachine.request(PetState.STRETCH, STRETCH_MS)) {
                    lastStretchDayTag = PetBehaviorScheduler.dayTag(ctx.nowMs)
                    fx.playStretch()
                }
            }

            PetBehaviorScheduler.Behavior.WALK -> {
                if (sleeping) {
                    wake()
                } else if (stateMachine.request(PetState.WALK, WALK_HOLD_MS)) {
                    lastWalkMs = ctx.nowMs
                    walking = true
                    fx.showTransient(PetState.WALK, WALK_HOLD_MS)
                    fx.startWalk()
                }
            }

            PetBehaviorScheduler.Behavior.BLINK,
            PetBehaviorScheduler.Behavior.LOOK,
            PetBehaviorScheduler.Behavior.CURIOUS -> {
                if (sleeping) {
                    // Asleep pets don't blink; nothing to do until wake rules fire.
                } else if (stateMachine.idleTickAllowed()) {
                    fx.playMicroAnimation(decision.behavior)
                }
            }
        }
        fx.scheduleNextTick(decision.delayMs)
    }

    // --- interruptions (spec §三十九/§四十) ---------------------------------

    /**
     * Any user touch: cancels autonomy immediately and wakes a sleeping pet.
     * Returns true when it WAS asleep so the caller can play the wake pose —
     * but the tap itself must still do its job: spec §四十 says Quick Add
     * always wins, even over sleep. Waking and opening happen together.
     */
    fun onUserInteraction(): Boolean {
        walking = false
        stateMachine.clearTransient(PetState.WALK)
        stateMachine.clearTransient(PetState.STRETCH)
        val wasAsleep = sleeping
        if (wasAsleep) wake()
        effects?.scheduleNextTick(AFTER_INTERACTION_MS)
        return wasAsleep
    }

    /** Drag started: hard-stop any stroll (spec: drag overrides walk). */
    fun onDragStart() {
        walking = false
        stateMachine.clearTransient(PetState.WALK)
        if (sleeping) wake()
    }

    /** Quick Add opened: pet freezes politely whatever it was doing (§四十). */
    fun onQuickAddOpened() {
        walking = false
        stateMachine.clearTransient(PetState.WALK)
        if (sleeping) wake()
        effects?.scheduleNextTick(PetBehaviorScheduler.RECHECK_MS)
    }

    /** Screen back on — maybe greet (spec §十三). */
    fun onScreenOn(greetingsEnabled: Boolean, powerSave: Boolean) {
        val now = clock()
        if (scheduler.shouldGreet(now, lastGreetMs, greetingsEnabled, powerSave)) {
            if (stateMachine.request(PetState.GREET, GREET_MS)) {
                lastGreetMs = now
                effects?.playGreeting()
            }
        }
        effects?.scheduleNextTick(FIRST_TICK_MS)
    }

    /** The service reports a finished (or impossible) stroll. */
    fun onWalkFinished() {
        walking = false
        stateMachine.clearTransient(PetState.WALK)
    }

    private fun wake() {
        sleeping = false
        stateMachine.clearTransient(PetState.DEEP_SLEEP)
        stateMachine.request(PetState.WAKE, WAKE_MS)
        effects?.exitSleep()
    }

    private fun shouldStayAsleep(ctx: PetBehaviorScheduler.Context): Boolean {
        val night = ctx.hourOfDay >= PetBehaviorScheduler.NIGHT_START_HOUR ||
            ctx.hourOfDay < PetBehaviorScheduler.NIGHT_END_HOUR
        val idleMs = ctx.nowMs - ctx.lastUserInteractionMs
        return night || idleMs >= PetBehaviorScheduler.SLEEP_AFTER_IDLE_MS
    }

    /** Context helpers the service uses when building the scheduler snapshot. */
    fun lastWalkMs(): Long = lastWalkMs
    fun lastStretchDayTag(): Int = lastStretchDayTag

    companion object {
        const val FIRST_TICK_MS = 6_000L
        const val AFTER_INTERACTION_MS = 20_000L
        const val WALK_HOLD_MS = 4_000L
        const val STRETCH_MS = 1_800L
        const val GREET_MS = 1_600L
        const val WAKE_MS = 1_200L
        const val SLEEP_HOLD_MS = 10 * 60_000L
    }
}
