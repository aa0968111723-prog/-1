package com.fintracker.app.pet

import android.content.SharedPreferences

/**
 * Queue of transactions captured natively (QuickAddActivity) while the
 * FinTracker WebView may not be running.
 *
 * The web layer is the single source of truth for finance data; this queue
 * is a hand-off buffer only. Entries keep their UUID so the web side can
 * drain idempotently: getAll -> import -> ack(ids). JSON encoding lives in
 * [PendingTransactionCodec].
 */
object PendingTransactionQueue {

    const val KEY_PENDING = "pending_transactions"

    @Synchronized
    fun add(prefs: SharedPreferences, tx: PendingTransactionCodec.PendingTransaction) {
        prefs.edit()
            .putString(KEY_PENDING, PendingTransactionCodec.appended(prefs.getString(KEY_PENDING, null), tx))
            .apply()
    }

    @Synchronized
    fun getAll(prefs: SharedPreferences): List<PendingTransactionCodec.PendingTransaction> =
        PendingTransactionCodec.parse(prefs.getString(KEY_PENDING, null))

    @Synchronized
    fun ack(prefs: SharedPreferences, ids: Collection<String>) {
        prefs.edit()
            .putString(KEY_PENDING, PendingTransactionCodec.removed(prefs.getString(KEY_PENDING, null), ids))
            .apply()
    }

    @Synchronized
    fun count(prefs: SharedPreferences): Int = getAll(prefs).size
}
