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

    /** Usage-ranked quick chips synced from the web layer ({expense:[...],income:[...]}). */
    var syncedQuickChipsJson: String?
        get() = prefs.getString(KEY_QUICK_CHIPS, null)
        set(value) = prefs.edit().putString(KEY_QUICK_CHIPS, value).apply()

    /** Millis timestamp of the last successful web drain ack (debug/health info). */
    var lastSyncAt: Long
        get() = prefs.getLong(KEY_LAST_SYNC, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SYNC, value).apply()

    companion object {
        const val PREFS_NAME = "finance_pet_prefs"
        private const val KEY_ENABLED = "pet_enabled"
        private const val KEY_SETTINGS = "pet_settings"
        private const val KEY_PET_STATE = "pet_state"
        private const val KEY_POS_X = "pet_pos_x"
        private const val KEY_POS_Y = "pet_pos_y"
        private const val KEY_POS_EDGE = "pet_pos_edge"
        private const val KEY_LAST_PAYMENT = "pet_last_payment"
        private const val KEY_QUICK_CHIPS = "pet_quick_chips"
        private const val KEY_LAST_SYNC = "pet_last_sync_at"
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
    /** "100" | "85" | "70" — never lower, the pet must stay tappable. */
    val opacity: String = "100",
    // --- V2 interaction toggles (小財互動頁). Defaults keep old clients lively but polite. ---
    /** quiet | natural | lively (spec §九). */
    val activityLevel: String = "natural",
    /** Master switch for small self-initiated strolls (spec §五). */
    val autonomousMovement: Boolean = true,
    /** Trailing the finger while pressed (spec §十). */
    val followFinger: Boolean = true,
    /** Occasional screen-on wave (spec §十三). */
    val greetings: Boolean = true,
    /** Gentle record reminders / budget nudges (spec §十八). */
    val reminders: Boolean = true,
    /** Night / long-idle sleep (spec §十四). */
    val sleepMode: Boolean = true,
    /** Quick add opens with this type ("expense" | "income"). */
    val defaultType: String = "expense",
    /** Tiny confirmation sounds. OFF by default (spec §四十七). */
    val soundEffects: Boolean = false,
) {
    fun sizeDp(): Int = when (size) {
        "small" -> 56
        "large" -> 80
        else -> 68
    }

    fun alpha(): Float = when (opacity) {
        "70" -> 0.7f
        "85" -> 0.85f
        else -> 1f
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
                opacity = o.optString("opacity", "100"),
                activityLevel = o.optString("activityLevel", "natural"),
                autonomousMovement = o.optBoolean("autonomousMovement", true),
                followFinger = o.optBoolean("followFinger", true),
                greetings = o.optBoolean("greetings", true),
                reminders = o.optBoolean("reminders", true),
                sleepMode = o.optBoolean("sleepMode", true),
                defaultType = o.optString("defaultType", "expense"),
                soundEffects = o.optBoolean("soundEffects", false),
            )
        } catch (e: Exception) {
            PetSettingsSnapshot()
        }
    }
}
