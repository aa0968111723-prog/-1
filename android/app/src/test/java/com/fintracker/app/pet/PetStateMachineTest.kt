package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PetStateMachineTest {

    private var now = 0L
    private fun machine() = PetStateMachine { now }

    @Test
    fun `success is never interrupted by idle decorations`() {
        val m = machine()
        assertTrue(m.request(PetState.SUCCESS, 2000))
        assertFalse(m.request(PetState.BLINK, 500))
        assertEquals(PetState.SUCCESS, m.current())
    }

    @Test
    fun `error outranks success so a failed write is never masked`() {
        val m = machine()
        assertTrue(m.request(PetState.SUCCESS, 2000))
        assertTrue(m.request(PetState.ERROR, 3000))
        assertEquals(PetState.ERROR, m.current())
        // and success cannot immediately overwrite the error
        assertFalse(m.request(PetState.SUCCESS, 2000))
    }

    @Test
    fun `drag outranks decoration and edge peek but not save feedback`() {
        val m = machine()
        assertTrue(m.request(PetState.EDGE_PEEK, 60_000))
        assertTrue(m.request(PetState.DRAGGING, 60_000))
        assertEquals(PetState.DRAGGING, m.current())

        val m2 = machine()
        assertTrue(m2.request(PetState.SUCCESS, 2000))
        assertFalse(m2.request(PetState.DRAGGING, 60_000))
    }

    @Test
    fun `saving and listening outrank dragging, and saving holds against listening`() {
        val m = machine()
        assertTrue(m.request(PetState.DRAGGING, 60_000))
        assertTrue(m.request(PetState.SAVING, 1000))
        assertEquals(PetState.SAVING, m.current())

        // A write in flight is not interrupted by the mic opening…
        assertFalse(m.request(PetState.LISTENING, 1000))
        // …but once it finishes, listening is accepted.
        now += 1001
        assertTrue(m.request(PetState.LISTENING, 1000))
        assertEquals(PetState.LISTENING, m.current())
    }

    @Test
    fun `transient expires back to the finance mood`() {
        val m = machine()
        m.baseMood = PetState.HAPPY
        m.request(PetState.SUCCESS, 2000)
        assertEquals(PetState.SUCCESS, m.current())
        now += 2001
        assertEquals(PetState.HAPPY, m.current())
        assertTrue(m.request(PetState.BLINK, 300))
    }

    @Test
    fun `clearTransient ends a state early and is scoped`() {
        val m = machine()
        m.request(PetState.DRAGGING, 60_000)
        m.clearTransient(PetState.EDGE_PEEK) // different state: no-op
        assertEquals(PetState.DRAGGING, m.current())
        m.clearTransient(PetState.DRAGGING)
        assertEquals(PetState.IDLE, m.current())
    }

    @Test
    fun `idle decorations only over calm moods with nothing active`() {
        val m = machine()
        m.baseMood = PetState.IDLE
        assertTrue(m.idleTickAllowed())
        assertNotNull(m.pickIdleDecoration(0))

        m.request(PetState.SUCCESS, 2000)
        assertFalse(m.idleTickAllowed())
        assertNull(m.pickIdleDecoration(0))

        now += 2001
        m.baseMood = PetState.CAUTION
        assertFalse(m.idleTickAllowed())
        m.baseMood = PetState.SLEEP
        assertTrue(m.idleTickAllowed())
    }

    @Test
    fun `idle decoration picker is stable and handles negative seeds`() {
        val m = machine()
        m.baseMood = PetState.IDLE
        assertEquals(m.pickIdleDecoration(3), m.pickIdleDecoration(3))
        assertNotNull(m.pickIdleDecoration(-7))
    }

    private fun assertNotNull(value: Any?) = assertTrue(value != null)
}
