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
 * V2 layering (bottom → top): wings, body, face, accessory, prop, zzz.
 * An expression change is a drawable swap rather than a redraw, and a future
 * Rive/Lottie/sprite renderer can replace any layer without touching the
 * others. No finance logic lives here; it only reflects the state the
 * service hands it.
 *
 * Animations are event-driven one-shots. Nothing loops, so an idle pet costs
 * nothing between ticks (spec §二十八).
 */
class DrawablePetRenderer : PetRenderer {

    private var root: FrameLayout? = null
    private var wings: ImageView? = null
    private var body: ImageView? = null
    private var face: ImageView? = null
    private var accessory: ImageView? = null
    private var prop: ImageView? = null
    private var zzz: ImageView? = null

    private var animationLevel: String = "full"
    private var mood: String = PetState.IDLE
    /** Unlocked cosmetic, or null. Set by the host from the pet's level. */
    private var accessoryId: String? = null
    private var sleeping = false
    private var facingLeft = false

    // Pending view.postDelayed restores, kept so release() can unwind them
    // instead of letting them poke at a detached view tree.
    private var faceRestore: Runnable? = null
    private var propHide: Runnable? = null

    /** Horizontal sign for the current facing; scale animations multiply by this. */
    private fun dir(): Float = if (facingLeft) -1f else 1f

    private fun postFaceRestore(delayMs: Long) {
        val f = face ?: return
        faceRestore?.let { f.removeCallbacks(it) }
        val r = Runnable { applyMood() }
        faceRestore = r
        f.postDelayed(r, delayMs)
    }

    private fun postPropHide(delayMs: Long) {
        val p = prop ?: return
        propHide?.let { p.removeCallbacks(it) }
        val r = Runnable { if (!sleeping) p.visibility = View.GONE }
        propHide = r
        p.postDelayed(r, delayMs)
    }

