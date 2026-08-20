package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * Spec §五十三 行為測試: idle→blink, idle→walk, walk→user tap, sleep→tap→wake,
 * drag overrides walk, quick add overrides sleep, power save disables
 * autonomous movement. All on the JVM with fake effects + a scripted clock.
 */
class PetBehaviorControllerTest {

    private class FakeEffects : PetBehaviorController.Effects {
        val scheduled = mutableListOf<Long>()
        val transients = mutableListOf<String>()
        val micro = mutableListOf<String>()
        var walks = 0
        var sleeps = 0
        var wakes = 0
        var greetings = 0
        var stretches = 0
        override fun scheduleNextTick(delayMs: Long) { scheduled.add(delayMs) }
        override fun showTransient(state: String, durationMs: Long) { transients.add(state) }
        override fun playMicroAnimation(kind: String) { micro.add(kind) }
        override fun startWalk() { walks++ }
        override fun enterSleep() { sleeps++ }
        override fun exitSleep() { wakes++ }
        override fun playGreeting() { greetings++ }
        override fun playStretch() { stretches++ }
    }

    private var now = 1_000_000L

    private fun controller(
        random: Random = Random(7),
        machine: PetStateMachine = PetStateMachine { now },
    ): Pair<PetBehaviorController, FakeEffects> {
        val fx = FakeEffects()
        val c = PetBehaviorController(
            stateMachine = machine,
            scheduler = PetBehaviorScheduler(random),
            random = random,
            clock = { now },
        )
        c.effects = fx
        return c to fx
    }

    private fun ctx(
        hour: Int = 14,
        screenOn: Boolean = true,
        quickAddOpen: Boolean = false,
        dragging: Boolean = false,
        collapsed: Boolean = false,
        powerSave: Boolean = false,
        animationLevel: String = "full",
        activityLevel: String = "natural",
        autonomous: Boolean = true,
        sleepEnabled: Boolean = true,
        idleForMs: Long = 30_000L,
        lastWalkMs: Long = 0L,
        lastStretchDay: Int? = null,
    ) = PetBehaviorScheduler.Context(
        nowMs = now,
        hourOfDay = hour,
        screenOn = screenOn,
        quickAddOpen = quickAddOpen,
        menuOpen = false,
        dragging = dragging,
        collapsed = collapsed,
        powerSave = powerSave,
        animationLevel = animationLevel,
        activityLevel = activityLevel,
        autonomousEnabled = autonomous,
        sleepEnabled = sleepEnabled,
        lastUserInteractionMs = now - idleForMs,
        lastWalkMs = lastWalkMs,
        lastStretchDayOfYear = lastStretchDay ?: PetBehaviorScheduler.dayTag(now), // default: already stretched today
        baseMood = PetState.IDLE,
    )

