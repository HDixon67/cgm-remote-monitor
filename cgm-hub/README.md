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

## Game 🎮

Tap the pet card on Home. Pick a buddy, earn XP for logging, in-range hours, good days, handling lows well and 3 daily quests. Level up to grow your pet and unlock wardrobe items; collect badges.
XP never goes down, highs/lows never cost anything, and streaks have ❄️ freezes (one per 7 days). XP is worked out from your Nightscout data; pet, badges and manual quest check-offs live on the phone (`cgmhub.game.v1`). Turn it off in Settings.

## Import Libre history

Settings → **Import Libre history**. Download the CSV from libreview.com (Glucose History → Download glucose data), then pick the file.
The token needs a role with `api:entries:create` during the import. Readings Nightscout already has (within 10 minutes) are skipped, and re-importing never duplicates.

## Hosting

`.github/workflows/cgm-hub-pages.yml` publishes this folder to GitHub Pages on every push to `master`.
One-time: repo **Settings → Pages → Source: GitHub Actions**.

## Notes

- Meds are saved as `Medication` treatments (with `medName`, `medDose`, `medType`); periods as `Period Start` / `Period End`. They live in your Nightscout, which needs a login to read.
- Cycle trends use daily glucose summaries cached on the phone (`cgmhub.daystats.v1`), built once from Nightscout (up to 180 days back from your first logged period).
- Food search sends only your search words to Open Food Facts.

- Insulin/carbs-on-board use the same curves as Nightscout (`lib/plugins/iob.js`, simple linear carb absorption with a 20-minute delay).
- Basal doses (event type or note containing basal/Basaglar/Lantus/etc.) are left out of insulin on board.
- If another app also uploads the same doses to Nightscout, they'll be counted twice. Log each dose in one place.
