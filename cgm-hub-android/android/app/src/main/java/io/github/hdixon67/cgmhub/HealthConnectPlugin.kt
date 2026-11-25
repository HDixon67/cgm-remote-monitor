package io.github.hdixon67.cgmhub

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Mass
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import kotlin.reflect.KClass

/**
 * Read-only bridge from Health Connect (Samsung Health, Galaxy Watch, Google Fit...) to the CGM Hub web app.
 * JS: Capacitor.Plugins.HealthConnect.availability() / requestHealthPermissions() / grantedPermissions() / readRange({ start, end })
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val permissions = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(NutritionRecord::class),
    )

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    @PluginMethod
    fun availability(call: PluginCall) {
        val status = when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
            else -> "not_installed"
        }
        call.resolve(JSObject().put("status", status))
    }

    @PluginMethod
    fun grantedPermissions(call: PluginCall) {
        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                val arr = JSArray()
                granted.forEach { arr.put(it) }
                call.resolve(JSObject().put("granted", arr).put("all", granted.containsAll(permissions)))
            } catch (e: Exception) {
                call.reject("Couldn't check Health Connect permissions: " + e.message)
            }
        }
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val intent: Intent = PermissionController.createRequestPermissionResultContract().createIntent(context, permissions)
        startActivityForResult(call, intent, "permissionsResult")
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall, result: ActivityResult) {
        val granted = PermissionController.createRequestPermissionResultContract().parseResult(result.resultCode, result.data)
        val arr = JSArray()
        granted.forEach { arr.put(it) }
        call.resolve(JSObject().put("granted", arr).put("all", granted.containsAll(permissions)))
    }

    private suspend fun <T : Record> readAll(type: KClass<T>, start: Instant, end: Instant): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        do {
            val res = client().readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(start, end), pageToken = token))
            out.addAll(res.records)
            token = res.pageToken
        } while (!token.isNullOrEmpty())
        return out
    }

    /** Everything between start and end (ms). Missing permissions just return empty lists. */
    @PluginMethod
    fun readRange(call: PluginCall) {
        val start = Instant.ofEpochMilli(call.getLong("start") ?: (System.currentTimeMillis() - 86_400_000L))
        val end = Instant.ofEpochMilli(call.getLong("end") ?: System.currentTimeMillis())
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                fun has(k: KClass<out Record>) = granted.contains(HealthPermission.getReadPermission(k))
                val res = JSObject()

                // steps per hour (deduplicated across phone + watch by Health Connect)
                val steps = JSArray()
                if (has(StepsRecord::class)) {
                    val buckets = c.aggregateGroupByDuration(AggregateGroupByDurationRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        timeRangeSlicer = Duration.ofHours(1)))
                    buckets.forEach { b ->
                        val n = b.result[StepsRecord.COUNT_TOTAL] ?: 0L
                        if (n > 0) steps.put(JSObject().put("t", b.startTime.toEpochMilli()).put("steps", n))
                    }
                }
                res.put("steps", steps)

                // heart rate samples
                val hr = JSArray()
                if (has(HeartRateRecord::class)) {
                    readAll(HeartRateRecord::class, start, end).forEach { r ->
                        r.samples.forEach { s -> hr.put(JSArray().put(s.time.toEpochMilli()).put(s.beatsPerMinute)) }
                    }
                }
                res.put("heartRate", hr)

                val rhr = JSArray()
                if (has(RestingHeartRateRecord::class)) {
                    readAll(RestingHeartRateRecord::class, start, end).forEach { r -> rhr.put(JSObject().put("t", r.time.toEpochMilli()).put("bpm", r.beatsPerMinute)) }
                }
                res.put("restingHeartRate", rhr)

                val sleep = JSArray()
                if (has(SleepSessionRecord::class)) {
                    readAll(SleepSessionRecord::class, start.minus(Duration.ofHours(14)), end).forEach { r ->
                        sleep.put(JSObject().put("start", r.startTime.toEpochMilli()).put("end", r.endTime.toEpochMilli()).put("title", r.title ?: ""))
                    }
                }
                res.put("sleep", sleep)

                val ex = JSArray()
                if (has(ExerciseSessionRecord::class)) {
                    readAll(ExerciseSessionRecord::class, start, end).forEach { r ->
                        ex.put(JSObject().put("start", r.startTime.toEpochMilli()).put("end", r.endTime.toEpochMilli()).put("type", r.exerciseType).put("title", r.title ?: ""))
                    }
                }
                res.put("exercise", ex)

                var kcal = 0.0
                if (has(ActiveCaloriesBurnedRecord::class)) {
                    readAll(ActiveCaloriesBurnedRecord::class, start, end).forEach { r -> kcal += r.energy.inKilocalories }
                }
                res.put("activeKcal", kcal)

                // food from Cronometer (or any food app): one entry per food, nutrients in grams, energy in kcal
                val food = JSArray()
                if (has(NutritionRecord::class)) {
                    readAll(NutritionRecord::class, start, end).forEach { r ->
                        val n = JSObject()
                        fun g(k: String, v: Mass?) { if (v != null) n.put(k, v.inGrams) }
                        r.energy?.let { n.put("kcal", it.inKilocalories) }
                        g("carbs", r.totalCarbohydrate); g("fiber", r.dietaryFiber); g("sugars", r.sugar)
                        g("protein", r.protein); g("fat", r.totalFat); g("satFat", r.saturatedFat); g("transFat", r.transFat)
                        g("cholesterol", r.cholesterol); g("sodium", r.sodium); g("potassium", r.potassium)
                        g("calcium", r.calcium); g("iron", r.iron); g("magnesium", r.magnesium); g("zinc", r.zinc)
                        g("vitA", r.vitaminA); g("vitC", r.vitaminC); g("vitD", r.vitaminD); g("vitB12", r.vitaminB12); g("folate", r.folate)
                        g("thiamin", r.thiamin); g("riboflavin", r.riboflavin); g("niacin", r.niacin); g("pantothenic", r.pantothenicAcid)
                        g("vitB6", r.vitaminB6); g("vitE", r.vitaminE); g("vitK", r.vitaminK); g("copper", r.copper)
                        g("manganese", r.manganese); g("phosphorus", r.phosphorus); g("selenium", r.selenium)
                        g("monoFat", r.monounsaturatedFat); g("polyFat", r.polyunsaturatedFat)
                        food.put(JSObject()
                            .put("id", r.metadata.id)
                            .put("start", r.startTime.toEpochMilli())
                            .put("end", r.endTime.toEpochMilli())
                            .put("name", r.name ?: "")
                            .put("meal", r.mealType)
                            .put("source", r.metadata.dataOrigin.packageName)
                            .put("n", n))
                    }
                }
                res.put("nutrition", food)

                call.resolve(res)
            } catch (e: Exception) {
                call.reject("Couldn't read Health Connect: " + e.message)
            }
        }
    }

    /** Opens the Health Connect app/settings so the user can change permissions. */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Couldn't open Health Connect: " + e.message)
        }
    }
}
