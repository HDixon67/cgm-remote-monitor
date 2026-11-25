/* CGM Hub: nutrients the Cronometer way, in the 🥗 Food tab.
 * - Highlighted nutrients: 8 bars (green once you reach the target). Tap one for details.
 * - Nutrient detail: target vs safe upper limit, today's top sources, what it does, foods with lots of it.
 * - Daily report: every nutrient, grouped (carbs, protein, fats, vitamins, minerals), plus an overall score.
 * Targets come from Settings → Nutrition (label Daily Values, or the DRIs for your age and sex). */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const N = () => window.CGMHubNutrition;
  if (!C) return;
  const { $, el } = C;
  const DEFAULT_HL = ['fiber', 'iron', 'calcium', 'vitA', 'vitC', 'vitB12', 'folate', 'potassium'];
  const highlighted = () => (Array.isArray(C.S.nutHighlight) && C.S.nutHighlight.length ? C.S.nutHighlight : DEFAULT_HL);
  let day = null; // { sum, logs, counted, total }

  // a day's totals from its logs; foods carry their own nutrients when they came from search / scan / Cronometer
  function compute (logs) {
    const sum = {}; let counted = 0;
    for (const t of logs) {
      const n = t.nutrients || (t.raw && t.raw.nutrients);
      if (!n || !Object.keys(n).length) continue;
      counted++;
      for (const k in n) if (typeof n[k] === 'number') sum[k] = (sum[k] || 0) + n[k];
    }
    return { sum, logs, counted, total: logs.length };
  }
  function sources (key) {
    const out = [];
    for (const t of day.logs) {
      const raw = t.raw || {};
      const foods = Array.isArray(raw.foods) ? raw.foods.filter((f) => f.n && typeof f.n[key] === 'number') : [];
      if (foods.length) foods.forEach((f) => out.push({ name: f.name, v: f.n[key] }));
      else if (raw.nutrients && typeof raw.nutrients[key] === 'number') out.push({ name: t.notes || raw.mealGroup || 'Meal', v: raw.nutrients[key] });
    }
    // the same food twice in a day → one line
    const merged = new Map();
    for (const s of out) merged.set(s.name, (merged.get(s.name) || 0) + s.v);
    return [...merged.entries()].map(([name, v]) => ({ name, v })).filter((s) => s.v > 0).sort((a, b) => b.v - a.v);
  }
  const pctOf = (k) => { const t = N().targets()[k]; return t && day.sum[k] != null ? (day.sum[k] / t) * 100 : null; };
  const good = (k, p) => (N().BY[k].kind === 'max' ? p <= 100 : p >= 100);

  function bar (k, cls) {
    const p = pctOf(k);
    const b = el('div', 'nr-bar ' + (cls || ''));
    const f = el('span'); f.style.width = Math.min(100, p || 0) + '%';
    if (p != null && N().BY[k].kind === 'max' && p > 100) f.classList.add('over');
    else if (p != null && good(k, p)) f.classList.add('ok');
    b.appendChild(f);
    return b;
  }

  // ---------- highlighted nutrients ----------
  function renderHighlights (box, logs) {
    day = compute(logs);
    box.textContent = '';
    const head = el('div', 'card-head');
    head.appendChild(el('h2', null, '✨ Highlighted nutrients'));
    const rep = el('button', 'link', 'Daily report ›'); rep.type = 'button'; rep.addEventListener('click', openReport);
    head.appendChild(rep);
    box.appendChild(head);
    if (!day.counted) {
      box.appendChild(el('p', 'muted small', 'No foods with full nutrition today yet. Foods from 🔎 search, 📷 scan or Cronometer include all their nutrients; carbs typed by hand don’t.'));
      return;
    }
    const grid = el('div', 'nr-grid');
    for (const k of highlighted()) {
      const n = N().BY[k]; if (!n) continue;
      const p = pctOf(k);
      const cell = el('button', 'nr-cell'); cell.type = 'button';
      const top = el('div', 'nr-top');
      top.appendChild(el('span', null, n.label.replace(/ \(.*\)/, '')));
      top.appendChild(el('b', p != null && good(k, p) ? 'ok' : null, p == null ? '–' : Math.round(p) + '%'));
      cell.appendChild(top);
      cell.appendChild(bar(k));
      cell.addEventListener('click', () => openDetail(k));
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    if (day.counted < day.total) box.appendChild(el('p', 'muted small', `From ${day.counted} of ${day.total} food logs. Carbs typed by hand don’t carry nutrients.`));
  }

  // ---------- sheets ----------
  let sheet = null;
  function openSheet (title) {
    if (!sheet) {
      sheet = el('div', 'modal sheet-modal'); sheet.id = 'nr-sheet'; sheet.hidden = true;
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'nr-title');
      sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet && !sheet.hidden) sheet.hidden = true; });
      document.body.appendChild(sheet);
    }
    sheet.textContent = '';
    const card = el('div', 'modal-card sheet-card');
    const h = el('div', 'sheet-head');
    const t = el('h2', null, title); t.id = 'nr-title'; t.tabIndex = -1;
    const x = el('button', 'link', 'Close'); x.type = 'button'; x.addEventListener('click', () => { sheet.hidden = true; });
    h.append(t, x); card.appendChild(h);
    sheet.appendChild(card);
    sheet.hidden = false;
    setTimeout(() => t.focus(), 0);
    return card;
  }

  function openDetail (k) {
    if (!day) return;
    const Nu = N(), n = Nu.BY[k];
    const card = openSheet(n.label);
    const tg = Nu.targets()[k], ul = Nu.UL[k], v = day.sum[k];
    const prof = Nu.DRI[C.S.driProfile];
    // the range bar: 0 → target → upper limit
    if (tg) {
      const max = ul ? ul * 1.15 : Math.max(tg * 1.6, (v || 0) * 1.1);
      const rb = el('div', 'nr-range');
      const track = el('div', 'nr-track');
      const green = el('span', 'nr-green'); green.style.left = (tg / max) * 100 + '%'; green.style.width = ((ul ? ul : max) - tg) / max * 100 + '%';
      track.appendChild(green);
      if (ul) { const red = el('span', 'nr-red'); red.style.left = (ul / max) * 100 + '%'; red.style.width = (100 - (ul / max) * 100) + '%'; track.appendChild(red); }
      const mark = el('span', 'nr-mark'); mark.style.left = Math.min(100, ((v || 0) / max) * 100) + '%'; track.appendChild(mark);
      rb.appendChild(track);
      const labels = el('div', 'nr-labels');
      const l0 = el('span', null, '0'); labels.appendChild(l0);
      const l1 = el('span', null, n.kind === 'max' ? 'Limit' : 'Target'); l1.style.left = (tg / max) * 100 + '%'; labels.appendChild(l1);
      if (ul) { const l2 = el('span', null, 'Upper limit'); l2.style.left = (ul / max) * 100 + '%'; labels.appendChild(l2); }
      rb.appendChild(labels);
      card.appendChild(rb);
    }
    const tbl = el('div', 'nr-table');
    const row = (a, b, strong) => { const r = el('div', 'nr-trow' + (strong ? ' strong' : '')); r.appendChild(el('span', null, a)); r.appendChild(el('b', null, b)); tbl.appendChild(r); };
    row('Today', v == null ? '–' : Nu.fmtN(v, n.unit), true);
    if (tg) row(n.kind === 'max' ? 'Keep under' : (prof ? 'Recommended (' + prof.label + ')' : 'Daily Value'), Nu.fmtN(tg, n.unit));
    if (ul) row('Safe upper limit', Nu.fmtN(ul, n.unit) + (/niacin|folate/.test(k) ? ' (from supplements / fortified foods)' : ''));
    if (tg && v != null) row('Of your target', Math.round((v / tg) * 100) + '%');
    card.appendChild(tbl);

    const src = sources(k);
    card.appendChild(el('h3', 'nr-h', 'Your top sources today'));
    if (!src.length) card.appendChild(el('p', 'muted small', 'Nothing logged with ' + n.label.toLowerCase() + ' today yet.'));
    else {
      const ul2 = el('div', 'nr-sources');
      for (const s of src.slice(0, 6)) {
        const r = el('div', 'nr-trow');
        r.appendChild(el('span', 'nr-src', s.name));
        r.appendChild(el('b', null, Nu.fmtN(s.v, n.unit) + (tg ? '  ' + Math.round((s.v / tg) * 100) + '%' : '')));
        ul2.appendChild(r);
      }
      card.appendChild(ul2);
    }
    if (Nu.FUNCTION[k]) { card.appendChild(el('h3', 'nr-h', 'What it does')); card.appendChild(el('p', null, Nu.FUNCTION[k])); }
    if (Nu.ADD[k]) { card.appendChild(el('h3', 'nr-h', 'Good sources')); card.appendChild(el('p', null, Nu.ADD[k].join(', ') + '.')); }
    // pick what's highlighted
    const hl = highlighted();
    const on = hl.includes(k);
    const tog = el('button', 'btn slim', on ? '★ Highlighted (tap to remove)' : '☆ Add to highlighted'); tog.type = 'button';
    tog.addEventListener('click', () => {
      const cur = highlighted().slice();
      C.S.nutHighlight = on ? cur.filter((x) => x !== k) : cur.concat([k]).slice(-10);
      C.saveSettings(); sheet.hidden = true;
      if (window.CGMHubFoodTab) window.CGMHubFoodTab.render();
    });
    card.appendChild(tog);
    card.appendChild(el('p', 'muted small', 'General nutrition info, not medical advice. A dietitian can set targets that fit you.'));
  }

  function openReport () {
    if (!day) return;
    const Nu = N();
    const card = openSheet('📋 Daily report');
    const t = Nu.targets();
    // overall score: how close you are to each "aim for" target, capped at 100% each
    const mins = Nu.NUTS.filter((n) => n.kind === 'min' && t[n.key] && day.sum[n.key] != null);
    if (mins.length) {
      const score = Math.round(mins.reduce((a, n) => a + Math.min(100, (day.sum[n.key] / t[n.key]) * 100), 0) / mins.length);
      const sc = el('div', 'nr-score');
      sc.appendChild(el('span', null, 'All targets'));
      sc.appendChild(el('b', null, score + '%'));
      card.appendChild(sc);
      const b = el('div', 'nr-bar big'); const f = el('span'); f.style.width = score + '%'; if (score >= 100) f.classList.add('ok'); b.appendChild(f); card.appendChild(b);
      card.appendChild(el('p', 'muted small', `Average of ${mins.length} nutrients you want enough of, each counted up to 100%. From ${day.counted} of ${day.total} food logs.`));
    }
    for (const [group, keys] of Nu.GROUPS) {
      const have = keys.filter((k) => day.sum[k] != null || t[k]);
      if (!have.length) continue;
      card.appendChild(el('h3', 'nr-h', group));
      for (const k of have) {
        const n = Nu.BY[k], v = day.sum[k];
        const r = el('button', 'nr-rrow' + (n.kind === 'ref' || !t[k] ? ' ref' : '') + (/^(satFat|monoFat|polyFat|transFat|cholesterol|fiber|sugars|addedSugars)$/.test(k) ? ' sub' : '')); r.type = 'button';
        const top = el('div', 'nr-top');
        top.appendChild(el('span', null, n.label + (t[k] && v != null ? '  ' : '')));
        top.appendChild(el('b', null, (v == null ? '–' : Nu.fmtN(v, n.unit)) + (t[k] ? ' / ' + Nu.fmtN(t[k], n.unit) : '')));
        r.appendChild(top);
        if (t[k]) { r.appendChild(bar(k)); const p = pctOf(k); if (p != null) r.appendChild(el('div', 'muted small', Math.round(p) + '%' + (n.kind === 'max' ? ' of your limit' : ''))); }
        r.addEventListener('click', () => openDetail(k));
        card.appendChild(r);
      }
      if (group === 'Carbohydrates' && day.sum.carbs != null) {
        const r = el('div', 'nr-rrow ref sub');
        const top = el('div', 'nr-top'); top.appendChild(el('span', null, 'Net carbs (carbs − fibre)')); top.appendChild(el('b', null, Nu.fmtN(Nu.netOf(day.sum), 'g')));
        r.appendChild(top); card.appendChild(r);
      }
    }
    card.appendChild(el('p', 'muted small', 'Targets: ' + (Nu.DRI[C.S.driProfile] ? Nu.DRI[C.S.driProfile].label + ' (Dietary Reference Intakes)' : 'standard label Daily Values') + '. Change in Settings → 🥗 Nutrition.'));
  }

  window.CGMHubNutReport = { renderHighlights, openDetail, openReport, compute };
})();
