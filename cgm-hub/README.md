# CGM Hub

A personal phone web app that reads your Nightscout site and shows:

- **Now**: current glucose, trend, and a 30-minute low/high forecast (Nightscout's AR2)
- **On board**: active insulin and carbs, with time left
- **Insights**: time in range, average, variability, lows/highs, est. A1c, 14-day range
- **Bolus calculator**: the same steps as Diabetes:M, showing all the math
- **Log**: save insulin and carbs to Nightscout

It runs only in your browser. Your data stays in Nightscout; your token and settings stay on your phone.

> ⚠️ Personal tool, not a medical device. Doses are suggestions. Keep your Libre app alarms on.

## Set up

1. In Nightscout: ☰ → **Admin Tools** → **Add new Subject** → name `cgmhub`, roles `readable` + `careportal`. Copy the token.
2. Open CGM Hub → **Settings** → paste your Nightscout URL and token → fill in your numbers → tick the box → **Save**.
3. Phone: open the browser menu → **Add to Home screen**.

## Hosting

`.github/workflows/cgm-hub-pages.yml` publishes this folder to GitHub Pages on every push to `master`.
One-time: repo **Settings → Pages → Source: GitHub Actions**.

## Notes

- Insulin/carbs-on-board use the same curves as Nightscout (`lib/plugins/iob.js`, simple linear carb absorption with a 20-minute delay).
- Basal doses (event type or note containing basal/Basaglar/Lantus/etc.) are left out of insulin on board.
- If another app also uploads the same doses to Nightscout, they'll be counted twice. Log each dose in one place.
