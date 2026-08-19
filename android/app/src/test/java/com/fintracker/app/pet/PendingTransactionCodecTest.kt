package com.fintracker.app.pet

import org.junit.Assert.assertEquals
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
    )

    @Test
    fun `round-trips a queue`() {
        val json = PendingTransactionCodec.serialize(listOf(tx("a"), tx("b", 55.5)))
        val parsed = PendingTransactionCodec.parse(json)
        assertEquals(2, parsed.size)
        assertEquals("a", parsed[0].id)
        assertEquals(55.5, parsed[1].amount, 0.0001)
        assertEquals("餐飲美食", parsed[0].category)
        assertEquals("cash", parsed[0].paymentMethod)
    }

    @Test
    fun `appended grows the queue in order`() {
        var json: String? = null
        json = PendingTransactionCodec.appended(json, tx("first"))
        json = PendingTransactionCodec.appended(json, tx("second"))
        val parsed = PendingTransactionCodec.parse(json)
        assertEquals(listOf("first", "second"), parsed.map { it.id })
    }

    @Test
    fun `removed acks only the given ids`() {
        val json = PendingTransactionCodec.serialize(listOf(tx("a"), tx("b"), tx("c")))
        val after = PendingTransactionCodec.parse(PendingTransactionCodec.removed(json, listOf("a", "c")))
        assertEquals(listOf("b"), after.map { it.id })
    }

    @Test
    fun `corrupt json degrades to an empty queue, never crashes`() {
        assertTrue(PendingTransactionCodec.parse("{broken").isEmpty())
        assertTrue(PendingTransactionCodec.parse(null).isEmpty())
        assertTrue(PendingTransactionCodec.parse("").isEmpty())
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
