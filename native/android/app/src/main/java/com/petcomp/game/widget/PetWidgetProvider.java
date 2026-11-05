package com.petcomp.game.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import com.petcomp.game.notify.PetNotifier;

/**
 * Home screen widget: pet thumbnail + name + behaviour status text.
 * Tap anywhere on the widget launches the game.
 */
public class PetWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        if (manager == null || appWidgetIds == null) {
            return;
        }
        RemoteViews views = buildViews(context);
        if (views == null) {
            return;
        }
        for (int appWidgetId : appWidgetIds) {
            manager.updateAppWidget(appWidgetId, views);
        }
    }

    /** Push the latest stored name/status to every placed widget instance. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) {
            return;
        }
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PetWidgetProvider.class));
        if (ids == null || ids.length == 0) {
            return;
        }
        RemoteViews views = buildViews(context);
        if (views == null) {
            return;
        }
        for (int id : ids) {
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews buildViews(Context context) {
        int layoutId = resourceId(context, "pet_widget", "layout");
        if (layoutId == 0) {
            return null;
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);

        int nameId = resourceId(context, "widget_name", "id");
        if (nameId != 0) {
            views.setTextViewText(nameId, PetWidgetStore.name(context));
        }

        int statusId = resourceId(context, "widget_status", "id");
        if (statusId != 0) {
            views.setTextViewText(statusId, PetWidgetStore.status(context));
        }

        int thumbId = resourceId(context, "widget_thumb", "id");
        int thumbDrawable = PetNotifier.drawableId(context, "widget_pet_thumb");
        if (thumbId != 0 && thumbDrawable != 0) {
            views.setImageViewResource(thumbId, thumbDrawable);
        }

        int rootId = resourceId(context, "widget_root", "id");
        if (rootId != 0) {
            PendingIntent launch = PetNotifier.launchIntent(context, 2);
            views.setOnClickPendingIntent(rootId, launch);
        }
        return views;
    }

    private static int resourceId(Context context, String name, String type) {
        return context.getResources().getIdentifier(name, type, context.getPackageName());
    }
}
