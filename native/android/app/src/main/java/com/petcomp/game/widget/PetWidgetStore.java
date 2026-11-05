package com.petcomp.game.widget;

import android.content.Context;
import android.content.SharedPreferences;

import com.petcomp.game.notify.PetNotifier;
import com.petcomp.game.shared.BridgeContext;

/**
 * JSB entry point: com.petcomp.game.widget.PetWidgetStore
 * Signature called from TypeScript: update(String petName, String statusText)
 */
public final class PetWidgetStore {

    private static final String PREFS = "pet_widget";
    private static final String KEY_NAME = "name";
    private static final String KEY_STATUS = "status";

    private PetWidgetStore() {
    }

    public static void update(String name, String status) {
        Context context = BridgeContext.app();
        if (context == null) {
            return;
        }
        prefs(context).edit()
                .putString(KEY_NAME, name == null ? "" : name)
                .putString(KEY_STATUS, status == null ? "" : status)
                .apply();
        PetWidgetProvider.refreshAll(context);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String name(Context context) {
        return prefs(context).getString(KEY_NAME, "");
    }

    static String status(Context context) {
        String stored = prefs(context).getString(KEY_STATUS, null);
        return stored == null ? PetNotifier.str(context, "pet_widget_default_status", "Waiting for you") : stored;
    }
}
