/* CGM Hub: "Did you eat?" Spots a fast rise with nothing logged and offers a one-tap log.
 * The same check runs in the reminders job (reminders/reminders.mjs) to send a Pushover nudge. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, HOUR } = C;
  const KEY = 'cgmhub.didEat.v1';

  // ents: newest first [{t, mg}]; trs: [{t, carbs, insulin, basal}]. Returns null or { from, rise, cur, ate }.
  // Keep in sync with unloggedRise() in reminders/reminders.mjs.
  function detect (ents, trs, now, lowMg) {
    const cur = ents[0];
    if (!cur || now - cur.t > 15 * MIN) return null;
    const win = ents.filter((e) => cur.t - e.t <= 75 * MIN);
    if (win.length < 5) return null;
    const near = win.filter((e) => cur.t - e.t <= 6 * MIN);
    const curMg = near.reduce((a, e) => a + e.mg, 0) / near.length;
    const before = win.filter((e) => cur.t - e.t >= 15 * MIN);
    if (!before.length) return null;
    const low = before.reduce((a, e) => (e.mg < a.mg ? e : a));
    const e20 = win.find((e) => cur.t - e.t >= 20 * MIN);
    if (curMg - low.mg < 45 || curMg < 130 || !e20 || curMg - e20.mg < 15) return null;
    if (ents.some((e) => now - e.t < 2 * HOUR && e.mg < lowMg)) return null; // a rebound after a low, not a meal
    if (trs.some((t) => t.carbs > 0 && t.t >= low.t - 2 * HOUR && t.t <= now + MIN)) return null;
    if (trs.some((t) => t.insulin > 0 && !t.basal && t.t >= low.t - HOUR && t.t <= now + MIN)) return null;
    return { from: low.t, rise: curMg - low.mg, cur: curMg, ate: low.t - 10 * MIN };
  }

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  let box = null;
  function render () {
    if (!box) {
      box = el('div', 'card did-eat');
      box.id = 'did-eat';
      box.hidden = true;
      box.setAttribute('role', 'status');
      const anchor = $('brief-open');
      if (!anchor) return;
      anchor.parentNode.insertBefore(box, anchor);
    }
    const now = Date.now();
    const hit = C.S.didEatOff ? null : detect(C.entries, C.treatments.map((t) => ({ t: t.t, carbs: t.carbs, insulin: t.insulin, basal: C.isBasal(t) })), now, C.toMg(C.S.low));
    const st = read();
    const dismissed = hit && st.from && Math.abs(hit.from - st.from) < 45 * MIN && now - (st.at || 0) < 4 * HOUR;
    box.hidden = !hit || dismissed;
    if (box.hidden) return;
    box.textContent = '';
    box.appendChild(el('div', 'de-title', '🍽️ Did you eat?'));
    const up = C.mmol() ? (hit.rise / C.MGDL_PER_MMOL).toFixed(1) : String(Math.round(hit.rise));
    box.appendChild(el('p', 'muted small', `You’ve gone up ${up} ${C.unitLabel()} since ${C.clockTime(hit.from)} and nothing’s logged. If you ate, a guess is fine. Did you bolus?`));
    const row = el('div', 'de-btns');
    const yes = el('button', 'btn primary slim', 'Log food'); yes.type = 'button';
    yes.addEventListener('click', () => {
      C.go('log');
      if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet('food');
      $('log-time').value = C.toLocalInput(new Date(Math.min(hit.ate, Date.now())));
    });
    const ins = el('button', 'btn slim', 'Insulin only'); ins.type = 'button';
    ins.addEventListener('click', () => { C.go('log'); if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet('rapid'); });
    const no = el('button', 'btn slim ghost', 'Not food'); no.type = 'button';
    no.addEventListener('click', () => { write({ from: hit.from, at: Date.now() }); box.hidden = true; });
    row.append(yes, ins, no);
    box.appendChild(row);
  }

  C.hooks.render.push(render);
  C.hooks.logSaved.push(render);
  window.CGMHubDidEat = { detect, render };
})();
