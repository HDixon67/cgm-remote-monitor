/* CGM Hub: phone reminder settings. Saved to Nightscout as a "CGMHub Settings" treatment,
 * which the reminders job (cgm-hub/reminders/reminders.mjs, run every 15 min on Northflank) reads. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el } = C;
  const DEMO_KEY = 'cgmhub.reminders.demo';
  let cfg = null;

  const defaults = () => ({
    v: 1, meds: [], bedtime: { on: true, time: '22:00' }, bolusCheck: { on: true }, quests: { on: false, time: '19:00' }, custom: [],
  });

  async function load () {
    if (C.S.demo) { try { cfg = JSON.parse(localStorage.getItem(DEMO_KEY)) || defaults(); } catch (e) { cfg = defaults(); } return; }
    if (!C.S.url || !C.S.token) { cfg = defaults(); return; }
    try {
      const docs = await C.apiGet('/api/v1/treatments.json', { 'find[eventType]': 'CGMHub Settings', count: '1' });
      cfg = Object.assign(defaults(), (docs[0] && docs[0].cgmhub) || {});
    } catch (e) { cfg = defaults(); C.showMsg('rem-msg', 'Couldn’t load saved reminders: ' + e.message, 'warn'); }
  }
  async function save (extra) {
    const body = Object.assign({}, cfg, extra || {}, {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      units: C.S.units,
      appUrl: location.href.split('#')[0],
      savedAt: Date.now(),
    });
    if (C.S.demo) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(body)); } catch (e) { /* ignore */ } return; }
    await C.apiPostTreatment({ eventType: 'CGMHub Settings', created_at: new Date().toISOString(), enteredBy: 'CGM Hub', notes: 'CGM Hub reminder settings', cgmhub: body });
  }

  function timeInput (val, label) { const i = el('input'); i.type = 'time'; i.value = val || '09:00'; i.setAttribute('aria-label', label); return i; }
  function row (label, sub, on, time, onChange) {
    const r = el('div', 'rem-row');
    const lab = el('label', 'check');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!on;
    const txt = el('span'); txt.appendChild(document.createTextNode(label));
    if (sub) txt.appendChild(el('small', 'muted', ' ' + sub));
    lab.append(cb, txt);
    r.appendChild(lab);
    let ti = null;
    if (time !== undefined) { ti = timeInput(time, 'Time for ' + label); r.appendChild(ti); ti.addEventListener('change', () => onChange(cb.checked, ti.value)); }
    cb.addEventListener('change', () => onChange(cb.checked, ti ? ti.value : undefined));
    return r;
  }

  function render () {
    const box = $('rem-list');
    box.textContent = '';
    // meds from the saved med list
    const meds = Array.isArray(C.S.meds) ? C.S.meds : [];
    box.appendChild(el('div', 'split-title', '💊 Meds & supplements (only if not logged yet)'));
    if (!meds.length) box.appendChild(el('p', 'muted small', 'Add meds in Log → 💊 Meds first.'));
    for (const m of meds) {
      const saved = (cfg.meds || []).find((x) => x.name === m.name) || { name: m.name, dose: m.dose, on: false, time: '09:00', nag: true };
      box.appendChild(row(m.name, m.dose || '', saved.on, saved.time, (on, time) => {
        cfg.meds = (cfg.meds || []).filter((x) => x.name !== m.name).concat([{ name: m.name, dose: m.dose || '', on, time, nag: true }]);
      }));
    }
    box.appendChild(el('div', 'split-title', '📅 Daily'));
    box.appendChild(row('🌙 Bedtime glucose check', 'with your current number', cfg.bedtime.on, cfg.bedtime.time, (on, time) => { cfg.bedtime = { on, time }; }));
    box.appendChild(row('⚔️ Quest nudge', '', cfg.quests.on, cfg.quests.time, (on, time) => { cfg.quests = { on, time }; }));
    box.appendChild(row('🍽️ Bolus check', 'carbs logged but no insulin 15 min later', cfg.bolusCheck.on, undefined, (on) => { cfg.bolusCheck = { on }; }));

    box.appendChild(el('div', 'split-title', '🔔 Your own reminders'));
    (cfg.custom || []).forEach((c, i) => {
      const r = row(c.text, '', c.on, c.time, (on, time) => { cfg.custom[i] = Object.assign({}, c, { on, time }); });
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove reminder');
      del.addEventListener('click', () => { cfg.custom.splice(i, 1); render(); });
      r.appendChild(del);
      box.appendChild(r);
    });
  }

  $('rem-add').addEventListener('click', () => {
    const text = $('rem-text').value.trim();
    if (!text) { $('rem-text').focus(); return; }
    cfg.custom = (cfg.custom || []).concat([{ text: text.slice(0, 100), time: $('rem-time').value || '12:00', on: true }]);
    $('rem-text').value = '';
    render();
  });
  $('rem-save').addEventListener('click', async () => {
    try { await save(); C.showMsg('rem-msg', '✅ Saved. Reminders use your phone’s time zone (' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') + ').', 'ok'); } catch (e) { C.showMsg('rem-msg', e.message, 'danger'); }
  });
  $('rem-test').addEventListener('click', async () => {
    try { await save({ testAt: Date.now() }); C.showMsg('rem-msg', '📨 Test queued. It should arrive in Pushover within 15 minutes.', 'ok'); } catch (e) { C.showMsg('rem-msg', e.message, 'danger'); }
  });

  C.hooks.view.push(async (v) => { if (v === 'settings') { await load(); render(); } });
})();
