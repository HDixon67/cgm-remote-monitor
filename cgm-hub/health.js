/* CGM Hub: Health Connect (steps, heart rate, sleep, workouts) via the Android app.
 * In the Android app, data is read on the phone and saved to Nightscout as one "Health Summary"
 * treatment per day (same time + type each sync, so Nightscout updates it instead of duplicating).
 * In a normal browser this module only reads those summaries back for tiles, History, insights and quests. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const SYNC_KEY = 'cgmhub.healthSync.v1';
  const RELEASE_URL = 'https://github.com/HDixon67/cgm-remote-monitor/releases/tag/android-latest';

  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const HC = native && cap.Plugins ? cap.Plugins.HealthConnect : null;

  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const noon = (d0) => new Date(d0 + 12 * HOUR).toISOString();

  // ---------- build one day's summary from Health Connect data ----------
  function summarize (d0, raw) {
    const d1 = d0 + DAY;
    const hourly = new Array(24).fill(0);
    let steps = 0;
    for (const s of raw.steps || []) { if (s.t < d0 || s.t >= d1) continue; const h = new Date(s.t).getHours(); hourly[h] += s.steps; steps += s.steps; }
    const hr5 = new Array(288).fill(0), cnt = new Array(288).fill(0);
    let hs = 0, hn = 0, hmin = Infinity, hmax = 0;
    for (const [t, bpm] of raw.heartRate || []) {
      if (t < d0 || t >= d1) continue;
      const i = Math.floor((t - d0) / (5 * MIN));
      hr5[i] += bpm; cnt[i]++; hs += bpm; hn++; hmin = Math.min(hmin, bpm); hmax = Math.max(hmax, bpm);
    }
    for (let i = 0; i < 288; i++) hr5[i] = cnt[i] ? Math.round(hr5[i] / cnt[i]) : 0;
    const rhrList = (raw.restingHeartRate || []).filter((r) => r.t >= d0 && r.t < d1).map((r) => r.bpm);
    // sleep that ENDS on this day = "last night"
    const sleeps = (raw.sleep || []).filter((s) => s.end >= d0 && s.end < d1);
    const sleepMin = Math.round(sleeps.reduce((a, s) => a + (s.end - s.start), 0) / MIN);
    const ex = (raw.exercise || []).filter((e) => e.start >= d0 && e.start < d1)
      .map((e) => ({ start: e.start, end: e.end, min: Math.round((e.end - e.start) / MIN), type: e.type, title: e.title || '' }));
    return {
      eventType: 'Health Summary', created_at: noon(d0), enteredBy: 'CGM Hub (Health Connect)',
      notes: `${steps.toLocaleString()} steps` + (sleepMin ? ` · ${Math.floor(sleepMin / 60)}h ${sleepMin % 60}m sleep` : ''),
      steps, stepsHourly: hourly, activeKcal: Math.round(raw.activeKcal || 0),
      restingHR: rhrList.length ? Math.round(rhrList.reduce((a, b) => a + b, 0) / rhrList.length) : null,
      hrAvg: hn ? Math.round(hs / hn) : null, hrMin: hn ? hmin : null, hrMax: hn ? hmax : null, hr5: hn ? hr5 : null,
      sleepMin: sleepMin || null, sleepStart: sleeps.length ? Math.min(...sleeps.map((s) => s.start)) : null, sleepEnd: sleeps.length ? Math.max(...sleeps.map((s) => s.end)) : null,
      exercise: ex, exerciseMin: ex.reduce((a, e) => a + e.min, 0),
    };
  }

  // ---------- reading summaries back (any device) ----------
  let cache = new Map(); // dayKey -> summary
  let cacheAt = 0;
  function norm (t) {
    const ms = Date.parse(t.created_at);
    return Object.assign({}, t, { t: ms, day: dayKey(ms), d0: dayStart(ms) });
  }
  async function load (a, b, force) {
    if (C.S.demo) return demo(a, b);
    if (!C.S.url || !C.S.token) return [];
    const docs = await C.apiGet('/api/v1/treatments.json', { 'find[eventType]': 'Health Summary', 'find[created_at][$gte]': new Date(a).toISOString(), 'find[created_at][$lt]': new Date(b + DAY).toISOString(), count: '400' });
    const list = docs.map(norm);
    list.forEach((s) => cache.set(s.day, s));
    return list.filter((s) => s.t >= a - 12 * HOUR && s.t < b + 12 * HOUR).sort((x, y) => x.t - y.t);
  }
  async function refreshCache (force) {
    if (!force && Date.now() - cacheAt < 10 * MIN) return;
    cacheAt = Date.now();
    try { await load(dayStart(Date.now()) - 30 * DAY, Date.now()); C.hooks.render.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); } catch (e) { /* offline */ }
  }
  function cachedDay (k) { return cache.get(k) || null; }
  function cachedRange (a, b) { return [...cache.values()].filter((s) => s.d0 >= dayStart(a) && s.d0 < b).sort((x, y) => x.t - y.t); }

  // demo data so the features can be tried without a phone
  function demo (a, b) {
    const out = [];
    for (let d0 = dayStart(a); d0 < b; d0 += DAY) {
      const i = Math.round(d0 / DAY) % 7;
      const steps = [3200, 9800, 6400, 11200, 4100, 7600, 2500][i];
      const hourly = new Array(24).fill(0); [8, 12, 13, 17, 18].forEach((h, n) => { hourly[h] = Math.round(steps * [0.15, 0.25, 0.2, 0.25, 0.15][n]); });
      const s = { eventType: 'Health Summary', created_at: noon(d0), steps, stepsHourly: hourly, activeKcal: Math.round(steps / 25), restingHR: 62 + (i % 3), hrAvg: 74, hrMin: 54, hrMax: 128, hr5: null,
        sleepMin: [380, 450, 410, 500, 340, 470, 420][i], exercise: steps > 9000 ? [{ start: d0 + 17.5 * HOUR, end: d0 + 18.2 * HOUR, min: 42, type: 79, title: 'Walk' }] : [], exerciseMin: steps > 9000 ? 42 : 0 };
      s.notes = s.steps + ' steps';
      out.push(norm(s));
    }
    out.forEach((s) => cache.set(s.day, s));
    return Promise.resolve(out);
  }

  // ---------- syncing (Android app only) ----------
  let syncing = false;
  async function sync (manual) {
    if (!HC || syncing || C.S.demo || !C.S.url) return;
    syncing = true;
    try {
      const st = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
      const today0 = dayStart(Date.now());
      // re-read the last 2 days every time (late watch syncs), and up to 14 days on the first sync
      const from = st.lastDay ? Math.max(today0 - 14 * DAY, Math.min(st.lastDay, today0 - DAY)) : today0 - 14 * DAY;
      const raw = await HC.readRange({ start: from - 14 * HOUR, end: Date.now() });
      let n = 0;
      for (let d0 = from; d0 <= today0; d0 += DAY) {
        const s = summarize(d0, raw);
        if (!s.steps && !s.hr5 && !s.sleepMin && !s.exercise.length) continue;
        await C.apiPostTreatment(s);
        cache.set(dayKey(d0), norm(s));
        n++;
      }
      localStorage.setItem(SYNC_KEY, JSON.stringify({ lastDay: today0, at: Date.now() }));
      if (manual) C.showMsg('hc-msg', `✅ Synced ${n} day${n === 1 ? '' : 's'} from Health Connect.`, 'ok');
      renderSettings();
      C.hooks.render.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    } catch (e) {
      if (manual) C.showMsg('hc-msg', e.message || String(e), 'danger');
    } finally { syncing = false; }
  }

  // ---------- settings card ----------
  async function renderSettings () {
    const box = $('hc-box');
    if (!box) return;
    box.textContent = '';
    if (!native) {
      box.appendChild(el('p', null, 'To sync steps, heart rate, sleep and workouts from Samsung Health / your Galaxy Watch, install the CGM Hub Android app (free, no Play Store):'));
      const a = el('a', 'btn primary', '⬇️ Get the Android app'); a.href = RELEASE_URL; a.target = '_blank'; a.rel = 'noopener';
      box.appendChild(a);
      box.appendChild(el('p', 'muted small', 'Open the link on your phone, download cgm-hub.apk and open it. Allow your browser to install apps if Android asks.'));
      return;
    }
    let status = 'not_installed';
    try { status = (await HC.availability()).status; } catch (e) { /* plugin missing in an old app build */ }
    if (status !== 'available') {
      box.appendChild(el('p', null, status === 'update_required' ? 'Health Connect needs an update from the Play Store.' : 'Health Connect isn’t installed. On Android 14+ it’s built in (Settings → Security & privacy → Privacy → Health Connect); on older phones install “Health Connect” from the Play Store.'));
      return;
    }
    let granted = { all: false, granted: [] };
    try { granted = await HC.grantedPermissions(); } catch (e) { /* ignore */ }
    const st = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
    box.appendChild(el('p', null, granted.all ? '✅ Connected.' + (st.at ? ' Last sync ' + C.clockTime(st.at) + '.' : '') : (granted.granted && granted.granted.length ? 'Connected, but some data types are off.' : 'Not connected yet.')));
    box.appendChild(el('p', 'muted small', 'In Samsung Health: Settings → Health Connect → allow it to share steps, heart rate, sleep and exercise. Then connect CGM Hub here.'));
    const b1 = el('button', 'btn primary', granted.all ? 'Change permissions' : '❤️ Connect Health Connect'); b1.type = 'button';
    b1.addEventListener('click', async () => {
      try { const r = granted.all ? await HC.openSettings() : await HC.requestHealthPermissions(); if (r && r.granted && r.granted.length) await sync(true); } catch (e) { C.showMsg('hc-msg', e.message || String(e), 'danger'); }
      renderSettings();
    });
    box.appendChild(b1);
    if (granted.granted && granted.granted.length) {
      const b2 = el('button', 'btn', '🔄 Sync now'); b2.type = 'button';
      b2.addEventListener('click', () => sync(true));
      box.appendChild(b2);
    }
  }

  C.hooks.view.push((v) => { if (v === 'settings') renderSettings(); });
  C.hooks.render.push(() => refreshCache(false));
  if (native) {
    setTimeout(() => sync(false), 3000);
    setInterval(() => { if (!document.hidden) sync(false); }, 30 * MIN);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false); });
  }

  window.CGMHubHealth = { native, load, cachedDay, cachedRange, refreshCache, sync, summarize };
})();
