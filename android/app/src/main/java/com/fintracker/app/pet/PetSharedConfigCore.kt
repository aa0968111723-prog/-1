package com.fintracker.app.pet

import org.json.JSONObject

/**
 * Pure JSON accessors over the shared web/native config
 * (shared/pet-shared-config.json). No Android framework types — JVM
 * unit-testable against the real shared file. [PetSharedConfig] layers
 * asset loading and prefs-synced overrides on top.
 */
object PetSharedConfigCore {

    data class Chip(
        val categoryId: String,
        val label: String,
        val emoji: String,
        val note: String,
        val categoryLabel: String,
    )

    data class PaymentMethod(val id: String, val label: String)

    fun categoryLabel(config: JSONObject, type: String, categoryId: String): String {
        val arr = config.optJSONObject("categories")?.optJSONArray(type) ?: return categoryId
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == categoryId) return o.optString("label", categoryId)
        }
        return categoryId
    }

    fun defaultChips(config: JSONObject, type: String): List<Chip> {
        val arr = config.optJSONObject("quickChips")?.optJSONArray(type) ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val categoryId = o.optString("categoryId")
            Chip(
                categoryId = categoryId,
                label = o.optString("label"),
                emoji = o.optString("emoji"),
                note = o.optString("note", ""),
                categoryLabel = categoryLabel(config, type, categoryId),
            )
        }
    }

    /** Parses chips synced from the web layer; null when absent/unreadable/empty. */
    fun parseSyncedChips(config: JSONObject, syncedJson: String?, type: String): List<Chip>? {
        if (syncedJson.isNullOrBlank()) return null
        return runCatching {
            val arr = JSONObject(syncedJson).optJSONArray(type) ?: return null
            if (arr.length() == 0) return null
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val categoryId = o.optString("categoryId")
                Chip(
                    categoryId = categoryId,
                    label = o.optString("label"),
                    emoji = o.optString("emoji"),
                    note = o.optString("note", ""),
                    categoryLabel = o.optString("category", categoryLabel(config, type, categoryId)),
                )
            }
        }.getOrNull()
    }

    fun paymentMethods(config: JSONObject): List<PaymentMethod> {
        val arr = config.optJSONArray("paymentMethods") ?: return listOf(PaymentMethod("cash", "現金"))
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            PaymentMethod(o.optString("id"), o.optString("label"))
        }
    }
}
