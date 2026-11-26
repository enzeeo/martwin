/* Mockup: Review search as a ledger with a live constellation (sample data, no backend).
   Every feature from the previous stages stays in the sky as its constellation.
   Each kept representation is a bright star in its feature's figure; the star's
   size and glow follow its weight. The ledger below is the real control:
   weights are ASCII bars (drag, click, arrow keys) that always sum to 100,
   ‹ › steps a representation through the feature's catalog options, × removes.
   Hovering a row lights its stars and hovering a star lights its row. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', H = 240, CELLS = 26, EIGHTHS = ' ▏▎▍▌▋▊▉';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const btn = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = n => String(n).padStart(2, '0');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mst(pts) {
    if (pts.length < 2) return [];
    const inTree = [0], edges = [];
    while (inTree.length < pts.length) {
      let best = null;
      for (const u of inTree) pts.forEach((p, v) => { if (inTree.includes(v)) return; const d = dist(pts[u], p); if (!best || d < best[2]) best = [u, v, d]; });
      inTree.push(best[1]); edges.push([best[0], best[1]]);
    }
    return edges;
  }

  /* ---------- sample catalog + plan (headers from the real catalog) ---------- */
  const Q = 'Find windy, gently sloping dune fields on Earth with little vegetation and sandy soil, bright rough ground and cold nights, like the plains west of Jezero.';
  const pre = (p, list, s = '') => list.map(x => p + x + s);
  const C = 'comparison', F = 'filter';
  const CATALOG = [
    { id: 'albedo', kind: C, label: 'Albedo', phrase: 'bright', options: ['albedo'] },
    { id: 'dunes', kind: C, label: 'Dunes', phrase: 'dune fields', options: ['dune_frac', 'dist_dune_km'] },
    { id: 'slope_distribution', kind: C, label: 'Slope distribution', phrase: 'gently sloping', options: pre('slope_', ['mean', 'median', 'std', 'p90', 'p99', 'frac_gt_2', 'frac_gt_5', 'frac_gt_10', 'frac_gt_20', 'frac_gt_30']) },
    { id: 'surface_roughness', kind: C, label: 'Surface roughness', phrase: 'rough ground', options: ['roughness_detrended_std', 'tri_p50', 'tri_p90'] },
    { id: 'surface_temperature', kind: C, label: 'Surface temperature', phrase: 'cold nights', options: pre('tsurf_', ['mean', 'min', 'max', 'diurnal', 'seasonal'], '_K') },
    { id: 'wind', kind: C, label: 'Wind', phrase: 'windy', options: pre('wind_', ['mean', 'min', 'max', 'diurnal', 'seasonal'], '_ms') },
    { id: 'landform_mixture', kind: C, label: 'Landform mixture', phrase: null, options: [...pre('geom_frac_', ['flat', 'peak', 'ridge', 'shoulder', 'spur', 'slope', 'hollow', 'footslope', 'valley', 'pit']), 'tpi_mean', 'tpi_p10', 'tpi_p90'] },
    { id: 'thermal_inertia', kind: C, label: 'Thermal inertia', phrase: null, options: ['ti_pct'] },
    { id: 'elevation', kind: C, label: 'Elevation', phrase: null, options: ['elev_mean_m', 'elev_std_m', 'elev_range_m'] },
    { id: 'earth_land_cover', kind: F, label: 'Earth land cover', phrase: 'little vegetation', unit: '%', scale: 100, options: pre('', ['tree', 'shrub', 'grass', 'crop', 'built', 'bare', 'snow', 'water', 'wetland', 'mangrove', 'moss'], '_frac') },
    { id: 'earth_soilgrids', kind: F, label: 'Earth SoilGrids', phrase: 'sandy soil', unit: '%', scale: 1, options: ['sand_pct', 'silt_pct', 'clay_pct', 'rock_frac_pct'] },
    { id: 'earth_modis_vegetation', kind: F, label: 'Earth MODIS vegetation', phrase: null, unit: 'NDVI', scale: 1, options: ['ndvi_mean', 'ndvi_max'] },
    { id: 'earth_water_mask', kind: F, label: 'Earth water mask', phrase: null, unit: '%', scale: 100, options: ['water_mask_frac'] },
  ];
  const BY = Object.fromEntries(CATALOG.map(f => [f.id, f]));
  const INITIAL = {
    comparisons: { dunes: ['dune_frac'], wind: ['wind_mean_ms', 'wind_max_ms'], slope_distribution: ['slope_median', 'slope_frac_gt_5'], surface_roughness: ['tri_p50'], albedo: ['albedo'], surface_temperature: ['tsurf_min_K', 'tsurf_diurnal_K'], landform_mixture: ['geom_frac_flat'] },
    filters: [['earth_land_cover', 'bare_frac', '>', .4], ['earth_land_cover', 'shrub_frac', '<', .3], ['earth_soilgrids', 'sand_pct', '>', 60], ['earth_modis_vegetation', 'ndvi_mean', '<', .2]],
  };
  const OPS = ['>', '<', 'between'];

  /* ---------- state ---------- */
  let S;
  function reset() {
    S = { comps: [], filters: [], top: 10, sep: 25, continents: new Set(CONTINENTS) };
    for (const [id, hs] of Object.entries(INITIAL.comparisons)) S.comps.push({ f: BY[id], reps: hs.map(h => ({ h, w: 1 })) });
    const n = S.comps.reduce((k, c) => k + c.reps.length, 0); let i = 0;
    for (const c of S.comps) for (const r of c.reps) { r.w = Math.floor(100 / n) + (i++ < 100 % n); } // backend default: even split
    const byF = {};
    for (const [id, h, op, v] of INITIAL.filters) { if (!byF[id]) S.filters.push(byF[id] = { f: BY[id], conds: [] }); byF[id].conds.push({ h, op, v, v2: undefined }); }
  }
  const CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Australia', 'Europe', 'North America', 'South America'];
  const allReps = () => S.comps.flatMap(c => c.reps);
  const total = c => c.reps.reduce((s, r) => s + r.w, 0);
  const featNum = f => { const i = S.comps.findIndex(c => c.f === f); return i >= 0 ? i + 1 : S.comps.length + S.filters.findIndex(c => c.f === f) + 1; };

  /* Same rule as selection.js balanceWeights: the edited weight is pinned,
     the rest scale to fill the remainder, integer percents, never below 1. */
  function balance(edited, value) {
    const reps = allReps(); if (!reps.length) return;
    if (reps.length === 1) { reps[0].w = 100; return; }
    const fixed = edited ? clamp(Math.round(value), 1, 101 - reps.length) : 0;
    const others = reps.filter(r => r !== edited), budget = 100 - fixed;
    const sum = others.reduce((s, r) => s + r.w, 0);
    const exact = others.map(r => sum > 0 ? r.w / sum * budget : budget / others.length);
    const cents = exact.map(x => Math.max(1, Math.floor(x)));
    let diff = budget - cents.reduce((s, x) => s + x, 0);
    const byFrac = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; diff > 0; k++, diff--) cents[byFrac[k % byFrac.length][1]]++;
    while (diff < 0) { const i = cents.indexOf(Math.max(...cents)); cents[i]--; diff++; }
    others.forEach((r, i) => { r.w = cents[i]; });
    if (edited) edited.w = fixed;
  }

  /* ---------- ascii helpers ---------- */
  function barText(w) {
    const filled = clamp(w, 0, 100) / 100 * CELLS, full = Math.floor(filled), part = Math.round((filled - full) * 8);
    const head = '█'.repeat(full) + (part ? EIGHTHS[part] : '');
    return [head, '·'.repeat(Math.max(0, CELLS - full - (part ? 1 : 0)))];
  }
  const ruleLine = () => '─'.repeat(240);

  /* ---------- question ---------- */
  function renderQuestion() {
    const q = $('question'); q.replaceChildren(); const lower = Q.toLowerCase(); let pos = 0;
    CATALOG.filter(f => f.phrase).map(f => ({ f, at: lower.indexOf(f.phrase) })).sort((a, b) => a.at - b.at).forEach(({ f, at }) => {
      q.append(Q.slice(pos, at)); const s = el('span', `hit ${f.kind}`, Q.slice(at, at + f.phrase.length)); s.dataset.f = f.id; q.append(s); pos = at + f.phrase.length;
    });
    q.append(Q.slice(pos));
  }

  /* ---------- sky ---------- */
  const SKY = { figs: new Map(), W: 0 };
  // Each feature keeps a seeded shape relative to its anchor so it looks the same as it moves.
  function shapeFor(f) {
    const r = rng(hash(f.id)), n = f.kind === C ? 3 + (hash(f.id) % 2) : 2, base = [];
    const R = f.kind === C ? 34 : 22;
    for (let t = 0; base.length < n && t < 300; t++) {
      const a = r() * Math.PI * 2, d = R * (.35 + r() * .65), p = { x: Math.cos(a) * d * 1.3, y: Math.sin(a) * d };
      if (!base.some(q => dist(q, p) < 15)) base.push(p);
    }
    return base;
  }
  function repPoint(f, h, taken) {
    const r = rng(hash(f.id + ':' + h)), R = f.kind === C ? 40 : 26;
    let best = null;
    for (let t = 0; t < 60; t++) {
      const a = r() * Math.PI * 2, d = R * (.3 + r() * .7), p = { x: Math.cos(a) * d * 1.35, y: Math.sin(a) * d };
      const gap = Math.min(...taken.map(q => dist(q, p)), 99);
      if (!best || gap > best.gap) best = { ...p, gap };
      if (gap > 18) break;
    }
    return { x: best.x, y: best.y };
  }
  function skyField(W) {
    const r = rng(hash(Q)), g = svgEl('g', { class: 'field' }), target = Math.round(W * H / 700), pts = [];
    for (let t = 0; pts.length < target && t < target * 10; t++) {
      const p = { x: 4 + r() * (W - 8), y: 6 + r() * (H - 12) }; if (pts.some(q => dist(q, p) < 9)) continue;
      const m = Math.pow(r(), 3); pts.push(p);
      g.append(svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (.45 + m * 1.5).toFixed(2), opacity: (.12 + m * .5).toFixed(2) }));
    }
    return g;
  }
  function buildSky() {
    const svg = $('skySvg'), W = $('sky').clientWidth || 1000; SKY.W = W; SKY.figs.clear();
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // Figures only glide when the plan changes, not on first paint.
    svg.classList.add('still'); requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove('still')));
    const band = (y, t) => { const n = svgEl('text', { x: 14, y, class: 'band' }); n.textContent = t; return n; };
    SKY.layer = svgEl('g');
    svg.append(skyField(W), band(16, 'COMPARE ✦'), band(168, 'WHERE ·'), SKY.layer);
    renderSky(true);
  }
  function anchors() {
    const out = new Map(), W = SKY.W, left = 60, right = W - 30;
    const put = (list, y0, y1) => { const step = (right - left) / Math.max(1, list.length); if (list === S.comps) SKY.k = clamp(step / 125, .4, 1); list.forEach((c, i) => out.set(c.f.id, { x: left + step * (i + .5), y: i % 2 ? y1 : y0 })); };
    put(S.comps, 70, 112); put(S.filters, 196, 214);
    return out;
  }
  function renderSky(first) {
    const pos = anchors(), live = new Set();
    for (const c of [...S.comps, ...S.filters]) {
      const f = c.f, kind = f.kind; live.add(f.id);
      let fig = SKY.figs.get(f.id);
      if (!fig) {
        const g = svgEl('g', { class: `fig ${kind}${first || reduced() ? '' : ' enter'}` }); g.dataset.f = f.id;
        fig = { g, base: shapeFor(f), reps: new Map() }; SKY.figs.set(f.id, fig); SKY.layer.append(g);
        g.addEventListener('click', e => { const k = e.target.closest('[data-r]')?.dataset.r; focusRow(k || f.id); });
        const a = pos.get(f.id); g.style.transform = `translate(${a.x}px,${a.y}px)`;
      }
      const a = pos.get(f.id); fig.g.style.transform = `translate(${a.x}px,${a.y}px)`;
      // Representation stars: stable position per header.
      const heads = kind === C ? c.reps.map(r => r.h) : c.conds.map(d => d.h);
      for (const h of [...fig.reps.keys()]) if (!heads.includes(h)) fig.reps.delete(h);
      for (const h of heads) if (!fig.reps.has(h)) fig.reps.set(h, repPoint(f, h, [...fig.base, ...fig.reps.values()]));
      drawFig(fig, c);
    }
    for (const [id, fig] of SKY.figs) if (!live.has(id)) {
      SKY.figs.delete(id); fig.g.classList.add('gone'); fig.g.style.transform += ' scale(.6)';
      setTimeout(() => fig.g.remove(), reduced() ? 0 : 520);
    }
  }
  function drawFig(fig, c) {
    const f = c.f, g = fig.g, isC = f.kind === C; g.replaceChildren();
    // Shapes shrink when many features share a narrow sky.
    const k = SKY.k || 1, sc = p => ({ x: p.x * k, y: p.y * k }), base = fig.base.map(sc);
    const reps = [...fig.reps.entries()].map(([h, p]) => [h, sc(p)]), pts = [...base, ...reps.map(([, p]) => p)];
    const t = isC ? total(c) : 0, strength = isC ? clamp(.3 + t / 35, .3, 1) : .6;
    for (const [u, v] of mst(pts)) g.append(svgEl('line', { x1: pts[u].x.toFixed(1), y1: pts[u].y.toFixed(1), x2: pts[v].x.toFixed(1), y2: pts[v].y.toFixed(1), class: 'edge', 'stroke-opacity': strength.toFixed(2) }));
    for (const p of base) g.append(svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 1.4, class: 'base' }));
    for (const [h, p] of reps) {
      const w = isC ? (c.reps.find(r => r.h === h)?.w ?? 0) : 10;
      const glow = isC ? '#eba078' : '#91bacb', key = f.id + ':' + h;
      const s = svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (1.8 + Math.sqrt(w) * .8).toFixed(2), class: 'rep' });
      s.style.filter = `drop-shadow(0 0 ${(2 + w / 6).toFixed(1)}px ${glow})`; s.dataset.r = key; s.dataset.f = f.id;
      const lab = svgEl('text', { x: (p.x + 7 + Math.sqrt(w) * .8).toFixed(1), y: (p.y + 3).toFixed(1), class: 'rep-label' }); lab.textContent = isC ? `${h} ${w}` : h; lab.dataset.r = key;
      g.append(s, lab);
    }
    const top = pts.reduce((m, p) => p.y < m.y ? p : m, pts[0]);
    const num = svgEl('text', { x: (top.x + 8).toFixed(1), y: (top.y - 6).toFixed(1), class: 'num' });
    num.textContent = isC ? `${pad(featNum(f))} · ${t}` : pad(featNum(f)); g.append(num);
  }
  function updateSkyWeights() { for (const c of S.comps) { const fig = SKY.figs.get(c.f.id); if (fig) drawFig(fig, c); } }

  /* ---------- ledger ---------- */
  let pop = null;
  function closePop() { if (pop) { pop.node.remove(); const back = pop.back; pop = null; back?.focus(); } }
  function openPop(anchor, back, build, wide) {
    closePop(); const node = el('div', `pop${wide ? ' wide' : ''}`); node.setAttribute('role', 'dialog'); build(node); anchor.append(node); pop = { node, back };
    (node.querySelector('input,button:not(:disabled)'))?.focus();
  }
  function optionList(node, items, filterInput) {
    const list = el('div'); node.append(list);
    const paint = () => {
      list.replaceChildren(); const q = (filterInput?.value || '').toLowerCase(); let any = false, lastGrp;
      for (const it of items) {
        if (q && !it.text.toLowerCase().includes(q) && !(it.sub || '').toLowerCase().includes(q)) continue;
        if (it.grp && it.grp !== lastGrp) { list.append(el('div', 'grp', it.grp)); lastGrp = it.grp; }
        const b = btn(it.kept ? 'kept' : ''); b.append(el('span', 'mk', it.kept ? '✦' : '·'), el('span', '', it.text)); if (it.sub) b.append(el('span', 'f-from', it.sub));
        b.disabled = !!it.disabled; b.onclick = () => it.pick(); list.append(b); any = true;
      }
      if (!any) list.append(el('div', 'none', 'Nothing matches.'));
    };
    filterInput?.addEventListener('input', paint); paint();
  }

  function render() {
    const keep = document.activeElement?.dataset?.key, L = $('ledger'); closePop(); L.replaceChildren();
    // COMPARE header with the shared budget bar.
    const r1 = el('div', 'rule'); r1.append(el('span', '', 'Compare'), el('span', 'line', ruleLine()), el('span', 'sum', '')); L.append(r1);
    const budget = el('div', 'budget'); budget.setAttribute('aria-hidden', 'true'); L.append(budget);
    const comps = el('div'); L.append(comps);
    if (!S.comps.length) comps.append(el('p', 'f-from', 'No features to compare. Add one to search.'));
    S.comps.forEach((c, i) => comps.append(featBlock(c, i + 1)));
    const addF = btn('add', '+ add feature'); addF.dataset.key = 'add-feature'; addF.setAttribute('aria-haspopup', 'dialog');
    const addWrap = el('div'); addWrap.style.position = 'relative'; addWrap.append(addF); L.append(addWrap);
    addF.onclick = () => openFeaturePicker(addWrap, addF, C);
    // WHERE section.
    const r2 = el('div', 'rule'); r2.append(el('span', '', 'Where'), el('span', 'line', ruleLine()), el('span', 'sum', 'match all')); L.append(r2);
    const fl = el('div'); L.append(fl);
    if (!S.filters.length) fl.append(el('p', 'f-from', 'No Earth filters. Every land cell is eligible.'));
    S.filters.forEach((c, i) => fl.append(filterBlock(c, S.comps.length + i + 1)));
    const addW = btn('add', '+ add filter'); addW.dataset.key = 'add-filter'; addW.setAttribute('aria-haspopup', 'dialog');
    const addWrap2 = el('div'); addWrap2.style.position = 'relative'; addWrap2.append(addW); L.append(addWrap2);
    addW.onclick = () => openFeaturePicker(addWrap2, addW, F);
    renderSky(); update(); renderSentence();
    if (keep) (L.querySelector(`[data-key="${CSS.escape(keep)}"]`) || $(keep === 'add-filter' ? 'ledger' : 'ledger').querySelector('[data-key="add-feature"]'))?.focus();
  }

  function featHead(c, n, onRemove) {
    const f = c.f, h = el('div', 'feat-head');
    const x = btn('x', '×', `Remove ${f.label}`); x.dataset.key = 'xf:' + f.id; x.onclick = onRemove;
    const tot = el('span', 'f-total', f.kind === C ? '' : ''); tot.dataset.total = f.id;
    h.append(el('span', 'f-num', pad(n)), el('span', 'f-star', f.kind === C ? '✦' : '·'), el('span', 'f-name', f.label), el('span', 'f-from', f.phrase ? `from “${f.phrase}”` : 'inferred from context'), tot, x);
    return h;
  }

  // ‹ name › — steps through options the feature is not already using.
  function cycler(c, item, used, swap, kind) {
    const f = c.f, wrap = el('div', 'cycler'), free = f.options.filter(o => o === item.h || !used.includes(o));
    const at = free.indexOf(item.h);
    const prev = btn('step', '‹', `Previous representation for ${f.label}`), next = btn('step', '›', `Next representation for ${f.label}`);
    prev.disabled = next.disabled = free.length < 2;
    prev.onclick = () => swap(free[(at - 1 + free.length) % free.length]); next.onclick = () => swap(free[(at + 1) % free.length]);
    const name = btn('rep-name', item.h, `${item.h}, change representation`); name.setAttribute('aria-haspopup', 'dialog');
    name.dataset.key = `rn:${f.id}:${item.h}`; prev.dataset.key = `rp:${f.id}:${item.h}`; next.dataset.key = `rx:${f.id}:${item.h}`;
    name.onclick = () => openPop(wrap.parentNode, name, node => {
      optionList(node, f.options.map(o => ({ text: o, kept: used.includes(o), disabled: used.includes(o) && o !== item.h, pick: () => { swap(o); } })));
    });
    wrap.append(prev, name, next);
    return wrap;
  }

  function featBlock(c, n) {
    const f = c.f, box = el('section', 'feat comparison'); box.dataset.f = f.id;
    box.append(featHead(c, n, () => { S.comps = S.comps.filter(x => x !== c); balance(); render(); }));
    const ul = el('ul', 'reps'), used = c.reps.map(r => r.h);
    for (const r of c.reps) {
      const li = el('li', 'rep-row'), key = f.id + ':' + r.h; li.dataset.r = key; li.dataset.f = f.id;
      const swap = h => { r.h = h; render(); const k = `rn:${f.id}:${h}`; $('ledger').querySelector(`[data-key="${CSS.escape(k)}"]`)?.focus(); };
      const bar = el('span', 'bar'); bar.setAttribute('role', 'slider'); bar.tabIndex = 0; bar.dataset.key = 'w:' + key; bar.dataset.w = key;
      Object.entries({ 'aria-label': `Weight for ${r.h}`, 'aria-valuemin': '1', 'aria-valuemax': '100' }).forEach(([k, v]) => bar.setAttribute(k, v));
      bar.append(el('span', 'fill'), el('span', 'empty'));
      const set = v => { balance(r, v); update(); };
      bar.onkeydown = e => {
        const step = e.shiftKey || e.key.startsWith('Page') ? 10 : 1, d = { ArrowRight: step, ArrowUp: step, PageUp: step, ArrowLeft: -step, ArrowDown: -step, PageDown: -step }[e.key];
        if (d) { e.preventDefault(); set(r.w + d); } else if (e.key === 'Home') { e.preventDefault(); set(1); } else if (e.key === 'End') { e.preventDefault(); set(100); }
      };
      bar.onpointerdown = e => {
        if (allReps().length < 2) return; bar.setPointerCapture(e.pointerId); bar.focus();
        const at = ev => { const b = bar.getBoundingClientRect(), cell = b.width / CELLS; set(Math.round(clamp((ev.clientX - b.left) / (cell * CELLS), 0, 1) * 100)); };
        at(e); bar.onpointermove = at; bar.onpointerup = bar.onpointercancel = () => { bar.onpointermove = null; };
      };
      const num = el('input', 'wnum'); Object.assign(num, { type: 'number', min: 1, max: 100, step: 1 }); num.dataset.key = 'n:' + key; num.dataset.n = key; num.setAttribute('aria-label', `Weight percent for ${r.h}`);
      num.onchange = () => { const v = Number(num.value); if (Number.isFinite(v)) set(v); else update(); };
      const x = btn('x', '×', `Remove ${r.h}`); x.dataset.key = 'xr:' + key;
      x.onclick = () => { c.reps = c.reps.filter(q => q !== r); if (!c.reps.length) S.comps = S.comps.filter(q => q !== c); balance(); render(); };
      li.append(el('span'), cycler(c, r, used, swap, C), bar, num, x); ul.append(li);
    }
    box.append(ul);
    const free = f.options.filter(o => !used.includes(o));
    if (free.length) {
      const wrap = el('div'); wrap.style.position = 'relative';
      const add = btn('add add-rep', `+ representation  (${free.length} more)`); add.dataset.key = 'ar:' + f.id; add.setAttribute('aria-haspopup', 'dialog');
      add.onclick = () => openPop(wrap, add, node => optionList(node, free.map(o => ({ text: o, pick: () => {
        const rep = { h: o, w: 1 }; c.reps.push(rep); balance(rep, Math.round(100 / allReps().length)); render();
      } }))));
      wrap.append(add); box.append(wrap);
    }
    return box;
  }

  function filterBlock(c, n) {
    const f = c.f, box = el('section', 'feat filter'); box.dataset.f = f.id;
    box.append(featHead(c, n, () => { S.filters = S.filters.filter(x => x !== c); render(); }));
    const ul = el('ul', 'reps'), used = c.conds.map(d => d.h), scale = f.scale || 1;
    for (const d of c.conds) {
      const li = el('li', 'cond'), key = f.id + ':' + d.h; li.dataset.r = key; li.dataset.f = f.id;
      const swap = h => { d.h = h; render(); $('ledger').querySelector(`[data-key="${CSS.escape(`rn:${f.id}:${h}`)}"]`)?.focus(); };
      const op = btn('op', d.op === 'between' ? '↔ between' : d.op, `Operator for ${d.h}: ${d.op}. Change`); op.dataset.key = 'op:' + key;
      op.onclick = () => { d.op = OPS[(OPS.indexOf(d.op) + 1) % OPS.length]; if (d.op === 'between' && d.v2 === undefined) d.v2 = d.v; render(); };
      const vals = el('div', 'vals'), input = (v, set, label) => { const i = el('input'); Object.assign(i, { type: 'number', step: 'any', value: v === undefined ? '' : +(v * scale).toFixed(3) }); i.setAttribute('aria-label', label); i.oninput = () => { set(i.value === '' ? undefined : Number(i.value) / scale); renderSentence(); }; return i; };
      vals.append(input(d.v, v => { d.v = v; }, `Value for ${d.h}`));
      if (d.op === 'between') vals.append(el('span', '', 'and'), input(d.v2, v => { d.v2 = v; }, `Upper value for ${d.h}`));
      vals.append(el('span', '', f.unit === 'NDVI' ? '' : f.unit || ''));
      const x = btn('x', '×', `Remove ${d.h} filter`); x.dataset.key = 'xr:' + key;
      x.onclick = () => { c.conds = c.conds.filter(q => q !== d); if (!c.conds.length) S.filters = S.filters.filter(q => q !== c); render(); };
      li.append(el('span'), cycler(c, d, used, swap, F), op, vals, x); ul.append(li);
    }
    box.append(ul);
    const free = f.options.filter(o => !used.includes(o));
    if (free.length) {
      const wrap = el('div'); wrap.style.position = 'relative';
      const add = btn('add add-rep', `+ condition  (${free.length} more)`); add.dataset.key = 'ar:' + f.id; add.setAttribute('aria-haspopup', 'dialog');
      add.onclick = () => openPop(wrap, add, node => optionList(node, free.map(o => ({ text: o, pick: () => { c.conds.push({ h: o, op: '>', v: undefined }); render(); } }))));
      wrap.append(add); box.append(wrap);
    }
    return box;
  }

  function openFeaturePicker(wrap, back, kind) {
    openPop(wrap, back, node => {
      const q = el('input'); q.type = 'search'; q.placeholder = kind === C ? 'Search features' : 'Search Earth fields'; q.setAttribute('aria-label', q.placeholder); node.append(q);
      const inPlan = new Set([...S.comps, ...S.filters].map(c => c.f.id));
      const items = CATALOG.filter(f => f.kind === kind).map(f => ({
        text: f.label, sub: `${f.options.length} representation${f.options.length > 1 ? 's' : ''}`, kept: inPlan.has(f.id), disabled: inPlan.has(f.id),
        pick: () => {
          if (kind === C) { const rep = { h: f.options[0], w: 1 }; S.comps.push({ f, reps: [rep] }); balance(rep, Math.round(100 / allReps().length)); }
          else S.filters.push({ f, conds: [{ h: f.options[0], op: '>', v: undefined }] });
          render(); $('ledger').querySelector(`[data-key="${CSS.escape(`rn:${f.id}:${f.options[0]}`)}"]`)?.focus();
        },
      }));
      optionList(node, items, q);
    }, true);
  }

  // Weight-only refresh: bars, numbers, subtotals, budget, sky. Keeps focus and drag state.
  function update() {
    const L = $('ledger'), sum = allReps().reduce((s, r) => s + r.w, 0);
    for (const c of S.comps) {
      const t = L.querySelector(`[data-total="${CSS.escape(c.f.id)}"]`); if (t) t.textContent = String(total(c));
      for (const r of c.reps) {
        const key = c.f.id + ':' + r.h, bar = L.querySelector(`[data-w="${CSS.escape(key)}"]`), num = L.querySelector(`[data-n="${CSS.escape(key)}"]`);
        if (bar) { const [a, b] = barText(r.w); bar.firstChild.textContent = a; bar.lastChild.textContent = b; bar.setAttribute('aria-valuenow', r.w); bar.setAttribute('aria-valuetext', `${r.w} percent`); bar.setAttribute('aria-disabled', String(allReps().length < 2)); }
        if (num && document.activeElement !== num) num.value = r.w;
      }
    }
    const s = L.querySelector('.rule .sum'); if (s) { s.textContent = `Σ ${sum}`; s.classList.toggle('bad', S.comps.length > 0 && sum !== 100); }
    const budget = L.querySelector('.budget');
    if (budget) {
      budget.replaceChildren();
      S.comps.forEach((c, i) => { const seg = el('span', '', (i % 2 ? '▓' : '█').repeat(200)); seg.style.flex = `0 0 ${total(c)}%`; seg.dataset.f = c.f.id; seg.title = `${c.f.label} · ${total(c)}`; budget.append(seg); });
    }
    updateSkyWeights(); renderSentence();
  }

  /* ---------- recap sentence ---------- */
  function renderSentence() {
    const p = $('sentence'); if (!p) return;
    const keepFocus = document.activeElement?.dataset?.key; p.replaceChildren();
    if (!S.comps.length) { p.append('Add a feature to compare before searching.'); $('go').disabled = true; status(''); return; }
    $('go').disabled = false;
    const top = [...S.comps].sort((a, b) => total(b) - total(a));
    p.append('Find Earth cells like ');
    top.slice(0, 3).forEach((c, i) => { if (i) p.append(' · '); const s = el('b', 'c'); s.textContent = `✦ ${c.f.label.toLowerCase()} ${total(c)}`; s.dataset.f = c.f.id; p.append(s); });
    if (top.length > 3) p.append(` + ${top.length - 3} more`);
    const nc = S.filters.reduce((k, c) => k + c.conds.length, 0), open = S.filters.flatMap(c => c.conds).filter(d => d.v === undefined || (d.op === 'between' && d.v2 === undefined)).length;
    p.append(nc ? ', where ' : ', with no Earth filters'); if (nc) { const f = el('b', 'f'); f.textContent = `${nc} condition${nc > 1 ? 's' : ''} hold`; p.append(f); }
    p.append(', on ');
    const cont = btn('tok', S.continents.size === CONTINENTS.length ? 'all continents' : `${S.continents.size} continent${S.continents.size === 1 ? '' : 's'}`); cont.dataset.key = 'cont'; cont.setAttribute('aria-expanded', String(!$('continents').hidden));
    cont.onclick = () => { $('continents').hidden = !$('continents').hidden; renderSentence(); }; p.append(cont, ' → top ');
    const num = (val, set, key, label) => { const i = el('input'); Object.assign(i, { type: 'number', min: key === 'top' ? 1 : 0, max: key === 'top' ? 100 : undefined, value: val }); i.dataset.key = key; i.setAttribute('aria-label', label); i.onchange = () => set(Number(i.value)); return i; };
    p.append(num(S.top, v => { S.top = clamp(Math.round(v) || 1, 1, 100); renderSentence(); }, 'top', 'Number of results'), ', at least ', num(S.sep, v => { S.sep = Math.max(0, v || 0); renderSentence(); }, 'sep', 'Minimum separation in km'), ' km apart.');
    if (keepFocus) p.querySelector(`[data-key="${keepFocus}"]`)?.focus();
    status(open ? `${open} filter value${open > 1 ? 's' : ''} still empty` : '', !!open);
  }
  function status(t, bad) { const s = $('status'); s.textContent = t; s.classList.toggle('bad', !!bad); }
  function buildContinents() {
    const box = $('continents'); box.replaceChildren();
    for (const name of CONTINENTS) {
      const l = el('label'), i = el('input'); i.type = 'checkbox'; i.checked = S.continents.has(name);
      i.onchange = () => { i.checked ? S.continents.add(name) : S.continents.delete(name); renderSentence(); };
      l.append(i, name); box.append(l);
    }
  }

  /* ---------- linking: hover a row ↔ hover its stars ---------- */
  function focusRow(k) {
    const n = $('ledger').querySelector(`[data-key="${CSS.escape('w:' + k)}"]`) || $('ledger').querySelector(`[data-f="${CSS.escape(k)}"] [data-key^="w:"], [data-f="${CSS.escape(k)}"] .rep-name`) || $('ledger').querySelector(`[data-key="${CSS.escape('rn:' + k)}"]`);
    n?.focus(); n?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
  function link(on) {
    return e => {
      const t = e.target.closest?.('[data-r],[data-f]'); if (!t) return;
      const root = $('panel'), f = t.dataset.f || t.closest('[data-f]')?.dataset.f, r = t.dataset.r;
      if (f) root.querySelectorAll(`[data-f="${CSS.escape(f)}"]`).forEach(n => n.classList.toggle('on', on));
      if (r) root.querySelectorAll(`[data-r="${CSS.escape(r)}"]`).forEach(n => n.classList.toggle('on', on));
    };
  }
  $('panel').addEventListener('mouseover', link(true)); $('panel').addEventListener('mouseout', link(false));
  $('panel').addEventListener('focusin', link(true)); $('panel').addEventListener('focusout', link(false));
  document.addEventListener('pointerdown', e => { if (pop && !pop.node.contains(e.target) && !e.target.closest('[aria-haspopup]')) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { e.preventDefault(); closePop(); } });
  $('go').onclick = () => status('Mockup · no search is sent. The live page would POST this plan to /api/score.');

  let rw; addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(() => { if (Math.abs(($('sky').clientWidth || 0) - SKY.W) > 4) buildSky(); }, 150); });
  reset(); renderQuestion(); buildContinents(); buildSky(); render();
})();
