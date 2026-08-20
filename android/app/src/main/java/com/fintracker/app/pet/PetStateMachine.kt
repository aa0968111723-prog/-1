package com.fintracker.app.pet

/**
 * The pet's animation state machine.
 *
 * Components never drive the renderer directly — they request states here and
 * the machine decides what actually shows. Priority order (highest first):
 *
 *   ERROR > SUCCESS/CELEBRATE > SAVING/THINKING/LISTENING > DRAGGING >
 *   EDGE_PEEK > finance mood (HAPPY/CAUTION/SLEEP) > IDLE decorations
 *
 * so a save confirmation can never be cut short by an idle blink, and a
 * failure is never hidden behind a cheerful animation.
 *
 * Pure Kotlin with an injected clock, so the whole thing is JVM-testable.
 */
class PetStateMachine(private val clock: () -> Long = { System.currentTimeMillis() }) {

    /** Long-lived mood derived from finance state, pushed by the web layer. */
    @Volatile
    var baseMood: String = PetState.IDLE

    private var transientState: String? = null
    private var transientUntil: Long = 0L
    private var transientPriority: Int = 0

    /**
     * Requests a transient state for [durationMs]. Returns true when accepted
     * (priority at least as high as the active transient, or that one has
     * expired). A rejected request must simply not animate.
     */
    @Synchronized
    fun request(state: String, durationMs: Long): Boolean {
        val now = clock()
        val activePriority = if (transientState != null && now < transientUntil) transientPriority else -1
        if (priorityOf(state) < activePriority) return false
        transientState = state
        transientUntil = now + durationMs
        transientPriority = priorityOf(state)
        return true
    }

    /** Ends the active transient early (e.g. drag released, listening stopped). */
    @Synchronized
    fun clearTransient(state: String? = null) {
        if (state == null || transientState == state) {
            transientState = null
            transientUntil = 0L
            transientPriority = 0
        }
    }

    /** The state the renderer should show right now. */
    @Synchronized
    fun current(): String {
        val t = transientState
        return if (t != null && clock() < transientUntil) t else baseMood
    }

    @Synchronized
    fun isTransientActive(): Boolean = transientState != null && clock() < transientUntil

    /**
     * Idle decorations (blink / look / breathe) may only run when nothing more
     * important is showing and the base mood is a calm one.
     */
    fun idleTickAllowed(): Boolean = !isTransientActive() && baseMood in CALM_MOODS

    /** A random idle decoration, or null when idling should stay still. */
    fun pickIdleDecoration(seed: Int): String? {
        if (!idleTickAllowed()) return null
        return IDLE_DECORATIONS[Math.floorMod(seed, IDLE_DECORATIONS.size)]
    }

    companion object {
        private val PRIORITIES = mapOf(
            PetState.ERROR to 120,
            PetState.SUCCESS to 100,
            PetState.CELEBRATE to 95,
            PetState.SAVING to 80,
            PetState.THINKING to 78,
            PetState.LISTENING to 76,
            PetState.DRAGGING to 70,
            // Follow-finger is a live user interaction — same band as dragging.
            PetState.FOLLOW_FINGER to 70,
            PetState.SURPRISED to 60,
            PetState.EDGE_PEEK to 50,
            PetState.EDGE_REST to 50,
            PetState.CAUTION to 40,
            PetState.REMINDER to 40,
            PetState.HAPPY to 35,
            PetState.SHY to 32,
            PetState.WAKE to 30,
            PetState.GREET to 28,
            PetState.SLEEP to 25,
            PetState.DEEP_SLEEP to 25,
            // Autonomous behaviours sit above idle decorations but below
            // everything a user or the finance flow triggers (spec §39).
            PetState.WALK to 14,
            PetState.STRETCH to 14,
            PetState.CURIOUS to 12,
            PetState.BLINK to 10,
            PetState.LOOK to 10,
            PetState.IDLE to 10,
        )

        /** Moods over which a decorative blink/look is tasteful. */
        private val CALM_MOODS = setOf(PetState.IDLE, PetState.HAPPY, PetState.SLEEP, PetState.SAVING)

        private val IDLE_DECORATIONS = listOf(PetState.BLINK, PetState.LOOK, PetState.IDLE)

        fun priorityOf(state: String): Int = PRIORITIES[state] ?: 10
    }
}

/** The pet's states. Strings (not an enum) so they cross the JS bridge unchanged. */
object PetState {
    const val IDLE = "idle"
    const val BLINK = "blink"
    const val LOOK = "look"
    const val DRAGGING = "dragging"
    const val EDGE_PEEK = "edgePeek"
    const val LISTENING = "listening"
    const val THINKING = "thinking"
    const val SAVING = "saving"
    const val SUCCESS = "success"
    const val HAPPY = "happy"
    const val CAUTION = "warning"
    const val CELEBRATE = "celebrate"
    const val SLEEP = "sleepy"
    const val WAKE = "wake"
    const val ERROR = "error"

    // --- V2: autonomous life + richer interaction -------------------------
    /** Short self-initiated stroll (never while the user is interacting). */
    const val WALK = "walk"
    /** Wave hello (screen-on greeting / settings preview). */
    const val GREET = "wave"
    /** Morning stretch. */
    const val STRETCH = "stretch"
    /** Head-tilt curiosity while looking around. */
    const val CURIOUS = "curious"
    /** Bashful reaction (e.g. after a long stare). */
    const val SHY = "shy"
    /** Picked-up / unexpected-poke reaction. */
    const val SURPRISED = "surprised"
    /** Trailing the user's finger with a soft offset (not a rigid stick). */
    const val FOLLOW_FINGER = "followFinger"
    /** Resting half-tucked at the screen edge (deliberate, not collapsed). */
    const val EDGE_REST = "edgeRest"
    /** Fully asleep (night / long idle); [SLEEP] stays the drowsy face. */
    const val DEEP_SLEEP = "sleep"
    /** Gentle nudge (budget approaching / record reminder). Never angry. */
    const val REMINDER = "reminder"
}
