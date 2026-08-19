package com.fintracker.app.pet

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Pure JSON codec for the pending-transaction hand-off queue.
 * Free of Android framework types so it is unit-testable on the JVM;
 * [PendingTransactionQueue] layers SharedPreferences persistence on top.
 */
object PendingTransactionCodec {

    data class PendingTransaction(
        val id: String,
        val type: String, // "income" | "expense"
        val amount: Double,
        val category: String,
        val date: String, // YYYY-MM-DD
        val note: String,
        val paymentMethod: String?,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("type", type)
            put("amount", amount)
            put("category", category)
            put("date", date)
            put("note", note)
            if (paymentMethod != null) put("paymentMethod", paymentMethod)
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

    fun serialize(list: List<PendingTransaction>): String {
        val arr = JSONArray()
        list.forEach { arr.put(it.toJson()) }
        return arr.toString()
    }

    fun appended(json: String?, tx: PendingTransaction): String =
        serialize(parse(json) + tx)

    fun removed(json: String?, ids: Collection<String>): String =
        serialize(parse(json).filterNot { ids.contains(it.id) })
}
