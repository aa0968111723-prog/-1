package com.fintracker.app.pet

import kotlin.math.max
import kotlin.math.min

/**
 * Pure position math for the floating pet.
 *
 * Positions are persisted as normalized (0..1) fractions of the usable
 * screen area plus a docking edge, never as absolute pixels, so the pet
 * lands in roughly the same place across rotations, densities and screens.
 *
 * Kept free of Android framework types so it is unit-testable on the JVM.
 */
object PetPositionManager {

    const val EDGE_LEFT = "left"
    const val EDGE_RIGHT = "right"

    data class NormalizedPosition(val x: Float, val y: Float, val edge: String)

    data class PixelPosition(val x: Int, val y: Int)

    /** Converts a stored normalized position into window coordinates. */
    fun toPixels(
        position: NormalizedPosition,
        screenWidth: Int,
        screenHeight: Int,
        petSizePx: Int,
    ): PixelPosition {
        val maxX = max(0, screenWidth - petSizePx)
        val maxY = max(0, screenHeight - petSizePx)
        val x = when (position.edge) {
            EDGE_LEFT -> 0
            EDGE_RIGHT -> maxX
            else -> (position.x * maxX).toInt()
        }
        val y = (position.y * maxY).toInt()
        return PixelPosition(clamp(x, 0, maxX), clamp(y, 0, maxY))
    }

    /** Normalizes raw window coordinates after a drag ends. */
    fun normalize(
        xPx: Int,
        yPx: Int,
        screenWidth: Int,
        screenHeight: Int,
        petSizePx: Int,
    ): NormalizedPosition {
        val maxX = max(1, screenWidth - petSizePx)
        val maxY = max(1, screenHeight - petSizePx)
        val nx = clampF(xPx.toFloat() / maxX, 0f, 1f)
        val ny = clampF(yPx.toFloat() / maxY, 0f, 1f)
        return NormalizedPosition(nx, ny, nearestEdge(xPx, screenWidth, petSizePx))
    }

    /** Which edge the pet should snap to when released. */
    fun nearestEdge(xPx: Int, screenWidth: Int, petSizePx: Int): String {
        val centerX = xPx + petSizePx / 2f
        return if (centerX <= screenWidth / 2f) EDGE_LEFT else EDGE_RIGHT
    }

    /** Target x for an edge snap. */
    fun snapTargetX(edge: String, screenWidth: Int, petSizePx: Int): Int =
        if (edge == EDGE_LEFT) 0 else max(0, screenWidth - petSizePx)

    /** Resolves the effective docking edge given the user's edge setting. */
    fun resolveEdge(settingEdge: String, naturalEdge: String): String = when (settingEdge) {
        EDGE_LEFT -> EDGE_LEFT
        EDGE_RIGHT -> EDGE_RIGHT
        else -> naturalEdge // "auto"
    }

    private fun clamp(v: Int, lo: Int, hi: Int): Int = max(lo, min(hi, v))
    private fun clampF(v: Float, lo: Float, hi: Float): Float = max(lo, min(hi, v))
}
