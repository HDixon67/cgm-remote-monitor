package io.github.hdixon67.cgmhub

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Barcode scanning with Google's code scanner (Play services). It shows its own camera screen,
 * so the app itself needs no camera permission. JS: Capacitor.Plugins.BarcodeScan.scan()
 * resolves { code } or { cancelled: true }.
 */
@CapacitorPlugin(name = "BarcodeScan")
class BarcodeScanPlugin : Plugin() {

    @PluginMethod
    fun scan(call: PluginCall) {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { code -> call.resolve(JSObject().put("code", code.rawValue ?: "")) }
            .addOnCanceledListener { call.resolve(JSObject().put("cancelled", true)) }
            .addOnFailureListener { e -> call.reject("Couldn't start the scanner: " + e.message) }
    }
}
