/* CGM Hub: History (Day / Week / Month / Cycle) with date navigation, SangraMate-style. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const I = window.CGMHubInsights;
  if (!C || !I) return;
  const { $, el, sv, MIN, HOUR, DAY } = C;

  let mode = 'day';
  let anchor = new Date(); anchor.setHours(0, 0, 0, 0);
  let busy = false, lastRun = 0;

  // ---------- periods ----------
  function range (m, d) {
    const a = new Date(d); a.setHours(0, 0, 0, 0);
    if (m === 'week') { const dow = (a.getDay() + 6) % 7; a.setDate(a.getDate() - dow); const b = new Date(a); b.setDate(b.getDate() + 7); return [a.getTime(), b.getTime()]; }
    if (m === 'month') { a.setDate(1); const b = new Date(a); b.setMonth(b.getMonth() + 1); return [a.getTime(), b.getTime()]; }
    const b = new Date(a); b.setDate(b.getDate() + 1); return [a.getTime(), b.getTime()];
  }
  function shift (m, d, n) {
    const x = new Date(d);
    if (m === 'week') x.setDate(x.getDate() + 7 * n);
    else if (m === 'month') x.setMonth(x.getMonth() + n, 1);
    else x.setDate(x.getDate() + n);
    return x;
  }
  function label (m, a, b) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (m === 'day') {
      if (a === today.getTime()) return 'Today';
      if (a === today.getTime() - DAY) return 'Yesterday';
      return new Date(a).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (m === 'week') return new Date(a).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + new Date(b - 1).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return new Date(a).toLocaleDateString([], { month: 'long', year: 'numeric' });
  }
  const prevWord = { day: 'yesterday', week: 'last week', month: 'last month' };
  const dur = (ms) => { const m = Math.round(ms / MIN); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };

  // ---------- stats from 5-minute series ----------
  function glucoseStats (series) {
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const n = series.length;
    if (n < 12) return null;
    let s = 0, s2 = 0, nl = 0, nh = 0, min = Infinity, max = -Infinity;
    for (const p of series) { s += p.mg; s2 += p.mg * p.mg; if (p.mg < L) nl++; else if (p.mg > H) nh++; min = Math.min(min, p.mg); max = Math.max(max, p.mg); }
    const mean = s / n, cv = (Math.sqrt(Math.max(0, s2 / n - mean * mean)) / mean) * 100;
    const runs = (test) => {
      let count = 0, time = 0, start = null, prev = null;
      for (const p of series) {
        if (test(p.mg)) { if (start === null || p.t - prev > 15 * MIN) { if (start !== null) time += prev - start + 5 * MIN; count++; start = p.t; } prev = p.t; }
        else if (start !== null) { time += prev - start + 5 * MIN; start = null; }
      }
      if (start !== null) time += prev - start + 5 * MIN;
      return { count, time };
    };
    return { n, mean, cv, tir: ((n - nl - nh) / n) * 100, min, max, lows: runs((v) => v < L), highs: runs((v) => v > H) };
  }

  // ---------- day chart ----------
  function dayChart (series, trs, a, b) {
    const svg = $('hist-chart');
    svg.textContent = '';
    const W = svg.clientWidth || 340, Hh = 220;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    if (!series.length) { svg.appendChild(sv('text', { class: 'axis-text', x: W / 2, y: Hh / 2, 'text-anchor': 'middle' }, 'No readings for this day')); return; }
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const padL = 6, padR = 34, padT = 22, padB = 22;
    const maxMg = Math.max(C.toMg(C.mmol() ? 15 : 270), ...series.map((p) => p.mg)) + 10, minMg = C.mmol() ? 2 * C.MGDL_PER_MMOL : 40;
    const x = (t) => padL + ((t - a) / (b - a)) * (W - padL - padR);
    const y = (mg) => padT + (1 - (Math.min(maxMg, Math.max(minMg, mg)) - minMg) / (maxMg - minMg)) * (Hh - padT - padB);
    svg.appendChild(sv('rect', { class: 'band', x: padL, y: y(H), width: W - padL - padR, height: y(L) - y(H) }));
    const ticks = C.mmol() ? [3, 6, 9, 12, 15, 18, 21] : [54, 108, 162, 216, 270, 324];
    for (const tv of ticks) { const mg = C.mmol() ? tv * C.MGDL_PER_MMOL : tv; if (mg < minMg || mg > maxMg) continue; svg.appendChild(sv('line', { class: 'grid', x1: padL, x2: W - padR, y1: y(mg), y2: y(mg) })); svg.appendChild(sv('text', { class: 'axis-text', x: W - padR + 4, y: y(mg) + 4 }, String(tv))); }
    svg.appendChild(sv('line', { class: 'lim-low', x1: padL, x2: W - padR, y1: y(L), y2: y(L) }));
    svg.appendChild(sv('line', { class: 'lim-high', x1: padL, x2: W - padR, y1: y(H), y2: y(H) }));
    [0, 6, 12, 18].forEach((h) => svg.appendChild(sv('text', { class: 'axis-text', x: x(a + h * HOUR) + (h ? 0 : 8), y: Hh - 6, 'text-anchor': h ? 'middle' : 'start' }, new Date(a + h * HOUR).toLocaleTimeString([], { hour: 'numeric' }))));
    // line segments coloured by status; break the line at gaps
    let seg = [], cls = null, prev = null;
    const flush = () => { if (seg.length > 1) svg.appendChild(sv('polyline', { class: 'hl hl-' + cls, points: seg.join(' ') })); };
    for (const p of series) {
      const c = p.mg < L ? 'low' : p.mg > H ? 'high' : 'in';
      const pt = `${x(p.t).toFixed(1)},${y(p.mg).toFixed(1)}`;
      if (prev && (p.t - prev.t > 20 * MIN)) { flush(); seg = []; cls = c; }
      if (cls !== null && c !== cls) { seg.push(pt); flush(); seg = [seg[seg.length - 1]]; }
      cls = c; seg.push(pt); prev = p;
    }
    flush();
    for (const t of trs) {
      if (t.insulin > 0) { svg.appendChild(sv('circle', { class: 'tr-ins', cx: x(t.t), cy: 10, r: 8 })); svg.appendChild(sv('text', { class: 'tr-text', x: x(t.t), y: 10 }, String(Math.round(t.insulin * 10) / 10))); }
      if (t.carbs > 0) { const cy = t.insulin > 0 ? 28 : 10; svg.appendChild(sv('circle', { class: 'tr-carb', cx: x(t.t), cy, r: 8 })); svg.appendChild(sv('text', { class: 'tr-text', x: x(t.t), y: cy }, String(Math.round(t.carbs)))); }
    }
  }

  // ---------- summary (Day summary / Daily average) ----------
  function summary (trs, a, b) {
    const box = $('hist-sum');
    box.textContent = '';
    const days = Math.max(1, Math.round((Math.min(b, Date.now()) - a) / DAY));
    const dayKeys = new Set(trs.filter((t) => t.insulin || t.carbs || t.eventType === 'Exercise' || t.water).map((t) => new Date(t.t).toDateString()));
    const per = mode === 'day' ? 1 : Math.max(1, dayKeys.size);
    $('hist-sum-title').textContent = mode === 'day' ? 'Day summary' : 'Daily average';
    $('hist-sum-note').textContent = mode === 'day' ? '' : `Logged on ${dayKeys.size} of ${days} days` + (dayKeys.size < days ? '. Averages count logged days only.' : '.');
    const sum = (f) => trs.reduce((s, t) => s + (f(t) || 0), 0);
    const one = (v) => (Math.round(v * 10) / 10).toString();
    const rapid = sum((t) => (C.isBasal(t) ? 0 : t.insulin)), basal = sum((t) => (C.isBasal(t) ? t.insulin : 0));
    const big = (cls, k, v, u, sub) => { const d = el('div', 'sum-big ' + cls); d.appendChild(el('div', 'sum-k', k)); const vv = el('div', 'sum-v', v); vv.appendChild(el('small', null, u)); d.appendChild(vv); if (sub) d.appendChild(el('div', 'muted small', sub)); box.appendChild(d); };
    big('ins', '💉 Insulin' + (mode === 'day' ? '' : ' · per day'), one((rapid + basal) / per), 'u', `rapid ${one(rapid / per)}u · long-acting ${one(basal / per)}u`);
    big('carb', '🍽️ Carbs' + (mode === 'day' ? '' : ' · per day'), one(sum((t) => t.carbs) / per), 'g');
    const rows = [['🔥 Calories', sum((t) => t.calories) / per, 'kcal'], ['🥚 Protein', sum((t) => t.protein) / per, 'g'], ['🥑 Fat', sum((t) => t.fat) / per, 'g'], ['🥦 Fibre', sum((t) => t.fiber) / per, 'g'],
      ['🏃 Activity', sum((t) => (t.eventType === 'Exercise' ? t.duration : 0)) / per, 'min'], ['💧 Water', sum((t) => t.water) / per / 1000, 'L']];
    const ul = el('ul', 'sum-rows');
    for (const [k, v, u] of rows) { const li = el('li'); li.appendChild(el('span', null, k)); li.appendChild(el('b', null, v ? one(v) + ' ' + u : '–')); ul.appendChild(li); }
    const moods = trs.filter((t) => t.eventType === 'Mood');
    if (moods.length) { const li = el('li'); li.appendChild(el('span', null, '🙂 Feeling')); li.appendChild(el('b', null, moods.map((m) => (m.notes || '').replace(/^Feeling: /, '')).slice(0, 3).join(' / '))); ul.appendChild(li); }
    box.appendChild(ul);
  }

  function logbook (trs) {
    const ul = $('hist-log');
    ul.textContent = '';
    $('hist-log-n').textContent = trs.length + ' record' + (trs.length === 1 ? '' : 's');
    if (!trs.length) { ul.appendChild(el('li', 'empty', 'Nothing logged this day.')); return; }
    for (const t of trs.slice().sort((x, y) => x.t - y.t)) {
      const li = el('li');
      li.appendChild(C.iconFor(t));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', C.treatmentLabel(t)));
      mid.appendChild(el('div', 'muted small', C.clockTime(t.t)));
      li.appendChild(mid);
      const r = el('div', 'right');
      if (t.insulin) r.appendChild(el('div', null, Math.round(t.insulin * 10) / 10 + 'u'));
      if (t.carbs) r.appendChild(el('div', null, Math.round(t.carbs) + 'g'));
      li.appendChild(r);
      ul.appendChild(li);
    }
  }

  // ---------- render ----------
  function applyMode () {
    document.querySelectorAll('#hist-tabs [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const v = $('view-trends');
    v.classList.toggle('m-cycle', mode === 'cycle');
    v.classList.toggle('m-day', mode === 'day');
    $('hist-nav').hidden = mode === 'cycle';
  }
  async function render () {
    applyMode();
    if (mode === 'cycle') return;
    if (busy) return;
    busy = true; lastRun = Date.now();
    const [a, b] = range(mode, anchor);
    $('hist-label').textContent = label(mode, a, b);
    $('hist-date').value = C.toLocalInput(new Date(a)).slice(0, 10);
    $('hist-next').disabled = b > Date.now();
    try {
      const { d } = await I.renderWindow(a, b, mode === 'week' ? 'this week' : mode === 'month' ? label('month', a, b) : 'this day');
      const st = glucoseStats(d.series);
      const [pa, pb] = range(mode, shift(mode, anchor, -1));
      let prevTir = null;
      try { const pd = await I.loadData(pa, pb); const ps = glucoseStats(pd.series); prevTir = ps && ps.tir; } catch (e) { /* no comparison */ }
      if (st) {
        $('hist-tir').textContent = (Math.round(st.tir * 10) / 10) + '%';
        $('hist-tir-box').className = 'tir-big ' + (st.tir >= 70 ? 'good' : st.tir >= 50 ? 'mid' : 'low');
        const delta = prevTir == null ? null : st.tir - prevTir;
        $('hist-tir-delta').textContent = delta == null ? ' ' : (delta >= 0 ? '↑' : '↓') + Math.abs(Math.round(delta * 10) / 10) + '% vs ' + prevWord[mode];
        $('hist-tir-delta').className = 'tir-d ' + (delta == null ? '' : delta >= 0 ? 'up' : 'down');
        $('hist-avg').textContent = C.fmtBG(st.mean) + ' ' + C.unitLabel();
        $('hist-cv').textContent = Math.round(st.cv * 10) / 10 + '%';
        $('hist-lows').textContent = st.lows.count ? `${st.lows.count} event${st.lows.count === 1 ? '' : 's'} · ${dur(st.lows.time)} · min ${C.fmtBG(st.min)}` : 'none 🎉';
        $('hist-highs').textContent = st.highs.count ? `${st.highs.count} event${st.highs.count === 1 ? '' : 's'} · ${dur(st.highs.time)} · max ${C.fmtBG(st.max)}` : 'none 🎉';
      } else {
        ['hist-tir', 'hist-avg', 'hist-cv'].forEach((id) => { $(id).textContent = '--'; });
        $('hist-tir-delta').textContent = 'No glucose data for this period';
        $('hist-lows').textContent = '--'; $('hist-highs').textContent = '--';
      }
      if (mode === 'day') { dayChart(d.series, d.trs, a, b); logbook(d.trs.filter((t) => t.eventType !== 'CGMHub Settings')); }
      summary(d.trs, a, b);
    } catch (e) {
      $('ins-status').textContent = '⚠️ ' + e.message;
    } finally { busy = false; }
  }

  document.querySelectorAll('#hist-tabs [data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  $('hist-prev').addEventListener('click', () => { anchor = shift(mode, anchor, -1); render(); });
  $('hist-next').addEventListener('click', () => { const n = shift(mode, anchor, 1); if (range(mode, n)[0] <= Date.now()) { anchor = n; render(); } });
  $('hist-date').addEventListener('change', () => { const v = $('hist-date').value; if (!v) return; const [y, m, d] = v.split('-').map(Number); anchor = new Date(y, m - 1, d); render(); });
  C.hooks.view.push((v) => { if (v === 'trends') render(); });
  // keep "today" fresh while it's on screen
  C.hooks.render.push(() => { if (!$('view-trends').hidden && Date.now() - lastRun > 2 * MIN && range(mode, anchor)[1] > Date.now()) render(); });

  window.CGMHubHistory = { render, glucoseStats, range, setMode: (m) => { mode = m; render(); } };
})();
