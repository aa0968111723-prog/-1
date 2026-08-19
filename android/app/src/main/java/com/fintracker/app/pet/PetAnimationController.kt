package com.fintracker.app.pet

/**
 * Priority-based animation state machine for the pet.
 *
 * Components never drive the renderer directly — they request states here,
 * and the controller decides whether the request may interrupt the current
 * transient (a success bounce must not be cut short by an idle blink, but a
 * drag always wins over decoration). Pure Kotlin + injected clock so it is
 * JVM unit-testable.
 */
class PetAnimationController(private val clock: () -> Long = { System.currentTimeMillis() }) {

    /** Long-lived mood derived from finance state (idle/happy/warning/...). */
    @Volatile
    var baseMood: String = "idle"

    private var transientState: String? = null
    private var transientUntil: Long = 0L
    private var transientPriority: Int = 0

    /**
     * Requests a transient state for [durationMs]. Returns true when accepted
     * (equal or higher priority than the active transient, or the active one
     * has expired); a rejected request must simply not animate.
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

    /** Ends the active transient early (e.g. drag released). */
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

    /** Idle decorations (blink/breath/look) may only run over calm base moods. */
    fun idleTickAllowed(): Boolean =
        current() == baseMood && baseMood in CALM_MOODS

    companion object {
        /** Higher wins; interaction (drag) and functional feedback outrank decoration. */
        private val PRIORITIES = mapOf(
            "success" to 100,
            "celebrate" to 90,
            "dragging" to 80,
            "warning" to 60,
            "saving" to 50,
            "thinking" to 50,
            "happy" to 40,
            "edgePeek" to 30,
            "wake" to 25,
            "sleep" to 20,
            "blink" to 10,
            "lookLeft" to 10,
            "lookRight" to 10,
            "idle" to 10,
        )

        private val CALM_MOODS = setOf("idle", "happy", "sleepy", "saving")

        fun priorityOf(state: String): Int = PRIORITIES[state] ?: 10
    }
}
