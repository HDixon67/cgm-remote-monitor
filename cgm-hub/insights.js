/* CGM Hub v3: pattern insights with possible causes + ideas, the daily-pattern (AGP) chart,
 * time-of-day breakdown, and meal/food analysis. Plugs into app.js via window.CGMHubCore.
 * Every suggestion is general education, not medical advice; dose changes are always
 * framed as "ask your care team".
 */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, sv, MIN, HOUR, DAY } = C;
  const FIVE = 5 * MIN;

  let rangeDays = 14;
  let cache = null; // {key, at, series, trs}
  let loading = false;

  // ---------- helpers ----------
  const mmolDiff = (mg) => (C.mmol() ? (Math.abs(mg) / C.MGDL_PER_MMOL).toFixed(1) : String(Math.round(Math.abs(mg)))) + ' ' + C.unitLabel();
  const lo = () => C.toMg(C.S.low);
  const hi = () => C.toMg(C.S.high);
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (sorted, p) => { if (!sorted.length) return null; const i = (sorted.length - 1) * p; const a = Math.floor(i), b = Math.ceil(i); return sorted[a] + (sorted[b] - sorted[a]) * (i - a); };
  const hourOf = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const atHour = (t, h) => { const d = new Date(t); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); return d.getTime(); };
  const minsText = (m) => (m < 60 ? Math.round(m) + ' min' : (m / 60).toFixed(1).replace(/\.0$/, '') + ' h');

  function downsample (ents) {
    // ents newest-first {t, mg} -> ascending 5-minute averages
    const buckets = new Map();
    for (const e of ents) {
      const k = Math.floor(e.t / FIVE);
      const b = buckets.get(k);
      if (b) { b.s += e.mg; b.n++; } else buckets.set(k, { s: e.mg, n: 1 });
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ t: k * FIVE + FIVE / 2, mg: b.s / b.n }));
  }
  function lowerBound (series, t) {
    let a = 0, b = series.length;
    while (a < b) { const m = (a + b) >> 1; if (series[m].t < t) a = m + 1; else b = m; }
    return a;
  }
  function valueNear (series, t, tol) {
    tol = tol || 12 * MIN;
    const i = lowerBound(series, t);
    let best = null, bd = Infinity;
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= series.length) continue;
      const d = Math.abs(series[j].t - t);
      if (d < bd) { bd = d; best = series[j]; }
    }
    return best && bd <= tol ? best.mg : null;
  }
  function windowPts (series, t0, t1) {
    const out = [];
    for (let i = lowerBound(series, t0); i < series.length && series[i].t <= t1; i++) out.push(series[i]);
    return out;
  }
  function mealSlot (t) {
    const h = hourOf(t);
    if (h >= 4 && h < 11) return 'breakfast';
    if (h >= 11 && h < 16) return 'lunch';
    if (h >= 16 && h < 22) return 'dinner';
    return 'snack';
  }
  const SLOT = { breakfast: '🍳 Breakfast', lunch: '🥪 Lunch', dinner: '🍝 Dinner', snack: '🌙 Late snacks' };

  // ---------- data ----------
  function demoTreatments (from) {
    const foods = {
      breakfast: [['Toast + eggs', 30, 3], ['Cereal + milk', 45, 4.5], ['Oatmeal', 40, 4]],
      lunch: [['Chalupa', 30, 3.5], ['Sandwich', 45, 4.5], ['Sushi', 55, 5.5]],
      dinner: [['Pizza', 70, 6], ['Pasta', 75, 7], ['Chicken + rice', 50, 5]],
    };
    const out = [];
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    for (let d = today0.getTime() - 14 * DAY, i = 0; d <= today0.getTime(); d += DAY, i++) {
      [['breakfast', 8], ['lunch', 12.5], ['dinner', 18.5]].forEach(([slot, h], k) => {
        const [name, carbs, ins] = foods[slot][(i + k) % 3];
        const t = d + h * HOUR;
        const nutrients = { carbs: carbs + 3, fiber: Math.round(carbs * 0.06 * 10) / 10, protein: 14, fat: 11, satFat: 4.5, sodium: 820, kcal: (carbs + 3) * 4 + 14 * 4 + 11 * 9, calcium: 140, iron: 1.8, potassium: 380, vitD: 0.8, vitC: 6, magnesium: 40 };
        if (t < Date.now() && t >= from) out.push({ created_at: new Date(t).toISOString(), carbs, insulin: ins, eventType: 'Meal Bolus', notes: name, enteredBy: 'demo', nutrients, totalCarbs: carbs + 3 });
      });
      if (d + 9 * HOUR < Date.now()) out.push({ created_at: new Date(d + 9 * HOUR).toISOString(), eventType: 'Medication', notes: 'Vitamin D 1000 IU', medName: 'Vitamin D', medDose: '1000 IU', medType: 'supplement', enteredBy: 'demo' });
    }
    return out;
  }
  // load glucose (5-minute averages) + logged entries for any window [a, b)
  const wcache = new Map();
  async function loadData (a, b) {
    if (a == null) { b = Date.now(); a = b - rangeDays * DAY; }
    b = Math.min(b, Date.now());
    const key = Math.round(a / MIN) + '|' + Math.round(b / (5 * MIN)) + '|' + C.S.url + '|' + C.S.demo;
    const hit = wcache.get(key);
    if (hit && Date.now() - hit.at < 10 * MIN) return hit;
    let ents, trs;
    const inMemory = C.entries.length && C.entries[C.entries.length - 1].t <= a + 30 * MIN;
    if (C.S.demo) {
      ents = C.entries.filter((e) => e.t >= a && e.t < b);
      trs = C.normTreatments(demoTreatments(a)).filter((t) => t.t < b);
    } else {
      ents = inMemory ? C.entries.filter((e) => e.t >= a && e.t < b)
        : C.normEntries(await C.apiGet('/api/v1/entries/sgv.json', { 'find[date][$gte]': String(Math.round(a)), 'find[date][$lt]': String(Math.round(b)), count: String(Math.ceil((b - a) / DAY + 1) * 1500) }));
      trs = C.normTreatments(await C.apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(a).toISOString(), 'find[created_at][$lt]': new Date(b).toISOString(), count: '5000' }));
    }
    const fresh = { key, at: Date.now(), a, b, ents, series: downsample(ents), trs };
    if (fresh.series.length >= 12) wcache.set(key, fresh);
    if (wcache.size > 30) wcache.delete(wcache.keys().next().value);
    return fresh;
  }

  // ---------- analysis ----------
  function analyze (series, trs, opts) {
    opts = opts || {};
    const health = opts.health || [];
    // workouts tracked by the watch count as exercise too
    trs = trs.concat(health.flatMap((s) => (s.exercise || []).map((e) => ({ t: e.start, eventType: 'Exercise', duration: e.min, notes: e.title || 'Workout', kind: 'dose', insulin: 0, carbs: 0 }))));
    const L = lo(), H = hi();
    const out = { insights: [], meals: [], blocks: [], agp: [], days: 0 };
    if (series.length < 12 * 18) return out; // need most of a day of data
    const first = series[0].t, last = series[series.length - 1].t;
    out.days = Math.max(1, Math.round((last - first) / DAY));
    const need = 2; // a pattern has to happen at least twice (never a one-off)
    const off = Array.isArray(C.S.insOff) ? C.S.insOff : [];
    const add = (id, o) => { if (!off.includes(id)) out.insights.push(Object.assign({ id }, o)); };

    // basic stats
    let n = 0, sum = 0, sum2 = 0, nLow = 0, nHigh = 0, nVLow = 0;
    for (const p of series) { n++; sum += p.mg; sum2 += p.mg * p.mg; if (p.mg < L) nLow++; else if (p.mg > H) nHigh++; if (p.mg < 54) nVLow++; }
    const mean = sum / n, cv = (Math.sqrt(Math.max(0, sum2 / n - mean * mean)) / mean) * 100;
    const tir = ((n - nLow - nHigh) / n) * 100, tbr = (nLow / n) * 100, tar = (nHigh / n) * 100;
    out.summary = { mean, cv, tir, tbr, tar, n };

    // low events (runs of >=15 min below low)
    const lowEvents = [];
    let run = null;
    for (const p of series) {
      if (p.mg < L) {
        if (run && p.t - run.end <= 15 * MIN) { run.end = p.t; run.min = Math.min(run.min, p.mg); } else { if (run) lowEvents.push(run); run = { start: p.t, end: p.t, min: p.mg }; }
      }
    }
    if (run) lowEvents.push(run);
    const realLows = lowEvents.filter((r) => r.end - r.start >= 10 * MIN);

    const carbTrs = trs.filter((t) => t.carbs >= 10);
    const insulinTrs = trs.filter((t) => t.insulin > 0 && !C.isBasal(t));
    const logsFood = carbTrs.length >= 5;

    // --- 1. Overnight lows
    const nightLows = realLows.filter((r) => { const h = hourOf(r.start); return h >= 0 && h < 6; });
    const nightsWithLows = new Set(nightLows.map((r) => dayKey(r.start))).size;
    if (nightsWithLows >= need) {
      add('nightlows', {
        sev: 3, icon: '🌙', title: 'Lows overnight',
        what: `You went low between midnight and 6 AM on ${nightsWithLows} of the last ${out.days} nights (lowest ${C.fmtBG(Math.min(...nightLows.map((r) => r.min)))}).`,
        causes: ['Long-acting (basal) insulin may be a bit strong for overnight', 'A correction dose late in the evening still working while you sleep', 'Exercise earlier in the day (it can lower glucose for up to 24 h)', 'Alcohol in the evening', 'A dinner bolus that was bigger than the meal needed'],
        tries: ['Check your glucose before bed. If it’s falling, a small snack with some protein can help', 'Avoid correcting highs right before bed unless you’ve agreed that with your care team', 'Keep fast sugar by your bed', 'Ask your care team whether your basal dose or timing should change'],
        care: true,
      });
    }

    // --- 2. Dawn / morning rise
    const rises = [];
    for (let d = new Date(first).setHours(0, 0, 0, 0); d <= last; d += DAY) {
      const a = valueNear(series, atHour(d, 3)), b = valueNear(series, atHour(d, 7.5));
      if (a == null || b == null) continue;
      if (trs.some((t) => t.carbs > 0 && t.t >= atHour(d, 3) && t.t <= atHour(d, 7.5))) continue;
      rises.push(b - a);
    }
    const medRise = median(rises);
    if (rises.length >= 3 && medRise >= 30) {
      add('dawn', {
        sev: 2, icon: '🌅', title: 'Rising in the early morning',
        what: `On a typical morning you rise about ${mmolDiff(medRise)} between 3 AM and 7:30 AM without eating (${rises.length} mornings checked).`,
        causes: ['The “dawn phenomenon”: hormones released before waking raise glucose', 'Basal insulin wearing off by morning', 'A late or high-fat dinner digesting slowly overnight', 'Rebound after an unnoticed overnight low (less common)'],
        tries: ['Look at the Daily pattern chart below to see when the rise starts', 'Compare mornings after early vs late dinners', 'Ask your care team about basal timing or dose (e.g. taking Basaglar at a different time)'],
        care: true,
      });
    }

    // --- 3. Meals: rises, peak times, lows after
    const meals = [];
    for (const t of carbTrs) {
      const pre = valueNear(series, t.t);
      const win = windowPts(series, t.t, t.t + 3 * HOUR);
      if (pre == null || win.length < 18) continue;
      let peak = win[0];
      for (const p of win) if (p.mg > peak.mg) peak = p;
      const after = windowPts(series, t.t + 2 * HOUR, t.t + 5 * HOUR);
      const lowAfter = after.some((p) => p.mg < L);
      meals.push({ t: t.t, slot: mealSlot(t.t), name: (t.notes || '').trim(), carbs: t.carbs, insulin: t.insulin, pre, rise: peak.mg - pre, peakMin: (peak.t - t.t) / MIN, lowAfter });
    }
    const slots = {};
    for (const m of meals) (slots[m.slot] = slots[m.slot] || []).push(m);
    for (const [slot, list] of Object.entries(slots)) {
      const r = median(list.map((m) => m.rise));
      const pk = median(list.map((m) => m.peakMin));
      const lowRate = list.filter((m) => m.lowAfter).length / list.length;
      out.meals.push({ slot, n: list.length, rise: r, peakMin: pk, lowRate });
      if (list.length >= 3 && r >= 63) {
        const fast = pk <= 75, slow = pk >= 120;
        add('mealspike', {
          slot, sev: 2, icon: '📈', title: `Big rises after ${SLOT[slot].replace(/^\S+\s/, '').toLowerCase()}`,
          what: `After ${SLOT[slot].replace(/^\S+\s/, '').toLowerCase()} you typically rise ${mmolDiff(r)}, peaking about ${minsText(pk)} after eating (${list.length} meals).`,
          causes: [
            fast ? 'The peak comes fast, which often means insulin started working after the food did' : null,
            slow ? 'The peak comes late, typical of meals higher in fat or protein (pizza, pasta with cream, takeout)' : null,
            'Carbs may be under-counted for these meals',
            'Your carb ratio at this time of day might not fit this meal',
            'Fast-digesting carbs (white bread, juice, cereal) spike quicker',
          ].filter(Boolean),
          tries: [
            fast ? 'Try bolusing 10–15 minutes before eating (check with your care team first)' : null,
            slow ? 'For fatty meals, ask your care team about splitting the dose (some now, some later)' : null,
            'Eat the vegetables and protein first, carbs last',
            'A 10–15 minute walk after eating can blunt the spike',
            'Use food search to double-check carb counts',
            'Ask your care team whether your carb ratio for this time of day fits',
          ].filter(Boolean),
          care: true,
        });
      }
      if (list.length >= 3 && lowRate >= 0.3) {
        add('meallows', {
          slot, sev: 3, icon: '⬇️', title: `Lows a few hours after ${SLOT[slot].replace(/^\S+\s/, '').toLowerCase()}`,
          what: `${Math.round(lowRate * 100)}% of your ${SLOT[slot].replace(/^\S+\s/, '').toLowerCase()} meals were followed by a low 2–5 hours later.`,
          causes: ['The meal dose may be more than this meal needs', 'Carbs over-counted, or part of the meal not eaten', 'Activity after the meal', 'A correction added on top of the meal dose'],
          tries: ['Note what you ate on the days it happened (the Food section helps)', 'Have a small snack ready 2–3 hours after this meal', 'Ask your care team whether your carb ratio at this time is too strong'],
          care: true,
        });
      }
    }

    // --- 4. Rebound highs after lows
    const rebounds = realLows.filter((r) => windowPts(series, r.end, r.end + 2.5 * HOUR).some((p) => p.mg > H));
    if (rebounds.length >= need) {
      add('rebound', {
        sev: 2, icon: '🎢', title: 'Highs after lows (rebounds)',
        what: `${rebounds.length} of your ${realLows.length} lows were followed by a high within 2½ hours.`,
        causes: ['Eating more than needed while low, which is very common because lows make you hungry', 'Slow sugar (chocolate, cookies) that keeps raising glucose after the low is gone', 'The body’s own stress hormones releasing sugar during a low'],
        tries: ['Try the 15-15 rule: 15 g fast sugar (juice, glucose tabs), wait 15 min, re-check', 'Use fast sugar first, then a small snack only if the next meal is far off', 'Pre-portion low treatments so it’s easy not to overdo it'],
      });
    }

    // --- 5. Stacked corrections
    let stacked = 0;
    for (let i = 0; i < insulinTrs.length; i++) {
      const a = insulinTrs[i];
      if (a.carbs > 0) continue;
      const prev = insulinTrs.find((b) => b !== a && b.t < a.t && a.t - b.t <= 3 * HOUR);
      if (!prev) continue;
      if (windowPts(series, a.t, a.t + 4 * HOUR).some((p) => p.mg < L)) stacked++;
    }
    if (stacked >= need) {
      add('stacked', {
        sev: 3, icon: '🧱', title: 'Corrections stacking up',
        what: `${stacked} times, a correction was taken within 3 hours of another dose and was followed by a low.`,
        causes: ['Insulin from the earlier dose was still working (insulin on board)', 'Correcting again because glucose wasn’t dropping fast enough yet'],
        tries: ['Check “insulin on board” on the Home screen before correcting', 'Use the Bolus tab: it subtracts insulin still working', 'Give a correction 2–3 hours to work before adding more'],
      });
    }

    // --- 6. Unlogged rises (only for people who log food here)
    if (logsFood) {
      let unexplained = 0;
      for (let i = 0; i < series.length; i++) {
        const p = series[i];
        const h = hourOf(p.t);
        if (h < 7 || h > 23) continue;
        const later = valueNear(series, p.t + 90 * MIN);
        if (later == null || later - p.mg < 63) continue;
        if (trs.some((t) => (t.carbs > 0 || t.insulin > 0) && t.t >= p.t - 60 * MIN && t.t <= p.t + 45 * MIN)) continue;
        unexplained++;
        i = lowerBound(series, p.t + 3 * HOUR); // skip ahead so one rise counts once
      }
      if (unexplained >= 3) {
        add('unlogged', {
          sev: 1, icon: '🔍', title: 'Rises with nothing logged',
          what: `${unexplained} times your glucose rose ${mmolDiff(63)} or more with no food or insulin logged around then.`,
          causes: ['Snacks or drinks that weren’t logged', 'A missed or late bolus', 'Stress, illness, or a hot shower/bath', 'Your infusion site or insulin pen issue (if insulin seemed to “not work”)', 'Your period cycle (see the cycle section below)'],
          tries: ['Log snacks too, even small ones, so patterns are easier to spot', 'Set a phone reminder for your meal bolus', 'Add a note when you’re stressed or sick'],
        });
      }
    }

    // --- 7. Time-of-day blocks
    const BLOCKS = [['🌙 Overnight', 0, 6], ['🌅 Morning', 6, 11], ['☀️ Afternoon', 11, 17], ['🌆 Evening', 17, 22], ['🌃 Late night', 22, 24]];
    for (const [name, a, b] of BLOCKS) {
      let bn = 0, bl = 0, bh = 0, bs = 0;
      for (const p of series) { const h = hourOf(p.t); if (h < a || h >= b) continue; bn++; bs += p.mg; if (p.mg < L) bl++; else if (p.mg > H) bh++; }
      if (!bn) continue;
      const blk = { name, n: bn, mean: bs / bn, pLow: (bl / bn) * 100, pHigh: (bh / bn) * 100 };
      out.blocks.push(blk);
    }
    const worstHigh = out.blocks.slice().sort((x, y) => y.pHigh - x.pHigh)[0];
    if (worstHigh && worstHigh.pHigh >= 35 && worstHigh.pHigh >= tar * 1.4) {
      add('toughhigh', {
        block: worstHigh.name, sev: 1, icon: '⏰', title: `Your toughest time: ${worstHigh.name.replace(/^\S+\s/, '').toLowerCase()}`,
        what: `You’re above range ${Math.round(worstHigh.pHigh)}% of the time during the ${worstHigh.name.replace(/^\S+\s/, '').toLowerCase()}, compared with ${Math.round(tar)}% overall.`,
        causes: ['Meals or snacks in this window that are hard to dose for', 'Insulin (basal or meal) not quite matching this part of the day', 'Less activity at this time (sitting at a desk, evening on the couch)'],
        tries: ['Focus on one change for this time of day only (small steps work better)', 'Check the Meals section below for which meals land here', 'Bring this time block up with your care team: they may adjust your ratio for these hours'],
        care: true,
      });
    }
    const worstLow = out.blocks.slice().sort((x, y) => y.pLow - x.pLow)[0];
    if (worstLow && worstLow.pLow >= 8 && !(worstLow.name.includes('Overnight') && nightsWithLows >= need)) {
      add('lowblock', {
        sev: 3, icon: '⚠️', title: `Lows cluster in the ${worstLow.name.replace(/^\S+\s/, '').toLowerCase()}`,
        what: `${Math.round(worstLow.pLow)}% of readings in the ${worstLow.name.replace(/^\S+\s/, '').toLowerCase()} are low (the goal is under 4% overall).`,
        causes: ['Insulin from an earlier meal or correction peaking in this window', 'Regular activity at this time (commute, gym, errands)', 'A long gap between meals'],
        tries: ['Carry fast sugar during this part of the day', 'Try a small snack before this window and see if it helps', 'Ask your care team if a dose earlier in the day is too strong'],
        care: true,
      });
    }

    // --- 8. Overall lows / variability
    if (tbr >= 4 && !out.insights.some((i) => i.sev === 3)) {
      add('lowtime', {
        sev: 3, icon: '🔻', title: 'More time low than recommended',
        what: `You’re below ${C.fmtBG(L)} ${tbr.toFixed(1)}% of the time. The usual goal is under 4%${nVLow / n * 100 >= 1 ? `, and ${(nVLow / n * 100).toFixed(1)}% is very low (under ${C.fmtBG(54)})` : ''}.`,
        causes: ['Doses a bit strong for current routines', 'Exercise, alcohol, or skipped meals', 'Over-correcting highs'],
        tries: ['Check the time-of-day breakdown below to see when lows happen', 'Turn on low alerts in your Libre app', 'Share this with your care team. Reducing lows usually comes first'],
        care: true,
      });
    }
    if (cv > 36) {
      add('variability', {
        sev: 1, icon: '〰️', title: 'Big ups and downs',
        what: `Your variability is ${Math.round(cv)}% (goal: 36% or less). Glucose is swinging more than ideal.`,
        causes: ['Meals with lots of fast carbs', 'Bolus timing (too late before meals)', 'Treating lows with too much sugar', 'Correcting highs aggressively'],
        tries: ['Pre-bolusing and balanced meals usually help most', 'Use the 15-15 rule for lows', 'Use the Bolus tab so insulin on board is counted'],
      });
    }

    // --- 9. Weekday vs weekend
    let wd = [0, 0], we = [0, 0];
    const weDays = new Set();
    for (const p of series) {
      const dow = new Date(p.t).getDay();
      if (dow === 0 || dow === 6) { we[0] += p.mg; we[1]++; weDays.add(dayKey(p.t)); } else { wd[0] += p.mg; wd[1]++; }
    }
    if (weDays.size >= 2 && wd[1] > 288 * 3) {
      const diff = we[0] / we[1] - wd[0] / wd[1];
      if (Math.abs(diff) >= 18) {
        add('weekend', {
          sev: 1, icon: diff > 0 ? '🎉' : '💼', title: diff > 0 ? 'Weekends run higher' : 'Weekdays run higher',
          what: `Your average is ${mmolDiff(diff)} ${diff > 0 ? 'higher on weekends' : 'higher on weekdays'}.`,
          causes: diff > 0 ? ['Different meal times, eating out, or more treats', 'Sleeping in (basal timing shifts)', 'Less structured activity'] : ['Work stress or sitting more', 'Rushed or skipped meals, then bigger ones later', 'Less time to pre-bolus'],
          tries: diff > 0 ? ['Keep meal and insulin timing similar on weekends', 'Use favourites for common takeout meals so dosing is easier'] : ['Plan a go-to work lunch you know how to dose for', 'Short walks during the workday'],
        });
      }
    }

    // --- 10. Foods
    const byFood = {};
    for (const m of meals) {
      if (!m.name) continue;
      const k = m.name.toLowerCase();
      (byFood[k] = byFood[k] || { name: m.name, list: [] }).list.push(m);
    }
    out.foods = Object.values(byFood).filter((f) => f.list.length >= 2)
      .map((f) => ({ name: f.name, n: f.list.length, rise: median(f.list.map((m) => m.rise)), carbs: median(f.list.map((m) => m.carbs)) }))
      .sort((a, b) => b.rise - a.rise);
    const spiky = out.foods.filter((f) => f.rise >= 80).slice(0, 3);
    if (spiky.length) {
      add('foods', {
        sev: 1, icon: '🍽️', title: 'Foods that spike you most',
        what: spiky.map((f) => `${f.name} (+${mmolDiff(f.rise)})`).join(', ') + '.',
        causes: ['These may have more carbs than logged, or digest fast', 'Mixed meals (pizza, pasta) can rise late and long'],
        tries: ['Double-check carbs for these with food search or a barcode scan', 'Try pre-bolusing a little earlier for these specific foods (ask your care team)', 'Pair with protein or veggies, or add a short walk after'],
      });
    }

    // --- 11. Meds & supplements (correlation only)
    const medDays = {};
    for (const t of trs) if (t.kind === 'med' && t.medName) (medDays[t.medName] = medDays[t.medName] || new Set()).add(dayKey(t.t));
    const dayMeans = {};
    for (const p of series) { const k = dayKey(p.t); (dayMeans[k] = dayMeans[k] || [0, 0]); dayMeans[k][0] += p.mg; dayMeans[k][1]++; }
    for (const [name, days] of Object.entries(medDays)) {
      const on = [], off = [];
      for (const [k, [s, c]] of Object.entries(dayMeans)) { if (c < 100) continue; (days.has(k) ? on : off).push(s / c); }
      if (on.length < 3 || off.length < 3) continue;
      const diff = on.reduce((a, b) => a + b, 0) / on.length - off.reduce((a, b) => a + b, 0) / off.length;
      if (Math.abs(diff) >= 14) {
        add('meds', {
          sev: 1, icon: '💊', title: `${name}: ${diff < 0 ? 'lower' : 'higher'} days`,
          what: `On days you logged ${name}, your average was ${mmolDiff(diff)} ${diff < 0 ? 'lower' : 'higher'} (${on.length} days with, ${off.length} without).`,
          causes: ['This might be the med, or something else that tends to happen on those days', 'Patterns need a few weeks of logging to be trustworthy'],
          tries: ['Keep logging it every day you take it', 'Mention it to your care team or pharmacist if it seems strong'],
        });
      }
    }

    // --- 12. Progress (last 7 days vs the 7 before)
    if (last - first >= 13 * DAY) {
      const tirOf = (a, b) => { const w = windowPts(series, a, b); if (w.length < 288) return null; return (w.filter((p) => p.mg >= L && p.mg <= H).length / w.length) * 100; };
      const nowT = last;
      const recent = tirOf(nowT - 7 * DAY, nowT), before = tirOf(nowT - 14 * DAY, nowT - 7 * DAY);
      if (recent != null && before != null && Math.abs(recent - before) >= 5) {
        add('progress', recent > before
          ? { sev: 0, icon: '🌟', title: 'Time in range is improving!', what: `${Math.round(recent)}% this week vs ${Math.round(before)}% the week before. Whatever you changed is working.`, causes: [], tries: ['Keep it up. Notice what was different this week and keep doing it'] }
          : { sev: 1, icon: '📉', title: 'Time in range dipped this week', what: `${Math.round(recent)}% this week vs ${Math.round(before)}% the week before.`, causes: ['Routine changes, stress, illness, a new sensor, or your cycle'], tries: ['Check the other insights here for where the time is going', 'One rough week is normal. Look for patterns over a few weeks'] });
      }
    }
    if (tir >= 70) add('goal', { sev: 0, icon: '🎯', title: 'Meeting the time-in-range goal', what: `You’re in range ${Math.round(tir)}% of the time (goal: 70%+).`, causes: [], tries: [] });


    // --- 13. Possible compression lows (sleeping on the sensor)
    let comp = 0;
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      if (hourOf(p.t) >= 7) continue;
      const w = windowPts(series, p.t, p.t + 20 * MIN);
      if (w.length < 3) continue;
      const bottom = w.reduce((m, x) => (x.mg < m.mg ? x : m), w[0]);
      const drop = p.mg - bottom.mg;
      if (drop < 45 || bottom.mg >= L + 10) continue;
      const back = windowPts(series, bottom.t, bottom.t + 40 * MIN).some((x) => x.mg >= bottom.mg + drop * 0.8);
      if (back && !trs.some((t) => t.carbs > 0 && t.t >= bottom.t - 10 * MIN && t.t <= bottom.t + 40 * MIN)) { comp++; i = lowerBound(series, p.t + 2 * HOUR); }
    }
    if (comp >= need) {
      add('compression', {
        sev: 1, icon: '🛏️', title: 'Possible “compression lows” at night',
        what: `${comp} times overnight your glucose dropped fast and bounced right back with no food logged. That pattern often means you were lying on your sensor.`,
        causes: ['Pressure on the sensor (sleeping on that arm) squeezes fluid away and gives falsely low readings', 'Less often: a real low that your body corrected on its own'],
        tries: ['Try placing your next sensor on the arm you sleep on less', 'If a night low alarm wakes you but you feel fine, confirm with a fingerstick before treating', 'Note which side you slept on'],
      });
    }

    // --- 14. Long highs
    const longHighs = [];
    let hrun = null;
    for (const p of series) {
      if (p.mg > H) { if (hrun && p.t - hrun.end <= 15 * MIN) { hrun.end = p.t; } else { if (hrun) longHighs.push(hrun); hrun = { start: p.t, end: p.t }; } }
    }
    if (hrun) longHighs.push(hrun);
    const lh = longHighs.filter((r) => r.end - r.start >= 4 * HOUR);
    if (lh.length >= need) {
      add('longhigh', {
        sev: 2, icon: '⏳', title: 'Long stretches of highs',
        what: `${lh.length} times you stayed above range for 4+ hours (longest ${minsText(Math.max(...lh.map((r) => (r.end - r.start) / MIN)))}).`,
        causes: ['A missed or late bolus', 'Being sick, stressed, or short on sleep', 'Insulin that got too hot or cold, or a pen/needle problem', 'High-fat meals that keep raising glucose for hours'],
        tries: ['Check your pen needle and how your insulin is stored', 'Drink water during long highs', 'If your care team gave you a ketone plan, check ketones during long highs', 'Ask your care team how to handle highs that won’t come down'],
        care: true,
      });
    }

    // --- 15. Meals without a bolus / late boluses
    if (insulinTrs.length >= 5) {
      let noBolus = 0, late = 0;
      for (const m of carbTrs) {
        if (m.carbs < 15 || m.insulin > 0) continue;
        const ins = insulinTrs.filter((t) => t.t >= m.t - 20 * MIN && t.t <= m.t + 90 * MIN);
        if (!ins.length) noBolus++;
        else if (ins.every((t) => t.t - m.t >= 20 * MIN)) late++;
      }
      if (noBolus >= need) {
        add('nobolus', {
          sev: 2, icon: '❓', title: 'Meals without a logged bolus',
          what: `${noBolus} meals had carbs logged but no insulin logged around them.`,
          causes: ['The bolus was forgotten', 'The bolus was taken but logged somewhere else (or not logged)'],
          tries: ['Use the Bolus tab → “Log this dose + carbs” to log both at once', 'Set a phone reminder for meal times', 'Keep your pen next to where you eat'],
        });
      }
      if (late >= need) {
        add('latebolus', {
          sev: 1, icon: '⏰', title: 'Boluses after eating',
          what: `${late} times your insulin was logged 20+ minutes after the meal.`,
          causes: ['Remembering the bolus partway through or after eating (very common with ADHD!)'],
          tries: ['Make “pen out” part of sitting down to eat', 'A sticky note or phone reminder at usual meal times', 'Ask your care team what to do when you bolus late'],
        });
      }
    }

    // --- 16. Lows after exercise
    const exTrs = trs.filter((t) => t.eventType === 'Exercise');
    if (exTrs.length >= need) {
      const withLow = exTrs.filter((t) => windowPts(series, t.t, t.t + 12 * HOUR).some((p) => p.mg < L));
      if (withLow.length >= need && withLow.length / exTrs.length >= 0.4) {
        add('exerciselow', {
          sev: 2, icon: '🏃', title: 'Lows after exercise',
          what: `${withLow.length} of your ${exTrs.length} logged workouts were followed by a low within 12 hours.`,
          causes: ['Muscles keep pulling in glucose for hours after exercise', 'Insulin works better (you’re more sensitive) after activity'],
          tries: ['Have a snack with carbs + protein after longer workouts', 'Check before bed on active days', 'Ask your care team about lowering doses on exercise days'],
          care: true,
        });
      }
    }

    // --- 17. Late dinners and the next morning
    const dinners = carbTrs.filter((t) => { const h = hourOf(t.t); return h >= 16 && t.carbs >= 20; });
    const morningAvg = (t) => { const d = new Date(t); d.setDate(d.getDate() + 1); const w = windowPts(series, atHour(d.getTime(), 6), atHour(d.getTime(), 9)); return w.length >= 12 ? w.reduce((a, p) => a + p.mg, 0) / w.length : null; };
    const lateM = dinners.filter((t) => hourOf(t.t) >= 20.5).map((t) => morningAvg(t.t)).filter((v) => v != null);
    const earlyM = dinners.filter((t) => hourOf(t.t) < 20.5).map((t) => morningAvg(t.t)).filter((v) => v != null);
    if (lateM.length >= 2 && earlyM.length >= 2) {
      const diff = lateM.reduce((a, b) => a + b, 0) / lateM.length - earlyM.reduce((a, b) => a + b, 0) / earlyM.length;
      if (diff >= 18) {
        add('latedinner', {
          sev: 1, icon: '🌜', title: 'Late dinners → higher mornings',
          what: `After dinners eaten 8:30 PM or later, your next morning averages ${mmolDiff(diff)} higher than after earlier dinners.`,
          causes: ['Food still digesting overnight', 'Less movement after late meals'],
          tries: ['Try finishing dinner before 8 PM on a couple of nights and compare', 'A short walk after a late dinner'],
        });
      }
    }

    // --- AGP (30-minute bins)
    const bins = Array.from({ length: 48 }, () => []);
    for (const p of series) { const d = new Date(p.t); bins[d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0)].push(p.mg); }
    out.agp = bins.map((b) => { const s = b.sort((x, y) => x - y); return s.length >= 3 ? { p10: pct(s, 0.1), p25: pct(s, 0.25), p50: pct(s, 0.5), p75: pct(s, 0.75), p90: pct(s, 0.9), n: s.length } : null; });

    // --- 18. Mood & how you feel (needs 3+ check-in days with the same feeling)
    const moodDays = {};
    for (const t of trs) {
      if (t.eventType !== 'Mood') continue;
      const k = dayKey(t.t);
      const md = moodDays[k] || (moodDays[k] = { mood: 0, tags: new Set() });
      if (t.mood) md.mood = t.mood;
      (t.moodTags || []).forEach((g) => md.tags.add(g));
    }
    const tirDay = {};
    for (const p of series) { const k = dayKey(p.t); const o = tirDay[k] || (tirDay[k] = [0, 0]); o[1]++; if (p.mg >= L && p.mg <= H) o[0]++; }
    const tirOfDays = (keys) => { let a = 0, b = 0; for (const k of keys) { const o = tirDay[k]; if (o && o[1] >= 144) { a += o[0]; b += o[1]; } } return b ? { tir: (a / b) * 100, n: keys.filter((k) => tirDay[k] && tirDay[k][1] >= 144).length } : null; };
    const allTags = new Set();
    Object.values(moodDays).forEach((m) => m.tags.forEach((g) => allTags.add(g)));
    const moodFinds = [];
    for (const tag of allTags) {
      const withT = Object.keys(moodDays).filter((k) => moodDays[k].tags.has(tag));
      const others = Object.keys(tirDay).filter((k) => !withT.includes(k));
      const A = tirOfDays(withT), B = tirOfDays(others);
      if (A && B && A.n >= 3 && B.n >= 3 && Math.abs(A.tir - B.tir) >= 12) moodFinds.push({ label: '“' + tag.toLowerCase() + '”', A, B });
    }
    const lowMood = Object.keys(moodDays).filter((k) => moodDays[k].mood && moodDays[k].mood <= 2);
    const okMood = Object.keys(moodDays).filter((k) => moodDays[k].mood >= 3);
    { const A = tirOfDays(lowMood), B = tirOfDays(okMood); if (A && B && A.n >= 3 && B.n >= 3 && Math.abs(A.tir - B.tir) >= 12) moodFinds.unshift({ label: 'rough or not great', A, B }); }
    if (moodFinds.length) {
      const f = moodFinds[0];
      add('mood', {
        sev: 1, icon: '🙂', title: 'How you feel and your glucose',
        what: `On days you felt ${f.label}, you were in range ${Math.round(f.A.tir)}% of the time, vs ${Math.round(f.B.tir)}% on other days (${f.A.n} vs ${f.B.n} days).` + (moodFinds.length > 1 ? ' Also: ' + moodFinds.slice(1, 3).map((x) => `${x.label} days ${Math.round(x.A.tir)}% vs ${Math.round(x.B.tir)}%`).join('; ') + '.' : ''),
        causes: ['Stress, poor sleep and illness release hormones that raise glucose and make insulin work less well', 'On hard days, routines (meal times, doses, checks) slip, which is very human', 'It can also go the other way: rough glucose days make you feel worse'],
        tries: ['On rough days, aim for “good enough”: one small win (log one meal, drink water)', 'If “diabetes feels like a lot” keeps showing up, tell your care team. Diabetes distress is common and there is real help for it 💛'],
      });
    }

    // --- 19. Steps and sleep (Health Connect)
    if (health.length) {
      const tirByDay = {};
      for (const p of series) { const k = dayKey(p.t); const o = tirByDay[k] || (tirByDay[k] = [0, 0]); o[1]++; if (p.mg >= L && p.mg <= H) o[0]++; }
      const tirOf = (k) => (tirByDay[k] && tirByDay[k][1] >= 144 ? tirByDay[k][0] / tirByDay[k][1] * 100 : null);
      const withSteps = health.filter((s) => s.steps > 0 && tirOf(dayKey(s.t)) != null);
      if (withSteps.length >= 6) {
        const sorted = withSteps.map((s) => s.steps).sort((a, b) => a - b);
        const mid = sorted[Math.floor(sorted.length / 2)];
        const hi = withSteps.filter((s) => s.steps >= mid), loD = withSteps.filter((s) => s.steps < mid);
        const avgT = (arr) => arr.reduce((a, s) => a + tirOf(dayKey(s.t)), 0) / arr.length;
        if (hi.length >= 3 && loD.length >= 3) {
          const diff = avgT(hi) - avgT(loD);
          const cut = Math.round(mid / 500) * 500;
          if (Math.abs(diff) >= 8) add('steps', {
            sev: diff > 0 ? 1 : 2, icon: '👟', title: diff > 0 ? 'More steps, more time in range' : 'Lower time in range on active days',
            what: `On days with ${cut.toLocaleString()}+ steps you were in range ${Math.round(avgT(hi))}% of the time, vs ${Math.round(avgT(loD))}% on quieter days (${hi.length} vs ${loD.length} days).`,
            causes: diff > 0 ? ['Moving helps muscles use glucose, with or without extra insulin', 'Active days may also have more regular meals'] : ['Activity can cause lows (and over-treated lows can rebound)', 'Intense exercise can raise glucose for a while (adrenaline)'],
            tries: diff > 0 ? ['Short walks after meals are a great way to add steps', 'Try the steps quest on quieter days'] : ['Carry fast sugar on active days', 'Check before and after longer workouts', 'Ask your care team about adjusting doses on very active days'],
            care: diff <= 0,
          });
        }
      }
      const nights = health.filter((s) => s.sleepMin > 0);
      const morning = (s) => { const w = windowPts(series, s.d0 + 6 * HOUR, s.d0 + 10 * HOUR); return w.length >= 12 ? w.reduce((a, p) => a + p.mg, 0) / w.length : null; };
      const shortN = nights.filter((s) => s.sleepMin < 360 && morning(s) != null), goodN = nights.filter((s) => s.sleepMin >= 420 && morning(s) != null);
      if (shortN.length >= 3 && goodN.length >= 3) {
        const avgM = (arr) => arr.reduce((a, s) => a + morning(s), 0) / arr.length;
        const diff = avgM(shortN) - avgM(goodN);
        if (diff >= 14) add('sleep', {
          sev: 1, icon: '😴', title: 'Short sleep → higher mornings',
          what: `After nights under 6 hours, your 6–10 AM glucose averaged ${mmolDiff(diff)} higher than after 7+ hour nights (${shortN.length} vs ${goodN.length} nights).`,
          causes: ['Short sleep raises stress hormones and makes insulin work less well the next day', 'Late nights often come with late snacks'],
          tries: ['Aim for a consistent bedtime on a few nights and compare', 'Be a little extra careful with breakfast after a short night'],
        });
      }
    }

    // --- occurrence dots (one per night/day) so you can see a pattern really repeats
    const dayStarts = [];
    for (let d = new Date(first).setHours(0, 0, 0, 0); d <= last; d += DAY) dayStarts.push(new Date(d).setHours(0, 0, 0, 0));
    const dayLabel = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    const dotsFor = (fn) => dayStarts.map((d0) => ({ label: dayLabel(d0), hit: fn(d0) }));
    const inBlock = (d0, a, b) => windowPts(series, d0 + a * HOUR, d0 + b * HOUR - 1);
    const DOTS = {
      nightlows: (d0) => { const w = inBlock(d0, 0, 6); if (w.length < 36) return null; return realLows.some((r) => r.start >= d0 && r.start < d0 + 6 * HOUR); },
      dawn: (d0) => { const a = valueNear(series, d0 + 3 * HOUR), b = valueNear(series, d0 + 7.5 * HOUR); if (a == null || b == null) return null; return b - a >= 30; },
      longhigh: (d0) => { const w = inBlock(d0, 0, 24); if (w.length < 144) return null; return lh.some((r) => r.start >= d0 && r.start < d0 + DAY); },
      rebound: (d0) => { const lows = realLows.filter((r) => r.start >= d0 && r.start < d0 + DAY); if (!lows.length) return false; return rebounds.some((r) => r.start >= d0 && r.start < d0 + DAY); },
    };
    const BLOCK_H = { 'Overnight': [0, 6], 'Morning': [6, 11], 'Afternoon': [11, 17], 'Evening': [17, 22], 'Late night': [22, 24] };
    for (const ins of out.insights) {
      let fn = DOTS[ins.id];
      if (!fn && ins.block && (ins.id === 'toughhigh' || ins.id === 'lowblock')) {
        const [a, b] = BLOCK_H[ins.block.replace(/^\S+\s/, '')] || [0, 0];
        fn = (d0) => { const w = inBlock(d0, a, b); if (w.length < (b - a) * 6) return null; const share = w.filter((p) => (ins.id === 'toughhigh' ? p.mg > H : p.mg < L)).length / w.length; return ins.id === 'toughhigh' ? share >= 0.35 : share >= 0.08; }; // same thresholds as the pattern itself
      }
      if (!fn && ins.id === 'mealspike' && slots[ins.slot]) {
        ins.dots = slots[ins.slot].map((m) => ({ label: dayLabel(m.t), hit: m.rise >= 63 }));
      } else if (fn) ins.dots = dotsFor(fn);
      if (ins.dots) {
        const elig = ins.dots.filter((x) => x.hit !== null);
        const hits = elig.filter((x) => x.hit).length;
        ins.hits = hits;
        ins.occ = `${hits} of ${elig.length} ${ins.id === 'mealspike' ? 'meals' : ins.id === 'nightlows' ? 'nights' : ins.id === 'dawn' ? 'mornings' : 'days'}`;
      }
      ins.experiment = experimentFor(ins);
    }
    out.insights.sort((a, b) => b.sev - a.sev);
    return out;
  }

  // ---------- experiments: one small, safe thing to try for a week ----------
  function experimentFor (ins) {
    const slot = ins.slot ? SLOT[ins.slot].replace(/^\S+\s/, '').toLowerCase() : 'meal';
    const block = ins.block ? ins.block.replace(/^\S+\s/, '').toLowerCase() : 'that time';
    const E = {
      nightlows: 'Each night this week, check before bed. If you’re under 7, have a small snack with protein, then see if the overnight lows change. (Basal changes: with your diabetes team.)',
      dawn: 'Each day this week, finish dinner before 8 PM if you can, then compare your 3–7 AM rise.',
      mealspike: `Each day this week, take a 10-minute walk right after ${slot} and watch whether the spike gets smaller.`,
      meallows: `Each day this week, keep a small snack ready 2–3 hours after ${slot}.`,
      rebound: 'This week, treat every low with 15 g of fast sugar, wait 15 minutes, then check again before eating more.',
      stacked: 'Each day this week, check “insulin on board” on the Home screen before any correction.',
      unlogged: 'Each day this week, log every snack and drink with carbs, even small ones.',
      toughhigh: `Each day this week, move for 10 minutes during the ${block}.`,
      lowblock: `Each day this week, carry fast sugar during the ${block} and try a small snack just before it.`,
      lowtime: 'This week, add a quick note (Log → 📝) whenever you go low: what happened just before?',
      variability: 'Each day this week, eat veggies or protein first at one meal.',
      weekend: 'This weekend, keep meal times within an hour of your weekday times.',
      foods: 'Next time you have one of these foods, double-check the carbs with a scan or search and walk after.',
      longhigh: 'Next long high: drink water, check your pen needle and insulin, and add a note about anything unusual.',
      nobolus: 'Each day this week, keep your pen where you eat and log the dose with the meal (Bolus → Log this).',
      latebolus: 'Each day this week, make “pen out” the first thing you do when food arrives.',
      exerciselow: 'This week, after any workout, have a carb + protein snack and check before bed.',
      latedinner: 'Each day this week, finish dinner by 8 PM if you can and compare the next mornings.',
      compression: 'Each night this week, sleep on the side without your sensor (or put your next sensor on your less-slept-on arm).',
      meds: 'Keep logging this every day for 2 more weeks so the pattern is clearer.',
      steps: 'Each day this week, add a 10-minute walk (after a meal is best) and watch your time in range.',
      sleep: 'Each night this week, aim to be in bed 30 minutes earlier, then compare your mornings.',
      mood: 'Check in each morning this week (it takes 5 seconds), and on rough days pick one small thing to do for yourself.',
    };
    return E[ins.id] || '';
  }

  // "Start this 7-day experiment" (game.js tracks it)
  function expButton (ins) {
    const G = window.CGMHubGame;
    const cur = G && G.experiment;
    const running = cur && !cur.finished && cur.id === ins.id;
    const b = el('button', 'btn slim exp-btn' + (running ? '' : ' primary'), running ? '🧪 Running: open it' : '🧪 Start this 7-day experiment');
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); if (window.CGMHubBrief) window.CGMHubBrief.close(); if (G) G.startExperiment(ins); });
    if (!G) b.hidden = true;
    return b;
  }
  function dotRow (dots) {
    const row = el('div', 'dot-row');
    for (const d of dots.slice(-21)) {
      const s = el('span', 'dot ' + (d.hit === null ? 'na' : d.hit ? 'hit' : 'ok'));
      s.title = d.label + (d.hit === null ? ': too few readings' : d.hit ? ': yes' : ': no');
      row.appendChild(s);
    }
    return row;
  }
  // big "main pattern" card (also used by the morning brief)
  function renderMainPattern (box, ins, periodLabel) {
    const card = el('div', 'pattern-card sev-' + ins.sev);
    card.appendChild(el('div', 'pt-kicker', '🔁 PATTERN · ' + (periodLabel || 'LAST 14 DAYS').toUpperCase()));
    card.appendChild(el('div', 'pt-title', ins.icon + ' ' + ins.title));
    card.appendChild(el('p', null, ins.what));
    if (ins.dots) {
      card.appendChild(dotRow(ins.dots));
      card.appendChild(el('div', 'muted small', ins.occ + ' · ● yes  ○ no  · too few readings'));
    }
    if (ins.experiment) {
      const ex = el('div', 'experiment');
      ex.appendChild(el('div', 'ex-kicker', '🧪 EXPERIMENT'));
      ex.appendChild(el('p', null, ins.experiment));
      ex.appendChild(expButton(ins));
      card.appendChild(ex);
    }
    const d = el('details'); d.appendChild(el('summary', null, 'Details'));
    if (ins.causes.length) { d.appendChild(el('div', 'small b', '🤔 What might be causing it')); const ul = el('ul'); ins.causes.forEach((c) => ul.appendChild(el('li', null, c))); d.appendChild(ul); }
    if (ins.tries.length) { d.appendChild(el('div', 'small b', '💡 Other ideas')); const ul = el('ul'); ins.tries.forEach((c) => ul.appendChild(el('li', null, c))); d.appendChild(ul); }
    card.appendChild(d);
    if (ins.care) card.appendChild(el('p', 'muted small', 'Anything involving insulin doses: check with your care team first.'));
    box.appendChild(card);
  }
  function mainOf (insights) {
    const cands = insights.filter((i) => i.sev > 0 && i.id !== 'goal' && i.id !== 'progress');
    return cands.sort((a, b) => b.sev - a.sev || (b.hits || 0) - (a.hits || 0))[0] || null;
  }

  // ---------- rendering ----------
  function renderInsights (res, periodLabel) {
    const box = $('ins-list');
    box.textContent = '';
    if (res.quiet) { box.appendChild(el('p', 'muted', 'A pattern needs to happen at least twice, so look at a Week or Month.')); return; }
    if (!res.insights.length) {
      box.appendChild(el('p', 'muted', res.days ? 'No repeating patterns in this period. 👍 Keep logging meals and doses for richer insights.' : 'Not enough glucose data yet for this period.'));
      return;
    }
    const main = mainOf(res.insights);
    if (main) renderMainPattern(box, main, periodLabel);
    const rest = res.insights.filter((i) => i !== main);
    if (rest.length) box.appendChild(el('div', 'split-title more-h', main ? 'More patterns' : 'Patterns'));
    for (const ins of rest) {
      const card = el('div', 'ins-card sev-' + ins.sev);
      const head = el('div', 'ins-head');
      head.appendChild(el('span', 'ins-ic', ins.icon));
      head.appendChild(el('b', null, ins.title));
      card.appendChild(head);
      card.appendChild(el('p', null, ins.what));
      if (ins.dots) { card.appendChild(dotRow(ins.dots)); card.appendChild(el('div', 'muted small', ins.occ)); }
      if (ins.experiment) {
        const d = el('details'); d.appendChild(el('summary', null, '🧪 Experiment'));
        d.appendChild(el('p', 'small', ins.experiment)); d.appendChild(expButton(ins)); card.appendChild(d);
      }
      if (ins.causes.length) {
        const d = el('details'); d.appendChild(el('summary', null, '🤔 What might be causing it'));
        const ul = el('ul'); ins.causes.forEach((c) => ul.appendChild(el('li', null, c))); d.appendChild(ul); card.appendChild(d);
      }
      if (ins.tries.length) {
        const d = el('details'); d.appendChild(el('summary', null, '💡 Ideas to try'));
        const ul = el('ul'); ins.tries.forEach((c) => ul.appendChild(el('li', null, c))); d.appendChild(ul); card.appendChild(d);
      }
      if (ins.care) card.appendChild(el('p', 'muted small', 'Anything involving insulin doses: check with your care team first.'));
      box.appendChild(card);
    }
  }

  let agpGeom = null;
  function renderAGP (res) {
    const svg = $('agp');
    svg.textContent = '';
    const W = svg.clientWidth || 340, Hh = 220;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    const bins = res.agp;
    if (!bins.some(Boolean)) { agpGeom = null; return; }
    const padL = 6, padR = 34, padT = 8, padB = 22;
    const maxMg = Math.max(C.toMg(C.mmol() ? 15 : 270), ...bins.filter(Boolean).map((b) => b.p90)) + 10;
    const minMg = C.mmol() ? 2 * C.MGDL_PER_MMOL : 40;
    const x = (i) => padL + ((i + 0.5) / 48) * (W - padL - padR);
    const y = (mg) => padT + (1 - (Math.min(maxMg, Math.max(minMg, mg)) - minMg) / (maxMg - minMg)) * (Hh - padT - padB);
    svg.appendChild(sv('rect', { class: 'band', x: padL, y: y(hi()), width: W - padL - padR, height: y(lo()) - y(hi()) }));
    const ticks = C.mmol() ? [3, 6, 9, 12, 15, 18] : [54, 108, 162, 216, 270, 324];
    for (const tv of ticks) {
      const mg = C.mmol() ? tv * C.MGDL_PER_MMOL : tv;
      if (mg < minMg || mg > maxMg) continue;
      svg.appendChild(sv('line', { class: 'grid', x1: padL, x2: W - padR, y1: y(mg), y2: y(mg) }));
      svg.appendChild(sv('text', { class: 'axis-text', x: W - padR + 4, y: y(mg) + 4 }, String(tv)));
    }
    svg.appendChild(sv('line', { class: 'lim-low', x1: padL, x2: W - padR, y1: y(lo()), y2: y(lo()) }));
    svg.appendChild(sv('line', { class: 'lim-high', x1: padL, x2: W - padR, y1: y(hi()), y2: y(hi()) }));
    [[0, '12a'], [12, '6a'], [24, '12p'], [36, '6p']].forEach(([i, lab]) => svg.appendChild(sv('text', { class: 'axis-text', x: padL + (i / 48) * (W - padL - padR), y: Hh - 6 }, lab)));
    // bands: build continuous segments over bins that have data
    const segs = [];
    let cur = [];
    bins.forEach((b, i) => { if (b) cur.push([i, b]); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      const band = (a, b, cls) => {
        const top = seg.map(([i, v]) => `${x(i)},${y(v[b])}`);
        const bot = seg.slice().reverse().map(([i, v]) => `${x(i)},${y(v[a])}`);
        svg.appendChild(sv('polygon', { class: cls, points: top.concat(bot).join(' ') }));
      };
      band('p10', 'p90', 'agp-outer');
      band('p25', 'p75', 'agp-inner');
      svg.appendChild(sv('polyline', { class: 'agp-med', points: seg.map(([i, v]) => `${x(i)},${y(v.p50)}`).join(' ') }));
    }
    agpGeom = { x, y, W, Hh, padT, padB, bins };
  }
  function agpHover (ev) {
    if (!agpGeom) return;
    const svg = $('agp');
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * agpGeom.W;
    let best = -1, bd = Infinity;
    agpGeom.bins.forEach((b, i) => { if (!b) return; const d = Math.abs(agpGeom.x(i) - px); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    const b = agpGeom.bins[best];
    svg.querySelectorAll('.cross, .cross-dot').forEach((n) => n.remove());
    const cx = agpGeom.x(best);
    svg.appendChild(sv('line', { class: 'cross', x1: cx, x2: cx, y1: agpGeom.padT, y2: agpGeom.Hh - agpGeom.padB }));
    svg.appendChild(sv('circle', { class: 'cross-dot', cx, cy: agpGeom.y(b.p50), r: 5 }));
    const tip = $('agp-tip');
    tip.textContent = '';
    const tLabel = new Date(2000, 0, 1, Math.floor(best / 2), (best % 2) * 30).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    tip.appendChild(el('b', null, tLabel));
    tip.appendChild(el('div', null, 'Typical: ' + C.fmtBG(b.p50) + ' ' + C.unitLabel()));
    tip.appendChild(el('div', 'muted', 'Most days: ' + C.fmtBG(b.p25) + '–' + C.fmtBG(b.p75)));
    tip.hidden = false;
    const left = (cx / agpGeom.W) * r.width;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
  }

  function splitRow (container, title, sub, pLow, pHigh, current) {
    const row = el('div', 'phase-row' + (current ? ' current' : ''));
    const head = el('div', 'ph-head');
    head.appendChild(el('span', 'ph-name', title));
    head.appendChild(el('span', 'ph-avg', sub));
    row.appendChild(head);
    const pIn = Math.max(0, 100 - pLow - pHigh);
    const bar = el('div', 'split');
    [['s-low', pLow], ['s-in', pIn], ['s-high', pHigh]].forEach(([c, v]) => { if (v > 0) { const s = el('span', c); s.style.width = v + '%'; bar.appendChild(s); } });
    bar.setAttribute('aria-label', `${title}: low ${Math.round(pLow)}%, in range ${Math.round(pIn)}%, high ${Math.round(pHigh)}%`);
    row.appendChild(bar);
    const labels = el('div', 'split-labels');
    labels.appendChild(el('span', null, '🔻 ' + Math.round(pLow) + '%'));
    labels.appendChild(el('span', null, '✅ ' + Math.round(pIn) + '%'));
    labels.appendChild(el('span', null, '🔺 ' + Math.round(pHigh) + '%'));
    row.appendChild(labels);
    container.appendChild(row);
  }

  function renderBlocks (res) {
    const box = $('tod-rows');
    box.textContent = '';
    const h = hourOf(Date.now());
    const ranges = { Overnight: [0, 6], Morning: [6, 11], Afternoon: [11, 17], Evening: [17, 22], 'Late night': [22, 24] };
    for (const b of res.blocks) {
      const [a, z] = ranges[b.name.replace(/^\S+\s/, '')] || [0, 0];
      splitRow(box, b.name, 'avg ' + C.fmtBG(b.mean), b.pLow, b.pHigh, h >= a && h < z);
    }
    if (!res.blocks.length) box.appendChild(el('p', 'muted', 'Not enough data yet.'));
  }

  function renderMeals (res) {
    const box = $('meal-rows');
    box.textContent = '';
    const order = ['breakfast', 'lunch', 'dinner', 'snack'];
    const meals = res.meals.slice().sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    if (!meals.length) {
      box.appendChild(el('p', 'muted', 'Log meals with carbs (Log → 🍽️ Food) and you’ll see how each meal affects you here.'));
    }
    for (const m of meals) {
      const row = el('div', 'meal-row');
      row.appendChild(el('div', 'ph-name', SLOT[m.slot]));
      row.appendChild(el('div', 'muted small', `${m.n} meal${m.n === 1 ? '' : 's'} · typical rise +${mmolDiff(m.rise)} · peaks ~${minsText(m.peakMin)} after${m.lowRate ? ` · low after ${Math.round(m.lowRate * 100)}%` : ''}`));
      box.appendChild(row);
    }
    const fbox = $('food-rows');
    fbox.textContent = '';
    const foods = res.foods || [];
    if (foods.length) {
      fbox.appendChild(el('div', 'split-title', 'Your foods (logged 2+ times), biggest rise first'));
      const ul = el('ul', 'ob-list');
      for (const f of foods.slice(0, 8)) {
        const li = el('li');
        const mid = el('div', 'grow');
        mid.appendChild(el('div', 'title', f.name));
        mid.appendChild(el('div', 'muted small', `${f.n} times · ~${Math.round(f.carbs)} g carbs`));
        li.appendChild(mid);
        li.appendChild(el('div', 'right', '+' + mmolDiff(f.rise)));
        ul.appendChild(li);
      }
      fbox.appendChild(ul);
    }
  }

  async function renderWindow (a, b, periodLabel) {
    const d = await loadData(a, b);
    let health = [];
    try { health = window.CGMHubHealth ? await window.CGMHubHealth.load(a, b) : []; } catch (e) { /* no health data */ }
    const res = analyze(d.series, d.trs, { a, b, health });
    const days = Math.max(1, Math.round((Math.min(b, Date.now()) - a) / DAY));
    $('ins-status').textContent = days < 3 ? (periodLabel === 'this day' ? 'Patterns need several days. Switch to Week or Month to see them.' : `Only ${days} day${days === 1 ? '' : 's'} so far in this period. Tap ‹ for the previous one, or try Month.`)
      : res.days ? `Looking at ${periodLabel || res.days + ' days'}: ${res.days} day${res.days === 1 ? '' : 's'} of glucose data` + (d.trs.length ? `, ${d.trs.length} logged entries.` : '. Log meals and doses for more insights.') : 'Not enough glucose data for this period.';
    renderInsights(days < 3 ? { insights: [], days: res.days, quiet: true } : res, periodLabel);
    renderAGP(res); renderBlocks(res); renderMeals(res);
    return { d, res };
  }
  const aw = $('agp-wrap');
  aw.addEventListener('pointermove', agpHover);
  aw.addEventListener('pointerdown', agpHover);
  aw.addEventListener('pointerleave', () => { $('agp-tip').hidden = true; $('agp').querySelectorAll('.cross, .cross-dot').forEach((n) => n.remove()); });

  window.addEventListener('cgmhub:data-imported', () => { wcache.clear(); });

  // ---------- settings: choose insights & trend sections ----------
  const TYPES = [
    ['nightlows', '🌙 Lows overnight'], ['dawn', '🌅 Early-morning rise'], ['mealspike', '📈 Big rises after meals'], ['meallows', '⬇️ Lows after meals'],
    ['rebound', '🎢 Highs after lows'], ['stacked', '🧱 Stacked corrections'], ['unlogged', '🔍 Rises with nothing logged'], ['toughhigh', '⏰ Toughest time of day'],
    ['lowblock', '⚠️ Lows in one time block'], ['lowtime', '🔻 Too much time low'], ['variability', '〰️ Big ups and downs'], ['weekend', '🎉 Weekday vs weekend'],
    ['foods', '🍽️ Foods that spike you'], ['meds', '💊 Meds & supplements'], ['progress', '🌟 Weekly progress'], ['goal', '🎯 Time-in-range goal'],
    ['compression', '🛏️ Compression lows'], ['longhigh', '⏳ Long highs'], ['nobolus', '❓ Meals without a bolus'], ['latebolus', '⏰ Late boluses'],
    ['exerciselow', '🏃 Lows after exercise'], ['latedinner', '🌜 Late dinners'], ['mood', '🙂 Mood & glucose'], ['steps', '👟 Steps & glucose'], ['sleep', '😴 Sleep & glucose'],
  ];
  const SECTIONS = [['agp', 'Your typical day', 'agp-wrap'], ['tod', 'Time of day', 'tod-rows'], ['meals', 'Meals & foods', 'meal-rows'], ['cycle', 'Cycle (your cycle + glucose by phase)', 'cycle-stats', 'phase-rows']];
  function applySections () {
    const off = Array.isArray(C.S.trendOff) ? C.S.trendOff : [];
    SECTIONS.forEach(([id, , ...els]) => els.forEach((e) => { const card = $(e) && $(e).closest('.card'); if (card) card.hidden = off.includes(id); }));
  }
  function checkboxList (boxId, items, key) {
    const box = $(boxId);
    if (!box) return;
    box.textContent = '';
    for (const [id, label] of items) {
      const lab = el('label', 'check');
      const cb = el('input'); cb.type = 'checkbox';
      cb.checked = !(C.S[key] || []).includes(id);
      cb.addEventListener('change', () => {
        const cur = new Set(C.S[key] || []);
        if (cb.checked) cur.delete(id); else cur.add(id);
        C.S[key] = [...cur]; C.saveSettings();
        latestCache = null; applySections();
      });
      lab.append(cb, document.createTextNode(' ' + label));
      box.appendChild(lab);
    }
  }
  C.hooks.view.push((v) => {
    if (v === 'settings') { checkboxList('set-ins', TYPES, 'insOff'); checkboxList('set-trend', SECTIONS, 'trendOff'); }
    if (v === 'trends') applySections();
  });
  applySections();

  // latest 14-day insights, for the game's insight-based quests
  let latestCache = null;
  async function latest () {
    if (latestCache && Date.now() - latestCache.at < 30 * MIN) return latestCache.res;
    const d = await loadData(Date.now() - 14 * DAY, Date.now());
    let health = [];
    try { health = window.CGMHubHealth ? await window.CGMHubHealth.load(Date.now() - 14 * DAY, Date.now()) : []; } catch (e) { /* no health data */ }
    const res = analyze(d.series, d.trs, { health });
    if (res.days) latestCache = { at: Date.now(), res };
    return res;
  }

  // exposed for tests and other modules
  window.CGMHubInsights = { analyze, downsample, latest, TYPES, loadData, renderWindow, renderMainPattern, mainOf };
})();
