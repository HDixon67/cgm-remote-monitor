/* CGM Hub: the bolus calculator built into the Food and Rapid insulin sheets.
 * The dose box fills itself from the calculator (carbs + your current glucose + insulin on board).
 * "How it's worked out" shows the maths. You can change the dose, but then it asks why,
 * and saves the suggestion and your reason with the log so patterns can be spotted later. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el } = C;
  const REASONS = ['🏃 Exercise soon', '📉 Trending down', '📈 Trending up', '💉 Already took some', '🍕 Fatty / slow meal', '🤒 Sick or stressed', '🩸 Period / cycle', '🎯 Gut feeling'];

  const SHEETS = {
    food: { box: 'dose-food', insulin: 'log-insulin', carbs: () => Number($('log-carbs').value) || 0, msg: 'log-msg' },
    rapid: { box: 'dose-rapid', insulin: 'rapid-units', carbs: () => (st.rapid.meal ? st.rapid.meal.carbs : 0), msg: 'rapid-msg' },
  };
  const st = {}; // per sheet: { touched, bg (typed glucose or null), reason, other, res }
  const S0 = () => ({ touched: false, bg: null, reason: '', other: '', res: null, open: false });
  Object.keys(SHEETS).forEach((k) => { st[k] = S0(); });

  const val = (k) => { const v = $(SHEETS[k].insulin).value.trim(); return v === '' ? null : Number(v); };
  function differs (k) {
    const s = st[k], r = s.res;
    if (!r || !r.ready || !s.touched) return false;
    const v = val(k);
    if (v == null) return k === 'food' && r.shown > 0; // emptied a suggested dose on purpose
    return Math.abs(v - r.shown) >= 0.05;
  }

  function update (k) {
    const cfg = SHEETS[k], s = st[k], box = $(cfg.box);
    if (!box) return;
    const carbs = cfg.carbs();
    const r = C.calcFor(carbs, s.bg);
    s.res = r;
    if (r.ready && !s.touched) {
      // fill the dose; for a correction, only when the calculator suggests one
      // food sheet: only once there are carbs (a correction on its own goes in 💧 Rapid insulin)
      $(cfg.insulin).value = k === 'food' && !carbs ? '' : r.shown > 0 ? String(r.shown) : (k === 'food' ? '0' : '');
    }
    render(k);
  }

  function render (k) {
    const cfg = SHEETS[k], s = st[k], r = s.res, box = $(cfg.box);
    box.textContent = '';
    if (!r) return;
    if (k === 'rapid' && s.meal) {
      const mb = el('div', 'dh-meal');
      mb.appendChild(el('span', null, '🍽️ For ' + s.meal.label + ' · ' + Math.round(s.meal.carbs) + ' g carbs' + (/cronometer/i.test(s.meal.from || '') ? ' (from Cronometer)' : '') + ', logged without insulin'));
      const no = el('button', 'link', 'Not for this meal'); no.type = 'button';
      no.addEventListener('click', () => { s.meal = null; s.touched = false; update(k); });
      mb.appendChild(no);
      const ago = Math.round((Date.now() - s.meal.t) / 60e3);
      if (ago >= 30) mb.appendChild(el('div', 'dh-late', `⚠️ Eaten ${ago} min ago. Some of it may already be in your glucose, so the correction part could count it twice. Double-check before dosing.`));
      box.appendChild(mb);
    }
    if (!r.ready) {
      box.appendChild(el('p', 'muted small', '🧮 Want the dose filled in for you? In Settings, add: ' + r.missing.join(', ') + '.'));
      return;
    }
    const top = el('div', 'dh-top');
    const line = el('div', 'dh-line');
    line.appendChild(document.createTextNode('🧮 Calculator: '));
    line.appendChild(el('b', null, r.shown + ' u'));
    if (k === 'food' && !SHEETS.food.carbs()) line.appendChild(el('span', 'muted', ' · add food or carbs and the dose fills in'));
    else if (r.isLow) line.appendChild(el('span', 'dh-low', ' · you’re low, treat that first'));
    else if (r.bgSrc === 'none') line.appendChild(el('span', 'muted', ' · no fresh glucose, so no correction'));
    top.appendChild(line);
    if (differs(k)) {
      const back = el('button', 'link', '↺ Use ' + r.shown + ' u'); back.type = 'button';
      back.addEventListener('click', () => { s.touched = false; s.reason = ''; s.other = ''; update(k); });
      top.appendChild(back);
    }
    box.appendChild(top);

    // the maths, in a dropdown
    const det = el('details', 'dh-math');
    det.open = s.open;
    det.addEventListener('toggle', () => { s.open = det.open; });
    det.appendChild(el('summary', null, 'How it’s worked out'));
    const bgRow = el('label', 'field dh-bg');
    bgRow.appendChild(el('span', null, 'Glucose used (' + C.unitLabel() + ')' + (r.bgSrc === 'cgm' ? ' · from your CGM' + (r.bgAge != null ? ', ' + (r.bgAge < 60000 ? 'just now' : C.durText(r.bgAge) + ' ago') : '') : '')));
    const bgIn = el('input'); bgIn.type = 'number'; bgIn.inputMode = 'decimal'; bgIn.step = '0.1'; bgIn.min = '0';
    bgIn.value = r.bg != null ? String(r.bg) : '';
    bgIn.placeholder = 'type your glucose';
    bgIn.addEventListener('change', () => { s.bg = bgIn.value.trim() === '' ? null : Number(bgIn.value); update(k); });
    bgRow.appendChild(bgIn);
    det.appendChild(bgRow);
    const ol = el('ol', 'calc-steps');
    for (const step of r.steps) { const li = el('li', null, step.text); if (step.why) li.appendChild(el('span', 'why', step.why)); ol.appendChild(li); }
    det.appendChild(ol);
    box.appendChild(det);

    // a different dose → why?
    if (differs(k)) {
      const wrap = el('div', 'dh-why');
      wrap.appendChild(el('div', 'dh-why-q', 'Why a different dose? (saved with the log, to help spot patterns)'));
      const chips = el('div', 'chips');
      for (const txt of REASONS.concat(['✏️ Other'])) {
        const c = el('button', 'chip' + (s.reason === txt ? ' on' : ''), txt); c.type = 'button';
        c.setAttribute('aria-pressed', String(s.reason === txt));
        c.addEventListener('click', () => { s.reason = s.reason === txt ? '' : txt; render(k); if (s.reason === '✏️ Other') { const o = $(cfg.box).querySelector('.dh-other'); if (o) o.focus(); } });
        chips.appendChild(c);
      }
      wrap.appendChild(chips);
      const other = el('input', 'dh-other'); other.type = 'text'; other.maxLength = 80;
      other.placeholder = s.reason === '✏️ Other' ? 'What’s different this time?' : 'Add detail (optional)';
      other.value = s.other;
      other.setAttribute('aria-label', 'Reason for a different dose');
      other.addEventListener('input', () => { s.other = other.value; });
      wrap.appendChild(other);
      box.appendChild(wrap);
    }
  }

  // for the save buttons: { block: message } or { fields } to add to the log
  function check (k) {
    const s = st[k], r = s.res;
    if (!r || !r.ready) return { fields: {} };
    const fields = { suggestedInsulin: r.shown };
    if (k === 'rapid' && s.meal) { fields.eventType = 'Meal Bolus'; fields.forMeal = new Date(s.meal.t).toISOString(); fields.forMealCarbs = s.meal.carbs; fields.notes = 'Bolus for ' + s.meal.label + ' (' + Math.round(s.meal.carbs) + ' g)'; }
    if (r.bg != null) { fields.calcGlucose = r.bg; fields.calcGlucoseFrom = r.bgSrc; }
    if (differs(k)) {
      const chip = s.reason && s.reason !== '✏️ Other' ? s.reason.replace(/^\S+\s/, '') : ''; // drop the emoji
      const reason = [chip, s.other.trim()].filter(Boolean).join(' · ');
      if (!reason) return { block: 'You changed the calculator’s dose (' + r.shown + ' u). Tap a quick reason first, or ↺ use ' + r.shown + ' u.' };
      fields.doseReason = reason;
    }
    return { fields };
  }
  const isBolus = (t) => t.insulin > 0 && !C.isBasal(t);
  function mealNeedingInsulin () {
    const now = Date.now();
    return C.treatments.find((m) => m.carbs >= 5 && !m.insulin && now - m.t < 2 * 3600e3 && now - m.t > -60e3 &&
      !C.treatments.some((t) => isBolus(t) && t.t >= m.t - 20 * 60e3)) || null;
  }
  function reset (k) {
    st[k] = S0();
    if (k === 'rapid') { const m = mealNeedingInsulin(); if (m) st.rapid.meal = { t: m.t, carbs: m.carbs, label: (m.raw && m.raw.mealGroup ? m.raw.mealGroup : 'Meal') + ' ' + C.clockTime(m.t), from: m.enteredBy }; }
    update(k);
  }

  Object.entries(SHEETS).forEach(([k, cfg]) => {
    const inp = $(cfg.insulin);
    if (!inp) return;
    inp.addEventListener('input', () => { st[k].touched = true; render(k); });
  });
  $('log-carbs').addEventListener('input', () => update('food'));

  // food sheet: the main Save
  C.hooks.beforeLogSave.push((t) => {
    if ($('dose-food').closest('[data-logpanel]').hidden) return;
    const c = check('food');
    if (c.block) { t._block = c.block; return; }
    Object.assign(t, c.fields);
  });
  C.hooks.logSaved.push(() => reset('food'));
  // keep the suggestion fresh as new readings arrive (only while you haven't changed it)
  C.hooks.render.push(() => {
    Object.keys(SHEETS).forEach((k) => { const b = $(SHEETS[k].box); if (b && !b.closest('[data-logpanel]').hidden) update(k); });
  });

  // Food sheet: meals that came in from Cronometer today and still need insulin
  function renderImported () {
    const box = $('food-imported');
    if (!box) return;
    const H = window.CGMHubHealth;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const list = C.treatments.filter((m) => H && m.enteredBy === H.IMPORTER && m.t >= d0.getTime()).sort((a, b) => b.t - a.t);
    box.textContent = '';
    box.hidden = !list.length;
    if (!list.length) return;
    box.appendChild(el('div', 'split-title', '📥 From Cronometer today'));
    for (const m of list.slice(0, 4)) {
      const row = el('div', 'imp-row');
      const mid = el('div', 'grow');
      const noTime = !!(m.raw && m.raw.timeUnknown);
      mid.appendChild(el('div', 'title', noTime ? 'No time saved' : ((m.raw && m.raw.mealGroup) || 'Meal') + ' · ' + C.clockTime(m.t)));
      mid.appendChild(el('div', 'muted small', Math.round(m.carbs) + ' g carbs · ' + (m.notes || '').slice(0, 60)));
      row.appendChild(mid);
      const dosed = C.treatments.some((t) => isBolus(t) && t.t >= m.t - 20 * 60e3 && t.t <= m.t + 3 * 3600e3);
      if (noTime) {
        // Cronometer didn't save a time: "eating it now" moves it to now and doses for its carbs (no retyping)
        const b = el('button', 'btn slim primary', '🍽️ Eating it now · 💉 Dose'); b.type = 'button';
        b.addEventListener('click', () => claim(m, b));
        row.appendChild(b);
      } else if (dosed) row.appendChild(el('span', 'muted small', '✓ insulin logged'));
      else if (Date.now() - m.t < 2 * 3600e3) {
        const b = el('button', 'btn slim primary', '💉 Dose for it'); b.type = 'button';
        b.addEventListener('click', () => { if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet('rapid'); });
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    box.appendChild(el('p', 'muted small', 'Already counted. No need to log these again here, just add the insulin.'));
  }
  async function claim (m, btn) {
    btn.disabled = true;
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const t = Object.assign({}, m.raw, {
      created_at: new Date().toISOString(), mealGroup: h >= 4 && h < 10.5 ? 'Breakfast' : h >= 11 && h < 15 ? 'Lunch' : h >= 17 && h < 21.5 ? 'Dinner' : 'Snack',
      enteredBy: 'CGM Hub (from Cronometer)', // now yours: the next Cronometer sync sees it and won't add it again
    });
    delete t.timeUnknown; delete t.mills; delete t.date;
    try {
      await C.apiPutTreatment(t);
      await C.refresh(false);
      if (window.CGMHubLogHub) window.CGMHubLogHub.openSheet('rapid');
    } catch (e) {
      C.showMsg('log-msg', e.message || String(e), 'danger');
      btn.disabled = false;
    }
  }
  C.hooks.render.push(() => { if ($('food-imported') && !$('food-imported').closest('[data-logpanel]').hidden) renderImported(); });

  window.CGMHubDose = { update, check, reset, mealNeedingInsulin, renderImported };
})();
