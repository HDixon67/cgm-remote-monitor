/* CGM Hub: edit or delete a saved log. Tap any log row (Log list, History logbook, on-board list).
 * Saves with Nightscout's PUT /api/v1/treatments (same _id, so it replaces the record) and
 * DELETE /api/v1/treatments/:id. The token needs the "cgmhub-edit" role for both. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el } = C;

  const MOODS = ['', '😫 Awful', '🙁 Bad', '😐 Okay', '🙂 Good', '😄 Great'];
  const has = (raw, k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== '';
  const isInsulinType = (ev) => /Bolus|Basal|Correction|Insulin/i.test(ev);
  const isCarbType = (ev) => /Meal|Carb|Snack/i.test(ev);

  // which fields this kind of log can change
  function fieldsFor (raw) {
    const ev = raw.eventType || '';
    const f = [{ key: 'when', label: 'Time', type: 'datetime-local' }];
    if (ev === 'Medication') {
      f.push({ key: 'medName', label: 'Name', type: 'text' }, { key: 'medDose', label: 'Dose', type: 'text' });
    }
    if (isInsulinType(ev) || has(raw, 'insulin')) f.push({ key: 'insulin', label: 'Insulin (u)', type: 'number', step: '0.1' });
    if (isCarbType(ev) || has(raw, 'carbs')) f.push({ key: 'carbs', label: 'Carbs (g)', type: 'number', step: '1' });
    if (ev === 'Water') f.push({ key: 'water', label: 'Water (ml)', type: 'number', step: '50' });
    if (ev === 'Exercise') f.push({ key: 'duration', label: 'Minutes', type: 'number', step: '1' });
    if (ev === 'BG Check' || has(raw, 'glucose')) f.push({ key: 'glucose', label: 'Blood sugar (' + (raw.units === 'mmol' ? 'mmol/L' : raw.units ? 'mg/dL' : C.unitLabel()) + ')', type: 'number', step: '0.1' });
    if (ev === 'Mood') f.push({ key: 'mood', label: 'Mood', type: 'select', options: [1, 2, 3, 4, 5].map((v) => [v, MOODS[v]]) });
    f.push({ key: 'notes', label: 'Note', type: 'text' });
    return f;
  }

  let modal = null;
  let current = null;
  let armed = false;
  function build () {
    modal = el('div', 'modal sheet-modal');
    modal.id = 'edit-sheet';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'edit-title');
    const card = el('div', 'modal-card sheet-card');
    const head = el('div', 'sheet-head');
    const h = el('h2', null, 'Edit log'); h.id = 'edit-title';
    const x = el('button', 'link', 'Cancel'); x.type = 'button'; x.addEventListener('click', close);
    head.appendChild(h); head.appendChild(x);
    card.appendChild(head);
    const form = el('form', 'edit-form'); form.id = 'edit-form';
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    card.appendChild(form);
    const msg = el('div', 'notice'); msg.id = 'edit-msg'; msg.hidden = true; msg.setAttribute('role', 'status');
    card.appendChild(msg);
    const row = el('div', 'edit-actions');
    const del = el('button', 'btn danger', '🗑️ Delete'); del.type = 'button'; del.id = 'edit-del';
    del.addEventListener('click', remove);
    const ok = el('button', 'btn primary', 'Save changes'); ok.type = 'submit'; ok.id = 'edit-save';
    ok.setAttribute('form', 'edit-form');
    row.appendChild(del); row.appendChild(ok);
    card.appendChild(row);
    modal.appendChild(card);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) close(); });
    document.body.appendChild(modal);
  }

  function open (t) {
    if (!t || !t.raw || !t._id) return;
    if (!modal) build();
    current = t;
    armed = false;
    $('edit-del').textContent = '🗑️ Delete';
    $('edit-msg').hidden = true;
    $('edit-title').textContent = 'Edit · ' + (t.raw.eventType || 'log');
    const form = $('edit-form');
    form.textContent = '';
    const raw = t.raw;
    for (const f of fieldsFor(raw)) {
      const lab = el('label', 'field');
      lab.appendChild(el('span', null, f.label));
      let inp;
      if (f.type === 'select') {
        inp = el('select');
        for (const [v, txt] of f.options) { const o = el('option', null, txt); o.value = String(v); inp.appendChild(o); }
        inp.value = String(raw.mood || 3);
      } else {
        inp = el('input');
        inp.type = f.type;
        if (f.step) { inp.step = f.step; inp.min = '0'; inp.inputMode = 'decimal'; }
        inp.value = f.key === 'when' ? C.toLocalInput(new Date(t.t)) : (has(raw, f.key) ? String(raw[f.key]) : '');
      }
      inp.name = f.key;
      lab.appendChild(inp);
      form.appendChild(lab);
    }
    if (raw.suggestedInsulin != null) form.appendChild(el('p', 'muted small', '🧮 Calculator suggested ' + raw.suggestedInsulin + ' u' + (raw.doseReason ? ' · you chose ' + (raw.insulin || 0) + ' u: “' + raw.doseReason + '”' : '')));
    if (raw.nutrients && typeof raw.nutrients === 'object') form.appendChild(el('p', 'muted small', 'Changing carbs here won’t change the saved nutrition details for this meal.'));
    modal.hidden = false;
    document.body.classList.add('sheet-open');
    $('edit-title').tabIndex = -1;
    $('edit-title').focus(); // focus the title, not a field, so the phone keyboard doesn't pop up
  }

  function close () {
    if (!modal) return;
    modal.hidden = true;
    current = null;
    if (!document.querySelector('.sheet-modal:not([hidden]):not(#edit-sheet)')) document.body.classList.remove('sheet-open');
  }

  async function after (text) {
    window.dispatchEvent(new Event('cgmhub:data-imported')); // clears cached History/insight windows
    try { await C.refresh(true); } catch (e) { /* shown elsewhere */ }
    if (window.CGMHubHistory && !$('view-trends').hidden) window.CGMHubHistory.render();
    const box = $('toasts');
    if (box) { const t = el('div', 'toast', text); box.appendChild(t); setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2700); }
  }

  async function save () {
    if (!current) return;
    const raw = current.raw;
    const out = Object.assign({}, raw);
    const form = $('edit-form');
    let bad = '';
    for (const f of fieldsFor(raw)) {
      const v = form.elements[f.key].value.trim();
      if (f.key === 'when') {
        const ms = new Date(v).getTime();
        if (isNaN(ms)) { bad = 'Pick a time.'; break; }
        if (v !== C.toLocalInput(new Date(current.t))) { out.created_at = new Date(ms).toISOString(); delete out.mills; delete out.date; delete out.utcOffset; } // only when the minute changed
      } else if (f.type === 'number' || f.type === 'select') {
        if (v === '') { delete out[f.key]; continue; }
        const n = Number(v);
        if (!isFinite(n) || n < 0) { bad = f.label + ' must be a number.'; break; }
        out[f.key] = n;
      } else {
        out[f.key] = v;
      }
    }
    if (bad) { C.showMsg('edit-msg', bad, 'danger'); return; }
    // auto labels like "Water 500 ml" or "Fingerstick 6.2 mmol/L": follow the new number if the note wasn't edited
    if (out.notes === (raw.notes || '')) {
      for (const k of ['water', 'duration', 'glucose', 'insulin', 'carbs']) {
        if (has(raw, k) && out[k] !== undefined && out[k] !== raw[k]) {
          const re = new RegExp('(^|[^\\d.])' + String(raw[k]).replace('.', '\\.') + '(?![\\d.])');
          if (re.test(out.notes)) out.notes = out.notes.replace(re, '$1' + out[k]);
        }
      }
    }
    if (raw.eventType === 'Medication' && (out.medName || out.medDose)) {
      // keep the list label in sync when the note was the auto one
      const auto = [raw.medName, raw.medDose].filter(Boolean).join(' ');
      if (!raw.notes || raw.notes === auto) out.notes = [out.medName, out.medDose].filter(Boolean).join(' ');
    }
    const btn = $('edit-save');
    btn.disabled = true;
    try {
      await C.apiPutTreatment(out);
      close();
      await after('✏️ Log updated');
    } catch (e) {
      C.showMsg('edit-msg', e.message || String(e), 'danger');
    } finally { btn.disabled = false; }
  }

  async function remove () {
    if (!current) return;
    const btn = $('edit-del');
    if (!armed) { armed = true; btn.textContent = 'Tap again to delete'; return; }
    btn.disabled = true;
    try {
      await C.apiDeleteTreatment(current._id);
      close();
      await after('🗑️ Log deleted');
    } catch (e) {
      C.showMsg('edit-msg', e.message || String(e), 'danger');
      armed = false; btn.textContent = '🗑️ Delete';
    } finally { btn.disabled = false; }
  }

  window.CGMHubEdit = { open, close };
})();
