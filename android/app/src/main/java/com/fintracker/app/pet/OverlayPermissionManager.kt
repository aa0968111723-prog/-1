package com.fintracker.app.pet

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/** Single place that knows how SYSTEM_ALERT_WINDOW is checked and requested. */
object OverlayPermissionManager {

    fun canDrawOverlays(context: Context): Boolean = Settings.canDrawOverlays(context)

    /**
     * Intent for the system overlay-permission screen. The in-app onboarding
     * dialog must be shown BEFORE launching this — never throw the user into
     * system settings without context.
     */
    fun buildRequestIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + context.packageName),
        )
}
