/* Procedural glowing ASCII, inspired by JIN2's ASCII Code Art. */
(() => {
  const canvas = document.getElementById('space');
  const cover = document.getElementById('cover');
  if (!canvas || !cover) return;
  canvas.style.opacity = '1';
  const context = canvas.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pools = [':;!il1', 'rcvxz+=tf', 'aeouns{}[]<>', '08B$#&%@Q'];
  // Sample once so stars stay in place while their light changes.
  const stars = Array.from({ length: 380 }, () => ({
    x: Math.random(), y: Math.random(),
    glyph: Math.random() < .22 ? (Math.random() < .5 ? '+' : '*') : '.',
    size: 9 + Math.random() * 6,
    brightness: .5 + Math.random() * .45,
    phase: Math.random() * Math.PI * 2,
    speed: .3 + Math.random() * .9,
  }));
  let width = 0, height = 0, frame = 0, last = 0, elapsed = 0;

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

  function planet(cx, cy, radius, hue, seed) {
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
        const shimmer = motion.matches ? 0 : Math.floor(elapsed / 4 + (hash % 7) / 7);
        const contour = Math.abs(dx) > Math.abs(dy) ? '|' : '_';
        context.fillStyle = `hsla(${hue}, 30%, ${48 + light * 30}%, ${.24 + light * .46})`;
        context.shadowColor = `hsla(${hue}, 55%, 70%, .65)`;
        context.shadowBlur = light > .55 ? 7 : 0;
        context.fillText(distance > .88 ? contour : pool[(hash + shimmer) % pool.length], x, y);
      }
    }
    context.shadowBlur = 0;
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.font = '10px ui-monospace, monospace';
    context.textAlign = 'left';
    const mobile = width < 700;
    const count = Math.min(mobile ? 150 : 380, Math.floor(width * height / 2400));
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      const twinkle = motion.matches ? .8 : .78 + .2 * Math.sin(elapsed * star.speed + star.phase);
      context.font = `${star.size}px ui-monospace, monospace`;
      context.fillStyle = `rgba(211, 228, 238, ${twinkle * star.brightness})`;
      context.shadowColor = '#91bacb';
      context.shadowBlur = star.glyph === '.' ? 0 : 6;
      context.fillText(star.glyph, star.x * width, star.y * height);
    }
    context.shadowBlur = 0;
    context.font = '10px ui-monospace, monospace';
    planet(width * .84, height * .24, Math.min(mobile ? 76 : 145, width * .16), 29, 41);
    if (!mobile) planet(width * .07, height * .28, Math.min(64, width * .055), 92, 93);

    // A short crossing every 25 seconds leaves the scene mostly still.
    if (!motion.matches) {
      const phase = elapsed % 25;
      if (phase > 3 && phase < 9) {
        const progress = (phase - 3) / 6;
        const x = width * (1.04 - progress * .45), y = height * (.13 + progress * .12);
        context.save();
        context.translate(x, y);
        context.rotate(-.12);
        context.font = '9px ui-monospace, monospace';
        context.fillStyle = 'rgba(220, 224, 200, .8)';
        context.shadowColor = '#c5d5a5';
        context.shadowBlur = 4;
        context.fillText('<|==>', 0, 0);
        context.fillStyle = 'rgba(223, 171, 119, .6)';
        context.fillText('· ·', 30, 0);
        context.restore();
      }
    }
  }

  function tick(now) {
    frame = 0;
    if (document.hidden || motion.matches) return;
    if (!last || now - last >= 100) {
      elapsed += last ? Math.min(now - last, 200) / 1000 : 0;
      last = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function updateMotion() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    if (!document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
    else if (!document.hidden) draw();
  }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', updateMotion);
  motion.addEventListener('change', updateMotion);
  resize();
  updateMotion();
})();
