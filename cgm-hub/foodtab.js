/* CGM Hub: the 🥗 Food tab (Lifesum-style daily food diary).
 * Calories ring (goal − eaten + burned), carbs / protein / fat, meals by Breakfast / Lunch / Dinner / Snack
 * with glycemic index and "your spike" from your CGM, activity from Health Connect, and daily wins
 * (water glasses, veggie and fruit servings). Everything is read from / saved to Nightscout. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const GI = () => window.CGMHubGI;
  const N = () => window.CGMHubNutrition;
  const MEALS = [['Breakfast', '🥣', [0.2, 0.3], 8], ['Lunch', '🥗', [0.3, 0.4], 12.5], ['Dinner', '🍝', [0.3, 0.4], 18], ['Snack', '🍎', [0.05, 0.1], 15]];
  const WINS = { veg: ['🥦', 'Veggies', 'Veggie serving'], fruit: ['🍎', 'Fruit', 'Fruit serving'] };
  const r1 = (v) => Math.round(v * 10) / 10;
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  let day = dayStart(Date.now());
  let data = null, busy = false, again = false;

  const autoGroup = (t) => { const d = new Date(t); const h = d.getHours() + d.getMinutes() / 60; return h >= 4 && h < 10.5 ? 'Breakfast' : h >= 11 && h < 15 ? 'Lunch' : h >= 17 && h < 21.5 ? 'Dinner' : 'Snack'; };
  const kcalOf = (t) => { const r = t.raw || {}; return Number(r.calories) || (r.nutrients && Number(r.nutrients.kcal)) || null; };

  async function load () {
    const a = day, b = day + DAY;
    let raw = [];
    if (C.S.demo) raw = C.treatments.map((t) => Object.assign({ created_at: new Date(t.t).toISOString() }, t.raw || {}));
    else if (C.S.url && C.S.token) raw = await C.apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(a).toISOString(), 'find[created_at][$lt]': new Date(b).toISOString(), count: '500' });
    const inDay = (d) => { const ms = Date.parse(d.created_at); return ms >= a && ms < b; };
    raw = raw.filter(inDay);
    const trs = C.normTreatments(raw);
    let health = null;
    try { const H = window.CGMHubHealth; if (H) { const list = await H.load(a, a + HOUR); health = list.find((s) => s.d0 === a && s.eventType === 'Health Summary') || null; } } catch (e) { /* no health data */ }
    const wins = { veg: [], fruit: [] };
    for (const d of raw) if (d.eventType === 'Daily Win' && wins[d.win]) wins[d.win].push(d);
    return { trs, wins, health };
  }

  function goals () {
    const T = N() ? N().targets() : {};
    const kcal = T.kcal || Number(C.S.kcalGoal) || 2000;
    return { kcal, carbs: T.carbs || Math.round((kcal * 0.45) / 4), protein: T.protein || Math.round((kcal * 0.2) / 4), fat: T.fat || Math.round((kcal * 0.35) / 9) };
  }

  // ---------- ring ----------
  function ring (eaten, burned, goal) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 200 150'); svg.setAttribute('class', 'ft-ring'); svg.setAttribute('aria-hidden', 'true');
    const R = 80, cx = 100, cy = 92, start = 150, sweep = 240;
    const pt = (deg) => [cx + R * Math.cos((deg * Math.PI) / 180), cy + R * Math.sin((deg * Math.PI) / 180)];
    const arc = (from, to, cls) => {
      const [x1, y1] = pt(from), [x2, y2] = pt(to);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`);
      p.setAttribute('class', cls); svg.appendChild(p);
    };
    arc(start, start + sweep, 'ft-track');
    const frac = Math.max(0, Math.min(1, eaten / Math.max(1, goal + burned)));
    if (frac > 0.002) arc(start, start + sweep * frac, eaten > goal + burned ? 'ft-fill over' : 'ft-fill');
    return svg;
  }

  // ---------- render ----------
  async function render () {
    if ($('view-food').hidden) return;
    if (busy) { again = true; return; }
    busy = true;
    const today = dayStart(Date.now());
    $('ft-label').textContent = day === today ? 'Today, ' + new Date(day).toLocaleDateString([], { day: 'numeric', month: 'short' }) : new Date(day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    $('ft-next').disabled = day >= today;
    try { data = await load(); } catch (e) { $('ft-msg').hidden = false; $('ft-msg').textContent = e.message || String(e); busy = false; return; }
    $('ft-msg').hidden = true;
    busy = false;
    if (again) { again = false; render(); return; }
    draw();
  }

  function draw () {
    const { trs, wins, health } = data;
    const G = goals();
    const foodLogs = trs.filter((t) => t.carbs > 0 || kcalOf(t));
    let kcal = 0, carbs = 0, protein = 0, fat = 0, unknownKcal = 0;
    for (const t of foodLogs) {
      const k = kcalOf(t); if (k) kcal += k; else unknownKcal++;
      carbs += t.carbs; protein += Number(t.protein) || 0; fat += Number(t.fat) || 0;
    }
    const burned = health && health.activeKcal ? Math.round(health.activeKcal) : 0;

    // summary
    const top = $('ft-top'); top.textContent = '';
    const side = (label, v) => { const d = el('div', 'ft-side'); d.appendChild(el('div', 'ft-side-l', label)); d.appendChild(el('div', 'ft-side-v', String(v))); return d; };
    const mid = el('div', 'ft-mid');
    mid.appendChild(ring(kcal, burned, G.kcal));
    const left = Math.round(G.kcal - kcal + burned);
    const center = el('div', 'ft-center');
    center.appendChild(el('div', 'ft-c-l', left >= 0 ? 'Remaining' : 'Over'));
    center.appendChild(el('div', 'ft-c-v', String(Math.abs(left))));
    center.appendChild(el('div', 'ft-c-g', 'Goal ' + G.kcal + ' kcal'));
    mid.appendChild(center);
    top.append(side('Eaten', Math.round(kcal)), mid, side('Burned', burned));
    if (unknownKcal) top.appendChild(el('div', 'muted small ft-note', unknownKcal + ' log' + (unknownKcal === 1 ? '' : 's') + ' without calories (typed by hand) aren’t in the ring.'));

    // macros
    const mac = $('ft-macros'); mac.textContent = '';
    const net = !N() || N().carbMode() === 'net';
    [[net ? 'Net carbs' : 'Carbs', carbs, G.carbs - (net ? ((N() && N().targets().fiber) || 25) : 0), 'c'], ['Protein', protein, G.protein, 'p'], ['Fat', fat, G.fat, 'f']].forEach(([l, v, g, cls]) => {
      const card = el('div', 'ft-mac');
      card.appendChild(el('div', 'ft-mac-l', l));
      card.appendChild(el('div', 'ft-mac-v', Math.round(v) + ' / ' + Math.round(g) + ' g'));
      const bar = el('div', 'ft-bar ' + cls); const f = el('span'); f.style.width = Math.min(100, (v / Math.max(1, g)) * 100) + '%'; bar.appendChild(f); card.appendChild(bar);
      mac.appendChild(card);
    });

    // meals
    const ml = $('ft-meals'); ml.textContent = '';
    let dayGl = 0;
    for (const [name, icon, [lo, hi]] of MEALS) {
      const logs = foodLogs.filter((t) => ((t.raw && t.raw.mealGroup) || autoGroup(t.t)) === name).sort((a, b) => a.t - b.t);
      const mk = logs.reduce((s, t) => s + (kcalOf(t) || 0), 0);
      const card = el('div', 'ft-meal');
      const head = el('div', 'ft-meal-head');
      head.appendChild(el('span', 'ft-meal-ic', icon));
      const ht = el('div', 'grow');
      ht.appendChild(el('div', 'ft-meal-name', name));
      ht.appendChild(el('div', 'muted small', logs.length ? Math.round(mk) + ' kcal · ' + Math.round(logs.reduce((s, t) => s + t.carbs, 0)) + ' g carbs' : 'Recommended ' + Math.round(G.kcal * lo) + '–' + Math.round(G.kcal * hi) + ' kcal'));
      head.appendChild(ht);
      const add = el('button', 'ft-add', '+'); add.type = 'button'; add.setAttribute('aria-label', 'Add to ' + name);
      add.addEventListener('click', () => openFood(name));
      head.appendChild(add);
      card.appendChild(head);
      for (const t of logs) {
        const foods = Array.isArray(t.raw && t.raw.foods) && t.raw.foods.length ? t.raw.foods : [{ name: t.notes || 'Food', carbs: t.carbs, kcal: kcalOf(t) }];
        const mg = GI() ? GI().forMeal(foods) : null;
        if (mg) dayGl += mg.gl;
        const entry = el('div', 'ft-entry');
        const eh = el('div', 'ft-entry-head');
        eh.appendChild(el('span', 'muted small', C.clockTime(t.t) + (t.insulin ? ' · 💉 ' + r1(t.insulin) + ' u' : '') + (/cronometer/i.test(t.enteredBy) ? ' · from Cronometer' : '')));
        if (mg && mg.gl) { const c = el('span', 'gi-chip gi-' + mg.glBand, 'Meal GL ' + mg.gl); c.title = 'Glycemic load of this meal (' + mg.glBand + ')'; eh.appendChild(c); }
        const o = window.CGMHubUsual && window.CGMHubUsual.outcome(t);
        if (o) { const rise = Math.max(0, o.peak - o.start); const s = el('span', 'spike spike-' + o.verdict, o.verdict === 'low' ? '📉 dipped low after' : rise < 18 ? '✅ your spike: steady' : '📈 your spike +' + C.fmtBG(rise)); s.title = 'What your CGM did in the 3 hours after: started ' + C.fmtBG(o.start) + ', peaked ' + C.fmtBG(o.peak) + ', 3 h later ' + C.fmtBG(o.end); eh.appendChild(s); }
        entry.appendChild(eh);
        for (const f of foods) {
          const row = el('div', 'ft-food');
          const fm = el('div', 'grow');
          fm.appendChild(el('div', 'ft-food-n', f.name || 'Food'));
          row.appendChild(fm);
          const chip = GI() ? GI().chip(el, GI().forFood(f.name, Number(f.carbs) || 0)) : null;
          if (chip) row.appendChild(chip);
          row.appendChild(el('div', 'ft-food-k', (f.kcal ? Math.round(f.kcal) + ' kcal' : Math.round(Number(f.carbs) || 0) + ' g')));
          entry.appendChild(row);
        }
        C.tappable(entry, t);
        card.appendChild(entry);
      }
      ml.appendChild(card);
    }

    // glycemic load of the day
    const gb = $('ft-gi'); gb.textContent = '';
    const head = el('div', 'ft-gi-head');
    head.appendChild(el('b', null, '🍬 Glycemic load today'));
    head.appendChild(el('span', 'gi-chip gi-' + (dayGl < 80 ? 'low' : dayGl < 120 ? 'medium' : 'high'), String(Math.round(dayGl))));
    gb.appendChild(head);
    gb.appendChild(el('p', 'muted small', dayGl ? (dayGl < 80 ? 'A gentle day for your glucose so far.' : dayGl < 120 ? 'A medium day. Pairing carbs with protein, fat or fibre softens spikes.' : 'A high-GL day. Expect bigger rises; protein or veggies first and a short walk after meals can help.') : 'Log food to see how quickly your meals tend to raise glucose.'));
    const det = el('details', 'ft-gi-more');
    det.appendChild(el('summary', null, 'What do GI, GL and “your spike” mean?'));
    const ul = el('ul', 'ft-gi-list');
    ['GI (glycemic index): how fast a food’s carbs raise glucose. Low ≤ 55, medium 56–69, high ≥ 70.',
      'GL (glycemic load): GI × carbs in your portion ÷ 100. Low < 10, medium 10–19, high 20+. A big portion of a low-GI food can still be a high load.',
      '📈 Your spike: what your CGM actually did in the 3 hours after that meal. This beats any table, because everyone responds differently.',
      'Higher-GI meals often rise faster than rapid insulin starts working. Pre-bolus timing is worth talking over with your diabetes team.',
      'Easy softeners: eat protein or veggies first, add fibre or fat, choose less-processed versions, or take a short walk after.',
      'GI values are approximate, from international GI tables, and matched by food name.'].forEach((t) => ul.appendChild(el('li', null, t)));
    det.appendChild(ul);
    gb.appendChild(det);

    // activity
    const act = $('ft-activity'); act.textContent = '';
    if (health) {
      act.appendChild(el('div', 'ft-act-big', (burned || 0) + ' kcal burned'));
      const rows = [['👟 Steps', (health.steps || 0).toLocaleString()], ['🏋️ Workouts', (health.exerciseMin || 0) + ' min']];
      for (const [l, v] of rows) { const r = el('div', 'ft-act-row'); r.appendChild(el('span', null, l)); r.appendChild(el('b', null, v)); act.appendChild(r); }
      act.appendChild(el('div', 'muted small', 'Tracked via Health Connect'));
    } else act.appendChild(el('p', 'muted small', 'Connect Health Connect in Settings (CGM Hub app) to see steps and calories burned here.'));

    // daily wins
    renderWins(trs, wins);
  }

  // ---------- daily wins ----------
  function renderWins (trs, wins) {
    const box = $('ft-wins'); box.textContent = '';
    const waterLogs = trs.filter((t) => t.eventType === 'Water').sort((a, b) => a.t - b.t);
    const ml = waterLogs.reduce((s, t) => s + (t.water || 0), 0);
    const goalMl = Number(C.S.waterGoal) || 2000;
    const glasses = Math.round(goalMl / 250), full = Math.floor(ml / 250);
    const w = el('div', 'ft-win');
    const wh = el('div', 'ft-win-head'); wh.appendChild(el('b', null, '💧 Water')); wh.appendChild(el('span', 'muted', (ml / 1000).toFixed(ml % 1000 ? 2 : 0).replace(/0$/, '') + ' / ' + goalMl / 1000 + ' L'));
    w.appendChild(wh);
    const gl = el('div', 'ft-glasses');
    for (let i = 0; i < Math.max(glasses, full + 1); i++) {
      const filled = i < full;
      const b = el('button', 'ft-glass' + (filled ? ' on' : '') + (i === full ? ' next' : ''), filled ? '💧' : i === full ? '+' : ''); b.type = 'button';
      b.setAttribute('aria-label', filled ? 'Remove a glass of water' : 'Add a glass of water (250 ml)');
      b.addEventListener('click', () => (filled && i === full - 1 ? removeLast(waterLogs) : !filled ? addWater() : null));
      gl.appendChild(b);
    }
    w.appendChild(gl);
    if (full >= glasses) w.appendChild(cheer('You rock!', 'Goal reached. Drink more if you’re thirsty or exercising, and highs make you thirstier too.'));
    box.appendChild(w);

    for (const k of Object.keys(WINS)) {
      const [ic, label] = WINS[k];
      const goal = Number(C.S[k + 'Goal']) || 3;
      const n = wins[k].length;
      const card = el('div', 'ft-win');
      const h = el('div', 'ft-win-head'); h.appendChild(el('b', null, label)); h.appendChild(el('span', 'muted', n + ' / ' + goal)); card.appendChild(h);
      const row = el('div', 'ft-glasses');
      for (let i = 0; i < Math.max(goal, n); i++) {
        const on = i < n;
        const b = el('button', 'ft-count' + (on ? ' on' : ''), ic); b.type = 'button';
        b.setAttribute('aria-label', on ? 'Remove a ' + label.toLowerCase() + ' serving' : 'Add a ' + label.toLowerCase() + ' serving');
        b.addEventListener('click', () => (on && i === n - 1 ? removeWin(wins[k]) : !on ? addWin(k) : null));
        row.appendChild(b);
      }
      card.appendChild(row);
      if (n >= goal) card.appendChild(cheer('Score!', 'A round of applause for you. Fibre from ' + label.toLowerCase() + ' helps smooth out rises too.'));
      box.appendChild(card);
    }
  }
  function cheer (title, text) { const d = el('div', 'ft-cheer'); d.appendChild(el('span', 'ft-cheer-ic', '🏆')); const t = el('div'); t.appendChild(el('b', null, title)); t.appendChild(el('div', 'muted small', text)); d.appendChild(t); return d; }
  const whenFor = () => (day === dayStart(Date.now()) ? new Date() : new Date(day + 12 * HOUR));
  async function act (fn) { try { await fn(); await render(); C.hooks.logSaved.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); } catch (e) { $('ft-msg').hidden = false; $('ft-msg').textContent = e.message || String(e); } }
  const addWater = () => act(() => C.apiPostTreatment({ eventType: 'Water', water: 250, notes: 'Water 250 ml', created_at: whenFor().toISOString(), enteredBy: 'CGM Hub' }));
  const addWin = (k) => act(() => C.apiPostTreatment({ eventType: 'Daily Win', win: k, notes: WINS[k][2], created_at: whenFor().toISOString(), enteredBy: 'CGM Hub' }));
  const removeLast = (logs) => act(() => C.apiDeleteTreatment(logs[logs.length - 1]._id));
  const removeWin = (docs) => act(() => C.apiDeleteTreatment(docs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[docs.length - 1]._id));

  // ---------- + on a meal: the Food sheet, with that meal picked ----------
  function openFood (name) {
    C.go('log');
    if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet('food');
    const F = window.CGMHubFeatures;
    if (day !== dayStart(Date.now())) {
      const h = (MEALS.find((m) => m[0] === name) || [])[3] || 12;
      $('log-time').value = C.toLocalInput(new Date(day + h * HOUR));
    }
    if (F && F.setMealGroup) F.setMealGroup(name);
  }

  $('ft-prev').addEventListener('click', () => { day -= DAY; render(); });
  $('ft-next').addEventListener('click', () => { if (day < dayStart(Date.now())) { day += DAY; render(); } });
  $('ft-goals').addEventListener('click', () => { C.go('settings'); const n = document.getElementById('nut-settings') || document.querySelector('#view-settings h2'); if (n) n.scrollIntoView(); });
  C.hooks.view.push((v) => { if (v === 'food') { if (day > dayStart(Date.now())) day = dayStart(Date.now()); render(); } });
  C.hooks.logSaved.push(() => { if (!$('view-food').hidden) render(); });
  let lastAuto = 0;
  C.hooks.render.push(() => { if (!$('view-food').hidden && Date.now() - lastAuto > 2 * MIN) { lastAuto = Date.now(); render(); } });

  window.CGMHubFoodTab = { render, goals };
})();
