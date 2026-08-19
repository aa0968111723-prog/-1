package com.fintracker.app.pet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * Runs the native NL matcher against the REAL shared config file
 * (shared/pet-shared-config.json) — the same asset bundled into the APK and
 * imported by the web parser — proving both sides follow identical rules.
 */
class NativeQuickParserTest {

    private val config: JSONObject by lazy {
        val candidates = listOf(
            "../../shared/pet-shared-config.json", // android/app working dir (gradle test)
            "../shared/pet-shared-config.json",
            "shared/pet-shared-config.json", // repo root
            System.getProperty("petSharedConfig") ?: "",
        )
        val file = candidates.map { File(it) }.firstOrNull { it.isFile }
            ?: error("shared/pet-shared-config.json not found from ${File(".").absolutePath}")
        JSONObject(file.readText())
    }

    @Test
    fun `parses 午餐120 into a high-confidence food expense`() {
        val r = NativeQuickParser.parse(config, "午餐120")
        assertEquals("expense", r.type)
        assertEquals(120.0, r.amount!!, 0.001)
        assertEquals("food", r.categoryId)
        assertEquals("餐飲美食", r.categoryLabel)
        assertEquals("high", r.confidence)
    }

    @Test
    fun `parses 捷運50悠遊卡 with payment mapping`() {
        val r = NativeQuickParser.parse(config, "捷運50悠遊卡")
        assertEquals("transport", r.categoryId)
        assertEquals(50.0, r.amount!!, 0.001)
        assertEquals("mobile", r.paymentMethodId)
        assertEquals("high", r.confidence)
    }

    @Test
    fun `parses 薪水35000 as income`() {
        val r = NativeQuickParser.parse(config, "薪水35000")
        assertEquals("income", r.type)
        assertEquals("salary", r.categoryId)
        assertEquals(35000.0, r.amount!!, 0.001)
        assertEquals("薪資收入", r.categoryLabel)
    }

    @Test
    fun `parses spoken Chinese amounts 午餐一百二十塊`() {
        val r = NativeQuickParser.parse(config, "午餐一百二十塊")
        assertEquals(120.0, r.amount!!, 0.001)
        assertEquals("food", r.categoryId)
    }

    @Test
    fun `no amount means low or medium confidence, never a save`() {
        val r = NativeQuickParser.parse(config, "今天好熱")
        assertNull(r.amount)
        assertEquals("low", r.confidence)
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
        assertNotNull(payments.firstOrNull { it.id == "mobile" })
    }

    @Test
    fun `web-synced chips override defaults when present`() {
        val synced = """{"expense":[{"categoryId":"health","label":"醫療","emoji":"💊","category":"醫療保健"}]}"""
        val chips = PetSharedConfigCore.parseSyncedChips(config, synced, "expense")
        assertNotNull(chips)
        assertEquals(1, chips!!.size)
        assertEquals("health", chips[0].categoryId)
        assertEquals("醫療保健", chips[0].categoryLabel)
        // corrupted synced payload falls back to null (caller uses defaults)
        assertNull(PetSharedConfigCore.parseSyncedChips(config, "{broken", "expense"))
    }
}
