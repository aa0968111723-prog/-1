package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetAnimationControllerTest {

    private var now = 0L
    private fun controller() = PetAnimationController { now }

    @Test
    fun `success is never interrupted by idle decorations`() {
        val c = controller()
        assertTrue(c.request("success", 2000))
        assertFalse(c.request("blink", 500))
        assertEquals("success", c.current())
    }

    @Test
    fun `drag wins over decorations but not over success feedback`() {
        val c = controller()
        assertTrue(c.request("blink", 500))
        assertTrue(c.request("dragging", 60_000))
        assertEquals("dragging", c.current())
        val c2 = controller()
        assertTrue(c2.request("success", 2000))
        assertFalse(c2.request("dragging", 60_000))
    }

    @Test
    fun `transient expires back to base mood`() {
        val c = controller()
        c.baseMood = "happy"
        c.request("success", 2000)
        assertEquals("success", c.current())
        now += 2001
        assertEquals("happy", c.current())
        // after expiry, low-priority requests are accepted again
        assertTrue(c.request("blink", 300))
    }

    @Test
    fun `clearTransient ends a state early`() {
        val c = controller()
        c.request("dragging", 60_000)
        c.clearTransient("dragging")
        assertEquals("idle", c.current())
    }

    @Test
    fun `clearTransient with other state is a no-op`() {
        val c = controller()
        c.request("success", 2000)
        c.clearTransient("dragging")
        assertEquals("success", c.current())
    }

    @Test
    fun `idle ticks only over calm base moods with no active transient`() {
        val c = controller()
        c.baseMood = "idle"
        assertTrue(c.idleTickAllowed())
        c.request("success", 2000)
        assertFalse(c.idleTickAllowed())
        now += 2001
        c.baseMood = "warning"
        assertFalse(c.idleTickAllowed())
        c.baseMood = "sleepy"
        assertTrue(c.idleTickAllowed())
    }

    @Test
    fun `equal priority may replace (newer success restarts)`() {
        val c = controller()
        assertTrue(c.request("success", 2000))
        now += 1000
        assertTrue(c.request("success", 2000))
        now += 1500 // 2500 after first, 1500 after second
        assertEquals("success", c.current())
    }
}
