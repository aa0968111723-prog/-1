package com.fintracker.app.pet

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Pure JSON codec for the pending-transaction hand-off queue (the native
 * outbox). Free of Android framework types so it is unit-testable on the
 * JVM; [PendingTransactionQueue] layers SharedPreferences persistence on top.
 *
 * Schema v2 adds outbox metadata (createdAt / source / schemaVersion /
 * syncState). Parsing stays backward compatible: v1 entries without those
 * fields load with sensible defaults and are never dropped.
 */
object PendingTransactionCodec {

    const val SCHEMA_VERSION = 2

    const val SYNC_STATE_PENDING = "pending"

    data class PendingTransaction(
        val id: String,
        val type: String, // "income" | "expense"
        val amount: Double,
        val category: String,
        val date: String, // YYYY-MM-DD
        val note: String,
        val paymentMethod: String?,
        /** Epoch millis stored as ISO-less long for stability across locales. */
        val createdAt: Long = 0L,
        val source: String = "pet_quick_add",
        val schemaVersion: Int = SCHEMA_VERSION,
        val syncState: String = SYNC_STATE_PENDING,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("type", type)
            put("amount", amount)
            put("category", category)
            put("date", date)
            put("note", note)
            if (paymentMethod != null) put("paymentMethod", paymentMethod)
            put("createdAt", createdAt)
            put("source", source)
            put("schemaVersion", schemaVersion)
            put("syncState", syncState)
        }

        companion object {
            fun fromJson(o: JSONObject): PendingTransaction = PendingTransaction(
                id = o.optString("id", UUID.randomUUID().toString()),
                type = if (o.optString("type") == "income") "income" else "expense",
                amount = o.optDouble("amount", 0.0),
                category = o.optString("category", "其他支出"),
                date = o.optString("date", ""),
                note = o.optString("note", ""),
                paymentMethod = if (o.has("paymentMethod")) o.optString("paymentMethod") else null,
                createdAt = o.optLong("createdAt", 0L),
                source = o.optString("source", "pet_quick_add"),
                schemaVersion = o.optInt("schemaVersion", 1),
                syncState = o.optString("syncState", SYNC_STATE_PENDING),
            )
        }
    }

    fun parse(json: String?): List<PendingTransaction> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { PendingTransaction.fromJson(it) }
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** True when the payload is present but unreadable (corruption, not emptiness). */
    fun isCorrupt(json: String?): Boolean {
        if (json.isNullOrBlank()) return false
        return try {
            JSONArray(json)
            false
        } catch (e: Exception) {
            true
        }
    }

    fun serialize(list: List<PendingTransaction>): String {
        val arr = JSONArray()
        list.forEach { arr.put(it.toJson()) }
        return arr.toString()
    }

    /** Appends, dropping any existing entry with the same id (idempotent). */
    fun appended(json: String?, tx: PendingTransaction): String =
        serialize(parse(json).filterNot { it.id == tx.id } + tx)

    fun removed(json: String?, ids: Collection<String>): String =
        serialize(parse(json).filterNot { ids.contains(it.id) })
}
