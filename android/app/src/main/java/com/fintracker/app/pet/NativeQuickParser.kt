package com.fintracker.app.pet

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Deterministic NL quick-entry matcher for the native quick add (typed text
 * and voice input).
 *
 * It is intentionally NOT a second parser implementation: every keyword,
 * category, merchant and payment rule comes from the shared config JSON
 * (shared/pet-shared-config.json), the same data the web parser consumes —
 * this object only applies regex + lookups over that config, matching
 * src/lib/quickParser.ts behaviour case for case.
 *
 * Pure (config passed in) so it is JVM unit-testable against the real shared
 * file. Works fully offline; AI is never called here.
 */
object NativeQuickParser {

    data class Parsed(
        val type: String, // "income" | "expense"
        val amount: Double?,
        /** null when we genuinely cannot tell — the UI must ask, never guess. */
        val categoryId: String?,
        val categoryLabel: String,
        val note: String,
        val paymentMethodId: String?,
        /** Local calendar date key, shifted by 昨天/前天 etc. */
        val dateKey: String,
        val confidence: String, // high | medium | low
    )

    private val AMOUNT_RE = Regex("""(?:NT\$|\$|nt\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(?:元|塊|圓)?""")
    private val CN_AMOUNT_RE = Regex("""([零一二兩三四五六七八九十百千萬]{1,10})\s*(?:元|塊|圓)""")

    /** Slash form only: "7-11" is a shop, not July 11. */
    private val MD_RE = Regex("""(?:^|\s)(\d{1,2})/(\d{1,2})(?:\s|$)""")

    private val CN_DIGITS = mapOf('零' to 0, '一' to 1, '二' to 2, '兩' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '七' to 7, '八' to 8, '九' to 9)
    private val CN_UNITS = mapOf('十' to 10, '百' to 100, '千' to 1000, '萬' to 10000)

    private val RELATIVE_DAYS = mapOf(
        "今天" to 0, "今日" to 0, "昨天" to -1, "昨日" to -1, "前天" to -2, "明天" to 1,
    )

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

    /** Longest keyword wins, so 信用卡 beats 刷 and 悠遊付 is not shadowed. */
    private fun matchKeyword(map: JSONObject?, text: String): String? {
        map ?: return null
        var bestId: String? = null
        var bestLen = 0
        for (key in map.keys()) {
            val words = map.optJSONArray(key) ?: continue
            for (i in 0 until words.length()) {
                val w = words.optString(i)
                if (w.isNotEmpty() && text.contains(w) && w.length > bestLen) {
                    bestId = key
                    bestLen = w.length
                }
            }
        }
        return bestId
    }

    private fun localDateKey(base: Date, offsetDays: Int): String {
        val cal = Calendar.getInstance()
        cal.time = base
        cal.add(Calendar.DAY_OF_YEAR, offsetDays)
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
    }

    @JvmOverloads
    fun parse(config: JSONObject, input: String, now: Date = Date()): Parsed {
        val trimmed = input.trim()
        val parser = config.optJSONObject("parser") ?: JSONObject()

        // Mask store names before any number parsing: "7-11 85" must not be
        // read as July 11 or as an amount of 7.
        val stores = parser.optJSONArray("convenienceStoreKeywords")
        var storeMatch: String? = null
        if (stores != null) {
            for (i in 0 until stores.length()) {
                val s = stores.optString(i)
                if (s.isNotEmpty() && trimmed.contains(s, ignoreCase = true)) {
                    storeMatch = s
                    break
                }
            }
        }
        var text = if (storeMatch != null) {
            trimmed.replace(storeMatch, " ", ignoreCase = true)
        } else trimmed

        // Relative or explicit date
        var dateKey = localDateKey(now, 0)
        for ((word, offset) in RELATIVE_DAYS) {
            if (text.contains(word)) {
                dateKey = localDateKey(now, offset)
                text = text.replace(word, " ")
                break
            }
        }
        val md = MD_RE.find(text)
        if (md != null) {
            val month = md.groupValues[1].toIntOrNull()
            val day = md.groupValues[2].toIntOrNull()
            if (month != null && day != null && month in 1..12 && day in 1..31) {
                val cal = Calendar.getInstance()
                cal.time = now
                cal.set(Calendar.MONTH, month - 1)
                cal.set(Calendar.DAY_OF_MONTH, day)
                dateKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
                text = text.replace(md.value, " ")
            }
        }

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
                ?: matchKeyword(parser.optJSONObject("merchantKeywords"), noteText)
        }

        val note = listOf(storeMatch ?: "", noteText).joinToString(" ")
            .replace(Regex("\\s+"), " ").trim()

        // A convenience store is genuinely ambiguous (a meal or shampoo): keep
        // the merchant in the note and leave the category for the user.
        if (categoryId == null && storeMatch != null && amount != null) {
            return Parsed("expense", amount, null, "", note, paymentMethodId, dateKey, "medium")
        }

        val label = if (categoryId != null) {
            PetSharedConfigCore.categoryLabel(config, type, categoryId)
        } else ""
        val confidence = when {
            amount != null && categoryId != null -> "high"
            amount != null || categoryId != null -> "medium"
            else -> "low"
        }
        return Parsed(type, amount, categoryId, label, note, paymentMethodId, dateKey, confidence)
    }
}