    @Test
    fun `idle produces blinks and looks over many ticks`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx() }
        repeat(30) { c.tick() }
        assertTrue("expected micro animations, got ${fx.micro}", fx.micro.isNotEmpty())
        assertTrue(fx.micro.all { it in setOf("blink", "look", "curious") } || fx.walks > 0)
        // Exactly one reschedule per tick — timers can never accumulate (§五十五).
        assertEquals(30, fx.scheduled.size)
    }

    @Test
    fun `idle eventually walks on natural level`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx() }
        repeat(60) { now += 120_000L; c.tick(); if (c.walking) c.onWalkFinished() }
        assertTrue("expected at least one stroll", fx.walks > 0)
    }

    @Test
    fun `user tap during walk stops the stroll immediately`() {
        val machine = PetStateMachine { now }
        val (c, _) = controller(machine = machine)
        var context = ctx()
        c.contextProvider = PetBehaviorController.ContextProvider { context }
        // Force a walk by ticking until one starts.
        var guard = 0
        while (!c.walking && guard++ < 200) { now += 120_000L; c.tick() }
        assertTrue("walk never started", c.walking)
        c.onUserInteraction()
        assertFalse(c.walking)
        assertTrue(machine.current() != PetState.WALK)
    }

    @Test
    fun `sleep then tap wakes`() {
        val machine = PetStateMachine { now }
        val (c, fx) = controller(machine = machine)
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(hour = 2, idleForMs = 10 * 60_000L) }
        c.tick()
        assertTrue("night idle should sleep", c.sleeping)
        assertEquals(1, fx.sleeps)
        val wasAsleep = c.onUserInteraction()
        assertTrue(wasAsleep)
        assertFalse(c.sleeping)
        assertEquals(1, fx.wakes)
        assertEquals(PetState.WAKE, machine.current())
    }

    @Test
    fun `drag overrides walk`() {
        val (c, _) = controller()
        var context = ctx()
        c.contextProvider = PetBehaviorController.ContextProvider { context }
        var guard = 0
        while (!c.walking && guard++ < 200) { now += 120_000L; c.tick() }
        assertTrue(c.walking)
        c.onDragStart()
        assertFalse("dragging must cancel autonomy", c.walking)
    }

    @Test
    fun `quick add overrides sleep`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(hour = 1, idleForMs = 20 * 60_000L) }
        c.tick()
        assertTrue(c.sleeping)
        c.onQuickAddOpened()
        assertFalse("quick add must wake the pet (§四十)", c.sleeping)
        assertEquals(1, fx.wakes)
        // And nothing autonomous is proposed while the sheet is open.
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(quickAddOpen = true) }
        val before = fx.micro.size + fx.walks
        repeat(10) { c.tick() }
        assertEquals(before, fx.micro.size + fx.walks)
    }

    @Test
    fun `power save disables autonomous movement but keeps blinks`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(powerSave = true) }
        repeat(40) { now += 120_000L; c.tick() }
        assertEquals("power save must never stroll", 0, fx.walks)
        assertTrue("quiet mode still blinks", fx.micro.all { it == "blink" })
    }

    @Test
    fun `reduce motion stops all autonomy`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(animationLevel = "simple") }
        repeat(20) { now += 120_000L; c.tick() }
        assertEquals(0, fx.walks)
        assertEquals(0, fx.micro.size)
    }

    @Test
    fun `screen-on greeting fires sometimes but respects the cooldown`() {
        val (c, fx) = controller(random = Random(1))
        c.contextProvider = PetBehaviorController.ContextProvider { ctx() }
        var greetsSeen = 0
        repeat(20) {
            now += 60 * 60_000L // every hour, beyond the 45min cooldown
            c.onScreenOn(greetingsEnabled = true, powerSave = false)
            greetsSeen = fx.greetings
        }
        assertTrue("greeting should fire at least once over 20 screen-ons", greetsSeen > 0)
        assertTrue("greeting must not fire every time (§十三)", greetsSeen < 20)
        // Rapid re-locks never double-greet:
        val g = fx.greetings
        c.onScreenOn(greetingsEnabled = true, powerSave = false)
        c.onScreenOn(greetingsEnabled = true, powerSave = false)
        assertEquals(g, fx.greetings)
    }

    @Test
    fun `collapsed pet never walks`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(collapsed = true) }
        repeat(30) { now += 120_000L; c.tick() }
        assertEquals(0, fx.walks)
        assertEquals(0, fx.micro.size)
    }

    @Test
    fun `turning sleep mode off wakes a sleeping pet on the next tick`() {
        val (c, fx) = controller()
        var context = ctx(hour = 2, idleForMs = 20 * 60_000L)
        c.contextProvider = PetBehaviorController.ContextProvider { context }
        c.tick()
        assertTrue(c.sleeping)
        // The user flips 睡眠模式 off while the pet is under the blanket. The
        // scheduler now proposes ordinary life; the blanket must come off even
        // though nothing ever "requested" a wake.
        context = ctx(hour = 2, idleForMs = 20 * 60_000L, sleepEnabled = false)
        c.tick()
        assertFalse("sleep toggled off must wake the pet", c.sleeping)
        assertEquals(1, fx.wakes)
    }

    @Test
    fun `overnight idle still gets its morning stretch`() {
        val (c, fx) = controller()
        var context = ctx(hour = 2, idleForMs = 20 * 60_000L)
        c.contextProvider = PetBehaviorController.ContextProvider { context }
        c.tick()
        assertTrue(c.sleeping)
        // 8am after a whole untouched night: idleMs is huge, which used to let
        // SLEEP outrank the once-a-day stretch forever (§十五).
        now += 6 * 60 * 60_000L
        context = ctx(hour = 8, idleForMs = 9 * 60 * 60_000L, lastStretchDay = -1)
        c.tick()
        assertFalse("morning stretch must wake the pet", c.sleeping)
        assertEquals(1, fx.stretches)
    }

    @Test
    fun `screen-on never greets a sleeping pet`() {
        // A random source that always rolls 0 would greet on every chance.
        val eager = object : Random() {
            override fun nextBits(bitCount: Int): Int = 0
        }
        val (c, fx) = controller(random = eager)
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(hour = 2, idleForMs = 20 * 60_000L) }
        c.tick()
        assertTrue(c.sleeping)
        now += 60 * 60_000L
        c.onScreenOn(greetingsEnabled = true, powerSave = false)
        assertEquals("no waving from under the blanket", 0, fx.greetings)
        // Same roll while awake does greet — proving the guard, not the dice.
        c.onUserInteraction()
        now += 60 * 60_000L
        c.onScreenOn(greetingsEnabled = true, powerSave = false)
        assertEquals(1, fx.greetings)
    }

    @Test
    fun `collapsed pet keeps exactly one heartbeat pending`() {
        val (c, fx) = controller()
        c.contextProvider = PetBehaviorController.ContextProvider { ctx(collapsed = true) }
        repeat(10) { now += PetBehaviorScheduler.RECHECK_MS; c.tick() }
        // Life pauses but the loop never dies: one reschedule per tick, so the
        // pet resumes by itself after the user expands it again.
        assertEquals(10, fx.scheduled.size)
        assertTrue(fx.scheduled.all { it == PetBehaviorScheduler.RECHECK_MS })
    }
}
