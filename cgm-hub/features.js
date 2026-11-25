/* CGM Hub v2 features: food search + favourite meals, meds & supplements, period tracking, cycle trends.
 * Plugs into app.js through window.CGMHubCore. Everything logged is saved to Nightscout as a treatment.
 */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const DAYS_KEY = 'cgmhub.daystats.v1';
  const MAX_HISTORY_DAYS = 180;

  const store = {
    get (k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  };
  const nowLocalInput = () => C.toLocalInput(new Date());
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dateInputToNoon = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const saved = (kind) => '✅ Saved' + (C.S.demo ? ' (demo only)' : ' to Nightscout') + '.';

  // =====================================================================
  // Log sections
  // =====================================================================
  function showLogTab (name) {
    document.querySelectorAll('.logseg button[data-logtab]').forEach((b) => b.classList.toggle('on', b.dataset.logtab === name));
    document.querySelectorAll('[data-logpanel]').forEach((p) => { p.hidden = p.dataset.logpanel !== name; });
    if (name === 'period') { if (!$('period-date').value) $('period-date').value = dayKey(Date.now()); renderPeriodPanel(); }
  }
  document.querySelectorAll('.logseg button[data-logtab]').forEach((b) => b.addEventListener('click', () => showLogTab(b.dataset.logtab)));

  // =====================================================================
  // Food search (Open Food Facts) + meal basket + favourites
  // =====================================================================
  // items: {name, brand, n100 (nutrients per 100 g), units [{label, g}], unit, qty, grams, carbs (net or total), fixed}
  let basket = [];
  const N = () => window.CGMHubNutrition;

  // turn older saved items (favourites / recents) into the new shape
  function normalizeItem (it) {
    it = Object.assign({}, it);
    if (it.fixed || it.per100 == null && !it.n100) { it.fixed = true; it.totalCarbs = it.totalCarbs ?? it.carbs ?? 0; it.fiberG = it.fiberG || 0; return it; }
    if (!it.n100) {
      const m = it.m || {};
      it.n100 = { carbs: it.per100, fiber: m.fiber || undefined, kcal: m.kcal || undefined, fat: m.fat || undefined, protein: m.protein || undefined };
      Object.keys(it.n100).forEach((k) => it.n100[k] == null && delete it.n100[k]);
    }
    if (!Array.isArray(it.units) || !it.units.length) { it.units = N().unitsFrom({}); it.unit = 0; it.qty = it.grams || 100; }
    if (it.unit == null) it.unit = 0;
    if (!(it.qty > 0)) it.qty = 1;
    return it;
  }
  function recompute (it) {
    if (it.fixed) { it.carbs = N().carbMode() === 'net' ? Math.max(0, it.totalCarbs - (it.fiberG || 0)) : it.totalCarbs; return it; }
    const u = it.units[it.unit] || it.units[0];
    it.grams = it.qty * u.g;
    it.n = N().scaled(it.n100, it.grams);
    it.totalCarbs = it.n.carbs || 0;
    it.fiberG = it.n.fiber || 0;
    it.carbs = N().carbMode() === 'net' ? N().netOf(it.n) : it.totalCarbs;
    return it;
  }
  function mealNutrients () {
    const sum = {};
    for (const x of basket) {
      if (x.fixed) { sum.carbs = (sum.carbs || 0) + x.totalCarbs; if (x.fiberG) sum.fiber = (sum.fiber || 0) + x.fiberG; continue; }
      for (const k in x.n) sum[k] = (sum[k] || 0) + x.n[k];
    }
    return sum;
  }
  function basketTotal () { return Math.round(basket.reduce((s, x) => s + (x.carbs || 0), 0)); }
  function syncBasketToLog () {
    const total = basketTotal();
    $('log-carbs').value = basket.length ? total : $('log-carbs').value;
    if (basket.length) $('log-note').value = basket.map((x) => x.name).join(' + ').slice(0, 140);
    if (window.CGMHubDose) window.CGMHubDose.update('food');
  }
  // ---------- this meal: Cronometer-style macro bars, food rows, item editor ----------
  const MACROS = [['kcal', 'Energy', 'kcal', '#ff8a5b'], ['protein', 'Protein', 'g', '#5fd38d'], ['carbs', 'Carbs', 'g', '#3fc8d4'], ['fat', 'Fat', 'g', '#b57be0']];
  const r1 = (v) => Math.round(v * 10) / 10;
  function renderTotals () {
    const net = N().carbMode() === 'net';
    const n = mealNutrients();
    $('log-carbs-label').textContent = net ? 'Net carbs (g)' : 'Carbs (g)';
    const T = Object.assign({ kcal: 2000, carbs: 275, protein: 50, fat: 78, fiber: 28 }, N().targets()); // daily-value defaults when no target is set
    const box = $('macro-bars');
    box.textContent = '';
    for (const [k, label, unit, color] of MACROS) {
      let v = n[k], goal = T[k];
      let name = label;
      if (k === 'carbs' && net) { v = n.carbs != null ? Math.max(0, n.carbs - (n.fiber || 0)) : null; goal = goal ? goal - (T.fiber || 0) : goal; name = 'Net carbs'; }
      if (k === 'carbs' && v == null) v = basketTotal();
      const row = el('div', 'mb-row');
      const top = el('div', 'mb-top');
      const lab = el('span', 'mb-label'); lab.appendChild(el('b', null, name));
      lab.appendChild(document.createTextNode(' ' + (v == null ? '–' : (unit === 'kcal' ? Math.round(v) : r1(v))) + (goal ? ' / ' + Math.round(goal) : '') + ' ' + unit));
      top.appendChild(lab);
      top.appendChild(el('span', 'mb-pct', v != null && goal ? Math.round((v / goal) * 100) + '%' : ''));
      row.appendChild(top);
      const bar = el('div', 'mb-bar'); const f = el('span'); f.style.width = (v != null && goal ? Math.min(100, (v / goal) * 100) : 0) + '%'; f.style.background = color; bar.appendChild(f); row.appendChild(bar);
      box.appendChild(row);
    }
    box.appendChild(el('div', 'muted small', 'Bars show this meal against your daily targets (Settings → 🥗 Nutrition).'));
    const body = $('meal-facts-body');
    body.textContent = '';
    body.appendChild(N().factsPanel(n, { note: basket.some((x) => x.fixed) ? 'hand-typed foods only add carbs' : '' }));
  }
  let addOpen = false;
  function showAdd () { $('food-add').hidden = basket.length > 0 && !addOpen; $('add-food-btn').hidden = !basket.length || addOpen; }
  const portionText = (x) => {
    const u = x.units && x.units[x.unit];
    if (!u) return Math.round(x.grams || 0) + ' g';
    const q = Math.round(x.qty * 100) / 100;
    const lab = N().unitLabel(u);
    const g = Math.round(x.grams) + ' g';
    if (/^(g|100 g)$/.test(u.label)) return (q === 1 ? '' : q + ' × ') + lab;
    return q === 1 ? lab + (lab.includes(g) ? '' : ' · ' + g) : q + ' × ' + lab + ' = ' + g;
  };
  function renderBasket () {
    $('basket-card').hidden = !basket.length;
    const ul = $('basket');
    ul.textContent = '';
    basket.forEach((item, i) => {
      const li = el('li', 'diary-row tap');
      li.tabIndex = 0; li.setAttribute('role', 'button'); li.setAttribute('aria-label', 'Edit ' + item.name);
      li.appendChild(el('span', 'd-ic', item.fixed ? '✍️' : '🍎'));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', item.name));
      mid.appendChild(el('div', 'muted small', item.fixed ? 'typed by hand' : (item.brand ? item.brand + ' · ' : '') + portionText(item)));
      const gic = window.CGMHubGI && window.CGMHubGI.chip(el, window.CGMHubGI.forFood(item.name, item.carbs || 0));
      if (gic) mid.appendChild(gic);
      li.appendChild(mid);
      const right = el('div', 'right');
      const kcal = item.n && item.n.kcal != null ? Math.round(item.n.kcal) : null;
      right.appendChild(el('div', null, kcal != null ? kcal + ' kcal' : Math.round(item.carbs) + ' g'));
      right.appendChild(el('div', 'muted small', (N().carbMode() === 'net' ? 'net ' : '') + Math.round(item.carbs) + ' g carbs'));
      li.appendChild(right);
      const open = () => openItem(i);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      ul.appendChild(li);
    });
    renderTotals();
    showAdd();
  }
  function addToBasket (item) {
    basket.push(recompute(normalizeItem(item)));
    addOpen = false;
    $('food-results').textContent = ''; $('food-q').value = '';
    renderBasket();
    syncBasketToLog();
    $('basket-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // tap a food: Cronometer-style detail (amount, serving size, energy summary, all nutrients)
  let itemModal = null;
  function donut (n) {
    const p = (n.protein || 0) * 4, c = Math.max(0, (n.carbs || 0) - (n.fiber || 0)) * 4, f = (n.fat || 0) * 9;
    const tot = p + c + f;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 42 42'); svg.setAttribute('class', 'donut'); svg.setAttribute('aria-hidden', 'true');
    const ring = (color, frac, off) => { const ci = document.createElementNS(NS, 'circle'); ci.setAttribute('cx', 21); ci.setAttribute('cy', 21); ci.setAttribute('r', 15.9155); ci.setAttribute('fill', 'none'); ci.setAttribute('stroke', color); ci.setAttribute('stroke-width', 4); ci.setAttribute('stroke-dasharray', (frac * 100) + ' ' + (100 - frac * 100)); ci.setAttribute('stroke-dashoffset', 25 - off * 100); svg.appendChild(ci); };
    if (tot > 0) { ring('#5fd38d', p / tot, 0); ring('#3fc8d4', c / tot, p / tot); ring('#b57be0', f / tot, (p + c) / tot); } else ring('var(--line)', 1, 0);
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', 21); t.setAttribute('y', 22.5); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'donut-kcal'); t.textContent = n.kcal != null ? Math.round(n.kcal) : '–'; svg.appendChild(t);
    const t2 = document.createElementNS(NS, 'text'); t2.setAttribute('x', 21); t2.setAttribute('y', 28); t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('class', 'donut-sub'); t2.textContent = 'kcal'; svg.appendChild(t2);
    const wrap = el('div', 'energy');
    wrap.appendChild(svg);
    const ul = el('ul', 'energy-list');
    [['Protein', n.protein, p, '#5fd38d'], ['Net carbs', n.carbs != null ? Math.max(0, n.carbs - (n.fiber || 0)) : null, c, '#3fc8d4'], ['Fat', n.fat, f, '#b57be0']].forEach(([l, g, k, col]) => {
      const li = el('li'); const sp = el('span', null, l + (tot ? ' (' + Math.round((k / tot) * 100) + '%)' : '')); sp.style.color = col;
      li.appendChild(sp); li.appendChild(el('b', null, g == null ? '–' : r1(g) + ' g')); ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }
  function openItem (i) {
    const orig = basket[i];
    if (!orig) return;
    const it = JSON.parse(JSON.stringify(orig));
    if (!itemModal) {
      itemModal = el('div', 'modal sheet-modal'); itemModal.id = 'item-sheet'; itemModal.hidden = true;
      itemModal.setAttribute('role', 'dialog'); itemModal.setAttribute('aria-modal', 'true'); itemModal.setAttribute('aria-labelledby', 'item-title');
      itemModal.addEventListener('click', (e) => { if (e.target === itemModal) itemModal.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && itemModal && !itemModal.hidden) itemModal.hidden = true; });
      document.body.appendChild(itemModal);
    }
    itemModal.textContent = '';
    const card = el('div', 'modal-card sheet-card');
    const head = el('div', 'sheet-head');
    const h = el('h2', null, it.name); h.id = 'item-title'; h.tabIndex = -1;
    const x = el('button', 'link', 'Cancel'); x.type = 'button'; x.addEventListener('click', () => { itemModal.hidden = true; });
    head.append(h, x); card.appendChild(head);
    if (it.brand) card.appendChild(el('div', 'muted small', it.brand));
    const preview = el('div');
    const facts = el('details', 'bk-facts'); facts.appendChild(el('summary', null, '🧾 All nutrients')); const fbody = el('div'); facts.appendChild(fbody);
    const refresh = () => {
      recompute(it);
      preview.textContent = '';
      if (!it.fixed) {
        preview.appendChild(el('div', 'muted small center', 'Nutrition for ' + portionText(it)));
        preview.appendChild(donut(it.n));
        fbody.textContent = ''; fbody.appendChild(N().factsPanel(it.n));
      } else preview.appendChild(el('div', 'muted small', (N().carbMode() === 'net' ? 'Net carbs ' : 'Carbs ') + Math.round(it.carbs) + ' g'));
    };
    const form = el('div', 'item-form');
    if (it.fixed) {
      const mk = (label, key, step) => { const lab = el('label', 'field'); lab.appendChild(el('span', null, label)); const inp = el('input'); inp.type = key === 'name' ? 'text' : 'number'; if (step) { inp.step = step; inp.min = '0'; inp.inputMode = 'decimal'; } inp.value = it[key] != null ? it[key] : ''; inp.addEventListener('input', () => { it[key] = key === 'name' ? inp.value : Number(inp.value) || 0; refresh(); }); lab.appendChild(inp); form.appendChild(lab); };
      mk('Name', 'name'); mk('Carbs (g)', 'totalCarbs', '1'); mk('Fibre (g)', 'fiberG', '0.5');
    } else {
      const row = el('div', 'item-row');
      const ql = el('label', 'field'); ql.appendChild(el('span', null, 'Amount'));
      const q = el('input'); q.type = 'number'; q.inputMode = 'decimal'; q.min = '0'; q.step = 'any'; q.value = it.qty; q.id = 'item-qty'; ql.appendChild(q);
      const sl = el('label', 'field grow'); sl.appendChild(el('span', null, 'Serving size'));
      const sel = el('select'); sel.id = 'item-unit';
      it.units.forEach((u, k) => { const o = el('option', null, N().unitLabel(u) + (/^(g|oz|100 g)$/.test(u.label) ? '' : ' — ' + Math.round(u.g) + ' g')); o.value = k; if (k === it.unit) o.selected = true; sel.appendChild(o); });
      sl.appendChild(sel);
      q.addEventListener('input', () => { it.qty = Number(q.value) || 0; refresh(); });
      sel.addEventListener('change', () => { const g = it.grams, u = it.units[Number(sel.value)]; it.unit = Number(sel.value); it.qty = Math.max(0.25, Math.round((g / u.g) * 4) / 4); q.value = it.qty; refresh(); });
      row.append(ql, sl); form.appendChild(row);
    }
    card.appendChild(form);
    card.appendChild(preview);
    if (!it.fixed) card.appendChild(facts);
    const btns = el('div', 'edit-actions');
    const del = el('button', 'btn danger', '🗑️ Remove'); del.type = 'button';
    del.addEventListener('click', () => { basket.splice(i, 1); itemModal.hidden = true; renderBasket(); syncBasketToLog(); });
    const ok = el('button', 'btn primary', 'Save'); ok.type = 'button'; ok.id = 'item-save';
    ok.addEventListener('click', () => { basket[i] = recompute(it); itemModal.hidden = true; renderBasket(); syncBasketToLog(); });
    btns.append(del, ok); card.appendChild(btns);
    itemModal.appendChild(card);
    refresh();
    itemModal.hidden = false;
    h.focus();
  }
  $('add-food-btn').addEventListener('click', () => { addOpen = true; showAdd(); $('food-q').focus(); });

  // meal group: picked from the time of day, tap to change
  let mealGroup = null;
  function autoGroup () { const t = $('log-time').value ? new Date($('log-time').value) : new Date(); const h = t.getHours() + t.getMinutes() / 60; return h >= 4 && h < 10.5 ? 'Breakfast' : h >= 11 && h < 15 ? 'Lunch' : h >= 17 && h < 21.5 ? 'Dinner' : 'Snack'; }
  function renderGroups () { const g = mealGroup || autoGroup(); document.querySelectorAll('#meal-groups [data-meal]').forEach((b) => { const on = b.dataset.meal === g; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
  document.querySelectorAll('#meal-groups [data-meal]').forEach((b) => b.addEventListener('click', () => { mealGroup = b.dataset.meal; renderGroups(); }));
  function setMealGroup (g) { mealGroup = g; renderGroups(); }
  $('log-time').addEventListener('change', renderGroups);
  C.hooks.beforeLogSave.push((t) => { if (t.carbs || t.insulin) t.mealGroup = mealGroup || autoGroup(); });
  C.hooks.logSaved.push(() => { mealGroup = null; basket = []; addOpen = false; renderBasket(); renderGroups(); });

  // Food search: USDA FoodData Central (Open Food Facts' word search no longer works from web apps).
  // Values in search results are per 100 g. A free personal key (Settings) avoids the tiny shared DEMO_KEY limit.
  const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s,(/-])\S/g, (m) => m.toUpperCase());
  function fdcFood (f) {
    const n100 = N().fromFdc(f);
    if (n100.carbs == null) return null;
    const unit = String(f.servingSizeUnit || '').toLowerCase();
    const servingG = f.servingSize > 0 && /^(g|grm|ml|mlt)$/.test(unit) ? f.servingSize : 0;
    const units = N().unitsFrom({ servingText: f.householdServingFullText || '', servingG, measures: f.foodMeasures });
    const def = units.findIndex((u) => !/^(g|oz|100 g)$/.test(u.label));
    return {
      name: f.dataType === 'Branded' ? titleCase(f.description) : titleCase(f.description).replace(/, Raw$/, ''),
      brand: f.dataType === 'Branded' ? titleCase(f.brandName || f.brandOwner || '') : '',
      n100, units, unit: def >= 0 ? def : units.findIndex((u) => u.label === '100 g'), qty: 1,
      branded: f.dataType === 'Branded',
    };
  }
  async function searchFood (q) {
    const ul = $('food-results');
    ul.textContent = '';
    ul.appendChild(el('li', 'muted', 'Searching…'));
    const key = (C.S.fdcKey || '').trim() || 'DEMO_KEY';
    const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?' + new URLSearchParams({
      api_key: key, query: q, pageSize: '25', dataType: 'Foundation,SR Legacy,Survey (FNDDS),Branded',
    });
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status === 403) {
        throw new Error(key === 'DEMO_KEY'
          ? 'The shared food-search key is busy. Add your own free key in Settings → 🍎 Food search (takes a minute), or add the food by hand.'
          : 'Food search said no (' + res.status + '). Check your key in Settings → 🍎 Food search.');
      }
      if (!res.ok) throw new Error('Food search is having trouble (' + res.status + '). Try again in a minute.');
      const data = await res.json();
      // plain foods first, then brands; drop duplicates
      const seen = new Set();
      const items = (data.foods || []).map(fdcFood).filter((x) => x && !seen.has(x.name + x.brand) && seen.add(x.name + x.brand))
        .sort((a, b) => a.branded - b.branded).slice(0, 15);
      ul.textContent = '';
      if (!items.length) { ul.appendChild(el('li', 'muted', 'No matches with carb info. Try simpler words (e.g. “tortilla”), scan the barcode, or add it by hand.')); return; }
      for (const f of items) {
        const li = el('li');
        const mid = el('div', 'grow');
        mid.appendChild(el('div', 'title', f.name));
        const u0 = f.units[f.unit]; const n0 = N().scaled(f.n100, u0.g);
        mid.appendChild(el('div', 'muted small', [f.brand, N().unitLabel(u0) + ': ' + (N().carbMode() === 'net' ? 'net ' + Math.round(N().netOf(n0)) : Math.round(n0.carbs)) + ' g carbs' + (n0.kcal != null ? ' · ' + Math.round(n0.kcal) + ' kcal' : ''), f.units.length > 4 ? (f.units.length - 3) + ' portion sizes' : ''].filter(Boolean).join(' · ')));
        const gr = window.CGMHubGI && window.CGMHubGI.lookup(f.name);
        if (gr != null) mid.appendChild(window.CGMHubGI.chip(el, { gi: gr, giBand: window.CGMHubGI.giBand(gr) }, { noGl: true }));
        li.appendChild(mid);
        const add = el('button', null, '+ Add'); add.type = 'button';
        add.addEventListener('click', () => addToBasket({ name: f.name, brand: f.brand, n100: f.n100, units: f.units, unit: f.unit, qty: 1 }));
        li.appendChild(add);
        ul.appendChild(li);
      }
      ul.appendChild(el('li', 'muted small', 'Source: USDA FoodData Central. Check the grams match what you ate.'));
    } catch (e) {
      ul.textContent = '';
      ul.appendChild(el('li', 'muted', /key|busy|trouble|said no/.test(e.message) ? e.message : 'Couldn’t reach the food database. Check your connection, or add it by hand.'));
    }
  }

  // ---------- recent foods (one tap) ----------
  const RECENT_KEY = 'cgmhub.recentfoods.v1';
  const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } };
  function rememberFoods (items) {
    let list = recents();
    for (const it of items) {
      if (!it.name) continue;
      list = [Object.assign({}, it, { at: Date.now() })].concat(list.filter((x) => x.name.toLowerCase() !== it.name.toLowerCase()));
    }
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* ignore */ }
    renderRecents();
  }
  function renderRecents () {
    const box = $('recent-list');
    if (!box) return;
    box.textContent = '';
    const list = recents();
    $('recent-wrap').hidden = !list.length;
    for (const it of list) {
      const chip = el('button', 'chip', it.name);
      chip.type = 'button';
      chip.appendChild(el('small', null, Math.round(recompute(normalizeItem(it)).carbs) + 'g'));
      chip.addEventListener('click', () => addToBasket(Object.assign({}, it)));
      box.appendChild(chip);
    }
  }
  // ---------- barcode scanning ----------
  let scanStream = null, scanTimer = null;
  function closeScanner () {
    clearInterval(scanTimer); scanTimer = null;
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    $('scan-video').srcObject = null;
    $('scanner').hidden = true;
  }
  async function lookupBarcode (code) {
    code = String(code).replace(/\D/g, '');
    if (code.length < 6) { $('scan-status').textContent = 'That barcode looks too short.'; return; }
    $('scan-status').textContent = 'Looking up ' + code + '…';
    try {
      const res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=product_name,brands,nutriments,serving_quantity,serving_size');
      const data = res.ok ? await res.json() : null;
      const p = data && data.product;
      if (!p || data.status === 0) { $('scan-status').textContent = 'Not found in the food database. Try searching by name, or add it by hand.'; return; }
      const per100 = p.nutriments && p.nutriments.carbohydrates_100g;
      if (per100 == null) { $('scan-status').textContent = 'Found “' + (p.product_name || code) + '”, but it has no carb info. Add it by hand.'; $('qa-name').value = p.product_name || ''; return; }
      const units = N().unitsFrom({ servingText: p.serving_size || '', servingG: Number(p.serving_quantity) || 0 });
      const def = units.findIndex((u) => !/^(g|oz|100 g)$/.test(u.label));
      closeScanner();
      addToBasket({ name: p.product_name || 'Scanned item', brand: (p.brands || '').split(',')[0], n100: N().fromOff(p.nutriments), units, unit: def >= 0 ? def : units.findIndex((u) => u.label === '100 g'), qty: 1 });
    } catch (e) {
      $('scan-status').textContent = 'Couldn’t reach the food database. Check your connection.';
    }
  }
  // in the Android app: Google's scanner (fast, needs no camera permission)
  const nativeScan = () => { const cap = window.Capacitor; return cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.BarcodeScan; };
  async function openScanner () {
    $('scanner').hidden = false;
    $('scan-code').value = '';
    const NS = nativeScan();
    if (NS) {
      $('scan-video').hidden = true;
      $('scan-status').textContent = 'Opening the scanner…';
      try {
        const r = await NS.scan();
        if (r && r.code) { lookupBarcode(r.code); return; }
        $('scan-status').textContent = 'Scan cancelled. Tap 📷 to try again, or type the numbers under the barcode.';
        return;
      } catch (e) { /* fall back to the in-page camera */ }
    }
    const supported = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    $('scan-video').hidden = !supported;
    if (!supported) { $('scan-status').textContent = 'Camera scanning isn’t supported in this browser (it works in Chrome on Android). Type the numbers under the barcode instead.'; return; }
    $('scan-status').textContent = 'Point your camera at the barcode…';
    try {
      const formats = (await BarcodeDetector.getSupportedFormats()).filter((f) => ['ean_13', 'ean_8', 'upc_a', 'upc_e'].includes(f));
      const detector = new BarcodeDetector({ formats: formats.length ? formats : undefined });
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = $('scan-video');
      v.srcObject = scanStream;
      await v.play();
      scanTimer = setInterval(async () => {
        if (!scanStream || v.readyState < 2) return;
        try {
          const codes = await detector.detect(v);
          if (codes.length) { clearInterval(scanTimer); scanTimer = null; if (navigator.vibrate) navigator.vibrate(60); lookupBarcode(codes[0].rawValue); }
        } catch (e) { /* keep trying */ }
      }, 300);
    } catch (e) {
      $('scan-video').hidden = true;
      const app = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      $('scan-status').textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission is off. ' + (app ? 'Turn it on in Android Settings → Apps → CGM Hub → Permissions → Camera.' : 'Allow the camera for this site in your browser settings.') + ' Or type the numbers under the barcode.'
        : 'Couldn’t open the camera. Type the numbers under the barcode instead.';
    }
  }
  $('scan-open').addEventListener('click', openScanner);
  $('scan-close').addEventListener('click', closeScanner);
  $('scan-form').addEventListener('submit', (ev) => { ev.preventDefault(); lookupBarcode($('scan-code').value); });
  C.hooks.view.push((v) => { if (v !== 'log') closeScanner(); });

  $('food-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('food-q').value.trim();
    if (q.length >= 2) searchFood(q);
    $('food-q').blur();
  });
  $('qa-add').addEventListener('click', () => {
    const name = $('qa-name').value.trim() || 'Food';
    const carbs = Number($('qa-carbs').value);
    if (!(carbs >= 0) || $('qa-carbs').value === '') { $('qa-carbs').focus(); return; }
    addToBasket({ name, fixed: true, totalCarbs: carbs, fiberG: Number($('qa-fiber').value) || 0 });
    $('qa-name').value = ''; $('qa-carbs').value = ''; $('qa-fiber').value = '';
  });
  $('basket-clear').addEventListener('click', () => { basket = []; addOpen = false; renderBasket(); $('log-carbs').value = ''; $('log-note').value = ''; if (window.CGMHubDose) window.CGMHubDose.update('food'); });

  function favs () { return Array.isArray(C.S.meals) ? C.S.meals : []; }
  // load a favourite into the meal; the note is the favourite's name so "The usual" can find it again
  function useFav (m) {
    basket = (m.items || []).map((x) => recompute(normalizeItem(x)));
    renderBasket(); syncBasketToLog();
    $('log-note').value = m.name;
  }
  function renderFavs () {
    const box = $('fav-list');
    box.textContent = '';
    const list = favs();
    $('fav-wrap').hidden = !list.length;
    list.forEach((m, i) => {
      const chip = el('button', 'chip', m.name);
      chip.type = 'button';
      chip.appendChild(el('small', null, Math.round(m.carbs) + 'g'));
      chip.addEventListener('click', () => useFav(m));
      chip.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (confirm('Remove “' + m.name + '” from favourites?')) { C.S.meals = favs().filter((_, j) => j !== i); C.saveSettings(); renderFavs(); }
      });
      box.appendChild(chip);
    });
  }
  $('fav-save').addEventListener('click', () => {
    if (!basket.length) return;
    const name = (prompt('Name this meal:', basket.map((x) => x.name).join(' + ').slice(0, 40)) || '').trim();
    if (!name) return;
    C.S.meals = favs().filter((m) => m.name !== name).concat([{ name, carbs: basketTotal(), items: basket.map((x) => ({ name: x.name, brand: x.brand, n100: x.n100, units: x.units, unit: x.unit, qty: x.qty, fixed: x.fixed, totalCarbs: x.totalCarbs, fiberG: x.fiberG })) }]);
    C.saveSettings();
    renderFavs();
  });
  C.hooks.beforeLogSave.push((t) => {
    if (!basket.length || !t.carbs) return;
    const n = mealNutrients();
    const r = (v) => Math.round(v * 100) / 100;
    t.nutrients = {}; for (const k in n) t.nutrients[k] = r(n[k]);
    t.carbMode = N().carbMode();
    t.foods = basket.map((x) => {
      const fn = {}; if (x.n) for (const k in x.n) if (typeof x.n[k] === 'number') fn[k] = r(x.n[k]);
      return { name: x.name, carbs: Math.round((x.carbs || 0) * 10) / 10, kcal: x.n && x.n.kcal != null ? Math.round(x.n.kcal) : null, n: fn };
    });
    if (n.carbs != null) t.totalCarbs = r(n.carbs);
    if (n.kcal) t.calories = Math.round(n.kcal);
    if (n.fat) t.fat = r(n.fat);
    if (n.protein) t.protein = r(n.protein);
    if (n.fiber) t.fiber = r(n.fiber);
    rememberFoods(basket.map((x) => ({ name: x.name, brand: x.brand, n100: x.n100, units: x.units, unit: x.unit, qty: x.qty, fixed: x.fixed, totalCarbs: x.totalCarbs, fiberG: x.fiberG, carbs: x.carbs })));
  });
  C.hooks.beforeLogSave.push((t) => { if (!basket.length && t.carbs && t.notes) rememberFoods([{ name: t.notes, fixed: true, totalCarbs: t.carbs, carbs: t.carbs }]); });

  // ---------- water + exercise ----------
  async function quickLog (t, msgEl, text) {
    try {
      await C.apiPostTreatment(Object.assign({ created_at: new Date().toISOString(), enteredBy: 'CGM Hub' }, t));
      C.showMsg(msgEl, '✅ ' + text + (C.S.demo ? ' (demo only)' : ''), 'ok');
      await C.refresh(false);
    } catch (e) { C.showMsg(msgEl, e.message, 'danger'); }
  }
  // long-acting (basal) insulin: kept out of insulin-on-board, counted in the insulin tiles
  function fillBasal () {
    $('basal-name').value = C.S.basalName || '';
    if (!$('basal-units').value && C.S.basalUnits) $('basal-units').value = C.S.basalUnits;
    $('basal-time').value = nowLocalInput();
  }
  $('basal-save').addEventListener('click', async () => {
    const units = Number($('basal-units').value);
    if (!(units > 0)) { $('basal-units').focus(); return; }
    if (units > 100) { C.showMsg('basal-msg', 'That’s over 100 units. Please double-check.', 'warn'); return; }
    const name = $('basal-name').value.trim() || 'Long-acting insulin';
    const when = $('basal-time').value ? new Date($('basal-time').value) : new Date();
    C.S.basalName = name; C.S.basalUnits = units; C.saveSettings();
    try {
      await C.apiPostTreatment({ eventType: 'Basal Injection', insulin: units, insulinType: name, notes: name + ' ' + units + 'u', created_at: when.toISOString(), enteredBy: 'CGM Hub' });
      C.showMsg('basal-msg', '✅ ' + name + ' ' + units + 'u logged' + (C.S.demo ? ' (demo only)' : '') + '.', 'ok');
      fillBasal();
      await C.refresh(false);
    } catch (e) { C.showMsg('basal-msg', e.message, 'danger'); }
  });
  C.hooks.view.push((v) => { if (v === 'log') fillBasal(); });

  document.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => {
    const ml = Number(b.dataset.water);
    quickLog({ eventType: 'Water', water: ml, notes: ml + ' ml water' }, 'wx-msg', ml + ' ml water logged 💧');
  }));
  $('ex-save').addEventListener('click', () => {
    const mins = Number($('ex-mins').value);
    if (!(mins > 0)) { $('ex-mins').focus(); return; }
    const kind = $('ex-kind').value;
    quickLog({ eventType: 'Exercise', duration: mins, notes: kind + ' (' + mins + ' min)' }, 'ex-msg', mins + ' min ' + kind.toLowerCase() + ' logged 🏃');
    $('ex-mins').value = '';
  });

  // =====================================================================
  // Period tracking + cycle model
  // =====================================================================
  const PHASES = [
    { key: 'menstrual', name: '🩸 Period' },
    { key: 'follicular', name: '🌱 Follicular' },
    { key: 'ovulation', name: '🥚 Ovulation' },
    { key: 'luteal', name: '🌙 Luteal' },
  ];
  const phaseName = (k) => (PHASES.find((p) => p.key === k) || {}).name || k;

  function cycleModel () {
    const evs = C.periods.slice().sort((a, b) => a.t - b.t);
    const startsRaw = evs.filter((e) => e.kind === 'period-start').map((e) => startOfDay(e.t));
    const starts = startsRaw.filter((t, i, a) => i === 0 || t - a[i - 1] > 10 * DAY); // ignore double taps
    const ends = evs.filter((e) => e.kind === 'period-end').map((e) => startOfDay(e.t));
    const gaps = [];
    for (let i = 1; i < starts.length; i++) {
      const g = Math.round((starts[i] - starts[i - 1]) / DAY);
      if (g >= 18 && g <= 45) gaps.push(g);
    }
    const avgLen = gaps.length ? Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length) : 28;
    const plens = [];
    const cycles = starts.map((st, i) => {
      const end = ends.find((e) => e >= st && e - st <= 12 * DAY);
      const pl = end != null ? Math.round((end - st) / DAY) + 1 : null;
      if (pl) plens.push(pl);
      const next = starts[i + 1];
      const len = next ? Math.round((next - st) / DAY) : avgLen;
      return { start: st, end, pl, len, complete: !!next };
    });
    const avgPl = plens.length ? Math.round(plens.reduce((s, x) => s + x, 0) / plens.length) : 5;
    cycles.forEach((c) => { if (!c.pl) c.pl = avgPl; });
    return { cycles, avgLen, avgPl, nCycles: gaps.length };
  }
  function phaseAt (t, model) {
    const day0 = startOfDay(t);
    let c = null;
    for (const cy of model.cycles) if (cy.start <= day0) c = cy;
    if (!c) return null;
    const cd = Math.round((day0 - c.start) / DAY) + 1;
    if (cd > 45) return null; // no period logged for too long
    const len = Math.max(c.len, cd);
    const ov = Math.max(c.pl + 3, Math.round(c.len - 14));
    let phase;
    if (cd <= c.pl) phase = 'menstrual';
    else if (cd <= ov - 2) phase = 'follicular';
    else if (cd <= ov + 1) phase = 'ovulation';
    else phase = 'luteal';
    return { cycleDay: cd, phase, cycle: c, len };
  }

  function renderCycleChip () {
    const chip = $('cycle-chip');
    const m = cycleModel();
    const p = m.cycles.length ? phaseAt(Date.now(), m) : null;
    chip.hidden = !p;
    if (p) chip.textContent = 'Cycle day ' + p.cycleDay + ' · ' + phaseName(p.phase).replace(/^\S+\s/, '');
  }

  function renderPeriodPanel () {
    const m = cycleModel();
    const p = m.cycles.length ? phaseAt(Date.now(), m) : null;
    if (p) {
      const nextIn = m.avgLen - p.cycleDay + 1;
      $('period-now').textContent = `Day ${p.cycleDay} · ${phaseName(p.phase)} · ` + (nextIn > 0 ? `next period in ~${nextIn} days` : 'period expected about now');
    } else {
      $('period-now').textContent = m.cycles.length ? 'No period logged in the last 45 days.' : 'Log the first day of your period to start.';
    }
    const ul = $('period-list');
    ul.textContent = '';
    const recent = m.cycles.slice().reverse().slice(0, 8);
    if (!recent.length) ul.appendChild(el('li', 'empty', 'No periods logged yet.'));
    for (const c of recent) {
      const li = el('li');
      li.appendChild(el('span', 'ic other', '🩸'));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', fmtDate(c.start) + (c.end ? ' – ' + fmtDate(c.end) : '')));
      mid.appendChild(el('div', 'muted small', (c.end ? c.pl + ' days' : 'end not logged') + (c.complete ? ' · cycle ' + c.len + ' days' : ' · current cycle')));
      li.appendChild(mid);
      ul.appendChild(li);
    }
  }
  async function logPeriod (kind) {
    const v = $('period-date').value;
    if (!v) { $('period-date').focus(); return; }
    const when = dateInputToNoon(v);
    if (when.getTime() > Date.now() + DAY) { C.showMsg('period-msg', 'That date is in the future.', 'warn'); return; }
    const btn = $(kind === 'start' ? 'period-start' : 'period-end');
    btn.disabled = true;
    try {
      await C.apiPostTreatment({
        eventType: kind === 'start' ? 'Period Start' : 'Period End', created_at: when.toISOString(),
        notes: kind === 'start' ? 'Period started' : 'Period ended', enteredBy: 'CGM Hub',
      });
      C.showMsg('period-msg', saved(), 'ok');
      await C.refresh(true);
      renderPeriodPanel();
    } catch (e) { C.showMsg('period-msg', e.message, 'danger'); }
    btn.disabled = false;
  }
  $('period-start').addEventListener('click', () => logPeriod('start'));
  $('period-end').addEventListener('click', () => logPeriod('end'));

  // =====================================================================
  // Daily glucose summaries (cached on the phone) for cycle trends
  // =====================================================================
  let building = false;
  function thresholdKey () { return Math.round(C.toMg(C.S.low)) + '-' + Math.round(C.toMg(C.S.high)) + (C.S.demo ? '-demo' : '') + '|' + C.S.url; }
  function loadDays () {
    const d = store.get(DAYS_KEY, null);
    return d && d.key === thresholdKey() ? d : { key: thresholdKey(), days: {} };
  }
  function summarize (list) {
    const lo = C.toMg(C.S.low), hi = C.toMg(C.S.high);
    const s = { n: 0, sum: 0, lo: 0, hi: 0 };
    for (const e of list) { s.n++; s.sum += e.mg; if (e.mg < lo) s.lo++; else if (e.mg > hi) s.hi++; }
    return s;
  }
  function demoDay (t, model) {
    // fake: a bit higher in the luteal phase so the demo shows an insight
    const p = phaseAt(t, model);
    const bump = p ? { menstrual: 8, follicular: -6, ovulation: 0, luteal: 22 }[p.phase] : 0;
    const mean = 135 + bump + (Math.sin(t / DAY) * 6);
    const n = 288;
    return { n, sum: mean * n, lo: Math.round(n * 0.03), hi: Math.round(n * (0.12 + bump / 200)) };
  }
  async function buildHistory () {
    if (building) return;
    const model = cycleModel();
    if (!model.cycles.length) { renderTrends(); return; }
    building = true;
    const cache = loadDays();
    const today0 = startOfDay(Date.now());
    const first = Math.max(model.cycles[0].start, today0 - MAX_HISTORY_DAYS * DAY);
    const todo = [];
    for (let t = first; t < today0; t += DAY) {
      const k = dayKey(t + 12 * HOUR);
      if (!cache.days[k]) todo.push(t);
    }
    let done = 0;
    const total = todo.length;
    const progress = () => { $('phase-progress').textContent = total && done < total ? `Building your history… ${done}/${total} days` : ' '; };
    progress();
    const loadedFrom = C.entries.length ? C.entries[C.entries.length - 1].t : Infinity;
    async function one (t) {
      const k = dayKey(t + 12 * HOUR);
      let s;
      if (C.S.demo) s = demoDay(t, model);
      else if (t >= loadedFrom) s = summarize(C.entries.filter((e) => e.t >= t && e.t < t + DAY));
      else {
        const ents = await C.apiGet('/api/v1/entries/sgv.json', { 'find[date][$gte]': String(t), 'find[date][$lt]': String(t + DAY), count: '2000' });
        s = summarize(ents.filter((e) => typeof e.sgv === 'number' && e.sgv >= 20).map((e) => ({ mg: e.sgv })));
      }
      cache.days[k] = s;
    }
    try {
      for (let i = 0; i < todo.length; i += 3) {
        await Promise.all(todo.slice(i, i + 3).map(one));
        done = Math.min(total, i + 3);
        progress();
        if (done % 15 === 0 || done === total) { store.set(DAYS_KEY, cache); renderTrends(); }
      }
    } catch (e) {
      $('phase-progress').textContent = '⚠️ Couldn’t load all your history: ' + e.message;
    } finally {
      store.set(DAYS_KEY, cache);
      building = false;
      renderTrends();
    }
  }

  function renderTrends () {
    const model = cycleModel();
    const stats = $('cycle-stats');
    stats.textContent = '';
    const p = model.cycles.length ? phaseAt(Date.now(), model) : null;
    function tile (label, value, sub) {
      const t = el('div', 'tile');
      t.appendChild(el('div', 't-label', label));
      t.appendChild(el('div', 't-value', value));
      t.appendChild(el('div', 't-sub', sub || ''));
      stats.appendChild(t);
    }
    tile('Cycle day', p ? String(p.cycleDay) : '–', p ? phaseName(p.phase) : 'log a period');
    tile('Avg cycle', model.nCycles ? model.avgLen + 'd' : '–', model.nCycles ? 'from ' + model.nCycles + ' cycle' + (model.nCycles > 1 ? 's' : '') : 'needs 2 periods');
    const nextIn = p ? model.avgLen - p.cycleDay + 1 : null;
    tile('Next period', p ? (nextIn > 0 ? '~' + nextIn + 'd' : 'now') : '–', p ? 'estimate' : '');

    const rowsBox = $('phase-rows'), ins = $('phase-insights');
    rowsBox.textContent = ''; ins.textContent = '';
    if (!model.cycles.length) {
      ins.appendChild(el('p', 'muted', 'Log your period (Log → 🩸 Period) and this will start filling in.'));
      return;
    }
    // today live + cached days
    const cache = loadDays();
    const today0 = startOfDay(Date.now());
    const days = Object.assign({}, cache.days);
    days[dayKey(Date.now())] = C.S.demo ? demoDay(today0, model) : summarize(C.entries.filter((e) => e.t >= today0));
    const agg = {};
    PHASES.forEach((ph) => { agg[ph.key] = { n: 0, sum: 0, lo: 0, hi: 0, days: 0 }; });
    let allN = 0, allSum = 0;
    for (const [k, s] of Object.entries(days)) {
      if (!s || !s.n || s.n < 24) continue; // skip days with very little data
      const [y, m, d] = k.split('-').map(Number);
      const ph = phaseAt(new Date(y, m - 1, d, 12).getTime(), model);
      if (!ph) continue;
      const a = agg[ph.phase];
      a.n += s.n; a.sum += s.sum; a.lo += s.lo; a.hi += s.hi; a.days++;
      allN += s.n; allSum += s.sum;
    }
    const allMean = allN ? allSum / allN : null;
    const fmtDiff = (mg) => (C.mmol() ? (Math.abs(mg) / C.MGDL_PER_MMOL).toFixed(1) : String(Math.round(Math.abs(mg)))) + ' ' + C.unitLabel();

    let insightCount = 0;
    for (const ph of PHASES) {
      const a = agg[ph.key];
      const row = el('div', 'phase-row' + (p && p.phase === ph.key ? ' current' : ''));
      const head = el('div', 'ph-head');
      head.appendChild(el('span', 'ph-name', ph.name));
      if (a.n) {
        const mean = a.sum / a.n;
        head.appendChild(el('span', 'ph-avg', 'avg ' + C.fmtBG(mean) + ' · ' + a.days + ' day' + (a.days === 1 ? '' : 's')));
        row.appendChild(head);
        const pLow = (a.lo / a.n) * 100, pHigh = (a.hi / a.n) * 100, pIn = 100 - pLow - pHigh;
        const bar = el('div', 'split');
        [['s-low', pLow], ['s-in', pIn], ['s-high', pHigh]].forEach(([c, v]) => { if (v > 0) { const sp = el('span', c); sp.style.width = v + '%'; bar.appendChild(sp); } });
        bar.setAttribute('aria-label', `${ph.name}: low ${Math.round(pLow)}%, in range ${Math.round(pIn)}%, high ${Math.round(pHigh)}%`);
        row.appendChild(bar);
        const labels = el('div', 'split-labels');
        labels.appendChild(el('span', null, '🔻 ' + Math.round(pLow) + '%'));
        labels.appendChild(el('span', null, '✅ ' + Math.round(pIn) + '% in range'));
        labels.appendChild(el('span', null, '🔺 ' + Math.round(pHigh) + '%'));
        row.appendChild(labels);
        const diff = mean - allMean;
        if (a.days >= 3 && Math.abs(diff) >= 9) {
          insightCount++;
          ins.appendChild(el('div', 'insight', `${diff > 0 ? '📈' : '📉'} In your ${ph.name.replace(/^\S+\s/, '').toLowerCase()} phase you average ${fmtDiff(diff)} ${diff > 0 ? 'higher' : 'lower'} than usual (${a.days} days of data).`));
        }
      } else {
        head.appendChild(el('span', 'ph-avg', 'no data yet'));
        row.appendChild(head);
      }
      rowsBox.appendChild(row);
    }
    if (!insightCount) {
      const enough = PHASES.every((ph) => agg[ph.key].days >= 3);
      ins.appendChild(el('p', 'muted small', enough ? 'No big differences between phases so far. 👍' : 'Patterns show up here once there are at least 3 days of glucose data in a phase. Keep logging!'));
    }
  }

  // =====================================================================
  // hooks
  // =====================================================================
  C.hooks.render.push(() => {
    renderCycleChip();
    if (!$('view-log').hidden) {
      if (!document.querySelector('[data-logpanel="period"]').hidden) renderPeriodPanel();
    }
    if (!$('view-trends').hidden) { renderTrends(); if (!historyTried && C.periods.length) { historyTried = true; buildHistory(); } }
  });
  let historyTried = false;
  C.hooks.view.push((view) => {
    if (view === 'log') renderFavs();
    if (view === 'trends') { renderTrends(); if (C.periods.length) historyTried = true; buildHistory(); }
  });
  renderFavs();
  renderRecents();
  $('set-fdc').value = C.S.fdcKey || '';
  $('set-fdc-save').addEventListener('click', () => { C.S.fdcKey = $('set-fdc').value.trim(); C.saveSettings(); C.showMsg('fdc-msg', C.S.fdcKey ? '✅ Saved. Food search will use your key.' : 'Cleared. Using the shared key.', 'ok'); });
  window.CGMHubFeatures = { favs, useFav, renderGroups, setMealGroup, showLogTab, cycleModel, phaseAt, renderPeriodPanel, phaseName };
})();
