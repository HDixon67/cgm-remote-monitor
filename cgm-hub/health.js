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

  // ---------- food from Cronometer (or any food app) via Health Connect ----------
  // Health Connect has one entry per food. Foods eaten together (same meal, within 45 min) become one CGM Hub meal,
  // saved as "Carb Correction" (carbs, no insulin) at the time of the first food. Same time + type each sync,
  // so Nightscout updates it instead of duplicating. Meals already logged in CGM Hub are skipped.
  const FOOD_KEY = 'cgmhub.foodImport.v1';
  const IMPORTER = 'Cronometer (Health Connect)';
  const MEAL_NAMES = { 1: 'Breakfast', 2: 'Lunch', 3: 'Dinner', 4: 'Snack' };
  const SOURCES = { 'com.cronometer.android': 'Cronometer', 'com.cronometer.android.gold': 'Cronometer' };
  const sourceName = (pkg) => SOURCES[pkg] || (/cronometer/i.test(pkg || '') ? 'Cronometer' : 'your food app');
  const toUnit = (key, grams) => { const N = window.CGMHubNutrition; const u = N && N.BY[key] ? N.BY[key].unit : 'g'; return key === 'kcal' ? grams : u === 'mg' ? grams * 1000 : u === 'µg' ? grams * 1e6 : grams; };
  const r2 = (v) => Math.round(v * 100) / 100;
  function groupFood (items) {
    const groups = [];
    for (const x of items.slice().sort((a, b) => a.start - b.start)) {
      const g = groups[groups.length - 1];
      if (g && dayKey(g.start) === dayKey(x.start) && (g.meal || 0) === (x.meal || 0) && x.start - g.start <= 45 * MIN) g.items.push(x);
      else groups.push({ start: x.start, meal: x.meal || 0, source: x.source, items: [x] });
    }
    return groups;
  }
  // one food with all its nutrients (in the app's units), for the Food tab's "top sources"
  function foodOf (x) {
    const n = {}; for (const k in (x.n || {})) n[k] = r2(toUnit(k, Number(x.n[k]) || 0));
    return { name: x.name || 'Food', carbs: r2(n.carbs || 0), kcal: Math.round(n.kcal || 0), n };
  }
  function mealOf (g) {
    const N = window.CGMHubNutrition;
    const n = {};
    for (const x of g.items) for (const k in (x.n || {})) n[k] = (n[k] || 0) + toUnit(k, Number(x.n[k]) || 0);
    const total = n.carbs || 0, fiber = n.fiber || 0;
    const net = !N || N.carbMode() === 'net';
    const carbs = Math.max(0, net ? total - fiber : total);
    const names = g.items.map((x) => x.name).filter(Boolean);
    const h = new Date(g.start).getHours();
    const t = {
      eventType: 'Carb Correction', created_at: new Date(g.start).toISOString(), enteredBy: IMPORTER,
      carbs: Math.round(carbs * 10) / 10, totalCarbs: r2(total), carbMode: net ? 'net' : 'total',
      mealGroup: MEAL_NAMES[g.meal] || (h >= 4 && h < 10.5 ? 'Breakfast' : h >= 11 && h < 15 ? 'Lunch' : h >= 17 && h < 21.5 ? 'Dinner' : 'Snack'),
      notes: (names.join(' + ') || sourceName(g.source) + ' meal').slice(0, 140),
      foods: g.items.map(foodOf),
      source: g.source || '', nutrients: {},
    };
    for (const k in n) t.nutrients[k] = r2(n[k]);
    if (n.kcal) t.calories = Math.round(n.kcal);
    if (n.protein) t.protein = r2(n.protein);
    if (n.fat) t.fat = r2(n.fat);
    if (fiber) t.fiber = r2(fiber);
    return t;
  }
  // food names → words, for spotting the same food logged in both apps
  const STOP = new Set('fresh with skin great value original crunchy raw cooked fat the and brand organic whole mini large small medium partly skimmed plain frost glacier freeze food meal snack lunch dinner breakfast treated low cup slice piece serving homemade style regular light reduced free'.split(' '));
  const words = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/s$/, '')));
  const overlap = (a, b) => { for (const w of a) if (b.has(w)) return true; return false; };
  // Cronometer without timestamps puts every food at midnight
  const timeless = (x) => { const d = new Date(x.start); return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0; };

  async function importFood (raw, from) {
    if (C.S.foodImport === false) return 0;
    const items = (raw.nutrition || []).filter((x) => x.start >= from && x.n && (x.n.carbs != null || x.n.kcal != null));
    if (!items.length) return 0; // nothing from Cronometer (or no permission): change nothing
    let docs = [];
    try { docs = await C.apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(from - HOUR).toISOString(), count: '1000' }); } catch (e) { return 0; }
    // what you logged yourself (CGM Hub or elsewhere) vs what this importer saved before
    const mine = C.normTreatments(docs.filter((d) => d.enteredBy !== IMPORTER)).filter((t) => t.carbs > 0 || (t.raw && t.raw.calories));
    const before = docs.filter((d) => d.enteredBy === IMPORTER);
    const logWords = (t) => { const w = words(t.notes); for (const f of (t.raw && t.raw.foods) || []) for (const x of words(f.name)) w.add(x); return w; };
    const N = window.CGMHubNutrition;
    const netG = (x) => { const c = (x.n || {}).carbs || 0, f = (x.n || {}).fiber || 0; return !N || N.carbMode() === 'net' ? Math.max(0, c - f) : c; };

    // skip foods you already logged: same name that day, or (with real times) anything within 45 min
    const keep = [];
    const byDay = {};
    const enrich = new Map(); // your log → the Cronometer foods that are the same meal (their nutrition gets added to it)
    const give = (log, x) => { if (!enrich.has(log)) enrich.set(log, []); enrich.get(log).push(x); };
    for (const x of items) {
      const k = dayKey(x.start);
      const day = mine.filter((t) => dayKey(t.t) === k);
      const w = words(x.name);
      const hit = day.find((t) => overlap(w, logWords(t)));
      if (hit) { (byDay[k] = byDay[k] || { matched: new Set(), rest: [] }).matched.add(hit); give(hit, x); continue; }
      const near = !timeless(x) && day.filter((t) => Math.abs(t.t - x.start) <= 45 * MIN).sort((a, b) => Math.abs(a.t - x.start) - Math.abs(b.t - x.start))[0];
      if (near) { give(near, x); continue; }
      (byDay[k] = byDay[k] || { matched: new Set(), rest: [] }).rest.push(x);
      keep.push(x);
    }
    // foods without times: a log you didn't name (e.g. "Food 32 g") matches the group of leftover foods whose carbs add up to it
    const drop = new Set();
    for (const k of Object.keys(byDay)) {
      const { matched, rest } = byDay[k];
      let loose = rest.filter(timeless);
      const unnamed = mine.filter((t) => dayKey(t.t) === k && !matched.has(t)).sort((a, b) => b.carbs - a.carbs);
      for (const log of unnamed) {
        if (!loose.length || loose.length > 14) break;
        const tol = Math.max(4, 0.15 * log.carbs);
        let best = null;
        for (let m = 1; m < (1 << loose.length); m++) {
          let sum = 0, n = 0; for (let i = 0; i < loose.length; i++) if (m & (1 << i)) { sum += netG(loose[i]); n++; }
          const d = Math.abs(sum - log.carbs);
          // within the tolerance, prefer the bigger group (small low-carb sides like cucumber belong to the meal too)
          if (d <= tol && (!best || n > best.n || (n === best.n && d < best.d))) best = { m, d, n };
        }
        if (!best) continue;
        loose = loose.filter((x, i) => { if (best.m & (1 << i)) { drop.add(x); give(log, x); return false; } return true; });
      }
    }
    const left = keep.filter((x) => !drop.has(x));
    // timed foods → meals; foods without times → one "time unknown" entry per day
    const meals = groupFood(left.filter((x) => !timeless(x))).map((g) => mealOf(g));
    const loose = {};
    for (const x of left.filter(timeless)) (loose[dayKey(x.start)] = loose[dayKey(x.start)] || []).push(x);
    for (const k of Object.keys(loose)) {
      const t = mealOf({ start: loose[k][0].start, meal: 0, source: loose[k][0].source, items: loose[k] });
      t.timeUnknown = true; t.mealGroup = 'Other';
      meals.push(t);
    }
    const out = meals.filter((t) => t.carbs >= 0.5 || t.calories >= 20);

    let seen = {}; try { seen = JSON.parse(localStorage.getItem(FOOD_KEY)) || {}; } catch (e) { /* ignore */ }
    let n = 0;
    const keepKeys = new Set();
    for (const t of out) {
      keepKeys.add(t.created_at);
      const sig = t.carbs + '|' + (t.calories || 0) + '|' + t.foods.length;
      const exists = before.some((d) => d.created_at === t.created_at);
      if (exists && seen[t.created_at] === sig) continue; // already saved, nothing changed
      await C.apiPostTreatment(t);
      seen[t.created_at] = sig; n++;
    }
    // earlier imports that turned out to be duplicates (or were removed in Cronometer): delete them
    for (const d of before) {
      if (keepKeys.has(d.created_at) || Date.parse(d.created_at) < from) continue;
      try { await C.apiDeleteTreatment(d._id); delete seen[d.created_at]; } catch (e) { /* no delete permission: leave it */ }
    }
    for (const [log, foods] of enrich) {
      const raw = log.raw || {};
      if (raw.nutrients && raw.nutritionFrom !== 'Cronometer') continue; // you added foods with full nutrition in CGM Hub: keep yours
      const m = mealOf({ start: log.t, meal: 0, source: foods[0].source, items: foods });
      const same = raw.nutritionFrom === 'Cronometer' && JSON.stringify(raw.nutrients) === JSON.stringify(m.nutrients);
      if (same) continue;
      const out = Object.assign({}, raw, { nutrients: m.nutrients, foods: m.foods, nutritionFrom: 'Cronometer' });
      for (const k of ['calories', 'protein', 'fat', 'fiber', 'totalCarbs']) if (m[k] != null) out[k] = m[k];
      try { await C.apiPutTreatment(out); n++; } catch (e) { /* no edit permission: leave it */ }
    }
    for (const k of Object.keys(seen)) if (Date.parse(k) < Date.now() - 20 * DAY) delete seen[k];
    try { localStorage.setItem(FOOD_KEY, JSON.stringify(seen)); } catch (e) { /* ignore */ }
    return n;
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
      let meals = 0;
      try { meals = await importFood(raw, from); } catch (e) { /* food import is a bonus; health data still synced */ }
      localStorage.setItem(SYNC_KEY, JSON.stringify({ lastDay: today0, at: Date.now(), meals: (st.meals || 0) + meals }));
      if (meals) C.refresh(false);
      if (manual) C.showMsg('hc-msg', `✅ Synced ${n} day${n === 1 ? '' : 's'} from Health Connect` + (meals ? ` and ${meals} meal${meals === 1 ? '' : 's'} from Cronometer.` : '.'), 'ok');
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
    box.appendChild(el('p', 'muted small', 'In Samsung Health: Settings → Health Connect → allow it to share steps, heart rate, sleep and exercise. In Cronometer: Settings → Health Connect → turn on sharing nutrition. Then connect CGM Hub here and allow everything (including Nutrition).'));
    const fl = el('label', 'check');
    const fc = el('input'); fc.type = 'checkbox'; fc.checked = C.S.foodImport !== false;
    fc.addEventListener('change', () => { C.S.foodImport = fc.checked; C.saveSettings(); });
    fl.append(fc, document.createTextNode(' 📥 Bring in meals from Cronometer (skips meals you already logged in CGM Hub)'));
    box.appendChild(fl);
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
    // right after you log something, sync again so a meal logged in both apps is cleaned up straight away
    C.hooks.logSaved.push(() => setTimeout(() => sync(false), 2500));
    setTimeout(() => sync(false), 3000);
    setInterval(() => { if (!document.hidden) sync(false); }, 30 * MIN);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false); });
  }

  window.CGMHubHealth = { native, load, cachedDay, cachedRange, refreshCache, sync, summarize, groupFood, mealOf, importFood, IMPORTER, words };
})();
