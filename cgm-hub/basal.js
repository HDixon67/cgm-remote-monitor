/* CGM Hub: 🌙 Basal check (Trends → Basal).
 * A basal test only means something on "clean" nights: no food and no rapid insulin for ~4 hours before
 * and during the night, so what's left is your long-acting insulin vs your liver. This finds those nights
 * automatically, shows start vs end glucose, the drift and a flat / rising / falling label per night,
 * plus your long-acting dose. Information to take to your diabetes team, not dosing advice. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const I = window.CGMHubInsights;
  if (!C || !I) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const CLEAR = 4 * HOUR; // food / rapid insulin must be this long before the part of the night we look at
  const MIN_LEN = 4 * HOUR; // at least this much clean night to count
  const DRIFT = 30; // mg/dL (1.7 mmol/L): the usual "needs a look" line for a basal test
  let nights = Number(C.S.basalNights) || 14;
  let busy = false;

  const hm = (s, d) => { const [h, m] = String(s || d).split(':').map(Number); return (h || 0) * HOUR + (m || 0) * MIN; };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const isBolus = (t) => t.insulin > 0 && !C.isBasal(t);
  const fmtDelta = (mg) => (mg >= 0 ? '+' : '−') + C.fmtBG(Math.abs(mg));

  // one night: the window ending on the morning of `day0`
  function checkNight (day0, series, trs) {
    const from = hm(C.S.basalFrom, '22:00'), to = hm(C.S.basalTo, '07:00');
    const wStart = from > to ? day0 - DAY + from : day0 + from;
    const wEnd = day0 + to;
    const label = new Date(wStart).toLocaleDateString([], { weekday: 'short' }) + ' night';
    if (wEnd > Date.now()) return { label, state: 'future' };
    // the last food or rapid insulin before the end of the night pushes the clean start later
    const events = trs.filter((t) => (t.carbs > 0 || isBolus(t)) && t.t >= wStart - CLEAR && t.t < wEnd).sort((a, b) => b.t - a.t);
    const last = events[0];
    const start = Math.max(wStart, last ? last.t + CLEAR : wStart);
    const basal = trs.filter((t) => C.isBasal(t) && t.t <= wEnd && t.t > wEnd - 30 * HOUR).sort((a, b) => b.t - a.t)[0] || null;
    const base = { label, wStart, wEnd, basal };
    if (wEnd - start < MIN_LEN) {
      return Object.assign(base, { state: 'skip', why: last ? (last.carbs > 0 ? 'food' : 'insulin') + ' at ' + C.clockTime(last.t) : 'too short' });
    }
    const pts = series.filter((p) => p.t >= start && p.t <= wEnd);
    if (pts.length < ((wEnd - start) / (5 * MIN)) * 0.7) return Object.assign(base, { state: 'skip', why: 'gaps in CGM data' });
    const L = C.toMg(C.S.low);
    const lowAt = pts.find((p) => p.mg < L);
    const end = lowAt ? lowAt.t : wEnd;
    const avg = (a, b) => { const s = pts.filter((p) => p.t >= a && p.t <= b); return s.reduce((x, p) => x + p.mg, 0) / s.length; };
    const sMg = avg(start, start + 15 * MIN), eMg = lowAt ? lowAt.mg : avg(end - 15 * MIN, end);
    const drift = eMg - sMg;
    const used = pts.filter((p) => p.t <= end);
    const state = lowAt ? 'low' : drift > DRIFT ? 'rising' : drift < -DRIFT ? 'falling' : 'flat';
    return Object.assign(base, {
      state, start, end, sMg, eMg, drift, perHour: drift / ((end - start) / HOUR),
      min: Math.min(...used.map((p) => p.mg)), max: Math.max(...used.map((p) => p.mg)), pts: used, after: last,
    });
  }

  function spark (n) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 120, H = 34, lo = 40, hi = 300;
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'bc-spark'); svg.setAttribute('aria-hidden', 'true');
    const y = (mg) => H - ((Math.min(hi, Math.max(lo, mg)) - lo) / (hi - lo)) * H;
    const band = document.createElementNS(NS, 'rect');
    band.setAttribute('x', 0); band.setAttribute('width', W); band.setAttribute('y', y(C.toMg(C.S.high))); band.setAttribute('height', y(C.toMg(C.S.low)) - y(C.toMg(C.S.high))); band.setAttribute('class', 'bc-band');
    svg.appendChild(band);
    const t0 = n.start, t1 = n.end;
    const path = n.pts.map((p, i) => (i ? 'L' : 'M') + (((p.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1) + ' ' + y(p.mg).toFixed(1)).join(' ');
    const line = document.createElementNS(NS, 'path'); line.setAttribute('d', path); line.setAttribute('class', 'bc-line ' + n.state);
    svg.appendChild(line);
    return svg;
  }

  const WORDS = { flat: ['➡️', 'Flat'], rising: ['↗️', 'Rising'], falling: ['↘️', 'Falling'], low: ['📉', 'Went low'] };
  async function render () {
    const box = $('basal-body');
    if (!box || busy) return;
    busy = true;
    box.textContent = '';
    box.appendChild(el('p', 'muted small', 'Looking at your nights…'));
    const today0 = dayStart(Date.now());
    const a = today0 - (nights + 1) * DAY, b = Date.now();
    let d;
    try { d = await I.loadData(a, b); } catch (e) { box.textContent = ''; box.appendChild(el('p', 'notice danger', e.message || String(e))); busy = false; return; }
    busy = false;
    const list = [];
    for (let i = 0; i < nights; i++) list.push(checkNight(today0 - i * DAY, d.series, d.trs));
    const done = list.filter((n) => n.state !== 'future');
    const clean = done.filter((n) => n.state !== 'skip');
    box.textContent = '';

    // summary
    const sum = el('div', 'bc-sum');
    const counts = { flat: 0, rising: 0, falling: 0, low: 0 };
    clean.forEach((n) => { counts[n.state]++; });
    sum.appendChild(el('div', 'bc-big', clean.length + ' clean night' + (clean.length === 1 ? '' : 's') + ' of ' + done.length));
    if (clean.length) {
      const chips = el('div', 'bc-chips');
      for (const k of Object.keys(counts)) if (counts[k]) chips.appendChild(el('span', 'bc-chip ' + k, WORDS[k][0] + ' ' + counts[k] + ' ' + WORDS[k][1].toLowerCase()));
      sum.appendChild(chips);
      const avg = clean.filter((n) => n.state !== 'low').reduce((x, n) => x + n.drift, 0) / Math.max(1, clean.filter((n) => n.state !== 'low').length);
      if (clean.some((n) => n.state !== 'low')) sum.appendChild(el('div', 'muted small', 'Average drift overnight: ' + fmtDelta(avg) + ' ' + C.unitLabel()));
    }
    let verdict;
    if (clean.length < 3) verdict = 'Not enough clean nights yet (3+ needed) to say anything about your basal. The skipped nights below show why.';
    else {
      const top = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
      const share = counts[top] / clean.length;
      if (share < 0.6) verdict = 'Mixed results. No clear overnight pattern, which can be normal. Things like stress, illness, your cycle or late fat/protein can shift single nights.';
      else if (top === 'flat') verdict = '👍 Mostly flat. Your overnight basal looks well matched on clean nights.';
      else if (top === 'rising') verdict = 'Mostly rising on clean nights. That can mean the basal is a bit light overnight, or it’s wearing off before morning. Worth showing your diabetes team.';
      else verdict = 'Mostly falling or going low on clean nights. That can mean the basal is a bit strong overnight. Worth showing your diabetes team soon, and keep fast sugar by your bed.';
    }
    sum.appendChild(el('p', 'bc-verdict', verdict));
    box.appendChild(sum);

    // nights (newest first); flag when the long-acting dose changed from the night before
    done.forEach((n, i) => { const prev = done[i + 1]; if (n.basal && prev && prev.basal && Math.abs(prev.basal.insulin - n.basal.insulin) >= 0.1) n.changedFrom = prev.basal.insulin; });
    for (const n of done) {
      const row = el('div', 'bc-night' + (n.state === 'skip' ? ' skip' : ''));
      const top = el('div', 'bc-top');
      top.appendChild(el('b', null, n.label));
      if (n.state === 'skip') top.appendChild(el('span', 'muted small', 'Skipped: ' + n.why));
      else top.appendChild(el('span', 'bc-chip ' + n.state, WORDS[n.state][0] + ' ' + WORDS[n.state][1]));
      row.appendChild(top);
      if (n.state !== 'skip') {
        const mid = el('div', 'bc-mid');
        mid.appendChild(spark(n));
        const nums = el('div', 'bc-nums');
        nums.appendChild(el('div', null, C.fmtBG(n.sMg) + ' → ' + C.fmtBG(n.eMg) + ' (' + fmtDelta(n.drift) + ')'));
        nums.appendChild(el('div', 'muted small', C.clockTime(n.start) + '–' + C.clockTime(n.end) + (n.state === 'low' ? ' (stopped at the low)' : '') + ' · range ' + C.fmtBG(n.min) + '–' + C.fmtBG(n.max)));
        mid.appendChild(nums);
        row.appendChild(mid);
      }
      if (n.basal) row.appendChild(el('div', 'muted small', '💉 ' + ((n.basal.raw && (n.basal.raw.insulinType || n.basal.raw.basalName)) || n.basal.notes || 'Long-acting') + ' ' + Math.round(n.basal.insulin * 10) / 10 + ' u at ' + C.clockTime(n.basal.t) + ' (' + new Date(n.basal.t).toLocaleDateString([], { weekday: 'short' }) + ')' + (n.changedFrom != null ? ' · ⚠️ changed from ' + Math.round(n.changedFrom * 10) / 10 + ' u' : '')));
      else if (n.state !== 'skip') row.appendChild(el('div', 'muted small', '💉 No long-acting dose logged in the day before'));
      box.appendChild(row);
    }

    // how it works
    const det = el('details', 'bc-how');
    det.appendChild(el('summary', null, 'How the basal check works'));
    const ul = el('ul');
    ['A “clean” night has no food and no rapid insulin for 4 hours before and during the part we look at, so it mostly shows your long-acting insulin at work.',
      `Flat means start and end are within ${C.fmtBG(DRIFT)} ${C.unitLabel()} of each other. More than that is rising or falling. Hitting your low line counts as “went low” and the night stops there.`,
      'Want more clean nights? On a few nights, finish dinner and boluses about 4 hours before bed and skip late snacks, but only if that’s safe for you. Always treat lows as usual (that night just won’t count).',
      'Sensor compression (lying on the sensor) can fake overnight lows. If a “went low” night looks odd, check your fingerstick.',
      'This is information to take to your diabetes team. Please don’t change your basal dose based on this alone.'].forEach((t) => ul.appendChild(el('li', null, t)));
    det.appendChild(ul);
    box.appendChild(det);
  }

  // settings inside the card: how many nights, and the night window
  document.querySelectorAll('#basal-nights [data-n]').forEach((b) => b.addEventListener('click', () => {
    nights = Number(b.dataset.n); C.S.basalNights = nights; C.saveSettings();
    document.querySelectorAll('#basal-nights [data-n]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  document.querySelectorAll('#basal-nights [data-n]').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) === nights));
  const fromIn = $('basal-from'), toIn = $('basal-to');
  if (fromIn && toIn) {
    fromIn.value = C.S.basalFrom || '22:00'; toIn.value = C.S.basalTo || '07:00';
    const save = () => { C.S.basalFrom = fromIn.value || '22:00'; C.S.basalTo = toIn.value || '07:00'; C.saveSettings(); render(); };
    fromIn.addEventListener('change', save); toIn.addEventListener('change', save);
  }

  window.CGMHubBasal = { render, checkNight };
})();
