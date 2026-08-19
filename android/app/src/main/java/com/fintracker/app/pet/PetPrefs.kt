package com.fintracker.app.pet

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Native persistence for the floating pet.
 *
 * IMPORTANT: this is deliberately NOT a second finance database. It stores
 * only (a) pet settings/position, (b) the last finance state snapshot pushed
 * from the web layer for display, and (c) a small queue of transactions
 * captured while the WebView was not running, which the web app drains into
 * the real FinTracker store on next launch.
 */
class PetPrefs(context: Context) {

    val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ---- pet settings ----

    var enabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

    var settingsJson: String
        get() = prefs.getString(KEY_SETTINGS, "{}") ?: "{}"
        set(value) = prefs.edit().putString(KEY_SETTINGS, value).apply()

    fun settings(): PetSettingsSnapshot = PetSettingsSnapshot.fromJson(settingsJson)

    // ---- pet finance state snapshot (computed by the web domain layer) ----

    var petStateJson: String
        get() = prefs.getString(KEY_PET_STATE, "{}") ?: "{}"
        set(value) = prefs.edit().putString(KEY_PET_STATE, value).apply()

    // ---- position (normalized; survives rotation / resolution changes) ----

    fun savePosition(normalizedX: Float, normalizedY: Float, edge: String) {
        prefs.edit()
            .putFloat(KEY_POS_X, normalizedX)
            .putFloat(KEY_POS_Y, normalizedY)
            .putString(KEY_POS_EDGE, edge)
            .apply()
    }

    fun loadPosition(): PetPositionManager.NormalizedPosition =
        PetPositionManager.NormalizedPosition(
            x = prefs.getFloat(KEY_POS_X, 1f),
            y = prefs.getFloat(KEY_POS_Y, 0.6f),
            edge = prefs.getString(KEY_POS_EDGE, PetPositionManager.EDGE_RIGHT)
                ?: PetPositionManager.EDGE_RIGHT,
        )

    /** Last payment method chosen in the native quick add sheet. */
    var lastPaymentMethod: String
        get() = prefs.getString(KEY_LAST_PAYMENT, "cash") ?: "cash"
        set(value) = prefs.edit().putString(KEY_LAST_PAYMENT, value).apply()

    companion object {
        const val PREFS_NAME = "finance_pet_prefs"
        private const val KEY_ENABLED = "pet_enabled"
        private const val KEY_SETTINGS = "pet_settings"
        private const val KEY_PET_STATE = "pet_state"
        private const val KEY_POS_X = "pet_pos_x"
        private const val KEY_POS_Y = "pet_pos_y"
        private const val KEY_POS_EDGE = "pet_pos_edge"
        private const val KEY_LAST_PAYMENT = "pet_last_payment"
    }
}

/** Parsed view over the settings JSON pushed from the web layer. */
data class PetSettingsSnapshot(
    val size: String = "medium",
    val edge: String = "auto",
    val autoCollapse: String = "15s",
    val animation: String = "full",
    val fastMode: Boolean = false,
    val showAmounts: Boolean = false,
    val petName: String = "小財",
) {
    fun sizeDp(): Int = when (size) {
        "small" -> 56
        "large" -> 80
        else -> 68
    }

    fun autoCollapseMillis(): Long? = when (autoCollapse) {
        "5s" -> 5_000L
        "15s" -> 15_000L
        else -> null
    }

    companion object {
        fun fromJson(json: String): PetSettingsSnapshot = try {
            val o = JSONObject(json)
            PetSettingsSnapshot(
                size = o.optString("size", "medium"),
                edge = o.optString("edge", "auto"),
                autoCollapse = o.optString("autoCollapse", "15s"),
                animation = o.optString("animation", "full"),
                fastMode = o.optBoolean("fastMode", false),
                showAmounts = o.optBoolean("showAmounts", false),
                petName = o.optString("petName", "小財"),
            )
        } catch (e: Exception) {
            PetSettingsSnapshot()
        }
    }
}