    override fun createView(context: Context): View {
        val container = FrameLayout(context)
        fun layer(): ImageView = ImageView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
        val wingsView = layer().apply { setImageResource(R.drawable.ic_pet_wings) }
        val bodyView = layer().apply { setImageResource(R.drawable.ic_pet_body) }
        val faceView = layer()
        val accessoryView = layer().apply { visibility = View.GONE }
        val propView = layer().apply { visibility = View.GONE }
        val zzzView = layer().apply { visibility = View.GONE; setImageResource(R.drawable.ic_pet_zzz) }

        container.addView(wingsView)
        container.addView(bodyView)
        container.addView(faceView)
        container.addView(accessoryView)
        container.addView(propView)
        container.addView(zzzView)

        root = container
        wings = wingsView
        body = bodyView
        face = faceView
        accessory = accessoryView
        prop = propView
        zzz = zzzView
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
    override fun setAccessory(id: String?) {
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
        if (animationLevel != "full" || sleeping) return
        val v = body ?: return
        val f = face ?: return
        when (Random.nextInt(4)) {
            0 -> { // breathe
                v.animate().cancel()
                v.animate().scaleX(1.04f).scaleY(0.97f).setDuration(500).withEndAction {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(500).start()
                }.start()
            }
            1 -> { // blink: swap the face for a moment, then restore
                f.setImageResource(R.drawable.ic_pet_face_blink)
                postFaceRestore(130)
            }
            2 -> { // sprout/wing flutter — small life without moving anywhere
                wiggleWings()
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

    // --- V2 one-shots -------------------------------------------------------

    override fun setFacing(left: Boolean) {
        facingLeft = left
        root?.scaleX = dir()
    }

    override fun playWalkBob(hops: Int, totalDurationMs: Long) {
        if (animationLevel != "full") return
        val v = root ?: return
        val per = (totalDurationMs / (hops * 2).coerceAtLeast(1)).coerceAtLeast(60L)
        v.animate().cancel()
        fun bob(remaining: Int) {
            if (remaining <= 0 || root == null) {
                v.animate().translationY(0f).setDuration(per).start()
                return
            }
            v.animate().translationY(-v.height * 0.06f).setDuration(per).withEndAction {
                v.animate().translationY(0f).setDuration(per).withEndAction { bob(remaining - 1) }.start()
            }.start()
        }
        bob(hops.coerceIn(1, 8))
    }

    override fun playCurious() {
        if (animationLevel != "full" || sleeping) return
        val f = face ?: return
        val group = root ?: return
        f.setImageResource(R.drawable.ic_pet_face_curious)
        group.animate().cancel()
        group.animate().rotation(if (facingLeft) 8f else -8f).setDuration(260).withEndAction {
            group.animate().rotation(0f).setStartDelay(420).setDuration(260).withEndAction {
                group.animate().setStartDelay(0)
                applyMood()
            }.start()
        }.start()
    }

    override fun playWave() {
        val w = wings ?: return
        val f = face ?: return
        f.setImageResource(R.drawable.ic_pet_face_happy)
        if (animationLevel == "full") {
            w.pivotX = w.width * 0.2f
            w.pivotY = w.height * 0.55f
            w.animate().cancel()
            w.animate().rotation(14f).setDuration(160).withEndAction {
                w.animate().rotation(-8f).setDuration(160).withEndAction {
                    w.animate().rotation(10f).setDuration(150).withEndAction {
                        w.animate().rotation(0f).setDuration(140).withEndAction { applyMood() }.start()
                    }.start()
                }.start()
            }.start()
        } else {
            postFaceRestore(900)
        }
    }

    override fun playStretch() {
        if (animationLevel != "full") return
        val v = root ?: return
        v.animate().cancel()
        v.animate().scaleY(1.12f).scaleX(dir() * 0.94f).setDuration(420).withEndAction {
            v.animate().scaleY(1f).scaleX(dir()).setDuration(360).start()
        }.start()
    }

    override fun playSurprised() {
        val f = face ?: return
        f.setImageResource(R.drawable.ic_pet_face_surprised)
        if (animationLevel == "full") {
            val v = root ?: return
            v.animate().cancel()
            // translationY(0) also settles any walk-bob frozen mid-hop by the
            // cancel above, so being picked up never leaves the pet floating.
            v.animate().scaleX(dir() * 1.08f).scaleY(1.08f).translationY(0f).setDuration(90).withEndAction {
                v.animate().scaleX(dir()).scaleY(1f).setDuration(140).start()
            }.start()
        }
    }

    override fun wiggleWings() {
        if (animationLevel != "full") return
        val w = wings ?: return
        if (w.animation != null || w.rotation != 0f) return // already mid-flap; stay cheap
        w.animate().rotation(6f).setDuration(90).withEndAction {
            w.animate().rotation(0f).setDuration(120).start()
        }.start()
    }

    override fun playSuccessHop() {
        if (animationLevel != "full") return
        val v = root ?: return
        v.animate().translationY(-v.height * 0.10f).setDuration(110).withEndAction {
            v.animate().translationY(0f).setDuration(160).start()
        }.start()
    }

    override fun playCelebrate() {
        val p = prop ?: return
        p.setImageResource(R.drawable.ic_pet_prop_party_hat)
        p.visibility = View.VISIBLE
        playSuccess()
        postPropHide(2_400L)
    }

    override fun setSleeping(sleeping: Boolean) {
        this.sleeping = sleeping
        val p = prop ?: return
        val z = zzz ?: return
        if (sleeping) {
            face?.setImageResource(R.drawable.ic_pet_face_sleep)
            p.setImageResource(R.drawable.ic_pet_prop_blanket)
            p.visibility = View.VISIBLE
            z.visibility = View.VISIBLE
            z.alpha = 0.9f
            body?.alpha = 0.92f
        } else {
            p.visibility = View.GONE
            z.visibility = View.GONE
            body?.alpha = 1f
            applyMood()
        }
    }

    override fun showProp(prop: String, durationMs: Long) {
        val p = this.prop ?: return
        val res = when (prop) {
            "wallet" -> R.drawable.ic_pet_prop_wallet
            "notebook" -> R.drawable.ic_pet_prop_notebook
            "blanket" -> R.drawable.ic_pet_prop_blanket
            "partyHat" -> R.drawable.ic_pet_prop_party_hat
            else -> 0
        }
        if (res == 0) return
        p.setImageResource(res)
        p.visibility = View.VISIBLE
        postPropHide(durationMs)
    }

    override fun release() {
        root?.animate()?.cancel()
        body?.animate()?.cancel()
        face?.animate()?.cancel()
        wings?.animate()?.cancel()
        faceRestore?.let { face?.removeCallbacks(it) }
        propHide?.let { prop?.removeCallbacks(it) }
        faceRestore = null
        propHide = null
        root = null
        wings = null
        body = null
        face = null
        accessory = null
        prop = null
        zzz = null
    }

    private fun applyMood() {
        val f = face ?: return
        if (sleeping) {
            f.setImageResource(R.drawable.ic_pet_face_sleep)
            return
        }
        f.setImageResource(faceFor(mood))
        // Drowsy is the only state that dims the character at all.
        body?.alpha = if (mood == PetState.SLEEP) 0.9f else 1f
    }

    private fun applyAccessory() {
        val a = accessory ?: return
        val res = when (accessoryId) {
            "hat" -> R.drawable.ic_pet_accessory_hat
            "scarf" -> R.drawable.ic_pet_accessory_scarf
            "leaf" -> R.drawable.ic_pet_accessory_leaf
            // 沒有戰利品時帶著小錢包 —— 和 web 版 PetSprite 同一隻角色。
            else -> R.drawable.ic_pet_prop_wallet
        }
        a.setImageResource(res)
        a.visibility = View.VISIBLE
    }

    companion object {
        /** Expression for a state. Unknown states fall back to the neutral face. */
        fun faceFor(mood: String): Int = when (mood) {
            PetState.HAPPY, PetState.SUCCESS, PetState.CELEBRATE, PetState.GREET -> R.drawable.ic_pet_face_happy
            PetState.SLEEP, PetState.DEEP_SLEEP -> R.drawable.ic_pet_face_sleep
            PetState.CAUTION, PetState.ERROR -> R.drawable.ic_pet_face_concern
            PetState.REMINDER -> R.drawable.ic_pet_face_idle
            PetState.BLINK -> R.drawable.ic_pet_face_blink
            PetState.SURPRISED, PetState.FOLLOW_FINGER -> R.drawable.ic_pet_face_surprised
            PetState.CURIOUS, PetState.WALK -> R.drawable.ic_pet_face_curious
            PetState.SHY -> R.drawable.ic_pet_face_shy
            else -> R.drawable.ic_pet_face_idle
        }
    }
}
