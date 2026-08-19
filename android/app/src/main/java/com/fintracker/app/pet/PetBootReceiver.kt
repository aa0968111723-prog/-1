package com.fintracker.app.pet

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.fintracker.app.MainActivity
import com.fintracker.app.R

/**
 * Restores the pet after a reboot — but only when the user had it enabled
 * and the overlay permission is still granted.
 *
 * Under Android 15/16 rules, specialUse foreground services remain allowed
 * from BOOT_COMPLETED (unlike dataSync / mediaProjection / phoneCall etc.).
 * Note that since Android 15 merely holding SYSTEM_ALERT_WINDOW no longer
 * exempts background FGS starts (a visible overlay is required), so we rely
 * on the BOOT_COMPLETED allowance only, and if the platform still refuses
 * we degrade to a quiet notification the user can tap — never a hack.
 */
class PetBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = PetPrefs(context)
        if (!prefs.enabled || !OverlayPermissionManager.canDrawOverlays(context)) return

        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, FloatingPetService::class.java).setAction(FloatingPetService.ACTION_START),
            )
        } catch (e: Exception) {
            postRestoreNotification(context)
        }
    }

    private fun postRestoreNotification(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O &&
            nm.getNotificationChannel(CHANNEL_ID) == null
        ) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "小財桌寵恢復", NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            10,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_pet_notification)
            .setContentTitle(context.getString(R.string.pet_restore_notification_title))
            .setContentText(context.getString(R.string.pet_restore_notification_text))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTIFICATION_ID, notification) }
    }

    companion object {
        private const val CHANNEL_ID = "finance_pet_restore"
        private const val NOTIFICATION_ID = 4742
    }
}
