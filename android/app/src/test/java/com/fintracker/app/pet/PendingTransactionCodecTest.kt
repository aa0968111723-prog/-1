package com.fintracker.app.pet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingTransactionCodecTest {

    private fun tx(id: String, amount: Double = 120.0) = PendingTransactionCodec.PendingTransaction(
        id = id,
        type = "expense",
        amount = amount,
        category = "餐飲美食",
        date = "2026-08-19",
        note = "午餐",
        paymentMethod = "cash",
        createdAt = 1765000000000L,
        source = "pet_quick_add",
    )

    @Test
    fun `round-trips a v2 queue with outbox metadata`() {
        val json = PendingTransactionCodec.serialize(listOf(tx("a"), tx("b", 55.5)))
        val parsed = PendingTransactionCodec.parse(json)
        assertEquals(2, parsed.size)
        assertEquals("a", parsed[0].id)
        assertEquals(55.5, parsed[1].amount, 0.0001)
        assertEquals("餐飲美食", parsed[0].category)
        assertEquals("cash", parsed[0].paymentMethod)
        assertEquals(1765000000000L, parsed[0].createdAt)
        assertEquals("pet_quick_add", parsed[0].source)
        assertEquals(PendingTransactionCodec.SCHEMA_VERSION, parsed[0].schemaVersion)
        assertEquals(PendingTransactionCodec.SYNC_STATE_PENDING, parsed[0].syncState)
    }

    @Test
    fun `parses v1 entries without metadata (backward compatible)`() {
        val v1 = """[{"id":"old","type":"expense","amount":10,"category":"c","date":"2026-01-01","note":""}]"""
        val parsed = PendingTransactionCodec.parse(v1)
        assertEquals(1, parsed.size)
        assertEquals("old", parsed[0].id)
        assertEquals(1, parsed[0].schemaVersion)
        assertEquals(0L, parsed[0].createdAt)
        assertEquals("pet_quick_add", parsed[0].source)
    }

    @Test
    fun `appended grows the queue in order and dedupes by id`() {
        var json: String? = null
        json = PendingTransactionCodec.appended(json, tx("first"))
        json = PendingTransactionCodec.appended(json, tx("second"))
        json = PendingTransactionCodec.appended(json, tx("first", 999.0)) // replay of same id
        val parsed = PendingTransactionCodec.parse(json)
        assertEquals(listOf("second", "first"), parsed.map { it.id })
        assertEquals(2, parsed.size)
    }

    @Test
    fun `removed acks only the given ids`() {
        val json = PendingTransactionCodec.serialize(listOf(tx("a"), tx("b"), tx("c")))
        val after = PendingTransactionCodec.parse(PendingTransactionCodec.removed(json, listOf("a", "c")))
        assertEquals(listOf("b"), after.map { it.id })
    }

    @Test
    fun `corrupt json degrades to an empty queue and is detectable`() {
        assertTrue(PendingTransactionCodec.parse("{broken").isEmpty())
        assertTrue(PendingTransactionCodec.isCorrupt("{broken"))
        assertFalse(PendingTransactionCodec.isCorrupt(null))
        assertFalse(PendingTransactionCodec.isCorrupt(""))
        assertFalse(PendingTransactionCodec.isCorrupt("[]"))
    }

    @Test
    fun `missing optional payment method stays null`() {
        val json = """[{"id":"x","type":"expense","amount":10,"category":"c","date":"2026-01-01","note":""}]"""
        assertNull(PendingTransactionCodec.parse(json)[0].paymentMethod)
    }

    @Test
    fun `unknown type defaults to expense`() {
        val json = """[{"id":"x","type":"weird","amount":10,"category":"c","date":"2026-01-01","note":""}]"""
        assertEquals("expense", PendingTransactionCodec.parse(json)[0].type)
    }
}
