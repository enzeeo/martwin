/* Procedural glowing ASCII, inspired by JIN2's ASCII Code Art. Painted once as a still. */
(() => {
  const canvas = document.getElementById('space');
  const cover = document.getElementById('cover');
  if (!canvas || !cover) return;
  canvas.style.opacity = '1';
  const context = canvas.getContext('2d');
  const pools = [':;!il1', 'rcvxz+=tf', 'aeouns{}[]<>', '08B$#&%@Q'];
  // Sample once so stars stay in place while their light changes.
  const stars = Array.from({ length: 380 }, () => ({
    x: Math.random(), y: Math.random(),
    glyph: Math.random() < .03 ? (Math.random() < .5 ? '+' : '*') : '.',
    size: 9 + Math.random() * 6,
    brightness: .5 + Math.random() * .45,
  }));
  let width = 0, height = 0;

  function resize() {
    const rect = cover.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function planet(context, cx, cy, radius, hue, seed) {
    if (!(radius > 0)) return; // zero-size cover (hidden or mid-resize) would make every cell NaN
    const cellX = 8, cellY = 12;
    const left = Math.floor((cx - radius) / cellX);
    const right = Math.ceil((cx + radius) / cellX);
    const top = Math.floor((cy - radius) / cellY);
    const bottom = Math.ceil((cy + radius) / cellY);
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const x = col * cellX, y = row * cellY;
        const dx = (x - cx) / radius, dy = (y - cy) / radius;
        const distance = dx * dx + dy * dy;
        if (distance >= 1) continue;
        const depth = Math.sqrt(1 - distance);
        const texture = .82 + .18 * Math.sin(dy * 19 + dx * 6 + seed);
        const light = Math.max(0, -.5 * dx - .35 * dy + .75 * depth) * texture;
        if (light < .1) continue;
        const hash = (Math.imul(col, 73856093) ^ Math.imul(row, 19349663) ^ seed) >>> 0;
        const pool = pools[Math.min(3, Math.floor(light * 4))];
        const contour = Math.abs(dx) > Math.abs(dy) ? '|' : '_';
        context.fillStyle = `hsla(${hue}, 30%, ${48 + light * 30}%, ${.24 + light * .46})`;
        context.shadowColor = `hsla(${hue}, 55%, 70%, .65)`;
        context.shadowBlur = light > .55 ? 7 : 0;
        context.fillText(distance > .88 ? contour : pool[hash % pool.length], x, y);
      }
    }
    context.shadowBlur = 0;
  }

  // Still frame: the stars and planets are painted once (and again on resize), never per frame.
  function draw() {
    context.clearRect(0, 0, width, height);
    context.textAlign = 'left';
    const mobile = width < 700;
    const discs = [[width * .84, height * .24, Math.min(mobile ? 76 : 145, width * .16), 29, 41]];
    if (!mobile) discs.push([width * .07, height * .28, Math.min(64, width * .055), 92, 93]);
    // Stars sit behind the planets: skip any that would show through a disc's dark cells.
    const behind = (x, y) => discs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 < (r + 10) ** 2);
    const count = Math.min(mobile ? 90 : 220, Math.floor(width * height / 4000));
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      if (behind(star.x * width, star.y * height)) continue;
      context.font = `${star.size}px ui-monospace, monospace`;
      context.fillStyle = `rgba(211, 228, 238, ${.8 * star.brightness})`;
      context.shadowColor = '#91bacb';
      context.shadowBlur = star.glyph === '.' ? 0 : 6;
      context.fillText(star.glyph, star.x * width, star.y * height);
    }
    context.shadowBlur = 0;
    context.font = '10px ui-monospace, monospace';
    for (const disc of discs) planet(context, ...disc);
  }

  let timer = 0;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(resize, 150); });
  resize();
})();
