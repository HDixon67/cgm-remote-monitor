/* CGM Hub: "New log" hub (one screen of tiles, each opens a sheet) and Juno-style medication schedule. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const F = window.CGMHubFeatures;
  if (!C || !F) return;
  const { $, el, MIN, HOUR, DAY } = C;
  const nowInput = () => C.toLocalInput(new Date());
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fmtTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const r1 = (x) => Math.round(x * 10) / 10;

  // =====================================================================
  // Sheets
  // =====================================================================
  const TITLES = { mood: '🙂 How do you feel?', food: '🍽️ Food', rapid: '💧 Rapid insulin', basal: '💧 Long-acting insulin', meds: '💊 Meds & supplements', activity: '🏃 Activity', water: '💧 Water', period: '🌸 Period', bg: '👆 Blood check', note: '📝 Note' };
  function openSheet (name) {
    $('log-sheet').hidden = false;
    document.body.classList.add('sheet-open');
    $('sheet-title').textContent = TITLES[name] || 'Log';
    F.showLogTab(name);
    if (name === 'food' && !$('log-time').value) $('log-time').value = nowInput();
    if (name === 'food' && window.CGMHubUsual) window.CGMHubUsual.render();
    if ((name === 'food' || name === 'rapid') && window.CGMHubDose) window.CGMHubDose.reset(name);
    if (name === 'food' && window.CGMHubDose) window.CGMHubDose.renderImported();
    if (name === 'food' && window.CGMHubFeatures.setMealGroup) window.CGMHubFeatures.setMealGroup(null);
    if (name === 'rapid') { $('rapid-name').value = C.S.rapidName || ''; $('rapid-time').value = nowInput(); }
    if (name === 'bg') { $('bg-time').value = nowInput(); document.querySelectorAll('.unit-label').forEach((e) => { e.textContent = C.unitLabel(); }); }
    if (name === 'note') $('note-time').value = nowInput();
    if (name === 'meds') renderMeds();
    if (name === 'mood') resetMood();
    $('log-sheet').querySelector('.sheet-card').scrollTop = 0;
  }
  function closeSheet () {
    $('log-sheet').hidden = true;
    document.body.classList.remove('sheet-open');
    document.querySelectorAll('[data-logpanel]').forEach((p) => { p.hidden = true; });
    renderStatus();
  }
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
  $('sheet-close').addEventListener('click', closeSheet);
  $('log-sheet').addEventListener('click', (e) => { if (e.target === $('log-sheet')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('log-sheet').hidden) closeSheet(); });
  // calculator → "Log this dose + carbs" lands in the Food sheet
  $('calc-log').addEventListener('click', () => setTimeout(() => openSheet('food'), 0));
  C.hooks.view.push((v) => { if (v !== 'log' && !$('log-sheet').hidden) closeSheet(); if (v === 'log') renderStatus(); });

  async function post (t, msgId, okText) {
    try {
      await C.apiPostTreatment(Object.assign({ created_at: new Date().toISOString(), enteredBy: 'CGM Hub' }, t));
      C.showMsg(msgId, '✅ ' + okText + (C.S.demo ? ' (demo only)' : ''), 'ok');
      await C.refresh(false);
      return true;
    } catch (e) { C.showMsg(msgId, e.message, 'danger'); return false; }
  }

  // ---------- rapid insulin (not with a meal) ----------
  $('rapid-save').addEventListener('click', async () => {
    const u = Number($('rapid-units').value);
    if (!(u > 0)) { $('rapid-units').focus(); return; }
    if (u > 30) { C.showMsg('rapid-msg', 'That’s over 30 units. Please double-check the number.', 'warn'); return; }
    const name = $('rapid-name').value.trim() || 'Rapid insulin';
    C.S.rapidName = name; C.saveSettings();
    const note = $('rapid-note').value.trim();
    const when = $('rapid-time').value ? new Date($('rapid-time').value) : new Date();
    const dc = window.CGMHubDose ? window.CGMHubDose.check('rapid') : { fields: {} };
    if (dc.block) { C.showMsg('rapid-msg', dc.block, 'warn'); return; }
    const t = Object.assign({ eventType: 'Correction Bolus', insulin: u, insulinType: name, notes: name + ' ' + u + 'u', created_at: when.toISOString() }, dc.fields);
    if (note) t.notes = note;
    if (await post(t, 'rapid-msg', name + ' ' + u + 'u logged.')) {
      $('rapid-units').value = ''; $('rapid-note').value = '';
      if (window.CGMHubDose) window.CGMHubDose.reset('rapid');
    }
  });

  // ---------- fingerstick ----------
  $('bg-save').addEventListener('click', async () => {
    const v = Number($('bg-value').value);
    const mg = C.toMg(v);
    if (!(mg >= 20 && mg <= 600)) { C.showMsg('bg-msg', 'That number looks off. Please check it.', 'warn'); return; }
    const when = $('bg-time').value ? new Date($('bg-time').value) : new Date();
    if (await post({ eventType: 'BG Check', glucose: v, glucoseType: 'Finger', units: C.mmol() ? 'mmol' : 'mg/dl', notes: 'Fingerstick ' + v + ' ' + C.unitLabel(), created_at: when.toISOString() }, 'bg-msg', 'Blood check saved.')) $('bg-value').value = '';
  });

  // ---------- note ----------
  $('note-quick').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const cur = $('note-text').value.trim();
    $('note-text').value = (cur ? cur + ', ' : '') + b.textContent.replace(/^\S+\s/, '');
  });
  $('note-save').addEventListener('click', async () => {
    const text = $('note-text').value.trim();
    if (!text) { $('note-text').focus(); return; }
    const when = $('note-time').value ? new Date($('note-time').value) : new Date();
    if (await post({ eventType: 'Note', notes: text, created_at: when.toISOString() }, 'note-msg', 'Note saved.')) $('note-text').value = '';
  });

  // =====================================================================
  // Medication schedule (Juno-style)
  // =====================================================================
  const FORM_IC = { capsule: '💊', tablet: '⚪', liquid: '🧴', gummy: '🍬', spray: '💨', patch: '🩹', injection: '💉', other: '💊' };
  const SLOTS = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 21], ['Bedtime', 21, 24]];
  function meds () {
    const list = Array.isArray(C.S.meds) ? C.S.meds : [];
    // older entries had no schedule: treat them as a 9 AM daily med
    return list.map((m) => Object.assign({ form: m.type === 'supplement' ? 'tablet' : 'capsule', amount: '1' }, m, { times: m.prn ? [] : (Array.isArray(m.times) && m.times.length ? m.times.slice().sort() : ['09:00']) }));
  }
  const sameMed = (t, name) => t.kind === 'med' && String(t.medName || t.notes || '').toLowerCase().startsWith(name.toLowerCase());
  function takenToday (name) { return C.treatments.filter((t) => t.t >= startOfDay() && sameMed(t, name)).sort((a, b) => a.t - b.t); }

  const pending = new Map(); // key -> {timer}
  function commitLater (m, key) {
    const timer = setTimeout(async () => {
      pending.delete(key);
      try {
        await C.apiPostTreatment({
          eventType: 'Medication', created_at: new Date().toISOString(), enteredBy: 'CGM Hub',
          notes: [m.name, m.dose].filter(Boolean).join(' '), medName: m.name, medDose: m.dose || '', medType: m.type || 'medication', medAmount: m.amount || '', medForm: m.form || '',
        });
        await C.refresh(false);
      } catch (e) { C.showMsg('med-msg', e.message, 'danger'); }
      renderMeds(); renderStatus();
    }, 4000);
    pending.set(key, { timer });
    renderMeds();
  }
  function undo (key) { const p = pending.get(key); if (p) { clearTimeout(p.timer); pending.delete(key); renderMeds(); } }

  function doseRow (m, time, idx, logs) {
    const key = m.name + '|' + (time || 'prn') + '|' + idx;
    const log = logs[idx];
    const isPending = pending.has(key);
    const done = !!log || isPending;
    const row = el('div', 'med-row' + (done ? ' done' : ''));
    row.appendChild(el('span', 'med-ic ' + (m.type === 'supplement' ? 'supp' : 'med'), FORM_IC[m.form] || '💊'));
    const mid = el('div', 'grow');
    mid.appendChild(el('div', 'title', m.name));
    const bits = [m.amount && m.form ? m.amount + ' ' + m.form + (Number(m.amount) > 1 ? 's' : '') : '', m.dose, time ? fmtTime(time) : ''].filter(Boolean);
    let sub = bits.join(' · ');
    if (log) sub = '✓ Taken ' + C.clockTime(log.t);
    else if (isPending) sub = '✓ Logging…';
    else if (time) {
      const [h, mm] = time.split(':').map(Number);
      const due = new Date(); due.setHours(h, mm, 0, 0);
      if (Date.now() > due.getTime() + HOUR) sub += ' · overdue';
    }
    mid.appendChild(el('div', 'muted small' + (/overdue/.test(sub) ? ' overdue' : ''), sub));
    row.appendChild(mid);
    if (isPending) {
      const u = el('button', 'link', 'Undo'); u.type = 'button';
      u.addEventListener('click', () => undo(key));
      row.appendChild(u);
    }
    const c = el('button', 'med-check' + (done ? ' on' : ''), done ? '✓' : '');
    c.type = 'button';
    c.setAttribute('aria-label', done ? m.name + ' taken' : 'Mark ' + m.name + ' as taken');
    c.disabled = !!log || isPending;
    c.addEventListener('click', () => commitLater(m, key));
    row.appendChild(c);
    return { row, key, done };
  }

  function renderMeds () {
    const list = meds();
    const due = $('meds-due'), prn = $('meds-prn');
    due.textContent = ''; prn.textContent = '';
    const scheduled = list.filter((m) => m.times.length);
    if (!list.length) { due.appendChild(el('p', 'muted', 'No meds yet. Tap “✏️ Add or edit meds” below to set up your list.')); $('med-manage').open = true; }
    else if (!scheduled.length) due.appendChild(el('p', 'muted small', 'Nothing scheduled. Your meds are under “As needed”.'));
    // doses grouped by time of day
    for (const [slot, a, b] of SLOTS) {
      const doses = [];
      for (const m of scheduled) {
        const logs = takenToday(m.name);
        m.times.forEach((t, i) => { const h = Number(t.slice(0, 2)); if (h >= a && h < b) doses.push({ m, t, i, logs }); });
      }
      if (!doses.length) continue;
      doses.sort((x, y) => x.t.localeCompare(y.t));
      const head = el('div', 'slot-head');
      head.appendChild(el('span', 'slot-name', slot.toUpperCase()));
      const rows = doses.map(({ m, t, i, logs }) => doseRow(m, t, i, logs));
      const open = rows.filter((r) => !r.done);
      if (open.length > 1) {
        const all = el('button', 'chip', 'Log all'); all.type = 'button';
        all.addEventListener('click', () => doses.forEach(({ m, t, i, logs }, n) => { if (!rows[n].done) commitLater(m, rows[n].key); }));
        head.appendChild(all);
      }
      due.appendChild(head);
      rows.forEach((r) => due.appendChild(r.row));
    }
    // as needed
    const prnList = list.filter((m) => !m.times.length);
    if (!prnList.length) prn.appendChild(el('p', 'muted small', 'No “as needed” meds. When adding a med, choose “As needed”.'));
    for (const m of prnList) {
      const logs = takenToday(m.name);
      const { row } = doseRow(m, null, logs.length, logs);
      row.querySelector('.muted').textContent = [m.dose, logs.length ? 'taken ' + logs.length + '× today (last ' + C.clockTime(logs[logs.length - 1].t) + ')' : 'not taken today'].filter(Boolean).join(' · ');
      prn.appendChild(row);
    }
    renderMedList();
  }
  document.querySelectorAll('[data-medtab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-medtab]').forEach((x) => x.classList.toggle('on', x === b));
    $('meds-due').hidden = b.dataset.medtab !== 'due';
    $('meds-prn').hidden = b.dataset.medtab !== 'prn';
  }));

  // ---------- add / edit ----------
  let editing = -1;
  function timeRow (val) {
    const r = el('div', 'time-row');
    const i = el('input'); i.type = 'time'; i.value = val || '09:00'; i.setAttribute('aria-label', 'Time to take it');
    const d = el('button', 'del', '✕'); d.type = 'button'; d.setAttribute('aria-label', 'Remove this time');
    d.addEventListener('click', () => { if ($('med-times').children.length > 1) r.remove(); });
    r.append(i, d);
    return r;
  }
  function resetForm (m) {
    $('med-name').value = m ? m.name : ''; $('med-dose').value = m ? m.dose || '' : '';
    $('med-amount').value = m ? m.amount || '1' : '1'; $('med-form-kind').value = m ? m.form || 'capsule' : 'capsule';
    $('med-type').value = m ? m.type || 'medication' : 'medication';
    $('med-sched').value = m && !m.times.length ? 'prn' : 'scheduled';
    $('med-times').textContent = '';
    ((m && m.times.length ? m.times : ['09:00'])).forEach((t) => $('med-times').appendChild(timeRow(t)));
    syncSched();
    $('med-form-title').textContent = m ? 'Edit ' + m.name : 'Add a med or supplement';
    $('med-cancel').hidden = !m;
  }
  function syncSched () { const prnOn = $('med-sched').value === 'prn'; $('med-times').hidden = prnOn; $('med-time-add').hidden = prnOn; }
  $('med-sched').addEventListener('change', syncSched);
  $('med-time-add').addEventListener('click', () => $('med-times').appendChild(timeRow('21:00')));
  $('med-cancel').addEventListener('click', () => { editing = -1; resetForm(null); });
  $('med-save').addEventListener('click', () => {
    const name = $('med-name').value.trim();
    if (!name) { $('med-name').focus(); return; }
    const prnOn = $('med-sched').value === 'prn';
    const times = prnOn ? [] : [...$('med-times').querySelectorAll('input')].map((i) => i.value).filter(Boolean).sort();
    const m = { name, dose: $('med-dose').value.trim(), amount: $('med-amount').value.trim(), form: $('med-form-kind').value, type: $('med-type').value, prn: prnOn, times };
    const list = meds();
    if (editing >= 0) list[editing] = m; else list.push(m);
    C.S.meds = list; C.saveSettings();
    editing = -1; resetForm(null);
    renderMeds(); renderStatus();
    C.showMsg('med-msg', '✅ Saved ' + name + '. Set reminders in Settings → 🔔 Phone reminders.', 'ok');
  });
  function renderMedList () {
    const ul = $('med-list');
    ul.textContent = '';
    meds().forEach((m, i) => {
      const li = el('li');
      li.appendChild(el('span', 'ic other', FORM_IC[m.form] || '💊'));
      const mid = el('div', 'grow');
      mid.appendChild(el('div', 'title', m.name));
      mid.appendChild(el('div', 'muted small', [m.dose, m.times.length ? m.times.map(fmtTime).join(', ') : 'as needed'].filter(Boolean).join(' · ')));
      li.appendChild(mid);
      const ed = el('button', 'del', '✏️'); ed.type = 'button'; ed.setAttribute('aria-label', 'Edit ' + m.name);
      ed.addEventListener('click', () => { editing = i; resetForm(m); $('med-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove ' + m.name);
      del.addEventListener('click', () => { if (confirm('Remove ' + m.name + ' from your list?')) { C.S.meds = meds().filter((_, j) => j !== i); C.saveSettings(); renderMeds(); renderStatus(); } });
      li.append(ed, del);
      ul.appendChild(li);
    });
  }
  resetForm(null);

  // =====================================================================
  // How do you feel? (mood check-in)
  // =====================================================================
  const MOOD_WORDS = ['', 'Rough', 'Not great', 'Okay', 'Good', 'Great'];
  let moodPick = 0;
  function resetMood (preset) {
    moodPick = preset || 0;
    document.querySelectorAll('#mood-faces [data-mood]').forEach((b) => b.classList.toggle('on', Number(b.dataset.mood) === moodPick));
    document.querySelectorAll('.mood-tags .chip').forEach((c) => c.classList.remove('on'));
  }
  document.querySelectorAll('#mood-faces [data-mood]').forEach((b) => b.addEventListener('click', () => {
    moodPick = Number(b.dataset.mood);
    document.querySelectorAll('#mood-faces [data-mood]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('.mood-tags .chip').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
  $('mood-save').addEventListener('click', async () => {
    const tags = [...document.querySelectorAll('.mood-tags .chip.on')].map((c) => c.textContent.replace(/^\S+\s/, ''));
    if (!moodPick && !tags.length) { C.showMsg('mood-msg', 'Pick a face or something that’s going on.', 'warn'); return; }
    const notes = [moodPick ? MOOD_WORDS[moodPick] : '', tags.join(', ')].filter(Boolean).join(' · ');
    if (await post({ eventType: 'Mood', mood: moodPick || undefined, moodTags: tags, notes: 'Feeling: ' + notes }, 'mood-msg', 'Thanks for checking in 💛')) {
      try { localStorage.setItem('cgmhub.moodDismissed', new Date().toDateString()); } catch (e) { /* ignore */ }
      setTimeout(closeSheet, 900);
      renderMoodPrompt();
    }
  });
  function moodToday () { return C.treatments.find((t) => t.eventType === 'Mood' && t.t >= startOfDay()); }
  function renderMoodPrompt () {
    let dismissed = '';
    try { dismissed = localStorage.getItem('cgmhub.moodDismissed') || ''; } catch (e) { /* ignore */ }
    $('mood-prompt').hidden = !!moodToday() || dismissed === new Date().toDateString() || !(C.S.url || C.S.demo);
  }
  document.querySelectorAll('[data-quickmood]').forEach((b) => b.addEventListener('click', () => {
    C.go('log');
    openSheet('mood');
    resetMood(Number(b.dataset.quickmood));
  }));
  $('mood-dismiss').addEventListener('click', () => {
    try { localStorage.setItem('cgmhub.moodDismissed', new Date().toDateString()); } catch (e) { /* ignore */ }
    renderMoodPrompt();
  });
  C.hooks.render.push(renderMoodPrompt);

  // =====================================================================
  // Tile statuses
  // =====================================================================
  function renderStatus () {
    const t0 = startOfDay();
    const today = C.treatments.filter((t) => t.t >= t0);
    const carbs = today.reduce((s, t) => s + t.carbs, 0);
    const md = today.find((t) => t.eventType === 'Mood');
    $('st-mood').textContent = md ? (md.notes || '').replace(/^Feeling: /, '') : 'Quick check-in';
    $('st-food').textContent = carbs ? Math.round(carbs) + ' g carbs today' : 'Search, scan, or by hand';
    $('st-rapid-name').textContent = C.S.rapidName || 'Rapid insulin';
    $('st-basal-name').textContent = C.S.basalName || 'Long-acting';
    const rapid = today.filter((t) => t.insulin > 0 && !C.isBasal(t));
    $('st-rapid').textContent = rapid.length ? r1(rapid[0].insulin) + 'u at ' + C.clockTime(rapid[0].t) : 'Add ›';
    const basal = today.filter((t) => t.insulin > 0 && C.isBasal(t));
    $('st-basal').textContent = basal.length ? '✓ ' + r1(basal[0].insulin) + 'u at ' + C.clockTime(basal[0].t) : 'Not logged today';
    const ex = today.filter((t) => t.eventType === 'Exercise').reduce((s, t) => s + t.duration, 0);
    $('st-act').textContent = ex ? ex + ' min today' : 'Add ›';
    const water = today.reduce((s, t) => s + (t.water || 0), 0);
    $('st-water').textContent = water ? (water / 1000).toFixed(water % 1000 ? 2 : 1).replace(/0$/, '') + ' L today' : 'Add ›';
    // meds: scheduled doses taken
    const list = meds().filter((m) => m.times.length);
    const total = list.reduce((s, m) => s + m.times.length, 0);
    const taken = list.reduce((s, m) => s + Math.min(m.times.length, takenToday(m.name).length), 0);
    $('st-meds').textContent = !meds().length ? 'Set up your meds' : total ? `${taken} of ${total} taken today` + (taken === total ? ' ✓' : '') : 'As needed only';
    // period
    const model = F.cycleModel();
    const tile = document.querySelector('[data-sheet="period"]');
    if (model.cycles.length) {
      const last = model.cycles[model.cycles.length - 1];
      const inPeriod = !last.end && Date.now() - last.start < 10 * DAY;
      const next = last.start + model.avgLen * DAY;
      $('st-period').textContent = inPeriod ? 'Day ' + (Math.round((startOfDay() - last.start) / DAY) + 1) + ' of your period'
        : 'Last ' + fmtDate(last.start) + (last.end ? ' – ' + fmtDate(last.end) : '') + ' · next around ' + fmtDate(next);
      tile.querySelector('.hub-add').textContent = inPeriod ? 'End ›' : 'Start ›';
    } else { $('st-period').textContent = 'Log your period'; tile.querySelector('.hub-add').textContent = 'Start ›'; }
  }
  C.hooks.render.push(() => { if (!$('view-log').hidden) { renderStatus(); if (!document.querySelector('[data-logpanel="meds"]').hidden) renderMeds(); } });

  window.CGMHubLogHub = { openSheet, closeSheet, meds, openMood: (n) => { C.go('log'); openSheet('mood'); resetMood(n); } };
})();
