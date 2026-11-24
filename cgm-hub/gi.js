/* CGM Hub: glycemic index (GI) and glycemic load (GL).
 * Approximate GI values (glucose = 100) for common foods, from the International Tables of Glycemic Index
 * (Atkinson et al.) as summarised by Harvard Health and the University of Sydney GI database.
 * GL = GI × available (net) carbs ÷ 100. GL under 10 is low, 10–19 medium, 20+ high.
 * General information only: your own CGM response ("your spike") is the better guide. */
(function () {
  'use strict';
  // [keywords (any match), GI]. More specific phrases first.
  const TABLE = [
    [['instant oat', 'quick oat', 'instant oatmeal'], 79], [['steel cut', 'rolled oat', 'oatmeal', 'porridge', 'oats'], 55],
    [['corn flakes', 'cornflakes'], 81], [['rice krispies', 'puffed rice'], 82], [['cheerios'], 74], [['all-bran', 'all bran', 'bran flakes'], 44],
    [['special k'], 69], [['muesli'], 57], [['granola'], 55], [['fibre one', 'fiber one'], 45],
    [['whole wheat bread', 'wholemeal bread', 'whole grain bread', 'multigrain bread'], 74], [['sourdough'], 54], [['rye bread', 'pumpernickel'], 56],
    [['white bread', 'toast', 'baguette', 'bread roll'], 75], [['bagel'], 72], [['pita'], 68], [['english muffin'], 77], [['croissant'], 67],
    [['corn tortilla'], 46], [['tortilla', 'wrap'], 30], [['naan'], 71], [['chapati', 'roti'], 52], [['pancake'], 66], [['waffle'], 76],
    [['basmati'], 58], [['jasmine'], 89], [['brown rice'], 68], [['sticky rice', 'glutinous rice'], 87], [['rice noodle'], 53], [['white rice', 'rice'], 73],
    [['quinoa'], 53], [['couscous'], 65], [['barley'], 28], [['bulgur'], 47], [['whole wheat pasta', 'wholemeal pasta'], 48],
    [['spaghetti', 'pasta', 'macaroni', 'penne', 'fettuccine', 'lasagna', 'linguine'], 49], [['udon'], 55], [['ramen', 'instant noodle'], 47], [['noodle'], 50],
    [['mashed potato', 'instant mashed'], 87], [['french fries', 'fries', 'hash brown'], 63], [['baked potato'], 85], [['sweet potato', 'yam'], 63], [['potato'], 78],
    [['potato chips', 'crisps', 'chips'], 56], [['popcorn'], 65], [['pretzel'], 83], [['rice cake'], 82], [['cracker', 'saltine'], 74],
    [['sweet corn', 'corn kernel', 'whole kernel corn', 'corn'], 52], [['green peas', 'peas'], 51], [['carrot'], 39], [['pumpkin', 'squash'], 64], [['beet'], 64],
    [['chickpea', 'hummus', 'garbanzo'], 28], [['kidney bean'], 24], [['black bean'], 30], [['baked beans'], 40], [['lentil'], 32], [['soybean', 'edamame'], 16], [['bean'], 30],
    [['apple juice'], 41], [['orange juice'], 50], [['apple'], 36], [['pear'], 38], [['orange', 'clementine', 'mandarin'], 43], [['grapefruit'], 25],
    [['banana'], 51], [['pineapple'], 59], [['mango'], 51], [['watermelon'], 76], [['cantaloupe', 'melon'], 65], [['grape'], 59], [['raisin'], 64],
    [['dates', 'medjool'], 42], [['strawberr'], 40], [['blueberr'], 53], [['raspberr', 'blackberr'], 32], [['cherr'], 22], [['peach', 'nectarine'], 42], [['plum'], 40],
    [['kiwi'], 53], [['papaya'], 60], [['apricot'], 34],
    [['skim milk', 'skimmed milk'], 37], [['chocolate milk'], 43], [['soy milk'], 34], [['rice milk'], 86], [['oat milk'], 69], [['almond milk'], 25], [['milk'], 39],
    [['greek yogurt'], 11], [['yogurt', 'yoghurt'], 41], [['ice cream'], 51],
    [['dark chocolate'], 23], [['chocolate'], 40], [['cola', 'soda', 'soft drink', 'coke', 'pepsi'], 59], [['sports drink', 'gatorade', 'powerade'], 78],
    [['glucose tab', 'dextrose', 'glucose'], 100], [['honey'], 61], [['maple syrup'], 54], [['table sugar', 'sucrose', 'sugar'], 65], [['agave'], 15], [['jam', 'jelly'], 51],
    [['pizza'], 60], [['sushi'], 55], [['muffin'], 60], [['donut', 'doughnut'], 76], [['cookie', 'biscuit'], 59], [['cake'], 46], [['granola bar', 'cereal bar'], 61],
  ];
  const lower = (s) => String(s || '').toLowerCase();

  function lookup (name) {
    const n = lower(name);
    if (!n) return null;
    for (const [keys, gi] of TABLE) for (const k of keys) if (n.includes(k)) return gi;
    return null;
  }
  const giBand = (gi) => (gi == null ? null : gi <= 55 ? 'low' : gi <= 69 ? 'medium' : 'high');
  const glBand = (gl) => (gl == null ? null : gl < 10 ? 'low' : gl < 20 ? 'medium' : 'high');
  const gl = (gi, netCarbs) => (gi == null || !(netCarbs > 0) ? null : Math.round((gi * netCarbs) / 100));

  // { gi, giBand, gl, glBand } for a food name + its net carbs. Low-carb foods (< 5 g) barely move glucose: GL only.
  function forFood (name, netCarbs) {
    if (!(netCarbs >= 0)) netCarbs = 0;
    const gi = lookup(name);
    const g = gl(gi, netCarbs);
    return { gi, giBand: giBand(gi), gl: g, glBand: glBand(g), lowCarb: netCarbs < 5 };
  }
  // meal GL: sum of foods; foods without a GI count at 60 (medium) so the total isn't hidden
  function forMeal (foods) {
    let total = 0, known = 0;
    for (const f of foods || []) {
      const c = Number(f.carbs) || 0;
      if (c <= 0) continue;
      const gi = lookup(f.name);
      if (gi != null) known++;
      total += ((gi == null ? 60 : gi) * c) / 100;
    }
    return { gl: Math.round(total), glBand: glBand(Math.round(total)), known };
  }
  function chip (el, info, opts) {
    if (!info || (info.gi == null && info.gl == null) || info.lowCarb) return null;
    const band = info.gi != null ? info.giBand : info.glBand;
    const txt = (info.gi != null ? 'GI ' + info.gi : '') + (info.gl != null && !(opts && opts.noGl) ? (info.gi != null ? ' · ' : '') + 'GL ' + info.gl : '');
    const c = el('span', 'gi-chip gi-' + band, txt);
    c.title = (info.gi != null ? 'Glycemic index ' + info.gi + ' (' + info.giBand + ')' : '') + (info.gl != null ? '. Glycemic load ' + info.gl + ' (' + info.glBand + ')' : '');
    return c;
  }
  window.CGMHubGI = { lookup, forFood, forMeal, giBand, glBand, chip };
})();
