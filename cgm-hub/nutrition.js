/* CGM Hub: nutrition facts, portion units, net carbs, daily targets and "foods to add" suggestions.
 * General nutrition information only. Targets default to standard adult Daily Values and can be changed
 * to what a dietitian recommends. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { el } = C;

  // key, label, unit, FoodData Central nutrient numbers, Open Food Facts key, OFF factor (OFF is per 100 g in grams),
  // default daily target, kind: 'min' = aim for at least, 'max' = keep under, 'ref' = for reference only
  const NUTS = [
    ['kcal', 'Calories', 'kcal', ['208', '957', '958'], 'energy-kcal_100g', 1, null, 'ref'],
    ['carbs', 'Carbohydrates', 'g', ['205'], 'carbohydrates_100g', 1, null, 'ref'],
    ['fiber', 'Fibre', 'g', ['291'], 'fiber_100g', 1, 25, 'min'],
    ['sugars', 'Sugars', 'g', ['269', '269.3'], 'sugars_100g', 1, null, 'ref'],
    ['addedSugars', 'Added sugars', 'g', ['539'], 'added-sugars_100g', 1, 50, 'max'],
    ['protein', 'Protein', 'g', ['203'], 'proteins_100g', 1, 50, 'min'],
    ['fat', 'Fat', 'g', ['204'], 'fat_100g', 1, 75, 'ref'],
    ['satFat', 'Saturated fat', 'g', ['606'], 'saturated-fat_100g', 1, 20, 'max'],
    ['transFat', 'Trans fat', 'g', ['605'], 'trans-fat_100g', 1, null, 'ref'],
    ['cholesterol', 'Cholesterol', 'mg', ['601'], 'cholesterol_100g', 1000, 300, 'max'],
    ['sodium', 'Sodium', 'mg', ['307'], 'sodium_100g', 1000, 2300, 'max'],
    ['potassium', 'Potassium', 'mg', ['306'], 'potassium_100g', 1000, 3400, 'min'],
    ['calcium', 'Calcium', 'mg', ['301'], 'calcium_100g', 1000, 1300, 'min'],
    ['iron', 'Iron', 'mg', ['303'], 'iron_100g', 1000, 18, 'min'],
    ['magnesium', 'Magnesium', 'mg', ['304'], 'magnesium_100g', 1000, 420, 'min'],
    ['zinc', 'Zinc', 'mg', ['309'], 'zinc_100g', 1000, 11, 'min'],
    ['vitA', 'Vitamin A', 'µg', ['320'], 'vitamin-a_100g', 1e6, 900, 'min'],
    ['vitC', 'Vitamin C', 'mg', ['401'], 'vitamin-c_100g', 1000, 90, 'min'],
    ['vitD', 'Vitamin D', 'µg', ['328'], 'vitamin-d_100g', 1e6, 20, 'min'],
    ['vitB12', 'Vitamin B12', 'µg', ['418'], 'vitamin-b12_100g', 1e6, 2.4, 'min'],
    ['folate', 'Folate', 'µg', ['417', '435'], 'folates_100g', 1e6, 400, 'min'],
  ].map(([key, label, unit, fdc, off, offF, dv, kind]) => ({ key, label, unit, fdc, off, offF, dv, kind }));
  const BY = Object.fromEntries(NUTS.map((n) => [n.key, n]));

  const ADD = {
    fiber: ['lentils, chickpeas or black beans', 'berries (raspberries are very high)', 'chia or ground flax in yogurt', 'oats or whole-grain bread', 'veggies at every meal'],
    protein: ['eggs', 'Greek yogurt or cottage cheese', 'chicken, fish or tofu', 'edamame', 'a handful of nuts'],
    potassium: ['beans and lentils', 'spinach or other leafy greens', 'yogurt', 'avocado', 'salmon', 'potatoes or bananas (count the carbs)'],
    calcium: ['milk or fortified plant milk', 'yogurt or cheese', 'canned salmon with bones', 'calcium-set tofu', 'almonds'],
    iron: ['lentils and beans', 'lean red meat', 'spinach', 'pumpkin seeds', 'iron-fortified cereal', '(pair plant iron with vitamin C, e.g. peppers or orange)'],
    magnesium: ['pumpkin or sunflower seeds', 'almonds or cashews', 'spinach', 'black beans', 'dark chocolate (small piece)'],
    zinc: ['meat, chicken or shellfish', 'pumpkin seeds', 'chickpeas', 'cheese', 'cashews'],
    vitA: ['carrots', 'sweet potato', 'spinach or kale', 'eggs'],
    vitC: ['red peppers', 'kiwi or oranges', 'strawberries', 'broccoli'],
    vitD: ['salmon or trout', 'fortified milk or plant milk', 'egg yolks', 'UV-grown mushrooms'],
    vitB12: ['fish, meat or chicken', 'milk, yogurt or eggs', 'fortified plant milk or nutritional yeast'],
    folate: ['leafy greens', 'lentils and chickpeas', 'asparagus or broccoli', 'avocado'],
  };
  const LIMIT = {
    sodium: ['fewer packaged, restaurant and fast foods', 'rinse canned beans and veggies', 'compare labels: aim for under 15% DV per serving'],
    satFat: ['leaner meats and more fish', 'olive or canola oil instead of butter', 'fewer fried foods and pastries'],
    addedSugars: ['swap sweet drinks for water or sparkling water (also easier on glucose)', 'plain yogurt + berries instead of sweetened', 'check cereal and granola labels'],
    cholesterol: ['fewer fried and processed meats', 'more beans, fish and poultry'],
  };
  const WHY = {
    fiber: 'Fibre helps you feel full and can soften glucose rises.',
    protein: 'Protein with carbs can make rises gentler and keeps you full.',
    iron: 'Periods increase iron needs, so low iron can add to tiredness.',
    vitD: 'Many people in Canada are low in vitamin D, especially in winter. Supplements you log in Meds aren’t counted here.',
    potassium: 'Potassium supports heart and muscle health.',
    calcium: 'Calcium matters for bones.',
    magnesium: 'Magnesium is often low in people with diabetes.',
    sodium: 'Lots of sodium can raise blood pressure.',
    satFat: 'Saturated fat affects cholesterol and heart health.',
    addedSugars: 'Added sugars raise glucose quickly.',
  };

  // ---------- reading the databases (everything per 100 g) ----------
  function fromFdc (f) {
    const n100 = {};
    const raw = {};
    for (const x of f.foodNutrients || []) { const num = String(x.nutrientNumber || ''); if (raw[num] == null && typeof x.value === 'number') raw[num] = x.value; }
    for (const n of NUTS) for (const num of n.fdc) if (raw[num] != null) { n100[n.key] = raw[num]; break; }
    if (n100.vitD == null && raw['324'] != null) n100.vitD = raw['324'] / 40; // IU → µg
    return n100;
  }
  function fromOff (nutriments) {
    const n100 = {};
    const o = nutriments || {};
    for (const n of NUTS) { const v = Number(o[n.off]); if (o[n.off] != null && !isNaN(v)) n100[n.key] = v * n.offF; }
    if (n100.kcal == null && o.energy_100g != null) n100.kcal = Number(o.energy_100g) / 4.184;
    if (n100.sodium == null && o.salt_100g != null) n100.sodium = (Number(o.salt_100g) / 2.5) * 1000;
    return n100;
  }

  // ---------- portions ----------
  function parseQty (s) {
    s = s.trim();
    let m = s.match(/^(\d+)\s+(\d+)\/(\d+)\b/); if (m) return [Number(m[1]) + Number(m[2]) / Number(m[3]), s.slice(m[0].length)];
    m = s.match(/^(\d+)\/(\d+)\b/); if (m) return [Number(m[1]) / Number(m[2]), s.slice(m[0].length)];
    m = s.match(/^(\d+(?:[.,]\d+)?)/); if (m) return [Number(m[1].replace(',', '.')), s.slice(m[0].length)];
    return [1, s];
  }
  function singular (w) {
    if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
    if (/(ch|sh|x|ss)es$/.test(w)) return w.replace(/es$/, '');
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  // "3 sticks (85 g)" with 85 g → per stick 28 g
  function portionFrom (text, grams) {
    if (!text || !(grams > 0)) return null;
    const [qty, rest0] = parseQty(String(text).toLowerCase());
    let rest = rest0.replace(/\(.*?\)/g, '').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rest || /^(g|gr|grm|grams?|ml|mlt|oz|onz)$/.test(rest)) return null;
    const words = rest.split(' ');
    words[0] = singular(words[0]);
    rest = words.slice(0, 3).join(' ');
    if (!(qty > 0)) return null;
    return { label: '1 ' + rest, g: grams / qty };
  }
  function unitsFrom ({ servingText, servingG, measures }) {
    const out = [];
    const add = (label, g) => { if (!(g > 0)) return; g = Math.round(g * 10) / 10; if (!out.some((u) => u.label === label)) out.push({ label, g }); };
    if (servingG > 0) {
      const p = portionFrom(servingText, servingG);
      add('1 serving' + (servingText ? ' (' + String(servingText).replace(/\s*\(.*\)\s*/, '').toLowerCase() + ')' : ''), servingG);
      if (p && Math.abs(p.g - servingG) > 0.5) add(p.label, p.g);
    }
    for (const m of measures || []) {
      if (!(m.gramWeight > 0) || !m.disseminationText || /quantity not specified/i.test(m.disseminationText)) continue;
      const [qty, rest] = parseQty(m.disseminationText);
      add('1 ' + rest.trim().replace(/^,\s*/, ''), m.gramWeight / (qty || 1));
    }
    add('g', 1); add('oz', 28.35); add('100 g', 100);
    return out;
  }
  function unitLabel (u, qty) { return u.label === 'g' || u.label === 'oz' || u.label === '100 g' ? u.label : u.label.replace(/^1 /, '') + ' · ' + Math.round(u.g) + ' g'; }

  // ---------- amounts for an item ----------
  function scaled (n100, grams) {
    const out = {};
    for (const k in n100) out[k] = (n100[k] * grams) / 100;
    return out;
  }
  const carbMode = () => (C.S.carbMode === 'total' ? 'total' : 'net');
  function netOf (n) { return Math.max(0, (n.carbs || 0) - (n.fiber || 0)); }

  // ---------- nutrition label ----------
  const fmtN = (v, unit) => (v == null ? '–' : (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + ' ' + unit);
  function factsPanel (n, opts) {
    opts = opts || {};
    const box = el('div', 'facts');
    const t = targets();
    const row = (key, indent) => {
      const d = BY[key];
      if (n[key] == null && !opts.showEmpty) return;
      const r = el('div', 'facts-row' + (indent ? ' indent' : ''));
      r.appendChild(el('span', null, d.label));
      const v = el('b', null, fmtN(n[key], d.unit));
      r.appendChild(v);
      if (t[key] && n[key] != null) r.appendChild(el('span', 'muted small facts-dv', Math.round((n[key] / t[key]) * 100) + '%'));
      box.appendChild(r);
    };
    if (n.kcal != null) { const k = el('div', 'facts-kcal'); k.appendChild(el('span', null, 'Calories')); k.appendChild(el('b', null, String(Math.round(n.kcal)))); box.appendChild(k); }
    row('fat'); row('satFat', 1); row('transFat', 1); row('cholesterol'); row('sodium');
    row('carbs');
    if (n.carbs != null) { const r = el('div', 'facts-row indent net'); r.appendChild(el('span', null, 'Net carbs (carbs − fibre)')); r.appendChild(el('b', null, fmtN(netOf(n), 'g'))); box.appendChild(r); }
    row('fiber', 1); row('sugars', 1); row('addedSugars', 2); row('protein');
    const micro = ['potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitA', 'vitC', 'vitD', 'vitB12', 'folate'].filter((k) => n[k] != null);
    if (micro.length) { box.appendChild(el('div', 'facts-sep')); micro.forEach((k) => row(k)); }
    box.appendChild(el('div', 'muted small', '% = of your daily target' + (opts.note ? ' · ' + opts.note : '')));
    return box;
  }

  // ---------- targets ----------
  function targets () {
    const saved = C.S.nutTargets || {};
    const out = {};
    for (const n of NUTS) { const v = saved[n.key] !== undefined ? saved[n.key] : n.dv; if (v != null && v !== '' && Number(v) > 0) out[n.key] = Number(v); }
    return out;
  }

  // sums over logged meals that carry nutrient data
  function totalsOf (trs) {
    const sum = {}; let meals = 0; const days = new Set();
    for (const t of trs) {
      const n = t.nutrients;
      if (!n || typeof n !== 'object' || !Object.keys(n).length) continue;
      meals++; days.add(new Date(t.t).toDateString());
      for (const k in n) if (BY[k] && typeof n[k] === 'number') sum[k] = (sum[k] || 0) + n[k];
    }
    return { sum, meals, days: days.size };
  }

  // card: today's totals or daily averages vs targets, plus foods to add / limit
  function renderNutrition (box, trs, isDay) {
    box.textContent = '';
    const { sum, meals, days } = totalsOf(trs);
    if (!meals) { box.appendChild(el('p', 'muted', 'No meals with full nutrition info yet. Foods you add with 🔎 search or 📷 scan include all their nutrients. Foods typed by hand only count carbs.')); return; }
    const per = isDay ? 1 : Math.max(1, days);
    const avg = {}; for (const k in sum) avg[k] = sum[k] / per;
    const t = targets();
    box.appendChild(el('p', 'muted small', isDay ? `From ${meals} meal${meals === 1 ? '' : 's'} with full nutrition info.` : `Average per day, from ${meals} meals on ${days} day${days === 1 ? '' : 's'} with full nutrition info. Hand-typed foods only count carbs, so real totals may be higher.`));
    const list = el('div', 'nut-list');
    const lows = [], highs = [];
    for (const n of NUTS) {
      if (avg[n.key] == null) continue;
      const tg = t[n.key];
      const pct = tg ? (avg[n.key] / tg) * 100 : null;
      let state = 'ok';
      if (tg && n.kind === 'min' && pct < 70) { state = 'low'; lows.push([n, pct]); }
      if (tg && n.kind === 'max' && pct > 100) { state = 'high'; highs.push([n, pct]); }
      const r = el('div', 'nut-row ' + state);
      const top = el('div', 'nut-top');
      top.appendChild(el('span', null, n.label));
      top.appendChild(el('b', null, fmtN(avg[n.key], n.unit) + (tg ? ' / ' + fmtN(tg, n.unit) : '')));
      r.appendChild(top);
      if (tg) {
        const bar = el('div', 'nut-bar'); const f = el('span'); f.style.width = Math.min(100, pct) + '%'; bar.appendChild(f); r.appendChild(bar);
        r.appendChild(el('div', 'muted small', (n.kind === 'max' ? 'keep under · ' : n.kind === 'min' ? 'aim for at least · ' : '') + Math.round(pct) + '%' + (state === 'low' ? ' · low' : state === 'high' ? ' · over' : '')));
      }
      list.appendChild(r);
    }
    box.appendChild(list);
    if (isDay || days < 3) {
      box.appendChild(el('p', 'muted small', 'Food suggestions appear once you’ve logged full-nutrition meals on 3+ days (look at Week or Month).'));
      return;
    }
    lows.sort((a, b) => a[1] - b[1]);
    if (lows.length) {
      const c = el('div', 'nut-tip');
      c.appendChild(el('div', 'b', '🥗 Foods you could add'));
      for (const [n] of lows.slice(0, 4)) {
        const p = el('p');
        p.appendChild(el('b', null, n.label + ': '));
        p.appendChild(document.createTextNode(ADD[n.key].join(', ') + '.'));
        if (WHY[n.key]) p.appendChild(el('span', 'muted small block', WHY[n.key]));
        c.appendChild(p);
      }
      box.appendChild(c);
    }
    if (highs.length) {
      const c = el('div', 'nut-tip high');
      c.appendChild(el('div', 'b', '⚖️ Running high'));
      for (const [n] of highs) {
        const p = el('p'); p.appendChild(el('b', null, n.label + ': ')); p.appendChild(document.createTextNode((LIMIT[n.key] || ['check labels']).join('; ') + '.'));
        if (WHY[n.key]) p.appendChild(el('span', 'muted small block', WHY[n.key]));
        c.appendChild(p);
      }
      box.appendChild(c);
    }
    // meals that helped most with the lowest nutrient
    if (lows.length) {
      const k = lows[0][0].key;
      const top = trs.filter((x) => x.nutrients && x.nutrients[k] > 0 && x.notes).sort((a, b) => b.nutrients[k] - a.nutrients[k]).slice(0, 3);
      if (top.length) box.appendChild(el('p', 'muted small', `Your best ${BY[k].label.toLowerCase()} meals so far: ` + top.map((x) => `${x.notes} (${fmtN(x.nutrients[k], BY[k].unit)})`).join(', ') + '.'));
    }
    if (lows.length || highs.length) box.appendChild(el('p', 'muted small', 'General nutrition info, not medical advice. Your dietitian can set targets that fit you (Settings → 🥗 Nutrition).'));
  }

  // ---------- settings ----------
  function renderSettings () {
    const box = document.getElementById('nut-targets');
    if (!box) return;
    box.textContent = '';
    const saved = C.S.nutTargets || {};
    for (const n of NUTS.filter((x) => x.kind !== 'ref' || x.key === 'kcal' || x.key === 'carbs')) {
      const lab = el('label', 'field nut-field');
      lab.appendChild(el('span', null, n.label + ' (' + n.unit + ')' + (n.kind === 'max' ? ' · limit' : n.kind === 'min' ? ' · aim for' : '')));
      const i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.min = '0'; i.step = 'any';
      i.placeholder = n.dv != null ? String(n.dv) : 'none';
      if (saved[n.key] !== undefined && saved[n.key] !== null) i.value = saved[n.key];
      i.dataset.key = n.key;
      lab.appendChild(i);
      box.appendChild(lab);
    }
    const mode = document.getElementById('set-carbmode');
    if (mode) mode.value = carbMode();
  }
  function saveSettings () {
    const t = {};
    document.querySelectorAll('#nut-targets input').forEach((i) => { if (i.value !== '') t[i.dataset.key] = Number(i.value); });
    C.S.nutTargets = t;
    const mode = document.getElementById('set-carbmode');
    if (mode) C.S.carbMode = mode.value;
    C.saveSettings();
  }
  (function wire () {
    const btn = document.getElementById('nut-save');
    if (btn) btn.addEventListener('click', () => { saveSettings(); C.showMsg('nut-msg', '✅ Saved.', 'ok'); });
    const reset = document.getElementById('nut-reset');
    if (reset) reset.addEventListener('click', () => { C.S.nutTargets = {}; C.saveSettings(); renderSettings(); C.showMsg('nut-msg', 'Back to standard Daily Values.', 'ok'); });
  })();
  C.hooks.view.push((v) => { if (v === 'settings') renderSettings(); });

  window.CGMHubNutrition = { NUTS, BY, fromFdc, fromOff, unitsFrom, unitLabel, portionFrom, scaled, netOf, carbMode, factsPanel, targets, totalsOf, renderNutrition };
})();
