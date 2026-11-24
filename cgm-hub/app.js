/* CGM Hub — a personal Nightscout dashboard, bolus calculator and logbook.
 * Runs entirely in the browser. Data lives in Nightscout; settings + token live in this phone's localStorage.
 * Not a medical device: every number is an estimate and doses are suggestions only.
 */
(function () {
  'use strict';

  // ---------- constants ----------
  const MGDL_PER_MMOL = 18;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const STALE_MIN = 12; // reading older than this = stale
  const REFRESH_MS = 60 * 1000;
  const STORE_KEY = 'cgmhub.settings.v1';

  const DEFAULTS = {
    url: '', token: '', demo: false,
    units: 'mmol', round: 0.5,
    low: 3.9, high: 10.0, target: 6.0,
    ratio: null, isf: null, dia: 4, carbsHr: 30,
    confirmed: false,
  };

  // ---------- state ----------
  let S = loadSettings();
  let entries = [];      // [{t, mg, dir}] newest first, last 14 days
  let treatments = [];   // [{t, insulin, carbs, eventType, notes, enteredBy, kind}] last 36h, newest first
  let periods = [];      // period start/end events, last ~13 months, newest first
  const hooks = { render: [], view: [], logSaved: [], beforeLogSave: [] };
  const runHooks = (name, arg) => hooks[name].forEach((fn) => { try { fn(arg); } catch (e) { console.error(e); } });
  let rangeH = 6;
  let lastLongFetch = 0;
  let timer = null;
  let demoStore = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function loadSettings () {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings () {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* private mode: settings last this visit only */ }
  }
  const mmol = () => S.units === 'mmol';
  const unitLabel = () => (mmol() ? 'mmol/L' : 'mg/dL');
  // user-unit <-> mg/dL
  const toMg = (v) => (mmol() ? v * MGDL_PER_MMOL : v);
  const fromMg = (mg) => (mmol() ? mg / MGDL_PER_MMOL : mg);
  const fmtBG = (mg) => (mg == null || isNaN(mg) ? '--' : mmol() ? (mg / MGDL_PER_MMOL).toFixed(1) : String(Math.round(mg)));
  const fmtDelta = (mg) => {
    if (mg == null || isNaN(mg)) return '';
    const v = mmol() ? (mg / MGDL_PER_MMOL).toFixed(1) : String(Math.round(mg));
    return (mg >= 0 ? '+' : '') + v;
  };
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  const plusMinus = (x) => (x < 0 ? '− ' + r2(-x) : '+ ' + r2(x));
  const minusOf = (x) => (x < 0 ? '+ ' + r2(-x) : '− ' + r2(x));
  const clockTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function durText (ms) {
    const m = Math.max(0, Math.round(ms / MIN));
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function statusOf (mg) {
    if (mg < toMg(S.low)) return 'low';
    if (mg > toMg(S.high)) return 'high';
    return 'in';
  }
  const ARROWS = {
    DoubleUp: '⇈', SingleUp: '↑', FortyFiveUp: '↗', Flat: '→',
    FortyFiveDown: '↘', SingleDown: '↓', DoubleDown: '⇊',
  };
  function el (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv (tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- Nightscout API ----------
  function apiUrl (path, params) {
    const base = S.url.replace(/\/+$/, '');
    const qs = new URLSearchParams(params || {});
    if (S.token) qs.set('token', S.token.trim());
    return base + path + '?' + qs.toString();
  }
  async function apiGet (path, params) {
    const res = await fetch(apiUrl(path, params), { headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Nightscout said no (check your token has the "readable" role).');
    if (!res.ok) throw new Error('Nightscout error ' + res.status);
    return res.json();
  }
  async function apiPostTreatment (t) {
    if (S.demo) { demoStore.treatments.unshift(Object.assign({ _id: 'demo' + Date.now() }, t)); return; }
    const res = await fetch(apiUrl('/api/v1/treatments'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([t]),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Nightscout said no. Your token needs the "careportal" role.');
    if (!res.ok) throw new Error('Nightscout error ' + res.status);
  }
  // editing saved logs: Nightscout needs the token to have treatment update/delete permission
  const NO_EDIT = 'Nightscout won’t let CGM Hub change saved logs yet. Your token needs the “cgmhub-edit” role (a one-time fix).';
  async function apiPutTreatment (t) {
    if (S.demo) { const i = demoStore.treatments.findIndex((x) => x._id === t._id); if (i >= 0) demoStore.treatments[i] = t; return; }
    const res = await fetch(apiUrl('/api/v1/treatments'), { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(t) });
    if (res.status === 401 || res.status === 403) throw new Error(NO_EDIT);
    if (!res.ok) throw new Error('Nightscout error ' + res.status);
  }
  async function apiDeleteTreatment (id) {
    if (S.demo) { demoStore.treatments = demoStore.treatments.filter((x) => x._id !== id); return; }
    const res = await fetch(apiUrl('/api/v1/treatments/' + encodeURIComponent(id)), { method: 'DELETE', headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error(NO_EDIT);
    if (!res.ok) throw new Error('Nightscout error ' + res.status);
  }
  // make a log row tappable to edit it (edit.js provides the editor)
  function tappable (li, t) {
    if (!t || !t._id || !t.raw) return li;
    li.classList.add('tap');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', 'Edit ' + treatmentLabel(t) + ' at ' + clockTime(t.t));
    const open = () => { if (window.CGMHubEdit) window.CGMHubEdit.open(t); };
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return li;
  }

  function normEntries (arr) {
    return arr
      .filter((e) => typeof e.sgv === 'number' && e.sgv >= 20 && typeof e.date === 'number')
      .map((e) => ({ t: e.date, mg: e.sgv, dir: e.direction }))
      .sort((a, b) => b.t - a.t)
      .filter((e, i, a) => i === 0 || e.t !== a[i - 1].t);
  }
  function treatmentTime (t) {
    if (typeof t.mills === 'number') return t.mills;
    if (typeof t.date === 'number') return t.date;
    return Date.parse(t.created_at);
  }
  function normTreatments (arr) {
    return arr.map((t) => ({
      _id: t._id, raw: t,
      t: treatmentTime(t),
      insulin: Number(t.insulin) || 0,
      carbs: Number(t.carbs) || 0,
      eventType: t.eventType || '',
      notes: t.notes || t.foodType || '',
      enteredBy: t.enteredBy || '',
      kind: t.eventType === 'Medication' ? 'med' : t.eventType === 'Period Start' ? 'period-start' : t.eventType === 'Period End' ? 'period-end' : 'dose',
      medName: t.medName || '', medDose: t.medDose || '', medType: t.medType || '',
      fat: Number(t.fat) || 0, protein: Number(t.protein) || 0, fiber: Number(t.fiber) || 0, calories: Number(t.calories) || 0,
      water: Number(t.water) || 0, duration: Number(t.duration) || 0,
      mood: Number(t.mood) || 0, moodTags: Array.isArray(t.moodTags) ? t.moodTags : [],
      nutrients: t.nutrients && typeof t.nutrients === 'object' ? t.nutrients : null, totalCarbs: Number(t.totalCarbs) || 0,
    }))
      .filter((t) => !isNaN(t.t) && t.eventType !== 'CGMHub Settings' && t.eventType !== 'Health Summary' && t.eventType !== 'Daily Win') // settings + daily health data are read separately
      .sort((a, b) => b.t - a.t);
  }

  async function fetchAll (force) {
    if (S.demo) {
      if (!demoStore) demoStore = makeDemo();
      entries = normEntries(demoStore.entries);
      treatments = normTreatments(demoStore.treatments.filter((t) => Date.now() - treatmentTime(t) < 36 * HOUR));
      periods = normTreatments(demoStore.treatments.filter((t) => /^Period /.test(t.eventType)));
      return;
    }
    if (!S.url || !S.token) throw new Error('Not connected yet. Add your Nightscout URL and token in Settings.');
    const now = Date.now();
    const long = force || !entries.length || now - lastLongFetch > HOUR;
    const since = now - (long ? 14 * DAY : 26 * HOUR);
    const [ents, trs] = await Promise.all([
      apiGet('/api/v1/entries/sgv.json', { 'find[date][$gte]': String(since), count: long ? '30000' : '3000' }),
      apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(now - 36 * HOUR).toISOString(), count: '500' }),
    ]);
    const fresh = normEntries(ents);
    if (long) { entries = fresh; lastLongFetch = now; } else {
      // merge recent into the 14-day set
      const cutoff = since;
      entries = normEntries(fresh.concat(entries.filter((e) => e.t < cutoff)).map((e) => ({ sgv: e.mg, date: e.t, direction: e.dir })))
        .filter((e) => e.t >= now - 14 * DAY);
    }
    treatments = normTreatments(trs);
    if (long) {
      const since400 = new Date(now - 400 * DAY).toISOString();
      const [ps, pe] = await Promise.all(['Period Start', 'Period End'].map((ev) =>
        apiGet('/api/v1/treatments.json', { 'find[eventType]': ev, 'find[created_at][$gte]': since400, count: '200' }).catch(() => [])));
      periods = normTreatments(ps.concat(pe));
    }
  }

  // ---------- math: insulin + carbs on board (same curves Nightscout uses) ----------
  const isBasal = (t) => /basal|long/i.test(t.eventType) || /basal|lantus|basaglar|levemir|tresiba|toujeo/i.test(t.notes);

  function iobOne (insulin, minsAgo, dia) {
    // Nightscout's bilinear-ish curve from lib/plugins/iob.js, scaled to DIA
    const m = (3.0 / dia) * minsAgo;
    const peak = 75;
    if (minsAgo < 0) return 0;
    if (m < peak) { const x1 = m / 5 + 1; return insulin * (1 - 0.001852 * x1 * x1 + 0.001852 * x1); }
    if (m < 180) { const x2 = (m - peak) / 5; return insulin * (0.001323 * x2 * x2 - 0.054233 * x2 + 0.55556); }
    return 0;
  }
  function cobOne (carbs, minsAgo, carbsHr) {
    const delay = 20;
    if (minsAgo < 0) return carbs;
    const absorbed = Math.max(0, minsAgo - delay) * (carbsHr / 60);
    return Math.max(0, carbs - absorbed);
  }
  function onBoard (now) {
    now = now || Date.now();
    const dia = Number(S.dia) || 4;
    const carbsHr = Number(S.carbsHr) || 30;
    let iob = 0, iobCarb = 0, iobCorr = 0, cob = 0, insLeftMs = 0, carbLeftMs = 0;
    const items = [];
    for (const t of treatments) {
      const minsAgo = (now - t.t) / MIN;
      if (minsAgo < 0 || minsAgo > 24 * 60) continue;
      let i = 0, c = 0;
      if (t.insulin > 0 && !isBasal(t)) {
        i = iobOne(t.insulin, minsAgo, dia);
        if (i > 0.01) {
          iob += i;
          if (t.carbs > 0) iobCarb += i; else iobCorr += i;
          insLeftMs = Math.max(insLeftMs, dia * HOUR - (now - t.t));
        } else i = 0;
      }
      if (t.carbs > 0) {
        c = cobOne(t.carbs, minsAgo, carbsHr);
        if (c > 0.5) {
          cob += c;
          const total = (20 + t.carbs / (carbsHr / 60)) * MIN;
          carbLeftMs = Math.max(carbLeftMs, total - (now - t.t));
        } else c = 0;
      }
      if (i > 0 || c > 0) items.push({ t, iob: i, cob: c });
    }
    return { iob, iobCarb, iobCorr, cob, insLeftMs, carbLeftMs, items };
  }

  // ---------- math: AR2 forecast (Nightscout's 30-minute forecast) ----------
  // Forecast: insulin + carbs + trend when your numbers are set, otherwise Nightscout's AR2 trend.
  let forecastKind = 'trend';
  function forecast () {
    const smart = smartForecast();
    if (smart) { forecastKind = 'smart'; return smart; }
    forecastKind = 'trend';
    return ar2Forecast();
  }
  function smartForecast (now0) {
    const cur = entries[0];
    if (!cur || (now0 || Date.now()) - cur.t > STALE_MIN * MIN) return null;
    const R = valueNow('ratio'), I = valueNow('isf');
    if (!R || !I || !(R.v > 0) || !(I.v > 0)) return null;
    const isfMg = toMg(I.v);            // glucose drop per unit, in mg/dL
    const csf = isfMg / R.v;            // glucose rise per gram of carbs
    const dia = Number(S.dia) || 4, carbsHr = Number(S.carbsHr) || 30;
    const now = cur.t;
    const trs = treatments.filter((t) => now - t.t < 24 * HOUR);
    // insulin that has already acted, and carbs already absorbed, by time now+dt
    const usedIns = (dt) => trs.reduce((s2, t) => (t.insulin > 0 && !isBasal(t) && t.t <= now + dt ? s2 + t.insulin - iobOne(t.insulin, (now + dt - t.t) / MIN, dia) : s2), 0);
    const absorbed = (dt) => trs.reduce((s2, t) => (t.carbs > 0 && t.t <= now + dt ? s2 + t.carbs - cobOne(t.carbs, (now + dt - t.t) / MIN, carbsHr) : s2), 0);
    const effect = (a, b) => -isfMg * (usedIns(b) - usedIns(a)) + csf * (absorbed(b) - absorbed(a));
    // what glucose actually did over the last ~15 minutes (per 5 minutes)
    const past = entries.find((e) => cur.t - e.t >= 14 * MIN);
    let delta5 = past && cur.t - past.t <= 22 * MIN ? ((cur.mg - past.mg) * 5) / ((cur.t - past.t) / MIN) : deltaMg();
    if (delta5 == null) return null;
    // the part of the trend insulin/carbs don't explain fades out over 30 minutes
    const span = past ? cur.t - past.t : 5 * MIN;
    const dev = delta5 - (effect(-span, 0) * 5 * MIN) / span;
    const pts = [];
    let bg = cur.mg;
    for (let k = 1; k <= 12; k++) {
      const a = (k - 1) * 5 * MIN, b = k * 5 * MIN;
      bg += effect(a, b) + dev * Math.max(0, 1 - (k - 1) / 6);
      bg = Math.min(400, Math.max(39, bg));
      pts.push({ t: now + b, mg: bg });
    }
    return pts;
  }
  function ar2Forecast () {
    const cur = entries[0];
    if (!cur || Date.now() - cur.t > STALE_MIN * MIN) return [];
    // find a reading ~5 minutes earlier
    let prev = null;
    for (const e of entries) {
      const d = (cur.t - e.t) / MIN;
      if (d >= 4 && d <= 7) { prev = e; break; }
      if (d > 7) break;
    }
    if (!prev) return [];
    const AR = [-0.723, 1.716], REF = 140;
    let y0 = Math.log(prev.mg / REF), y1 = Math.log(cur.mg / REF);
    const pts = [];
    for (let i = 1; i <= 6; i++) {
      const y2 = AR[0] * y0 + AR[1] * y1;
      y0 = y1; y1 = y2;
      pts.push({ t: cur.t + i * 5 * MIN, mg: Math.min(400, Math.max(36, REF * Math.exp(y2))) });
    }
    return pts;
  }

  function deltaMg () {
    const cur = entries[0];
    if (!cur) return null;
    for (const e of entries) {
      const d = (cur.t - e.t) / MIN;
      if (d >= 4 && d <= 7) return (cur.mg - e.mg) * (5 / d); // per 5 minutes
      if (d > 7) break;
    }
    return null;
  }

  // ---------- math: insights ----------
  function stats (from, to) {
    const xs = entries.filter((e) => e.t >= from && e.t <= to).sort((a, b) => a.t - b.t);
    const n = xs.length;
    if (!n) return null;
    const lo = toMg(S.low), hi = toMg(S.high);
    let sum = 0, sum2 = 0, nLow = 0, nHigh = 0, min = Infinity, max = -Infinity;
    for (const e of xs) {
      sum += e.mg; sum2 += e.mg * e.mg;
      if (e.mg < lo) nLow++; else if (e.mg > hi) nHigh++;
      min = Math.min(min, e.mg); max = Math.max(max, e.mg);
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    // events = runs of readings outside range (a gap over 20 min ends a run)
    function runs (test) {
      let count = 0, dur = 0, start = null, last = null;
      for (const e of xs) {
        if (test(e.mg)) {
          if (start === null || e.t - last > 20 * MIN) { if (start !== null) dur += last - start; count++; start = e.t; }
          last = e.t;
        } else if (start !== null) { dur += last - start; start = null; }
      }
      if (start !== null) dur += last - start;
      return { count, dur };
    }
    return {
      n, mean, cv: (sd / mean) * 100, min, max,
      pLow: (nLow / n) * 100, pHigh: (nHigh / n) * 100, pIn: ((n - nLow - nHigh) / n) * 100,
      lows: runs((mg) => mg < lo), highs: runs((mg) => mg > hi),
      gmi: 3.31 + 0.02392 * mean,
      spanMs: xs[n - 1].t - xs[0].t,
    };
  }

  // ---------- math: bolus (same steps Diabetes:M shows) ----------
  function bolusCalc (bgUser, carbs, ob) {
    const now = new Date();
    const R = valueNow('ratio', now), I = valueNow('isf', now), T = valueNow('target', now);
    const ratio = R.v, isf = I.v, target = T.v;
    const steps = [];
    const fromTxt = (x) => (x.multi ? ` (your ${fmtClock(x.from)} setting)` : '');
    steps.push({ text: `Using right now: carb ratio ${ratio}${fromTxt(R)}, sensitivity ${isf}${fromTxt(I)}, target ${target}${fromTxt(T)}` });
    const IOB = ob.iob, IOBcarb = ob.iobCarb, IOBcorr = ob.iobCorr;
    steps.push({ text: `Insulin on board: ${r2(IOB)}u (${r2(IOBcarb)}u covering food + ${r2(IOBcorr)}u correction)` });
    const carbPart = carbs > 0 ? carbs / ratio : 0;
    steps.push({ text: `Food: ${carbs || 0}g ÷ ${ratio} = ${r2(carbPart)}u` });

    let corr = 0;
    if (bgUser == null || isNaN(bgUser)) {
      steps.push({ text: 'No glucose entered → correction = 0' });
    } else {
      const raw = (bgUser - target) / isf;
      steps.push({ text: `Correction: (${bgUser} − ${target}) ÷ ${isf} = ${r2(raw)}u` });
      if (bgUser > target) {
        if (raw <= IOBcarb) {
          corr = -IOBcorr;
          steps.push({ text: `Glucose is above target, but the food insulin still active (${r2(IOBcarb)}u) already covers it → correction = −${r2(IOBcorr)}u`, why: 'Diabetes:M rule 1' });
        } else {
          corr = raw - IOB;
          steps.push({ text: `Glucose is above target and more than the food insulin covers → correction = ${r2(raw)} ${minusOf(IOB)} = ${r2(corr)}u`, why: 'Diabetes:M rule 2' });
        }
      } else {
        corr = raw - IOBcorr;
        steps.push({ text: `Glucose is at or below target → correction = ${r2(raw)} ${minusOf(IOBcorr)} = ${r2(corr)}u`, why: 'Diabetes:M rule 3: lowers the food dose' });
      }
    }
    const total = carbPart + corr;
    const step = Number(S.round) || 0.5;
    const shown = total <= 0 ? 0 : Math.floor(total / step + 1e-9) * step;
    steps.push({ text: `Total: ${r2(carbPart)} ${plusMinus(corr)} = ${r2(total)}u → rounded down to ${shown}u (${step}u steps)` });
    return { total, shown, steps };
  }

  // ---------- rendering: home ----------
  function renderHero () {
    const cur = entries[0];
    document.querySelectorAll('.unit-label').forEach((e) => { e.textContent = unitLabel(); });
    const pill = $('bg-status');
    const banner = $('forecast-banner');
    banner.hidden = true;
    if (!cur) {
      $('bg-now').textContent = '--'; $('bg-arrow').textContent = '';
      $('bg-delta').textContent = ''; $('bg-age').textContent = 'No readings yet';
      pill.className = 'status-pill stale'; $('bg-status-text').textContent = 'No data';
      return;
    }
    const ageMs = Date.now() - cur.t;
    const stale = ageMs > STALE_MIN * MIN;
    $('bg-now').textContent = fmtBG(cur.mg);
    $('bg-arrow').textContent = ARROWS[cur.dir] || '';
    const d = deltaMg();
    $('bg-delta').textContent = d == null ? '' : fmtDelta(d);
    $('bg-age').textContent = (ageMs < MIN ? 'Just now' : durText(ageMs) + ' ago') + (S.demo ? ' · demo data' : '');
    const st = stale ? 'stale' : statusOf(cur.mg);
    pill.className = 'status-pill ' + st;
    $('bg-status-text').textContent = { low: 'Low', in: 'In range', high: 'High', stale: 'Old reading' }[st];

    if (stale) {
      banner.hidden = false; banner.className = 'alert-banner high';
      banner.textContent = '⏱️ No new reading for ' + durText(ageMs) + '. Check your sensor and the Libre bridge.';
      return;
    }
    const fc = forecast();
    const lo = toMg(S.low), hi = toMg(S.high);
    if (cur.mg >= lo) {
      const hit = fc.find((p) => p.mg < lo);
      if (hit) {
        banner.hidden = false; banner.className = 'alert-banner';
        banner.textContent = '↘ Could go low in ~' + Math.max(1, Math.round((hit.t - Date.now()) / MIN)) + ' min' + (forecastKind === 'smart' ? ' (forecast with insulin & carbs)' : ' (trend forecast)');
        return;
      }
    }
    if (cur.mg <= hi) {
      const hit = fc.find((p) => p.mg > hi);
      if (hit) {
        banner.hidden = false; banner.className = 'alert-banner high';
        banner.textContent = '↗ Could go high in ~' + Math.max(1, Math.round((hit.t - Date.now()) / MIN)) + ' min' + (forecastKind === 'smart' ? ' (forecast with insulin & carbs)' : ' (trend forecast)');
      }
    }
  }

  function treatmentLabel (t) {
    if (t.kind === 'med') return [t.medName || t.notes || 'Medication', t.medName ? t.medDose : ''].filter(Boolean).join(' ');
    if (t.kind === 'period-start') return 'Period started';
    if (t.kind === 'period-end') return 'Period ended';
    if (t.notes) return t.notes;
    if (t.insulin && t.carbs) return 'Meal bolus';
    if (t.insulin) return 'Insulin';
    if (t.carbs) return 'Carbs';
    return t.eventType || 'Entry';
  }
  function iconFor (t) {
    if (t.eventType === 'Mood') {
      const ic = el('span', 'ic other', ['😐', '😫', '🙁', '😐', '🙂', '😄'][t.mood || 0]);
      ic.setAttribute('aria-hidden', 'true');
      return ic;
    }
    if (t.eventType === 'Water' || t.eventType === 'Exercise') {
      const ic = el('span', 'ic other', t.eventType === 'Water' ? '💧' : '🏃');
      ic.setAttribute('aria-hidden', 'true');
      return ic;
    }
    if (t.kind !== 'dose') {
      const ic = el('span', 'ic other', t.kind === 'med' ? (t.medType === 'supplement' ? '🌿' : '💊') : '🩸');
      ic.setAttribute('aria-hidden', 'true');
      return ic;
    }
    const ic = el('span', 'ic ' + (t.insulin && t.carbs ? 'both' : t.insulin ? 'ins' : 'carb'), t.insulin && !t.carbs ? 'u' : t.carbs && !t.insulin ? 'g' : '');
    ic.setAttribute('aria-hidden', 'true');
    return ic;
  }

  function renderOnBoard () {
    const ob = onBoard();
    $('iob').textContent = ob.iob.toFixed(1);
    $('cob').textContent = String(Math.round(ob.cob));
    const insGiven = ob.items.reduce((s, x) => s + (x.iob > 0 ? x.t.insulin : 0), 0);
    const carbGiven = ob.items.reduce((s, x) => s + (x.cob > 0 ? x.t.carbs : 0), 0);
    $('iob-bar').style.width = (insGiven ? Math.min(100, (ob.iob / insGiven) * 100) : 0) + '%';
    $('cob-bar').style.width = (carbGiven ? Math.min(100, (ob.cob / carbGiven) * 100) : 0) + '%';
    $('iob-left').textContent = ob.iob > 0.05 ? durText(ob.insLeftMs) + ' left' : 'None active';
    $('cob-left').textContent = ob.cob > 0.5 ? durText(ob.carbLeftMs) + ' left' : 'None active';

    const ul = $('ob-list');
    ul.textContent = '';
    if (!ob.items.length) { ul.appendChild(el('li', 'empty', 'Nothing active right now.')); return; }
    for (const it of ob.items) {
      const li = el('li');
      li.appendChild(iconFor(it.t));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', treatmentLabel(it.t)));
      mid.appendChild(el('div', 'muted small', clockTime(it.t.t)));
      li.appendChild(mid);
      const right = el('div', 'right');
      if (it.t.insulin && it.iob > 0) right.appendChild(el('div', null, `${it.iob.toFixed(1)}u of ${r1(it.t.insulin)}u`));
      if (it.t.carbs && it.cob > 0) right.appendChild(el('div', null, `${Math.round(it.cob)}g of ${Math.round(it.t.carbs)}g`));
      li.appendChild(right);
      ul.appendChild(tappable(li, it.t));
    }
  }

  function renderTiles () {
    if (window.CGMHubTiles) return; // tiles.js draws the customizable tiles
    const now = Date.now();
    const s = stats(now - DAY, now);
    const tiles = $('tiles');
    tiles.textContent = '';
    function tile (label, value, unit, sub, icon) {
      const t = el('div', 'tile');
      const l = el('div', 't-label');
      if (icon) l.appendChild(el('span', 't-ic', icon));
      l.appendChild(document.createTextNode(label));
      t.appendChild(l);
      const v = el('div', 't-value', value);
      if (unit) v.appendChild(el('small', null, unit));
      t.appendChild(v);
      t.appendChild(el('div', 't-sub', sub || ''));
      tiles.appendChild(t);
    }
    if (!s) { tiles.appendChild(el('p', 'muted', 'Not enough data yet.')); }
    else {
      tile('Time in range', Math.round(s.pIn) + '', '%', 'goal: 70% or more', s.pIn >= 70 ? '✅ ' : '');
      tile('Average', fmtBG(s.mean), '', unitLabel());
      tile('Variability', Math.round(s.cv) + '', '%', 'goal: under 36%');
      tile('Lows', String(s.lows.count), s.lows.count === 1 ? ' event' : ' events',
        s.lows.count ? durText(s.lows.dur) + ' · min ' + fmtBG(s.min) : 'none 🎉', '🔻 ');
      tile('Highs', String(s.highs.count), s.highs.count === 1 ? ' event' : ' events',
        s.highs.count ? durText(s.highs.dur) + ' · max ' + fmtBG(s.max) : 'none 🎉', '🔺 ');
      const s14 = stats(now - 14 * DAY, now);
      tile('Est. A1c', s14 ? s14.gmi.toFixed(1) : '--', '%', s14 ? 'from ' + Math.max(1, Math.round(s14.spanMs / DAY)) + ' days (GMI)' : '');
    }
    const s14 = stats(now - 14 * DAY, now);
    const split = $('split'), labels = $('split-labels');
    split.textContent = ''; labels.textContent = '';
    if (s14) {
      [['s-low', s14.pLow], ['s-in', s14.pIn], ['s-high', s14.pHigh]].forEach(([c, p]) => {
        if (p > 0) { const sp = el('span', c); sp.style.width = p + '%'; split.appendChild(sp); }
      });
      labels.appendChild(el('span', null, '🔻 Low ' + Math.round(s14.pLow) + '%'));
      labels.appendChild(el('span', null, '✅ In range ' + Math.round(s14.pIn) + '%'));
      labels.appendChild(el('span', null, '🔺 High ' + Math.round(s14.pHigh) + '%'));
      $('split-n').textContent = '· ' + Math.max(1, Math.round(s14.spanMs / DAY)) + ' days of data';
      split.setAttribute('aria-label', `Low ${Math.round(s14.pLow)}%, in range ${Math.round(s14.pIn)}%, high ${Math.round(s14.pHigh)}%`);
    }
  }

  // ---------- rendering: chart ----------
  let chartGeom = null;
  function renderChart () {
    const svg = $('chart');
    const W = svg.clientWidth || 340, H = 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.textContent = '';
    const padL = 6, padR = 34, padT = 22, padB = 22;
    const now = Date.now();
    const fcPts = forecast();
    const t0 = now - rangeH * HOUR, t1 = now + (forecastKind === 'smart' ? 60 : 30) * MIN;
    const pts = entries.filter((e) => e.t >= t0).slice().reverse();
    const fc = fcPts;
    const maxMg = Math.max(toMg(mmol() ? 15 : 270), ...pts.map((p) => p.mg), ...fc.map((p) => p.mg)) + 10;
    const minMg = mmol() ? 2 * MGDL_PER_MMOL : 40;
    const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
    const y = (mg) => padT + (1 - (Math.min(maxMg, Math.max(minMg, mg)) - minMg) / (maxMg - minMg)) * (H - padT - padB);

    // target band + gridlines
    const lo = toMg(S.low), hi = toMg(S.high);
    svg.appendChild(sv('rect', { class: 'band', x: padL, y: y(hi), width: W - padL - padR, height: y(lo) - y(hi) }));
    const ticks = mmol() ? [3, 6, 9, 12, 15, 18, 21] : [54, 108, 162, 216, 270, 324, 378];
    for (const tv of ticks) {
      const mg = mmol() ? tv * MGDL_PER_MMOL : tv;
      if (mg < minMg || mg > maxMg) continue;
      svg.appendChild(sv('line', { class: 'grid', x1: padL, x2: W - padR, y1: y(mg), y2: y(mg) }));
      svg.appendChild(sv('text', { class: 'axis-text', x: W - padR + 4, y: y(mg) + 4 }, String(tv)));
    }
    svg.appendChild(sv('line', { class: 'lim-low', x1: padL, x2: W - padR, y1: y(lo), y2: y(lo) }));
    svg.appendChild(sv('line', { class: 'lim-high', x1: padL, x2: W - padR, y1: y(hi), y2: y(hi) }));

    // hour labels
    const stepH = rangeH <= 3 ? 1 : rangeH <= 6 ? 1 : rangeH <= 12 ? 3 : 6;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + HOUR; t < now; t += HOUR) {
      const h = new Date(t).getHours();
      if (h % stepH || x(t) < padL + 16 || x(t) > W - padR - 16) continue;
      svg.appendChild(sv('text', { class: 'axis-text', x: x(t), y: H - 6, 'text-anchor': 'middle' },
        new Date(t).toLocaleTimeString([], { hour: 'numeric' })));
    }
    svg.appendChild(sv('line', { class: 'now', x1: x(now), x2: x(now), y1: padT - 6, y2: H - padB }));

    // readings
    const r = rangeH <= 6 ? 2.6 : rangeH <= 12 ? 2 : 1.6;
    const g = sv('g', {});
    for (const p of pts) g.appendChild(sv('circle', { class: 'pt-' + statusOf(p.mg), cx: x(p.t), cy: y(p.mg), r }));
    for (const p of fc) g.appendChild(sv('circle', { class: 'pt-fc', cx: x(p.t), cy: y(p.mg), r: 2.6 }));
    svg.appendChild(g);

    // treatments along the top edge
    for (const t of treatments) {
      if (t.t < t0 || t.t > now) continue;
      if (t.insulin > 0 && !isBasal(t)) {
        svg.appendChild(sv('circle', { class: 'tr-ins', cx: x(t.t), cy: 10, r: 9 }));
        svg.appendChild(sv('text', { class: 'tr-text', x: x(t.t), y: 10 }, String(r1(t.insulin))));
      }
      if (t.carbs > 0) {
        const cy = t.insulin > 0 && !isBasal(t) ? 30 : 10;
        svg.appendChild(sv('circle', { class: 'tr-carb', cx: x(t.t), cy, r: 9 }));
        svg.appendChild(sv('text', { class: 'tr-text', x: x(t.t), y: cy }, String(Math.round(t.carbs))));
      }
    }
    for (const t of treatments) {
      if (t.kind !== 'med' || t.t < t0 || t.t > now) continue;
      svg.appendChild(sv('circle', { class: 'tr-med', cx: x(t.t), cy: H - padB - 9, r: 8 }));
      const tx = sv('text', { class: 'tr-text', x: x(t.t), y: H - padB - 9 }, '💊');
      tx.setAttribute('font-size', '9');
      svg.appendChild(tx);
    }
    chartGeom = { x, y, pts, fc, W, H, padT, padB };
    svg.setAttribute('aria-label', `Glucose chart, last ${rangeH} hours, ${pts.length} readings`);
  }

  function chartHover (ev) {
    if (!chartGeom || !chartGeom.pts.length) return;
    const svg = $('chart');
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * chartGeom.W;
    const all = chartGeom.pts.concat(chartGeom.fc.map((p) => Object.assign({ fc: true }, p)));
    let best = null, bd = Infinity;
    for (const p of all) { const d = Math.abs(chartGeom.x(p.t) - px); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    svg.querySelectorAll('.cross, .cross-dot').forEach((n) => n.remove());
    const cx = chartGeom.x(best.t), cy = chartGeom.y(best.mg);
    svg.appendChild(sv('line', { class: 'cross', x1: cx, x2: cx, y1: chartGeom.padT, y2: chartGeom.H - chartGeom.padB }));
    svg.appendChild(sv('circle', { class: 'cross-dot', cx, cy, r: 5 }));
    const tip = $('chart-tip');
    tip.textContent = '';
    tip.appendChild(el('b', null, fmtBG(best.mg) + ' '));
    tip.appendChild(document.createTextNode(unitLabel()));
    tip.appendChild(el('div', 'muted', clockTime(best.t) + (best.fc ? (forecastKind === 'smart' ? ' · forecast (insulin, carbs, trend)' : ' · trend forecast') : '')));
    tip.hidden = false;
    const left = (cx / chartGeom.W) * rect.width;
    tip.style.left = Math.max(0, Math.min(rect.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
  }
  function chartLeave () {
    $('chart-tip').hidden = true;
    $('chart').querySelectorAll('.cross, .cross-dot').forEach((n) => n.remove());
  }

  // ---------- rendering: calculator ----------
  function calcReady () {
    const missing = [];
    const ok = (k) => { const l = getSched(k); return l.length && l.every((x) => Number(x.v) > 0); };
    if (!ok('ratio')) missing.push('carb ratio');
    if (!ok('isf')) missing.push('sensitivity');
    if (!ok('target')) missing.push('target');
    if (!S.confirmed) missing.push('the “I’ve checked these numbers” box');
    return missing;
  }
  let calcBgTouched = false;
  // the calculator for other screens (Food / Rapid sheets): bgUser null = use a fresh CGM reading
  function calcFor (carbs, bgUser) {
    const missing = calcReady();
    const cur = entries[0];
    const fresh = cur && Date.now() - cur.t <= 10 * MIN;
    let bg = bgUser, bgSrc = 'typed';
    if (bg == null || bg === '' || isNaN(bg)) { bg = fresh ? Number(fmtBG(cur.mg)) : null; bgSrc = fresh ? 'cgm' : 'none'; }
    if (missing.length) return { ready: false, missing, bg, bgSrc };
    const res = bolusCalc(bg, Number(carbs) || 0, onBoard());
    const isLow = bg != null && toMg(bg) < toMg(S.low);
    return { ready: true, bg, bgSrc, bgAge: fresh ? Date.now() - cur.t : null, isLow, shown: isLow ? 0 : res.shown, total: res.total, steps: res.steps };
  }
  function renderCalc () {
    const missing = calcReady();
    const blocked = $('calc-blocked');
    const cur = entries[0];
    const fresh = cur && Date.now() - cur.t <= 10 * MIN;
    if (!calcBgTouched) {
      $('calc-bg').value = fresh ? fmtBG(cur.mg) : '';
      $('calc-bg-src').textContent = fresh ? 'From your CGM, ' + (Date.now() - cur.t < MIN ? 'just now' : durText(Date.now() - cur.t) + ' ago') + '. You can change it.'
        : 'No fresh CGM reading. Type your glucose in.';
    }
    if (missing.length) {
      blocked.hidden = false;
      blocked.textContent = 'To use the calculator, go to Settings and add: ' + missing.join(', ') + '.';
      $('calc-dose').textContent = '–'; $('calc-raw').textContent = ''; $('calc-steps').textContent = '';
      $('calc-log').disabled = true; $('calc-low').hidden = true;
      return;
    }
    blocked.hidden = true;
    const bgStr = $('calc-bg').value.trim();
    const bg = bgStr === '' ? null : Number(bgStr);
    const carbs = Number($('calc-carbs').value) || 0;
    const res = bolusCalc(bg, carbs, onBoard());
    const isLow = bg != null && toMg(bg) < toMg(S.low);
    $('calc-low').hidden = !isLow;
    $('calc-dose').textContent = isLow ? '0' : String(res.shown);
    $('calc-raw').textContent = isLow ? 'Treat the low first.' : res.total < 0 ? 'The math came out below zero, so the suggestion is 0u.' : 'Exact: ' + r2(res.total) + 'u';
    const ol = $('calc-steps');
    ol.textContent = '';
    for (const s of res.steps) {
      const li = el('li', null, s.text);
      if (s.why) li.appendChild(el('span', 'why', s.why));
      ol.appendChild(li);
    }
    $('calc-log').disabled = false;
    $('calc-log').dataset.insulin = isLow ? 0 : res.shown;
    $('calc-log').dataset.carbs = carbs;
  }

  // ---------- rendering: log ----------
  function toLocalInput (d) {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * MIN).toISOString().slice(0, 16);
  }
  function renderLogList () {
    const ul = $('log-list');
    ul.textContent = '';
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = treatments.filter((t) => t.t >= start.getTime() && (t.insulin || t.carbs || t.notes || t.kind !== 'dose'));
    if (!today.length) { ul.appendChild(el('li', 'empty', 'Nothing logged today yet.')); return; }
    for (const t of today) {
      const li = el('li');
      li.appendChild(iconFor(t));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', treatmentLabel(t)));
      mid.appendChild(el('div', 'muted small', clockTime(t.t) + (t.enteredBy ? ' · ' + t.enteredBy : '')));
      li.appendChild(mid);
      const right = el('div', 'right');
      if (t.insulin) right.appendChild(el('div', null, r1(t.insulin) + 'u' + (isBasal(t) ? ' basal' : '')));
      if (t.carbs) right.appendChild(el('div', null, Math.round(t.carbs) + 'g'));
      li.appendChild(right);
      ul.appendChild(tappable(li, t));
    }
  }
  function showMsg (id, text, kind) {
    const m = $(id);
    m.hidden = false; m.className = 'notice ' + (kind || ''); m.textContent = text;
  }

  // ---------- settings ----------
  // Schedules: [{t: 'HH:MM', v: number}] sorted by time, like the Nightscout profile.
  const KINDS = ['ratio', 'isf', 'target'];
  const fmtClock = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  let formUnits = S.units;
  let confirmTouched = false;

  function fillSettingsForm () {
    $('set-url').value = S.url; $('set-token').value = S.token; $('set-demo').checked = !!S.demo;
    $('set-units').value = S.units; formUnits = S.units; $('set-round').value = String(S.round);
    $('set-low').value = S.low; $('set-high').value = S.high;
    $('set-dia').value = S.dia; $('set-carbshr').value = S.carbsHr;
    $('set-confirmed').checked = !!S.confirmed; confirmTouched = false;
    KINDS.forEach((k) => renderSched(k, getSched(k)));
    document.querySelectorAll('.unit-label').forEach((e) => { e.textContent = unitLabel(); });
  }

  function renderSched (kind, list) {
    const box = $('sched-' + kind).querySelector('.sched-rows');
    box.textContent = '';
    const rows = list.length ? list : [{ t: '00:00', v: null }];
    const nowIdx = schedIndexAt(rows, new Date());
    rows.forEach((row, i) => {
      const r = el('div', 'sched-row' + (i === nowIdx ? ' now' : ''));
      r.appendChild(el('span', 'from', 'From'));
      const ti = el('input'); ti.type = 'time'; ti.value = row.t; ti.setAttribute('aria-label', 'Start time');
      if (i === 0) { ti.value = '00:00'; ti.disabled = true; } // the first period always starts at midnight
      const vi = el('input'); vi.type = 'number'; vi.step = kind === 'ratio' ? '0.5' : '0.1'; vi.inputMode = 'decimal';
      vi.value = row.v ?? ''; vi.setAttribute('aria-label', 'Value');
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove this time');
      del.disabled = i === 0;
      del.addEventListener('click', () => { r.remove(); });
      r.append(ti, vi, del);
      box.appendChild(r);
    });
  }
  function readSched (kind) {
    const rows = [...$('sched-' + kind).querySelectorAll('.sched-row')];
    const out = [];
    for (const r of rows) {
      const [ti, vi] = r.querySelectorAll('input');
      const v = numOrNull(vi.value);
      if (v == null || !ti.value) continue;
      out.push({ t: ti.value, v });
    }
    out.sort((a, b) => a.t.localeCompare(b.t));
    return out.filter((x, i, a) => i === 0 || x.t !== a[i - 1].t);
  }
  function addSchedRow (kind) {
    const cur = readSched(kind);
    const last = cur[cur.length - 1];
    let nextT = '12:00';
    if (last) { const h = Math.min(23, Number(last.t.slice(0, 2)) + 3); nextT = String(h).padStart(2, '0') + ':00'; }
    cur.push({ t: nextT, v: null });
    renderSched(kind, cur);
    const inputs = $('sched-' + kind).querySelectorAll('.sched-row:last-child input');
    if (inputs[1]) inputs[1].focus();
  }
  function getSched (kind) {
    if (S.sched && Array.isArray(S.sched[kind]) && S.sched[kind].length) return S.sched[kind];
    return S[kind] != null ? [{ t: '00:00', v: Number(S[kind]) }] : []; // older single-value settings
  }
  function schedIndexAt (list, date) {
    const hhmm = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    let idx = 0;
    list.forEach((x, i) => { if (x.t <= hhmm) idx = i; });
    return idx;
  }
  function valueNow (kind, date) {
    const list = getSched(kind);
    if (!list.length) return null;
    const i = schedIndexAt(list, date || new Date());
    return { v: Number(list[i].v), from: list[i].t, multi: list.length > 1 };
  }

  function numOrNull (v) { const n = Number(v); return v === '' || v == null || isNaN(n) ? null : n; }
  function readSettingsForm () {
    const sched = { ratio: readSched('ratio'), isf: readSched('isf'), target: readSched('target') };
    const prevNumbers = JSON.stringify([KINDS.map(getSched), S.units]);
    const next = Object.assign({}, S, {
      url: $('set-url').value.trim(),
      token: $('set-token').value.trim(),
      demo: $('set-demo').checked,
      units: $('set-units').value,
      round: Number($('set-round').value) || 0.5,
      low: numOrNull($('set-low').value) ?? S.low,
      high: numOrNull($('set-high').value) ?? S.high,
      sched, ratio: null, isf: null, target: null,
      dia: numOrNull($('set-dia').value) || 4,
      carbsHr: numOrNull($('set-carbshr').value) || 30,
      confirmed: $('set-confirmed').checked,
    });
    // changed dose numbers need the box ticked again
    if (JSON.stringify([KINDS.map((k) => sched[k]), next.units]) !== prevNumbers && !confirmTouched) next.confirmed = false;
    return next;
  }
  // when units switch, convert glucose-based numbers so they mean the same thing
  function onUnitsChange () {
    const to = $('set-units').value;
    if (to === formUnits) return;
    const f = to === 'mmol' ? 1 / MGDL_PER_MMOL : MGDL_PER_MMOL;
    const dp = to === 'mmol' ? 1 : 0;
    const conv = (input) => { const v = numOrNull(input.value); if (v != null) input.value = (v * f).toFixed(dp); };
    ['set-low', 'set-high'].forEach((id) => conv($(id)));
    ['isf', 'target'].forEach((k) => $('sched-' + k).querySelectorAll('.sched-row input[type=number]').forEach(conv));
    formUnits = to;
    document.querySelectorAll('.unit-label').forEach((e) => { e.textContent = to === 'mmol' ? 'mmol/L' : 'mg/dL'; });
  }

  async function fillFromProfile () {
    try {
      let store;
      if (S.demo || $('set-demo').checked) {
        store = {
          units: 'mmol', dia: 4, carbs_hr: 20,
          carbratio: [{ time: '00:00', value: 10 }, { time: '07:00', value: 9 }, { time: '14:00', value: 8 }, { time: '20:00', value: 10 }],
          sens: [{ time: '00:00', value: 2.2 }, { time: '20:00', value: 3.5 }],
          target_low: [{ time: '00:00', value: 6 }], target_high: [{ time: '00:00', value: 6 }],
        };
      } else {
        if (!$('set-url').value || !$('set-token').value) throw new Error('Add your URL and token first.');
        S.url = $('set-url').value.trim(); S.token = $('set-token').value.trim();
        const profs = await apiGet('/api/v1/profile.json', {});
        const p = profs && profs[0];
        store = p && p.store && p.store[p.defaultProfile];
        if (!store) throw new Error('Your Nightscout profile is empty. Fill it in under ☰ → Profile Editor, or type the numbers here.');
      }
      const toHHMM = (x) => {
        if (typeof x.time === 'string' && /^\d{1,2}:\d{2}/.test(x.time)) return x.time.slice(0, 5).padStart(5, '0');
        const s = Number(x.timeAsSeconds) || 0;
        return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      };
      const list = (arr) => (Array.isArray(arr) ? arr.map((x) => ({ t: toHHMM(x), v: Number(x.value) })).filter((x) => !isNaN(x.v)).sort((a, b) => a.t.localeCompare(b.t)) : []);
      const valAt = (lst, t) => { let v = lst.length ? lst[0].v : null; for (const x of lst) if (x.t <= t) v = x.v; return v; };
      const sens = list(store.sens);
      const profMmol = /mmol/i.test(store.units || '') || (sens.length && sens[0].v < 20);
      const formMmol = $('set-units').value === 'mmol';
      const conv = (v) => (profMmol === formMmol ? v : profMmol ? v * MGDL_PER_MMOL : v / MGDL_PER_MMOL);
      const dp = formMmol ? 1 : 0;
      const fix = (v) => Number(conv(v).toFixed(dp));
      const tl = list(store.target_low), th = list(store.target_high);
      const tTimes = [...new Set(tl.map((x) => x.t).concat(th.map((x) => x.t)))].sort();
      const target = tTimes.map((t) => {
        const lo = valAt(tl, t), hi = valAt(th, t);
        return { t, v: fix(hi != null && lo != null ? (lo + hi) / 2 : (lo ?? hi)) };
      });
      const ratio = list(store.carbratio);
      if (ratio.length) { ratio[0].t = '00:00'; renderSched('ratio', ratio); }
      if (sens.length) { const l = sens.map((x) => ({ t: x.t, v: fix(x.v) })); l[0].t = '00:00'; renderSched('isf', l); }
      if (target.length) { target[0].t = '00:00'; renderSched('target', target); }
      if (store.dia) $('set-dia').value = store.dia;
      if (store.carbs_hr) $('set-carbshr').value = store.carbs_hr;
      $('set-confirmed').checked = false; confirmTouched = false;
      showMsg('set-msg', 'Filled in all your times from your Nightscout profile. Check them, tick the box, then Save.', 'ok');
    } catch (e) {
      showMsg('set-msg', e.message, 'warn');
    }
  }

  // ---------- navigation ----------
  function go (view) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.goto === view));
    if (view === 'calc') { calcBgTouched = false; renderCalc(); }
    if (view === 'log') { if (!$('log-time').value) $('log-time').value = toLocalInput(new Date()); renderLogList(); }
    if (view === 'settings') fillSettingsForm();
    if (view === 'home') renderChart();
    runHooks('view', view);
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
  }

  // ---------- refresh loop ----------
  function renderAll () {
    renderHero(); renderOnBoard(); renderTiles(); renderChart();
    if (!$('view-calc').hidden) renderCalc();
    if (!$('view-log').hidden) renderLogList();
    runHooks('render');
  }
  async function refresh (force) {
    try {
      await fetchAll(force);
      $('last-sync').textContent = (S.demo ? 'Demo mode · ' : '') + 'Updated ' + clockTime(Date.now());
    } catch (e) {
      $('last-sync').textContent = '⚠️ ' + e.message;
      if (!S.url && !S.demo) { $('bg-status-text').textContent = 'Not connected'; }
    }
    renderAll();
  }
  function startLoop () {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
  }

  // ---------- demo data ----------
  function makeDemo () {
    const now = Date.now();
    const ents = [];
    let mg = 120;
    for (let t = now - 14 * DAY; t <= now; t += 5 * MIN) {
      const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const day = Math.floor((t - (now - 14 * DAY)) / DAY);
      const meal = [[8, 120], [12.5, 60], [18.5, 75]].reduce((s, [m, a]) => s + a * Math.exp(-Math.pow((h - m - 0.9) / 0.8, 2)), 0);
      const dawn = 45 / (1 + Math.exp(-(h - 5.5) * 1.5)) * (h < 9 ? 1 : Math.max(0, 1 - (h - 9) / 2));
      const nightLow = day % 4 === 1 && h > 2 && h < 4 ? -60 : 0;
      const base = 105 + meal + dawn + nightLow;
      mg += (base - mg) * 0.25 + (Math.random() - 0.5) * 8;
      ents.push({ date: t, sgv: Math.round(Math.max(45, mg)), direction: 'Flat' });
    }
    // make the latest readings drift down so the forecast/alert shows
    const last = ents.slice(-4);
    last.forEach((e, i) => { e.sgv = 112 - i * 5; e.direction = 'FortyFiveDown'; });
    const trs = [
      { created_at: new Date(now - 80 * MIN).toISOString(), insulin: 4, carbs: 30, eventType: 'Meal Bolus', notes: 'Chalupa', enteredBy: 'demo' },
      { created_at: new Date(now - 5 * HOUR).toISOString(), insulin: 3, carbs: 25, eventType: 'Meal Bolus', notes: 'Toast + eggs', enteredBy: 'demo' },
      { created_at: new Date(now - 5.2 * HOUR).toISOString(), insulin: 17, eventType: 'Basal', notes: 'Basaglar', enteredBy: 'demo' },
      { created_at: new Date(now - 4.5 * HOUR).toISOString(), eventType: 'Medication', notes: 'Vitamin D 1000 IU', medName: 'Vitamin D', medDose: '1000 IU', medType: 'supplement', enteredBy: 'demo' },
    ];
    // periods: about every 29 days, the latest one 18 days ago
    for (let k = 0; k < 4; k++) {
      const st = new Date(now - (18 + k * 29) * DAY); st.setHours(12, 0, 0, 0);
      trs.push({ created_at: st.toISOString(), eventType: 'Period Start', notes: 'Period started', enteredBy: 'demo' });
      trs.push({ created_at: new Date(st.getTime() + 4 * DAY).toISOString(), eventType: 'Period End', notes: 'Period ended', enteredBy: 'demo' });
    }
    trs.forEach((t, i) => { t._id = 'demo-' + i; });
    return { entries: ents, treatments: trs };
  }

  // ---------- wire up ----------
  function init () {
    document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
    document.querySelectorAll('.chart-head .seg button').forEach((b) => b.addEventListener('click', () => {
      rangeH = Number(b.dataset.range);
      document.querySelectorAll('.chart-head .seg button').forEach((x) => x.classList.toggle('on', x === b));
      renderChart();
    }));
    const wrap = $('chart-wrap');
    wrap.addEventListener('pointermove', chartHover);
    wrap.addEventListener('pointerdown', chartHover);
    wrap.addEventListener('pointerleave', chartLeave);
    $('forecast-banner').addEventListener('click', () => go('calc'));

    $('calc-bg').addEventListener('input', () => { calcBgTouched = true; renderCalc(); });
    $('calc-carbs').addEventListener('input', renderCalc);
    $('calc-log').addEventListener('click', () => {
      $('log-insulin').value = Number($('calc-log').dataset.insulin) || '';
      $('log-carbs').value = Number($('calc-log').dataset.carbs) || '';
      $('log-time').value = toLocalInput(new Date());
      go('log');
    });

    $('log-save').addEventListener('click', async () => {
      const insulin = Number($('log-insulin').value) || 0;
      const carbs = Number($('log-carbs').value) || 0;
      const note = $('log-note').value.trim();
      if (!insulin && !carbs && !note) { showMsg('log-msg', 'Add insulin, carbs or a note first.', 'warn'); return; }
      if (insulin > 30) { showMsg('log-msg', 'That’s over 30 units. Please double-check the number.', 'warn'); return; }
      const when = $('log-time').value ? new Date($('log-time').value) : new Date();
      const t = {
        eventType: insulin && carbs ? 'Meal Bolus' : insulin ? 'Correction Bolus' : carbs ? 'Carb Correction' : 'Note',
        created_at: when.toISOString(),
        enteredBy: 'CGM Hub',
      };
      if (insulin) t.insulin = insulin;
      if (carbs) t.carbs = carbs;
      if (note) t.notes = note;
      runHooks('beforeLogSave', t);
      if (t._block) { showMsg('log-msg', t._block, 'warn'); return; }
      $('log-save').disabled = true;
      try {
        await apiPostTreatment(t);
        showMsg('log-msg', '✅ Saved' + (S.demo ? ' (demo only)' : ' to Nightscout') + '.', 'ok');
        $('log-insulin').value = ''; $('log-carbs').value = ''; $('log-note').value = '';
        $('log-time').value = toLocalInput(new Date());
        runHooks('logSaved');
        await refresh(false);
      } catch (e) {
        showMsg('log-msg', e.message, 'danger');
      } finally { $('log-save').disabled = false; }
    });

    $('set-units').addEventListener('change', onUnitsChange);
    $('set-confirmed').addEventListener('change', () => { confirmTouched = true; });
    document.querySelectorAll('.sched [data-add]').forEach((b) => b.addEventListener('click', () => addSchedRow(b.closest('.sched').dataset.kind)));
    $('set-from-profile').addEventListener('click', fillFromProfile);
    $('set-save').addEventListener('click', async () => {
      const next = readSettingsForm();
      if (!next.demo && next.url && !/^https:\/\//i.test(next.url)) { showMsg('set-msg', 'The URL should start with https://', 'warn'); return; }
      if (next.low >= next.high) { showMsg('set-msg', 'The low line must be below the high line.', 'warn'); return; }
      const changedSource = next.url !== S.url || next.token !== S.token || next.demo !== S.demo;
      S = next; saveSettings();
      if (changedSource) { entries = []; treatments = []; demoStore = null; }
      showMsg('set-msg', S.confirmed ? '✅ Saved.' : '✅ Saved. To use the calculator, tick “I’ve checked these numbers” and Save again.', S.confirmed ? 'ok' : 'warn');
      fillSettingsForm();
      await refresh(true);
    });

    window.addEventListener('resize', () => { if (!$('view-home').hidden) renderChart(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });

    const start = (location.hash || '').slice(1);
    const first = !S.url && !S.demo ? 'settings' : (['home', 'calc', 'food', 'log', 'trends', 'settings', 'game'].includes(start) ? start : 'home');
    go(first);
    refresh(true);
    startLoop();
  }

  // internal API for features.js
  window.CGMHubCore = {
    get S () { return S; }, get entries () { return entries; }, get treatments () { return treatments; }, get periods () { return periods; },
    hooks, onBoard: (t) => onBoard(t), calcFor, ARROWS, apiGet, apiUrl, apiPostTreatment, apiPutTreatment, apiDeleteTreatment, tappable, refresh, saveSettings, go, showMsg, normEntries, normTreatments, isBasal, stats,
    $, el, sv, fmtBG, toMg, fromMg, mmol, unitLabel, clockTime, durText, toLocalInput, statusOf, treatmentLabel, iconFor,
    MIN, HOUR, DAY, MGDL_PER_MMOL,
  };

  // expose pure math for tests
  window.CGMHub = { iobOne, cobOne, smartForecast, ar2Forecast, get forecastKind () { return forecastKind; }, bolusCalc: (bg, carbs, ob, settings) => { const keep = S; S = Object.assign({}, DEFAULTS, settings); try { return bolusCalc(bg, carbs, ob); } finally { S = keep; } } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
