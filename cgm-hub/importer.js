/* CGM Hub: import a LibreView CSV export into Nightscout.
 * Runs in the browser; the file never leaves the phone except as readings sent to your own Nightscout.
 */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  if (!C) return;
  const { $, el, MIN, DAY } = C;
  let parsed = null;

  // CSV line parser that handles quoted fields
  function splitLine (line, sep) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  // "11-03-2025 08:15", "03/11/2025 8:15 PM", "2025-11-03 08:15"
  function parseStamp (s, order) {
    const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
    if (!m) return null;
    let [, a, b, c, hh, mm, ap] = m;
    let y, mo, d;
    if (a.length === 4) { y = +a; mo = +b; d = +c; } else if (order === 'DMY') { d = +a; mo = +b; y = +c; } else { mo = +a; d = +b; y = +c; }
    if (y < 100) y += 2000;
    let h = +hh;
    if (ap) { const pm = /p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    const dt = new Date(y, mo - 1, d, h, +mm);
    return isNaN(dt) || dt.getMonth() !== mo - 1 ? null : dt.getTime();
  }
  function guessOrder (stamps) {
    let firstBig = false, secondBig = false;
    for (const s of stamps) {
      const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
      if (!m) continue;
      if (+m[1] > 12) firstBig = true;
      if (+m[2] > 12) secondBig = true;
    }
    if (firstBig && !secondBig) return 'DMY';
    if (secondBig && !firstBig) return 'MDY';
    return /^en-US/i.test(navigator.language || '') ? 'MDY' : 'DMY';
  }

  function parseCsv (text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const hIdx = lines.findIndex((l) => /Device Timestamp/i.test(l));
    if (hIdx < 0) throw new Error('This doesn’t look like a LibreView glucose export (no “Device Timestamp” column).');
    const headerLine = lines[hIdx];
    const sep = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
    const head = splitLine(headerLine, sep);
    const col = (re) => head.findIndex((h) => re.test(h));
    const ix = {
      ts: col(/Device Timestamp/i), type: col(/Record Type/i), hist: col(/Historic Glucose/i), scan: col(/Scan Glucose/i),
      rapid: col(/^Rapid-Acting Insulin \(units\)/i), carbs: col(/Carbohydrates \(grams\)/i),
      longU: col(/Long-Acting Insulin.*\(units\)/i), notes: col(/^Notes$/i),
    };
    if (ix.ts < 0 || ix.hist < 0) throw new Error('Couldn’t find the timestamp or glucose columns in this file.');
    const unitMmol = /mmol/i.test(head[ix.hist]);
    const rows = lines.slice(hIdx + 1).map((l) => splitLine(l, sep));
    const order = guessOrder(rows.slice(0, 2000).map((r) => r[ix.ts] || ''));
    return { rows, ix, unitMmol, order };
  }

  function buildRecords (p, order, sinceDays, withTreatments) {
    const since = sinceDays ? Date.now() - sinceDays * DAY : 0;
    const readings = [], trs = [];
    const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
    for (const r of p.rows) {
      const t = parseStamp(r[p.ix.ts] || '', order);
      if (t == null || t < since || t > Date.now() + DAY) continue;
      const type = r[p.ix.type];
      if (type === '0' || (p.ix.type < 0 && r[p.ix.hist])) {
        const v = num(r[p.ix.hist]);
        if (v != null) {
          const mg = Math.round(p.unitMmol ? v * C.MGDL_PER_MMOL : v);
          if (mg >= 20 && mg <= 600) readings.push({ t, mg });
        }
      }
      if (withTreatments) {
        const rapid = p.ix.rapid >= 0 ? num(r[p.ix.rapid]) : null;
        const carbs = p.ix.carbs >= 0 ? num(r[p.ix.carbs]) : null;
        const longU = p.ix.longU >= 0 ? num(r[p.ix.longU]) : null;
        const notes = p.ix.notes >= 0 ? (r[p.ix.notes] || '') : '';
        if (rapid || carbs) {
          const tr = { eventType: rapid && carbs ? 'Meal Bolus' : rapid ? 'Correction Bolus' : 'Carb Correction', created_at: new Date(t).toISOString(), enteredBy: 'LibreView import' };
          if (rapid) tr.insulin = rapid; if (carbs) tr.carbs = carbs; if (notes) tr.notes = notes.slice(0, 140);
          trs.push(tr);
        }
        if (longU) trs.push({ eventType: 'Basal Injection', created_at: new Date(t).toISOString(), insulin: longU, notes: 'Long-acting insulin', enteredBy: 'LibreView import' });
      }
    }
    readings.sort((a, b) => a.t - b.t);
    return { readings, trs };
  }

  function preview () {
    const box = $('imp-preview');
    box.textContent = '';
    if (!parsed) return;
    const order = $('imp-order').value;
    const { readings, trs } = buildRecords(parsed, order, Number($('imp-range').value), $('imp-treat').checked);
    if (!readings.length) { box.appendChild(el('p', 'notice warn', 'No glucose readings found for this time range. Try “All” or check the date format.')); $('imp-go').disabled = true; return; }
    const f = new Date(readings[0].t), l = new Date(readings[readings.length - 1].t);
    const fmt = (d) => d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    box.appendChild(el('p', null, `Found ${readings.length.toLocaleString()} readings from ${fmt(f)} to ${fmt(l)}` + (trs.length ? ` and ${trs.length} insulin/carb entries.` : '.')));
    box.appendChild(el('p', 'muted small', `First reading: ${C.fmtBG(readings[0].mg)} ${C.unitLabel()} on ${fmt(f)}. If the dates look wrong (e.g. day and month swapped), change the date format above.`));
    $('imp-go').disabled = false;
  }

  async function post (path, body) {
    const res = await fetch(C.apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) {
      throw new Error(path.includes('entries')
        ? 'Nightscout said no. Your token needs permission to add readings. See “Before you import” above.'
        : 'Nightscout said no. Your token needs the careportal role to add insulin/carbs.');
    }
    if (!res.ok) throw new Error('Nightscout error ' + res.status);
  }

  async function runImport () {
    if (C.S.demo) { C.showMsg('imp-msg', 'Turn off demo mode first. Imports go to your real Nightscout.', 'warn'); return; }
    if (!C.S.url || !C.S.token) { C.showMsg('imp-msg', 'Connect to Nightscout first (top of this page).', 'warn'); return; }
    const { readings, trs } = buildRecords(parsed, $('imp-order').value, Number($('imp-range').value), $('imp-treat').checked);
    if (!readings.length) return;
    const btn = $('imp-go');
    btn.disabled = true;
    const bar = $('imp-bar');
    bar.parentElement.hidden = false;
    try {
      // skip readings where Nightscout already has data (e.g. from the Libre bridge)
      C.showMsg('imp-msg', 'Checking what Nightscout already has…');
      const first = readings[0].t, last = readings[readings.length - 1].t;
      const have = new Set();
      const existing = await C.apiGet('/api/v1/entries/sgv.json', { 'find[date][$gte]': String(first - 10 * MIN), 'find[date][$lte]': String(last + 10 * MIN), count: '200000' });
      for (const e of existing) if (typeof e.date === 'number') have.add(Math.floor(e.date / (10 * MIN)));
      const todo = readings.filter((r) => { const k = Math.floor(r.t / (10 * MIN)); return !have.has(k) && !have.has(k - 1) && !have.has(k + 1); });
      const skipped = readings.length - todo.length;
      const total = todo.length + trs.length;
      let done = 0;
      const step = () => { bar.style.width = (total ? (done / total) * 100 : 100) + '%'; };
      for (let i = 0; i < todo.length; i += 500) {
        const chunk = todo.slice(i, i + 500).map((r) => ({ type: 'sgv', sgv: r.mg, date: r.t, dateString: new Date(r.t).toISOString(), device: 'LibreView import', direction: 'NONE' }));
        await post('/api/v1/entries', chunk);
        done += chunk.length; step();
        C.showMsg('imp-msg', `Uploading readings… ${done.toLocaleString()} / ${todo.length.toLocaleString()}`);
      }
      for (let i = 0; i < trs.length; i += 200) {
        const chunk = trs.slice(i, i + 200);
        await post('/api/v1/treatments', chunk);
        done += chunk.length; step();
        C.showMsg('imp-msg', `Uploading insulin/carbs… ${(done - todo.length).toLocaleString()} / ${trs.length.toLocaleString()}`);
      }
      try { localStorage.removeItem('cgmhub.daystats.v1'); } catch (e) { /* ignore */ }
      window.dispatchEvent(new Event('cgmhub:data-imported'));
      C.showMsg('imp-msg', `✅ Imported ${todo.length.toLocaleString()} readings` + (trs.length ? ` and ${trs.length} insulin/carb entries` : '') + (skipped ? `. Skipped ${skipped.toLocaleString()} that Nightscout already had.` : '.') + ' You can remove the extra permission from your token now.', 'ok');
      await C.refresh(true);
    } catch (e) {
      C.showMsg('imp-msg', '⚠️ ' + e.message + ' (Anything already uploaded is kept; running the import again won’t duplicate it.)', 'danger');
    } finally { btn.disabled = false; }
  }

  $('imp-file').addEventListener('change', async () => {
    const f = $('imp-file').files[0];
    parsed = null; $('imp-preview').textContent = ''; $('imp-go').disabled = true; $('imp-msg').hidden = true;
    if (!f) return;
    try {
      parsed = parseCsv(await f.text());
      $('imp-order').value = parsed.order;
      $('imp-opts').hidden = false;
      preview();
    } catch (e) { C.showMsg('imp-msg', e.message, 'danger'); }
  });
  ['imp-order', 'imp-range', 'imp-treat'].forEach((id) => $(id).addEventListener('change', preview));
  $('imp-go').addEventListener('click', runImport);

  window.CGMHubImport = { parseCsv, buildRecords, parseStamp };
})();
