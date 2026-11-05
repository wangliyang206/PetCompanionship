package com.petcomp.game.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-arms all future notifications after a device reboot. */
public class NotificationBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        long now = System.currentTimeMillis();
        for (PendingNotificationStore.Entry entry : PendingNotificationStore.all(context)) {
            if (entry.triggerAtMs > now) {
                PetNotifier.arm(context, entry.id, entry.triggerAtMs, entry.title, entry.body);
            } else {
                PendingNotificationStore.remove(context, entry.id);
            }
        }
    }
}
