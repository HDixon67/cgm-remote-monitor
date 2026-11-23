/* CGM Hub: feeds the Android home-screen widget (CGM Hub app only).
 * While the app is open it sends the latest reading, insulin on board and the top side quest or next med.
 * It also hands over the Nightscout address + token so the widget can refresh itself every ~15 minutes. */
(function () {
  'use strict';
  const C = window.CGMHubCore;
  const cap = window.Capacitor;
  if (!C || !cap || !cap.isNativePlatform || !cap.isNativePlatform() || !cap.Plugins || !cap.Plugins.Widget) return;
  const W = cap.Plugins.Widget;
  const { MIN } = C;
  let last = '', lastAt = 0;

  function nextThing () {
    // 1) the top side quest, 2) the next scheduled med not logged yet
    const g = window.CGMHubGame && window.CGMHubGame.side;
    if (g && g.open && g.open.length) return '✨ ' + g.open[0].text;
    const meds = window.CGMHubLogHub ? window.CGMHubLogHub.meds() : [];
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    let best = null;
    for (const m of meds) {
      if (!Array.isArray(m.times) || !m.name) continue;
      const taken = C.treatments.filter((t) => t.t >= d0.getTime() && t.kind === 'med' && String(t.medName || t.notes || '').toLowerCase().startsWith(m.name.toLowerCase())).length;
      m.times.forEach((time, n) => {
        if (taken > n) return;
        const [h, mm] = time.split(':').map(Number);
        const at = d0.getTime() + h * 3600e3 + mm * MIN;
        if (!best || at < best.at) best = { at, text: '💊 ' + m.name + ' ' + C.clockTime(at) };
      });
    }
    return best ? best.text : '';
  }

  function push () {
    if (C.S.demo || !C.S.url || !C.S.token) return;
    const cur = C.entries[0], prev = C.entries[1];
    const msg = {
      url: C.S.url.replace(/\/+$/, ''), token: C.S.token.trim(), units: C.S.units === 'mmol' ? 'mmol' : 'mgdl',
      low: C.toMg(C.S.low), high: C.toMg(C.S.high),
      iob: Math.round(C.onBoard().iob * 10) / 10, extra: nextThing().slice(0, 80),
    };
    if (cur) {
      msg.sgv = Math.round(cur.mg); msg.date = cur.t; msg.direction = cur.dir || '';
      if (prev && cur.t - prev.t <= 15 * MIN) msg.delta = cur.mg - prev.mg;
    }
    const key = JSON.stringify(msg);
    if (key === last && Date.now() - lastAt < 5 * MIN) return; // nothing new
    last = key; lastAt = Date.now();
    W.update(msg).catch(() => { /* an older app build without the widget */ });
  }

  C.hooks.render.push(() => setTimeout(push, 300)); // after side quests are worked out
  C.hooks.logSaved.push(() => setTimeout(push, 1500));
  document.addEventListener('visibilitychange', () => { if (document.hidden) push(); });
})();
