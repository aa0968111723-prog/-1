package com.fintracker.app.pet

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import com.fintracker.app.R
import kotlin.random.Random

/**
 * Default vector renderer for 小財: a round, warm little finance companion.
 *
 * The character is layered — body, face, accessory — so an expression change
 * is a drawable swap rather than a redraw, and so a future Rive/Lottie/sprite
 * renderer can replace one layer without touching the others. No finance
 * logic lives here; it only reflects the state the service hands it.
 *
 * Animations are event-driven one-shots. Nothing loops, so an idle pet costs
 * nothing between ticks.
 */
class DrawablePetRenderer : PetRenderer {

    private var root: FrameLayout? = null
    private var body: ImageView? = null
    private var face: ImageView? = null
    private var accessory: ImageView? = null

    private var animationLevel: String = "full"
    private var mood: String = PetState.IDLE
    /** Unlocked cosmetic, or null. Set by the host from the pet's level. */
    private var accessoryId: String? = null

    override fun createView(context: Context): View {
        val container = FrameLayout(context)
        fun layer(): ImageView = ImageView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
        val bodyView = layer().apply { setImageResource(R.drawable.ic_pet_body) }
        val faceView = layer()
        val accessoryView = layer().apply { visibility = View.GONE }

        container.addView(bodyView)
        container.addView(faceView)
        container.addView(accessoryView)

        root = container
        body = bodyView
        face = faceView
        accessory = accessoryView
        applyMood()
        applyAccessory()
        return container
    }

    override fun setMood(mood: String) {
        this.mood = mood
        applyMood()
    }

    override fun setAnimationLevel(level: String) {
        animationLevel = level
    }

    /** Cosmetics unlocked by habit level: "hat" | "scarf" | "leaf" | null. */
    fun setAccessory(id: String?) {
        accessoryId = id
        applyAccessory()
    }

    override fun playSuccess() {
        val v = root ?: return
        setMood(PetState.HAPPY)
        v.animate().cancel()
        if (animationLevel != "full") return
        v.animate()
            .translationY(-v.height * 0.18f)
            .setDuration(140)
            .withEndAction { v.animate().translationY(0f).setDuration(220).start() }
            .start()
    }

    override fun playIdleTick() {
        if (animationLevel != "full") return
        val v = body ?: return
        val f = face ?: return
        when (Random.nextInt(3)) {
            0 -> { // breathe
                v.animate().cancel()
                v.animate().scaleX(1.04f).scaleY(0.97f).setDuration(500).withEndAction {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(500).start()
                }.start()
            }
            1 -> { // blink: swap the face for a moment, then restore
                f.setImageResource(R.drawable.ic_pet_face_blink)
                f.postDelayed({ applyMood() }, 130)
            }
            else -> { // look around
                val group = root ?: return
                group.animate().cancel()
                group.animate().rotation(5f).setDuration(300).withEndAction {
                    group.animate().rotation(-5f).setDuration(500).withEndAction {
                        group.animate().rotation(0f).setDuration(300).start()
                    }.start()
                }.start()
            }
        }
    }

    override fun release() {
        root?.animate()?.cancel()
        body?.animate()?.cancel()
        face?.removeCallbacks(null)
        root = null
        body = null
        face = null
        accessory = null
    }

    private fun applyMood() {
        val f = face ?: return
        f.setImageResource(faceFor(mood))
        // Sleeping is the only state that dims the character at all.
        body?.alpha = if (mood == PetState.SLEEP) 0.9f else 1f
    }

    private fun applyAccessory() {
        val a = accessory ?: return
        val res = when (accessoryId) {
            "hat" -> R.drawable.ic_pet_accessory_hat
            "scarf" -> R.drawable.ic_pet_accessory_scarf
            "leaf" -> R.drawable.ic_pet_accessory_leaf
            else -> 0
        }
        if (res == 0) {
            a.visibility = View.GONE
        } else {
            a.setImageResource(res)
            a.visibility = View.VISIBLE
        }
    }

    companion object {
        /** Expression for a state. Unknown states fall back to the neutral face. */
        fun faceFor(mood: String): Int = when (mood) {
            PetState.HAPPY, PetState.SUCCESS, PetState.CELEBRATE -> R.drawable.ic_pet_face_happy
            PetState.SLEEP -> R.drawable.ic_pet_face_sleep
            PetState.CAUTION, PetState.ERROR -> R.drawable.ic_pet_face_concern
            PetState.BLINK -> R.drawable.ic_pet_face_blink
            else -> R.drawable.ic_pet_face_idle
        }
    }
}
