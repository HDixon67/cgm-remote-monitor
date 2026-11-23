package io.github.hdixon67.cgmhub

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The web app hands the widget what it knows: Nightscout address + token (kept in this app's private storage,
 * so the widget can refresh on its own), units and range, the latest reading, insulin on board and a short nudge.
 * JS: Capacitor.Plugins.Widget.update({ url, token, units, low, high, sgv, date, direction, delta, iob, extra })
 */
@CapacitorPlugin(name = "Widget")
class WidgetPlugin : Plugin() {

    @PluginMethod
    fun update(call: PluginCall) {
        val e = WidgetRender.prefs(context).edit()
        call.getString("url")?.let { e.putString("url", it.trimEnd('/')) }
        call.getString("token")?.let { e.putString("token", it) }
        call.getString("units")?.let { e.putString("units", it) }
        call.getDouble("low")?.let { e.putFloat("low", it.toFloat()) }
        call.getDouble("high")?.let { e.putFloat("high", it.toFloat()) }
        val sgv = call.getInt("sgv")
        val date = call.getLong("date")
        if (sgv != null && date != null) {
            e.putInt("sgv", sgv).putLong("date", date).putString("direction", call.getString("direction") ?: "")
            val d = call.getDouble("delta")
            if (d != null) e.putFloat("delta", d.toFloat()) else e.remove("delta")
        }
        call.getDouble("iob")?.let { e.putFloat("iob", it.toFloat()) }
        e.putString("extra", call.getString("extra") ?: "")
        e.putLong("pushedAt", System.currentTimeMillis())
        e.apply()
        WidgetRender.updateAll(context)
        WidgetWorker.schedule(context)
        call.resolve()
    }
}
