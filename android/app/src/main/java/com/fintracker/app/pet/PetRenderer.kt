package com.fintracker.app.pet

import android.content.Context
import android.view.View

/**
 * Abstraction between the overlay/finance layers and the pet's visual
 * implementation. The first version renders vector drawables; Rive/Lottie/
 * Live2D/sprite renderers can replace it later without touching the
 * service, gestures or finance logic.
 */
interface PetRenderer {

    /** The character view to place inside the floating window. */
    fun createView(context: Context): View

    /** idle | happy | thinking | saving | success | warning | sleepy | celebrate */
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
}
