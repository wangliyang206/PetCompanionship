package com.petcomp.game.notify;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.List;

/**
 * Persists pending notifications so alarms can be re-armed after a reboot.
 * Format per id: "<triggerAtMs>\u001F<title>\u001F<body>".
 */
final class PendingNotificationStore {

    private static final String PREFS = "pet_pending_notifications";
    private static final String SEP = "\u001F";

    private PendingNotificationStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void put(Context context, int id, long triggerAtMs, String title, String body) {
        String value = triggerAtMs + SEP + (title == null ? "" : title) + SEP + (body == null ? "" : body);
        prefs(context).edit().putString(String.valueOf(id), value).apply();
    }

    static void remove(Context context, int id) {
        prefs(context).edit().remove(String.valueOf(id)).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    /** One record: id + trigger time + copy. */
    static final class Entry {
        final int id;
        final long triggerAtMs;
        final String title;
        final String body;

        Entry(int id, long triggerAtMs, String title, String body) {
            this.id = id;
            this.triggerAtMs = triggerAtMs;
            this.title = title;
            this.body = body;
        }
    }

    static List<Entry> all(Context context) {
        List<Entry> result = new ArrayList<Entry>();
        SharedPreferences preferences = prefs(context);
        for (String key : preferences.getAll().keySet()) {
            String value = preferences.getString(key, null);
            if (value == null) {
                continue;
            }
            String[] parts = value.split(SEP, -1);
            if (parts.length < 3) {
                continue;
            }
            int id;
            long triggerAtMs;
            try {
                id = Integer.parseInt(key);
                triggerAtMs = Long.parseLong(parts[0]);
            } catch (NumberFormatException error) {
                continue;
            }
            result.add(new Entry(id, triggerAtMs, parts[1], parts[2]));
        }
        return result;
    }
}
