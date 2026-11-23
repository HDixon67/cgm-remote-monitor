/* CGM Hub game: a pet companion, XP + levels, forgiving streaks, daily quests and badges.
 * Design rules: XP never goes down; glucose never "punishes"; streaks have freezes;
 * most XP is worked out from your Nightscout data, so it survives a new phone.
 */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const KEY = 'cgmhub.game.v1';

  // ---------- state ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  let G = load() || {};
  G = Object.assign({ on: true, pet: null, days: {}, quests: {}, rerolls: {}, opens: {}, events: {}, badges: {}, seenXp: 0, seenLevel: 1, equipped: null, start: null }, G);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(G)); } catch (e) { /* ignore */ } };

  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const todayKey = () => dayKey(Date.now());
  if (!G.start) { G.start = dayKey(Date.now() - 7 * DAY); save(); } // start with a week of backfill: instant progress
  const keyToTime = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  // count app opens + feature use (for quests/badges)
  function bump (name) { const k = todayKey(); G.events[k] = G.events[k] || {}; G.events[k][name] = (G.events[k][name] || 0) + 1; G.lastUse = G.lastUse || {}; G.lastUse[name] = Date.now(); save(); }
  function used (name, k) { return ((G.events[k || todayKey()] || {})[name]) || 0; }
  function totalUsed (name) { return Object.values(G.events).reduce((s, d) => s + (d[name] || 0), 0); }
  bump('open');
  { const h = new Date().getHours(); if (h >= 6 && h < 9) bump('open_morning'); if (h >= 21) bump('open_night'); }
  // keep the events map small
  Object.keys(G.events).forEach((k) => { if (keyToTime(k) < Date.now() - 60 * DAY) delete G.events[k]; });

  // ---------- pet ----------
  const SPECIES = [['🐱', 'Cat'], ['🐶', 'Dog'], ['🦊', 'Fox'], ['🐰', 'Bunny'], ['🐢', 'Turtle'], ['🐉', 'Dragon'], ['🦄', 'Unicorn'], ['🐧', 'Penguin'], ['🦦', 'Otter']];
  const ITEMS = [[3, '🎀', 'Bow'], [5, '🧣', 'Scarf'], [7, '🎩', 'Top hat'], [9, '🌸', 'Flower crown'], [11, '🕶️', 'Shades'], [13, '🎧', 'Headphones'], [15, '👑', 'Crown'], [18, '🪄', 'Wand'], [21, '🌈', 'Rainbow aura'], [25, '🚀', 'Rocket']];
  const STAGES = [[1, 'Egg'], [2, 'Baby'], [5, 'Kid'], [10, 'Teen'], [16, 'Grown-up'], [25, 'Legend']];
  const levelFor = (xp) => { let L = 1; while (50 * (L + 1) * L <= xp) L++; return L; };
  const xpForLevel = (L) => 50 * L * (L - 1);
  const stageFor = (L) => STAGES.filter(([l]) => L >= l).pop()[1];

  // ---------- data ----------
  let trsCache = { at: 0, list: [] };
  async function allTreatments () {
    if (C.S.demo) return C.treatments;
    if (Date.now() - trsCache.at > 10 * MIN) {
      try {
        const since = keyToTime(G.start);
        const raw = await C.apiGet('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(since).toISOString(), count: '3000' });
        trsCache = { at: Date.now(), list: C.normTreatments(raw), ok: true };
      } catch (e) { trsCache = { at: Date.now(), list: C.treatments, ok: false }; }
    }
    const seen = new Set(trsCache.list.map((t) => t.t + '|' + t.eventType));
    return trsCache.list.concat(C.treatments.filter((t) => !seen.has(t.t + '|' + t.eventType)));
  }

  // ---------- quests ----------
  const QUESTS = {
    log3meals: { icon: '🍽️', text: 'Log 3 meals or snacks', auto: (d) => [d.meals, 3] },
    breakfast: { icon: '🍳', text: 'Log breakfast before 11 AM', auto: (d) => [d.breakfast ? 1 : 0, 1] },
    logdoses: { icon: '💉', text: 'Log 2 insulin doses', auto: (d) => [d.doses, 2] },
    meds: { icon: '💊', text: 'Log your meds or supplements', auto: (d) => [d.meds ? 1 : 0, 1], needs: () => (C.S.meds || []).length > 0 },
    tir: { icon: '🎯', text: 'Spend 70% of today in range', auto: (d) => [Math.round(d.tir || 0), 70], unit: '%' },
    checkin: { icon: '👀', text: 'Check in on CGM Hub 3 times', auto: (d, k) => [used('open', k), 3] },
    calc: { icon: '🧮', text: 'Use the bolus calculator for a meal', auto: (d, k) => [used('calc', k) ? 1 : 0, 1] },
    food: { icon: '🔎', text: 'Look up a food (search or 📷 scan)', auto: (d, k) => [used('food', k) ? 1 : 0, 1] },
    walk: { icon: '🚶', text: 'Take a 10-minute walk after a meal', manual: true, logs: { eventType: 'Exercise', duration: 10, notes: 'Walk after a meal (quest)' } },
    water: { icon: '💧', text: 'Drink a big glass of water', manual: true },
    snackbag: { icon: '🧃', text: 'Check you have low snacks in your bag', manual: true },
    bedcheck: { icon: '🌙', text: 'Check your glucose before bed', manual: true },
    stretch: { icon: '🧘', text: 'Do 5 minutes of stretching', manual: true },
    trends: { icon: '📈', text: 'Peek at your Trends tab', auto: (d, k) => [used('trends', k) ? 1 : 0, 1] },
    // more everyday quests (check themselves)
    water2: { icon: '💧', text: 'Log 2 glasses of water', auto: (d) => [d.waters, 2] },
    exercise: { icon: '🏃', text: 'Log some exercise (any amount!)', auto: (d) => [d.exercise ? 1 : 0, 1] },
    log4: { icon: '📝', text: 'Log 4 things today (food, doses, meds, water)', auto: (d) => [d.logs, 4] },
    morning: { icon: '☀️', text: 'Check in between 6 and 9 AM', auto: (d, k) => [used('open_morning', k) ? 1 : 0, 1] },
    night: { icon: '🌙', text: 'Check in after 9 PM', auto: (d, k) => [used('open_night', k) ? 1 : 0, 1] },
    streak3h: { icon: '🎯', text: 'Stay in range 3 hours in a row', auto: (d) => [Math.min(3, d.run3h), 3], unit: 'h' },
    fav: { icon: '⭐', text: 'Log a favourite meal', auto: (d, k) => [used('fav', k) ? 1 : 0, 1] },
    dinnerEarly: { icon: '🍝', text: 'Log dinner before 8 PM', auto: (d) => [d.dinnerEarly ? 1 : 0, 1] },
    // more tap-to-finish quests
    veggies: { icon: '🥦', text: 'Eat veggies or protein first at a meal', manual: true },
    sunlight: { icon: '🌤️', text: 'Get 5 minutes of fresh air', manual: true },
    sleep: { icon: '🛌', text: 'Be in bed by 11 PM', manual: true },
    mealprep: { icon: '🥣', text: 'Plan tomorrow’s breakfast', manual: true },
    pens: { icon: '🖊️', text: 'Check your pen needles & insulin supply', manual: true },
    sensor: { icon: '📟', text: 'Check your sensor patch is still stuck on well', manual: true },
    breathe: { icon: '🌬️', text: 'Take 1 minute of slow breaths', manual: true },
    kind: { icon: '💖', text: 'Do one nice thing for yourself', manual: true },
    // quests picked from your insights
    walk_breakfast: { icon: '🚶', text: 'Walk 10 minutes after breakfast', manual: true, insight: true, logs: { eventType: 'Exercise', duration: 10, notes: 'Walk after breakfast (quest)' } },
    walk_lunch: { icon: '🚶', text: 'Walk 10 minutes after lunch', manual: true, insight: true, logs: { eventType: 'Exercise', duration: 10, notes: 'Walk after lunch (quest)' } },
    walk_dinner: { icon: '🚶', text: 'Walk 10 minutes after dinner', manual: true, insight: true, logs: { eventType: 'Exercise', duration: 10, notes: 'Walk after dinner (quest)' } },
    juicebed: { icon: '🧃', text: 'Put fast sugar next to your bed', manual: true, insight: true },
    rule1515: { icon: '⏱️', text: 'Treat any low with the 15-15 rule today (or restock glucose tabs)', manual: true, insight: true },
    snackready: { icon: '🍎', text: 'Keep a snack handy 2–3 hours after meals', manual: true, insight: true },
    pennear: { icon: '🖊️', text: 'Keep your pen where you eat today', manual: true, insight: true },
    moveblock: { icon: '💃', text: 'Move for 10 minutes during your toughest time of day', manual: true, insight: true, logs: { eventType: 'Exercise', duration: 10, notes: 'Move 10 min (quest)' } },
    exsnack: { icon: '🥨', text: 'Have a snack after exercise', manual: true, insight: true },
    sleepside: { icon: '🛏️', text: 'Sleep on your non-sensor side tonight', manual: true, insight: true },
    routine: { icon: '🗓️', text: 'Eat at your usual weekday times today', manual: true, insight: true },
  };
  // steps quest (Health Connect): goal = your recent average + 15%, rounded to 500
  function stepGoal () {
    const HL = window.CGMHubHealth;
    const days = HL ? HL.cachedRange(keyToTime(todayKey()) - 7 * DAY, keyToTime(todayKey())).filter((s) => s.steps > 0) : [];
    if (days.length < 3) return null;
    const avg = days.reduce((a, s) => a + s.steps, 0) / days.length;
    return Math.max(3000, Math.round((avg * 1.15) / 500) * 500);
  }
  QUESTS.steps = {
    icon: '👟', text: (p, k) => `Walk ${(((G.quests[k || todayKey()] || {}).stepGoal) || 6000).toLocaleString()} steps today`,
    needs: () => !!stepGoal(),
    auto: (d, k) => { const goal = (G.quests[k] || {}).stepGoal || 6000; const s = window.CGMHubHealth && window.CGMHubHealth.cachedDay(k); return [s ? s.steps || 0 : 0, goal]; },
  };
  // nutrient quest: target comes from your own last-7-days averages (see pickNutrient)
  QUESTS.nutrient = {
    icon: '🥗', special: true,
    text: (p) => (p ? (p.kind === 'max' ? `Keep ${p.label.toLowerCase()} under ${p.goal} ${p.unit} today` : `Get ${p.goal} ${p.unit} of ${p.label.toLowerCase()} today`) : 'Eat a balanced meal'),
    auto: (d, k) => {
      const p = (G.quests[k] || {}).nut;
      if (!p) return [0, 1];
      const v = (d.nut || {})[p.key] || 0;
      if (p.kind === 'max') { const late = k !== todayKey() || new Date().getHours() >= 20; return [late && d.meals >= 2 && v <= p.goal ? 1 : 0, 1]; }
      return [Math.round(v * 10) / 10, p.goal];
    },
  };
  // which quest helps with which insight
  const INSIGHT_QUEST = {
    nightlows: ['juicebed', 'bedcheck'], dawn: ['morning', 'bedcheck'], meallows: ['snackready'], rebound: ['rule1515'],
    stacked: ['calc'], unlogged: ['log4'], toughhigh: ['moveblock'], lowblock: ['snackbag'], lowtime: ['snackbag', 'rule1515'],
    variability: ['veggies', 'calc'], foods: ['food', 'veggies'], longhigh: ['water2', 'pens'], nobolus: ['calc', 'pennear'],
    latebolus: ['pennear'], exerciselow: ['exsnack'], latedinner: ['dinnerEarly'], compression: ['sleepside'], weekend: ['routine'],
  };
  let latestInsights = null;
  let latestNutrient = null;
  // lowest nutrient over the last 7 days (needs full-nutrition meals on 3+ days); goal = halfway to target
  function pickNutrient (trs) {
    const N = window.CGMHubNutrition;
    if (!N) return null;
    const t0 = keyToTime(todayKey());
    const recent = trs.filter((t) => t.t >= t0 - 7 * DAY && t.t < t0);
    const { sum, days } = N.totalsOf(recent);
    if (days < 3) return null;
    const tg = N.targets();
    const round = (v, unit) => (unit === 'g' ? Math.max(1, Math.round(v)) : unit === 'mg' ? Math.round(v / 10) * 10 : Math.round(v * 10) / 10);
    let best = null;
    for (const n of N.NUTS) {
      if (n.kind !== 'min' || !tg[n.key] || sum[n.key] == null || n.key === 'vitD') continue; // vitamin D: hard to get from food, usually a supplement
      const avg = sum[n.key] / days, pct = avg / tg[n.key];
      if (pct < 0.7 && (!best || pct < best.pct)) best = { n, avg, pct };
    }
    if (best) {
      const goal = round(best.avg + (tg[best.n.key] - best.avg) / 2, best.n.unit);
      return { key: best.n.key, label: best.n.label, unit: best.n.unit, kind: 'min', goal, why: `🥗 You average ${round(best.avg, best.n.unit)} ${best.n.unit} ${best.n.label.toLowerCase()}/day (target ${tg[best.n.key]}). Halfway there is today’s goal.` };
    }
    for (const n of N.NUTS) {
      if (n.kind !== 'max' || !tg[n.key] || sum[n.key] == null) continue;
      const avg = sum[n.key] / days;
      if (avg > tg[n.key] * 1.1) return { key: n.key, label: n.label, unit: n.unit, kind: 'max', goal: tg[n.key], why: `🥗 You average ${round(avg, n.unit)} ${n.unit} ${n.label.toLowerCase()}/day (limit ${tg[n.key]}). Checks itself after 8 PM.` };
    }
    return null;
  }
  function hash (s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function questsFor (k) {
    if (G.quests[k] && G.quests[k].ids) return G.quests[k].ids;
    const seed = hash(k + ':' + (G.rerolls[k] || 0));
    const pick = (arr, n, s) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) { s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; out.push(a.splice(s % a.length, 1)[0]); } return out; };
    // 1) one quest picked from your insights (biggest issue first; rotates on re-roll)
    const why = {};
    const ids = [];
    const ins = k === todayKey() ? (latestInsights || []).filter((i) => INSIGHT_QUEST[i.id]) : [];
    if (ins.length) {
      const i = ins[(G.rerolls[k] || 0) % ins.length];
      let options = INSIGHT_QUEST[i.id];
      if (i.id === 'mealspike' && i.slot && QUESTS['walk_' + i.slot]) options = ['walk_' + i.slot, 'veggies'];
      const id = pick(options, 1, seed)[0];
      ids.push(id);
      why[id] = i.icon + ' ' + i.title + (i.block ? ' (' + i.block.replace(/^\S+\s/, '').toLowerCase() + ')' : '');
    }
    // 2) fill with everyday quests: auto first, then a tap-to-finish one
    let nut = null;
    if (k === todayKey() && latestNutrient) { nut = latestNutrient; ids.push('nutrient'); why.nutrient = nut.why; }
    const ok = (id) => !ids.includes(id) && !QUESTS[id].insight && !QUESTS[id].special && (!QUESTS[id].needs || QUESTS[id].needs());
    const auto = Object.keys(QUESTS).filter((id) => !QUESTS[id].manual && ok(id));
    const manual = Object.keys(QUESTS).filter((id) => QUESTS[id].manual && ok(id));
    const hasManual = ids.some((id) => QUESTS[id].manual);
    const wantAuto = Math.max(0, 3 - ids.length - (hasManual ? 0 : 1)); // always one tap-to-finish quest
    ids.push(...pick(auto, Math.min(wantAuto, 3 - ids.length), seed));
    ids.push(...pick(manual, 3 - ids.length, seed ^ 0x9e3779b9));
    G.quests[k] = { ids, why, nut, stepGoal: ids.includes('steps') ? stepGoal() : undefined, done: (G.quests[k] && G.quests[k].done) || [] };
    save();
    return ids;
  }
  function questState (id, k, d) {
    const q = QUESTS[id];
    if (q.manual) { const done = ((G.quests[k] || {}).done || []).includes(id); return { done, prog: done ? 1 : 0, goal: 1 }; }
    const [prog, goal] = q.auto(d, k);
    return { done: prog >= goal, prog: Math.min(prog, goal), goal };
  }

  // =====================================================================
  // ✨ Side quests: optional, situational, bonus XP only (never a "fail")
  // Built from right now: your number, trend, insulin/carbs on board, time of day, meds, cycle, steps, insights.
  // =====================================================================
  const SIDE_XP_CAP = 150; // per day, so XP stays meaningful
  function sideDay (k) { G.side = G.side || {}; return (G.side[k] = G.side[k] || { done: {}, at: {} }); }
  function lastUse (name) { return ((G.lastUse || {})[name]) || 0; }
  const isMeal = (t) => t.carbs > 0;
  const isBolus = (t) => t.insulin > 0 && !C.isBasal(t);
  function sideCtx () {
    const now = Date.now(), L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const ents = C.entries; // newest first
    const cur = ents[0] && now - ents[0].t < 15 * MIN ? ents[0] : null;
    let slope = 0;
    if (cur) { const e15 = ents.find((e) => cur.t - e.t >= 12 * MIN); if (e15) slope = (cur.mg - e15.mg) / ((cur.t - e15.t) / MIN); }
    const runOf = (test) => { if (!cur || !test(cur.mg)) return 0; let s = cur.t; for (const e of ents) { if (!test(e.mg)) break; s = e.t; } return (now - s) / MIN; };
    const trs = C.treatments;
    const all = (trsCache.list || []).concat(trs);
    const d0 = keyToTime(todayKey());
    const at = (h, m) => d0 + h * HOUR + (m || 0) * MIN;
    return {
      now, L, H, cur, slope, ob: C.onBoard(), hour: new Date().getHours(), trs, all, d0, at,
      highFor: runOf((v) => v > H), inFor: runOf((v) => v >= L && v <= H),
      lowRecent: ents.some((e) => now - e.t < 45 * MIN && e.mg < L),
      since: (t0, f) => trs.some((t) => t.t >= t0 && t.t <= now + MIN && f(t)),
    };
  }
  const openSheet = (name) => () => { C.go('log'); if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet(name); };
  // each: base id, priority (lower = shown first), xp, icon, text, show(ctx) → truthy, optional check(ctx, rec) for auto-done
  const SIDE = [
    { base: 'low', pri: 0, xp: 20, icon: '🧃', block: true, text: () => 'Treat the low: 15 g fast sugar, then recheck in 15 min', why: (c) => 'You’re at ' + C.fmtBG(c.cur.mg), show: (c) => c.cur && c.cur.mg < c.L },
    { base: 'bedsnack', pri: 1, xp: 15, icon: '🍪', text: () => 'Small bedtime snack: you’re on the lower side with insulin on board', show: (c) => c.hour >= 21 && c.cur && c.cur.mg >= c.L && c.cur.mg < 108 && c.ob.iob > 0.3 },
    { base: 'dropping', pri: 1, xp: 10, icon: '🍬', block: true, text: () => 'Dropping with insulin on board: keep a snack in reach', show: (c) => c.cur && c.cur.mg >= c.L && c.cur.mg < c.L + 45 && c.slope <= -1.5 && c.ob.iob > 0.5 },
    { base: 'nobolus', pri: 1, xp: 15, icon: '💉', block: true, text: () => 'Did you bolus for that meal? Log it', action: ['Log insulin', openSheet('rapid')],
      show: (c) => { const m = c.trs.find((t) => isMeal(t) && t.carbs >= 10 && !t.insulin && c.now - t.t < 45 * MIN); return m && !c.since(m.t - 20 * MIN, isBolus) ? { base: m.t } : false; },
      check: (c, r) => c.since((r.base || r.t) - 20 * MIN, isBolus) },
    { base: 'basal', pri: 1, xp: 20, icon: '💉', text: () => 'Long-acting insulin: taken it? Log it', action: ['Log it', openSheet('basal')],
      show: (c) => {
        const b = c.all.filter((t) => C.isBasal(t) && c.now - t.t < 10 * DAY);
        if (b.length < 2 || b.some((t) => c.now - t.t < 20 * HOUR)) return false;
        const mins = b.map((t) => { const d = new Date(t.t); return d.getHours() * 60 + d.getMinutes(); }).sort((x, y) => x - y);
        return c.now > c.at(0, mins[Math.floor(mins.length / 2)] + 30);
      },
      check: (c) => c.all.some((t) => C.isBasal(t) && c.now - t.t < 20 * HOUR) },
    { base: 'correct', pri: 2, xp: 15, icon: '🧮', block: true, text: () => 'You’re high: check if you need a correction', action: ['Open calculator', () => C.go('calc')],
      why: (c) => 'At ' + C.fmtBG(c.cur.mg) + ', no rapid insulin in 2 h',
      show: (c) => c.cur && c.cur.mg > c.H && c.slope > -0.5 && !c.since(c.now - 2 * HOUR, isBolus), check: (c, r) => lastUse('calc') >= r.t || c.since(r.t, isBolus) },
    { base: 'ketones', pri: 2, xp: 15, icon: '🧪', block: true, text: () => 'Check for ketones (skip exercise if you have them)', show: (c) => c.cur && c.cur.mg >= 270 && c.highFor >= 60 },
    { base: 'bounce', pri: 3, xp: 10, icon: '🦸', block: true, text: () => 'You bounced back! A little protein helps it stick', show: (c) => c.cur && c.cur.mg >= c.L && c.lowRecent },
    { base: 'med', pri: 3, xp: 10, icon: '💊', multi: true, action: ['Open meds', openSheet('meds')] }, // built per scheduled dose below
    { base: 'water_high', pri: 4, xp: 10, icon: '💧', block: true, text: () => 'Drink a big glass of water', why: (c) => 'High for ' + C.durText(c.highFor * MIN), action: ['Log water', openSheet('water')],
      show: (c) => c.highFor >= 90, check: (c, r) => c.since(r.t, (t) => t.eventType === 'Water') },
    { base: 'site', pri: 4, xp: 10, icon: '🖊️', text: () => 'Stubborn high: is your insulin OK? (expired or got warm?) Try a fresh needle', show: (c) => c.highFor >= 180 },
    { base: 'bedcheck', pri: 4, xp: 10, icon: '🌙', text: () => 'Bedtime: glance at your number and put sugar by the bed', show: (c) => c.hour >= 21 },
    { base: 'breakfast', pri: 5, xp: 10, icon: '🍳', text: () => 'Log breakfast (a guess is totally fine)', action: ['Log food', openSheet('food')],
      show: (c) => c.hour >= 6 && c.hour < 11 && !c.since(c.at(4), isMeal), check: (c) => c.since(c.at(4), isMeal) },
    { base: 'lunch', pri: 5, xp: 10, icon: '🥪', text: () => 'Log lunch (a guess is totally fine)', action: ['Log food', openSheet('food')],
      show: (c) => c.hour >= 12 && c.hour < 15 && !c.since(c.at(11), isMeal), check: (c) => c.since(c.at(11), isMeal) },
    { base: 'dinner', pri: 5, xp: 10, icon: '🍝', text: () => 'Log dinner (a guess is totally fine)', action: ['Log food', openSheet('food')],
      show: (c) => c.hour >= 18 && c.hour < 22 && !c.since(c.at(16), isMeal), check: (c) => c.since(c.at(16), isMeal) },
    { base: 'walk_high', pri: 5, xp: 15, icon: '🚶', block: true, text: () => '10-minute walk to help bring it down', logs: { eventType: 'Exercise', duration: 10, notes: 'Walk to bring a high down (side quest)' },
      show: (c) => c.cur && c.cur.mg > c.H && c.cur.mg < 250 && c.hour >= 8 && c.hour < 22 },
    { base: 'stroll', pri: 5, xp: 15, icon: '🚶', block: true, text: () => 'Post-meal stroll: 10 minutes', logs: { eventType: 'Exercise', duration: 10, notes: 'Walk after a meal (side quest)' },
      show: (c) => c.hour < 22 && !(c.cur && c.cur.mg > c.H) && c.trs.some((t) => isMeal(t) && c.now - t.t > 20 * MIN && c.now - t.t < 90 * MIN) },
    { base: 'ride', pri: 6, xp: 15, icon: '🌊', block: true, text: (c, r) => 'Ride the wave: stay in range one more hour' + (r ? ` (${Math.max(0, Math.ceil(60 - (c.now - r.t) / MIN))} min to go)` : ''),
      show: (c) => c.inFor >= 120, check: (c, r) => c.inFor * MIN >= c.now - r.t && c.now - r.t >= 60 * MIN },
    { base: 'water_day', pri: 7, xp: 10, icon: '💧', text: () => 'Water break!', action: ['Log water', openSheet('water')],
      show: (c) => c.hour >= 13 && c.hour < 18 && c.trs.filter((t) => t.t >= c.d0 && t.eventType === 'Water').length < 2, check: (c, r) => c.since(r.t, (t) => t.eventType === 'Water') },
    { base: 'mood', pri: 7, xp: 10, icon: '🙂', text: () => 'Quick mood check-in', action: ['Check in', () => window.CGMHubLogHub && window.CGMHubLogHub.openMood()],
      show: (c) => c.hour >= 12 && !c.since(c.d0, (t) => t.eventType === 'Mood'), check: (c) => c.since(c.d0, (t) => t.eventType === 'Mood') },
    { base: 'steps', pri: 7, xp: 15, icon: '👟', text: (c, r) => '1,000 more steps' + (r && r.base != null ? ` (from ${Number(r.base).toLocaleString()})` : ''),
      show: (c) => { const H2 = window.CGMHubHealth; const s = H2 && H2.cachedDay(todayKey()); const goal = stepGoal(); return c.hour >= 14 && c.hour < 21 && s && goal && s.steps < goal ? { base: s.steps } : false; },
      check: (c, r) => { const s = window.CGMHubHealth && window.CGMHubHealth.cachedDay(todayKey()); return !!s && r.base != null && s.steps >= r.base + 1000; } },
    { base: 'cycle', pri: 8, xp: 5, icon: '🌸', text: (c) => c.phase === 'luteal' ? 'Luteal phase: sugars can run higher. Extra water and a gentle walk today' : 'Period days: be gentle with yourself. A warm drink counts 💛',
      show: (c) => { try { const F = window.CGMHubFeatures; const m = F.cycleModel(); const p = m.cycles.length && F.phaseAt(c.now, m); if (p && (p.phase === 'luteal' || p.phase === 'menstrual')) { c.phase = p.phase; return true; } } catch (e) { /* no cycle data */ } return false; } },
    { base: 'ins', pri: 8, xp: 10, icon: '💡', multi: true }, // from your top patterns, built below
    { base: 'care', pri: 9, xp: 5, icon: '💖', multi: true }, // small self-care, rotates every 3 hours
  ];
  const SIDE_BY = Object.fromEntries(SIDE.map((d) => [d.base, d]));
  const CARE = [['breathe', '🌬️', 'One minute of slow breaths'], ['kind', '💖', 'Do one nice thing for yourself'], ['sunlight', '🌤️', '5 minutes of fresh air'], ['stretch', '🧘', 'Stretch for 2 minutes'], ['sip', '🫖', 'Make yourself a drink you like'], ['tidy', '🧺', 'Restock your low snacks'], ['text', '💬', 'Message someone you like']];

  // the multi-quests (one per med dose, insight, self-care) for right now
  function multiSide (c) {
    const out = [];
    const block = Math.floor(c.hour / 3);
    // 💊 scheduled doses 30+ min past due and not logged
    const meds = window.CGMHubLogHub ? window.CGMHubLogHub.meds() : [];
    for (const m of meds) {
      if (!Array.isArray(m.times) || !m.name) continue;
      const taken = c.trs.filter((t) => t.t >= c.d0 && t.kind === 'med' && String(t.medName || t.notes || '').toLowerCase().startsWith(m.name.toLowerCase())).length;
      m.times.forEach((time, n) => {
        const [h, mm] = time.split(':').map(Number);
        if (c.now > c.at(h, mm + 30) && taken <= n) out.push({ id: 'med:' + m.name + ':' + n, def: SIDE_BY.med, text: `Take your ${m.name}${m.dose ? ' (' + m.dose + ')' : ''}`, why: 'Due ' + C.clockTime(c.at(h, mm)) });
      });
    }
    // 💡 from your top patterns (not the one already in today's quests)
    const daily = (G.quests[todayKey()] || {}).ids || [];
    (latestInsights || []).filter((i) => INSIGHT_QUEST[i.id]).slice(0, 3).forEach((i) => {
      const q = INSIGHT_QUEST[i.id].find((id) => QUESTS[id] && QUESTS[id].manual && !daily.includes(id));
      if (q && !out.some((o) => o.qid === q)) out.push({ id: 'ins:' + q, qid: q, def: SIDE_BY.ins, icon: QUESTS[q].icon, text: QUESTS[q].text, why: i.icon + ' ' + i.title, logs: QUESTS[q].logs });
    });
    // 💖 two small self-care ideas, rotating every 3 hours
    const s = hash(todayKey() + ':' + block);
    [CARE[s % CARE.length], CARE[(s >>> 8) % CARE.length]].filter((x, i, a) => a.indexOf(x) === i)
      .forEach(([id, ic, text]) => out.push({ id: 'care:' + id + '@' + block, def: SIDE_BY.care, icon: ic, text }));
    return out;
  }

  // what's open right now + auto-finish anything done; returns { open, done, xp }
  function sideQuests () {
    if (!C.entries.length && !C.treatments.length) return { open: [], done: 0, xp: 0 };
    const c = sideCtx(), k = todayKey(), day = sideDay(k);
    const block = Math.floor(c.hour / 3);
    const live = [];
    for (const d of SIDE) {
      if (d.multi) continue;
      let r = false; try { r = d.show(c); } catch (e) { r = false; }
      if (!r) continue;
      live.push({ id: d.base + (d.block ? '@' + block : ''), def: d, base: r && r.base != null ? r.base : undefined });
    }
    live.push(...multiSide(c));
    for (const q of live) if (!day.at[q.id]) day.at[q.id] = { t: c.now, base: q.base };
    // auto-finish (also ones offered earlier whose situation has passed)
    let total = Object.values(day.done).reduce((a, b) => a + b, 0);
    const finished = [];
    for (const id of Object.keys(day.at)) {
      if (day.done[id] != null) continue;
      const d = SIDE_BY[id.split(/[@:]/)[0]];
      if (!d || !d.check) continue;
      let ok = false; try { ok = d.check(c, day.at[id]); } catch (e) { ok = false; }
      if (ok) { const xp = Math.max(0, Math.min(d.xp, SIDE_XP_CAP - total)); day.done[id] = xp; total += xp; finished.push(d); }
    }
    if (finished.length) { toast('✨ Side quest done! +' + finished.reduce((a, d) => a + d.xp, 0) + ' XP'); }
    // tidy old days
    for (const key of Object.keys(G.side)) if (keyToTime(key) < keyToTime(k) - 14 * DAY) { G.sideOld = (G.sideOld || 0) + Object.keys(G.side[key].done).length; delete G.side[key]; }
    save();
    const open = live.filter((q) => day.done[q.id] == null).map((q) => {
      const d = q.def, rec = day.at[q.id];
      return {
        id: q.id, pri: d.pri, xp: d.xp, icon: q.icon || d.icon, auto: !!d.check, action: d.action, logs: q.logs || d.logs,
        text: q.text || d.text(c, rec), why: q.why || (d.why ? d.why(c) : ''),
      };
    }).sort((a, b) => a.pri - b.pri);
    return { open, done: Object.keys(day.done).length, xp: total };
  }
  function finishSide (q) {
    const day = sideDay(todayKey());
    if (day.done[q.id] != null) return;
    const total = Object.values(day.done).reduce((a, b) => a + b, 0);
    day.done[q.id] = Math.max(0, Math.min(q.xp, SIDE_XP_CAP - total));
    save();
    if (q.logs) C.apiPostTreatment(Object.assign({ created_at: new Date().toISOString(), enteredBy: 'CGM Hub' }, q.logs)).catch(() => { /* the quest still counts */ });
  }
  function sideRow (q, compact) {
    const row = el('div', 'quest side' + (compact ? ' compact' : ''));
    row.appendChild(el('span', 'q-ic', q.icon));
    const mid = el('div', 'grow');
    mid.appendChild(el('div', 'q-text', q.text));
    const sub = [q.why, '+' + q.xp + ' XP', q.auto ? 'checks itself' : ''].filter(Boolean).join(' · ');
    mid.appendChild(el('div', 'muted small', sub));
    row.appendChild(mid);
    const btns = el('div', 'q-btns');
    if (q.action) { const a = el('button', 'btn slim', q.action[0]); a.type = 'button'; a.addEventListener('click', (e) => { e.stopPropagation(); q.action[1](); }); btns.appendChild(a); }
    if (!q.auto) { const b = el('button', 'btn slim primary', 'Done'); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); finishSide(q); confetti(); render(); }); btns.appendChild(b); }
    row.appendChild(btns);
    return row;
  }
  let sideAll = false;
  function renderSide (sq) {
    // Game tab
    const box = $('side-list');
    if (box) {
      box.textContent = '';
      const list = sideAll ? sq.open : sq.open.slice(0, 5);
      if (!sq.open.length) box.appendChild(el('p', 'muted small', 'Nothing right now. New ones pop up as your day changes.'));
      list.forEach((q) => box.appendChild(sideRow(q)));
      $('side-more').hidden = sq.open.length <= 5;
      $('side-more').textContent = sideAll ? 'Show fewer' : `Show all ${sq.open.length}`;
      $('side-sum').textContent = sq.done ? `✅ ${sq.done} done today · +${sq.xp} XP` : 'Totally optional · bonus XP';
    }
    // Home: the top 2 as gentle reminders
    const home = $('side-home');
    if (home) {
      home.textContent = '';
      home.hidden = !sq.open.length || C.S.sideHome === false;
      if (!home.hidden) {
        const head = el('div', 'card-head');
        head.appendChild(el('h2', null, '✨ Side quests'));
        const more = el('button', 'link', sq.open.length > 2 ? `All ${sq.open.length} ›` : 'More ›'); more.type = 'button'; more.addEventListener('click', () => C.go('game'));
        head.appendChild(more);
        home.appendChild(head);
        sq.open.slice(0, 2).forEach((q) => home.appendChild(sideRow(q, true)));
        home.appendChild(el('div', 'muted small', 'Optional bonus XP. Skip any of them, no streaks lost.'));
      }
    }
  }

  // ---------- scoring a day ----------
  function scoreDay (k, trs) {
    const t0 = keyToTime(k), t1 = t0 + DAY;
    const L = C.toMg(C.S.low), H = C.toMg(C.S.high);
    const items = [];
    const add = (label, xp, icon) => { if (xp > 0) items.push({ label, xp: Math.round(xp), icon }); };
    const dayTrs = trs.filter((t) => t.t >= t0 && t.t < t1);
    const meals = dayTrs.filter((t) => t.carbs > 0);
    const doses = dayTrs.filter((t) => t.insulin > 0);
    const meds = dayTrs.filter((t) => t.kind === 'med');
    const periods = dayTrs.filter((t) => t.kind === 'period-start' || t.kind === 'period-end');
    add(`Logged ${Math.min(meals.length, 5)} meal${meals.length === 1 ? '' : 's'}`, Math.min(meals.length, 5) * 10, '🍽️');
    add(`Logged ${Math.min(doses.length, 6)} dose${doses.length === 1 ? '' : 's'}`, Math.min(doses.length, 6) * 5, '💉');
    add(`Logged meds ×${Math.min(meds.length, 5)}`, Math.min(meds.length, 5) * 5, '💊');
    add('Period logged', periods.length ? 15 : 0, '🩸');
    if (used('open', k)) add('Daily check-in', 5, '👋');

    // glucose
    const pts = C.entries.filter((e) => e.t >= t0 && e.t < t1).sort((a, b) => a.t - b.t);
    let tir = null;
    if (pts.length >= 12) {
      // in-range hours: each hour where ≥75% of readings are in range
      const hours = {};
      for (const p of pts) { const h = new Date(p.t).getHours(); const o = hours[h] || (hours[h] = [0, 0]); o[1]++; if (p.mg >= L && p.mg <= H) o[0]++; }
      const good = Object.values(hours).filter(([a, b]) => b && a / b >= 0.75).length;
      add(`${good} in-range hour${good === 1 ? '' : 's'}`, good * 2, '⏱️');
      tir = (pts.filter((p) => p.mg >= L && p.mg <= H).length / pts.length) * 100;
      const complete = t1 <= Date.now() || Date.now() - t0 > 20 * HOUR;
      if (complete && tir >= 70) add('Good day (70%+ in range)', 25, '🌤️');
      if (complete && tir >= 85) add('Great day (85%+ in range)', 25, '🌟');
      const night = pts.filter((p) => new Date(p.t).getHours() < 6);
      if (night.length >= 24 && night.every((p) => p.mg >= L && p.mg <= H)) add('Sweet dreams: in range all night', 20, '😴');
      // lows handled well
      let i = 0, handled = 0, smooth = 0;
      while (i < pts.length) {
        if (pts[i].mg < L) {
          const s = pts[i].t; let j = i;
          while (j + 1 < pts.length && pts[j + 1].mg < L && pts[j + 1].t - pts[j].t <= 15 * MIN) j++;
          const end = pts[j].t;
          const back = pts.find((p) => p.t > end && p.mg >= L);
          if (back && back.t - s <= 30 * MIN) handled++;
          const after = C.entries.filter((e) => e.t > end && e.t <= end + 2.5 * HOUR);
          if (back && after.length >= 20 && !after.some((e) => e.mg > H)) smooth++;
          i = j + 1;
        } else i++;
      }
      add(`Low handled quickly ×${handled}`, handled * 20, '🦸');
      add(`Smooth recovery (no rebound) ×${smooth}`, smooth * 15, '🧘');
    }

    // quests
    let run3h = 0;
    { let start = null; for (const p of pts) { if (p.mg >= L && p.mg <= H) { if (start === null) start = p.t; run3h = Math.max(run3h, (p.t - start) / HOUR); } else start = null; } }
    const d = {
      meals: meals.length, breakfast: meals.some((t) => new Date(t.t).getHours() < 11), doses: doses.length, meds: meds.length > 0, tir,
      waters: dayTrs.filter((t) => t.eventType === 'Water').length, exercise: dayTrs.some((t) => t.eventType === 'Exercise'),
      logs: dayTrs.length, run3h: Math.floor(run3h), dinnerEarly: meals.some((t) => { const h = new Date(t.t).getHours(); return h >= 16 && h < 20; }),
    };
    d.nut = {};
    for (const t of dayTrs) if (t.nutrients) for (const key in t.nutrients) d.nut[key] = (d.nut[key] || 0) + (Number(t.nutrients[key]) || 0);
    const seenEx = new Set();
    for (const ex of [G.experiment].concat(G.pastExperiments || [])) {
      if (!ex || seenEx.has(ex.id + '|' + ex.start)) continue; // the current one is also in the past list once finished
      seenEx.add(ex.id + '|' + ex.start);
      if (ex.days && ex.days[k]) add('Experiment day: ' + ex.title, 40, '🧪');
      if (ex.bonusDay === k) add('Experiment finished!', 150, '🏆');
    }
    const ids = questsFor(k);
    const states = ids.map((id) => questState(id, k, d));
    const nDone = states.filter((s) => s.done).length;
    add(`Quests done: ${nDone}/3`, nDone * 30, '⚔️');
    if (nDone === 3) add('All quests bonus', 30, '🏆');
    { const sd = (G.side || {})[k]; const n = sd ? Object.keys(sd.done).length : 0; if (n) add(`Side quests ×${n}`, Object.values(sd.done).reduce((a, b) => a + b, 0), '✨'); }

    const xp = items.reduce((s, x) => s + x.xp, 0);
    return { xp, items, d, logged: dayTrs.length > 0, tir, quests: ids.map((id, n) => ({ id, ...states[n] })), nDone };
  }

  // ---------- full game state ----------
  let lastSide = { open: [], done: 0, xp: 0 };
  async function compute () {
    const trs = await allTreatments();
    try { lastSide = sideQuests(); } catch (e) { console.error(e); }
    if (!G.quests[todayKey()]) { try { latestNutrient = pickNutrient(trs); } catch (e) { latestNutrient = null; } }
    finishExperimentIfDue();
    if (!G.quests[todayKey()] && window.CGMHubInsights && C.entries.length) {
      try {
        const res = await Promise.race([window.CGMHubInsights.latest(), new Promise((r) => setTimeout(() => r(null), 4000))]);
        if (res) latestInsights = res.insights;
      } catch (e) { /* quests still work without insights */ }
    }
    const today = todayKey();
    const days = [];
    for (let t = keyToTime(G.start); t <= Date.now(); t += DAY) days.push(dayKey(t + 2 * HOUR));
    const covered = C.entries.length ? C.entries[C.entries.length - 1].t : Infinity;
    let total = 0;
    const res = {};
    for (const k of days) {
      const frozen = G.days[k];
      if (frozen && frozen.final && k !== today) { res[k] = frozen; total += frozen.xp; continue; }
      const s = scoreDay(k, trs);
      res[k] = s;
      total += s.xp;
      // freeze finished days once their data is loaded (keeps old XP after entries scroll out of memory)
      const finished = keyToTime(k) + DAY + 3 * HOUR < Date.now();
      if (finished && keyToTime(k) >= covered - DAY && (trsCache.ok || C.S.demo)) G.days[k] = { xp: s.xp, items: s.items, logged: s.logged, nDone: s.nDone, tir: s.tir, final: true };
    }
    // streak with freezes: earn 1 freeze per 7 streak days (max 2)
    let streak = 0, freezes = 0, best = 0, run7 = 0;
    for (const k of days) {
      const s = res[k];
      if (s.logged || k === today) {
        if (s.logged) { streak++; run7++; if (run7 === 7) { freezes = Math.min(2, freezes + 1); run7 = 0; } }
      } else if (freezes > 0) { freezes--; s.frozen = true; } else { streak = 0; run7 = 0; }
      best = Math.max(best, streak);
    }
    G.bestStreak = Math.max(G.bestStreak || 0, best);
    { const tq = res[today] && res[today].quests && res[today].quests.find((q) => q.id === 'nutrient'); if (tq && tq.done) { G.nutDone = G.nutDone || {}; G.nutDone[today] = true; } }
    save();
    return { total, days: res, today: res[today], streak, freezes, level: levelFor(total) };
  }

  // ---------- badges ----------
  const BADGES = [
    ['first', '🌱', 'First steps', 'Log anything', (s) => Object.values(s.days).some((d) => d.logged)],
    ['week', '📅', 'One week in', 'Use CGM Hub for 7 days', (s) => Object.keys(s.days).length >= 8],
    ['streak7', '🔥', 'On fire', '7-day logging streak', (s) => (G.bestStreak || 0) >= 7],
    ['streak30', '☄️', 'Unstoppable', '30-day logging streak', (s) => (G.bestStreak || 0) >= 30],
    ['great', '🌟', 'Great day', 'A day with 85%+ in range', (s) => Object.values(s.days).some((d) => d.tir >= 85 && d.items.some((i) => /Great day/.test(i.label)))],
    ['dreams', '😴', 'Sweet dreams ×3', '3 nights fully in range', (s) => Object.values(s.days).filter((d) => d.items.some((i) => /Sweet dreams/.test(i.label))).length >= 3],
    ['lowhero', '🦸', 'Low hero', 'Handle 5 lows quickly', (s) => Object.values(s.days).reduce((n, d) => n + (d.items.find((i) => /Low handled/.test(i.label)) || { xp: 0 }).xp / 20, 0) >= 5],
    ['quests', '🏆', 'Quest master', 'Finish all 3 quests on 5 days', (s) => Object.values(s.days).filter((d) => d.nDone === 3).length >= 5],
    ['scanner', '📷', 'Scanner', 'Look up a food', () => totalUsed('food') > 0],
    ['cycle', '🩸', 'Cycle tracker', 'Log 2 periods', () => C.periods.filter((p) => p.kind === 'period-start').length >= 2],
    ['l5', '⭐', 'Level 5', 'Reach level 5', (s) => s.level >= 5],
    ['l10', '💫', 'Level 10', 'Reach level 10', (s) => s.level >= 10],
    ['l20', '🌠', 'Level 20', 'Reach level 20', (s) => s.level >= 20],
    ['scientist', '🧪', 'Scientist', 'Finish a 7-day experiment (5+ days)', () => (G.pastExperiments || []).some((e) => e.success)],
    ['nutrition', '🥗', 'Well fed', 'Finish 5 nutrient quests', () => Object.keys(G.nutDone || {}).length >= 5],
    ['adventurer', '🗺️', 'Adventurer', 'Finish 25 side quests', () => Object.values(G.side || {}).reduce((a, d) => a + Object.keys(d.done).length, 0) + (G.sideOld || 0) >= 25],
  ];

  // ---------- celebrations ----------
  function toast (text) {
    const t = el('div', 'toast', text);
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }
  function confetti () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = el('div', 'confetti');
    for (let i = 0; i < 24; i++) {
      const s = el('span', null, ['🎉', '⭐', '✨', '💖', '🌟'][i % 5]);
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDelay = Math.random() * 0.4 + 's';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2600);
  }

  // ---------- rendering ----------
  function petView (level, mood) {
    const wrap = el('div', 'pet-stage');
    const sp = G.pet ? G.pet.emoji : '🥚';
    const body = el('div', 'pet-body ' + mood, level < 2 ? '🥚' : sp);
    body.style.fontSize = Math.min(5.2, 2.6 + level * 0.15) + 'rem';
    wrap.appendChild(body);
    const eq = G.equipped && ITEMS.find((x) => x[1] === G.equipped && level >= x[0]);
    if (eq) wrap.appendChild(el('div', 'pet-item', eq[1]));
    return wrap;
  }
  function moodFor (s) {
    const cur = C.entries[0];
    if (cur && Date.now() - cur.t < 15 * MIN && cur.mg < C.toMg(C.S.low)) return ['cheer', '❤️ You’ve got this. Fast sugar first, then we’ll wait it out together.'];
    const xp = s.today ? s.today.xp : 0;
    if (s.today && s.today.nDone === 3) return ['party', 'All quests done! I’m so proud of you! 🎉'];
    if (xp >= 100) return ['happy', 'Great work today! Keep going ✨'];
    if (xp > 0) return ['content', 'Nice! Every log helps us both.'];
    return ['sleepy', 'Zzz… log something to wake me up 😴'];
  }

  let lastState = null;
  async function render () {
    if (!G.on) { $('pet-card').hidden = true; if ($('side-home')) $('side-home').hidden = true; return; }
    const s = await compute();
    lastState = s;
    const L = s.level, cur = s.total - xpForLevel(L), need = xpForLevel(L + 1) - xpForLevel(L);
    const [mood, msg] = moodFor(s);

    // home card
    const card = $('pet-card');
    card.hidden = false;
    card.textContent = '';
    card.appendChild(petView(L, mood));
    const info = el('div', 'pet-info');
    info.appendChild(el('div', 'pet-name', (G.pet ? G.pet.name : 'Your egg') + ' · Lv ' + L));
    const bar = el('div', 'bar xp'); const fill = el('span'); fill.style.width = Math.min(100, (cur / need) * 100) + '%'; bar.appendChild(fill); info.appendChild(bar);
    const done = s.today ? s.today.nDone : 0;
    const ex = G.experiment && !G.experiment.finished ? ` · 🧪 ${Math.min(expDayIndex(G.experiment), EXP_DAYS)}/${EXP_DAYS}` : '';
    info.appendChild(el('div', 'muted small', `${cur}/${need} XP · 🔥 ${s.streak}${s.freezes ? ' · ❄️' + s.freezes : ''} · ⚔️ ${done}/3 quests${ex}`));
    card.appendChild(info);

    // celebrations for new XP since last look
    if (G.seenXp && s.total > G.seenXp) toast('+' + (s.total - G.seenXp) + ' XP ✨');
    if (L > (G.seenLevel || 1) && G.pet) {
      confetti();
      const unlocked = ITEMS.filter(([l]) => l > (G.seenLevel || 1) && l <= L).map((x) => x[1] + ' ' + x[2]);
      levelUp(L, unlocked);
    }
    const newBadges = BADGES.filter(([id, , , , test]) => !G.badges[id] && test(s));
    newBadges.forEach(([id]) => { G.badges[id] = todayKey(); });
    if (newBadges.length === 1) toast(newBadges[0][1] + ' Badge: ' + newBadges[0][2]);
    else if (newBadges.length > 1) toast('🏅 ' + newBadges.length + ' new badges! ' + newBadges.map((b) => b[1]).join(''));
    if (newBadges.length && L <= (G.seenLevel || 1)) confetti();
    G.seenXp = s.total; G.seenLevel = L; save();

    renderSide(lastSide);
    if (!$('view-game').hidden) renderGameView(s, mood, msg);
  }

  function levelUp (L, unlocked) {
    const m = $('levelup');
    m.hidden = false;
    $('lu-pet').textContent = '';
    $('lu-pet').appendChild(petView(L, 'party'));
    $('lu-title').textContent = 'Level ' + L + '!';
    $('lu-text').textContent = (L === 2 ? 'Your egg hatched! ' : '') + (G.pet ? G.pet.name : 'Your pet') + ' is now a ' + stageFor(L).toLowerCase() + '.' + (unlocked.length ? ' Unlocked: ' + unlocked.join(', ') + '!' : '');
  }

  function renderGameView (s, mood, msg) {
    const L = s.level, cur = s.total - xpForLevel(L), need = xpForLevel(L + 1) - xpForLevel(L);
    // pet panel
    const pp = $('game-pet'); pp.textContent = '';
    pp.appendChild(petView(L, mood));
    pp.appendChild(el('div', 'pet-name big', (G.pet ? G.pet.name : 'Your egg') + ' · ' + stageFor(L)));
    pp.appendChild(el('p', 'pet-msg', msg));
    const bar = el('div', 'bar xp'); const fill = el('span'); fill.style.width = Math.min(100, (cur / need) * 100) + '%'; bar.appendChild(fill); pp.appendChild(bar);
    pp.appendChild(el('div', 'muted small', `Level ${L} · ${cur} / ${need} XP to level ${L + 1} · ${s.total.toLocaleString()} XP total`));
    if (!G.pet) $('pet-pick').hidden = false;

    // streak
    $('game-streak').textContent = '';
    const st = $('game-streak');
    [['🔥', s.streak, 'day streak'], ['❄️', s.freezes, 'freeze' + (s.freezes === 1 ? '' : 's')], ['🏅', G.bestStreak || 0, 'best streak']].forEach(([ic, v, l]) => {
      const t = el('div', 'tile'); t.appendChild(el('div', 't-label', ic + ' ' + l)); t.appendChild(el('div', 't-value', String(v))); st.appendChild(t);
    });

    renderExperiment();
    // quests
    const ql = $('quest-list'); ql.textContent = '';
    for (const q of s.today.quests) {
      const def = QUESTS[q.id];
      const row = el('div', 'quest' + (q.done ? ' done' : ''));
      row.appendChild(el('span', 'q-ic', q.done ? '✅' : def.icon));
      const mid = el('div', 'grow');
      const qp = (G.quests[todayKey()] || {}).nut;
      mid.appendChild(el('div', 'q-text', typeof def.text === 'function' ? def.text(qp, todayKey()) : def.text));
      const why = ((G.quests[todayKey()] || {}).why || {})[q.id];
      if (why) mid.appendChild(el('div', 'q-why', q.id === 'nutrient' ? why : '💡 From your insights: ' + why));
      if (!def.manual) {
        const b = el('div', 'bar q'); const f = el('span'); f.style.width = (q.prog / q.goal) * 100 + '%'; b.appendChild(f); mid.appendChild(b);
        const un = q.id === 'nutrient' && qp ? ' ' + qp.unit : q.id === 'steps' ? ' steps' : (def.unit || '');
        mid.appendChild(el('div', 'muted small', q.done ? 'Done! +30 XP' : q.id === 'nutrient' && qp && qp.kind === 'max' ? 'checks itself after 8 PM' : `${q.prog}${un} / ${q.goal}${un} · checks itself`));
      } else mid.appendChild(el('div', 'muted small', q.done ? 'Done! +30 XP' : 'Tap “Done” when you’ve done it'));
      row.appendChild(mid);
      if (def.manual && !q.done) {
        const btn = el('button', 'btn slim primary', 'Done'); btn.type = 'button';
        btn.addEventListener('click', async () => {
          const k = todayKey();
          G.quests[k].done = (G.quests[k].done || []).concat([q.id]); save();
          if (def.logs) { try { await C.apiPostTreatment(Object.assign({ created_at: new Date().toISOString(), enteredBy: 'CGM Hub' }, def.logs)); } catch (e) { /* the quest still counts */ } }
          confetti();
          render();
        });
        row.appendChild(btn);
      }
      ql.appendChild(row);
    }
    const k = todayKey();
    $('quest-reroll').hidden = (G.rerolls[k] || 0) >= 1 || s.today.nDone > 0;

    // today's XP
    const xl = $('xp-list'); xl.textContent = '';
    if (!s.today.items.length) xl.appendChild(el('li', 'empty', 'No XP yet today. Log anything to get started!'));
    for (const it of s.today.items) {
      const li = el('li');
      li.appendChild(el('span', 'ic other', it.icon || '✨'));
      li.appendChild(el('div', 'grow title', it.label));
      li.appendChild(el('div', 'right', '+' + it.xp));
      xl.appendChild(li);
    }

    // wardrobe
    const wd = $('wardrobe'); wd.textContent = '';
    for (const [lvl, ic, name] of ITEMS) {
      const ok = L >= lvl;
      const b = el('button', 'wear' + (G.equipped === ic && ok ? ' on' : '') + (ok ? '' : ' locked'));
      b.type = 'button'; b.disabled = !ok;
      b.appendChild(el('span', 'w-ic', ok ? ic : '🔒'));
      b.appendChild(el('small', null, ok ? name : 'Lv ' + lvl));
      b.addEventListener('click', () => { G.equipped = G.equipped === ic ? null : ic; save(); render(); });
      wd.appendChild(b);
    }

    // badges
    const bd = $('badges'); bd.textContent = '';
    for (const [id, ic, name, how] of BADGES) {
      const got = !!G.badges[id];
      const b = el('div', 'badge' + (got ? '' : ' locked'));
      b.appendChild(el('span', 'b-ic', got ? ic : '❔'));
      b.appendChild(el('b', null, name));
      b.appendChild(el('small', null, got ? 'Earned ' + new Date(keyToTime(G.badges[id])).toLocaleDateString([], { month: 'short', day: 'numeric' }) : how));
      bd.appendChild(b);
    }
  }

  function renderPetPicker () {
    const box = $('species'); box.textContent = '';
    SPECIES.forEach(([emoji, name]) => {
      const b = el('button', 'wear' + (G.pet && G.pet.emoji === emoji ? ' on' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'w-ic', emoji));
      b.appendChild(el('small', null, name));
      b.addEventListener('click', () => { box.querySelectorAll('.wear').forEach((x) => x.classList.remove('on')); b.classList.add('on'); box.dataset.pick = emoji; });
      box.appendChild(b);
    });
    $('pet-name-in').value = G.pet ? G.pet.name : '';
  }

  // ---------- wiring ----------
  $('pet-card').addEventListener('click', () => C.go('game'));
  $('pet-edit').addEventListener('click', () => { $('pet-pick').hidden = !$('pet-pick').hidden; renderPetPicker(); });
  $('pet-save').addEventListener('click', () => {
    const emoji = $('species').dataset.pick || (G.pet && G.pet.emoji) || '🐱';
    const name = $('pet-name-in').value.trim().slice(0, 20) || SPECIES.find((x) => x[0] === emoji)[1];
    G.pet = { emoji, name }; save();
    $('pet-pick').hidden = true;
    render();
  });
  $('set-side-home').checked = C.S.sideHome !== false;
  $('set-side-home').addEventListener('change', () => { C.S.sideHome = $('set-side-home').checked; C.saveSettings(); renderSide(lastSide); });
  $('side-more').addEventListener('click', () => { sideAll = !sideAll; renderSide(lastSide); });
  $('quest-reroll').addEventListener('click', () => {
    const k = todayKey();
    G.rerolls[k] = (G.rerolls[k] || 0) + 1;
    delete G.quests[k];
    save(); render();
  });
  $('lu-close').addEventListener('click', () => { $('levelup').hidden = true; });
  $('game-toggle').checked = G.on;
  $('game-toggle').addEventListener('change', () => { G.on = $('game-toggle').checked; save(); render(); });

  // feature use for quests
  $('calc-log').addEventListener('click', () => bump('calc'));
  $('food-form').addEventListener('submit', () => bump('food'));
  $('scan-form').addEventListener('submit', () => bump('food'));
  $('scan-open').addEventListener('click', () => bump('food'));
  $('fav-list').addEventListener('click', (e) => { if (e.target.closest('.chip')) bump('fav'); });

  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(render, 150); };
  C.hooks.render.push(soon);
  C.hooks.logSaved.push(soon);
  C.hooks.view.push((v) => {
    if (v === 'trends') bump('trends');
    if (v === 'game') { if (!G.pet) { $('pet-pick').hidden = false; renderPetPicker(); } soon(); }
  });

  // =====================================================================
  // 🧪 7-day experiments (started from a pattern card)
  // =====================================================================
  const EXP_DAYS = 7, EXP_NEED = 5;
  function expDayIndex (ex) { return Math.floor((keyToTime(todayKey()) - keyToTime(ex.start)) / DAY) + 1; }
  function startExperiment (ins) {
    if (G.experiment && !G.experiment.finished && G.experiment.id !== ins.id && !confirm('Stop your current experiment (' + G.experiment.title + ') and start this one?')) return false;
    if (G.experiment && G.experiment.id === ins.id && !G.experiment.finished) { C.go('game'); return true; }
    if (G.experiment && Object.keys(G.experiment.days || {}).length) G.pastExperiments = (G.pastExperiments || []).concat([Object.assign({}, G.experiment, { finished: true })]);
    G.experiment = { id: ins.id, title: ins.title, icon: ins.icon, text: ins.experiment, start: todayKey(), days: {}, finished: false };
    save();
    toast('🧪 Experiment started! Check in each day.');
    C.go('game');
    render();
    return true;
  }
  function finishExperimentIfDue () {
    const ex = G.experiment;
    if (!ex || ex.finished || expDayIndex(ex) <= EXP_DAYS) return;
    const n = Object.keys(ex.days).length;
    ex.finished = true;
    ex.success = n >= EXP_NEED;
    if (ex.success) ex.bonusDay = todayKey();
    G.pastExperiments = (G.pastExperiments || []).concat([ex]);
    save();
    measureResult(ex);
  }
  // before (14 days before the start) vs during (the 7 experiment days), using the same pattern detector
  async function measureResult (ex) {
    const I = window.CGMHubInsights;
    if (!I) return;
    try {
      const s0 = keyToTime(ex.start);
      const count = async (a, b) => {
        const d = await I.loadData(a, b);
        const res = I.analyze(d.series, d.trs);
        const ins = res.insights.find((x) => x.id === ex.id);
        const elig = ins && ins.dots ? ins.dots.filter((x) => x.hit !== null).length : res.days;
        const hits = ins ? (ins.hits ?? 1) : 0;
        return { hits, elig: Math.max(elig, 1) };
      };
      const before = await count(s0 - 14 * DAY, s0), during = await count(s0, s0 + EXP_DAYS * DAY);
      const rb = before.hits / before.elig, rd = during.hits / during.elig;
      ex.result = { before, during, better: rd < rb - 0.05, worse: rd > rb + 0.05 };
      save();
      render();
    } catch (e) { /* result is optional */ }
  }
  function renderExperiment () {
    const card = $('exp-card');
    if (!card) return;
    const ex = G.experiment;
    card.hidden = !ex;
    if (!ex) return;
    card.textContent = '';
    const head = el('div', 'card-head');
    head.appendChild(el('h2', null, '🧪 Your experiment'));
    card.appendChild(head);
    card.appendChild(el('div', 'b', ex.icon + ' ' + ex.title));
    card.appendChild(el('p', null, ex.text));
    const dots = el('div', 'exp-dots');
    const idx = expDayIndex(ex);
    for (let i = 1; i <= EXP_DAYS; i++) {
      const k = dayKey(keyToTime(ex.start) + (i - 1) * DAY + 2 * HOUR);
      const d = el('span', 'exp-dot' + (ex.days[k] ? ' on' : '') + (i === idx && !ex.finished ? ' now' : '') + (i < idx && !ex.days[k] ? ' miss' : ''), ex.days[k] ? '✓' : String(i));
      d.title = 'Day ' + i;
      dots.appendChild(d);
    }
    card.appendChild(dots);
    const n = Object.keys(ex.days).length;
    if (!ex.finished) {
      card.appendChild(el('div', 'muted small', `Day ${Math.min(idx, EXP_DAYS)} of ${EXP_DAYS} · ${n} done · do it on ${EXP_NEED} days for +150 XP (missing a day or two is fine)`));
      if (!ex.days[todayKey()]) {
        const b = el('button', 'btn primary', 'I did it today ✓ (+40 XP)'); b.type = 'button';
        b.addEventListener('click', () => { ex.days[todayKey()] = true; save(); confetti(); render(); });
        card.appendChild(b);
      } else card.appendChild(el('p', 'small', '✅ Done for today. See you tomorrow!'));
    } else {
      card.appendChild(el('p', 'b', ex.success ? `🏆 Finished! You did it on ${n} of ${EXP_DAYS} days.` : `Finished: ${n} of ${EXP_DAYS} days. Want to try again?`));
      if (ex.result) {
        const r = ex.result;
        card.appendChild(el('p', null, `Before: ${r.before.hits} of ${r.before.elig} · During: ${r.during.hits} of ${r.during.elig}. ` + (r.better ? 'It happened less often. 🎉 Worth keeping up, and worth telling your care team.' : r.worse ? 'It happened more often this week. That’s useful to know too. Try a different experiment, or talk it over with your care team.' : 'About the same so far. One week is short; patterns can take longer to shift.')));
      } else card.appendChild(el('p', 'muted small', 'Working out before vs after…'));
      const again = el('button', 'btn', 'Clear and pick a new one in Trends'); again.type = 'button';
      again.addEventListener('click', () => { G.experiment = null; save(); C.go('trends'); });
      card.appendChild(again);
    }
  }

  window.CGMHubGame = { levelFor, xpForLevel, scoreDay, startExperiment, get experiment () { return G.experiment; }, get state () { return lastState; } };
})();
