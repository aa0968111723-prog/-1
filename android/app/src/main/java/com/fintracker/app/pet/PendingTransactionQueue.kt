package com.fintracker.app.pet

import android.content.SharedPreferences
import android.util.Log

/**
 * Durable native outbox for transactions captured by the pet's quick add
 * while the FinTracker WebView may not be running.
 *
 * The web layer is the single source of truth for finance data; this queue
 * is a hand-off buffer only. Entries keep their UUID so the web side can
 * drain idempotently: getAll -> import -> ack(ids). JSON encoding lives in
 * [PendingTransactionCodec].
 *
 * Corruption safety: if the stored payload exists but cannot be parsed, the
 * raw string is copied to a backup key before the queue is reset — a broken
 * queue must never prevent the service from starting, and never silently
 * discards the unreadable payload.
 */
object PendingTransactionQueue {

    const val KEY_PENDING = "pending_transactions"
    const val KEY_CORRUPT_BACKUP = "pending_transactions_corrupt_backup"
    private const val TAG = "FinancePetSync"

    /**
     * Appends an entry and reports whether it is genuinely on disk.
     *
     * Uses commit() (synchronous) rather than apply(): the outbox write IS the
     * durability guarantee, and the caller may only show "記好啦" once this
     * returns true. The entry is also read back, so a silent write failure
     * cannot be mistaken for success.
     */
    @Synchronized
    fun add(prefs: SharedPreferences, tx: PendingTransactionCodec.PendingTransaction): Boolean {
        return try {
            val raw = readRepairingCorruption(prefs)
            val committed = prefs.edit()
                .putString(KEY_PENDING, PendingTransactionCodec.appended(raw, tx))
                .commit()
            if (!committed) {
                Log.e(TAG, "Outbox commit returned false; entry not persisted")
                return false
            }
            val persisted = PendingTransactionCodec.parse(prefs.getString(KEY_PENDING, null))
                .any { it.id == tx.id }
            if (!persisted) Log.e(TAG, "Outbox read-back missing the entry just written")
            persisted
        } catch (e: Exception) {
            Log.e(TAG, "Outbox write failed", e)
            false
        }
    }

    @Synchronized
    fun getAll(prefs: SharedPreferences): List<PendingTransactionCodec.PendingTransaction> =
        PendingTransactionCodec.parse(readRepairingCorruption(prefs))

    @Synchronized
    fun ack(prefs: SharedPreferences, ids: Collection<String>) {
        val raw = readRepairingCorruption(prefs)
        prefs.edit()
            .putString(KEY_PENDING, PendingTransactionCodec.removed(raw, ids))
            .commit()
    }

    @Synchronized
    fun remove(prefs: SharedPreferences, id: String) = ack(prefs, listOf(id))

    @Synchronized
    fun count(prefs: SharedPreferences): Int = getAll(prefs).size

    private fun readRepairingCorruption(prefs: SharedPreferences): String? {
        val raw = prefs.getString(KEY_PENDING, null)
        if (PendingTransactionCodec.isCorrupt(raw)) {
            Log.w(TAG, "Pending queue payload unreadable; backing up and resetting (len=${raw?.length})")
            prefs.edit()
                .putString(KEY_CORRUPT_BACKUP, raw)
                .putString(KEY_PENDING, "[]")
                .commit()
            return "[]"
        }
        return raw
    }
}
