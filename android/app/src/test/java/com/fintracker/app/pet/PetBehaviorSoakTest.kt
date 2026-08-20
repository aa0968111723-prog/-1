package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * Spec §五十五 壓力測試: simulate an hour of pet life at high event rates and
 * prove the behaviour layer cannot leak — exactly one reschedule per tick,
 * no unbounded state, and interruptions always leave a clean machine.
 */
class PetBehaviorSoakTest {

    private class CountingEffects : PetBehaviorController.Effects {
        var scheduled = 0
        var lastDelay = 0L
        var walks = 0
        var micro = 0
        var sleeps = 0
        var wakes = 0
        override fun scheduleNextTick(delayMs: Long) { scheduled++; lastDelay = delayMs }
        override fun showTransient(state: String, durationMs: Long) {}
        override fun playMicroAnimation(kind: String) { micro++ }
        override fun startWalk() { walks++ }
        override fun enterSleep() { sleeps++ }
        override fun exitSleep() { wakes++ }
        override fun playGreeting() {}
        override fun playStretch() {}
    }

    @Test
    fun `one hour of ticks and interruptions schedules exactly once per tick`() {
        var now = 1_700_000_000_000L
        val rng = Random(99)
        val machine = PetStateMachine { now }
        val fx = CountingEffects()
        val c = PetBehaviorController(
            stateMachine = machine,
            scheduler = PetBehaviorScheduler(rng),
            random = rng,
            clock = { now },
        )
        c.effects = fx
        var lastInteraction = now

        c.contextProvider = PetBehaviorController.ContextProvider {
            PetBehaviorScheduler.Context(
                nowMs = now,
                hourOfDay = ((now / 3_600_000L) % 24).toInt(),
                screenOn = true,
                quickAddOpen = false,
                menuOpen = false,
                dragging = false,
                collapsed = false,
                powerSave = false,
                animationLevel = "full",
                activityLevel = "lively",
                autonomousEnabled = true,
                sleepEnabled = true,
                lastUserInteractionMs = lastInteraction,
                lastWalkMs = c.lastWalkMs(),
                lastStretchDayOfYear = c.lastStretchDayTag(),
                baseMood = PetState.IDLE,
            )
        }

        var ticks = 0
        // ~1 simulated hour at a 10s cadence, with users poking constantly.
        repeat(360) { i ->
            now += 10_000L
            c.tick(); ticks++
            when (i % 7) {
                1 -> { lastInteraction = now; c.onUserInteraction(); ticks++ } // reschedules too
                3 -> { c.onDragStart() }
                4 -> { if (c.walking) c.onWalkFinished() }
                5 -> { c.onQuickAddOpened(); ticks++ } // reschedules too
            }
        }
        // Every scheduled callback came from a counted source — nothing extra
        // is ever in flight, so timers can never accumulate (§五十五).
        assertEquals(ticks, fx.scheduled)
        assertTrue("some life should have happened", fx.micro + fx.walks > 0)
        assertTrue("delays stay sane", fx.lastDelay in 1_000L..PetBehaviorScheduler.RECHECK_MS * 10)
        // After the storm the machine is quiet and consistent.
        c.onUserInteraction()
        assertTrue(!c.walking)
    }
}
