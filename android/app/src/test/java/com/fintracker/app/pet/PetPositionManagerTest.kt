package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Test

class PetPositionManagerTest {

    private val screenW = 1080
    private val screenH = 2400
    private val pet = 180

    @Test
    fun `toPixels docks left edge at zero`() {
        val pos = PetPositionManager.NormalizedPosition(0.5f, 0.5f, PetPositionManager.EDGE_LEFT)
        val px = PetPositionManager.toPixels(pos, screenW, screenH, pet)
        assertEquals(0, px.x)
        assertEquals(((screenH - pet) * 0.5f).toInt(), px.y)
    }

    @Test
    fun `toPixels docks right edge flush with screen`() {
        val pos = PetPositionManager.NormalizedPosition(0.1f, 0.25f, PetPositionManager.EDGE_RIGHT)
        val px = PetPositionManager.toPixels(pos, screenW, screenH, pet)
        assertEquals(screenW - pet, px.x)
    }

    @Test
    fun `normalize and toPixels round-trip keeps vertical position across screens`() {
        val normalized = PetPositionManager.normalize(0, 1110, screenW, screenH, pet)
        // Same normalized position rendered on a different screen size / dpi.
        val other = PetPositionManager.toPixels(normalized, 720, 1600, 120)
        val expectedY = ((1110f / (screenH - pet)) * (1600 - 120)).toInt()
        assertEquals(expectedY, other.y)
        assertEquals(0, other.x) // still docked left
    }

    @Test
    fun `nearestEdge picks the closer side by pet center`() {
        assertEquals(PetPositionManager.EDGE_LEFT, PetPositionManager.nearestEdge(100, screenW, pet))
        assertEquals(PetPositionManager.EDGE_RIGHT, PetPositionManager.nearestEdge(800, screenW, pet))
    }

    @Test
    fun `normalize clamps out-of-bounds drags`() {
        val n = PetPositionManager.normalize(-500, 99999, screenW, screenH, pet)
        assertEquals(0f, n.x, 0.0001f)
        assertEquals(1f, n.y, 0.0001f)
    }

    @Test
    fun `resolveEdge honors explicit setting and falls back to natural on auto`() {
        assertEquals(PetPositionManager.EDGE_LEFT, PetPositionManager.resolveEdge("left", "right"))
        assertEquals(PetPositionManager.EDGE_RIGHT, PetPositionManager.resolveEdge("right", "left"))
        assertEquals("left", PetPositionManager.resolveEdge("auto", "left"))
    }

    @Test
    fun `snapTargetX lands exactly on the edges`() {
        assertEquals(0, PetPositionManager.snapTargetX(PetPositionManager.EDGE_LEFT, screenW, pet))
        assertEquals(screenW - pet, PetPositionManager.snapTargetX(PetPositionManager.EDGE_RIGHT, screenW, pet))
    }
}
