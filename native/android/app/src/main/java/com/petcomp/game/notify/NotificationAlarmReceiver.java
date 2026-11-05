package com.petcomp.game.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires the notification when the scheduled alarm goes off. */
public class NotificationAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(PetNotifier.EXTRA_ID, 0);
        String title = intent.getStringExtra(PetNotifier.EXTRA_TITLE);
        String body = intent.getStringExtra(PetNotifier.EXTRA_BODY);
        PendingNotificationStore.remove(context, id);
        PetNotificationBridge.showNow(context, id, title, body);
    }
}
