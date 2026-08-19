package com.fintracker.app.pet

import org.json.JSONObject

/**
 * Deterministic NL quick-entry matcher for the native quick add (typed text
 * and voice input). It is intentionally NOT a second parser implementation:
 * all keyword/category/payment rules come from the shared config JSON
 * (shared/pet-shared-config.json), the same data the web parser consumes —
 * this object only applies regex + lookups over that config.
 *
 * Pure (config passed in as JSONObject) so it is JVM unit-testable against
 * the real shared file. Works fully offline; AI is never called here.
 */
object NativeQuickParser {

    data class Parsed(
        val type: String, // "income" | "expense"
        val amount: Double?,
        val categoryId: String?,
        val categoryLabel: String,
        val note: String,
        val paymentMethodId: String?,
        val confidence: String, // high | medium | low
    )

    private val AMOUNT_RE = Regex("""(?:NT\$|\$|nt\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(?:元|塊|圓)?""")
    private val CN_AMOUNT_RE = Regex("""([零一二兩三四五六七八九十百千萬]{1,10})\s*(?:元|塊|圓)""")

    private val CN_DIGITS = mapOf('零' to 0, '一' to 1, '二' to 2, '兩' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '七' to 7, '八' to 8, '九' to 9)
    private val CN_UNITS = mapOf('十' to 10, '百' to 100, '千' to 1000, '萬' to 10000)

    /** 一百二十 -> 120, 兩百五 -> 250, 十五 -> 15. Mirrors the web heuristic. */
    fun parseChineseNumber(text: String): Long? {
        var total = 0L
        var current = 0L
        var sawAny = false
        for (ch in text) {
            when {
                CN_DIGITS.containsKey(ch) -> {
                    current = CN_DIGITS[ch]!!.toLong()
                    sawAny = true
                }
                CN_UNITS.containsKey(ch) -> {
                    val unit = CN_UNITS[ch]!!.toLong()
                    if (current == 0L) current = 1L
                    if (unit == 10000L) total = (total + current) * unit else total += current * unit
                    current = 0L
                    sawAny = true
                }
                else -> return null
            }
        }
        if (!sawAny) return null
        total += if (current > 0 && total >= 100 && total % 100 == 0L) {
            current * (if (total >= 1000) 100 else 10)
        } else current
        return if (total > 0) total else null
    }

    private fun matchKeyword(map: JSONObject?, text: String): String? {
        map ?: return null
        for (key in map.keys()) {
            val words = map.optJSONArray(key) ?: continue
            for (i in 0 until words.length()) {
                if (text.contains(words.optString(i))) return key
            }
        }
        return null
    }

    fun parse(config: JSONObject, input: String): Parsed {
        val text = input.trim()
        val parser = config.optJSONObject("parser") ?: JSONObject()

        var amount: Double? = null
        var noteText = text
        val m = AMOUNT_RE.find(text)
        if (m != null) {
            val value = m.groupValues[1].replace(",", "").toDoubleOrNull()
            if (value != null && value > 0) {
                amount = value
                noteText = (text.substring(0, m.range.first) + " " + text.substring(m.range.last + 1)).trim()
            }
        }
        if (amount == null) {
            val cn = CN_AMOUNT_RE.find(text)
            if (cn != null) {
                val value = parseChineseNumber(cn.groupValues[1])
                if (value != null) {
                    amount = value.toDouble()
                    noteText = (text.substring(0, cn.range.first) + " " + text.substring(cn.range.last + 1)).trim()
                }
            }
        }

        val paymentMethodId = matchKeyword(parser.optJSONObject("paymentKeywords"), noteText)

        var type = "expense"
        var categoryId = matchKeyword(parser.optJSONObject("incomeKeywords"), noteText)
        if (categoryId != null) {
            type = "income"
        } else {
            categoryId = matchKeyword(parser.optJSONObject("expenseKeywords"), noteText)
        }

        val matched = categoryId != null
        val label = PetSharedConfigCore.categoryLabel(config, type, categoryId ?: "other_expense")
        val note = noteText.replace(Regex("\\s+"), " ").trim()
        val confidence = when {
            amount != null && matched -> "high"
            amount != null || matched -> "medium"
            else -> "low"
        }
        return Parsed(type, amount, categoryId, label, note, paymentMethodId, confidence)
    }
}
