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
    if (name === 'meds') { $('med-time').value = nowLocalInput(); renderMeds(); }
    if (name === 'period') { if (!$('period-date').value) $('period-date').value = dayKey(Date.now()); renderPeriodPanel(); }
  }
  document.querySelectorAll('.logseg button[data-logtab]').forEach((b) => b.addEventListener('click', () => showLogTab(b.dataset.logtab)));

  // =====================================================================
  // Food search (Open Food Facts) + meal basket + favourites
  // =====================================================================
  let basket = []; // [{name, grams, per100, carbs}]  per100 null = fixed carbs

  function macros100 (n) {
    const g = (k) => { const v = Number(n && n[k]); return isNaN(v) ? 0 : v; };
    return { kcal: g('energy-kcal_100g') || g('energy_100g') / 4.184, fat: g('fat_100g'), protein: g('proteins_100g'), fiber: g('fiber_100g') };
  }
  function basketMacros () {
    const m = { calories: 0, fat: 0, protein: 0, fiber: 0 };
    for (const x of basket) {
      if (!x.m || !x.grams) continue;
      const f = x.grams / 100;
      m.calories += x.m.kcal * f; m.fat += x.m.fat * f; m.protein += x.m.protein * f; m.fiber += x.m.fiber * f;
    }
    return m;
  }
  function basketTotal () { return Math.round(basket.reduce((s, x) => s + (x.carbs || 0), 0)); }
  function syncBasketToLog () {
    const total = basketTotal();
    $('log-carbs').value = basket.length ? total : $('log-carbs').value;
    if (basket.length) $('log-note').value = basket.map((x) => x.name).join(' + ').slice(0, 140);
  }
  function renderBasket () {
    $('basket-card').hidden = !basket.length;
    const ul = $('basket');
    ul.textContent = '';
    basket.forEach((item, i) => {
      const li = el('li');
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', item.name));
      mid.appendChild(el('div', 'muted small', item.per100 != null ? `${item.per100} g carbs per 100 g` : 'carbs entered by hand'));
      li.appendChild(mid);
      if (item.per100 != null) {
        const g = el('input'); g.type = 'number'; g.inputMode = 'decimal'; g.min = '0'; g.value = item.grams;
        g.setAttribute('aria-label', 'Grams of ' + item.name);
        g.addEventListener('input', () => {
          item.grams = Number(g.value) || 0;
          item.carbs = (item.per100 * item.grams) / 100;
          carbsEl.textContent = Math.round(item.carbs) + ' g';
          $('basket-total').textContent = basketTotal();
          syncBasketToLog();
        });
        li.appendChild(g);
        li.appendChild(el('span', 'muted small', 'g'));
      }
      const carbsEl = el('span', 'carbs', Math.round(item.carbs) + ' g');
      li.appendChild(carbsEl);
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove ' + item.name);
      del.addEventListener('click', () => { basket.splice(i, 1); renderBasket(); syncBasketToLog(); });
      li.appendChild(del);
      ul.appendChild(li);
    });
    $('basket-total').textContent = basketTotal();
  }
  function addToBasket (item) {
    basket.push(item);
    renderBasket();
    syncBasketToLog();
    $('basket-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function searchFood (q) {
    const ul = $('food-results');
    ul.textContent = '';
    ul.appendChild(el('li', 'muted', 'Searching…'));
    const url = 'https://world.openfoodfacts.org/cgi/search.pl?' + new URLSearchParams({
      search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: '20',
      fields: 'code,product_name,brands,nutriments,serving_quantity,serving_size',
    });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Food search is busy (' + res.status + '). Try again in a minute.');
      const data = await res.json();
      const items = (data.products || [])
        .filter((p) => p.product_name && p.nutriments && p.nutriments.carbohydrates_100g != null)
        .slice(0, 12);
      ul.textContent = '';
      if (!items.length) { ul.appendChild(el('li', 'muted', 'No matches with carb info. Try other words, or add it by hand below.')); return; }
      for (const p of items) {
        const per100 = Math.round(Number(p.nutriments.carbohydrates_100g) * 10) / 10;
        const serving = Number(p.serving_quantity) > 0 ? Math.round(Number(p.serving_quantity)) : 100;
        const li = el('li');
        const mid = el('div', 'grow');
        mid.appendChild(el('div', 'title', p.product_name));
        mid.appendChild(el('div', 'muted small', [p.brands && p.brands.split(',')[0], per100 + ' g carbs / 100 g', p.serving_size ? 'serving ' + p.serving_size : ''].filter(Boolean).join(' · ')));
        li.appendChild(mid);
        const add = el('button', null, '+ Add'); add.type = 'button';
        add.addEventListener('click', () => addToBasket({ name: p.product_name, grams: serving, per100, carbs: (per100 * serving) / 100, m: macros100(p.nutriments) }));
        li.appendChild(add);
        ul.appendChild(li);
      }
    } catch (e) {
      ul.textContent = '';
      ul.appendChild(el('li', 'muted', e.message && /busy/.test(e.message) ? e.message : 'Couldn’t reach the food database. Check your connection, or add it by hand below.'));
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
      const serving = Number(p.serving_quantity) > 0 ? Math.round(Number(p.serving_quantity)) : 100;
      const c = Math.round(Number(per100) * 10) / 10;
      closeScanner();
      addToBasket({ name: p.product_name || 'Scanned item', grams: serving, per100: c, carbs: (c * serving) / 100, m: macros100(p.nutriments) });
    } catch (e) {
      $('scan-status').textContent = 'Couldn’t reach the food database. Check your connection.';
    }
  }
  async function openScanner () {
    $('scanner').hidden = false;
    $('scan-code').value = '';
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
      $('scan-status').textContent = 'Couldn’t open the camera (permission blocked?). Type the barcode numbers instead.';
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
    addToBasket({ name, grams: null, per100: null, carbs });
    $('qa-name').value = ''; $('qa-carbs').value = '';
  });
  $('basket-clear').addEventListener('click', () => { basket = []; renderBasket(); $('log-carbs').value = ''; $('log-note').value = ''; });

  function favs () { return Array.isArray(C.S.meals) ? C.S.meals : []; }
  function renderFavs () {
    const box = $('fav-list');
    box.textContent = '';
    const list = favs();
    $('fav-wrap').hidden = !list.length;
    list.forEach((m, i) => {
      const chip = el('button', 'chip', m.name);
      chip.type = 'button';
      chip.appendChild(el('small', null, Math.round(m.carbs) + 'g'));
      chip.addEventListener('click', () => {
        basket = m.items.map((x) => Object.assign({}, x));
        renderBasket(); syncBasketToLog();
      });
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
    C.S.meals = favs().filter((m) => m.name !== name).concat([{ name, carbs: basketTotal(), items: basket.map((x) => Object.assign({}, x)) }]);
    C.saveSettings();
    renderFavs();
  });
  C.hooks.beforeLogSave.push((t) => {
    if (!basket.length || !t.carbs) return;
    const m = basketMacros();
    if (m.calories) t.calories = Math.round(m.calories);
    if (m.fat) t.fat = Math.round(m.fat);
    if (m.protein) t.protein = Math.round(m.protein);
    if (m.fiber) t.fiber = Math.round(m.fiber);
  });
  C.hooks.logSaved.push(() => { basket = []; renderBasket(); });

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
    quickLog({ eventType: 'Exercise', duration: mins, notes: kind + ' (' + mins + ' min)' }, 'wx-msg', mins + ' min ' + kind.toLowerCase() + ' logged 🏃');
    $('ex-mins').value = '';
  });

  // =====================================================================
  // Meds & supplements
  // =====================================================================
  const meds = () => (Array.isArray(C.S.meds) ? C.S.meds : []);
  let armed = null; let armTimer = null;

  function renderMeds () {
    const grid = $('med-buttons');
    grid.textContent = '';
    if (!meds().length) grid.appendChild(el('p', 'muted small', 'Add your meds and supplements to “My list” below first.'));
    meds().forEach((m, i) => {
      const b = el('button', 'med-btn' + (armed === i ? ' confirm' : ''));
      b.type = 'button';
      b.appendChild(document.createTextNode((m.type === 'supplement' ? '🌿 ' : '💊 ') + m.name));
      b.appendChild(el('small', null, armed === i ? 'Tap again to log' : (m.dose || ' ')));
      b.addEventListener('click', () => onMedTap(i));
      grid.appendChild(b);
    });

    const today = C.treatments.filter((t) => t.kind === 'med' && t.t >= startOfDay(Date.now()));
    const ul = $('med-today');
    ul.textContent = '';
    if (!today.length) ul.appendChild(el('li', 'empty', 'Nothing logged today yet.'));
    for (const t of today) {
      const li = el('li');
      li.appendChild(C.iconFor(t));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', C.treatmentLabel(t)));
      mid.appendChild(el('div', 'muted small', C.clockTime(t.t)));
      li.appendChild(mid);
      ul.appendChild(li);
    }

    const list = $('med-list');
    list.textContent = '';
    if (!meds().length) list.appendChild(el('li', 'empty', 'Your list is empty.'));
    meds().forEach((m, i) => {
      const li = el('li');
      li.appendChild(el('span', 'ic other', m.type === 'supplement' ? '🌿' : '💊'));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', m.name));
      mid.appendChild(el('div', 'muted small', [m.dose, m.type].filter(Boolean).join(' · ')));
      li.appendChild(mid);
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove ' + m.name);
      del.addEventListener('click', () => { if (confirm('Remove ' + m.name + ' from your list?')) { C.S.meds = meds().filter((_, j) => j !== i); C.saveSettings(); renderMeds(); } });
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  async function onMedTap (i) {
    if (armed !== i) {
      armed = i; renderMeds();
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed = null; renderMeds(); }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = null;
    const m = meds()[i];
    const when = $('med-time').value ? new Date($('med-time').value) : new Date();
    try {
      await C.apiPostTreatment({
        eventType: 'Medication', created_at: when.toISOString(), enteredBy: 'CGM Hub',
        notes: [m.name, m.dose].filter(Boolean).join(' '), medName: m.name, medDose: m.dose || '', medType: m.type,
      });
      C.showMsg('med-msg', '✅ ' + m.name + ' logged at ' + C.clockTime(when.getTime()) + (C.S.demo ? ' (demo only)' : '') + '.', 'ok');
      $('med-time').value = nowLocalInput();
      await C.refresh(false);
    } catch (e) { C.showMsg('med-msg', e.message, 'danger'); }
    renderMeds();
  }
  $('med-add').addEventListener('click', () => {
    const name = $('med-name').value.trim();
    if (!name) { $('med-name').focus(); return; }
    C.S.meds = meds().concat([{ name, dose: $('med-dose').value.trim(), type: $('med-type').value }]);
    C.saveSettings();
    $('med-name').value = ''; $('med-dose').value = '';
    renderMeds();
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
      if (!document.querySelector('[data-logpanel="meds"]').hidden) renderMeds();
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
})();
