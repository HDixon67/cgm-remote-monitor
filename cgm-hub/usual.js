/* CGM Hub: "The usual". Meals you eat a lot (and your favourites), with what you took last time
 * and what your glucose did after, so a repeat meal is one tap and a little less guesswork. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const SHOW = 6;

  let cache = { at: 0, list: [] };
  async function meals () {
    if (C.S.demo) return C.treatments.filter((t) => t.carbs > 0);
    if (Date.now() - cache.at < 10 * MIN) return cache.list;
    const raw = await C.apiGet('/api/v1/treatments.json', { 'find[carbs][$gt]': '0', 'find[created_at][$gte]': new Date(Date.now() - 60 * DAY).toISOString(), count: '1500' });
    cache = { at: Date.now(), list: C.normTreatments(raw).filter((t) => t.carbs > 0) };
    return cache.list;
  }
  const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // what glucose did in the 3 hours after a meal (needs readings in memory: about the last 14 days)
  function outcome (t) {
    if (Date.now() - t.t < 3 * HOUR) return null;
    const ents = C.entries.filter((e) => e.t >= t.t - 10 * MIN && e.t <= t.t + 4 * HOUR);
    const in3 = ents.filter((e) => e.t >= t.t && e.t <= t.t + 3 * HOUR);
    if (in3.length < 12) return null;
    const near = (when) => ents.reduce((a, e) => (!a || Math.abs(e.t - when) < Math.abs(a.t - when) ? e : a), null);
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const peak = Math.max(...in3.map((e) => e.mg));
    const end = near(t.t + 3 * HOUR);
    const low = ents.some((e) => e.t >= t.t && e.mg < L);
    return { start: near(t.t).mg, peak, end: end.mg, verdict: low ? 'low' : peak > H ? 'high' : 'ok' };
  }

  async function render () {
    const wrap = $('usual-wrap'), box = $('usual-list');
    if (!wrap) return;
    let list = [];
    try { list = await meals(); } catch (e) { wrap.hidden = true; return; }
    const F = window.CGMHubFeatures;
    const favs = F && F.favs ? F.favs() : [];
    const groups = new Map();
    for (const t of list) {
      const k = keyOf(t.notes);
      if (!k || /^(low treat|carb correction|carbs)$/.test(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const rows = [];
    for (const f of favs) rows.push({ name: f.name, fav: f, occ: (groups.get(keyOf(f.name)) || []) });
    for (const [k, occ] of groups) if (occ.length >= 2 && !favs.some((f) => keyOf(f.name) === k)) rows.push({ name: occ[0].notes, occ });
    rows.forEach((r) => { r.occ.sort((a, b) => b.t - a.t); r.score = r.occ.length * 10 + (r.occ[0] ? Math.max(0, 10 - (Date.now() - r.occ[0].t) / DAY / 3) : 0) + (r.fav ? 5 : 0); });
    rows.sort((a, b) => b.score - a.score);
    box.textContent = '';
    wrap.hidden = !rows.length;
    for (const r of rows.slice(0, SHOW)) box.appendChild(rowFor(r));
  }

  function rowFor (r) {
    const last = r.occ[0];
    const row = el('div', 'usual-row');
    const mid = el('div', 'grow');
    const title = el('div', 'title', r.name);
    title.appendChild(el('small', 'muted', r.fav ? ' ⭐' : ' ×' + r.occ.length + ' lately'));
    mid.appendChild(title);
    if (last) {
      const day = new Date(last.t).toLocaleDateString([], { weekday: 'short' });
      mid.appendChild(el('div', 'muted small', `Last time (${day}): ${Math.round(last.carbs)} g` + (last.insulin ? ` · ${Math.round(last.insulin * 10) / 10} u` : ' · no insulin logged')));
      const outs = r.occ.slice(0, 5).map(outcome).filter(Boolean);
      const o = outcome(last);
      if (o) {
        const txt = o.verdict === 'ok' ? `✅ stayed in range (peak ${C.fmtBG(o.peak)}, 3 h later ${C.fmtBG(o.end)})`
          : o.verdict === 'high' ? `📈 went up to ${C.fmtBG(o.peak)}, 3 h later ${C.fmtBG(o.end)}`
            : '📉 went low afterwards';
        mid.appendChild(el('div', 'small usual-out ' + o.verdict, txt));
      }
      if (outs.length >= 2) {
        const good = outs.filter((x) => x.verdict === 'ok').length, high = outs.filter((x) => x.verdict === 'high').length;
        // neutral wording: information, not a grade
        const line = good ? `In range after ${good} of the last ${outs.length} times` : high >= 2 ? 'This one usually runs a bit high afterwards' : '';
        if (line) mid.appendChild(el('div', 'muted small', line));
      }
    } else mid.appendChild(el('div', 'muted small', 'Favourite · no logs with this name yet'));
    row.appendChild(mid);
    const btns = el('div', 'usual-btns');
    const use = el('button', 'btn slim primary', 'Use'); use.type = 'button';
    use.addEventListener('click', () => {
      const F = window.CGMHubFeatures;
      if (r.fav && F && F.useFav) F.useFav(r.fav);
      else { $('log-carbs').value = Math.round(last.carbs); $('log-note').value = last.notes; }
      $('log-carbs').scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    btns.appendChild(use);
    if (last && last.insulin) {
      const same = el('button', 'btn slim', 'Same dose ' + Math.round(last.insulin * 10) / 10 + ' u'); same.type = 'button';
      same.addEventListener('click', () => { $('log-insulin').value = Math.round(last.insulin * 10) / 10; $('log-insulin').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      btns.appendChild(same);
    }
    row.appendChild(btns);
    return row;
  }

  C.hooks.logSaved.push(() => { cache.at = 0; });
  window.CGMHubUsual = { render, outcome };
})();
