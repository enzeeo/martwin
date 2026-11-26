/* Mockup: option C, one continuous selection flow (sample data, no backend).
   No boxed stage card and no tabs. Four phases build on one star chart:
     read      the question lights up word by word
     features  each feature found forms a constellation; its phrase is underlined
     reps      the feature's catalog options are its stars; kept ones brighten
     review    the streaming log folds away and an ASCII ledger takes its place;
               kept stars grow with their weight
   The phase track replays any reached phase as a still. In review the ledger
   is the control: drag a bar or use the arrow keys (weights always sum to 100),
   ‹ › steps a representation through the feature's options, × removes it.
   Hovering a row lights its constellation and hovering a constellation lights its rows. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', CELLS = 24, SCALE = 50, EIGHTHS = ' ▏▎▍▌▋▊▉', MAX_STARS = 8;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const btn = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = n => String(n).padStart(2, '0');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mst(pts) {
    const inTree = [0], edges = [];
    while (inTree.length < pts.length) {
      let best = null;
      for (const u of inTree) pts.forEach((p, v) => { if (inTree.includes(v)) return; const d = dist(pts[u], p); if (!best || d < best[2]) best = [u, v, d]; });
      inTree.push(best[1]); edges.push([best[0], best[1]]);
    }
    return edges;
  }

  /* ---------- sample run (catalog headers as in mockups/review.js) ---------- */
  const Q = 'Find windy, gently sloping dune fields on Earth with little vegetation and sandy soil, bright rough ground and cold nights, like the plains west of Jezero.';
  const pre = (p, list, s = '') => list.map(x => p + x + s);
  const C = 'comparison', F = 'filter';
  const CATALOG = [
    { id: 'wind', kind: C, label: 'Wind', phrase: 'windy', options: pre('wind_', ['mean', 'max', 'min', 'diurnal', 'seasonal'], '_ms'), kept: ['wind_mean_ms', 'wind_max_ms'] },
    { id: 'slope_distribution', kind: C, label: 'Slope', phrase: 'gently sloping', options: pre('slope_', ['median', 'frac_gt_5', 'mean', 'std', 'p90', 'p99', 'frac_gt_2', 'frac_gt_10', 'frac_gt_20']), kept: ['slope_median', 'slope_frac_gt_5'] },
    { id: 'dunes', kind: C, label: 'Dunes', phrase: 'dune fields', options: ['dune_frac', 'dist_dune_km'], kept: ['dune_frac'] },
    { id: 'earth_land_cover', kind: F, label: 'Land cover', phrase: 'little vegetation', options: pre('', ['bare', 'shrub', 'tree', 'grass', 'crop', 'built', 'snow', 'water'], '_frac'), conds: [['bare_frac', '>', '40 %'], ['shrub_frac', '<', '30 %']] },
    { id: 'earth_soilgrids', kind: F, label: 'Soil', phrase: 'sandy soil', options: ['sand_pct', 'silt_pct', 'clay_pct', 'rock_frac_pct'], conds: [['sand_pct', '>', '60 %']] },
    { id: 'albedo', kind: C, label: 'Albedo', phrase: 'bright', options: ['albedo'], kept: ['albedo'] },
    { id: 'surface_roughness', kind: C, label: 'Roughness', phrase: 'rough ground', options: ['tri_p50', 'tri_p90', 'roughness_detrended_std'], kept: ['tri_p50'] },
    { id: 'surface_temperature', kind: C, label: 'Surface temp', phrase: 'cold nights', options: pre('tsurf_', ['min', 'diurnal', 'mean', 'max', 'seasonal'], '_K'), kept: ['tsurf_min_K', 'tsurf_diurnal_K'] },
    { id: 'landform_mixture', kind: C, label: 'Landforms', phrase: null, why: 'context: dune fields sit on flat plains', options: [...pre('geom_frac_', ['flat', 'slope', 'ridge', 'hollow', 'valley', 'peak', 'pit'])], kept: ['geom_frac_flat'] },
    { id: 'earth_modis_vegetation', kind: F, label: 'MODIS vegetation', phrase: null, why: 'context: confirms little vegetation', options: ['ndvi_mean', 'ndvi_max'], conds: [['ndvi_mean', '<', '0.2']] },
  ];
  // Catalog features the model did not pick; they show up under + add feature.
  const SPARE = [
    { id: 'thermal_inertia', kind: C, label: 'Thermal inertia', options: ['ti_pct'] },
    { id: 'elevation', kind: C, label: 'Elevation', options: ['elev_mean_m', 'elev_std_m', 'elev_range_m'] },
  ];
  const PHASES = [['read', 'read question'], ['features', 'features'], ['reps', 'representations'], ['review', 'review']];

  /* ---------- state ---------- */
  let S, timers = new Set(), t0 = 0, clockId = 0, figs = new Map();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  function stopTimers() { for (const id of timers) clearTimeout(id); timers.clear(); clearInterval(clockId); }

  function reset() {
    S = { phase: 'read', reached: 0, running: false, log: [], logOpen: false, top: 10, sep: 25, menuOpen: false,
      feats: CATALOG.map(f => ({ ...f, shown: false, decided: false, reps: f.kind === C ? f.kept.map(h => ({ h, w: 0 })) : [] })) };
    evenWeights();
  }
  const comps = () => S.feats.filter(f => f.kind === C && f.reps.length);
  const filters = () => S.feats.filter(f => f.kind === F);
  const allReps = () => comps().flatMap(f => f.reps);
  const numberOf = f => { const list = [...comps(), ...filters()]; return list.indexOf(f) + 1; };
  function evenWeights() { const reps = allReps(), n = reps.length; reps.forEach((r, i) => { r.w = Math.floor(100 / n) + (i < 100 % n); }); }
  // Same rule as selection.js balanceWeights: the edited weight is pinned and the rest scale to fill the remainder.
  function balance(edited, value) {
    const reps = allReps(); if (!reps.length) return;
    if (reps.length === 1) { reps[0].w = 100; return; }
    const fixed = clamp(Math.round(value), 1, 101 - reps.length), others = reps.filter(r => r !== edited), budget = 100 - fixed;
    const sum = others.reduce((s, r) => s + r.w, 0);
    const exact = others.map(r => sum > 0 ? r.w / sum * budget : budget / others.length);
    const cents = exact.map(x => Math.max(1, Math.floor(x)));
    let diff = budget - cents.reduce((s, x) => s + x, 0);
    const byFrac = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; diff > 0; k++, diff--) cents[byFrac[k % byFrac.length][1]]++;
    while (diff < 0) { const i = cents.indexOf(Math.max(...cents)); cents[i]--; diff++; }
    others.forEach((r, i) => { r.w = cents[i]; });
    edited.w = fixed;
  }
  function rebalanceAfterChange() { const reps = allReps(), sum = reps.reduce((s, r) => s + r.w, 0); if (!reps.length) return; if (sum !== 100) balance(reps[0], reps[0].w * 100 / Math.max(1, sum)); }

  /* ---------- background: ASCII star field, same glyphs as the cover ---------- */
  function startField() {
    const canvas = $('field'), ctx = canvas.getContext('2d');
    const r = rng(7), stars = Array.from({ length: 260 }, () => ({ x: r(), y: r(), g: r() < .2 ? (r() < .5 ? '+' : '*') : '.', s: 9 + r() * 5, b: .25 + r() * .45, p: r() * 6.28, v: .3 + r() * .8 }));
    let w = 0, h = 0, last = 0;
    const size = () => { const k = Math.min(devicePixelRatio || 1, 1.5); w = innerWidth; h = innerHeight; canvas.width = w * k; canvas.height = h * k; ctx.setTransform(k, 0, 0, k, 0, 0); };
    const draw = t => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = s.b * (reduced() ? 1 : .65 + .35 * Math.sin(s.p + t / 1000 * s.v));
        ctx.fillStyle = `rgba(215,221,182,${a.toFixed(3)})`; ctx.font = `${s.s}px 'Geist Mono',monospace`; ctx.fillText(s.g, s.x * w, s.y * h);
      }
    };
    const loop = t => { if (t - last > 70) { draw(t); last = t; } if (!reduced()) requestAnimationFrame(loop); };
    addEventListener('resize', () => { size(); draw(performance.now()); });
    size(); draw(0); requestAnimationFrame(loop);
  }

  /* ---------- phase track ---------- */
  function renderTrack() {
    const nav = $('track'); nav.replaceChildren();
    const at = PHASES.findIndex(([id]) => id === S.phase);
    PHASES.forEach(([id, name], i) => {
      if (i) nav.append(el('span', 'wire' + (i <= S.reached ? ' lit' : ''), '──────'));
      const mark = i < at || (i === at && !S.running) ? '■' : i === at ? '▣' : '□';
      const b = btn('', `${mark} ${pad(i + 1)} ${name}`);
      b.dataset.state = i === at ? 'now' : i <= S.reached ? 'done' : 'todo';
      b.disabled = i > S.reached; if (i === at) b.setAttribute('aria-current', 'step');
      b.onclick = () => jump(id);
      nav.append(b);
    });
    nav.append(el('span', 'spacer'));
    const clock = el('span', 'clock'); clock.id = 'clock'; clock.textContent = S.running ? fmtClock() : ''; nav.append(clock);
    if (S.phase !== 'review' || S.running) { const skip = btn('ctl', 'skip →', 'Skip to review'); skip.onclick = () => jump('review'); nav.append(skip); }
    const re = btn('ctl', '↺ replay', 'Replay the selection'); re.onclick = play; nav.append(re);
  }
  const fmtClock = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(4, '0') + 's';

  /* ---------- question ---------- */
  function renderQuestion() {
    const q = $('question'); q.replaceChildren();
    const hits = S.feats.filter(f => f.phrase).map(f => ({ f, at: Q.indexOf(f.phrase) })).sort((a, b) => a.at - b.at);
    let i = 0;
    const words = text => text.split(/(\s+)/).forEach(t => q.append(/\S/.test(t) ? el('span', 'w', t) : document.createTextNode(t)));
    for (const { f, at } of hits) {
      words(Q.slice(i, at));
      const span = el('span', 'w hit' + (f.kind === F ? ' filter' : ''), f.phrase); span.dataset.id = f.id; q.append(span);
      i = at + f.phrase.length;
    }
    words(Q.slice(i));
  }
  function syncQuestion() {
    for (const s of $('question').querySelectorAll('.hit')) { const f = S.feats.find(x => x.id === s.dataset.id); s.classList.toggle('on', !!f?.shown); }
  }

  /* ---------- star chart ---------- */
  // Constellations grow like real ones: each star branches off an earlier star at
  // a short hop, mostly continuing the chain, so figures read as dippers and
  // zigzags instead of spokes. Every vertex is a visible star and lines stop
  // just short of the stars they join, as on a printed star chart.
  function growFigure(r, cx, cy, n, R) {
    const pts = [{ x: cx + (r() - .5) * R * .6, y: cy + (r() - .5) * R * .4, from: -1, ang: r() * 6.283 }];
    for (let tries = 0; pts.length < n && tries < 400; tries++) {
      const from = r() < .7 ? pts.length - 1 : Math.floor(r() * pts.length), base = pts[from];
      const ang = base.ang + (r() - .5) * 2, hop = R * (.48 + r() * .36);
      const p = { x: base.x + Math.cos(ang) * hop, y: base.y + Math.sin(ang) * hop * .8, from, ang };
      if (((p.x - cx) / (R * 1.35)) ** 2 + ((p.y - cy) / (R * 1.05)) ** 2 > 1) continue;
      if (pts.some(q => dist(p, q) < R * .4)) continue;
      pts.push(p);
    }
    const edges = pts.slice(1).map((p, i) => [p.from, i + 1]);
    // Close one loop when a later star lands near an earlier one, like the bowl of a dipper.
    if (pts.length >= 4) {
      let best = null;
      for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
        if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        const d = dist(pts[i], pts[j]); if (d < R * .75 && (!best || d < best[2])) best = [i, j, d];
      }
      if (best) edges.push([best[0], best[1]]);
    }
    return { pts, edges };
  }
  function buildChart() {
    const svg = $('chart'), W = $('sky').clientWidth, H = $('sky').clientHeight, N = S.feats.length;
    // Left to right in ledger order (compare 01…, then where), so sky numbers read in sequence.
    const list = [...S.feats].sort((a, b) => (numberOf(a) || 99) - (numberOf(b) || 99));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.replaceChildren(); figs.clear();
    const defs = svgEl('defs');
    for (const [id, c] of [['glowC', '#eba078'], ['glowF', '#91bacb']]) {
      const gr = svgEl('radialGradient', { id });
      gr.append(svgEl('stop', { offset: '0', 'stop-color': '#fff4e0', 'stop-opacity': '.55' }), svgEl('stop', { offset: '.35', 'stop-color': c, 'stop-opacity': '.22' }), svgEl('stop', { offset: '1', 'stop-color': c, 'stop-opacity': '0' }));
      defs.append(gr);
    }
    svg.append(defs);
    // Faint background stars inside the chart: scans light the ones beneath the words they sweep.
    const fg = svgEl('g', { class: 'fstars' }), fr = rng(11); S.fstars = [];
    for (let k = 0, n = Math.round(W / 6); k < n; k++) {
      const x = fr() * W, y = 6 + fr() * (H - 12), mg = fr(), c = svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (.5 + mg * .9).toFixed(2) });
      fg.append(c); S.fstars.push({ x, y, m: mg, el: c });
    }
    svg.append(fg);
    const m = Math.max(40, W * .05), slot = (W - 2 * m) / N, R = clamp(slot * .62, 34, 70);
    list.forEach((f, i) => {
      const r = rng(hash(f.id)), cx = m + slot * (i + .5), cy = (i % 2 ? H * .64 : H * .3) + (r() - .5) * H * .06;
      const opts = [...f.options].slice(0, MAX_STARS);
      const { pts, edges } = growFigure(r, cx, cy, Math.max(3, opts.length), R);
      const g = svgEl('g', { class: 'fig hidden' + (f.kind === F ? ' filter' : ''), 'data-id': f.id });
      const lines = edges.map(([a, b]) => { const ln = svgEl('line', { class: 'edge' }); g.append(ln); return { a, b, ln }; });
      // Stars past the option count are scenery: they finish the shape but carry no representation.
      const stars = pts.map((p, k) => {
        const h = opts[k] ?? null, mag = .8 + r() * .6;
        const glow = svgEl('circle', { class: 'glow', cx: p.x, cy: p.y, r: 0, fill: `url(#${f.kind === F ? 'glowF' : 'glowC'})` });
        const c = svgEl('circle', { class: 'st ' + (h ? 'cand' : 'deco'), cx: p.x, cy: p.y, r: 1.6 * mag });
        if (h) { const t = svgEl('title'); t.textContent = h; c.append(t); }
        g.append(glow, c); return { h, p, c, glow, mag, rad: 1.6 * mag };
      });
      const low = Math.max(...pts.map(p => p.y));
      const name = svgEl('text', { class: 'name', x: cx, y: low + 24 }); g.append(name);
      g.addEventListener('pointerenter', () => light(f.id, true)); g.addEventListener('pointerleave', () => light(f.id, false));
      svg.append(g); figs.set(f.id, { g, stars, lines, name });
    });
    S.pings = svgEl('g', { class: 'pings' }); svg.append(S.pings);
  }
  function syncChart() {
    const review = S.phase === 'review';
    for (const f of S.feats) {
      const fig = figs.get(f.id); if (!fig) continue;
      const gone = f.kind === C && !f.reps.length && f.decided;
      fig.g.classList.toggle('hidden', !f.shown || gone);
      fig.g.classList.toggle('drawn', f.shown);
      const n = numberOf(f);
      fig.name.textContent = (review && n ? pad(n) + ' ' : '') + f.label.toLowerCase();
      const kept = f.kind === C ? f.reps.map(r => r.h) : f.conds.map(c => c[0]);
      for (const s of fig.stars) {
        const rep = s.h && f.reps.find(r => r.h === s.h), isKept = f.decided && s.h && kept.includes(s.h);
        s.c.setAttribute('class', 'st ' + (!s.h ? 'deco' : !f.decided ? 'cand' : isKept ? 'kept' : 'cut'));
        s.rad = isKept ? (review && rep ? 2.2 + Math.sqrt(rep.w) * .75 : 3) : (f.decided && s.h ? 1.3 : 1.6) * s.mag;
        s.c.setAttribute('r', s.rad.toFixed(2));
        s.glow.setAttribute('r', isKept ? (s.rad * 5).toFixed(2) : 0);
      }
      // Lines stop a small gap short of each star, so the stars read as the joints.
      for (const { a, b, ln } of fig.lines) {
        const A = fig.stars[a], B = fig.stars[b], d = dist(A.p, B.p), ux = (B.p.x - A.p.x) / d, uy = (B.p.y - A.p.y) / d;
        const ga = A.rad + 3.5, gb = B.rad + 3.5, len = Math.max(0, d - ga - gb);
        ln.setAttribute('x1', (A.p.x + ux * ga).toFixed(1)); ln.setAttribute('y1', (A.p.y + uy * ga).toFixed(1));
        ln.setAttribute('x2', (B.p.x - ux * gb).toFixed(1)); ln.setAttribute('y2', (B.p.y - uy * gb).toFixed(1));
        ln.style.setProperty('--len', Math.ceil(len));
      }
    }
  }
  function light(id, on) {
    figs.get(id)?.g.classList.toggle('on', on);
    for (const row of document.querySelectorAll(`.row[data-id="${id}"]`)) row.classList.toggle('on', on);
    for (const h of $('question').querySelectorAll(`.hit[data-id="${id}"]`)) h.classList.toggle('lit', on);
  }

  /* ---------- log ---------- */
  function say(html) { S.log.push(html); renderLog(); }
  function renderLog() {
    const log = $('log'), folded = S.phase === 'review' && !S.running;
    const lines = folded && S.logOpen ? S.log : S.log.slice(S.phase === 'reps' ? -3 : -9);
    $('repTable').hidden = S.phase !== 'reps';
    log.innerHTML = lines.join('\n') + (S.running ? '\n<span class="cursor"> </span>' : '');
    log.classList.toggle('folded', folded && !S.logOpen);
    log.style.maxHeight = folded && S.logOpen ? 'none' : '';
    const t = $('logToggle'); t.hidden = !folded;
    t.textContent = (S.logOpen ? '▾ hide' : '▸ show') + ` selection log · ${S.log.length} lines`;
    t.setAttribute('aria-expanded', String(S.logOpen));
  }
  const repLine = f => {
    const kept = f.kind === C ? f.reps.map(r => r.h) : f.conds.map(c => c[0]);
    const shown = f.options.slice(0, 4).map(h => kept.includes(h) ? `<span class="k">■ ${esc(h)}</span>` : `<span class="x">□ ${esc(h)}</span>`).join('  ');
    const more = f.options.length > 4 ? `  <span class="p">+${f.options.length - 4}</span>` : '';
    return `  ${esc(f.label.toLowerCase().padEnd(17))}${shown}${more}`;
  };
  const featLine = f => {
    const tag = f.kind === C ? `<span class="c">[+] ${esc(f.label.toUpperCase())}</span>  <span class="p">compare</span>` : `<span class="f">[+] ${esc(f.label.toUpperCase())}</span>  <span class="p">filter</span>`;
    return f.phrase ? `<span class="p">&gt;</span> "${esc(f.phrase)}" → ${tag}` : `<span class="p">&gt; ${esc(f.why)} →</span> ${tag}`;
  };

  /* ---------- ledger ---------- */
  function barText(w) {
    const filled = clamp(w, 0, SCALE) / SCALE * CELLS, full = Math.floor(filled), part = Math.round((filled - full) * 8);
    return ['█'.repeat(full) + (part ? EIGHTHS[part] : ''), '·'.repeat(Math.max(0, CELLS - full - (part ? 1 : 0)))];
  }
  function renderLedger() {
    const L = $('ledger'), show = S.phase === 'review';
    L.hidden = !show; if (!show) { L.classList.remove('in'); return; }
    requestAnimationFrame(() => L.classList.add('in'));
    $('sum').textContent = 'Σ ' + allReps().reduce((s, r) => s + r.w, 0);
    const host = $('comps'); host.replaceChildren();
    for (const f of comps()) f.reps.forEach((r, k) => host.append(compRow(f, r, k)));
    const fh = $('filters'); fh.replaceChildren();
    for (const f of filters()) f.conds.forEach((c, k) => fh.append(filterRow(f, c, k)));
    renderMenu(); renderRecap();
  }
  function rowShell(f, k) {
    const row = el('div', 'row' + (f.kind === F ? ' filter' : '') + (k ? ' cont' : '')); row.dataset.id = f.id;
    row.append(el('span', 'n', pad(numberOf(f))), el('span', 'g', f.kind === C ? '✦' : '◇'), el('span', 'fn', f.label));
    row.onpointerenter = () => light(f.id, true); row.onpointerleave = () => light(f.id, false);
    return row;
  }
  function compRow(f, r, k) {
    const row = rowShell(f, k), opts = f.options.slice(0, MAX_STARS);
    const rep = el('span', 'rep');
    const step = d => () => {
      const used = new Set(f.reps.map(x => x.h)); let i = opts.indexOf(r.h);
      for (let n = 0; n < opts.length; n++) { i = (i + d + opts.length) % opts.length; if (!used.has(opts[i])) { r.h = opts[i]; break; } }
      update(); focusLater(`.row[data-id="${f.id}"] .rep button[data-d="${d}"]`, k);
    };
    const prev = btn('', '‹', `Previous ${f.label} representation`), next = btn('', '›', `Next ${f.label} representation`);
    prev.dataset.d = -1; next.dataset.d = 1; prev.onclick = step(-1); next.onclick = step(1);
    rep.append(prev, el('span', 'h', r.h), next);
    const [fill, rest] = barText(r.w), bar = el('span', 'bar');
    bar.append(document.createTextNode(fill), el('span', 'rest', rest));
    bar.setAttribute('role', 'slider'); bar.tabIndex = 0; bar.setAttribute('aria-label', `${f.label} · ${r.h} weight`);
    bar.setAttribute('aria-valuemin', 1); bar.setAttribute('aria-valuemax', 101 - allReps().length); bar.setAttribute('aria-valuenow', r.w);
    const setFrom = e => { const b = bar.getBoundingClientRect(); balance(r, clamp((e.clientX - b.left) / b.width, 0, 1) * SCALE); update(); focusLater('.bar', allReps().indexOf(r)); };
    bar.onpointerdown = e => { bar.setPointerCapture(e.pointerId); setFrom(e); bar.onpointermove = setFrom; };
    bar.onpointerup = bar.onpointercancel = () => { bar.onpointermove = null; };
    bar.onkeydown = e => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (d) { e.preventDefault(); balance(r, r.w + d * (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); balance(r, e.key === 'Home' ? 1 : 100); }
      else return;
      update(); focusLater('.bar', allReps().indexOf(r));
    };
    const rm = btn('rm', '×', `Remove ${r.h}`);
    rm.onclick = () => { f.reps = f.reps.filter(x => x !== r); rebalanceAfterChange(); update(); };
    row.append(rep, bar, el('span', 'w', String(r.w)), rm);
    return row;
  }
  function filterRow(f, c, k) {
    const row = rowShell(f, k), cond = el('span', 'cond');
    cond.innerHTML = `${esc(c[0])} <b>${esc(c[1])}</b> ${esc(c[2])}`;
    const rm = btn('rm', '×', `Remove ${c[0]} condition`);
    rm.onclick = () => { f.conds = f.conds.filter(x => x !== c); if (!f.conds.length) S.feats = S.feats.filter(x => x !== f); rebuild(); };
    cond.style.gridColumn = '4 / 7';
    row.append(cond, rm);
    return row;
  }
  function renderMenu() {
    const menu = $('compMenu'), add = $('addComp');
    const spare = [...S.feats.filter(f => f.kind === C && !f.reps.length), ...SPARE.filter(s => !S.feats.some(f => f.id === s.id))];
    add.hidden = !spare.length; add.setAttribute('aria-expanded', String(S.menuOpen));
    add.onclick = () => { S.menuOpen = !S.menuOpen; renderMenu(); };
    menu.hidden = !S.menuOpen || !spare.length; menu.replaceChildren();
    for (const s of spare) {
      const b = btn('', '✦ ' + s.label.toLowerCase());
      b.onclick = () => {
        let f = S.feats.find(x => x.id === s.id);
        if (!f) { f = { ...s, phrase: null, why: 'added by you', shown: true, decided: true, reps: [] }; S.feats.push(f); }
        f.reps = [{ h: f.options[0], w: 1 }]; balance(f.reps[0], 100 / allReps().length);
        S.menuOpen = false; rebuild(f.id);
      };
      menu.append(b);
    }
  }
  function renderRecap() {
    const p = $('recap'), nc = comps().length, nr = allReps().length, nf = filters().reduce((s, f) => s + f.conds.length, 0);
    p.innerHTML = `Rank Earth cells by <span class="tok">${nr} representations</span> across <span class="tok">${nc} features</span>, keep cells matching <span class="tok">${nf} condition${nf === 1 ? '' : 's'}</span>, on <span class="tok">all continents</span> → top <input id="top" type="number" min="1" max="100" aria-label="Number of results">, at least <input id="sep" type="number" min="0" aria-label="Minimum separation in km"> km apart.`;
    $('top').value = S.top; $('sep').value = S.sep;
    $('top').oninput = e => { S.top = e.target.value; }; $('sep').oninput = e => { S.sep = e.target.value; };
  }
  function focusLater(sel, i) { requestAnimationFrame(() => { const list = document.querySelectorAll(sel); (list[i] || list[0])?.focus(); }); }

  /* ---------- scanning while features are chosen (as in stage-view.js) ---------- */
  // Scans start at random moments and overlap. Each sweeps a random run of words
  // and, from the faint stars beneath them, forms a nameless constellation that
  // holds for a moment and fades. They stand for the model thinking, not for
  // features: when the features arrive these clear and the named figures form.
  const linesCross = (a, b, c, d) => { const x = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x); return x(a, b, c) * x(a, b, d) < 0 && x(c, d, a) * x(c, d, b) < 0; };
  function startScan() {
    const q = $('question'), words = [...q.querySelectorAll('.w')], lit = new Map();
    S.scanning = true; S.ghosts = new Set(); q.classList.add('scanning');
    const on = w => { lit.set(w, (lit.get(w) || 0) + 1); w.classList.add('lit'); };
    const off = w => { const n = (lit.get(w) || 1) - 1; if (n) lit.set(w, n); else { lit.delete(w); w.classList.remove('lit'); } };
    const scan = () => {
      if (S.ghosts.size >= 4) return; // a calm sky: a few figures at a time
      const len = Math.min(words.length, 3 + Math.floor(Math.random() * 6)), start = Math.floor(Math.random() * (words.length - len + 1));
      const fig = { stars: [], edges: [], lines: [] }; S.ghosts.add(fig);
      const run = words.slice(start, start + len);
      run.forEach((w, k) => {
        later(() => { if (!S.scanning) return; on(w); const st = pickUnder(w, fig); if (st) growGhost(fig, st); }, k * 90);
        later(() => off(w), k * 90 + 300);
      });
      later(() => fadeGhost(fig, 700), run.length * 90 + 1400 + Math.random() * 600);
    };
    const next = () => { if (!S.scanning) return; scan(); later(next, 380 + Math.random() * 520); };
    next(); later(scan, 220);
  }
  // The first star sits beneath the word; each later one is a short hop from an
  // earlier star, so the figure grows as a compact cluster while its scan sweeps.
  function pickUnder(word, fig) {
    if (!S.fstars) return null;
    const last = fig.stars[fig.stars.length - 1];
    let pool;
    if (!last) {
      const left = $('sky').getBoundingClientRect().left, r = word.getBoundingClientRect();
      pool = S.fstars.filter(st => st.x >= r.left - left - 10 && st.x <= r.right - left + 10 && !st.busy);
    } else {
      // Mostly hop on from the newest star, sometimes branch from an older one; stay near the centre.
      const from = Math.random() < .6 ? last : fig.stars[Math.floor(Math.random() * fig.stars.length)];
      const c = { x: fig.stars.reduce((n, o) => n + o.x, 0) / fig.stars.length, y: fig.stars.reduce((n, o) => n + o.y, 0) / fig.stars.length };
      pool = S.fstars.filter(st => !st.busy && !fig.stars.includes(st) && dist(st, from) > 28 && dist(st, from) < 75
        && dist(st, c) < 95 && fig.stars.every(o => dist(o, st) > 24));
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }
  function growGhost(fig, st) {
    if (fig.stars.length >= 6 || fig.dead) return;
    st.busy = true; fig.stars.push(st); st.el.classList.add('glit'); pulse(st.el, 2.2, 700);
    if (fig.stars.length === 1) return;
    // Join the nearest earlier star whose new line crosses nothing already drawn.
    const from = fig.stars.slice(0, -1).sort((a, b) => dist(a, st) - dist(b, st))
      .find(c => !fig.edges.some(([a, b]) => a !== c && b !== c && linesCross(c, st, a, b)));
    if (!from) return;
    fig.edges.push([from, st]);
    const d = dist(from, st), ux = (st.x - from.x) / d, uy = (st.y - from.y) / d, g = 4;
    const ln = svgEl('line', { class: 'ghost', x1: from.x + ux * g, y1: from.y + uy * g, x2: st.x - ux * g, y2: st.y - uy * g });
    ln.style.setProperty('--len', Math.ceil(d - 2 * g)); S.pings.append(ln); fig.lines.push(ln);
  }
  function fadeGhost(fig, ms) {
    if (fig.dead) return; fig.dead = true; S.ghosts?.delete(fig);
    for (const ln of fig.lines) { ln.classList.add('out'); ln.style.transitionDuration = ms + 'ms'; setTimeout(() => ln.remove(), ms + 40); }
    for (const st of fig.stars) { st.el.classList.remove('glit'); st.busy = false; }
  }
  function stopScan() {
    if (S) { S.scanning = false; for (const fig of [...(S.ghosts || [])]) fadeGhost(fig, 500); }
    const q = $('question'); q.classList.remove('scanning'); q.querySelectorAll('.lit').forEach(w => w.classList.remove('lit'));
  }
  const pulse = (node, k, ms) => { if (!reduced()) node.animate([{ transform: 'scale(1)' }, { transform: `scale(${k})`, opacity: 1, fill: '#ffe2c9', offset: .2 }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' }); };
  function flashLine(a, b, ms, peak, cls) {
    if (!S.pings || S.pings.childElementCount >= 40) return; // cap lines on screen
    const ln = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }); S.pings.append(ln);
    ln.animate([{ opacity: 0 }, { opacity: peak, offset: .25 }, { opacity: 0 }], { duration: ms });
    setTimeout(() => ln.remove(), ms + 30); // timer, not the animation clock, so lines never pile up
  }

  /* ---------- choosing representations: a live table under the sky ---------- */
  // One row per feature, one tag per candidate (the same options its stars stand for).
  const repOpts = f => f.options.slice(0, MAX_STARS);
  const keptOf = f => f.kind === C ? f.reps.map(r => r.h) : f.conds.map(c => c[0]);
  function buildRepTable() {
    const pre = $('repTable'); pre.replaceChildren(); S.rt = new Map();
    for (const f of S.feats) {
      const row = el('div', 'rrow'), box = el('div', 'rtags'), kind = f.kind === C ? 'c' : 'f';
      row.append(el('span', 'lab', f.label.toLowerCase()), box);
      const tags = repOpts(f).map(h => { const t = el('span', 'tag ' + kind, '□ ' + h); box.append(t); return t; });
      pre.append(row); S.rt.set(f.id, tags);
      if (f.decided) settleRow(f, false);
    }
  }
  // Waiting: every row steps through its own candidates at the same time.
  // It is decoration only; the order is fixed, so it hints at nothing.
  function repWaiting() {
    const longest = Math.max(...S.feats.map(f => repOpts(f).length)); let idx = 0;
    const tick = () => {
      if (S.phase !== 'reps' || !S.repsWaiting) return;
      const k = idx % longest;
      for (const f of S.feats) {
        if (k >= repOpts(f).length) continue;
        const t = S.rt.get(f.id)[k], fig = figs.get(f.id);
        t.classList.add('ping'); later(() => t.classList.remove('ping'), 230);
        if (fig) { pulse(fig.stars[k].c, 1.9, 600); if (k) flashLine(fig.stars[k - 1].p, fig.stars[k].p, 700, .85, 'ping ' + (f.kind === C ? 'c' : 'f')); }
      }
      idx++; later(tick, 260);
    };
    tick();
  }
  // The answer replays one feature at a time: kept tags decode in, the rest strike out.
  function settleRow(f, animate) {
    const kept = keptOf(f), fig = figs.get(f.id);
    repOpts(f).forEach((h, k) => {
      const t = S.rt?.get(f.id)?.[k]; if (!t) return;
      const keep = kept.includes(h); t.classList.remove('ping'); t.classList.add(keep ? 'kept' : 'cut');
      if (keep && animate) decode(t, '■ ' + h); else t.textContent = (keep ? '■ ' : '□ ') + h;
      if (keep && animate && fig) pulse(fig.stars[k].c, 2.4, 700);
    });
  }
  const GLYPHS = '.:+*=#%@01<>/';
  function decode(node, text) {
    const steps = 9;
    for (let i = 0; i <= steps; i++) later(() => { const n = Math.round(text.length * i / steps); node.textContent = text.slice(0, n) + text.slice(n).replace(/./g, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]); }, i * 36);
  }

  /* ---------- render + phases ---------- */
  function update() { renderTrack(); syncQuestion(); syncChart(); renderLog(); renderLedger(); }
  function rebuild(animateId) {
    buildChart(); syncChart();
    if (animateId) { const g = figs.get(animateId).g; g.classList.remove('drawn'); requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('drawn'))); }
    update();
  }

  // Every phase has a still end state, so the track can revisit it instantly.
  function stillAt(phase) {
    const i = PHASES.findIndex(([id]) => id === phase);
    S.phase = phase; S.running = false; S.repsWaiting = false; stopScan();
    for (const f of S.feats) { f.shown = i >= 1; f.decided = i >= 2; }
    S.log = [];
    for (const w of [readLines(), ...(i >= 1 ? [S.feats.map(featLine)] : []), ...(i >= 2 ? [['<span class="p">&gt; choosing representations</span>', ...S.feats.map(repLine)]] : [])]) S.log.push(...w);
    if (i >= 3) S.log.push(doneLine());
    for (const w of $('question').querySelectorAll('.w')) w.classList.add('read');
    if (i === 2) buildRepTable();
  }
  const readLines = () => ['<span class="p">&gt; reading question</span> · ' + Q.split(/\s+/).length + ' words', '<span class="p">&gt; target</span> 18.44° N 77.45° E · jezero western plains'];
  const doneLine = () => `<span class="p">&gt; plan ready</span> · kept <span class="k">${allReps().length + filters().reduce((s, f) => s + f.conds.length, 0)}</span> of ${S.feats.reduce((s, f) => s + f.options.length, 0)} options`;

  function jump(phase) {
    stopTimers();
    if (PHASES.findIndex(([id]) => id === phase) > S.reached) S.reached = PHASES.findIndex(([id]) => id === phase);
    stillAt(phase); update();
  }
  function play() {
    stopTimers(); reset(); renderQuestion(); buildChart();
    if (reduced()) { S.reached = 3; stillAt('review'); update(); return; }
    S.running = true; t0 = performance.now(); clockId = setInterval(() => { const c = $('clock'); if (c) c.textContent = fmtClock(); }, 100);
    update();
    // read
    const words = [...$('question').querySelectorAll('.w')];
    words.forEach((w, i) => later(() => w.classList.add('read'), 200 + i * 55));
    later(() => say(readLines()[0]), 250); later(() => say(readLines()[1]), 900);
    let t = 300 + words.length * 55;
    // features, in the order the model names them
    // features: the question is scanned while the model thinks, then features land one by one
    later(() => { S.phase = 'features'; S.reached = 1; say('<span class="p">&gt; choosing features</span>'); update(); startScan(); }, t);
    t += 5200;
    later(() => { stopScan(); say('<span class="p">&gt; features chosen</span> · ' + S.feats.length); }, t); t += 700;
    S.feats.forEach((f, i) => later(() => { f.shown = true; say(featLine(f)); syncQuestion(); syncChart(); }, t + i * 420));
    t += S.feats.length * 420 + 600;
    // representations: every row steps through its candidates, then the answer replays feature by feature
    const cands = S.feats.reduce((n, f) => n + repOpts(f).length, 0);
    later(() => { S.phase = 'reps'; S.reached = 2; say(`<span class="p">&gt; choosing representations</span> · ${cands} candidates`); buildRepTable(); update(); S.repsWaiting = true; repWaiting(); }, t);
    t += 4200;
    later(() => { S.repsWaiting = false; say('<span class="p">&gt; answer received</span> · replaying feature by feature'); }, t);
    S.feats.forEach((f, i) => later(() => { f.decided = true; settleRow(f, true); syncChart(); S.log.push(repLine(f)); }, t + 400 + i * 560));
    t += 400 + S.feats.length * 560 + 900;
    // review
    later(() => { say(doneLine()); }, t);
    later(() => { stopTimers(); S.phase = 'review'; S.reached = 3; S.running = false; update(); }, t + 900);
  }

  $('logToggle').onclick = () => { S.logOpen = !S.logOpen; renderLog(); };
  $('go').onclick = () => { $('status').textContent = 'Preview only · scoring is disabled in this mockup.'; };
  let rz = 0; new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (S) { buildChart(); syncChart(); } }); }).observe($('sky'));

  startField(); play();
})();
