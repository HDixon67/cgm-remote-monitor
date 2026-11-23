package io.github.hdixon67.cgmhub

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** Draws the home-screen widget from what's saved in SharedPreferences (by the app or WidgetWorker). */
object WidgetRender {
    private const val MIN = 60_000L

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("cgmhub_widget", Context.MODE_PRIVATE)

    fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, GlucoseWidget::class.java))
        if (ids.isEmpty()) return
        mgr.updateAppWidget(ids, build(ctx))
    }

    private fun arrow(dir: String?): String = when (dir) {
        "DoubleUp" -> "⇈"
        "SingleUp" -> "↑"
        "FortyFiveUp" -> "↗"
        "Flat" -> "→"
        "FortyFiveDown" -> "↘"
        "SingleDown" -> "↓"
        "DoubleDown" -> "⇊"
        else -> ""
    }

    fun build(ctx: Context): RemoteViews {
        val p = prefs(ctx)
        val v = RemoteViews(ctx.packageName, R.layout.widget_glucose)
        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))

        val sgv = p.getInt("sgv", -1)
        val date = p.getLong("date", 0L)
        if (sgv <= 0 || date <= 0L) {
            v.setTextViewText(R.id.w_bg, "--")
            v.setTextViewText(R.id.w_sub, if (p.getString("url", null) == null) "Open CGM Hub once to connect" else "No reading yet")
            v.setInt(R.id.w_root, "setBackgroundResource", R.drawable.widget_bg_stale)
            return v
        }
        val now = System.currentTimeMillis()
        val mmol = p.getString("units", "mmol") == "mmol"
        val fmt = { mg: Double -> if (mmol) String.format(Locale.US, "%.1f", mg / 18.0) else Math.round(mg).toString() }
        val stale = now - date > 15 * MIN
        v.setTextViewText(R.id.w_bg, fmt(sgv.toDouble()))
        v.setTextViewText(R.id.w_arrow, if (stale) "" else arrow(p.getString("direction", null)))
        val delta = p.getFloat("delta", Float.NaN)
        v.setTextViewText(R.id.w_delta, if (delta.isNaN() || stale) "" else (if (delta >= 0) "+" else "−") + fmt(abs(delta.toDouble())))

        val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(date))
        val bits = mutableListOf(if (stale) "⚠ $time (old)" else time)
        val pushedAt = p.getLong("pushedAt", 0L)
        val iob = p.getFloat("iob", 0f)
        if (now - pushedAt < 60 * MIN && iob > 0.05f) bits.add(String.format(Locale.US, "IOB %.1fu", iob))
        v.setTextViewText(R.id.w_sub, bits.joinToString(" · "))

        val extra = p.getString("extra", "") ?: ""
        if (extra.isNotEmpty() && now - pushedAt < 3 * 60 * MIN) {
            v.setTextViewText(R.id.w_extra, extra)
            v.setViewVisibility(R.id.w_extra, View.VISIBLE)
        } else v.setViewVisibility(R.id.w_extra, View.GONE)

        val low = p.getFloat("low", 70f)
        val high = p.getFloat("high", 180f)
        val bg = when {
            stale -> R.drawable.widget_bg_stale
            sgv < low -> R.drawable.widget_bg_low
            sgv > high -> R.drawable.widget_bg_high
            else -> R.drawable.widget_bg_in
        }
        v.setInt(R.id.w_root, "setBackgroundResource", bg)
        return v
    }
}
