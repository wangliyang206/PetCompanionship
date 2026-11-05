package com.petcomp.game.shared;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;

import java.lang.ref.WeakReference;

/**
 * Holds the Android application context / activity for JSB bridge classes.
 * Initialized from AppActivity.onCreate by tools/inject-android.js.
 */
public final class BridgeContext {

    private static Context sAppContext;
    private static WeakReference<Activity> sActivityRef;

    private BridgeContext() {
    }

    public static void init(Activity activity) {
        if (activity == null) {
            return;
        }
        sAppContext = activity.getApplicationContext();
        sActivityRef = new WeakReference<Activity>(activity);
    }

    public static Context app() {
        return sAppContext;
    }

    public static Activity activity() {
        return sActivityRef == null ? null : sActivityRef.get();
    }

    public static boolean hasPermission(String permission) {
        Context context = sAppContext;
        if (context == null) {
            return false;
        }
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
}
