package com.fintracker.app

import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.fintracker.app.pet.FloatingPetService
import com.fintracker.app.pet.OverlayPermissionManager
import com.fintracker.app.pet.PendingTransactionQueue
import com.fintracker.app.pet.PetActionBridge
import com.fintracker.app.pet.PetPrefs
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Capacitor bridge for the floating finance pet.
 *
 * The web layer drives everything: it pushes settings + the computed pet
 * finance state down, and drains natively-captured quick-add transactions
 * back up. Native never learns React UI details — it only receives data and
 * emits semantic petEvent notifications.
 */
@CapacitorPlugin(
    name = "FinancePet",
    permissions = [
        Permission(alias = "notifications", strings = ["android.permission.POST_NOTIFICATIONS"]),
    ],
)
class FinancePetPlugin : Plugin() {

    private lateinit var petPrefs: PetPrefs

    private val bridgeListener = PetActionBridge.Listener { kind ->
        val data = JSObject().put("kind", kind)
        notifyListeners("petEvent", data)
    }

    override fun load() {
        petPrefs = PetPrefs(context)
        PetActionBridge.addListener(bridgeListener)
        // Cold start from a pet menu action: forward the launch intent's event.
        activity?.intent?.getStringExtra(FloatingPetService.EXTRA_PET_EVENT)?.let { kind ->
            activity.intent.removeExtra(FloatingPetService.EXTRA_PET_EVENT)
            notifyListeners("petEvent", JSObject().put("kind", kind), true)
        }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        intent.getStringExtra(FloatingPetService.EXTRA_PET_EVENT)?.let { kind ->
            intent.removeExtra(FloatingPetService.EXTRA_PET_EVENT)
            notifyListeners("petEvent", JSObject().put("kind", kind))
        }
    }

    override fun handleOnDestroy() {
        PetActionBridge.removeListener(bridgeListener)
        super.handleOnDestroy()
    }

    // ---- permission ----

    @PluginMethod
    fun canDrawOverlays(call: PluginCall) {
        call.resolve(JSObject().put("granted", OverlayPermissionManager.canDrawOverlays(context)))
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (OverlayPermissionManager.canDrawOverlays(context)) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        startActivityForResult(call, OverlayPermissionManager.buildRequestIntent(context), "overlayPermissionResult")
    }

    @ActivityCallback
    private fun overlayPermissionResult(call: PluginCall?, result: ActivityResult?) {
        call?.resolve(JSObject().put("granted", OverlayPermissionManager.canDrawOverlays(context)))
    }

    // ---- pet lifecycle ----

    @PluginMethod
    fun startPet(call: PluginCall) {
        call.getObject("settings")?.let { petPrefs.settingsJson = it.toString() }
        if (!OverlayPermissionManager.canDrawOverlays(context)) {
            call.resolve(JSObject().put("started", false).put("reason", "overlay_permission_denied"))
            return
        }
        // Ask for POST_NOTIFICATIONS once (Android 13+) so the FGS notification is
        // visible; the pet starts either way — the permission is not a dependency.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != com.getcapacitor.PermissionState.GRANTED && !call.getBoolean("skipNotificationPrompt", false)!!) {
            requestPermissionForAlias("notifications", call, "notificationsPermissionResult")
            return
        }
        doStartPet(call)
    }

    @PermissionCallback
    private fun notificationsPermissionResult(call: PluginCall) {
        doStartPet(call)
    }

    private fun doStartPet(call: PluginCall) {
        petPrefs.enabled = true
        try {
            // The app is in the foreground here (the user just tapped 開啟桌寵),
            // so a foreground-service start is always permitted.
            ContextCompat.startForegroundService(
                context,
                Intent(context, FloatingPetService::class.java).setAction(FloatingPetService.ACTION_START),
            )
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            petPrefs.enabled = false
            call.resolve(JSObject().put("started", false).put("reason", e.javaClass.simpleName))
        }
    }

    @PluginMethod
    fun stopPet(call: PluginCall) {
        petPrefs.enabled = false
        if (FloatingPetService.running) {
            context.startService(
                Intent(context, FloatingPetService::class.java).setAction(FloatingPetService.ACTION_STOP),
            )
        }
        call.resolve()
    }

    @PluginMethod
    fun getPetStatus(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("running", FloatingPetService.running)
                .put("permissionGranted", OverlayPermissionManager.canDrawOverlays(context))
                .put("pendingCount", PendingTransactionQueue.count(petPrefs.prefs)),
        )
    }

    // ---- settings / state sync (web -> native) ----

    @PluginMethod
    fun setPetSettings(call: PluginCall) {
        call.getObject("settings")?.let { petPrefs.settingsJson = it.toString() }
        if (FloatingPetService.running) {
            context.startService(
                Intent(context, FloatingPetService::class.java).setAction(FloatingPetService.ACTION_UPDATE_SETTINGS),
            )
        }
        call.resolve()
    }

    @PluginMethod
    fun updatePetState(call: PluginCall) {
        call.getObject("state")?.let { petPrefs.petStateJson = it.toString() }
        if (FloatingPetService.running) {
            context.startService(
                Intent(context, FloatingPetService::class.java).setAction(FloatingPetService.ACTION_UPDATE_STATE),
            )
        }
        call.resolve()
    }

    // ---- pending queue (native -> web) ----

    @PluginMethod
    fun getPendingTransactions(call: PluginCall) {
        val arr = JSArray()
        PendingTransactionQueue.getAll(petPrefs.prefs).forEach { arr.put(it.toJson()) }
        call.resolve(JSObject().put("transactions", arr))
    }

    @PluginMethod
    fun ackPendingTransactions(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>() ?: emptyList()
        PendingTransactionQueue.ack(petPrefs.prefs, ids)
        call.resolve()
    }
}
