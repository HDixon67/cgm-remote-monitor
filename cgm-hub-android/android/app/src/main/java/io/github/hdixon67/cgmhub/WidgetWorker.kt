package io.github.hdixon67.cgmhub

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** Fetches the latest glucose from Nightscout in the background (Android allows every 15 min at most) and redraws the widget. */
class WidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val p = WidgetRender.prefs(ctx)
        val base = p.getString("url", null)
        val token = p.getString("token", null)
        if (base.isNullOrEmpty() || token.isNullOrEmpty()) { WidgetRender.updateAll(ctx); return Result.success() }
        try {
            val body = withContext(Dispatchers.IO) {
                val url = URL(base + "/api/v1/entries/sgv.json?count=2&token=" + URLEncoder.encode(token, "UTF-8"))
                val c = url.openConnection() as HttpURLConnection
                c.connectTimeout = 15_000
                c.readTimeout = 15_000
                c.setRequestProperty("Accept", "application/json")
                try { if (c.responseCode == 200) c.inputStream.bufferedReader().readText() else null } finally { c.disconnect() }
            }
            if (body != null) {
                val arr = JSONArray(body)
                if (arr.length() > 0) {
                    val a = arr.getJSONObject(0)
                    val e = p.edit().putInt("sgv", a.optInt("sgv", -1)).putLong("date", a.optLong("date", 0L)).putString("direction", a.optString("direction", ""))
                    if (arr.length() > 1) {
                        val b = arr.getJSONObject(1)
                        if (a.optLong("date") - b.optLong("date") <= 15 * 60_000L) e.putFloat("delta", (a.optInt("sgv") - b.optInt("sgv")).toFloat()) else e.remove("delta")
                    }
                    e.apply()
                }
            }
        } catch (e: Exception) {
            // offline: keep the last reading (it shows as old after 15 minutes)
        }
        WidgetRender.updateAll(ctx)
        return Result.success()
    }

    companion object {
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "cgmhub-widget", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<WidgetWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
        }

        fun now(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniqueWork(
                "cgmhub-widget-now", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<WidgetWorker>().setConstraints(net).build())
        }

        fun cancel(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork("cgmhub-widget") }
    }
}
