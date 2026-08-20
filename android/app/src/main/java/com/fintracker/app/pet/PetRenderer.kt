package com.fintracker.app.pet

import android.content.Context
import android.view.View

/**
 * Abstraction between the overlay/finance layers and the pet's visual
 * implementation. The first version renders vector drawables; Rive/Lottie/
 * Live2D/sprite renderers can replace it later without touching the
 * service, gestures or finance logic.
 *
 * V2 additions all have no-op defaults so a minimal renderer stays valid —
 * every animation is a bounded one-shot; a renderer must NEVER run a
 * permanent loop (spec §二十八/§五十二).
 */
interface PetRenderer {

    /** The character view to place inside the floating window. */
    fun createView(context: Context): View

    /** idle | happy | thinking | saving | success | warning | sleepy | celebrate | V2 states */
    fun setMood(mood: String)

    /** "full" or "simple" — simple keeps only functional feedback animations. */
    fun setAnimationLevel(level: String)

    /** One-shot celebratory bounce after a transaction is saved. */
    fun playSuccess()

    /**
     * A single low-frequency idle animation step (blink/breath/look around).
     * Called occasionally by the host; each animation is short and ends on
     * its own — the renderer must never run a permanent animation loop.
     */
    fun playIdleTick()

    /** Cancel animations and drop view references. */
    fun release()

    // --- V2: life & interaction (all optional one-shots) -------------------

    /** Habit-level cosmetic: "hat" | "scarf" | "leaf" | null. */
    fun setAccessory(id: String?) {}

    /** Mirror the art so the pet faces its walking direction. */
    fun setFacing(left: Boolean) {}

    /** Little foot-bob cycles while the window is being moved on a stroll. */
    fun playWalkBob(hops: Int, totalDurationMs: Long) {}

    /** Head-tilt curiosity micro-animation. */
    fun playCurious() {}

    /** Wave hello (greeting / settings preview). */
    fun playWave() {}

    /** Morning stretch. */
    fun playStretch() {}

    /** Picked-up surprise face + tiny pop. */
    fun playSurprised() {}

    /** Small wing flutter while dragged. Must be cheap — called per move burst. */
    fun wiggleWings() {}

    /** Tiny landing hop after a drag release. */
    fun playSuccessHop() {}

    /** Milestone celebration (party hat + bounce). */
    fun playCelebrate() {}

    /** Deep sleep pose on/off (blanket + zzz layer; static while asleep). */
    fun setSleeping(sleeping: Boolean) {}

    /** Show a tiny prop (wallet/notebook/…) for a bounded moment. */
    fun showProp(prop: String, durationMs: Long) {}
}
