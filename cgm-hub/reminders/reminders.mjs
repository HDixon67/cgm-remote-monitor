// CGM Hub smart reminders: runs every 15 minutes as a Northflank cron job.
// Reads the reminder settings saved by CGM Hub (a "CGMHub Settings" treatment in Nightscout),
// checks what has been logged today, and sends Pushover notifications only when needed.
//
// Environment (from the project's "nightscout" secret group):
//   API_SECRET               Nightscout API secret (used to read data)
//   PUSHOVER_API_TOKEN       Pushover application token
//   PUSHOVER_ALARM_KEY       Pushover user key
// Optional: NIGHTSCOUT_INTERNAL_URL (default http://sunset-cast:8080), PUSHOVER_URL (for testing)

import crypto from 'node:crypto';

const NS = (process.env.NIGHTSCOUT_INTERNAL_URL || 'http://sunset-cast:8080').replace(/\/+$/, '');
const PUSHOVER_URL = process.env.PUSHOVER_URL || 'https://api.pushover.net/1/messages.json';
const TOKEN = process.env.PUSHOVER_API_TOKEN;
const USER = process.env.PUSHOVER_ALARM_KEY || process.env.PUSHOVER_REMINDER_KEY;
const WINDOW = 15; // minutes between runs
const MIN = 60 * 1000;

function log (...a) { console.log(new Date().toISOString(), ...a); }

async function main () {
  if (!process.env.API_SECRET) { log('API_SECRET is missing, nothing to do'); return; }
  if (!TOKEN || !USER || USER === 'off') { log('Pushover keys not set yet (PUSHOVER_API_TOKEN / PUSHOVER_ALARM_KEY), nothing to send'); return; }
  const headers = { 'api-secret': crypto.createHash('sha1').update(process.env.API_SECRET).digest('hex'), Accept: 'application/json' };
  const get = async (path, params) => {
    const res = await fetch(NS + path + '?' + new URLSearchParams(params), { headers });
    if (!res.ok) throw new Error(path + ' -> ' + res.status);
    return res.json();
  };

  const cfgDocs = await get('/api/v1/treatments.json', { 'find[eventType]': 'CGMHub Settings', count: '1' });
  const cfg = cfgDocs[0] && cfgDocs[0].cgmhub;
  if (!cfg) { log('No reminder settings saved in CGM Hub yet'); return; }

  // local time in the user's time zone
  const now = new Date();
  const tz = cfg.tz || 'UTC';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const nowMin = (parts.hour % 24) * 60 + parts.minute;
  const midnight = now.getTime() - (nowMin * 60 + parts.second) * 1000;
  const due = (hhmm, plus = 0) => {
    if (!hhmm) return false;
    const [h, m] = hhmm.split(':').map(Number);
    const d = nowMin - (h * 60 + m + plus);
    return d >= 0 && d < WINDOW;
  };
  const clock = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t));

  const trs = (await get('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(Math.min(midnight, now - 2 * 60 * MIN)).toISOString(), count: '500' }))
    .map((t) => ({ ...t, ms: typeof t.mills === 'number' ? t.mills : Date.parse(t.created_at) }));
  const today = trs.filter((t) => t.ms >= midnight);
  const out = [];

  // 💊 meds not logged yet today
  for (const m of cfg.meds || []) {
    if (!m.on || !m.name) continue;
    const taken = today.some((t) => t.eventType === 'Medication' && String(t.medName || t.notes || '').toLowerCase().startsWith(m.name.toLowerCase()));
    if (taken) continue;
    if (due(m.time)) out.push(['💊 ' + m.name, `Time for ${m.name}${m.dose ? ' (' + m.dose + ')' : ''}. Tap it in CGM Hub → Log → Meds when done.`]);
    else if (m.nag && due(m.time, 60)) out.push(['💊 ' + m.name + ' (reminder #2)', `Still not logged: ${m.name}. Taken it already? Log it so I stop asking 🙂`]);
  }

  // 🌙 bedtime glucose check
  if (cfg.bedtime && cfg.bedtime.on && due(cfg.bedtime.time)) {
    let line = 'Check your glucose before bed and keep fast sugar nearby.';
    try {
      const e = (await get('/api/v1/entries/sgv.json', { count: '1' }))[0];
      if (e && now - e.date < 20 * MIN) {
        const v = cfg.units === 'mgdl' ? String(e.sgv) : (e.sgv / 18).toFixed(1);
        line = `You’re at ${v} ${cfg.units === 'mgdl' ? 'mg/dL' : 'mmol/L'} right now. Keep fast sugar by your bed. 💤`;
      }
    } catch (e) { /* send the generic message */ }
    out.push(['🌙 Bedtime check', line]);
  }

  // 🍽️ carbs logged 15–30 minutes ago with no insulin around them
  if (cfg.bolusCheck && cfg.bolusCheck.on) {
    for (const c of trs) {
      if (!(Number(c.carbs) >= 10) || Number(c.insulin) > 0) continue;
      const age = (now - c.ms) / MIN;
      if (age < 15 || age >= 15 + WINDOW) continue;
      const bolus = trs.some((t) => Number(t.insulin) > 0 && !/basal/i.test(t.eventType || '') && t.ms >= c.ms - 20 * MIN && t.ms <= c.ms + 30 * MIN);
      if (!bolus) out.push(['🍽️ Bolus check', `You logged ${Math.round(c.carbs)} g carbs at ${clock(c.ms)} but no insulin. Did you bolus? (If yes, log it in CGM Hub.)`]);
    }
  }

  // ⚔️ quests nudge
  if (cfg.quests && cfg.quests.on && due(cfg.quests.time)) out.push(['⚔️ Quest time', 'Your pet wants to know how today’s quests are going! Open CGM Hub to check. 🐾']);

  // 🔔 custom reminders
  for (const r of cfg.custom || []) if (r.on && r.text && due(r.time)) out.push(['🔔 Reminder', r.text]);

  // ✅ test from the app
  if (cfg.testAt && now - cfg.testAt >= 0 && now - cfg.testAt < WINDOW * MIN + 2 * MIN) out.push(['✅ CGM Hub reminders work!', 'You’ll get your reminders here. You can change them in CGM Hub → Settings.']);

  for (const [title, message] of out) {
    const body = new URLSearchParams({ token: TOKEN, user: USER, title, message });
    if (cfg.appUrl) { body.set('url', cfg.appUrl); body.set('url_title', 'Open CGM Hub'); }
    const res = await fetch(PUSHOVER_URL, { method: 'POST', body });
    log(res.ok ? 'sent' : 'FAILED ' + res.status, title);
  }
  if (!out.length) log('Nothing due');
}

main().catch((e) => { console.error('Reminder run failed:', e.message); process.exitCode = 1; });
