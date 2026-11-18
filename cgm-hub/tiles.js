/* CGM Hub: customizable stat tiles for Home (pick tiles, order, and time period per tile). */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  window.CGMHubTiles = true;
  const { $, el, sv, MIN, HOUR, DAY } = C;

  const PERIODS = { today: 'Today', '24h': '24 hours', '3d': '3 days', '7d': '7 days', '14d': '14 days' };
  function periodRange (p) {
    const now = Date.now();
    if (p === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return [d.getTime(), now]; }
    const n = { '24h': 1, '3d': 3, '7d': 7, '14d': 14 }[p] || 1;
    return [now - n * DAY, now];
  }
  const daysIn = (a, b) => Math.max(1, (b - a) / DAY);
  const fmt1 = (x) => (Math.round(x * 10) / 10).toString();
  const pctTxt = (x) => Math.round(x) + '';
  const diffBG = (mg) => (C.mmol() ? (mg / C.MGDL_PER_MMOL).toFixed(1) : String(Math.round(mg)));
  const sortNum = (a) => a.slice().sort((x, y) => x - y);
  const quant = (s, p) => { if (!s.length) return null; const i = (s.length - 1) * p, a = Math.floor(i), b = Math.ceil(i); return s[a] + (s[b] - s[a]) * (i - a); };
  const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const hourOf = (t) => new Date(t).getHours();
  const none = { value: '--', sub: 'not enough data' };

  // ---------- tile catalog ----------
  const CATS = ['Stats & visualization', 'Estimates', 'Insulin', 'Food', 'Liquid', 'Exercise', 'Advanced stats'];
  const T = [
    // Stats & visualization
    { id: 'tir', cat: 0, name: '% In range', desc: 'Share of readings inside your range.', p: '24h', calc: (c) => c.n ? { value: pctTxt(c.pIn), unit: '%', sub: 'goal: 70%+', icon: c.pIn >= 70 ? '✅' : '' } : none },
    { id: 'above', cat: 0, name: '% Above', desc: 'Share of readings above your range.', p: '24h', calc: (c) => c.n ? { value: pctTxt(c.pHigh), unit: '%', sub: 'goal: under 25%', icon: '🔺' } : none },
    { id: 'below', cat: 0, name: '% Below', desc: 'Share of readings below your range.', p: '24h', calc: (c) => c.n ? { value: c.pLow < 10 ? fmt1(c.pLow) : pctTxt(c.pLow), unit: '%', sub: 'goal: under 4%', icon: '🔻' } : none },
    { id: 'split', cat: 0, name: 'Range split', desc: 'Below, in, and above range together, as a bar.', p: '14d', wide: true, calc: (c) => c.n ? { split: [c.pLow, c.pIn, c.pHigh] } : none },
    { id: 'avg', cat: 0, name: 'Average glucose', desc: 'Average glucose value.', p: '24h', calc: (c) => c.n ? { value: C.fmtBG(c.mean), sub: C.unitLabel() } : none },
    { id: 'bedtime', cat: 0, name: 'Bedtime average', desc: 'Average glucose from 9 PM to midnight.', p: '7d', icon: '🌙', calc: (c) => { const v = meanOf(c.pts.filter((p) => hourOf(p.t) >= 21).map((p) => p.mg)); return v ? { value: C.fmtBG(v), sub: '9 PM – midnight', icon: '🌙' } : none; } },
    { id: 'wake', cat: 0, name: 'Wake-up average', desc: 'Average glucose from 6 to 9 AM.', p: '7d', calc: (c) => { const v = meanOf(c.pts.filter((p) => hourOf(p.t) >= 6 && hourOf(p.t) < 9).map((p) => p.mg)); return v ? { value: C.fmtBG(v), sub: '6 – 9 AM', icon: '☀️' } : none; } },
    { id: 'median', cat: 0, name: 'Median', desc: 'The “middle” value: a typical glucose.', p: '24h', calc: (c) => c.n ? { value: C.fmtBG(quant(c.sorted, 0.5)), sub: C.unitLabel() } : none },
    { id: 'hilo', cat: 0, name: 'Highs / lows', desc: 'How many times you went above or below range.', p: '24h', calc: (c) => c.n ? { value: c.highs + ' / ' + c.lows, sub: 'highs / lows', icon: '↕️' } : none },
    { id: 'flux', cat: 0, name: 'Flux grade', desc: 'How steady you’ve been: A+ is very steady, F changed a lot.', p: '24h', calc: (c) => c.n > 12 ? { value: c.flux, sub: 'steadiness', icon: '〰️' } : none },
    { id: 'spark', cat: 0, name: 'Mini graph', desc: 'A small graph of your glucose.', p: '24h', wide: true, calc: (c) => c.n ? { spark: c.pts } : none },
    { id: 'streak', cat: 0, name: 'In range now for', desc: 'How long you’ve been in range without a break.', p: '24h', calc: (c) => { const a = C.entries; if (!a.length) return none; const lo = C.toMg(C.S.low), hi = C.toMg(C.S.high); if (a[0].mg < lo || a[0].mg > hi) return { value: '0m', sub: 'out of range now', icon: '⏳' }; let t = a[0].t; for (const e of a) { if (e.mg < lo || e.mg > hi) break; t = e.t; } return { value: C.durText(Date.now() - t), sub: 'in range streak', icon: '⏳' }; } },
    { id: 'unicorns', cat: 0, name: 'Unicorns', desc: 'Readings of exactly 5.0 mmol/L (100 mg/dL). 🦄', p: '7d', calc: (c) => ({ value: String(c.pts.filter((p) => (C.mmol() ? Math.round((p.mg / C.MGDL_PER_MMOL) * 10) === 50 : Math.round(p.mg) === 100)).length), sub: 'perfect readings', icon: '🦄' }) },
    { id: 'lowtime', cat: 0, name: 'Time low', desc: 'Total time spent below range.', p: '24h', calc: (c) => c.n ? { value: C.durText(c.pLow / 100 * (c.b - c.a)), sub: 'below ' + C.fmtBG(C.toMg(C.S.low)), icon: '🔻' } : none },
    { id: 'hightime', cat: 0, name: 'Time high', desc: 'Total time spent above range.', p: '24h', calc: (c) => c.n ? { value: C.durText(c.pHigh / 100 * (c.b - c.a)), sub: 'above ' + C.fmtBG(C.toMg(C.S.high)), icon: '🔺' } : none },
    // Estimates
    { id: 'gmi', cat: 1, name: 'Est. A1c (GMI)', desc: 'The A1c you’d expect from your average glucose (Glucose Management Indicator).', p: '14d', calc: (c) => c.n ? { value: (3.31 + 0.02392 * c.mean).toFixed(1), unit: '%', sub: 'GMI' } : none },
    // Insulin
    { id: 'insday', cat: 2, name: 'Insulin / day', desc: 'Average insulin per day (meal + correction + basal you logged).', p: '7d', calc: (c) => ({ value: fmt1(c.sum((t) => t.insulin) / c.days), unit: 'u', sub: 'per day', icon: '💉' }) },
    { id: 'bolusday', cat: 2, name: 'Bolus / day', desc: 'Average rapid-acting insulin per day.', p: '7d', calc: (c) => ({ value: fmt1(c.sum((t) => (C.isBasal(t) ? 0 : t.insulin)) / c.days), unit: 'u', sub: 'per day' }) },
    { id: 'basalday', cat: 2, name: 'Basal / day', desc: 'Average long-acting insulin per day.', p: '7d', calc: (c) => ({ value: fmt1(c.sum((t) => (C.isBasal(t) ? t.insulin : 0)) / c.days), unit: 'u', sub: 'per day' }) },
    { id: 'instotal', cat: 2, name: 'All insulin', desc: 'Total insulin logged in the period.', p: 'today', calc: (c) => ({ value: fmt1(c.sum((t) => t.insulin)), unit: 'u', sub: 'total' }) },
    { id: 'bolus', cat: 2, name: 'Bolus', desc: 'Total rapid-acting insulin logged.', p: 'today', calc: (c) => ({ value: fmt1(c.sum((t) => (C.isBasal(t) ? 0 : t.insulin))), unit: 'u', sub: 'total' }) },
    // Food
    { id: 'carbsday', cat: 3, name: 'Carbs / day', desc: 'Average grams of carbs per day.', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.carbs) / c.days)), unit: 'g', sub: 'per day', icon: '🍞' }) },
    { id: 'carbs', cat: 3, name: 'Carbs', desc: 'Total grams of carbs logged.', p: 'today', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.carbs))), unit: 'g', sub: 'total', icon: '🍞' }) },
    { id: 'calday', cat: 3, name: 'Calories / day', desc: 'Average calories per day (from food search & scans).', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.calories) / c.days)), sub: 'kcal per day', icon: '🔥' }) },
    { id: 'cal', cat: 3, name: 'Calories', desc: 'Total calories logged.', p: 'today', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.calories))), sub: 'kcal', icon: '🔥' }) },
    { id: 'protday', cat: 3, name: 'Protein / day', desc: 'Average grams of protein per day.', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.protein) / c.days)), unit: 'g', sub: 'per day', icon: '🥚' }) },
    { id: 'fatday', cat: 3, name: 'Fat / day', desc: 'Average grams of fat per day.', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.fat) / c.days)), unit: 'g', sub: 'per day', icon: '🥑' }) },
    { id: 'fiberday', cat: 3, name: 'Fiber / day', desc: 'Average grams of fiber per day.', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => t.fiber) / c.days)), unit: 'g', sub: 'per day', icon: '🥦' }) },
    // Liquid
    { id: 'water', cat: 4, name: 'Water', desc: 'Total water logged.', p: 'today', calc: (c) => ({ value: (c.sum((t) => t.water) / 1000).toFixed(1), unit: 'L', sub: 'today’s water', icon: '💧' }) },
    { id: 'waterday', cat: 4, name: 'Water / day', desc: 'Average water logged per day.', p: '7d', calc: (c) => ({ value: (c.sum((t) => t.water) / 1000 / c.days).toFixed(1), unit: 'L', sub: 'per day', icon: '💧' }) },
    // Exercise
    { id: 'exday', cat: 5, name: 'Exercise / day', desc: 'Average minutes of exercise per day.', p: '7d', calc: (c) => ({ value: String(Math.round(c.sum((t) => (t.eventType === 'Exercise' ? t.duration : 0)) / c.days)), unit: 'min', sub: 'per day', icon: '🏃' }) },
    { id: 'ex', cat: 5, name: 'Exercise', desc: 'Total minutes of exercise logged.', p: 'today', calc: (c) => ({ value: String(Math.round(c.sum((t) => (t.eventType === 'Exercise' ? t.duration : 0)))), unit: 'min', sub: 'total', icon: '🏃' }) },
    // Advanced
    { id: 'cv', cat: 6, name: 'Variability (CV)', desc: 'Coefficient of variation: how much glucose swings compared with the average. Goal 36% or less.', p: '24h', calc: (c) => c.n ? { value: pctTxt(c.cv), unit: '%', sub: 'goal: under 36%' } : none },
    { id: 'sd', cat: 6, name: 'Standard deviation', desc: 'How spread out your readings are. Lower = steadier.', p: '24h', calc: (c) => c.n ? { value: diffBG(c.sd), sub: C.unitLabel() } : none },
    { id: 'quart', cat: 6, name: 'Quartiles', desc: '25%, 50% and 75% of your readings fall below these values.', p: '14d', wide: true, calc: (c) => c.n ? { quart: [quant(c.sorted, 0.25), quant(c.sorted, 0.5), quant(c.sorted, 0.75)] } : none },
  ];
  const byId = Object.fromEntries(T.map((t) => [t.id, t]));
  const DEFAULT = [['tir', '24h'], ['avg', '24h'], ['cv', '24h'], ['hilo', '24h'], ['gmi', '14d'], ['streak', '24h'], ['split', '14d']];
  const chosen = () => (Array.isArray(C.S.tiles) && C.S.tiles.length ? C.S.tiles : DEFAULT.map(([id, p]) => ({ id, p }))).filter((x) => byId[x.id]);

  // ---------- treatments for longer periods ----------
  let trs14 = { at: 0, list: [] };
  async function ensureTreatments () {
    if (C.S.demo || !C.S.url) return;
    if (Date.now() - trs14.at < 10 * MIN) return;
    trs14.at = Date.now();
    try {
      trs14.list = C.normTreatments(await C.apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(Date.now() - 14 * DAY).toISOString(), count: '3000' }));
      render();
    } catch (e) { /* tiles fall back to the last 36 hours */ }
  }
  function treatmentsIn (a, b) {
    const seen = new Set();
    const out = [];
    for (const t of trs14.list.concat(C.treatments)) {
      const k = t.t + '|' + t.eventType + '|' + t.insulin + '|' + t.carbs;
      if (seen.has(k) || t.t < a || t.t > b) continue;
      seen.add(k); out.push(t);
    }
    return out;
  }

  // ---------- per-period context ----------
  function context (p) {
    const [a, b] = periodRange(p);
    const pts = C.entries.filter((e) => e.t >= a && e.t <= b).sort((x, y) => x.t - y.t);
    const lo = C.toMg(C.S.low), hi = C.toMg(C.S.high);
    let n = 0, s = 0, s2 = 0, nl = 0, nh = 0, highs = 0, lows = 0, prev = null, absd = 0, nd = 0;
    for (const e of pts) {
      n++; s += e.mg; s2 += e.mg * e.mg;
      const st = e.mg < lo ? 'l' : e.mg > hi ? 'h' : 'i';
      if (st === 'l') nl++; if (st === 'h') nh++;
      if (prev) {
        const ps = prev.mg < lo ? 'l' : prev.mg > hi ? 'h' : 'i';
        if (st === 'h' && ps !== 'h') highs++;
        if (st === 'l' && ps !== 'l') lows++;
      }
      prev = e;
    }
    const mean = n ? s / n : null, sd = n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : null;
    // steadiness on 5-minute averages (1-minute data is too noisy to grade directly)
    const buckets = new Map();
    for (const e of pts) { const k = Math.floor(e.t / (5 * MIN)); const b0 = buckets.get(k) || [0, 0]; b0[0] += e.mg; b0[1]++; buckets.set(k, b0); }
    const avg5 = [...buckets.entries()].sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < avg5.length; i++) {
      if (avg5[i][0] - avg5[i - 1][0] > 3) continue;
      absd += Math.abs(avg5[i][1][0] / avg5[i][1][1] - avg5[i - 1][1][0] / avg5[i - 1][1][1]) / (avg5[i][0] - avg5[i - 1][0]); nd++;
    }
    const rate = nd ? absd / nd : 0; // mg/dL per 5 minutes
    const flux = rate < 1.5 ? 'A+' : rate < 2 ? 'A' : rate < 2.5 ? 'B' : rate < 3.2 ? 'C' : rate < 4 ? 'D' : 'F';
    const trs = treatmentsIn(a, b);
    return {
      a, b, pts, n, mean, sd, cv: n ? (sd / mean) * 100 : null, sorted: sortNum(pts.map((x) => x.mg)),
      pLow: n ? (nl / n) * 100 : 0, pHigh: n ? (nh / n) * 100 : 0, pIn: n ? ((n - nl - nh) / n) * 100 : 0,
      highs, lows, flux, trs, days: p === 'today' ? 1 : daysIn(a, b),
      sum: (f) => trs.reduce((acc, t) => acc + (f(t) || 0), 0),
    };
  }

  // ---------- render tiles ----------
  function render () {
    const box = $('tiles');
    if (!box) return;
    box.textContent = '';
    const ctxs = {};
    for (const { id, p } of chosen()) {
      const def = byId[id];
      const c = ctxs[p] || (ctxs[p] = context(p));
      let r;
      try { r = def.calc(c); } catch (e) { r = none; }
      const t = el('div', 'tile' + (def.wide ? ' wide' : ''));
      const l = el('div', 't-label');
      if (r.icon) l.appendChild(el('span', 't-ic', r.icon + ' '));
      l.appendChild(document.createTextNode(def.name));
      l.appendChild(el('span', 't-per', ' · ' + PERIODS[p]));
      t.appendChild(l);
      if (r.split) {
        const bar = el('div', 'split');
        [['s-low', r.split[0]], ['s-in', r.split[1]], ['s-high', r.split[2]]].forEach(([cls, v]) => { if (v > 0) { const sp = el('span', cls); sp.style.width = v + '%'; bar.appendChild(sp); } });
        bar.setAttribute('aria-label', `Low ${Math.round(r.split[0])}%, in range ${Math.round(r.split[1])}%, high ${Math.round(r.split[2])}%`);
        t.appendChild(bar);
        const lab = el('div', 'split-labels');
        lab.appendChild(el('span', null, '🔻 ' + Math.round(r.split[0]) + '%'));
        lab.appendChild(el('span', null, '✅ ' + Math.round(r.split[1]) + '%'));
        lab.appendChild(el('span', null, '🔺 ' + Math.round(r.split[2]) + '%'));
        t.appendChild(lab);
      } else if (r.spark) {
        t.appendChild(spark(r.spark, c.a, c.b));
      } else if (r.quart) {
        const row = el('div', 'quart');
        ['25%', 'Median', '75%'].forEach((lab, i) => { const q = el('div'); q.appendChild(el('div', 't-value', C.fmtBG(r.quart[i]))); q.appendChild(el('div', 't-sub', lab)); row.appendChild(q); });
        t.appendChild(row);
      } else {
        const v = el('div', 't-value', r.value);
        if (r.unit) v.appendChild(el('small', null, r.unit));
        t.appendChild(v);
        t.appendChild(el('div', 't-sub', r.sub || ''));
      }
      box.appendChild(t);
    }
    if (!box.children.length) box.appendChild(el('p', 'muted', 'No tiles. Tap ✏️ Edit tiles to add some.'));
  }
  function spark (pts, a, b) {
    const W = 300, H = 56;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': 'Mini glucose graph' });
    const lo = C.toMg(C.S.low), hi = C.toMg(C.S.high);
    const max = Math.max(hi + 20, ...pts.map((p) => p.mg)), min = Math.min(lo - 20, ...pts.map((p) => p.mg));
    const x = (t) => ((t - a) / (b - a)) * W, y = (mg) => 4 + (1 - (mg - min) / (max - min)) * (H - 8);
    svg.appendChild(sv('rect', { class: 'band', x: 0, y: y(hi), width: W, height: y(lo) - y(hi) }));
    const step = Math.max(1, Math.floor(pts.length / 150));
    svg.appendChild(sv('polyline', { class: 'spark-line', points: pts.filter((_, i) => i % step === 0).map((p) => `${x(p.t).toFixed(1)},${y(p.mg).toFixed(1)}`).join(' ') }));
    return svg;
  }

  // ---------- editor ----------
  function setTiles (list) { C.S.tiles = list; C.saveSettings(); }
  function renderEditor () {
    const ul = $('tile-edit-list');
    ul.textContent = '';
    const list = chosen().map((x) => Object.assign({}, x));
    list.forEach((x, i) => {
      const def = byId[x.id];
      const li = el('li');
      li.appendChild(el('div', 'grow title', def.name));
      const sel = el('select');
      Object.entries(PERIODS).forEach(([k, lab]) => { const o = el('option', null, lab); o.value = k; if (k === x.p) o.selected = true; sel.appendChild(o); });
      sel.setAttribute('aria-label', 'Time period for ' + def.name);
      sel.addEventListener('change', () => { list[i].p = sel.value; setTiles(list); render(); });
      li.appendChild(sel);
      const mk = (txt, label, fn, dis) => { const b = el('button', 'del', txt); b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = !!dis; b.addEventListener('click', fn); li.appendChild(b); };
      mk('▲', 'Move up', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; setTiles(list); renderEditor(); render(); }, i === 0);
      mk('▼', 'Move down', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; setTiles(list); renderEditor(); render(); }, i === list.length - 1);
      mk('✕', 'Remove ' + def.name, () => { list.splice(i, 1); setTiles(list); renderEditor(); render(); });
      ul.appendChild(li);
    });
  }
  function renderCatalog () {
    const box = $('tile-catalog');
    box.textContent = '';
    CATS.forEach((cat, ci) => {
      box.appendChild(el('h3', 'cat-h', cat));
      T.filter((t) => t.cat === ci).forEach((t) => {
        const b = el('button', 'cat-item');
        b.type = 'button';
        b.appendChild(el('b', null, t.name));
        b.appendChild(el('span', 'muted small', t.desc));
        const has = chosen().some((x) => x.id === t.id);
        if (has) b.appendChild(el('span', 'cat-has', '✓ added'));
        b.addEventListener('click', () => {
          setTiles(chosen().concat([{ id: t.id, p: t.p }]));
          renderEditor(); render(); renderCatalog();
        });
        box.appendChild(b);
      });
    });
  }
  $('tiles-edit').addEventListener('click', () => { const ed = $('tiles-editor'); ed.hidden = !ed.hidden; if (!ed.hidden) renderEditor(); });
  $('tiles-done').addEventListener('click', () => { $('tiles-editor').hidden = true; $('tile-catalog').hidden = true; });
  $('tiles-add').addEventListener('click', () => { const cat = $('tile-catalog'); cat.hidden = !cat.hidden; if (!cat.hidden) renderCatalog(); });

  C.hooks.render.push(() => { render(); ensureTreatments(); });
  window.CGMHubTilesApi = { T, context };
})();
