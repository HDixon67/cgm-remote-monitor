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
  function bump (name) { const k = todayKey(); G.events[k] = G.events[k] || {}; G.events[k][name] = (G.events[k][name] || 0) + 1; save(); }
  function used (name, k) { return ((G.events[k || todayKey()] || {})[name]) || 0; }
  function totalUsed (name) { return Object.values(G.events).reduce((s, d) => s + (d[name] || 0), 0); }
  bump('open');
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
  };
  function hash (s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function questsFor (k) {
    if (G.quests[k] && G.quests[k].ids) return G.quests[k].ids;
    const auto = Object.keys(QUESTS).filter((id) => !QUESTS[id].manual && (!QUESTS[id].needs || QUESTS[id].needs()));
    const manual = Object.keys(QUESTS).filter((id) => QUESTS[id].manual);
    const seed = hash(k + ':' + (G.rerolls[k] || 0));
    const pick = (arr, n, s) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) { s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; out.push(a.splice(s % a.length, 1)[0]); } return out; };
    const ids = pick(auto, 2, seed).concat(pick(manual, 1, seed ^ 0x9e3779b9));
    G.quests[k] = { ids, done: (G.quests[k] && G.quests[k].done) || [] };
    save();
    return ids;
  }
  function questState (id, k, d) {
    const q = QUESTS[id];
    if (q.manual) { const done = ((G.quests[k] || {}).done || []).includes(id); return { done, prog: done ? 1 : 0, goal: 1 }; }
    const [prog, goal] = q.auto(d, k);
    return { done: prog >= goal, prog: Math.min(prog, goal), goal };
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
    const d = { meals: meals.length, breakfast: meals.some((t) => new Date(t.t).getHours() < 11), doses: doses.length, meds: meds.length > 0, tir };
    const ids = questsFor(k);
    const states = ids.map((id) => questState(id, k, d));
    const nDone = states.filter((s) => s.done).length;
    add(`Quests done: ${nDone}/3`, nDone * 30, '⚔️');
    if (nDone === 3) add('All quests bonus', 30, '🏆');

    const xp = items.reduce((s, x) => s + x.xp, 0);
    return { xp, items, d, logged: dayTrs.length > 0, tir, quests: ids.map((id, n) => ({ id, ...states[n] })), nDone };
  }

  // ---------- full game state ----------
  async function compute () {
    const trs = await allTreatments();
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
    if (!G.on) { $('pet-card').hidden = true; return; }
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
    info.appendChild(el('div', 'muted small', `${cur}/${need} XP · 🔥 ${s.streak}${s.freezes ? ' · ❄️' + s.freezes : ''} · ⚔️ ${done}/3 quests`));
    card.appendChild(info);

    // celebrations for new XP since last look
    if (G.seenXp && s.total > G.seenXp) toast('+' + (s.total - G.seenXp) + ' XP ✨');
    if (L > (G.seenLevel || 1) && G.pet) {
      confetti();
      const unlocked = ITEMS.filter(([l]) => l > (G.seenLevel || 1) && l <= L).map((x) => x[1] + ' ' + x[2]);
      levelUp(L, unlocked);
    }
    const newBadges = BADGES.filter(([id, , , , test]) => !G.badges[id] && test(s));
    newBadges.forEach(([id, ic, name]) => { G.badges[id] = todayKey(); toast(ic + ' Badge: ' + name); });
    if (newBadges.length && L <= (G.seenLevel || 1)) confetti();
    G.seenXp = s.total; G.seenLevel = L; save();

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

    // quests
    const ql = $('quest-list'); ql.textContent = '';
    for (const q of s.today.quests) {
      const def = QUESTS[q.id];
      const row = el('div', 'quest' + (q.done ? ' done' : ''));
      row.appendChild(el('span', 'q-ic', q.done ? '✅' : def.icon));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'q-text', def.text));
      if (!def.manual) {
        const b = el('div', 'bar q'); const f = el('span'); f.style.width = (q.prog / q.goal) * 100 + '%'; b.appendChild(f); mid.appendChild(b);
        mid.appendChild(el('div', 'muted small', q.done ? 'Done! +30 XP' : `${q.prog}${def.unit || ''} / ${q.goal}${def.unit || ''} · checks itself`));
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

  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(render, 150); };
  C.hooks.render.push(soon);
  C.hooks.logSaved.push(soon);
  C.hooks.view.push((v) => {
    if (v === 'trends') bump('trends');
    if (v === 'game') { if (!G.pet) { $('pet-pick').hidden = false; renderPetPicker(); } soon(); }
  });

  window.CGMHubGame = { levelFor, xpForLevel, scoreDay, get state () { return lastState; } };
})();
