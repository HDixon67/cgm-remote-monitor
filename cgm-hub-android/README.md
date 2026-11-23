# CGM Hub for Android

A small Android app that opens CGM Hub (the web app on GitHub Pages) and adds what a web page can't do:
reading **Health Connect** (steps, heart rate, resting heart rate, sleep, workouts, active calories from
Samsung Health / Galaxy Watch / other apps). The screens still load from the website, so normal CGM Hub
updates arrive automatically. A new APK is only needed when the Android part changes.

## Install (no Play Store needed, free)
1. On your phone, open https://github.com/HDixon67/cgm-remote-monitor/releases/tag/android-latest
2. Download **cgm-hub.apk** and open it. Allow your browser to install apps if Android asks (once).
3. Open CGM Hub → Settings → ❤️ Health Connect → **Connect**.

Updates: download the APK from the same link again; it installs over the old one (your settings stay).

## How it's built
`.github/workflows/cgm-hub-android.yml` builds with Capacitor + Gradle on GitHub Actions:
- pull requests: debug build only (checks it compiles)
- `master` / manual run: signed release build, published to the `android-latest` release

The signing key lives only in the `ANDROID_KEYSTORE_B64` repository secret (base64 of a keystore with alias
`cgmhub`). Keep a backup copy: without the same key, Android won't install updates over the old app.

Health data is read on the phone and saved to your own Nightscout as one `Health Summary` treatment per day.

## Home-screen widget
Long-press the home screen → Widgets → CGM Hub. It shows glucose, arrow, change, time, insulin on board and the top side quest or next med, coloured low / in range / high (grey when the reading is over 15 minutes old).
- While the app is open, the web app sends updates through the `Widget` plugin (`WidgetPlugin.kt`).
- In the background, `WidgetWorker` fetches the latest reading from Nightscout every ~15 minutes (Android's minimum) using the address and token the app handed over (kept in the app's private storage).
