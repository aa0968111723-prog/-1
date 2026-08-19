package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The pet has to follow the finger exactly, including during the slow drags
 * people actually make when placing it carefully next to something.
 */
class DragAccumulatorTest {

    @Test
    fun `a slow drag under one pixel per event still moves the pet`() {
        val acc = DragAccumulator()
        acc.reset(0f, 0f)
        // Four events of 0.4 px: the first two are swallowed, then a pixel lands.
        assertNull(acc.consume(0.4f, 0f))
        assertNull(acc.consume(0.8f, 0f))
        assertEquals(1 to 0, acc.consume(1.2f, 0f))
        assertNull(acc.consume(1.6f, 0f))
        assertEquals(1 to 0, acc.consume(2.0f, 0f))
    }

    @Test
    fun `total movement equals the distance travelled, with no drift`() {
        val acc = DragAccumulator()
        acc.reset(0f, 0f)
        var total = 0
        var pos = 0f
        // 0.5 is exactly representable, so the expected total is exact too.
        repeat(100) {
            pos += 0.5f
            acc.consume(pos, 0f)?.let { (dx, _) -> total += dx }
        }
        // 50 px travelled, 50 px applied: nothing lost to truncation.
        assertEquals(50f, pos, 0f)
        assertEquals(50, total)
    }

    @Test
    fun `negative movement accumulates the same way`() {
        val acc = DragAccumulator()
        acc.reset(100f, 100f)
        assertNull(acc.consume(99.5f, 100f))
        assertEquals(-1 to 0, acc.consume(99.0f, 100f))
        assertEquals(0 to -2, acc.consume(99.0f, 98.0f))
    }

    @Test
    fun `both axes are tracked independently`() {
        val acc = DragAccumulator()
        acc.reset(0f, 0f)
        assertEquals(3 to 0, acc.consume(3.5f, 0.5f))
        // The 0.5 px of Y was kept, so another 0.5 completes a pixel.
        assertEquals(0 to 1, acc.consume(3.5f, 1.0f))
    }

    @Test
    fun `reset drops the remainder instead of applying it later`() {
        val acc = DragAccumulator()
        acc.reset(0f, 0f)
        assertNull(acc.consume(0.9f, 0.9f))
        // A new gesture starts here; the old 0.9 px must not leak into it.
        acc.reset(50f, 50f)
        assertNull(acc.consume(50.5f, 50.5f))
        assertEquals(1 to 1, acc.consume(51.2f, 51.2f))
    }
}
