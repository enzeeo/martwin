/* Target globe for the input console, drawn as glowing orange ASCII.
   Glyph pools, limb strokes and bloom follow the glow-ascii-art style
   (inspired by JIN2, @jin_22ee).
   If mars.jpg exists next to this file, its disk is converted to letters.
   Otherwise a procedural globe is drawn. */
(() => {
  const $ = id => document.getElementById(id);
  const form = $('searchForm');
  if (!form || !form.classList.contains('mc')) return;
  const lat = $('latitude'), lon = $('longitude'), objective = $('objective');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');

  // Approximate sub-observer point of the supplied photo (Valles Marineris
  // facing the viewer). Used only to place the target reticle on the photo.
  const PHOTO_CENTER = { lat: -5, lon: -70 };

  /* ---------- readouts ---------- */
  function readTarget() {
    const a = lat.value.trim(), b = lon.value.trim(), la = Number(a), lo = Number(b);
    return {
      lat: la, lon: lo,
      latOk: a !== '' && Number.isFinite(la) && la >= -90 && la <= 90,
      lonOk: b !== '' && Number.isFinite(lo) && lo >= -180 && lo <= 180,
    };
  }
  function refresh() {
    const t = readTarget();
    lat.classList.toggle('is-bad', !t.latOk); lon.classList.toggle('is-bad', !t.lonOk);
    const length = objective.value.length;
    $('mcCount').textContent = `${String(length).padStart(4, '0')} / 1500`;
    $('mcCount').classList.toggle('is-high', length > 1350);
  }
  for (const node of [lat, lon, objective]) node.addEventListener('input', refresh);

  /* ---------- globe ---------- */
  const canvas = $('mcGlobe'), glow = document.createElement('canvas');
  const ctx = canvas.getContext('2d'), gctx = glow.getContext('2d');
  const POOLS = [':;!il1', 'rcvxz+=tf', 'aeouns{}[]<>', '08B$#&%@Q'];
  const CELL_X = 7, CELL_Y = 11, RAD = Math.PI / 180;
  const LIGHT = (() => { const v = [-0.55, 0.5, 0.67], n = Math.hypot(...v); return v.map(x => x / n); })();
  let w = 0, h = 0, view = null, last = 0, elapsed = 0, frame = 0, visible = true;
  let photo = null, photoCells = null; // photo: {img, x, y, size}; photoCells: luminance per cell

  const hash = (x, y, z = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), q = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t, c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
             l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), q);
  }
  const fbm = (x, y, z) => noise3(x, y, z) * .55 + noise3(x * 2.1, y * 2.1, z * 2.1) * .3 + noise3(x * 4.3, y * 4.3, z * 4.3) * .15;
  const stroke = angle => { const a = ((angle % Math.PI) + Math.PI) % Math.PI; return a < Math.PI / 8 || a >= 7 * Math.PI / 8 ? '-' : a < 3 * Math.PI / 8 ? '/' : a < 5 * Math.PI / 8 ? '|' : '\\'; };
  // One orange ramp built around the site accent #eba078.
  const orange = heat => {
    const lo = [70, 32, 20], mid = [235, 160, 120], hi = [250, 222, 200];
    const [a, b, t] = heat < .7 ? [lo, mid, heat / .7] : [mid, hi, (heat - .7) / .3];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  };

  function geometry() { return { R: Math.min(w, h) * .46, cx: w * .5, cy: h * .5 }; }

  // Resample the photo's disk into one luminance value per glyph cell.
  function samplePhoto() {
    photoCells = null;
    if (!photo || !w) return;
    const { R, cx, cy } = geometry();
    const cols = Math.ceil(w / CELL_X), rows = Math.ceil(h / CELL_Y);
    const tmp = document.createElement('canvas'); tmp.width = cols; tmp.height = rows;
    const t = tmp.getContext('2d');
    t.imageSmoothingQuality = 'high';
    t.drawImage(photo.img, photo.x, photo.y, photo.size, photo.size,
      (cx - R) / CELL_X, (cy - R) / CELL_Y, 2 * R / CELL_X, 2 * R / CELL_Y);
    const data = t.getImageData(0, 0, cols, rows).data;
    photoCells = { cols, lum: new Float32Array(cols * rows) };
    for (let i = 0; i < cols * rows; i++) {
      photoCells.lum[i] = (.3 * data[i * 4] + .55 * data[i * 4 + 1] + .15 * data[i * 4 + 2]) / 255;
    }
  }

  // Find the planet's disk: rows/columns with a solid share of bright pixels.
  function loadPhoto() {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const bright = (px, py) => { const i = (py * c.width + px) * 4; return d[i] + d[i + 1] + d[i + 2] > 150; };
      const solid = (m, at) => { let count = 0; for (let k = 0; k < m; k++) if (at(k)) count++; return count > m * .12; };
      let top = -1, bottom = -1, left = -1, right = -1;
      for (let py = 0; py < c.height; py++) if (solid(c.width, px => bright(px, py))) { if (top < 0) top = py; bottom = py; }
      for (let px = 0; px < c.width; px++) if (solid(c.height, py => bright(px, py))) { if (left < 0) left = px; right = px; }
      if (top < 0 || left < 0) return;
      const size = Math.max(bottom - top, right - left) / scale;
      photo = { img, x: ((left + right) / 2) / scale - size / 2, y: ((top + bottom) / 2) / scale - size / 2, size };
      samplePhoto(); draw();
    };
    img.src = 'mars.jpg';
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    for (const [c, x] of [[canvas, ctx], [glow, gctx]]) { c.width = Math.round(w * ratio); c.height = Math.round(h * ratio); x.setTransform(ratio, 0, 0, ratio, 0, 0); }
    samplePhoto(); draw();
  }

  function draw() {
    if (!w) return;
    const t = readTarget(), ok = t.latOk && t.lonOk;
    // The photo is fixed; the procedural globe eases round to face the target.
    const goal = photo ? { ...PHOTO_CENTER } : { lat: Math.max(-55, Math.min(55, (ok ? t.lat : 0) * .75)), lon: ok ? t.lon : 0 };
    if (!view || photo || motion.matches) view = { ...goal };
    else { view.lat += (goal.lat - view.lat) * .18; view.lon += ((((goal.lon - view.lon) + 540) % 360) - 180) * .18; }
    const { R, cx, cy } = geometry();
    const sinV = Math.sin(view.lat * RAD), cosV = Math.cos(view.lat * RAD);
    const drift = Math.floor(elapsed * 6);
    gctx.clearRect(0, 0, w, h);
    gctx.font = '10px "Geist Mono",ui-monospace,monospace'; gctx.textAlign = 'center'; gctx.textBaseline = 'middle';

    for (let row = 0; row * CELL_Y < h; row++) {
      for (let col = 0; col * CELL_X < w; col++) {
        const x = col * CELL_X + CELL_X / 2, y = row * CELL_Y + CELL_Y / 2;
        const nx = (x - cx) / R, ny = (cy - y) / R, r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        let heat;
        if (photoCells) {
          heat = Math.min(1, Math.pow(photoCells.lum[row * photoCells.cols + col] || 0, .8) * 1.15);
        } else {
          const pLat = Math.asin(ny * cosV + z * sinV), pLon = view.lon * RAD + Math.atan2(nx, z * cosV - ny * sinV);
          const tex = fbm(Math.cos(pLat) * Math.cos(pLon) * 2.6 + 9, Math.cos(pLat) * Math.sin(pLon) * 2.6 + 3, Math.sin(pLat) * 2.6 + 5);
          const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2]);
          heat = Math.min(1, .2 + .8 * Math.pow(diffuse, .9) * (.45 + .75 * tex)); // ambient keeps the night side faintly visible
        }
        if (r2 > .9 && heat > .12) { // limb strokes, faded with the surface so they never float off the disk
          gctx.fillStyle = orange(heat);
          gctx.globalAlpha = Math.min(1, heat * 1.3);
          gctx.fillText(stroke(Math.atan2(ny, nx) + Math.PI / 2), x, y);
          gctx.globalAlpha = 1;
        } else if (r2 <= .9 && heat > .08) {
          const pool = POOLS[Math.min(3, Math.floor(heat * 4))], k = hash(col, row);
          gctx.fillStyle = orange(heat);
          gctx.globalAlpha = Math.min(1, .3 + heat * .9);
          gctx.fillText(pool[Math.floor(k * pool.length + (k > .82 ? drift : 0)) % pool.length], x, y);
          gctx.globalAlpha = 1;
        }
      }
    }

    // Target reticle (orthographic projection onto the visible hemisphere).
    if (ok) {
      const la = t.lat * RAD, dl = (t.lon - view.lon) * RAD;
      const vx = Math.cos(la) * Math.sin(dl);
      const vy = Math.sin(la) * cosV - Math.cos(la) * Math.cos(dl) * sinV;
      const vz = Math.sin(la) * sinV + Math.cos(la) * Math.cos(dl) * cosV;
      gctx.font = '10px "Geist Mono",ui-monospace,monospace';
      gctx.fillStyle = gctx.strokeStyle = '#f1eee7';
      if (vz > 0) {
        const px = cx + vx * R, py = cy - vy * R, s = 10 + (motion.matches ? 0 : 2 + 2 * Math.sin(elapsed * 4));
        gctx.lineWidth = 1.5; gctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          gctx.moveTo(px + sx * s, py + sy * (s - 5)); gctx.lineTo(px + sx * s, py + sy * s); gctx.lineTo(px + sx * (s - 5), py + sy * s);
        }
        gctx.stroke(); gctx.fillRect(px - 1.5, py - 1.5, 3, 3);
        const right = px > w * .7;
        gctx.textAlign = right ? 'right' : 'left'; gctx.fillText('TGT', px + (right ? -18 : 18), py - 12);
      } else {
        gctx.textAlign = 'center'; gctx.fillText('TGT ON FAR SIDE', cx, h - 10);
      }
      gctx.textAlign = 'center';
    }

    // Composite: crisp glyphs plus two blurred copies for bloom.
    ctx.clearRect(0, 0, w, h);
    // Opaque backing disc so the page's star field never shows through the globe's dark cells.
    ctx.fillStyle = '#101214'; ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(glow, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(3px)'; ctx.globalAlpha = .5; ctx.drawImage(glow, 0, 0, w, h);
    ctx.filter = 'blur(10px)'; ctx.globalAlpha = .3; ctx.drawImage(glow, 0, 0, w, h);
    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function loop(now) {
    frame = 0;
    if (!visible || document.hidden || motion.matches) return;
    if (now - last > 70) { elapsed += last ? Math.min(.2, (now - last) / 1000) : 0; last = now; draw(); }
    frame = requestAnimationFrame(loop);
  }
  function start() { if (motion.matches) draw(); else if (!frame) { last = 0; frame = requestAnimationFrame(loop); } }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) start(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  motion.addEventListener?.('change', start);
  // Targets also change programmatically (preset picker, map double-click).
  setInterval(() => { refresh(); if (motion.matches) draw(); }, 1000);
  refresh(); loadPhoto(); resize(); start();
})();
