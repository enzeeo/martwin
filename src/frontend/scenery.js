/* Scroll scenery between the cover and the page-end horizon, in the same glowing
   ASCII style: the page-wide star field, plus objects in the side gutters that
   appear as a run progresses (ringed planet and spiral galaxy once Select features
   starts, an emission nebula at review, an elliptical galaxy with the matches).
   Everything is painted once per resize and scrolls with the page: no parallax. */
(() => {
  const layer = document.getElementById('scenery');
  const cover = document.getElementById('cover'), horizon = document.getElementById('horizon');
  const main = document.querySelector('main.main');
  if (!layer || !cover || !horizon || !main) return;
  const MONO = '"Geist Mono",ui-monospace,monospace';
  const CELL_X = 7, CELL_Y = 11;
  const hash = (a, b, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

  function makeCanvas(cls) {
    const c = document.createElement('canvas');
    c.className = cls; layer.appendChild(c);
    return { c, ctx: c.getContext('2d'), w: 0, h: 0, top: 0, left: 0, depth: 0 };
  }
  // Stars first so everything else in the layer sits in front of them.
  const stars = makeCanvas('sc-stars'), planet = makeCanvas('sc-obj sc-planet');

  function size(item, w, h, maxRatio = 2) {
    const ratio = Math.min(devicePixelRatio || 1, maxRatio);
    item.w = w; item.h = h;
    item.c.width = Math.round(w * ratio); item.c.height = Math.round(h * ratio);
    item.c.style.width = w + 'px'; item.c.style.height = h + 'px';
    item.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /* ---------- page star field ---------- */
  // Continues the cover's star field (cosmic-background.js) from the cover's bottom
  // edge to the end of the page, with the same glyphs, sizes and density, so the
  // sky reads as one piece down to the Mars horizon (which has an opaque backing).
  function paintStars(perStar) {
    const { ctx, w, h } = stars;
    ctx.clearRect(0, 0, w, h);
    const count = Math.floor(w * h / perStar);
    for (let i = 0; i < count; i++) {
      const glyph = hash(i, 4) < .03 ? (hash(i, 5) < .5 ? '+' : '*') : '.';
      const bright = .5 + hash(i, 3) * .45;
      ctx.font = `${9 + hash(i, 6) * 6}px ui-monospace, monospace`;
      ctx.fillStyle = `rgba(211, 228, 238, ${.8 * bright})`;
      ctx.shadowColor = '#91bacb'; ctx.shadowBlur = glyph === '.' ? 0 : 6;
      ctx.fillText(glyph, hash(i, 1) * w, hash(i, 2) * h);
    }
    ctx.shadowBlur = 0;
  }

  /* ---------- ringed planet ---------- */
  function paintPlanet(r) {
    const { ctx, w, h } = planet, cx = w / 2, cy = h / 2;
    const tilt = -.32, squash = .3, inner = 1.38 * r, outer = 2.05 * r;
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    ctx.clearRect(0, 0, w, h);
    // Opaque backing so stars and other background glyphs never show through.
    ctx.fillStyle = '#101214'; ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = `10px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bands = ['.:;', ':;!il', 'rcvxz=+', 'aeouns{}', '08B$#&%@'];
    for (let row = 0; row * CELL_Y < h; row++) {
      for (let col = 0; col * CELL_X < w; col++) {
        const x = col * CELL_X + CELL_X / 2, y = row * CELL_Y + CELL_Y / 2;
        const px = x - cx, py = y - cy;
        // Ring plane coordinates: u along the ring, v across it (scaled back to a circle).
        const u = px * cos + py * sin, v = (-px * sin + py * cos) / squash;
        const e = Math.hypot(u, v), d = Math.hypot(px, py) / r;
        const inRing = e > inner && e < outer && Math.abs(e - 1.72 * r) > .05 * r; // Cassini-style gap
        const front = v > 0;
        if (inRing && (front || d >= 1)) {
          const along = (e - inner) / (outer - inner);
          const lit = .45 + .35 * Math.sin(along * 17) * Math.sin(along * 5 + 1) + (u < 0 ? .15 : -.1);
          const shadowed = !front && d < 1.15; // planet's shadow falls on the far ring
          const b = Math.max(.3, Math.min(1, lit + .15)) * (shadowed ? .4 : 1);
          ctx.fillStyle = `hsla(38, 40%, ${66 + b * 28}%, ${.4 + b * .6})`;
          ctx.shadowColor = 'rgba(240,215,170,.55)'; ctx.shadowBlur = b > .7 ? 5 : 0;
          ctx.fillText(b > .75 ? '=' : b > .45 ? '-' : b > .25 ? '~' : '.', x, y);
        } else if (d < 1) {
          const depth = Math.sqrt(1 - d * d), dx = px / r, dy = py / r;
          const band = .78 + .22 * Math.sin(dy * 13 + Math.sin(dx * 3) * .6) * Math.sin(dy * 4 + 2);
          const light = Math.max(0, -.5 * dx - .45 * dy + .7 * depth) * band;
          if (light < .08) continue;
          const pool = bands[Math.min(4, Math.floor(light * 5))];
          ctx.fillStyle = `hsla(${28 + dy * 10}, 42%, ${50 + light * 32}%, ${.3 + light * .6})`;
          ctx.shadowColor = 'rgba(235,175,125,.6)'; ctx.shadowBlur = light > .6 ? 6 : 0;
          const limb = d > .92;
          ctx.fillText(limb ? (Math.abs(dx) > Math.abs(dy) ? '|' : '_') : pool[Math.floor(hash(col, row) * pool.length)], x, y);
        }
      }
    }
    ctx.shadowBlur = 0;
    // A small moon, for scale.
    const mx = cx - outer * .95, my = cy + r * 1.25;
    ctx.fillStyle = 'rgba(215,226,232,.85)'; ctx.shadowColor = 'rgba(200,220,235,.8)'; ctx.shadowBlur = 6;
    ctx.fillText('(@)', mx, my);
    ctx.shadowBlur = 0;
  }

  /* ---------- shared painting helpers ---------- */
  const smooth = t => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const a = hash(xi, yi, 9), b = hash(xi + 1, yi, 9), c = hash(xi, yi + 1, 9), d = hash(xi + 1, yi + 1, 9);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => (vnoise(x, y) * .5 + vnoise(x * 2, y * 2) * .25 + vnoise(x * 4, y * 4) * .125 + vnoise(x * 8, y * 8) * .0625) / .9375;
  // Walk the glyph grid; fn(x, y, col, row) paints one cell.
  function eachCell(item, fn, cw = CELL_X, ch = CELL_Y, font = 10) {
    const { ctx, w, h } = item;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${font}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let row = 0; row * ch < h; row++) for (let col = 0; col * cw < w; col++) fn(col * cw + cw / 2, row * ch + ch / 2, col, row);
    ctx.shadowBlur = 0;
  }
  const GLYPHS = ['.', ':', '+', '=', '*', 'o', '0', '@'];
  function put(item, ch, x, y, hue, sat, light, alpha, glow) {
    const { ctx } = item;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
    ctx.shadowColor = `hsla(${hue}, 70%, 72%, .7)`; ctx.shadowBlur = glow ? 6 : 0;
    ctx.fillText(ch, x, y);
  }

  /* ---------- spiral galaxy: inclined disc, warm bulge, blue wound arms, dust lanes ---------- */
  // Modelled on dwcminh.ascii's Milky Way animation: an exponential disc wound into two
  // log-spiral arms with dark dust lanes between them, a flattened glowing bulge, and
  // colour that runs from a peach core through steel-blue arms to violet at the edge,
  // browned wherever dust lies. Faint regions use thin glyphs; the bulge uses dense ones.
  const RAMP = ' .:;!il1|rtjxzcv+=*<>{}aeou0Q8B$#%&@';
  const GAL_CORE = [255, 206, 150], ARM_BLUE = [140, 170, 225], ARM_VIOLET = [150, 130, 215], DUST = [150, 90, 55];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const clamp01 = t => Math.min(1, Math.max(0, t)), sm = t => smooth(clamp01(t));
  function paintSpiral(item, R) {
    const cx = item.w / 2, cy = item.h / 2, tilt = -.45, cos = Math.cos(tilt), sin = Math.sin(tilt), q = .42;
    const pitch = Math.tan(22 * Math.PI / 180);
    eachCell(item, (x, y, col, row) => {
      const px = x - cx, py = y - cy;
      const a = px * cos + py * sin, vs = -px * sin + py * cos, b = vs / q; // (a, b): disc plane
      const u = Math.hypot(a, b) / R, th = Math.atan2(b, a);                 // u: 0 centre, 1 rim
      const wind = 2 * (th - Math.log(Math.max(u, .02) / .08) / pitch);
      const arm = Math.pow(.5 + .5 * Math.cos(wind), 2.4) + .35 * Math.pow(.5 + .5 * Math.cos(2 * wind + 1), 2);
      const lane = Math.pow(.5 + .5 * Math.cos(wind + 1), 8) * sm((u - .1) / .1) * (1 - sm((u - .75) / .3));
      const fall = Math.exp(-u / .34) * (1 - sm((u - .8) / .35));
      const grain = Math.sin(Math.floor(x / 6) * 12.9898 + Math.floor(y / 9) * 78.233) * .5 + .5 * hash(col, row, 2);
      const disc = 2.9 * fall * (.12 + 1.15 * arm) * (.7 + .6 * grain) * (1 - .72 * lane);
      const miss = Math.hypot(a, vs / .62) / R;                               // flattened bulge
      const bulge = 1.9 * Math.exp(-miss / .055) + .45 * Math.exp(-miss / .16);
      const light = Math.min(disc + bulge, 1.7) / 1.7;
      // Dim cells thin out at random, so arm edges and the gaps between them read as sparse dust.
      if (light < .03 || (light < .1 && hash(col, row, 5) > (light - .03) * 14)) return;
      let ink = mix(GAL_CORE, ARM_BLUE, sm((u - .1) / .3));
      ink = mix(ink, ARM_VIOLET, .75 * sm((u - .5) / .45));
      ink = mix(ink, DUST, clamp01(1.3 * lane));
      ink = mix(ink, [255, 238, 215], clamp01((bulge - .9) / 1));             // white-hot centre
      const lvl = Math.pow(light, .55), k = .55 + .45 * lvl;                   // dim glyphs are darker too
      const [r, g, bl] = ink.map(v => Math.round(v * k));
      const { ctx } = item;
      ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${.4 + .55 * lvl})`;
      ctx.shadowColor = `rgba(${ink.map(Math.round).join(',')}, .75)`; ctx.shadowBlur = lvl > .55 ? 4 + 6 * lvl : 0;
      ctx.fillText(RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(Math.pow(light, .9) * (RAMP.length - 1)))], x, y); // glyph density tracks raw light
    }, 6, 9, 9);
    // Soft orange haze around the bulge, painted behind the glyphs.
    const { ctx } = item;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.translate(cx, cy); ctx.rotate(tilt); ctx.scale(1, .62);
    const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, R * .42);
    haze.addColorStop(0, 'rgba(255, 190, 120, .32)'); haze.addColorStop(.4, 'rgba(220, 140, 80, .12)'); haze.addColorStop(1, 'rgba(200, 120, 70, 0)');
    ctx.fillStyle = haze; ctx.fillRect(-R, -R, 2 * R, 2 * R);
    ctx.restore();
    // A few stars around it, in the cover's star style.
    for (let i = 0; i < 40; i++) {
      const sx = hash(i, 31) * item.w, sy = hash(i, 32) * item.h;
      const rr = Math.hypot((sx - cx) * cos + (sy - cy) * sin, ((-(sx - cx) * sin + (sy - cy) * cos)) / q) / R;
      if (rr < 1.1) continue;
      ctx.fillStyle = `rgba(211,228,238,${.5 + hash(i, 33) * .4})`; ctx.shadowColor = '#91bacb'; ctx.shadowBlur = 5;
      ctx.fillText(hash(i, 34) < .25 ? '+' : '.', sx, sy);
    }
    ctx.shadowBlur = 0;
  }

  /* ---------- emission nebula: warped noise cloud, teal into orange ---------- */
  function paintNebula(item) {
    const cx = item.w / 2, cy = item.h / 2;
    eachCell(item, (x, y, col, row) => {
      const nx = (x - cx) / cx, ny = (y - cy) / cy, mask = Math.max(0, 1 - (nx * nx + ny * ny));
      const wx = x + (fbm(x / 70 + 40, y / 70) - .5) * 90, wy = y + (fbm(x / 70, y / 70 + 40) - .5) * 90;
      const dens = fbm(wx / 34 + 3, wy / 34 + 7) * Math.pow(mask, .7) * 1.55;
      if (hash(col, row, 11) > .985) { put(item, '*', x, y, 190, 30, 88, .9, true); return; }
      if (dens < .42) return;
      const level = Math.min(.999, (dens - .42) / .5), mix = fbm(x / 90 + 20, y / 90 + 5);
      put(item, GLYPHS[Math.floor(level * 6)], x, y, mix > .5 ? 22 : 190, 55, 50 + level * 28, .25 + level * .6, level > .6);
    });
  }

  /* ---------- elliptical galaxy / globular cluster: dense, fading blob ---------- */
  function paintElliptical(item, R) {
    const cx = item.w / 2, cy = item.h / 2, tilt = .45, cos = Math.cos(tilt), sin = Math.sin(tilt);
    eachCell(item, (x, y, col, row) => {
      const px = x - cx, py = y - cy;
      const r = Math.hypot(px * cos + py * sin, (-px * sin + py * cos) / .62) / R;
      const dens = 1 / (1 + Math.pow(r / .3, 1.7)) * Math.min(1, Math.max(0, (1.1 - r) * 4));
      if (dens < .08 || hash(col, row, 6) > dens * 2.6 + .12) return;
      const level = Math.min(.999, dens * 1.1), star = hash(col, row, 8) > .96;
      put(item, star ? '*' : GLYPHS[Math.floor(level * GLYPHS.length)], x, y, 50 - level * 14, 45, 58 + level * 30, .3 + level * .65, level > .5 || star);
    });
  }

  /* ---------- placement ---------- */
  // Objects join the page by phase: 1 = Select features running, 2 = reviewing the
  // plan, 3 = matches shown. Slots are spaced down from the top of <main> by about a
  // screen each, so a taller page simply shows more of them.
  const objects = [
    { item: planet, phase: 1, slot: 0, side: 'right', visible: .9 },
    { item: makeCanvas('sc-obj sc-spiral'), phase: 1, slot: 1, side: 'left', centre: 95 },
    { item: makeCanvas('sc-obj sc-nebula'), phase: 2, slot: 2, side: 'right', centre: 90 },
    { item: makeCanvas('sc-obj sc-elliptical'), phase: 3, slot: 3, side: 'left', centre: 80 },
  ];
  const [, spiral, nebula, elliptical] = objects.map(o => o.item);
  let mobile = false, phase = 0;

  function place() {
    const pageW = document.documentElement.clientWidth;
    mobile = pageW < 700;
    const top = cover.offsetTop + cover.offsetHeight, bottom = horizon.offsetTop;
    const pageH = document.documentElement.scrollHeight;
    size(stars, pageW, Math.max(1, bottom - top), 1); // ends where the horizon begins; it paints its own sky
    stars.top = top; stars.left = 0;
    paintStars(mobile ? 4000 : 4600);
    stars.c.style.transform = `translate3d(0, ${stars.top}px, 0)`;

    const k = mobile ? .6 : 1, r = mobile ? 42 : Math.min(80, pageW * .06);
    size(planet, Math.round(r * 4.4), Math.round(r * 3)); paintPlanet(r);
    size(spiral, Math.round(540 * k), Math.round(340 * k)); paintSpiral(spiral, 240 * k);
    size(nebula, Math.round(340 * k), Math.round(240 * k)); paintNebula(nebula);
    size(elliptical, Math.round(210 * k), Math.round(160 * k)); paintElliptical(elliptical, 85 * k);

    const mainTop = main.offsetTop, step = Math.max(640, innerHeight * .85);
    for (const o of objects) {
      const { item } = o;
      item.top = mainTop + (o.slot ? o.slot * step : 24);
      // `centre` pins the object's middle that far in from its edge, so the bright part sits
      // in the gutter and the rest bleeds off-screen or behind the panels.
      item.left = o.centre ? (o.side === 'right' ? pageW - o.centre : o.centre) - item.w / 2
        : o.side === 'right' ? pageW - item.w * o.visible : -item.w * (1 - o.visible);
      item.fits = item.top + item.h < bottom;
      item.c.style.transform = `translate3d(${Math.round(item.left)}px, ${Math.round(item.top)}px, 0)`;
    }
    layer.style.height = pageH + 'px';
    apply();
  }

  function apply() {
    for (const o of objects) o.item.c.classList.toggle('on', phase >= o.phase && o.item.fits);
  }

  // Phase follows which run sections are showing (they toggle `hidden`).
  const shown = id => { const n = document.getElementById(id); return !!n && !n.closest('[hidden]'); };
  function readPhase() {
    const next = shown('mapSection') ? 3 : shown('liveSelection') ? 2 : shown('liveProgress') ? 1 : 0;
    if (next !== phase) { phase = next; apply(); }
  }
  const watcher = new MutationObserver(readPhase);
  for (const id of ['liveProgress', 'liveSelection', 'mapSection']) {
    const n = document.getElementById(id);
    if (n) watcher.observe(n, { attributes: true, attributeFilter: ['hidden'] });
  }

  let timer = 0;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(place, 120); }).observe(document.body);

  readPhase();
  place();
})();
