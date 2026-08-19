package com.fintracker.app.pet

import android.content.Context
import org.json.JSONObject

/**
 * Android-side loader for the shared web/native configuration bundled as an
 * asset (assets/pet_shared_config.json, copied from
 * shared/pet-shared-config.json by `npm run sync:shared`). Parsing logic
 * lives in the pure [PetSharedConfigCore]; this object only handles asset
 * IO, caching, and the prefs-synced chip override.
 */
object PetSharedConfig {

    const val ASSET_NAME = "pet_shared_config.json"

    @Volatile
    private var cached: JSONObject? = null

    fun raw(context: Context): JSONObject {
        cached?.let { return it }
        val json = runCatching {
            context.assets.open(ASSET_NAME).bufferedReader().use { it.readText() }
        }.getOrDefault("{}")
        val obj = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
        cached = obj
        return obj
    }

    /**
     * Quick chips for a transaction type: web-synced (usage-ranked, pinned
     * first) when available, bundled shared defaults otherwise. Never
     * hardcoded in Kotlin.
     */
    fun chips(context: Context, prefs: PetPrefs, type: String): List<PetSharedConfigCore.Chip> {
        val config = raw(context)
        return PetSharedConfigCore.parseSyncedChips(config, prefs.syncedQuickChipsJson, type)
            ?: PetSharedConfigCore.defaultChips(config, type)
    }

    fun paymentMethods(context: Context): List<PetSharedConfigCore.PaymentMethod> =
        PetSharedConfigCore.paymentMethods(raw(context))
}
