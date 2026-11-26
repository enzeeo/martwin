/* Feature selection flow (styles: stage-view.css).
   One unboxed view that every stage adds to, instead of a framed card per stage:
     connecting  the question waits behind a caret
     features    scans sweep the question while the model thinks; each scan
                 forms a nameless constellation from the faint stars under
                 its words, which holds for a moment and fades
     selected    the scans clear and each chosen feature forms its own named
                 constellation; its phrase in the question is underlined
     reps        a feature's catalog options are its stars and its row of
                 tags; every row steps through its candidates while the
                 model chooses, then the answer replays feature by feature
     review      the log folds away and the ledger (selection.js) sits under
                 the same sky; kept stars grow with their weight
   A streaming ASCII log runs under the sky. The heading is one ASCII track
   (01 read question ─ 02 features ─ 03 representations ─ 04 review) that
   revisits any reached stage as a still.
   selection.js drives it: begin() per run, show() per stream stage,
   setCatalog() when the catalog loads, resolve() to replay the answer,
   settle() to show one decided (stage viewer), enterReview()/redraw() to
   move between review and the stills, review() for the plan's groups and
   weights, link() for hover between the ledger and the sky, stop() on cancel. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', MAX_STARS = 10;
  const C = 'comparison', F = 'filter';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const btn = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = n => String(n).padStart(2, '0');
  const humanize = id => { const t = String(id).replaceAll('_', ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  const repLabel = o => o.label || String(o.header).replaceAll('_', ' ');
  const linesCross = (a, b, c, d) => { const x = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x); return x(a, b, c) * x(a, b, d) < 0 && x(c, d, a) * x(c, d, b) < 0; };

  let S = null, toReview = null, timers = new Set(), observer = null;
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  function stopMotion() { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); if (S) { S.scanning = false; S.repsWaiting = false; } }

  /* ---------- state ---------- */
  function begin({ question, lat, lon, sample = false }) {
    stopMotion(); S?.finish?.();
    toReview = null;
    S = { question: String(question || ''), lat, lon, sample, phase: 'connecting', reached: 0, features: [], hits: [], menu: null,
      log: [], logOpen: false, repsPending: false, repsEntered: false, answered: false, replaying: false, groups: null, order: '', t0: performance.now() };
    mount();
    say(`<span class="p">&gt; connecting</span> · ${esc(coords())}`);
    setClock('Connecting', true);
  }
  const coords = () => {
    const lat = Number(S.lat), lon = Number(S.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'} / ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}` : 'target not set';
  };
  function setFeatures(families) {
    const lower = S.question.toLowerCase(), list = [];
    for (const [key, kind] of [['comparisons', C], ['filters', F]]) for (const f of (families && families[key]) || []) {
      const phrase = f.phrase && lower.includes(String(f.phrase).toLowerCase()) ? String(f.phrase) : null;
      list.push(feature(kind, f.feature_id, { phrase, label: f.label, desc: f.description }));
    }
    S.features = list;
    // One underline per spot in the question; features sharing words share it.
    const hits = [];
    for (const { f, at } of list.filter(f => f.phrase).map(f => ({ f, at: lower.indexOf(f.phrase.toLowerCase()) })).sort((a, b) => a.at - b.at)) {
      const end = at + f.phrase.length, last = hits[hits.length - 1];
      if (last && at < last.end) { last.ids.push(f.id); last.end = Math.max(last.end, end); }
      else hits.push({ start: at, end, ids: [f.id], kind: f.kind });
    }
    S.hits = hits;
    refreshOptions();
  }
  function feature(kind, fid, { phrase = null, label, desc } = {}) {
    return { id: `${kind}:${fid}`, fid, kind, phrase, label: label || humanize(fid), desc: desc || '',
      options: [], keep: null, plan: null, reason: '', shown: false, decided: false, weights: null, num: 0, removed: false, slots: null };
  }
  // A feature's options come from the catalog; headers the answer or the plan
  // use that the catalog lacks are appended, so every kept choice has a tag.
  function catalogOptions(f) {
    const m = S.menu; if (!m) return [];
    if (f.fid === 'dataset_field') return m.dataset_fields || [];
    return (m[f.kind === C ? 'comparisons' : 'filters'] || []).find(x => x.feature_id === f.fid)?.options || [];
  }
  function refreshOptions() {
    for (const f of S.features) {
      const opts = catalogOptions(f).map(o => ({ header: o.header, label: repLabel(o) }));
      for (const o of f.options) if (!opts.some(x => x.header === o.header)) opts.push(o);
      f.options = opts;
    }
  }
  function addOption(f, header, label) { if (!f.options.some(o => o.header === header)) f.options.push({ header, label: label || String(header).replaceAll('_', ' ') }); }
  // Which option each star stands for. Kept options always get a star: one past
  // the figure's size takes the place of a star whose option was not kept.
  function assignSlots(f, n) {
    if (!f.slots || f.slots.length !== n) f.slots = Array.from({ length: n }, (_, i) => f.options[i]?.header ?? null);
    const want = new Set([...(f.plan || []), ...(f.keep || [])]);
    for (const h of want) {
      if (f.slots.includes(h)) continue;
      let i = f.slots.findIndex(s => s === null);
      if (i < 0) i = f.slots.findIndex(s => !want.has(s));
      if (i >= 0) f.slots[i] = h;
    }
  }
  const starCount = f => clamp(f.options.length || 5, 3, MAX_STARS);

  /* ---------- the view ---------- */
  // The stage: the sky fills it and a fixed-size box sits in the middle. The box
  // holds the status line, the log, the representation table and, in review,
  // the ledger (#liveSelection is moved in). While the selection streams it keeps
  // its size and scrolls; in review it grows to fit the ledger and the sky grows with it.
  // Constellations stand in a ring around the box. Narrow screens stack the sky
  // above the box instead.
  function mount() {
    const host = $('liveStages'), ledger = $('liveSelection');
    if (ledger && host.contains(ledger)) $('stageDeck')?.append(ledger); // keep the ledger when the view is rebuilt
    host.className = 'stage-view fv'; host.replaceChildren();
    const q = el('p', 'fv-question dim'), target = el('p', 'fv-target', coords() + (S.sample ? ' · sample run, nothing is sent' : ''));
    const stage = el('div', 'fv-stage'), sky = el('div', 'fv-sky'), svg = svgEl('svg'), names = el('div', 'fv-names'), box = el('div', 'fv-box'), pop = el('div', 'fv-pop');
    const log = el('pre', 'fv-log'), reps = el('div', 'fv-reps'), toggle = btn('fv-logtoggle', ''), clock = el('p', 'fv-clock');
    sky.setAttribute('aria-hidden', 'true'); sky.append(svg);
    pop.hidden = true; pop.setAttribute('role', 'dialog'); reps.hidden = true; toggle.hidden = true;
    log.setAttribute('aria-label', 'Selection log'); reps.setAttribute('aria-label', 'Representation candidates by feature');
    toggle.onclick = () => { S.logOpen = !S.logOpen; renderLog(); };
    box.append(clock, log, reps, toggle);
    stage.append(sky, names, box);
    host.append(q, target, stage, pop);
    S.p = { host, q, stage, sky, svg, names, box, pop, log, reps, toggle, clock, figs: new Map(), fstars: [], pings: null };
    fillWords(true); renderTrack();
    observer?.disconnect();
    let w = sky.clientWidth, h = sky.clientHeight, timer; observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (S?.p?.sky === sky && sky.clientWidth && (Math.abs(sky.clientWidth - w) > 4 || Math.abs(sky.clientHeight - h) > 4)) { w = sky.clientWidth; h = sky.clientHeight; buildChart(); syncChart(); } }, 120); });
    observer.observe(sky);
    buildChart();
  }

  /* ---------- ASCII track: the heading ---------- */
  const STEPS = [['read', 'read question'], ['features', 'features'], ['reps', 'representations'], ['review', 'review']];
  const stepOf = phase => ({ connecting: 0, features: 1, selected: 1, reps: 2, review: 3 })[phase] ?? 0;
  function renderTrack() {
    const title = $('liveProgressTitle'); if (!title || !S) return;
    S.p?.stage.classList.toggle('fit', S.phase !== 'reps'); // the log box grows with its lines; only the representations table scrolls inside the box
    const nav = el('span', 'fv-track'), at = stepOf(S.phase), busy = S.phase !== 'review' && (S.scanning || S.repsWaiting || S.replaying || S.phase === 'connecting' || (S.phase === 'features'));
    STEPS.forEach(([id, name], i) => {
      if (i) nav.append(el('span', 'fv-wire' + (i <= S.reached ? ' lit' : ''), '──────'));
      const mark = i < at || (i === at && !busy) ? '■' : i === at ? '▣' : '□', text = `${mark} ${pad(i + 1)} ${name}`;
      if (!i) { nav.append(el('span', 'fv-step' + (at === 0 ? ' now' : ' done'), text)); return; }
      const b = btn('fv-step sv-plane-tab', text); b.dataset.plane = id;
      const open = id === 'review' ? !!toReview : id === 'reps' ? S.repsEntered && !S.replaying : S.features.length > 0 && S.reached >= 1 && !S.revealing && !S.replaying;
      b.disabled = !open || i === at; b.setAttribute('aria-pressed', String(i === at));
      b.classList.add(i === at ? 'now' : i <= S.reached ? 'done' : 'todo');
      b.onclick = () => { if (id === 'review') toReview?.(); else goStill(id); };
      nav.append(b);
    });
    if (S.replaying) { const skip = btn('fv-ctl', 'skip →', 'Skip the replay'); skip.onclick = skipReplay; nav.append(skip); }
    title.replaceChildren(nav);
  }

  /* ---------- question ---------- */
  function fillWords(caret) {
    const q = S.p.q; q.replaceChildren(); q.className = 'fv-question' + (caret ? ' dim' : '');
    S.question.split(/(\s+)/).forEach(part => q.append(/\S/.test(part) ? el('span', 'w', part) : part));
    if (caret) q.append(el('span', 'fv-caret'));
  }
  function fillHits() {
    const q = S.p.q; q.replaceChildren(); q.className = 'fv-question';
    let pos = 0;
    const words = text => text.split(/(\s+)/).forEach(part => q.append(/\S/.test(part) ? el('span', 'w', part) : part));
    for (const h of S.hits) {
      words(S.question.slice(pos, h.start));
      const span = el('span', `fv-hit ${h.kind}`, S.question.slice(h.start, h.end)); span.dataset.f = h.ids.join(' ');
      q.append(span); pos = h.end;
    }
    words(S.question.slice(pos));
  }
  function syncHits() {
    for (const s of S.p.q.querySelectorAll('.fv-hit')) s.classList.toggle('on', s.dataset.f.split(' ').some(id => S.features.find(f => f.id === id)?.shown));
  }

  /* ---------- star chart ---------- */
  // Constellations grow like real ones: each star branches off an earlier star at
  // a short hop, mostly continuing the chain, so figures read as dippers and
  // zigzags instead of spokes. Every vertex is a visible star and lines stop
  // just short of the stars they join, as on a printed star chart.
  function growFigure(r, cx, cy, n, R) {
    const pts = [{ x: cx + (r() - .5) * R * .6, y: cy + (r() - .5) * R * .4, from: -1, ang: r() * 6.283 }];
    for (let tries = 0; pts.length < n && tries < 500; tries++) {
      const from = r() < .7 ? pts.length - 1 : Math.floor(r() * pts.length), base = pts[from];
      const ang = base.ang + (r() - .5) * 2, hop = R * (.48 + r() * .36);
      const p = { x: base.x + Math.cos(ang) * hop, y: base.y + Math.sin(ang) * hop * .8, from, ang };
      if (((p.x - cx) / (R * 1.35)) ** 2 + ((p.y - cy) / (R * 1.05)) ** 2 > 1) continue;
      if (pts.some(q => dist(p, q) < R * .36)) continue;
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
      if (best && !edges.some(([a, b]) => a !== best[0] && a !== best[1] && b !== best[0] && b !== best[1] && linesCross(pts[best[0]], pts[best[1]], pts[a], pts[b]))) edges.push([best[0], best[1]]);
    }
    return { pts, edges };
  }
  // Figures left to right in ledger order once there is a plan, so sky numbers read in sequence.
  const ordered = () => {
    const list = S.features.filter(f => !f.removed);
    return S.groups ? list.sort((a, b) => (a.num || 99) - (b.num || 99)) : list;
  };
  function buildChart() {
    const { stage, sky, svg, names, box } = S.p;
    stage.classList.toggle('stack', stage.clientWidth < 760);
    const W = sky.clientWidth, H = sky.clientHeight;
    svg.replaceChildren(); names.replaceChildren(); S.p.figs.clear(); closeCard();
    if (!W || !H) return;
    // The box in sky coordinates (none when stacked); stars keep clear of it.
    const sr = sky.getBoundingClientRect(), br = box.getBoundingClientRect();
    const hole = stage.classList.contains('stack') ? null : { x0: br.left - sr.left, y0: br.top - sr.top, x1: br.right - sr.left, y1: br.bottom - sr.top };
    S.p.hole = hole;
    const inHole = (x, y, pad = 18) => hole && x > hole.x0 - pad && x < hole.x1 + pad && y > hole.y0 - pad && y < hole.y1 + pad;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = svgEl('defs');
    for (const [id, c] of [['fvGlowC', '#eba078'], ['fvGlowF', '#91bacb']]) {
      const gr = svgEl('radialGradient', { id });
      gr.append(svgEl('stop', { offset: '0', 'stop-color': '#fff4e0', 'stop-opacity': '.55' }), svgEl('stop', { offset: '.35', 'stop-color': c, 'stop-opacity': '.22' }), svgEl('stop', { offset: '1', 'stop-color': c, 'stop-opacity': '0' }));
      defs.append(gr);
    }
    svg.append(defs);
    // Faint background stars inside the chart: scans light the ones beneath the words they sweep.
    const fg = svgEl('g', { class: 'fv-fstars' }), fr = rng(hash(S.question) ^ 11); S.p.fstars = [];
    for (let k = 0, n = Math.round(W * H / 3400); k < n; k++) {
      const x = fr() * W, y = 6 + fr() * (H - 12), m = fr();
      if (inHole(x, y)) continue;
      // text glyphs, not shapes: mid-dots, with a rare + among the brightest
      const c = svgEl('text', { x: x.toFixed(1), y: y.toFixed(1), 'font-size': (9 + m * m * 9).toFixed(1) });
      c.textContent = m > .985 ? '+' : '·';
      c.style.setProperty('--o', (.22 + m * .5).toFixed(2)); fg.append(c); S.p.fstars.push({ x, y, m, el: c });
    }
    svg.append(fg);
    const list = ordered(), places = hole ? ringPlaces(list.length, W, H, hole) : rowPlaces(list.length, W, H);
    S.order = list.map(f => f.id).join(' ');
    list.forEach((f, i) => {
      const r = rng(hash(S.question + f.id)), { cx, cy, R } = places[i];
      const n = starCount(f), { pts, edges } = growFigure(r, cx, cy, n, R);
      assignSlots(f, pts.length);
      const g = svgEl('g', { class: `fv-fig ${f.kind}${f.phrase ? '' : ' inferred'} hidden` }); g.dataset.f = f.id; g.dataset.rf = f.id;
      const lines = edges.map(([a, b]) => { const ln = svgEl('line', { class: 'fv-edge' }); g.append(ln); return { a, b, ln }; });
      const stars = pts.map((p, k) => {
        const mag = .8 + r() * .6;
        const glow = svgEl('circle', { class: 'fv-glow', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 0, fill: `url(#${f.kind === F ? 'fvGlowF' : 'fvGlowC'})` });
        const c = svgEl('circle', { class: 'fv-st', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (1.6 * mag).toFixed(2) });
        g.append(glow, c); return { k, p, c, glow, mag, rad: 1.6 * mag };
      });
      svg.append(g);
      const name = btn(`fv-name ${f.kind}${f.phrase ? '' : ' inferred'}`, f.label.toLowerCase());
      name.dataset.f = f.id; name.dataset.rf = f.id; name.setAttribute('aria-haspopup', 'dialog'); name.setAttribute('aria-expanded', 'false');
      name.style.left = `${cx.toFixed(1)}px`; name.style.top = `${(Math.max(...pts.map(p => p.y)) + 10).toFixed(1)}px`;
      name.onclick = () => openCard(name, f);
      names.append(name);
      // Keep the whole name inside the stage; figures near the edge would otherwise clip it.
      const half = (name.offsetWidth || f.label.length * 8) / 2 + 6;
      name.style.left = `${clamp(cx, half, W - half).toFixed(1)}px`;
      S.p.figs.set(f.id, { g, stars, lines, name, want: n });
    });
    S.p.pings = svgEl('g', { class: 'fv-pings' }); svg.append(S.p.pings);
  }
  // Places around the box, clockwise from the top left, evenly spaced along a
  // path through the middle of the margins. Side columns too narrow for a
  // figure are skipped, leaving the bands above and below.
  function ringPlaces(n, W, H, hole) {
    if (!n) return [];
    const top = hole.y0, bottom = H - hole.y1, left = hole.x0, right = W - hole.x1;
    const ty = top / 2 - 8, by = hole.y1 + bottom / 2 - 8, sides = Math.min(left, right) >= 140;
    const sx = sides ? left / 2 : 60, ex = sides ? W - right / 2 : W - 60;
    const segs = sides
      ? [[sx, ty, ex, ty, 'h', top], [ex, ty, ex, by, 'v', right], [ex, by, sx, by, 'h', bottom], [sx, by, sx, ty, 'v', left]]
      : [[sx, ty, ex, ty, 'h', top], [ex, by, sx, by, 'h', bottom]];
    const lens = segs.map(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0)), total = lens.reduce((a, b) => a + b, 0);
    // Without sides the two bands are separate rows: split the figures between them.
    const step = sides ? total / n : null, out = [];
    if (!sides) {
      const up = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        const row = i < up ? 0 : 1, k = row ? i - up : i, count = row ? n - up : up, [x0, y0, x1, , , band] = segs[row];
        const t = (k + .5) / count, gap = Math.abs(x1 - x0) / count;
        out.push(place(x0 + (x1 - x0) * t, y0, gap / 2, band / 2 - 14));
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      let d = step * (i + .5), j = 0;
      while (j < segs.length - 1 && d > lens[j]) { d -= lens[j]; j++; }
      const [x0, y0, x1, y1, dir, band] = segs[j], t = lens[j] ? d / lens[j] : 0;
      out.push(place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, dir === 'h' ? step / 2 : band / 2 - 10, dir === 'h' ? band / 2 - 14 : step / 2 - 14));
    }
    return out;
  }
  // A figure's size from the room around its place: growFigure spans 1.35R across and 1.05R up and down.
  const place = (cx, cy, hx, hy) => ({ cx, cy, R: clamp(Math.min(hx / 1.35, hy / 1.05) * .92, 20, 64) });
  // Narrow screens: the sky is a band above the box, figures in two staggered rows.
  function rowPlaces(n, W, H) {
    const m = Math.max(30, W * .05), slot = (W - 2 * m) / Math.max(1, n);
    return Array.from({ length: n }, (_, i) => ({ cx: m + slot * (i + .5), cy: H * (i % 2 ? .62 : .3), R: clamp(slot * .62, 22, 56) }));
  }
  // Decided choices show on the representation still and in review; the feature still shows candidates.
  const showsChoices = () => S.phase === 'reps' || S.phase === 'review';
  function syncChart() {
    const review = S.phase === 'review';
    for (const f of S.features) {
      const fig = S.p.figs.get(f.id); if (!fig) continue;
      const decided = f.decided && showsChoices(), keep = !decided ? new Set() : review ? f.plan || f.keep || new Set() : f.keep || new Set();
      const gone = review ? f.removed || !keep.size : !!f.added;
      fig.g.classList.toggle('hidden', !f.shown || gone); fig.name.hidden = !f.shown || gone;
      fig.g.classList.toggle('drawn', f.shown);
      fig.name.textContent = (review && f.num ? pad(f.num) + ' ' : '') + f.label.toLowerCase();
      for (const s of fig.stars) {
        const h = f.slots?.[s.k] ?? null, kept = !!h && keep.has(h), w = review && kept ? f.weights?.get(h) : null;
        s.c.setAttribute('class', 'fv-st ' + (!h ? 'deco' : !decided ? 'cand' : kept ? 'kept' : 'cut'));
        s.rad = kept ? (Number.isFinite(w) ? 2.2 + Math.sqrt(w) * .75 : 3) : (decided && h ? 1.3 : 1.6) * s.mag;
        s.c.setAttribute('r', s.rad.toFixed(2)); s.glow.setAttribute('r', kept ? (s.rad * 5).toFixed(2) : 0);
        if (kept) s.c.dataset.rr = `${f.kind}:${f.fid}/${h}`; else delete s.c.dataset.rr;
        let t = s.c.querySelector('title'); if (h && !t) { t = svgEl('title'); s.c.append(t); }
        if (t) t.textContent = h ? f.options.find(o => o.header === h)?.label || h : '';
      }
      // Lines stop a small gap short of each star, so the stars read as the joints.
      for (const { a, b, ln } of fig.lines) {
        const A = fig.stars[a], B = fig.stars[b], d = dist(A.p, B.p) || 1, ux = (B.p.x - A.p.x) / d, uy = (B.p.y - A.p.y) / d;
        const ga = A.rad + 3.5, gb = B.rad + 3.5;
        ln.setAttribute('x1', (A.p.x + ux * ga).toFixed(1)); ln.setAttribute('y1', (A.p.y + uy * ga).toFixed(1));
        ln.setAttribute('x2', (B.p.x - ux * gb).toFixed(1)); ln.setAttribute('y2', (B.p.y - uy * gb).toFixed(1));
        ln.style.setProperty('--len', Math.ceil(Math.max(0, d - ga - gb)));
      }
    }
  }
  const pulse = (node, k, ms) => { if (!reduced()) node.animate([{ transform: 'scale(1)' }, { transform: `scale(${k})`, opacity: 1, fill: '#ffe2c9', offset: .2 }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' }); };
  function flashLine(a, b, ms, peak, cls) {
    const pings = S.p.pings; if (!pings || pings.childElementCount >= 40) return; // cap lines on screen
    const ln = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }); pings.append(ln);
    ln.animate([{ opacity: 0 }, { opacity: peak, offset: .25 }, { opacity: 0 }], { duration: ms });
    setTimeout(() => ln.remove(), ms + 30); // timer, not the animation clock, so lines never pile up
  }

  /* ---------- scanning while features are chosen ---------- */
  // Scans start at random moments and overlap. Each sweeps a random run of words
  // and, from the faint stars beneath them, forms a nameless constellation that
  // holds for a moment and fades. They stand for the model thinking, not for
  // features: when the features arrive these clear and the named figures form.
  function startScan() {
    if (S.scanning) return;
    const q = S.p.q, words = [...q.querySelectorAll('.w')], lit = new Map();
    q.querySelector('.fv-caret')?.remove(); q.classList.remove('dim');
    S.scanning = true; S.ghosts = new Set();
    if (!words.length || reduced()) return;
    q.classList.add('scanning');
    const on = w => { lit.set(w, (lit.get(w) || 0) + 1); w.classList.add('lit'); };
    const off = w => { const n = (lit.get(w) || 1) - 1; if (n) lit.set(w, n); else { lit.delete(w); w.classList.remove('lit'); } };
    // One read head moves through the question in order: each run picks up the word after the last
    // one and wraps to the start, so the highlight reads the question text by text.
    let at = 0;
    const scan = () => {
      if (S.ghosts.size >= 4) return 0; // a calm sky: a few figures at a time
      const start = at >= words.length ? 0 : at, len = Math.min(words.length - start, 3 + Math.floor(Math.random() * 4));
      at = start + len;
      const fig = { stars: [], edges: [], lines: [] }; S.ghosts.add(fig);
      const run = words.slice(start, start + len);
      run.forEach((w, k) => {
        later(() => { if (!S.scanning) return; on(w); const st = pickUnder(w, fig); if (st) growGhost(fig, st); }, k * 110);
        later(() => off(w), k * 110 + 300);
      });
      later(() => fadeGhost(fig, 700), run.length * 110 + 1400 + Math.random() * 600);
      return run.length * 110 + (at >= words.length ? 700 : 60);
    };
    const next = () => { if (!S.scanning) return; later(next, scan() || 200); };
    later(next, 220);
  }
  // The first star sits beneath the word; each later one is a short hop from an
  // earlier star, so the figure grows as a compact cluster while its scan sweeps.
  function pickUnder(word, fig) {
    const stars = S.p.fstars; if (!stars.length) return null;
    const last = fig.stars[fig.stars.length - 1];
    let pool;
    if (!last) {
      // The question rarely spans the whole sky (and may wrap), so a word's place in
      // reading order maps onto the full width: scans spread evenly across the sky.
      // A scan run is at least three words, so the last word a figure can start on maps to the right edge.
      const words = [...S.p.q.querySelectorAll('.w')], last0 = Math.max(1, words.length - 3), i = Math.max(0, words.indexOf(word));
      const W = S.p.sky.clientWidth, mid = Math.min(1, i / last0) * W, half = Math.max(30, W / (words.length + 1) / 2);
      const x0 = mid - half, x1 = mid + half;
      pool = stars.filter(st => st.x >= x0 - 10 && st.x <= x1 + 10 && !st.busy);
    } else {
      // Mostly hop on from the newest star, sometimes branch from an older one; stay near the centre.
      const from = Math.random() < .6 ? last : fig.stars[Math.floor(Math.random() * fig.stars.length)];
      const c = { x: fig.stars.reduce((n, o) => n + o.x, 0) / fig.stars.length, y: fig.stars.reduce((n, o) => n + o.y, 0) / fig.stars.length };
      pool = stars.filter(st => !st.busy && !fig.stars.includes(st) && dist(st, from) > 28 && dist(st, from) < 75 && dist(st, c) < 95 && fig.stars.every(o => dist(o, st) > 24) && !crossesHole(from, st));
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }
  // Samples along a hop: true when any point falls in the box (with a little margin).
  function crossesHole(a, b) {
    const h = S.p.hole; if (!h) return false;
    for (let t = 0; t <= 1; t += .1) { const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; if (x > h.x0 - 8 && x < h.x1 + 8 && y > h.y0 - 8 && y < h.y1 + 8) return true; }
    return false;
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
    const ln = svgEl('line', { class: 'fv-ghost', x1: from.x + ux * g, y1: from.y + uy * g, x2: st.x - ux * g, y2: st.y - uy * g });
    ln.style.setProperty('--len', Math.ceil(d - 2 * g)); S.p.pings?.append(ln); fig.lines.push(ln);
  }
  function fadeGhost(fig, ms) {
    if (fig.dead) return; fig.dead = true; S.ghosts?.delete(fig);
    for (const ln of fig.lines) { ln.classList.add('out'); ln.style.transitionDuration = ms + 'ms'; setTimeout(() => ln.remove(), ms + 40); }
    for (const st of fig.stars) { st.el.classList.remove('glit'); st.busy = false; }
  }
  function stopScan() {
    if (!S) return;
    S.scanning = false; for (const fig of [...(S.ghosts || [])]) fadeGhost(fig, 500);
    const q = S.p.q; q.classList.remove('scanning'); q.querySelectorAll('.lit').forEach(w => w.classList.remove('lit'));
  }

  /* ---------- log and clock ---------- */
  function say(html) { S.log.push(html); renderLog(); }
  function renderLog() {
    const { log, reps, toggle } = S.p, folded = S.phase === 'review';
    // On the representation step the table below already lists each feature's choices.
    const lines = folded ? (S.logOpen ? S.log : []) : S.phase === 'reps' ? S.log.filter(line => !line.startsWith('  ')) : S.log;
    const busy = !folded && (S.scanning || S.repsWaiting || S.replaying || S.phase === 'connecting' || S.revealing);
    log.innerHTML = lines.join('\n') + (busy ? '\n<span class="fv-cursor"> </span>' : '');
    log.classList.toggle('folded', folded && !S.logOpen); log.classList.toggle('open', folded && S.logOpen);
    reps.hidden = S.phase !== 'reps';
    toggle.hidden = !folded;
    toggle.textContent = `${S.logOpen ? '▾ hide' : '▸ show'} selection log · ${S.log.length} lines`;
    toggle.setAttribute('aria-expanded', String(S.logOpen));
    // Follow the end of the log while the selection runs.
    if (S.phase === 'reps') { const b = S.p.box; b.scrollTop = b.scrollHeight; }
  }
  function setClock(message, live) {
    const clock = S.p.clock; clock.replaceChildren(el('span', live ? 'fv-dot' : 'fv-dot done'), el('span', '', message));
    clearInterval(S.clockId);
    if (live && !reduced()) {
      const t = el('span', 'fv-timer'), tick = () => { t.textContent = ((performance.now() - S.t0) / 1000).toFixed(1).padStart(4, '0') + 's'; };
      tick(); S.clockId = setInterval(tick, 100); timers.add(S.clockId); clock.append(t);
    }
  }
  const featLine = f => {
    const tag = `<span class="${f.kind === C ? 'c' : 'f'}">[+] ${esc(f.label.toUpperCase())}</span>  <span class="p">${f.kind === C ? 'compare' : 'filter'}</span>`;
    return f.phrase ? `<span class="p">&gt;</span> "${esc(f.phrase)}" → ${tag}` : `<span class="p">&gt; inferred from context →</span> ${tag}`;
  };
  const repLine = f => {
    const keep = f.keep || new Set(), opts = f.options.slice(0, 4);
    const shown = opts.map(o => keep.has(o.header) ? `<span class="k">■ ${esc(o.header)}</span>` : `<span class="x">□ ${esc(o.header)}</span>`).join('  ');
    const more = f.options.length > 4 ? `  <span class="p">+${f.options.length - 4}</span>` : '';
    const label = f.label.toLowerCase();
    return `  ${esc(label.padEnd(Math.max(20, label.length + 2)))}${shown}${more}`;
  };
  const answered = () => S.features.filter(f => !f.added);
  const candidates = () => answered().reduce((n, f) => n + f.options.length, 0);
  const keptCount = () => answered().reduce((n, f) => n + (f.keep?.size || 0), 0);
  const doneLine = () => `<span class="p">&gt; plan ready</span> · kept <span class="k">${keptCount()}</span> of ${candidates()} options`;

  /* ---------- keep the current step in view ---------- */
  // Every step settles on the same view: the track and the question near the top
  // of the screen with the box below them, so the page doesn't jump between steps.
  // Each call supersedes any still pending, so the latest scroll always wins.
  let scrollSeq = 0;
  function centerStep() {
    const section = $('liveProgress'); if (!section || section.hidden) return;
    const seq = ++scrollSeq;
    requestAnimationFrame(() => {
      if (seq !== scrollSeq) return;
      const top = section.getBoundingClientRect().top + scrollY - 16;
      window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    });
  }

  /* ---------- feature card ---------- */
  function openCard(name, f) {
    const pop = S.p.pop, again = !pop.hidden && pop.dataset.f === f.id;
    closeCard(); if (again) return;
    pop.replaceChildren(el('p', 'fv-pop-name', f.label), el('p', 'fv-pop-desc', f.desc || (f.phrase ? `From “${f.phrase}” in the question.` : 'Inferred from context.')));
    if (f.decided && f.keep?.size && showsChoices()) pop.append(el('p', 'fv-pop-keep', 'Kept: ' + f.options.filter(o => f.keep.has(o.header)).map(o => o.label).join(', ')));
    if (f.decided && f.reason && showsChoices()) pop.append(el('p', 'fv-pop-why', f.reason));
    pop.className = `fv-pop ${f.kind}`; pop.dataset.f = f.id; pop.owner = name; pop.setAttribute('aria-label', f.label); pop.hidden = false;
    name.setAttribute('aria-expanded', 'true');
    const r = name.getBoundingClientRect(), base = S.p.host.getBoundingClientRect();
    pop.style.left = `${Math.max(0, Math.min(base.width - pop.offsetWidth, r.left - base.left + r.width / 2 - pop.offsetWidth / 2)).toFixed(1)}px`;
    pop.style.top = `${(r.bottom - base.top + 6).toFixed(1)}px`;
  }
  function closeCard() {
    const pop = S?.p?.pop; if (!pop || pop.hidden) return;
    pop.hidden = true; pop.owner?.setAttribute('aria-expanded', 'false'); pop.owner = null; delete pop.dataset.f;
  }
  document.addEventListener('pointerdown', e => { if (!e.target.closest?.('.fv-pop, .fv-name')) closeCard(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S?.p?.pop && !S.p.pop.hidden) { const owner = S.p.pop.owner; closeCard(); owner?.focus(); } });

  /* ---------- features arrive ---------- */
  function revealFeatures(animate) {
    stopScan(); fillHits(); buildChart(); syncChart();
    S.reached = Math.max(S.reached, 1);
    if (!animate || reduced()) {
      for (const f of S.features) { f.shown = true; S.log.push(featLine(f)); }
      S.revealing = false; syncHits(); syncChart(); renderLog(); renderTrack(); afterReveal(); return;
    }
    say(`<span class="p">&gt; features chosen</span> · ${S.features.length}`);
    centerStep();
    S.revealing = true; renderTrack(); setClock(`${S.features.length} feature${S.features.length === 1 ? '' : 's'}`, true);
    S.features.forEach((f, i) => later(() => { f.shown = true; say(featLine(f)); syncHits(); syncChart(); }, 500 + i * 420));
    later(() => { S.revealing = false; renderLog(); renderTrack(); afterReveal(); }, 500 + S.features.length * 420 + 500);
  }
  function afterReveal() {
    if (S.repsPending) enterReps(); else setClock(`${S.features.length} feature${S.features.length === 1 ? '' : 's'}`, false);
  }

  /* ---------- choosing representations ---------- */
  function enterReps() {
    if (S.repsEntered || S.revealing || !S.features.length) return;
    if (!S.menu && !S.answered) { setClock('Loading the catalog', true); return; } // setCatalog() comes back here
    S.repsEntered = true; S.phase = 'reps'; S.reached = Math.max(S.reached, 2);
    refreshOptions();
    // The catalog may have arrived after the figures were drawn; redraw if a figure's size changed.
    if (S.features.some(f => S.p.figs.get(f.id)?.want !== starCount(f))) { for (const f of S.features) f.slots = null; buildChart(); }
    for (const f of S.features) { f.shown = true; const fig = S.p.figs.get(f.id); if (fig) assignSlots(f, fig.stars.length); }
    syncChart(); buildRepTable();
    say(`<span class="p">&gt; choosing representations</span> · ${candidates()} candidates`);
    setClock(`Choosing representations · ${candidates()} candidates`, true);
    centerStep();
    if (S.answered) { replay(); return; }
    S.repsWaiting = true; repWaiting(); renderLog(); renderTrack();
  }
  // One row per feature, one tag per catalog option, under the sky.
  function buildRepTable() {
    const host = S.p.reps; host.replaceChildren();
    for (const f of S.features.filter(f => !f.added)) {
      const row = el('div', `fv-rrow ${f.kind}`), box = el('div', 'fv-rtags'), kind = f.kind === C ? 'c' : 'f';
      row.dataset.f = f.id; row.dataset.rf = f.id;
      row.append(el('span', 'fv-rlab', f.label.toLowerCase()), box);
      f.tags = f.options.map(o => { const t = el('span', `fv-tok ${kind}`, '□ ' + o.label); t.title = o.header; t.dataset.h = o.header; box.append(t); return t; });
      host.append(row);
      if (f.decided) settleRow(f, false);
    }
  }
  // Waiting: every row steps through its own candidates at the same time.
  // It is decoration only; the order is fixed, so it hints at nothing.
  const STEP = 520; // ms each candidate stays lit
  function repWaiting() {
    if (reduced()) return;
    const longest = Math.max(1, ...S.features.map(f => f.options.length)); let idx = 0;
    const tick = () => {
      if (!S.repsWaiting || S.phase !== 'reps') return;
      const k = idx % longest;
      for (const f of S.features) {
        if (k >= f.options.length) continue;
        const t = f.tags?.[k]; if (t) { t.classList.add('ping'); later(() => t.classList.remove('ping'), STEP - 60); }
        const fig = S.p.figs.get(f.id), i = fig ? f.slots.indexOf(f.options[k].header) : -1;
        if (i >= 0) { pulse(fig.stars[i].c, 1.9, 600); if (i) flashLine(fig.stars[i - 1].p, fig.stars[i].p, 700, .85, 'fv-ping ' + (f.kind === C ? 'c' : 'f')); }
      }
      idx++; later(tick, STEP);
    };
    tick();
  }
  const GLYPHS = '.:+*=#%@01<>/';
  function decode(node, text) {
    if (reduced()) { node.textContent = text; return; }
    const steps = 9;
    for (let i = 0; i <= steps; i++) later(() => { const n = Math.round(text.length * i / steps); node.textContent = text.slice(0, n) + text.slice(n).replace(/./g, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]); }, i * 36);
  }
  // Kept tags decode in, the rest strike out.
  function settleRow(f, animate) {
    const keep = f.keep || new Set(), fig = S.p.figs.get(f.id);
    f.options.forEach((o, k) => {
      const t = f.tags?.[k]; if (!t) return;
      const kept = keep.has(o.header); t.classList.remove('ping'); t.classList.toggle('kept', kept); t.classList.toggle('cut', !kept);
      if (kept && animate) decode(t, '■ ' + o.label); else t.textContent = (kept ? '■ ' : '□ ') + o.label;
      const i = fig && kept ? f.slots.indexOf(o.header) : -1;
      if (animate && i >= 0) pulse(fig.stars[i].c, 2.4, 700);
    });
  }
  function applyResult(result) {
    for (const f of S.features) {
      const items = ((result && result[f.kind === C ? 'comparisons' : 'filters']) || []).filter(item => item.feature_id === f.fid);
      for (const item of items) addOption(f, item.header, repLabel(item));
      f.keep = new Set(items.map(item => item.header));
      f.reason = items.find(item => item.reason)?.reason || '';
    }
    S.answered = true;
  }
  function replay() {
    S.repsWaiting = false; S.replaying = true;
    if (S.phase !== 'reps') { S.phase = 'reps'; closeCard(); buildRepTable(); syncChart(); } // the answer came while a still was open
    for (const f of S.features) { const fig = S.p.figs.get(f.id); if (fig) assignSlots(f, fig.stars.length); }
    say('<span class="p">&gt; answer received</span> · replaying feature by feature');
    setClock('Replaying the answer', true); renderTrack();
    S.features.forEach((f, i) => later(() => { f.decided = true; settleRow(f, true); syncChart(); S.log.push(repLine(f)); }, 400 + i * 480));
    later(finishReplay, 400 + S.features.length * 480 + 500);
  }
  function skipReplay() {
    if (!S?.replaying) return;
    stopMotion();
    for (const f of S.features) if (!f.decided) { f.decided = true; S.log.push(repLine(f)); }
    buildRepTable(); syncChart(); finishReplay(true);
  }
  function finishReplay(quick) {
    S.replaying = false; S.resolved = true;
    say(doneLine()); setClock(`Kept ${keptCount()} of ${candidates()}`, false); renderTrack();
    later(() => S.finish?.(), quick || reduced() ? 200 : 1100);
  }

  /* ---------- public flow ---------- */
  function show(stage, families) {
    if (!S) begin({ question: $('objective')?.value });
    if (stage === '' || stage === 'connecting') return;
    if (stage === 'features') {
      if (S.features.length) return;
      S.phase = 'features'; S.reached = Math.max(S.reached, 1);
      say(`<span class="p">&gt; reading question</span> · ${S.question.split(/\s+/).filter(Boolean).length} words`);
      say('<span class="p">&gt; choosing features</span>');
      setClock('Choosing features', true); startScan(); renderTrack(); renderLog(); centerStep();
      return;
    }
    // 'selected' (the features arrived) or 'representations'
    if (stage === 'representations') S.repsPending = true;
    if (!S.features.length) {
      if (S.phase === 'connecting') { S.phase = 'features'; say('<span class="p">&gt; choosing features</span>'); }
      setFeatures(families); S.phase = 'selected'; revealFeatures(true);
    } else if (stage === 'representations') enterReps();
  }
  function setCatalog(menu) {
    if (!S) return;
    S.menu = menu; refreshOptions();
    if (S.repsPending && !S.repsEntered && !S.revealing && S.features.length) enterReps();
  }
  // Resolves once the replay has played (or been skipped), so review can follow it.
  function resolve(result) {
    return new Promise(done => {
      if (!S) { done(); return; }
      S.finish = () => { S.finish = null; done(); };
      applyResult(result);
      if (!S.features.length) { S.finish(); return; }
      if (reduced()) { settleNow(); later(() => S?.finish?.(), 300); return; }
      S.repsPending = true;
      if (S.repsEntered) { if (!S.replaying && !S.resolved) replay(); }
      else if (!S.revealing) enterReps(); // enterReps sees the answer and replays
    });
  }
  function settleNow() {
    stopMotion(); stopScan();
    for (const f of S.features) { f.shown = true; f.decided = true; }
    S.repsEntered = true; S.resolved = true; S.replaying = false; S.revealing = false; S.phase = 'reps'; S.reached = Math.max(S.reached, 2);
    S.log = S.log.filter(line => !line.includes('choosing representations'));
    S.log.push(`<span class="p">&gt; choosing representations</span> · ${candidates()} candidates`, ...S.features.map(repLine), doneLine());
    fillHits(); buildChart(); buildRepTable(); syncHits(); syncChart(); renderLog(); renderTrack();
    setClock(`Kept ${keptCount()} of ${candidates()}`, false);
  }
  // Show an answer as already decided, without the replay (the stage viewer's review step).
  function settle(result) {
    if (!S) return;
    if (!S.features.length) return;
    applyResult(result); refreshOptions();
    if (!S.log.some(line => line.includes('[+]'))) S.log.push(...S.features.map(featLine));
    settleNow();
  }
  function stop() { stopMotion(); stopScan(); S?.finish?.(); }

  // Review sits under the sky: fold the log, show the plan's numbers and weights.
  function enterReview() {
    if (!S?.p) return;
    stopMotion(); closeCard();
    S.phase = 'review'; S.reached = 3; S.logOpen = false;
    const ledger = $('liveSelection');
    if (ledger && ledger.parentNode !== S.p.box) S.p.box.append(ledger);
    syncChart(); renderLog(); renderTrack();
    setClock(`Kept ${keptCount()} of ${candidates()}`, false);
    S.p.box.scrollTop = 0;
    centerStep();
  }
  // A still of an earlier stage, from the track or from review.
  function goStill(id) {
    if (!S?.p) return;
    if (S.phase === 'review' && toStill) { toStill(id === 'reps' ? 'reps' : 'features'); return; }
    redraw(id);
  }
  let toStill = null;
  function redraw(plane) {
    if (!S?.p || !S.features.length) return;
    stopMotion(); stopScan(); closeCard();
    S.phase = plane === 'reps' && S.repsEntered ? 'reps' : 'selected';
    for (const f of S.features) f.shown = true;
    if (!S.p.q.querySelector('.fv-hit') && S.hits.length) fillHits();
    syncHits(); if (S.phase === 'reps') buildRepTable(); syncChart();
    // Still waiting for the answer: the representation still keeps stepping through candidates.
    const waiting = S.phase === 'reps' && !S.answered;
    if (waiting) { S.repsWaiting = true; repWaiting(); }
    renderLog(); renderTrack();
    setClock(waiting ? `Choosing representations · ${candidates()} candidates` : S.phase === 'reps' ? `Kept ${keptCount()} of ${candidates()}` : `${S.features.length} feature${S.features.length === 1 ? '' : 's'}`, waiting);
  }
  function setReview(fn, back) { toReview = fn || null; toStill = back || toStill; if (S?.p) renderTrack(); }
  const planes = () => ({ features: !!S?.features.length, reps: !!S?.repsEntered });

  /* groups: [{ id: 'comparison:fid', kind, num, label, reps: [{ key, label: header, weight, inactive }] }] */
  function review(groups) {
    if (!S?.p) return;
    S.groups = groups;
    let added = false;
    const seen = new Set();
    for (const g of groups) {
      const fid = g.id.slice(g.id.indexOf(':') + 1);
      let f = S.features.find(x => x.id === g.id);
      if (!f) { f = feature(g.kind, fid, { label: g.label }); f.shown = true; f.decided = true; f.added = true; S.features.push(f); added = true; refreshOptions(); }
      seen.add(f.id); f.removed = false; f.num = g.num; f.decided = true; f.shown = true;
      if (g.label && f.added) f.label = g.label;
      for (const r of g.reps) addOption(f, r.label);
      f.plan = new Set(g.reps.filter(r => !r.inactive || g.kind === F).map(r => r.label));
      f.weights = new Map(g.reps.filter(r => Number.isFinite(r.weight) && !r.inactive).map(r => [r.label, r.weight]));
    }
    for (const f of S.features) if (!seen.has(f.id)) f.removed = true;
    const order = ordered().map(f => f.id).join(' ');
    if (added || order !== S.order) buildChart();
    for (const f of S.features) { const fig = S.p.figs.get(f.id); if (fig) assignSlots(f, fig.stars.length); }
    syncChart();
  }
  // Hovering or focusing anything tagged data-rf / data-rr lights its partners in root,
  // and a feature also lights its phrase in the question.
  function link(root) {
    const toggle = on => e => {
      const t = e.target.closest?.('[data-rr],[data-rf]'); if (!t) return;
      const rr = t.dataset.rr || t.closest('[data-rr]')?.dataset.rr, rf = t.dataset.rf || t.closest('[data-rf]')?.dataset.rf;
      if (rf) {
        root.querySelectorAll(`[data-rf="${CSS.escape(rf)}"]`).forEach(n => n.classList.toggle('on', on));
        root.querySelectorAll('.fv-hit').forEach(n => { if (n.dataset.f.split(' ').includes(rf)) n.classList.toggle('on-hover', on); });
      }
      if (rr) root.querySelectorAll(`[data-rr="${CSS.escape(rr)}"]`).forEach(n => n.classList.toggle('on', on));
    };
    for (const [a, b] of [['mouseover', 'mouseout'], ['focusin', 'focusout']]) { root.addEventListener(a, toggle(true)); root.addEventListener(b, toggle(false)); }
  }

  window.StageView = { reveal: centerStep, begin, show, stop, setCatalog, resolve, settle, redraw, setReview, planes, enterReview, review, link };
})();
