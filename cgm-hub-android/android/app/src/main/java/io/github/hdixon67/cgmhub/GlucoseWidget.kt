package io.github.hdixon67.cgmhub

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** Home-screen widget: glucose, arrow, change, time, insulin on board and a nudge from CGM Hub. */
class GlucoseWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetManager.updateAppWidget(appWidgetIds, WidgetRender.build(context))
        WidgetWorker.schedule(context)
        WidgetWorker.now(context)
    }

    override fun onEnabled(context: Context) { WidgetWorker.schedule(context) }

    override fun onDisabled(context: Context) { WidgetWorker.cancel(context) }
}
