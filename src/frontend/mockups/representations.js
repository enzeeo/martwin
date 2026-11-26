/* Mockup: choosing representations (sample data, no backend).
   Each selected feature is a constellation; its catalog options are promoted
   from the background field as candidate stars. The sky shows five features
   at a time. While the model works the constellations pulse and lines rewire
   at random. When the answer arrives it is replayed in the order the model
   wrote it: comparisons, then filters, each group alphabetical (the order
   representation_families() sends them). */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', H = 250, PAGE = 5, POOL = ':;!il1rcvxz+=tf{}[]<>#%@', DUST = '.:;·  ';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const fmt = s => s.toFixed(1).padStart(4, '0');
  function mst(pts) {
    const inTree = [0], edges = [];
    while (inTree.length < pts.length) {
      let best = null;
      for (const u of inTree) pts.forEach((p, v) => { if (inTree.includes(v)) return; const d = dist(pts[u], p); if (!best || d < best[2]) best = [u, v, d]; });
      inTree.push(best[1]); edges.push([best[0], best[1]]);
    }
    return edges;
  }

  /* ---------- sample run (real catalog headers) ---------- */
  const Q = 'Find windy, gently sloping dune fields on Earth with little vegetation and sandy soil, bright rough ground and cold nights, like the plains west of Jezero.';
  const pre = (p, list) => list.map(s => p + s);
  const C = 'comparison', F = 'filter';
  const FEATURES = [
    { id: 'albedo', kind: C, label: 'Albedo', phrase: 'bright', options: ['albedo'], keep: ['albedo'] },
    { id: 'dunes', kind: C, label: 'Dunes', phrase: 'dune fields', options: ['dune_frac', 'dist_dune_km'], keep: ['dune_frac'] },
    { id: 'landform_mixture', kind: C, label: 'Landform mixture', phrase: null, options: [...pre('geom_frac_', ['flat', 'peak', 'ridge', 'shoulder', 'spur', 'slope', 'hollow', 'footslope', 'valley', 'pit']), 'tpi_mean', 'tpi_p10', 'tpi_p90'], keep: ['geom_frac_flat', 'geom_frac_slope'] },
    { id: 'slope_distribution', kind: C, label: 'Slope distribution', phrase: 'gently sloping', options: pre('slope_', ['mean', 'median', 'std', 'p90', 'p99', 'frac_gt_2', 'frac_gt_5', 'frac_gt_10', 'frac_gt_20', 'frac_gt_30']), keep: ['slope_median', 'slope_frac_gt_5'] },
    { id: 'surface_roughness', kind: C, label: 'Surface roughness', phrase: 'rough ground', options: ['roughness_detrended_std', 'tri_p50', 'tri_p90'], keep: ['tri_p50'] },
    { id: 'surface_temperature', kind: C, label: 'Surface temperature', phrase: 'cold nights', options: pre('tsurf_', ['mean_K', 'min_K', 'max_K', 'diurnal_K', 'seasonal_K']), keep: ['tsurf_min_K', 'tsurf_diurnal_K'] },
    { id: 'thermal_inertia', kind: C, label: 'Thermal inertia', phrase: null, options: ['ti_pct'], keep: ['ti_pct'] },
    { id: 'wind', kind: C, label: 'Wind', phrase: 'windy', options: pre('wind_', ['mean_ms', 'min_ms', 'max_ms', 'diurnal_ms', 'seasonal_ms']), keep: ['wind_mean_ms', 'wind_max_ms'] },
    { id: 'earth_land_cover', kind: F, label: 'Earth land cover', phrase: 'little vegetation', options: pre('', ['tree', 'shrub', 'grass', 'crop', 'built', 'bare', 'snow', 'water', 'wetland', 'mangrove', 'moss']).map(s => s + '_frac'), keep: ['shrub_frac', 'bare_frac'] },
    { id: 'earth_modis_vegetation', kind: F, label: 'Earth MODIS vegetation', phrase: null, options: ['ndvi_mean', 'ndvi_max'], keep: ['ndvi_mean'] },
    { id: 'earth_soilgrids', kind: F, label: 'Earth SoilGrids', phrase: 'sandy soil', options: ['sand_pct', 'silt_pct', 'clay_pct', 'rock_frac_pct'], keep: ['sand_pct'] },
    { id: 'earth_water_mask', kind: F, label: 'Earth water mask', phrase: null, options: ['water_mask_frac'], keep: ['water_mask_frac'] },
  ];
  FEATURES.forEach((f, i) => { f.num = i + 1; f.page = Math.floor(i / PAGE); f.slot = i % PAGE; });
  const PAGES = Math.ceil(FEATURES.length / PAGE);
  const TOTAL = FEATURES.reduce((n, f) => n + f.options.length, 0), KEPT = FEATURES.reduce((n, f) => n + f.keep.length, 0);
  const NC = FEATURES.filter(f => f.kind === C).length;
  // Default weights as the backend computes them: even split, remainders to the leading items.
  const keptComparisons = FEATURES.filter(f => f.kind === C).flatMap(f => f.keep);
  const WEIGHT = Object.fromEntries(keptComparisons.map((h, i) => [h, Math.floor(100 / keptComparisons.length) + (i < 100 % keptComparisons.length)]));
  const T = { selected: 6.2, reps: 6.3 };

  /* ---------- settings + timers ---------- */
  let view = 'sky', motion = 'full', wait = '6', phase = 'features', P = {}, waitStart = 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const every = (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; };
  const clearAll = () => { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); };
  const reduced = () => motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const panel = $('panel');

  /* ---------- text effects ---------- */
  function decode(node, text, dur = 360, delay = 0) {
    if (reduced()) { node.textContent = text; return; }
    const steps = 9;
    node.textContent = text.replace(/./g, () => pick(POOL));
    for (let s = 1; s <= steps; s++) later(() => {
      const shown = Math.round(text.length * s / steps);
      node.textContent = text.slice(0, shown) + text.slice(shown).replace(/./g, () => pick(POOL));
    }, delay + dur * s / steps);
  }
  function dissolve(node, text, done, delay = 0) {
    if (reduced()) { done(); return; }
    const order = [...text].map((_, i) => i).sort(() => Math.random() - .5), steps = 6;
    for (let s = 1; s <= steps; s++) later(() => {
      const gone = new Set(order.slice(0, Math.round(text.length * s / steps)));
      node.textContent = [...text].map((c, i) => gone.has(i) ? pick(DUST) : c).join('');
    }, delay + s * 60);
    later(() => {
      const w = node.offsetWidth;
      node.animate([{ maxWidth: w + 'px', opacity: .5 }, { maxWidth: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px', borderWidth: '0px', marginRight: '-6px' }], { duration: 260, easing: 'ease-in' })
        .onfinish = () => { node.textContent = text; done(); };
    }, delay + steps * 60 + 30);
  }

  /* ---------- panel ---------- */
  function head() {
    const h = el('div', 'panel-head'), l = el('div');
    l.append(el('div', 'eyebrow', '02 / Representations'), el('h2', '', 'Choosing how to measure each feature'));
    h.append(l, el('span', 'target', '18.44° N / 77.45° E · Jezero'));
    return h;
  }
  function fillHits(q) {
    const lower = Q.toLowerCase(); let pos = 0;
    FEATURES.filter(f => f.phrase).map(f => ({ f, at: lower.indexOf(f.phrase) })).sort((a, b) => a.at - b.at).forEach(({ f, at }) => {
      q.append(Q.slice(pos, at));
      const span = el('span', `sv-hit ${f.kind}`, Q.slice(at, at + f.phrase.length)); span.dataset.f = f.id;
      span.append(el('sup', '', String(f.num))); q.append(span); pos = at + f.phrase.length;
    });
    q.append(Q.slice(pos));
  }
  function setClock(message, live, done) {
    const c = P.clock; if (!c) return; c.replaceChildren(el('span', done ? 'sv-dot done' : 'sv-dot'), el('span', '', message));
    if (live) { const t = el('span', 'sv-timer'), from = live === true ? performance.now() : live, up = () => { t.textContent = fmt((performance.now() - from) / 1000) + 's'; }; up(); every(up, 100); c.append(t); }
  }

  /* ---------- layout: five slots; every page reuses the slots ---------- */
  function layout(W) {
    const r = rng(hash(Q)), regionW = W / PAGE, stars = [];
    FEATURES.forEach(f => {
      const k = f.slot, ax = regionW * (k + .5), ay = H * ((k + f.page) % 2 ? .6 : .4), pts = [], want = 4 + ((k + f.page) % 2);
      for (let t = 0; pts.length < want && t < 500; t++) {
        const a = r() * Math.PI * 2, d = 12 + r() * 30, p = { x: ax + Math.cos(a) * d * 1.5, y: ay + Math.sin(a) * d, m: .4 + r() * .6 };
        if (!pts.some(q => dist(q, p) < 22)) pts.push(p);
      }
      f.geo = { ax, ay, x0: Math.max(W * .05, regionW * k + 6), x1: Math.min(W * .95, regionW * (k + 1) - 6), pts, edges: mst(pts) };
    });
    const target = Math.round(W * H / 620);
    for (let t = 0; stars.length < target && t < target * 15; t++) {
      const s = { x: 6 + r() * (W - 12), y: 8 + r() * (H - 16) };
      if (stars.some(o => dist(o, s) < 9) || FEATURES.some(f => f.geo.pts.some(p => dist(p, s) < 13))) continue;
      s.m = Math.pow(r(), 3); s.r = .5 + s.m * 1.7; stars.push(s);
    }
    for (let p = 0; p < PAGES; p++) {
      const used = new Set();
      FEATURES.filter(f => f.page === p).forEach(f => {
        const g = f.geo, chosen = [];
        const pool = stars.filter(s => !used.has(s) && s.x > g.x0 && s.x < g.x1 && s.y > 16 && s.y < H - 16 && !g.pts.some(q => dist(q, s) < 16))
          .map(s => ({ s, d: Math.hypot((s.x - g.ax) / 1.35, s.y - g.ay) })).filter(o => o.d > 30).sort((a, b) => a.d - b.d);
        for (const { s } of pool) { if (chosen.length === f.options.length) break; if (!chosen.some(c => dist(c, s) < 16)) chosen.push(s); }
        while (chosen.length < f.options.length) { const s = { x: g.x0 + r() * (g.x1 - g.x0), y: 20 + r() * (H - 40), m: 0, r: .6 }; stars.push(s); chosen.push(s); }
        for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
        chosen.forEach(s => used.add(s));
        f.cands = f.options.map((h, i) => ({ h, f, star: chosen[i], keep: f.keep.includes(h), key: `${f.id}:${h}` }));
      });
    }
    return stars;
  }

  function buildSky() {
    panel.replaceChildren(); panel.classList.toggle('motion-reduced', reduced());
    const root = el('div', 'sv sv-sky-view'), q = el('p', 'sv-question'), bar = el('div', 'sky-bar'), sky = el('div', 'sv-sky'), svg = svgEl('svg');
    const clock = el('p', 'sv-clock'), list = el('ol', 'sv-list'), plan = el('section', 'plan');
    sky.style.height = H + 'px'; sky.style.marginTop = '6px'; sky.append(svg); plan.hidden = true; fillHits(q);
    const range = el('span'), pager = el('div', 'pager'); bar.append(range, pager);
    root.append(q, bar, sky, clock, list, plan); panel.append(head(), root);
    const W = sky.clientWidth || 1000;
    P = { root, q, sky, svg, clock, list, plan, W, range, pager, page: 0, pages: [] };
    const stars = layout(W);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const field = svgEl('g', { class: 'sv-stars' });
    for (const s of stars) field.append(svgEl('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1), r: s.r.toFixed(2), opacity: (.16 + s.m * .6).toFixed(2) }));
    P.pings = svgEl('g'); svg.append(field, P.pings);
    for (let p = 0; p < PAGES; p++) {
      const g = svgEl('g', { class: 'page' }), figs = svgEl('g', { class: 'sv-figures settled' });
      const pg = { g, keep: svgEl('g'), cand: svgEl('g'), label: svgEl('g'), labels: [] };
      g.append(pg.keep, figs, pg.cand, pg.label); svg.append(g); P.pages.push(pg); // keep lines sit under every star
      FEATURES.filter(f => f.page === p).forEach(f => {
        const grp = svgEl('g', { class: `cn ${f.kind}${f.phrase ? '' : ' inferred'}` }); grp.dataset.f = f.id; f.grp = grp;
        f.geo.edges.forEach(([u, v]) => grp.append(svgEl('line', { x1: f.geo.pts[u].x, y1: f.geo.pts[u].y, x2: f.geo.pts[v].x, y2: f.geo.pts[v].y, class: 'cn-edge', style: `animation-delay:${(f.slot * .3 + u * .12).toFixed(2)}s` })));
        // Stars pulse in a ripple through each figure; figures are offset from each other.
        f.geo.pts.forEach((pt, i) => { pt.el = svgEl('circle', { cx: pt.x, cy: pt.y, r: (1.8 + pt.m * 2).toFixed(2), class: 'cn-star', style: `animation-delay:${(f.slot * .3 + i * .18).toFixed(2)}s` }); grp.append(pt.el); });
        const top = f.geo.pts.reduce((m, pt) => pt.y < m.y ? pt : m), t = svgEl('text', { x: top.x + 8, y: top.y + 4, class: 'cn-num' }); t.textContent = String(f.num).padStart(2, '0'); grp.append(t);
        pg.labels.push({ x: top.x + 8, y: top.y + 4, w: 13 }); // kept labels steer around the number
        figs.append(grp);
      });
    }
    for (let p = 0; p < PAGES; p++) {
      const b = el('button', '', String(p + 1)); b.type = 'button'; b.onclick = () => { if (phase !== 'resolving') { goPage(p); if (phase === 'waiting') cycle(); } };
      pager.append(b);
    }
    for (const f of FEATURES) {
      const li = el('li', `sv-row ${f.kind}${f.phrase ? '' : ' inferred'}`); li.dataset.f = f.id; f.row = li;
      f.from = el('span', 'sv-from', f.phrase ? `from “${f.phrase}”` : 'inferred from context');
      f.tags = el('div', 'cands'); f.tags.hidden = true;
      const name = el('span', 'sv-name', f.label);
      name.onclick = () => { if (phase !== 'resolving' && f.page !== P.page) { goPage(f.page); if (phase === 'waiting') cycle(); } };
      li.append(el('span', 'sv-num', String(f.num).padStart(2, '0')), name, f.from, el('span', `tag ${f.kind}`, f.kind), f.tags);
      list.append(li);
    }
    const hover = on => e => {
      const t = e.target.closest?.('[data-c],[data-f]'); if (!t) return;
      const key = t.dataset.c ? ['c', t.dataset.c] : ['f', t.dataset.f];
      root.querySelectorAll(`[data-${key[0]}="${CSS.escape(key[1])}"]`).forEach(n => n.classList.toggle('on', on));
    };
    root.addEventListener('mouseover', hover(true)); root.addEventListener('mouseout', hover(false));
    goPage(0);
  }
  function goPage(p) {
    P.page = p;
    P.pages.forEach((pg, i) => pg.g.classList.toggle('off', i !== p));
    FEATURES.forEach(f => f.row.classList.toggle('in-view', f.page === p));
    const fs = FEATURES.filter(f => f.page === p);
    P.range.textContent = `Features ${fs[0].num}–${fs[fs.length - 1].num} of ${FEATURES.length} in the sky · comparisons first, then filters`;
    [...P.pager.children].forEach((b, i) => {
      b.setAttribute('aria-current', String(i === p));
      b.classList.toggle('done', FEATURES.filter(f => f.page === i).every(f => f.decided));
      b.disabled = phase === 'resolving';
    });
  }
  // While waiting, page through the sky so every candidate gets shown.
  function cycle() {
    clearTimeout(P.cycle); timers.delete(P.cycle);
    if (PAGES < 2 || reduced()) return;
    P.cycle = later(() => { goPage((P.page + 1) % PAGES); cycle(); }, 3600);
  }

  /* ---------- stage 1: candidates appear ---------- */
  function showCandidates(animate) {
    let end = 0; P.sky.classList.add('choosing'); P.list.classList.add('paged');
    FEATURES.forEach((f, idx) => {
      const base = animate ? (f.page === 0 ? 250 + f.slot * 260 : 250 + idx * 90) : 0;
      f.tags.hidden = false;
      f.from.textContent = `${f.phrase ? `from “${f.phrase}” · ` : 'inferred · '}${f.options.length} candidate${f.options.length === 1 ? '' : 's'}`;
      f.cands.forEach((c, i) => {
        const d = base + i * 40;
        // Crowded features get smaller stars, skewed so most are small and a few stand out.
        const crowd = Math.min(1, (f.options.length - 1) / 12), rmax = 2.6 - crowd * .6, rmin = 1.1 - crowd * .3;
        c.r = rmin + (rmax - rmin) * Math.pow(rng(hash(c.key))(), 1 + crowd * 1.8);
        const s = svgEl('circle', { cx: c.star.x.toFixed(1), cy: c.star.y.toFixed(1), r: c.r.toFixed(2), class: `cand-star ${f.kind}` }); s.dataset.c = c.key;
        const tag = el('span', `cand ${f.kind}`, c.h); tag.dataset.c = c.key;
        c.el = s; c.tag = tag; P.pages[f.page].cand.append(s); f.tags.append(tag);
        if (animate) {
          tag.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: d, fill: 'backwards' });
          decode(tag, c.h, 360, d);
          if (f.page === 0) {
            s.animate([{ transform: `scale(${(c.star.r / c.r).toFixed(2)})`, opacity: .3 }, { transform: 'scale(2.4)', opacity: 1, offset: .5 }, { transform: 'scale(1)', opacity: 1 }], { duration: 600, delay: d, easing: 'ease-out', fill: 'backwards' });
            later(() => flash([nearest(f, c.star), c.star], 0), d);
          }
        }
        if (f.page === 0) end = Math.max(end, d + 600);
      });
    });
    return end;
  }
  const nearest = (f, p) => f.geo.pts.reduce((m, q) => dist(q, p) < dist(m, p) ? q : m);
  function flash(pts, stagger = 80) {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'ping-link' }); P.pings.append(line);
      line.animate([{ opacity: 0 }, { opacity: .6, offset: .25 }, { opacity: 0 }], { duration: 900, delay: (k - 1) * stagger, fill: 'backwards' }).onfinish = () => line.remove();
    }
  }

  /* ---------- stage 2: waiting — pulse, rewire, page ---------- */
  function startWaiting() {
    phase = 'waiting'; waitStart = performance.now();
    P.sky.classList.add('waiting');
    setClock(`Model is choosing representations · ${TOTAL} candidates across ${FEATURES.length} features`, true);
    armResolve(); cycle();
    if (reduced()) return;
    const tick = () => {
      const pool = FEATURES.filter(f => f.page === P.page && !f.decided).flatMap(f => f.cands);
      if (pool.length) {
        const c = pick(pool), f = c.f, from = pick(f.geo.pts), chain = [from, c.star];
        if (f.cands.length > 1 && Math.random() < .45) { let o; do o = pick(f.cands); while (o === c); chain.push(o.star); ping(o, 120); }
        from.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(2)', offset: .3 }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out', composite: 'add' });
        flash(chain); ping(c, 0);
      }
      later(tick, 90 + Math.random() * 200);
    };
    tick(); later(tick, 50);
  }
  function ping(c, delay) {
    c.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.8)', fill: '#ffe2c9', offset: .25 }, { transform: 'scale(1)' }], { duration: 650, delay, easing: 'ease-out' });
    later(() => { c.tag.classList.add('ping'); later(() => c.tag.classList.remove('ping'), 380); }, delay);
  }
  function armResolve() {
    $('resolve').disabled = false;
    if (wait !== 'hold') later(resolveNow, Number(wait) * 1000);
  }

  /* ---------- stage 3: replay the answer in the model's writing order ---------- */
  function resolveNow() {
    if (phase !== 'waiting') return;
    T.done = T.reps + (performance.now() - waitStart) / 1000;
    clearAll(); $('resolve').disabled = true;
    if (view === 'log') { phase = 'resolved'; renderLog(); later(() => { phase = 'plan'; renderLog(); }, reduced() ? 0 : 700); return; }
    if (reduced()) { phase = 'resolving'; finishAll(); return; }
    phase = 'resolving'; $('skip').hidden = false;
    let t = 0;
    for (let p = 0; p < PAGES; p++) {
      later(() => goPage(p), t); t += p ? 650 : 200;
      for (const f of FEATURES.filter(f => f.page === p)) { later(() => resolveFeature(f, true), t); t += 480; }
      t += 650;
    }
    later(() => finish(true), t);
  }
  function finishAll() {
    clearAll();
    for (const f of FEATURES) {
      if (!f.decided) resolveFeature(f, false);
      for (const c of f.cands) { // settle anything cut off mid-animation
        c.tag.textContent = c.h; c.tag.getAnimations().forEach(a => a.cancel());
        if (!c.keep) c.tag.classList.add('gone');
        if (c.label) c.label.textContent = c.h;
      }
    }
    finish(false);
  }
  function finish(animate) {
    phase = 'resolved'; $('skip').hidden = true; P.row?.classList.remove('deciding');
    FEATURES.forEach(f => f.row.classList.remove('deciding'));
    P.list.classList.remove('paged'); goPage(P.page);
    setClock(`Kept ${KEPT} of ${TOTAL} representations · dropped ${TOTAL - KEPT}`, false, true);
    later(() => { phase = 'plan'; showPlan(animate); }, animate ? 1000 : 0);
  }
  function placeLabel(f, c, pg) {
    const w = c.h.length * 5.8;
    let x = c.star.x > f.geo.ax ? c.star.x + 7 : c.star.x - 7 - w, y = c.star.y + 3;
    if (x < P.W * .06) x = c.star.x + 7; else if (x + w > P.W * .94) x = c.star.x - 7 - w;
    for (let k = 0; k < 6 && pg.labels.some(b => x < b.x + b.w + 4 && x + w + 4 > b.x && Math.abs(y - b.y) < 11); k++) y += (k % 2 ? -1 : 1) * 11 * (k + 1);
    pg.labels.push({ x, y, w });
    return { x, y };
  }
  function resolveFeature(f, animate) {
    const pg = P.pages[f.page]; let dropped = 0;
    f.decided = true; f.grp.classList.add('decided');
    FEATURES.forEach(o => o.row.classList.toggle('deciding', o === f && animate));
    if (animate) { setClock(`Model's choices · feature ${f.num} of ${FEATURES.length} · ${f.label}`, false); f.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    f.cands.forEach((c, i) => {
      if (c.keep) {
        const n = nearest(f, c.star);
        pg.keep.append(svgEl('line', { x1: n.x, y1: n.y, x2: c.star.x, y2: c.star.y, pathLength: 1, class: `keep-link ${f.kind}${animate ? '' : ' settled'}` }));
        c.el.classList.add('kept'); c.el.setAttribute('r', Math.max(c.r, 2).toFixed(2)); c.tag.classList.add('kept');
        const pos = placeLabel(f, c, pg), t = svgEl('text', { x: pos.x.toFixed(1), y: pos.y.toFixed(1), class: `cand-label ${f.kind}` }); t.dataset.c = c.key;
        pg.label.append(t); c.label = t;
        if (animate) { decode(t, c.h, 380, 200); decode(c.tag, c.h, 280, 0); } else t.textContent = c.h;
      } else {
        dropped++; c.el.classList.add('dropped');
        if (animate) dissolve(c.tag, c.h, () => c.tag.classList.add('gone'), i * 20); else c.tag.classList.add('gone');
      }
    });
    f.from.textContent = `${f.phrase ? `from “${f.phrase}” · ` : 'inferred · '}kept ${f.keep.length} of ${f.options.length}`;
    if (dropped) {
      const b = el('button', 'dropped-toggle', `${dropped} dropped`); b.type = 'button';
      b.onclick = () => { const on = f.row.classList.toggle('show-dropped'); b.textContent = on ? 'hide dropped' : `${dropped} dropped`; };
      f.tags.append(b);
      if (animate) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: 500, fill: 'backwards' });
    }
    goPage(P.page);
  }

  /* ---------- stage 4: handoff to the review plan ---------- */
  function showPlan(animate) {
    const plan = P.plan; plan.hidden = false; plan.replaceChildren();
    const h = el('div', 'plan-head');
    h.append(el('div', 'eyebrow', '03 / Plan'), el('span', '', `${keptComparisons.length} comparisons · ${KEPT - keptComparisons.length} suggested filters · even default weights`));
    const ol = el('ol'); plan.append(h, ol);
    setClock('Plan ready for review', false, true);
    let k = 0;
    for (const f of FEATURES) for (const c of f.cands.filter(c => c.keep)) {
      const li = el('li'), name = el('span', '', c.h); li.dataset.c = c.key;
      li.append(el('span', 'p-num', String(++k).padStart(2, '0')), name, el('span', 'p-from', `${f.label} · ${f.kind}`),
        f.kind === C ? el('span', 'p-w', WEIGHT[c.h] + '%') : el('span', 'p-w f', 'suggested'));
      ol.append(li);
      if (!animate) continue;
      const from = c.tag.getBoundingClientRect(), to = name.getBoundingClientRect(), pr = P.root.getBoundingClientRect();
      const ghost = el('span', `sv-ghost ${f.kind}`, c.h); ghost.style.font = '13px var(--mono)';
      Object.assign(ghost.style, { left: to.left - pr.left + 'px', top: to.top - pr.top + 'px' }); P.root.append(ghost);
      const delay = 60 + k * 60, dx = from.left - to.left, dy = from.top - to.top;
      name.style.opacity = 0; li.style.opacity = 0;
      li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay, fill: 'forwards' }).onfinish = () => { li.style.opacity = ''; };
      ghost.animate([{ transform: `translate(${dx}px,${dy}px)`, opacity: 1 }, { transform: 'translate(0,0)', opacity: 1, offset: .85 }, { transform: 'translate(0,0)', opacity: 0 }], { duration: 700, delay, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' }).onfinish = () => ghost.remove();
      name.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: delay + 600, fill: 'forwards' }).onfinish = () => { name.style.opacity = ''; };
    }
  }

  /* ---------- simple view ---------- */
  const seen = new Set();
  function renderLog() {
    panel.replaceChildren(); P = {};
    const root = el('div', 'sv sv-log-view'), log = el('ol', 'sv-log'); root.append(log); panel.append(head(), root);
    const row = (key, t, mark, parts, right = '', cls = '') => {
      const li = el('li', `c-row ${cls}${seen.has(key) || reduced() ? ' seen' : ''}`); seen.add(key);
      const msg = el('div', 'c-msg'); for (const [text, tag] of parts) msg.append(el(tag || 'span', '', text));
      const rr = el('span', 'c-right', right);
      if (cls.includes('live')) { const from = waitStart || performance.now(), up = () => { rr.textContent = fmt((performance.now() - from) / 1000) + 's'; }; up(); every(up, 100); }
      li.append(el('span', 'c-t', t === null ? '' : `T+${fmt(t)}`), el('span', 'c-mark', mark), msg, rr); log.append(li); return msg;
    };
    row('sel', T.selected, '✓', [[`${FEATURES.length} features selected`, 'b'], [` · ${NC} comparisons, ${FEATURES.length - NC} filters`]]);
    const resolved = phase === 'resolved' || phase === 'plan';
    if (phase === 'features') { row('reps-p', null, '·', [['choose representations', 'b']], '', 'pending'); return; }
    const msg = resolved
      ? row('reps-done', T.done, '✓', [['representations chosen', 'b'], [` · kept ${KEPT} of ${TOTAL}, dropped ${TOTAL - KEPT} · in the model's order`]], `${fmt(T.done - T.reps)}s`)
      : row('reps', T.reps, '■', [['model choosing representations', 'b'], [` · ${TOTAL} candidates across ${FEATURES.length} features`]], '', 'live');
    if (!resolved) msg.append(el('div', 'c-bar'));
    const kids = el('ul', 'c-children');
    for (const f of FEATURES) {
      const li = el('li', 'c-child'), line = el('div', 'c-cands');
      li.append(el('span', `tag ${f.kind}`, f.kind), ' ', el('b', '', f.label), el('span', 'c-right', resolved ? `  ${f.keep.length}/${f.options.length}` : `  ${f.options.length} option${f.options.length === 1 ? '' : 's'}`));
      f.options.forEach((h, i) => { if (i) line.append(' · '); line.append(el('span', resolved ? (f.keep.includes(h) ? `k ${f.kind}` : 'd') : '', h)); });
      li.append(line); kids.append(li);
    }
    msg.append(kids);
    if (phase === 'plan') row('plan', T.done, '✓', [['default weights', 'b'], [` · even split over ${keptComparisons.length} comparisons`]]);
    else row('plan-p', null, '·', [['review plan', 'b']], '', 'pending');
  }

  /* ---------- driving ---------- */
  function renderAt(ph) {
    clearAll(); $('resolve').disabled = true; $('skip').hidden = true;
    FEATURES.forEach(f => { f.decided = false; });
    if (view === 'log') { phase = ph; renderLog(); if (ph === 'waiting') armResolve(); return; }
    phase = 'features'; buildSky();
    setClock(`${FEATURES.length} features · press Play to choose representations`, false, true);
    if (ph === 'features') return;
    showCandidates(false);
    if (ph === 'waiting') { startWaiting(); return; }
    phase = 'resolving'; finishAll();
    if (ph === 'plan') { clearAll(); phase = 'plan'; showPlan(false); }
  }
  function play() {
    seen.clear(); renderAt('features');
    const anim = !reduced();
    if (view === 'log') { later(() => { phase = 'waiting'; waitStart = performance.now(); renderLog(); armResolve(); }, 500); return; }
    setClock('Loading candidates from the catalog', true);
    later(() => { const end = showCandidates(anim); later(startWaiting, anim ? end : 0); }, anim ? 400 : 0);
  }
  const current = () => phase === 'resolving' ? 'resolved' : phase;
  function seg(id, set) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      set(b.dataset.v);
    });
  }
  seg('waitSeg', v => { wait = v; if (phase === 'waiting') renderAt('waiting'); });
  seg('viewSeg', v => { view = v; renderAt(current()); });
  seg('motionSeg', v => { motion = v; renderAt(current()); });
  $('play').onclick = () => { $('play').textContent = '↻ Replay'; play(); };
  $('resolve').onclick = resolveNow;
  $('skip').onclick = () => { if (phase === 'resolving') finishAll(); };
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (view === 'sky' && P.sky && P.sky.clientWidth !== P.W) renderAt(current()); }, 200); });
  renderAt('features');
})();
