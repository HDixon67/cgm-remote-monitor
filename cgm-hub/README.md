# CGM Hub

A personal phone web app that reads your Nightscout site and shows:

- **Now**: current glucose, trend, and a 30-minute low/high forecast (Nightscout's AR2)
- **On board**: active insulin and carbs, with time left
- **Insights**: time in range, average, variability, lows/highs, est. A1c, 14-day range
- **Bolus calculator**: the same steps as Diabetes:M, showing all the math
- **Log**: save insulin and carbs to Nightscout
  - **Food search** (Open Food Facts) and 📷 **barcode scanning** (camera in Chrome on Android, or type the number) to build a meal and add up carbs, plus ⭐ favourite meals (long-press a favourite to remove it)
  - **Meds & supplements**: save your list once, then tap twice to log
  - **Period**: log start/end days
- **Trends** (14 / 30 / 90 days):
  - 💡 **Insights** with possible causes and ideas to try: overnight lows, early-morning rises, big rises or lows after meals, rebound highs, stacked corrections, unlogged rises, toughest time of day, low time, variability, weekday vs weekend, foods that spike you most, meds/supplements, week-over-week progress
  - **Your typical day** (AGP-style chart), time-of-day breakdown, meals & foods
  - your cycle day and phase, and glucose by cycle phase (period, follicular, ovulation, luteal)

It runs only in your browser. Your data stays in Nightscout; your token and settings stay on your phone.

> ⚠️ Personal tool, not a medical device. Doses are suggestions. Keep your Libre app alarms on.

## Set up

1. In Nightscout: ☰ → **Admin Tools** → **Add new Subject** → name `cgmhub`, roles `readable` + `careportal`. Copy the token.
2. Open CGM Hub → **Settings** → paste your Nightscout URL and token → fill in your numbers → tick the box → **Save**.
3. Phone: open the browser menu → **Add to Home screen**.

## History, morning brief, mood

- **Trends → History**: Day / Week / Month / Cycle with ‹ › and a date picker. Time in range (vs the previous period), average, variability, lows/highs cards, a day chart or typical-day chart, a day summary or daily averages (insulin, carbs, macros, activity, water, mood), patterns, time of day, meals, and a day logbook.
- **Patterns** only appear when something happened at least twice (most need 3+). The main one is shown first with dots for each night/day and a one-week 🧪 experiment.
- **☀️ Morning brief** (Home button; opens once each morning, can be turned off in Settings → Game): lowest yesterday + how you feel, a 06:00→06:00 timeline, and your top pattern.
- **🙂 How do you feel?** check-in (faces + Body/Mind chips), saved as a `Mood` treatment; a pattern compares glucose on days with each feeling (needs 3+ days).

## Food search

Word search uses **USDA FoodData Central** (Open Food Facts' word search no longer allows web apps). Add a free key in Settings → 🍎 Food search (the shared DEMO_KEY allows only a few searches an hour). Barcode scans still use Open Food Facts. Foods you log appear as 🕘 Recent chips.

## Portions, net carbs and nutrition

- Each food in a meal has an amount + unit: label serving, per piece (e.g. "1 stick" from "3 sticks (85 g)"), cup/slice/medium from USDA portion data, g, oz, 100 g.
- Net carbs (carbs − fibre) are shown per food and per meal. Settings → 🥗 Nutrition chooses whether **net** (default) or **total** carbs are logged (that's what the calculator and forecast use).
- Full nutrition facts per food and per meal (calories, fat, saturated/trans fat, cholesterol, sodium, carbs, fibre, sugars, added sugars, protein, potassium, calcium, iron, magnesium, zinc, vitamins A, C, D, B12, folate), saved with the meal as `nutrients`.
- History → 🥗 Nutrition: today's totals or daily averages vs targets (standard adult Daily Values by default, editable in Settings), with foods to add for low nutrients and tips for ones running high (needs 3+ days of full-nutrition meals).

## Stat tiles

Home → Stats → ✏️ **Edit tiles**: add from ~35 tiles (in/above/below range, range split, average, bedtime & wake-up averages, median, highs/lows, Flux grade, mini graph, in-range streak, unicorns 🦄, time low/high, GMI, insulin/bolus/basal per day and totals, carbs, calories, protein, fat, fiber, water, exercise, CV, SD, quartiles). Each tile has its own period (today, 24 h, 3/7/14 days); reorder with ▲▼.
Calories/macros come from food search & barcode scans. Water and exercise are logged in Log → Food.

Settings → **💡 Insights & trends** lets you switch each insight type and Trends section on or off.

## Game 🎮

Tap the pet card on Home. Pick a buddy, earn XP for logging, in-range hours, good days, handling lows well and 3 daily quests (one is picked from your insights, e.g. a walk after the meal that spikes you most). Level up to grow your pet and unlock wardrobe items; collect badges.
XP never goes down, highs/lows never cost anything, and streaks have ❄️ freezes (one per 7 days). XP is worked out from your Nightscout data; pet, badges and manual quest check-offs live on the phone (`cgmhub.game.v1`). Turn it off in Settings.

## Phone reminders 🔔

Settings → **🔔 Phone reminders**: meds (only if not logged yet, with a second nudge an hour later), bedtime glucose check (with your current number), bolus check (carbs logged but no insulin 15 min later), quest nudge, and your own reminders.
Settings are saved in Nightscout as a `CGMHub Settings` treatment. A Northflank cron job (`cgm-reminders`, every 15 min, smallest plan) downloads `reminders/reminders.mjs` from this repo's `master` branch and sends them through Pushover.
Needs `PUSHOVER_API_TOKEN` and `PUSHOVER_ALARM_KEY` in the project's `nightscout` secret group (these also send Nightscout's own low/high/no-data alarms).

## Import Libre history

Settings → **Import Libre history**. Download the CSV from libreview.com (Glucose History → Download glucose data), then pick the file.
The token needs a role with `api:entries:create` during the import. Readings Nightscout already has (within 10 minutes) are skipped, and re-importing never duplicates.

## Hosting

`.github/workflows/cgm-hub-pages.yml` publishes this folder to GitHub Pages on every push to `master`.
One-time: repo **Settings → Pages → Source: GitHub Actions**.

## Forecast

When your carb ratio and sensitivity are set, the 60-minute forecast combines the last 15 minutes of trend with insulin still working (Nightscout's IOB curve × sensitivity) and carbs still digesting (linear absorption × sensitivity ÷ carb ratio). The part of the trend that insulin/carbs don't explain fades out over 30 minutes. Without those numbers it falls back to Nightscout's 30-minute AR2 trend forecast. It only knows about insulin and carbs logged in CGM Hub (or anything else that writes to Nightscout).

## Notes

- Meds are saved as `Medication` treatments (with `medName`, `medDose`, `medType`); periods as `Period Start` / `Period End`. They live in your Nightscout, which needs a login to read.
- Cycle trends use daily glucose summaries cached on the phone (`cgmhub.daystats.v1`), built once from Nightscout (up to 180 days back from your first logged period).
- Food search sends only your search words to Open Food Facts.

- Insulin/carbs-on-board use the same curves as Nightscout (`lib/plugins/iob.js`, simple linear carb absorption with a 20-minute delay).
- Long-acting doses are logged as `Basal Injection` (Log → Food → 💉 Long-acting insulin). Basal doses (event type or note containing basal/Basaglar/Lantus/etc.) are left out of insulin on board.
- If another app also uploads the same doses to Nightscout, they'll be counted twice. Log each dose in one place.
