package com.fintracker.app.pet

import java.util.concurrent.CopyOnWriteArraySet

/**
 * In-process event hub between the native overlay stack (service, quick add
 * activity) and the Capacitor plugin. Native components never talk to the
 * WebView directly — they emit semantic events here; the plugin forwards
 * them to React listeners when the WebView is alive.
 */
object PetActionBridge {

    const val EVENT_PET_TAPPED = "petTapped"
    const val EVENT_QUICK_EXPENSE = "quickExpenseRequested"
    const val EVENT_QUICK_INCOME = "quickIncomeRequested"
    const val EVENT_OPEN_DASHBOARD = "openDashboardRequested"
    const val EVENT_TRANSACTION_QUEUED = "transactionQueued"
    const val EVENT_PET_STOPPED = "petStopped"

    fun interface Listener {
        fun onPetEvent(kind: String)
    }

    private val listeners = CopyOnWriteArraySet<Listener>()

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    fun emit(kind: String) {
        listeners.forEach { it.onPetEvent(kind) }
    }
}
