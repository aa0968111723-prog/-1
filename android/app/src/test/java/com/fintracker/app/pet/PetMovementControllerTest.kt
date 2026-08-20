package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.random.Random

/** Spec §五/§八/§七: strolls stay small, bounded, inside the safe area. */
class PetMovementControllerTest {

    private val density = 2.75f // Pixel-7-ish
    private val petSize = (68 * density).toInt()
    private val safe = PetMovementController.SafeRect(0, 100, 1080, 2200)

    @Test
    fun `walk stays within 50-120dp and inside the safe area`() {
        val rng = Random(42)
        repeat(200) {
            val startX = rng.nextInt(0, 1080 - petSize)
            val plan = PetMovementController.planWalk(startX, petSize, density, safe, rng) ?: return@repeat
            val distDp = abs(plan.toX - plan.fromX) / density
            assertTrue("stroll $distDp dp too long", distDp <= PetMovementController.MAX_STEP_DP + 1)
            assertTrue("stroll $distDp dp too short", distDp >= PetMovementController.MIN_STEP_DP / 2 - 1)
            assertTrue(plan.toX >= safe.left)
            assertTrue(plan.toX + petSize <= safe.right)
        }
    }

    @Test
    fun `duration scales with distance within 300-800ms`() {
        val maxStep = (120 * density).toInt()
        assertEquals(300L, PetMovementController.durationFor(0, maxStep))
        assertEquals(800L, PetMovementController.durationFor(maxStep, maxStep))
        val mid = PetMovementController.durationFor(maxStep / 2, maxStep)
        assertTrue(mid in 301..799)
    }

    @Test
    fun `no walk when the safe area is too tight (keyboard up)`() {
        val tiny = PetMovementController.SafeRect(0, 100, petSize + 20, 800)
        assertNull(PetMovementController.planWalk(0, petSize, density, tiny, Random(1)))
    }

    @Test
    fun `cornered pet walks away from the wall, never through it`() {
        val rng = Random(7)
        repeat(50) {
            val plan = PetMovementController.planWalk(0, petSize, density, safe, rng) ?: return@repeat
            assertTrue("must walk right from the left wall", plan.toX > 0)
        }
    }

    @Test
    fun `facing matches direction`() {
        val rng = Random(3)
        repeat(50) {
            val start = 500
            val plan = PetMovementController.planWalk(start, petSize, density, safe, rng) ?: return@repeat
            assertEquals(plan.toX < start, plan.facingLeft)
        }
    }

    @Test
    fun `follow-finger trails with an offset instead of sticking`() {
        val finger = intArrayOf(800, 1200)
        var x = 100
        var y = 1500
        repeat(30) {
            val p = PetMovementController.followStep(x, y, finger[0], finger[1], petSize, density, safe)
            x = p.x; y = p.y
        }
        // Settles near the finger but offset — never exactly under it.
        val centerX = x + petSize / 2
        assertTrue("pet should trail beside the finger", abs(centerX - finger[0]) > 10 * density)
        assertTrue("pet should be near the finger", abs(centerX - finger[0]) < 160 * density)
        assertTrue(x >= safe.left && x + petSize <= safe.right)
        assertTrue(y >= safe.top && y + petSize <= safe.bottom)
    }

    @Test
    fun `follow step is always clamped to the safe area`() {
        val p = PetMovementController.followStep(0, 0, -500, -500, petSize, density, safe)
        assertTrue(p.x >= safe.left)
        assertTrue(p.y >= safe.top)
    }
}
