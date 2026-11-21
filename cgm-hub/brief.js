/* CGM Hub: Morning brief — 3 swipeable cards (yesterday's lowest + mood, 24h timeline, top pattern). */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const I = window.CGMHubInsights;
  if (!C || !I) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const SEEN_KEY = 'cgmhub.briefSeen';
  let idx = 0, timer = null, cards = [];
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (ms) => { const m = Math.round(ms / MIN); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

  function segmentsFor (series, a, b) {
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const segs = [];
    let t = a, i = 0;
    const tot = { low: 0, high: 0, in: 0, gap: 0 };
    while (t < b) {
      while (i < series.length && series[i].t < t - 10 * MIN) i++;
      const p = series[i] && Math.abs(series[i].t - t) <= 10 * MIN ? series[i] : null;
      const s = !p ? 'gap' : p.mg < L ? 'low' : p.mg > H ? 'high' : 'in';
      tot[s] += 5 * MIN;
      if (segs.length && segs[segs.length - 1].s === s) segs[segs.length - 1].w += 5; else segs.push({ s, w: 5 });
      t += 5 * MIN;
    }
    return { segs, tot };
  }

  async function build () {
    const now = new Date();
    const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    const yA = t0.getTime() - DAY;                       // yesterday 00:00
    const lineA = yA + 6 * HOUR, lineB = t0.getTime() + 6 * HOUR; // yesterday 06:00 → today 06:00
    const d = await I.loadData(yA, Math.min(lineB, Date.now()));
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const yday = d.series.filter((p) => p.t < t0.getTime());
    const out = [];

    // card 1: lowest yesterday + mood
    {
      const c = el('div', 'brief-card');
      if (yday.length < 24) {
        c.classList.add('neutral');
        c.appendChild(el('div', 'b-kicker', 'YESTERDAY'));
        c.appendChild(el('div', 'b-sub', 'Not enough readings yesterday for a summary.'));
      } else {
        const min = Math.min(...yday.map((p) => p.mg));
        const lows = []; let prev = null, start = null;
        for (const p of yday) { if (p.mg < L) { if (start === null || p.t - prev > 15 * MIN) { lows.push({ s: p.t, e: p.t }); start = p.t; } lows[lows.length - 1].e = p.t; prev = p.t; } else start = null; }
        const below = lows.reduce((s, r) => s + (r.e - r.s) + 5 * MIN, 0);
        const tir = (yday.filter((p) => p.mg >= L && p.mg <= H).length / yday.length) * 100;
        c.classList.add(lows.length ? 'red' : tir >= 70 ? 'green' : 'neutral');
        c.appendChild(el('div', 'b-kicker', lows.length ? 'LOWEST YESTERDAY' : 'YESTERDAY'));
        const big = el('div', 'b-big', C.fmtBG(lows.length ? min : yday.reduce((s, p) => s + p.mg, 0) / yday.length));
        big.appendChild(el('small', null, lows.length ? C.unitLabel() : C.unitLabel() + ' average'));
        c.appendChild(big);
        c.appendChild(el('div', 'b-sub', lows.length ? `⬇️ ${lows.length} low${lows.length === 1 ? '' : 's'} · 🕒 ${dur(below)} below` : 'No lows yesterday 🎉'));
        c.appendChild(el('div', 'b-sub', Math.round(tir * 10) / 10 + '% in range'));
        const bar = el('div', 'b-bar'); const f = el('span'); f.style.width = Math.min(100, tir) + '%'; bar.appendChild(f); c.appendChild(bar);
      }
      // how do you feel today?
      const moodT = C.treatments.find((t) => t.eventType === 'Mood' && t.t >= t0.getTime());
      const box = el('div', 'b-mood');
      box.appendChild(el('div', 'b-mood-h', 'How do you feel today?'));
      if (moodT) box.appendChild(el('div', null, (moodT.notes || '').replace(/^Feeling: /, '') + '  ✓'));
      else {
        const faces = el('div', 'faces small-faces');
        [['😫', 'Rough'], ['🙁', 'Not great'], ['😐', 'Okay'], ['🙂', 'Good'], ['😄', 'Great']].forEach(([e, w], i) => {
          const b = el('button'); b.type = 'button'; b.appendChild(el('span', null, e)); b.appendChild(document.createTextNode(w));
          b.addEventListener('click', (ev) => { ev.stopPropagation(); close(); if (window.CGMHubLogHub) window.CGMHubLogHub.openMood(i + 1); });
          faces.appendChild(b);
        });
        box.appendChild(faces);
      }
      c.appendChild(box);
      out.push(c);
    }

    // card 2: yesterday → last night timeline
    {
      const c = el('div', 'brief-card');
      const { segs, tot } = segmentsFor(d.series, lineA, lineB);
      c.classList.add(tot.low ? 'red' : 'neutral');
      c.appendChild(el('div', 'b-kicker', '📅 YESTERDAY → LAST NIGHT'));
      const tl = el('div', 'b-timeline');
      for (const s of segs) { const sp = el('span', 'tl-' + s.s); sp.style.flexGrow = s.w; tl.appendChild(sp); }
      c.appendChild(tl);
      const labs = el('div', 'b-tl-labels');
      ['06:00', '12:00', '18:00', '00:00', '06:00'].forEach((x) => labs.appendChild(el('span', null, x)));
      c.appendChild(labs);
      const full = lineB - lineA;
      [['low', 'Below ' + C.fmtBG(L)], ['high', 'Above ' + C.fmtBG(H)], ['in', 'In range'], ['gap', 'No readings']].forEach(([k, lab]) => {
        const r = el('div', 'b-row');
        const top = el('div', 'b-row-top');
        top.appendChild(el('span', 'b-dot tl-' + k));
        top.appendChild(el('span', 'grow', lab));
        top.appendChild(el('b', null, dur(tot[k])));
        r.appendChild(top);
        const bar = el('div', 'b-bar thin'); const f = el('span', 'tl-' + k); f.style.width = (tot[k] / full) * 100 + '%'; bar.appendChild(f); r.appendChild(bar);
        c.appendChild(r);
      });
      out.push(c);
    }

    // card 3: top pattern (only real, repeating ones)
    {
      const c = el('div', 'brief-card blue');
      let res = null;
      try { res = await I.latest(); } catch (e) { /* show the friendly message */ }
      const main = res && I.mainOf(res.insights);
      if (main) I.renderMainPattern(c, main, 'last 14 days');
      else {
        c.appendChild(el('div', 'b-kicker', '🔁 PATTERN · LAST 14 DAYS'));
        c.appendChild(el('div', 'b-big-text', 'No repeating patterns right now 🎉'));
        c.appendChild(el('div', 'b-sub', 'Keep logging and I’ll point out anything that happens more than once.'));
      }
      out.push(c);
    }
    return out;
  }

  function show (i) {
    idx = Math.max(0, Math.min(cards.length - 1, i));
    const stage = $('brief-stage');
    stage.textContent = '';
    stage.appendChild(cards[idx]);
    $('brief').className = 'brief ' + [...cards[idx].classList].filter((x) => x !== 'brief-card').join(' ');
    document.querySelectorAll('#brief-progress span').forEach((p, n) => { p.className = n < idx ? 'done' : n === idx ? 'now' : ''; });
    clearTimeout(timer);
    if (!reduced() && idx < cards.length - 1) timer = setTimeout(() => show(idx + 1), 9000);
  }
  async function open () {
    $('brief').hidden = false;
    document.body.classList.add('sheet-open');
    $('brief-stage').textContent = '';
    $('brief-stage').appendChild(el('div', 'b-sub', 'Getting your brief ready…'));
    try { localStorage.setItem(SEEN_KEY, new Date().toDateString()); } catch (e) { /* ignore */ }
    try { cards = await build(); } catch (e) { cards = [el('div', 'brief-card neutral', 'Couldn’t build the brief: ' + e.message)]; }
    $('brief-progress').textContent = '';
    cards.forEach(() => $('brief-progress').appendChild(el('span')));
    show(0);
  }
  function close () {
    clearTimeout(timer);
    $('brief').hidden = true;
    document.body.classList.remove('sheet-open');
  }
  $('brief-close').addEventListener('click', close);
  $('brief-stage').addEventListener('click', (e) => {
    if (e.target.closest('button, details, summary, a')) return;
    const r = $('brief-stage').getBoundingClientRect();
    if (e.clientX < r.left + r.width / 3) show(idx - 1); else if (idx === cards.length - 1) close(); else show(idx + 1);
  });
  document.addEventListener('keydown', (e) => { if ($('brief').hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') show(idx + 1); if (e.key === 'ArrowLeft') show(idx - 1); });
  $('brief-open').addEventListener('click', open);

  // auto-open once per morning (5 AM – noon) when there is data
  let tried = false;
  C.hooks.render.push(() => {
    if (tried || C.S.briefAuto === false || !C.entries.length) return;
    tried = true;
    const h = new Date().getHours();
    let seen = '';
    try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch (e) { /* ignore */ }
    if (h >= 5 && h < 12 && seen !== new Date().toDateString() && $('view-home') && !$('view-home').hidden) open();
  });
  const auto = $('set-brief');
  if (auto) { auto.checked = C.S.briefAuto !== false; auto.addEventListener('change', () => { C.S.briefAuto = auto.checked; C.saveSettings(); }); }

  window.CGMHubBrief = { open, close };
})();
