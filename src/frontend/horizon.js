/* Page-end horizon: the top of an ASCII Mars with small ASCII-art explorers
   on it: a chibi astronaut floating on a balloon, another walking, a rover
   with camera eyes and a lunar-style lander. The planet is painted once per resize;
   only the figures move, at ~15 fps, and only while the horizon is on screen.
   The sky has no stars of its own: the page-wide field in scenery.js shows
   through, so the horizon blends into the rest of the page. */
(() => {
  const canvas = document.getElementById('horizonCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas'), bctx = base.getContext('2d');
  const figs = document.createElement('canvas'), fctx = figs.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const MONO = '"Geist Mono",ui-monospace,monospace';
  const POOLS = ['.:;\'`', ':;!il1', 'rcvxz+=tf', 'aeouns{}[]', '08B$#&%@'];
  const CELL_X = 7, CELL_Y = 11, BG = '#101214';
  let w = 0, h = 0, cx = 0, cy = 0, R = 0, rise = 0, mobile = false, S = 1;
  let t = 0, last = 0, frame = 0, visible = false;

  // Integer hash, reseeded on every load so the terrain glyphs never settle into a visible pattern.
  const SEED = (Math.random() * 2 ** 32) >>> 0;
  const hash = (a, b) => {
    let n = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ SEED;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b); n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  // Smooth value noise for organic craters / terrain patches.
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(xi + 9001, yi), b = hash(xi + 9002, yi), c2 = hash(xi + 9001, yi + 1), d = hash(xi + 9002, yi + 1);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
  const surfaceY = x => cy - Math.sqrt(Math.max(0, R * R - (x - cx) ** 2));
  const tangent = x => Math.asin(Math.max(-1, Math.min(1, (x - cx) / R)));

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    mobile = w < 700; S = mobile ? .62 : 1;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    for (const [c, x] of [[canvas, ctx], [base, bctx], [figs, fctx]]) {
      c.width = Math.round(w * ratio); c.height = Math.round(h * ratio);
      x.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    rise = Math.min(mobile ? 110 : 170, h * .5);
    R = Math.max(w * 1.3, mobile ? 520 : 1100);
    cx = w / 2; cy = h - rise + R;
    paintBase();
    draw();
  }

  // Static layer: the Mars limb, with an opaque backing so page stars stay behind it.
  function paintBase() {
    bctx.clearRect(0, 0, w, h);
    const halo = bctx.createRadialGradient(cx, cy, R - 4, cx, cy, R + 50);
    halo.addColorStop(0, 'rgba(235,140,90,.2)'); halo.addColorStop(1, 'rgba(235,140,90,0)');
    bctx.fillStyle = halo; bctx.fillRect(0, 0, w, h);
    // No opaque disc: the sky is the page background. Stars are drawn here (scenery.js
    // stops above the horizon) and skipped over the planet, so none show through it.
    bctx.textAlign = 'center'; bctx.textBaseline = 'alphabetic';
    const count = Math.floor(w * h / (mobile ? 4000 : 4600));
    for (let i = 0; i < count; i++) {
      const x = hash(i, 1) * w, y = hash(i, 2) * h;
      if ((x - cx) ** 2 + (y - cy) ** 2 < (R + 3) ** 2) continue;
      const glyph = hash(i, 4) < .03 ? (hash(i, 5) < .5 ? '+' : '*') : '.';
      bctx.font = `${9 + hash(i, 6) * 6}px ui-monospace, monospace`;
      bctx.fillStyle = `rgba(211,228,238,${.8 * (.5 + hash(i, 3) * .45)})`;
      bctx.shadowColor = '#91bacb'; bctx.shadowBlur = glyph === '.' ? 0 : 6;
      bctx.fillText(glyph, x, y);
    }
    bctx.shadowBlur = 0;
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.font = `10px ${MONO}`;
    for (let row = 0; row * CELL_Y < h; row++) {
      for (let col = 0; col * CELL_X < w; col++) {
        const x = col * CELL_X + CELL_X / 2, y = row * CELL_Y + CELL_Y / 2;
        const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const depth = Math.sqrt(1 - d2);
        // Lit from above and a little left; falls off towards the page bottom.
        const below = (y - (h - rise)) / rise;
        const crater = Math.max(0, noise(col * .09, row * .22) * 1.4 + noise(col * .31, row * .6) * .6 - 1.05);
        let light = (1.05 - .4 * below - .2 * dx) * (.85 + .15 * depth) - crater * .35;
        light = Math.max(0, Math.min(1, light));
        if (light < .08) continue;
        const edge = d2 > 1 - (CELL_Y * 1.6) / R;
        const pool = POOLS[Math.min(4, Math.floor(light * 5))];
        // Mars ramp: rust in shadow, the site's #eba078 apricot in the light.
        const hue = 16 + light * 8 + (noise(col * .05, row * .2) - .5) * 8;
        bctx.fillStyle = `hsla(${hue}, ${58 + light * 16}%, ${34 + light * 36}%, ${.35 + light * .6})`;
        bctx.shadowColor = 'rgba(235,150,100,.65)';
        bctx.shadowBlur = light > .6 ? 7 : 0;
        bctx.fillText(edge ? (Math.abs(dx) < .35 ? '_' : dx < 0 ? '/' : '\\') : pool[Math.floor(Math.min(.999, Math.max(0, hash(col, row) + (hash(col + 77, row) - .5) * .25)) * pool.length)], x, y);
      }
    }
    bctx.shadowBlur = 0;
  }

  /* ---------- ASCII figures (multi-line art, origin at the bottom centre) ---------- */
  const c = fctx;
  const WHITE = '#f1eee7', SUIT = '#e3e2dd', GREY = '#aab0b9', DIM = '#8a8f96', ORANGE = '#eba078',
    FOIL = ['#d98a43', '#eba078', '#c4712f'], BLUE = '#91bacb', VISOR = '#5a6f94', PAD = '#c9a46a';

  // Chibi astronaut: big helmet with a visor glint, chest panel, small boots.
  const ASTRO_TOP = [
    '   .---.   ',
    '  /.---.\\  ',
    ' | |*::| |o',
    '  \\\'---\'/  ',
    ' .-\'---\'-. ',
    ' ||[:#:]|| ',
  ];
  const LEGS = [
    ['  \'|_|_|\'  ', '   (_)(_)  '],
    ['  \'/_/\\_\\\' ', '  (_)  (_) '],
  ];
  const astroColor = (r, col, ch) =>
    r === 2 && col > 3 && col < 8 ? (ch === '*' ? '#ffffff' : VISOR)
    : r === 2 && ch === 'o' ? GREY
    : r === 5 && ch === '#' ? ORANGE
    : r === 5 && ch === ':' ? BLUE
    : r >= 6 ? (r === 7 ? GREY : SUIT)
    : r >= 4 ? SUIT : WHITE;

  // Same astronaut drifting under a balloon, hand raised to hold the string.
  const FLOATER = [
    '  .-.          ',
    ' ( * )         ',
    '  \'-\'          ',
    '   (           ',
    '    )   .---.  ',
    '   (   /.---.\\ ',
    '    ) | |*::| |o',
    '    o  \\\'---\'/ ',
    '     \\.-\'---\'-.',
    '      ||[:#:]||',
    '       \'|_|_|\' ',
    '        (_)(_) ',
  ];
  const floaterColor = (r, col, ch) =>
    r <= 2 ? (ch === '*' ? '#ffffff' : BLUE)
    : col <= 4 && r <= 6 ? '#cfd3d8'
    : astroColor(r - 4, col - 5, ch);

  // Rover with a camera head that has big round eyes, a dish and six wheels.
  const ROVER = [
    '.-------.             ',
    '|(o) (o)|             ',
    '\'--. .--\'      .-.    ',
    '   | |    !   (   )   ',
    ' __|_|____|____\\_/    ',
    '[==================]  ',
    ' \\________________/   ',
  ];
  const roverColor = (r, col, ch) =>
    r <= 2 && col <= 8 ? (ch === 'o' || ch === '-' && r === 1 || (ch === '(' || ch === ')') && r === 1 ? WHITE : ORANGE)
    : col >= 13 && r >= 2 && r <= 4 && '.-()\\_/'.includes(ch) ? ORANGE
    : ch === '!' ? WHITE
    : r === 5 ? DIM
    : r === 6 ? '#c7c9cd'
    : '#dcdcd6';

  // Lunar-style lander: faceted ascent stage over a gold-foil descent stage, ladder, footpads.
  const LANDER = [
    '         o    !       ',
    '         |    |       ',
    '     .---\'----+---.   ',
    '    / /\\  *   |    \\  ',
    '   /_/  \\_____|_[]__\\ ',
    '   |================| ',
    '  /|################|\\',
    ' / |################| \\',
    '/  |################|H \\',
    '|  \'------\\__/------\'H  |',
    '|        /____\\     H  |',
    '=                   =  =',
  ];
  const landerColor = (r, col, ch) =>
    ch === '#' ? FOIL[(col * 7 + r * 3) % 3]
    : ch === 'H' ? '#e8e4da'
    : ch === '=' ? (r === 5 ? '#d8d6cf' : PAD)
    : ch === '*' ? ORANGE
    : r <= 1 ? WHITE
    : ch === '[' || ch === ']' ? VISOR
    : r <= 4 ? '#b9bdc3'
    : r >= 9 && col > 8 && col < 16 ? DIM
    : '#d8d6cf';

  const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '/': '\\', '\\': '/' };
  let charW = 0, charFont = '';

  // Draw art bottom-centred at (x, y); on the ground when y is null (follows the slope).
  const LOOP = 48; // seconds; every actor's cycle count divides this loop exactly
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const ease = v => v * v * (3 - 2 * v);

  function art(lines, color, x, { y = null, angle = null, flip = false, size = 9, alpha = 1 } = {}) {
    if (alpha <= 0) return;
    const px = size * S, font = `${px}px ${MONO}`;
    c.font = font;
    if (charFont !== font) { charFont = font; charW = c.measureText('M').width; }
    const lh = px * 1.08, cols = Math.max(...lines.map(l => l.length));
    const ground = y === null;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, ground ? surfaceY(x) + px * .25 : y);
    c.rotate(angle ?? (ground ? tangent(x) * .55 : 0)); // half-follow the slope: reads better on a steep limb
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    lines.forEach((line, r) => {
      const ry = (r - lines.length + 1) * lh;
      for (let k = 0; k < cols; k++) {
        const src = flip ? cols - 1 - k : k, ch = line[src];
        if (!ch || ch === ' ') continue;
        c.fillStyle = color(r, src, ch);
        c.fillText(flip ? (MIRROR[ch] || ch) : ch, (k - cols / 2) * charW, ry);
      }
    });
    c.restore();
  }

  const FLAG = ['|>>>', '|   ', '|   ', '|   '];
  const flagColor = (r, col) => col === 0 ? '#e8e4da' : ORANGE;

  function draw() {
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0, w, h);
    const sky = h - rise;
    c.clearRect(0, 0, w, h);

    // Every motion below is a function of the loop phase p in [0,1) and uses whole
    // numbers of cycles per loop, so the last frame flows straight into the first.
    const p = (t % LOOP) / LOOP, TAU = Math.PI * 2;

    // Satellite crosses the sky once per loop, entering and leaving off-screen.
    art(['[##]-o-[##]'], (r, col, ch) => ch === '#' ? BLUE : '#d7e6ee', -150 + p * (w + 300),
      { y: sky * .22 + Math.sin(p * TAU * 5) * 6, angle: -.05, size: 10 });

    const landerX = w * (mobile ? .8 : .74), flagX = w * (mobile ? .56 : .58);
    const beacon = Math.floor(p * 72) % 2 === 0;
    art(LANDER, (r, col, ch) => ch === '*' ? (beacon ? '#ffb38a' : '#5c3a2a') : landerColor(r, col, ch), landerX);
    FLAG[0] = Math.floor(p * 144) % 2 ? '|>>>' : '|>>-';
    art(FLAG, flagColor, flagX);

    // Walker makes two round trips per loop, pausing and turning at each end.
    const a = flagX + 30 * S, b = landerX - 95 * S, q = (p * 2) % 1, PAUSE = .1, leg = .5 - PAUSE;
    const out = q < .5;
    const u = out ? ease(clamp01((q - PAUSE / 2) / leg)) : 1 - ease(clamp01((q - .5 - PAUSE / 2) / leg));
    const moving = u > 0 && u < 1 && (out ? q > PAUSE / 2 && q < .5 - PAUSE / 2 : q > .5 + PAUSE / 2 && q < 1 - PAUSE / 2);
    art([...ASTRO_TOP, ...LEGS[moving ? Math.floor(p * 192) % 2 : 0]], astroColor, a + (b - a) * u, { flip: !out });

    // Rover potters back and forth on a small patch far to the left (clear of the balloon
    // astronaut), bumping slightly up and down. Whole cycles per loop keep the wrap seamless.
    const rcx = w * (mobile ? .1 : .15), ramp = w * (mobile ? .025 : .05);
    const rx = rcx + Math.sin(p * TAU * 2) * ramp, heading = Math.cos(p * TAU * 2);
    const bump = (2 + Math.sin(p * TAU * 11) * 1.2 + Math.sin(p * TAU * 5) * .8) * 1.2 * S; // always >= 0: never sinks into the ground
    const spoke = '|/-\\'[Math.floor(p * 288) % 4];
    const blink = (p * 12) % 1 < .045;
    const rover = ROVER.map((line, r) => r === 1 && blink ? line.replace(/\(o\)/g, '(-)') : line);
    rover.push(` (${spoke})  (${spoke})  (${spoke})  (${spoke})  `);
    art(rover, (r, col, ch) => r === 7 ? (ch === '(' || ch === ')' ? DIM : ORANGE) : roverColor(r, col, ch), rx,
      { flip: heading >= 0, y: surfaceY(rx) + 9 * S * .25 - bump, angle: tangent(rx) * .55 });

    // Balloon astronaut drifts on a closed figure: 2 sways, 7 bobs, 4 tilts per loop.
    art(FLOATER, floaterColor, w * (mobile ? .3 : .36) + Math.sin(p * TAU * 2) * 18,
      { y: sky * (mobile ? .6 : .92) + Math.sin(p * TAU * 7) * (mobile ? 4 : 7), angle: Math.sin(p * TAU * 4) * .1 });

    // One soft halo over all the figures, as in the rest of the page's glyph art.
    ctx.save();
    ctx.shadowColor = 'rgba(241,238,231,.55)'; ctx.shadowBlur = 6;
    ctx.drawImage(figs, 0, 0, w, h);
    ctx.restore();
  }

  function loop(now) {
    frame = 0;
    if (!visible || document.hidden || motion.matches) return;
    if (now - last > 66) { t = (t + (last ? Math.min(.2, (now - last) / 1000) : 0)) % LOOP; last = now; draw(); }
    frame = requestAnimationFrame(loop);
  }
  function start() { if (motion.matches) draw(); else if (!frame && visible) { last = 0; frame = requestAnimationFrame(loop); } }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  motion.addEventListener?.('change', start);
  resize();
})();
