package com.fintracker.app.pet

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.fintracker.app.R
import kotlin.random.Random

/**
 * Default vector-drawable renderer for 小財: a round, cozy little finance
 * guardian. Animations are event-driven one-shots (no永久 loop) to stay
 * battery friendly.
 */
class DrawablePetRenderer : PetRenderer {

    private var root: FrameLayout? = null
    private var body: ImageView? = null
    private var moodBadge: TextView? = null
    private var animationLevel: String = "full"
    private var mood: String = "idle"

    override fun createView(context: Context): View {
        val container = FrameLayout(context)
        val image = ImageView(context).apply {
            setImageResource(R.drawable.ic_pet_body)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
        val badge = TextView(context).apply {
            textSize = 14f
            text = ""
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END,
            )
        }
        container.addView(image)
        container.addView(badge)
        root = container
        body = image
        moodBadge = badge
        applyMood()
        return container
    }

    override fun setMood(mood: String) {
        this.mood = mood
        applyMood()
    }

    override fun setAnimationLevel(level: String) {
        animationLevel = level
    }

    override fun playSuccess() {
        val v = root ?: return
        v.animate().cancel()
        v.animate()
            .translationY(-v.height * 0.18f)
            .setDuration(140)
            .withEndAction {
                v.animate()
                    .translationY(0f)
                    .setDuration(220)
                    .start()
            }
            .start()
    }

    override fun playIdleTick() {
        if (animationLevel != "full") return
        val v = body ?: return
        when (Random.nextInt(3)) {
            0 -> { // breath
                v.animate().cancel()
                v.animate().scaleX(1.05f).scaleY(0.96f).setDuration(500).withEndAction {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(500).start()
                }.start()
            }
            1 -> { // quick blink-ish squash
                v.animate().cancel()
                v.animate().scaleY(0.9f).setDuration(110).withEndAction {
                    v.animate().scaleY(1f).setDuration(110).start()
                }.start()
            }
            else -> { // look around
                v.animate().cancel()
                v.animate().rotation(6f).setDuration(300).withEndAction {
                    v.animate().rotation(-6f).setDuration(500).withEndAction {
                        v.animate().rotation(0f).setDuration(300).start()
                    }.start()
                }.start()
            }
        }
    }

    override fun release() {
        root?.animate()?.cancel()
        body?.animate()?.cancel()
        root = null
        body = null
        moodBadge = null
    }

    private fun applyMood() {
        moodBadge?.text = when (mood) {
            "success", "happy" -> "✨"
            "celebrate" -> "🎉"
            "warning" -> "💭"
            "sleepy" -> "💤"
            "saving" -> "🎯"
            "thinking" -> "…"
            else -> ""
        }
        body?.alpha = if (mood == "sleepy") 0.85f else 1f
    }
}
