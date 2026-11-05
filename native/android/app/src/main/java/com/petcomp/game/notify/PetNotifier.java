package com.petcomp.game.notify;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * AlarmManager / PendingIntent / notification display helpers.
 * All Chinese copy lives in res/values/strings_notify.xml to avoid source-encoding issues.
 */
public final class PetNotifier {

    public static final String CHANNEL_ID = "pet_events";
    public static final String EXTRA_ID = "notify_id";
    public static final String EXTRA_TITLE = "notify_title";
    public static final String EXTRA_BODY = "notify_body";

    private static final long INEXACT_WINDOW_MS = 15L * 60L * 1000L;

    private PetNotifier() {
    }

    /** Resolve a string resource by name (keeps Java free of a hard R package dependency). */
    public static String str(Context context, String name, String fallback) {
        if (context == null) {
            return fallback;
        }
        int id = context.getResources().getIdentifier(name, "string", context.getPackageName());
        return id == 0 ? fallback : context.getString(id);
    }

    static int drawableId(Context context, String name) {
        if (context == null) {
            return 0;
        }
        return context.getResources().getIdentifier(name, "drawable", context.getPackageName());
    }

    public static PendingIntent launchIntent(Context context, int requestCode) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) {
            intent = new Intent(Intent.ACTION_MAIN);
            intent.setPackage(context.getPackageName());
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }

    private static PendingIntent alarmIntent(Context context, int id, String title, String body) {
        Intent intent = new Intent(context, NotificationAlarmReceiver.class);
        intent.putExtra(EXTRA_ID, id);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_BODY, body);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, id, intent, flags);
    }

    /** Arm a wall-clock alarm for the given notification id. */
    public static void arm(Context context, int id, long triggerAtMs, String title, String body) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }
        PendingIntent pendingIntent = alarmIntent(context, id, title, body);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
                alarmManager.setWindow(AlarmManager.RTC_WAKEUP, triggerAtMs, INEXACT_WINDOW_MS, pendingIntent);
            } else {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
            }
        } catch (SecurityException error) {
            // Exact alarms are a special access on Android 12+; degrade to an inexact alarm.
            alarmManager.setWindow(AlarmManager.RTC_WAKEUP, triggerAtMs, INEXACT_WINDOW_MS, pendingIntent);
        }
    }

    /** Cancel the alarm and remove any shown notification for this id. */
    public static void cancel(Context context, int id) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.cancel(alarmIntent(context, id, null, null));
        }
        android.app.NotificationManager notificationManager =
                (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.cancel(id);
        }
    }
}
