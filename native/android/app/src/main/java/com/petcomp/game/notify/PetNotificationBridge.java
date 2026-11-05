package com.petcomp.game.notify;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;

import com.petcomp.game.shared.BridgeContext;

/**
 * JSB entry point: com.petcomp.game.notify.PetNotificationBridge
 *
 * Signatures called from TypeScript:
 *   schedule(int id, String title, String body, String triggerAtMs)
 *   cancel(int id)
 *   cancelAll()
 *   hasPermission() -> boolean
 *   requestPermission()
 */
public final class PetNotificationBridge {

    private static final int PERMISSION_REQUEST_CODE = 2001;

    private PetNotificationBridge() {
    }

    /** Called from AppActivity.onCreate (injected by tools/inject-android.js). */
    public static void onContextReady(Context context) {
        ensureChannel(context);
    }

    private static void ensureChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(PetNotifier.CHANNEL_ID) != null) {
            return;
        }
        String name = PetNotifier.str(context, "pet_notify_channel_name", "Pet Nest");
        String desc = PetNotifier.str(context, "pet_notify_channel_desc", "");
        NotificationChannel channel = new NotificationChannel(
                PetNotifier.CHANNEL_ID, name, NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(desc);
        manager.createNotificationChannel(channel);
    }

    /** Schedule (or reschedule) a local notification. */
    public static void schedule(int id, String title, String body, String triggerAtMs) {
        Context context = BridgeContext.app();
        if (context == null) {
            return;
        }
        long triggerAt;
        try {
            triggerAt = Long.parseLong(triggerAtMs);
        } catch (Exception error) {
            return;
        }
        ensureChannel(context);
        PendingNotificationStore.put(context, id, triggerAt, title, body);
        PetNotifier.arm(context, id, triggerAt, title, body);
    }

    public static void cancel(int id) {
        Context context = BridgeContext.app();
        if (context == null) {
            return;
        }
        PendingNotificationStore.remove(context, id);
        PetNotifier.cancel(context, id);
    }

    public static void cancelAll() {
        Context context = BridgeContext.app();
        if (context == null) {
            return;
        }
        for (PendingNotificationStore.Entry entry : PendingNotificationStore.all(context)) {
            PetNotifier.cancel(context, entry.id);
        }
        PendingNotificationStore.clear(context);
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancelAll();
        }
    }

    public static boolean hasPermission() {
        Context context = BridgeContext.app();
        if (context == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return BridgeContext.hasPermission("android.permission.POST_NOTIFICATIONS");
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return manager != null && manager.areNotificationsEnabled();
    }

    public static void requestPermission() {
        Activity activity = BridgeContext.activity();
        if (activity == null || Build.VERSION.SDK_INT < 33) {
            return;
        }
        activity.requestPermissions(
                new String[]{"android.permission.POST_NOTIFICATIONS"}, PERMISSION_REQUEST_CODE);
    }

    /** Show a notification right now (used by NotificationAlarmReceiver). */
    static void showNow(Context context, int id, String title, String body) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        ensureChannel(context);
        PendingIntent contentIntent = PetNotifier.launchIntent(context, 1);
        int smallIcon = PetNotifier.drawableId(context, "ic_notify_pet");
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.ic_dialog_info;
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, PetNotifier.CHANNEL_ID)
                : new Notification.Builder(context);
        builder.setSmallIcon(smallIcon)
                .setContentTitle(title == null || title.length() == 0
                        ? PetNotifier.str(context, "pet_notify_default_title", "Pet Nest")
                        : title)
                .setContentText(body == null ? "" : body)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setPriority(Notification.PRIORITY_DEFAULT);

        manager.notify(id, builder.build());
    }
}
