/* CGM Hub: hand-drawn (SVG) pets, so unlockables actually sit on them:
 * scarf round the neck, hats and crowns on the head, shades on the eyes, headphones over the ears, a wand in the paw.
 * Chibi style: big head, shiny eyes, blush. Moods change the face; CSS adds a little bounce and blinking.
 * window.CGMHubPetArt.svg({ species: '🦊', level, mood, item: '🧣' }) → SVG markup string. */
(function () {
  'use strict';
  // body colour, belly/face colour, ear style, extras
  const SPECIES = {
    '🐱': { c: '#f6a85b', b: '#fff1dc', d: '#e08a3a', ears: 'point', whisk: true, mouth: 'w', tail: 'cat' },
    '🐶': { c: '#d9a066', b: '#fff3e3', d: '#9c6a3c', ears: 'flop', muzzle: true, nose: true, tail: 'dog' },
    '🦊': { c: '#f08a3c', b: '#fff5ea', d: '#4a2a1a', ears: 'fox', cheeks: true, nose: true, mouth: 'w', tail: 'fox' },
    '🐰': { c: '#f4effc', b: '#ffffff', d: '#f7a6c4', ears: 'bunny', mouth: 'w', pinknose: true, tail: 'puff' },
    '🐢': { c: '#94d38c', b: '#e9f7cf', d: '#5c9e57', ears: null, shell: true },
    '🐉': { c: '#7fd6a8', b: '#fff1a8', d: '#4fae80', ears: 'horn', wings: true, tail: 'dragon' },
    '🦄': { c: '#fbf7ff', b: '#ffffff', d: '#d8c6f5', ears: 'point', horn: true, mane: true, tail: 'mane' },
    '🐧': { c: '#3f4d70', b: '#ffffff', d: '#f5a524', ears: null, beak: true, mask: true },
    '🦦': { c: '#9c6b4a', b: '#f3dfc9', d: '#6e4630', ears: 'round', muzzle: true, nose: true, whisk: true, tail: 'otter' },
  };
  const esc = (s) => String(s).replace(/[<>&"]/g, '');

  function ears (s) {
    const c = s.c, d = s.d;
    switch (s.ears) {
      case 'point': return `<path d="M58 70 L64 28 L92 56 Z" fill="${c}"/><path d="M142 70 L136 28 L108 56 Z" fill="${c}"/><path d="M65 62 L68 40 L84 56 Z" fill="#f7b6c8"/><path d="M135 62 L132 40 L116 56 Z" fill="#f7b6c8"/>`;
      case 'fox': return `<path d="M54 74 L60 24 L94 56 Z" fill="${c}"/><path d="M146 74 L140 24 L106 56 Z" fill="${c}"/><path d="M60 24 L66 44 L72 36 Z" fill="${d}"/><path d="M140 24 L134 44 L128 36 Z" fill="${d}"/><path d="M64 62 L66 42 L84 56 Z" fill="#fff5ea"/><path d="M136 62 L134 42 L116 56 Z" fill="#fff5ea"/>`;
      case 'flop': return `<ellipse cx="50" cy="96" rx="16" ry="32" transform="rotate(18 50 96)" fill="${d}"/><ellipse cx="150" cy="96" rx="16" ry="32" transform="rotate(-18 150 96)" fill="${d}"/>`;
      case 'bunny': return `<ellipse cx="78" cy="30" rx="13" ry="36" transform="rotate(-10 78 30)" fill="${c}"/><ellipse cx="122" cy="30" rx="13" ry="36" transform="rotate(10 122 30)" fill="${c}"/><ellipse cx="78" cy="32" rx="6" ry="26" transform="rotate(-10 78 32)" fill="#f7b6c8"/><ellipse cx="122" cy="32" rx="6" ry="26" transform="rotate(10 122 32)" fill="#f7b6c8"/>`;
      case 'round': return `<circle cx="58" cy="62" r="13" fill="${c}"/><circle cx="142" cy="62" r="13" fill="${c}"/><circle cx="58" cy="62" r="6" fill="${d}"/><circle cx="142" cy="62" r="6" fill="${d}"/>`;
      case 'horn': return `<path d="M70 60 Q60 34 74 26 Q74 44 84 54 Z" fill="#fff4d6"/><path d="M130 60 Q140 34 126 26 Q126 44 116 54 Z" fill="#fff4d6"/>`;
      default: return '';
    }
  }
  function tail (s) {
    const c = s.c, d = s.d;
    switch (s.tail) {
      case 'cat': return `<path d="M138 168 Q176 168 170 130 Q166 118 158 124 Q164 150 136 156 Z" fill="${c}"/>`;
      case 'dog': return `<path d="M140 160 Q168 150 164 128" stroke="${d}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
      case 'fox': return `<path d="M136 172 Q190 176 178 122 Q170 110 160 120 Q170 156 132 156 Z" fill="${c}"/><path d="M178 122 Q170 110 160 120 Q166 130 174 132 Z" fill="#fff5ea"/>`;
      case 'puff': return `<circle cx="144" cy="164" r="11" fill="#ffffff"/>`;
      case 'dragon': return `<path d="M136 168 Q178 176 182 146 L192 140 L184 156 Q178 184 134 178 Z" fill="${c}"/>`;
      case 'mane': return `<path d="M138 166 Q178 170 168 138 Q160 156 140 154 Z" fill="#c9a7f5"/><path d="M140 170 Q170 176 172 150" stroke="#9fd8f5" stroke-width="5" fill="none" stroke-linecap="round"/>`;
      case 'otter': return `<path d="M136 172 Q178 182 172 154" stroke="${d}" stroke-width="12" fill="none" stroke-linecap="round"/>`;
      default: return '';
    }
  }
  function eyes (mood) {
    if (mood === 'sleepy') return `<path d="M72 104 Q80 110 88 104" stroke="#2b2133" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M112 104 Q120 110 128 104" stroke="#2b2133" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    if (mood === 'party') return `<path d="M72 106 Q80 96 88 106" stroke="#2b2133" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M112 106 Q120 96 128 106" stroke="#2b2133" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    return `<g class="pa-eyes"><ellipse cx="80" cy="102" rx="8" ry="9.5" fill="#2b2133"/><ellipse cx="120" cy="102" rx="8" ry="9.5" fill="#2b2133"/><circle cx="83" cy="98" r="3" fill="#fff"/><circle cx="123" cy="98" r="3" fill="#fff"/><circle cx="77.5" cy="106" r="1.4" fill="#fff"/><circle cx="117.5" cy="106" r="1.4" fill="#fff"/></g>`;
  }
  function mouth (s, mood) {
    if (s.beak) return `<path d="M92 114 L108 114 L100 124 Z" fill="${s.d}"/>`;
    if (mood === 'party' || mood === 'happy') return `<path d="M92 118 Q100 130 108 118 Z" fill="#7a2f3b"/><path d="M95 123 Q100 127 105 123" fill="#ff8a9a"/>`;
    if (mood === 'cheer') return `<path d="M94 122 Q100 118 106 122" stroke="#2b2133" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    if (s.mouth === 'w') return `<path d="M92 118 Q96 123 100 118 Q104 123 108 118" stroke="#2b2133" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    return `<path d="M93 118 Q100 124 107 118" stroke="#2b2133" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  }

  // ---------- unlockables, drawn where they belong ----------
  const ITEM = {
    '🧣': () => `<g><path d="M60 136 Q100 154 140 136 L142 150 Q100 168 58 150 Z" fill="#e2464f"/><path d="M60 140 Q100 158 140 140" stroke="#ff8a8f" stroke-width="3" fill="none"/><path d="M118 148 L128 182 L142 178 L132 146 Z" fill="#e2464f"/><path d="M124 168 L138 164 M126 175 L140 171" stroke="#ff8a8f" stroke-width="2.5"/></g>`,
    '🎀': () => `<g transform="translate(132 52) rotate(18)"><path d="M0 0 L-22 -12 L-20 12 Z" fill="#ff6fa8"/><path d="M0 0 L22 -12 L20 12 Z" fill="#ff6fa8"/><circle r="6" fill="#ff3d8b"/></g>`,
    '🎩': () => `<g><ellipse cx="100" cy="54" rx="38" ry="8" fill="#26202e"/><rect x="76" y="14" width="48" height="40" rx="5" fill="#26202e"/><rect x="76" y="40" width="48" height="8" fill="#b33a5a"/></g>`,
    '🌸': () => [62, 80, 100, 120, 138].map((x, i) => { const y = 58 - Math.sin((i / 4) * Math.PI) * 10; return `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="5" ry="8" transform="rotate(${a}) translate(0 -6)" fill="${i % 2 ? '#ffd1e8' : '#ffb3d1'}"/>`).join('')}<circle r="3.5" fill="#ffd34d"/></g>`; }).join(''),
    '🕶️': () => `<g><rect x="64" y="92" width="32" height="20" rx="8" fill="#1d1a24"/><rect x="104" y="92" width="32" height="20" rx="8" fill="#1d1a24"/><path d="M96 100 L104 100" stroke="#1d1a24" stroke-width="4"/><path d="M70 97 L80 97" stroke="#6b6680" stroke-width="3" stroke-linecap="round"/><path d="M110 97 L120 97" stroke="#6b6680" stroke-width="3" stroke-linecap="round"/></g>`,
    '🎧': () => `<g><path d="M48 100 Q50 34 100 32 Q150 34 152 100" stroke="#5b5fd6" stroke-width="9" fill="none" stroke-linecap="round"/><rect x="38" y="88" width="20" height="30" rx="9" fill="#7f84ff"/><rect x="142" y="88" width="20" height="30" rx="9" fill="#7f84ff"/></g>`,
    '👑': () => `<g><path d="M70 58 L74 26 L88 44 L100 20 L112 44 L126 26 L130 58 Z" fill="#ffcc33" stroke="#e0a400" stroke-width="2" stroke-linejoin="round"/><circle cx="100" cy="46" r="4" fill="#ff4d6d"/><circle cx="84" cy="50" r="3" fill="#4dc3ff"/><circle cx="116" cy="50" r="3" fill="#4dc3ff"/></g>`,
    '🪄': () => `<g><path d="M150 168 L176 112" stroke="#3b2f4a" stroke-width="5" stroke-linecap="round"/><path d="M176 98 L180 108 L191 109 L183 116 L186 127 L176 121 L166 127 L169 116 L161 109 L172 108 Z" fill="#ffd34d" class="pa-twinkle"/><ellipse cx="148" cy="166" rx="9" ry="7" fill="currentColor" class="pa-paw"/></g>`,
    '🌈': () => '', // drawn behind (see back())
    '🚀': () => `<g transform="translate(158 54) rotate(30)" class="pa-float"><path d="M0 -24 Q12 -10 10 14 L-10 14 Q-12 -10 0 -24 Z" fill="#eef1ff"/><circle cy="-4" r="5" fill="#4dc3ff"/><path d="M-10 6 L-18 18 L-10 14 Z M10 6 L18 18 L10 14 Z" fill="#ff5d73"/><path d="M-6 14 Q0 30 6 14 Z" fill="#ffb02e"/></g>`,
  };
  function back (item) {
    if (item !== '🌈') return '';
    return `<g opacity=".85">${['#ff6b6b', '#ffb84d', '#ffe066', '#6bd98a', '#5cb8ff', '#a98cff'].map((col, i) => `<path d="M${18 + i * 7} 170 A${82 - i * 7} ${82 - i * 7} 0 0 1 ${182 - i * 7} 170" stroke="${col}" stroke-width="7" fill="none"/>`).join('')}</g>`;
  }

  function egg (s, mood, level) {
    const crack = level >= 1 ? '<path d="M66 110 L78 102 L86 112 L96 100 L106 112 L116 102 L126 112 L134 104" stroke="#a58f6b" stroke-width="3" fill="none" stroke-linejoin="round"/>' : '';
    return `<ellipse cx="100" cy="186" rx="44" ry="7" fill="rgba(0,0,0,.18)"/><g class="pa-wobble"><ellipse cx="100" cy="122" rx="52" ry="64" fill="#fff6e4"/><circle cx="78" cy="88" r="9" fill="${s.c}" opacity=".7"/><circle cx="124" cy="78" r="6" fill="${s.c}" opacity=".7"/><circle cx="132" cy="140" r="11" fill="${s.c}" opacity=".7"/><circle cx="70" cy="150" r="7" fill="${s.c}" opacity=".7"/>${crack}${mood === 'sleepy' ? '<path d="M84 128 Q90 133 96 128 M104 128 Q110 133 116 128" stroke="#2b2133" stroke-width="3" fill="none" stroke-linecap="round"/>' : '<ellipse cx="90" cy="128" rx="4" ry="5" fill="#2b2133"/><ellipse cx="110" cy="128" rx="4" ry="5" fill="#2b2133"/>'}<ellipse cx="82" cy="138" rx="6" ry="3.5" fill="#ffb3c1" opacity=".7"/><ellipse cx="118" cy="138" rx="6" ry="3.5" fill="#ffb3c1" opacity=".7"/></g>`;
  }

  function moodBits (mood) {
    if (mood === 'sleepy') return '<g class="pa-zzz" fill="#9aa4c7" font-weight="700" font-family="system-ui,sans-serif"><text x="150" y="60" font-size="18">z</text><text x="162" y="42" font-size="14">z</text><text x="171" y="28" font-size="11">z</text></g>';
    if (mood === 'party') return '<g class="pa-confetti">' + [[30, 40, '#ff6b6b'], [170, 36, '#5cb8ff'], [24, 120, '#ffe066'], [178, 110, '#6bd98a'], [52, 20, '#a98cff'], [150, 18, '#ffb84d']].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${c}" transform="rotate(${i * 30} ${x} ${y})"/>`).join('') + '</g>';
    if (mood === 'cheer') return '<g class="pa-hearts" fill="#ff6b8b"><path d="M34 70 c0 -6 8 -8 10 -2 c2 -6 10 -4 10 2 c0 6 -10 12 -10 12 c0 0 -10 -6 -10 -12z"/><path d="M152 52 c0 -5 7 -7 8 -2 c2 -5 8 -3 8 2 c0 5 -8 10 -8 10 c0 0 -8 -5 -8 -10z"/></g>';
    if (mood === 'happy') return '<g class="pa-sparkle" fill="#ffd34d"><path d="M36 64 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><path d="M164 40 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/></g>';
    return '';
  }

  function svg (o) {
    const s = SPECIES[o.species] || SPECIES['🐱'];
    const level = o.level || 1, mood = o.mood || 'content';
    let inner;
    if (level < 2) inner = egg(s, mood, level);
    else {
      const item = o.item && ITEM[o.item] ? o.item : null;
      const c = s.c, b = s.b;
      const scale = level < 5 ? 0.82 : level < 10 ? 0.9 : level < 16 ? 0.95 : 1;
      const legend = level >= 25 ? '<circle cx="100" cy="110" r="88" fill="url(#paGlow)"/>' : '';
      inner = `${legend}${back(item)}<ellipse cx="100" cy="188" rx="${50 * scale}" ry="7" fill="rgba(0,0,0,.18)"/>
<g transform="translate(${100 - 100 * scale} ${190 - 190 * scale}) scale(${scale})"><g class="pa-bob">
${s.wings ? `<path d="M58 140 Q20 118 26 92 Q44 112 62 124 Z" fill="#b48cf0"/><path d="M142 140 Q180 118 174 92 Q156 112 138 124 Z" fill="#b48cf0"/>` : ''}
${tail(s)}
<ellipse cx="100" cy="156" rx="${s.shell ? 50 : 44}" ry="32" fill="${s.shell ? '#5c9e57' : c}"/>
${s.shell ? '<path d="M70 146 L84 136 L100 142 L116 136 L130 146 L124 162 L100 168 L76 162 Z" fill="#7cbf74" stroke="#4d8a49" stroke-width="2"/>' : `<ellipse cx="100" cy="162" rx="27" ry="22" fill="${b}"/>`}
<ellipse cx="80" cy="184" rx="13" ry="7" fill="${s.beak ? s.d : c}"/><ellipse cx="120" cy="184" rx="13" ry="7" fill="${s.beak ? s.d : c}"/>
<ellipse cx="66" cy="156" rx="10" ry="13" fill="${c}" class="pa-arm"/><ellipse cx="134" cy="156" rx="10" ry="13" fill="${c}"/>
${ears(s)}
<ellipse cx="100" cy="98" rx="56" ry="50" fill="${c}"/>
${s.mask ? `<path d="M56 104 Q60 66 100 70 Q140 66 144 104 Q140 140 100 142 Q60 140 56 104 Z" fill="${b}"/>` : ''}
${s.cheeks ? `<path d="M46 104 Q60 132 98 128 Q80 112 70 96 Z" fill="${b}"/><path d="M154 104 Q140 132 102 128 Q120 112 130 96 Z" fill="${b}"/>` : ''}
${s.muzzle ? `<ellipse cx="100" cy="120" rx="20" ry="15" fill="${b}"/>` : ''}
${s.mane ? '<path d="M64 56 Q78 40 100 48 Q86 52 82 64 Q72 60 64 70 Z" fill="#c9a7f5"/><path d="M72 50 Q90 38 108 46" stroke="#9fd8f5" stroke-width="6" fill="none" stroke-linecap="round"/>' : ''}
${s.horn ? '<path d="M94 50 L100 14 L106 50 Z" fill="#ffd34d" stroke="#e8b400" stroke-width="1.5"/><path d="M96 40 L104 36 M95 30 L103 26" stroke="#e8b400" stroke-width="1.5"/>' : ''}
${eyes(mood)}
<ellipse cx="68" cy="118" rx="9" ry="5.5" fill="#ff9fb2" opacity=".6"/><ellipse cx="132" cy="118" rx="9" ry="5.5" fill="#ff9fb2" opacity=".6"/>
${s.nose ? '<ellipse cx="100" cy="113" rx="5" ry="3.6" fill="#2b2133"/>' : ''}${s.pinknose ? '<path d="M96 112 L104 112 L100 116 Z" fill="#f78fb3"/>' : ''}
${mouth(s, mood)}
${s.whisk ? '<path d="M54 112 L72 114 M54 120 L72 118 M146 112 L128 114 M146 120 L128 118" stroke="#6b5a4e" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>' : ''}
${item ? ITEM[item]() : ''}
</g></g>`;
    }
    return `<svg viewBox="0 0 200 200" class="pa pa-${esc(mood)}" role="img" aria-label="${esc(o.label || 'Your pet')}" style="color:${s.c}"><defs><radialGradient id="paGlow"><stop offset="0" stop-color="#ffe680" stop-opacity=".55"/><stop offset="1" stop-color="#ffe680" stop-opacity="0"/></radialGradient></defs>${moodBits(mood)}${inner}</svg>`;
  }

  window.CGMHubPetArt = { svg, SPECIES };
})();
