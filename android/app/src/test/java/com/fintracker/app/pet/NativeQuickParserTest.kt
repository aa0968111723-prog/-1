package com.fintracker.app.pet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Runs the native NL matcher against the REAL shared config file
 * (shared/pet-shared-config.json) — the same asset bundled into the APK and
 * imported by the web parser — proving both sides follow identical rules.
 */
class NativeQuickParserTest {

    private val config: JSONObject by lazy {
        val candidates = listOf(
            "../../shared/pet-shared-config.json", // gradle test workdir = android/app
            "../shared/pet-shared-config.json",
            "shared/pet-shared-config.json",
            "src/main/assets/pet_shared_config.json", // bundled copy
        )
        val file = candidates.map { File(it) }.firstOrNull { it.isFile }
            ?: error("shared config not found from ${File(".").absolutePath}")
        JSONObject(file.readText())
    }

    /** Fixed clock so relative-date assertions are stable. */
    private val now = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).parse("2026-08-19 12:30")!!

    private fun dayOffsetKey(offset: Int): String {
        val cal = Calendar.getInstance()
        cal.time = now
        cal.add(Calendar.DAY_OF_YEAR, offset)
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
    }

    @Test
    fun `parses 午餐120 into a high-confidence food expense dated today`() {
        val r = NativeQuickParser.parse(config, "午餐120", now)
        assertEquals("expense", r.type)
        assertEquals(120.0, r.amount!!, 0.001)
        assertEquals("food", r.categoryId)
        assertEquals("餐飲美食", r.categoryLabel)
        assertEquals(dayOffsetKey(0), r.dateKey)
        assertEquals("high", r.confidence)
    }

    @Test
    fun `parses 捷運50悠遊卡 and maps the specific instrument`() {
        val r = NativeQuickParser.parse(config, "捷運50悠遊卡", now)
        assertEquals("transport", r.categoryId)
        assertEquals(50.0, r.amount!!, 0.001)
        assertEquals("easycard", r.paymentMethodId)
        assertEquals("high", r.confidence)
    }

    @Test
    fun `parses 薪水35000 as income`() {
        val r = NativeQuickParser.parse(config, "薪水35000", now)
        assertEquals("income", r.type)
        assertEquals("salary", r.categoryId)
        assertEquals(35000.0, r.amount!!, 0.001)
        assertEquals("薪資收入", r.categoryLabel)
    }

    @Test
    fun `recognises merchants - 全聯850信用卡`() {
        val r = NativeQuickParser.parse(config, "全聯850信用卡", now)
        assertEquals(850.0, r.amount!!, 0.001)
        assertEquals("shopping", r.categoryId)
        assertEquals("credit", r.paymentMethodId)
    }

    @Test
    fun `resolves 昨天晚餐180 to yesterday`() {
        val r = NativeQuickParser.parse(config, "昨天晚餐180", now)
        assertEquals(180.0, r.amount!!, 0.001)
        assertEquals("food", r.categoryId)
        assertEquals(dayOffsetKey(-1), r.dateKey)
        assertTrue(!r.note.contains("昨天"))
    }

    @Test
    fun `never guesses an unknown category`() {
        val r = NativeQuickParser.parse(config, "小明120", now)
        assertEquals(120.0, r.amount!!, 0.001)
        assertNull(r.categoryId)
        assertEquals("", r.categoryLabel)
        assertEquals("medium", r.confidence)
    }

    @Test
    fun `convenience stores stay ambiguous and are not read as a date or amount`() {
        val r = NativeQuickParser.parse(config, "7-11 85", now)
        assertEquals(85.0, r.amount!!, 0.001)
        assertNull(r.categoryId)
        assertEquals(dayOffsetKey(0), r.dateKey)
        assertTrue(r.note.contains("7-11"))
        assertEquals("medium", r.confidence)
    }

    @Test
    fun `parses spoken Chinese amounts`() {
        val r = NativeQuickParser.parse(config, "午餐一百二十塊", now)
        assertEquals(120.0, r.amount!!, 0.001)
        assertEquals("food", r.categoryId)
    }

    @Test
    fun `no amount and no category is low confidence`() {
        val r = NativeQuickParser.parse(config, "今天好熱", now)
        assertNull(r.amount)
        assertEquals("low", r.confidence)
    }

    @Test
    fun `longest payment keyword wins`() {
        assertEquals("credit", NativeQuickParser.parse(config, "晚餐300信用卡", now).paymentMethodId)
        assertEquals("linepay", NativeQuickParser.parse(config, "晚餐300 LINE Pay", now).paymentMethodId)
    }

    @Test
    fun `chinese number helper matches web behavior`() {
        assertEquals(120L, NativeQuickParser.parseChineseNumber("一百二十"))
        assertEquals(250L, NativeQuickParser.parseChineseNumber("兩百五"))
        assertEquals(15L, NativeQuickParser.parseChineseNumber("十五"))
        assertEquals(3000L, NativeQuickParser.parseChineseNumber("三千"))
        assertNull(NativeQuickParser.parseChineseNumber("午餐"))
    }

    @Test
    fun `shared config carries chips and payment methods for the native sheet`() {
        val chips = PetSharedConfigCore.defaultChips(config, "expense")
        assertEquals(6, chips.size)
        assertEquals("food", chips[0].categoryId)
        assertEquals("餐飲美食", chips[0].categoryLabel)
        val payments = PetSharedConfigCore.paymentMethods(config)
        assertNotNull(payments.firstOrNull { it.id == "easycard" })
        assertNotNull(payments.firstOrNull { it.id == "linepay" })
    }

    @Test
    fun `web-synced chips override defaults when present`() {
        val synced = """{"expense":[{"categoryId":"health","label":"醫療","emoji":"💊","category":"醫療保健"}]}"""
        val chips = PetSharedConfigCore.parseSyncedChips(config, synced, "expense")
        assertNotNull(chips)
        assertEquals(1, chips!!.size)
        assertEquals("health", chips[0].categoryId)
        assertEquals("醫療保健", chips[0].categoryLabel)
        assertNull(PetSharedConfigCore.parseSyncedChips(config, "{broken", "expense"))
    }
}
