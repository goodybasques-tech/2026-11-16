// Darkroom engine v0 — shared drawing system for the "one room, three depths" look.
// Every function is deterministic: same inputs -> same pixels. Scenes expose renderAt(t).

const DR = (() => {
  const W = 1920, H = 1080;

  // ---------- palette (provisional, see channel/bible.md §2) ----------
  const C = {
    black: '#07080a',
    desk: '#0f0f0f',
    lamp: [255, 232, 204],      // warm key light
    paper: '#e6dccb',
    paperShade: '#b9ab93',
    ink: '#1c1a17',
    accent: '#d2452c',          // vermillion: the one emphasis colour
    cold: [120, 150, 190],      // fill / rim light from the dark
    textHi: '#f2ece2',
    textLo: 'rgba(242,236,226,0.55)',
  };

  // ---------- deterministic randomness ----------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = k => { k = clamp(k); return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
  const seg = (t, a, b) => clamp((t - a) / (b - a));

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------- textures (built once) ----------
  const cache = {};
  function deskTexture() {
    if (cache.desk) return cache.desk;
    const w = 2400, h = 1600, c = canvas(w, h), g = c.getContext('2d');
    g.fillStyle = C.desk; g.fillRect(0, 0, w, h);
    const r = rng(7);
    // long low-contrast grain streaks (dark wood / worn leather)
    for (let i = 0; i < 2600; i++) {
      const y = r() * h, x = r() * w, len = 200 + r() * 900, a = 0.015 + r() * 0.035;
      g.strokeStyle = r() < .5 ? `rgba(255,240,220,${a})` : `rgba(0,0,0,${a * 2})`;
      g.lineWidth = .6 + r() * 2.2;
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + len * .3, y + (r() - .5) * 8, x + len * .6, y + (r() - .5) * 8, x + len, y + (r() - .5) * 6);
      g.stroke();
    }
    // fine speckle
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    return (cache.desk = c);
  }

  function grainTile(seed) {
    const s = 256, c = canvas(s, s), g = c.getContext('2d'), img = g.createImageData(s, s), r = rng(seed + 11);
    for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (r() - .5) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0); return c;
  }

  // ---------- camera: world units are desk pixels at zoom 1 ----------
  function applyCamera(ctx, cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(cam.roll || 0);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
  }

  // ---------- room: desk + lamp pool ----------
  function drawDesk(ctx, cam, lampX, lampY, lampR, lampPower = 1, dof = 0) {
    const tex = deskTexture();
    ctx.save(); applyCamera(ctx, cam);
    if (dof > 0) ctx.filter = `blur(${dof}px) brightness(0.75)`;
    ctx.drawImage(tex, -1200, -800);
    ctx.filter = 'none';
    // light pool: warm, soft falloff, slightly elliptical (lamp above-left)
    const [lr, lg, lb] = C.lamp;
    const g = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, lampR);
    g.addColorStop(0, `rgba(${lr},${lg},${lb},${0.26 * lampPower})`);
    g.addColorStop(0.35, `rgba(${lr},${lg - 20},${lb - 40},${0.16 * lampPower})`);
    g.addColorStop(0.75, `rgba(${lr},${lg - 40},${lb - 70},${0.035 * lampPower})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g; ctx.fillRect(-1400, -1000, 2800, 2000);
    ctx.globalCompositeOperation = 'source-over';
    // darkness outside the pool
    const v = ctx.createRadialGradient(lampX, lampY, lampR * 0.35, lampX, lampY, lampR * 1.35);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(3,3,4,0.92)');
    ctx.fillStyle = v; ctx.fillRect(-1400, -1000, 2800, 2000);
    ctx.restore();
  }

  // ---------- the vial (2 mL injection vial), drawn bottom-centre at (x,y), height h ----------
  // light comes from upper-left; opts.label lines, opts.capColor
  function drawVial(ctx, x, y, h, opts = {}) {
    const w = h * 0.43, bodyH = h * 0.62, shoulder = h * 0.07, neckW = w * 0.56, neckH = h * 0.06;
    const capW = w * 0.66, capH = h * 0.15, topH = h * 0.06, topW = capW * 0.92;
    const x0 = x - w / 2, yb = y, yt = y - bodyH;
    const lit = opts.light == null ? 1 : opts.light;

    ctx.save();
    // contact + cast shadow (to lower right)
    ctx.save();
    ctx.translate(x, y);
    const sh = ctx.createRadialGradient(w * .35, 0, 0, w * .35, 0, w * 1.7);
    sh.addColorStop(0, `rgba(0,0,0,${0.55 * lit})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.scale(1.9, 0.32); ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(w * .35, 0, w * 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // body path
    const body = new Path2D();
    const r = w * 0.09;
    body.moveTo(x0 + r, yb); body.lineTo(x0 + w - r, yb); body.quadraticCurveTo(x0 + w, yb, x0 + w, yb - r);
    body.lineTo(x0 + w, yt);
    body.bezierCurveTo(x0 + w, yt - shoulder * .9, x + neckW / 2, yt - shoulder * .5, x + neckW / 2, yt - shoulder);
    body.lineTo(x + neckW / 2, yt - shoulder - neckH);
    body.lineTo(x - neckW / 2, yt - shoulder - neckH);
    body.lineTo(x - neckW / 2, yt - shoulder);
    body.bezierCurveTo(x - neckW / 2, yt - shoulder * .5, x0, yt - shoulder * .9, x0, yt);
    body.lineTo(x0, yb - r); body.quadraticCurveTo(x0, yb, x0 + r, yb); body.closePath();

    // glass base tint (sees the dark room through it)
    const gl = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    gl.addColorStop(0, `rgba(170,180,190,${0.20 * lit})`);
    gl.addColorStop(0.18, `rgba(40,44,50,0.35)`);
    gl.addColorStop(0.6, `rgba(20,22,26,0.35)`);
    gl.addColorStop(0.92, `rgba(${C.cold.join(',')},${0.22 * lit})`);
    gl.addColorStop(1, `rgba(200,210,225,${0.30 * lit})`);
    ctx.fillStyle = gl; ctx.fill(body);

    // liquid (pale yellow solution)
    ctx.save(); ctx.clip(body);
    const liqTop = yb - bodyH * 0.80;
    const lq = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    lq.addColorStop(0, `rgba(232,214,150,${0.55 * lit})`);
    lq.addColorStop(0.25, `rgba(150,128,70,0.55)`);
    lq.addColorStop(0.7, `rgba(90,74,40,0.55)`);
    lq.addColorStop(1, `rgba(210,190,130,${0.5 * lit})`);
    ctx.fillStyle = lq; ctx.fillRect(x0, liqTop, w, bodyH);
    // meniscus
    ctx.strokeStyle = `rgba(255,240,200,${0.55 * lit})`; ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.beginPath(); ctx.moveTo(x0, liqTop - h * .006); ctx.quadraticCurveTo(x, liqTop + h * .01, x0 + w, liqTop - h * .006); ctx.stroke();

    // label (wrapped paper, cylindrical shading)
    if (opts.label !== false) {
      const ly = yb - bodyH * 0.70, lh = bodyH * 0.50;
      ctx.fillStyle = C.paper; ctx.fillRect(x0, ly, w, lh);
      // label print
      ctx.save();
      ctx.fillStyle = C.ink; ctx.textAlign = 'center';
      ctx.font = `600 ${h * 0.052}px "Inter Display", Inter, sans-serif`;
      ctx.fillText('LENACAPAVIR', x, ly + lh * 0.30);
      ctx.font = `400 ${h * 0.026}px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(28,26,23,.75)';
      ctx.fillText('injection · for subcutaneous use', x, ly + lh * 0.47);
      ctx.fillText('463.5 mg / 1.5 mL', x, ly + lh * 0.62);
      ctx.fillStyle = C.ink; ctx.fillRect(x0 + w * 0.12, ly + lh * 0.76, w * 0.76, h * 0.004);
      ctx.font = `500 ${h * 0.02}px "Courier 10 Pitch", "Liberation Mono", monospace`;
      ctx.fillStyle = 'rgba(28,26,23,.6)';
      ctx.fillText('LOT 2026-0417   EXP 05/28', x, ly + lh * 0.90);
      ctx.restore();
      const cyl = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      cyl.addColorStop(0, 'rgba(0,0,0,0.70)'); cyl.addColorStop(0.16, 'rgba(0,0,0,0.05)');
      cyl.addColorStop(0.30, 'rgba(255,245,225,0.10)'); cyl.addColorStop(0.55, 'rgba(0,0,0,0.12)');
      cyl.addColorStop(0.85, 'rgba(0,0,0,0.55)'); cyl.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = cyl; ctx.fillRect(x0, ly, w, lh);
      ctx.fillStyle = `rgba(0,0,0,${1 - lit})`; ctx.fillRect(x0, ly, w, lh);
    }
    ctx.restore();

    // glass highlights (on top of everything)
    ctx.save(); ctx.clip(body);
    const sweep = opts.sweep == null ? 0.2 : opts.sweep; // 0..1 position of the travelling highlight
    const hx = x0 + w * (0.10 + sweep * 0.18);
    const hl = ctx.createLinearGradient(hx - w * .05, 0, hx + w * .07, 0);
    hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.45, `rgba(255,248,235,${0.75 * lit})`); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fillRect(hx - w * .05, yt - shoulder, w * .12, bodyH + shoulder);
    // secondary thin highlight
    ctx.fillStyle = `rgba(255,250,240,${0.25 * lit})`; ctx.fillRect(x0 + w * 0.30, yt + bodyH * .05, w * 0.015, bodyH * .85);
    // cylindrical falloff over the whole body
    const cs = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    cs.addColorStop(0, 'rgba(0,0,0,0.35)'); cs.addColorStop(0.12, 'rgba(0,0,0,0)'); cs.addColorStop(0.7, 'rgba(0,0,0,0.18)'); cs.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = cs; ctx.fillRect(x0, yt - shoulder, w, bodyH + shoulder);
    // rim (cold) on right edge
    ctx.fillStyle = `rgba(${C.cold.join(',')},${0.45 * lit})`; ctx.fillRect(x0 + w * 0.955, yt, w * 0.02, bodyH * .97);
    // shoulder specular
    const sp = ctx.createRadialGradient(x - w * .22, yt - shoulder * .3, 0, x - w * .22, yt - shoulder * .3, w * .22);
    sp.addColorStop(0, `rgba(255,250,240,${0.8 * lit})`); sp.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = sp; ctx.fillRect(x0, yt - shoulder * 1.2, w, shoulder * 2);
    ctx.restore();
    ctx.strokeStyle = `rgba(220,225,235,${0.18 * lit})`; ctx.lineWidth = Math.max(1, h * 0.003); ctx.stroke(body);
    // base thick glass
    ctx.fillStyle = `rgba(200,210,220,${0.12 * lit})`; ctx.fillRect(x0 + r, yb - h * .03, w - 2 * r, h * .03);

    // aluminium crimp cap
    const cy = yt - shoulder - neckH - capH * 0.15;
    const al = ctx.createLinearGradient(x - capW / 2, 0, x + capW / 2, 0);
    al.addColorStop(0, `rgb(${60 * lit + 20},${62 * lit + 20},${66 * lit + 22})`);
    al.addColorStop(0.18, `rgb(${235 * lit + 15},${235 * lit + 15},${238 * lit + 15})`);
    al.addColorStop(0.35, `rgb(${150 * lit + 15},${152 * lit + 15},${158 * lit + 15})`);
    al.addColorStop(0.7, `rgb(${70 * lit + 12},${72 * lit + 12},${78 * lit + 12})`);
    al.addColorStop(0.93, `rgb(${120 * lit + 14},${130 * lit + 14},${150 * lit + 16})`);
    al.addColorStop(1, `rgb(${40 * lit + 10},${40 * lit + 10},${46 * lit + 10})`);
    ctx.fillStyle = al;
    roundRect(ctx, x - capW / 2, cy - capH + capH * .15, capW, capH, capW * 0.06); ctx.fill();
    // crimp line
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - capW / 2, cy - capH * 0.18, capW, capH * 0.06);
    // flip-off top
    const ft = cy - capH + capH * .15;
    const pc = opts.capColor || [70, 84, 104];
    const pg = ctx.createLinearGradient(x - topW / 2, 0, x + topW / 2, 0);
    pg.addColorStop(0, `rgb(${pc[0] * .35},${pc[1] * .35},${pc[2] * .35})`);
    pg.addColorStop(0.2, `rgb(${Math.min(255, pc[0] * 1.9 * lit)},${Math.min(255, pc[1] * 1.9 * lit)},${Math.min(255, pc[2] * 1.9 * lit)})`);
    pg.addColorStop(0.55, `rgb(${pc[0] * .8 * lit + 8},${pc[1] * .8 * lit + 8},${pc[2] * .8 * lit + 8})`);
    pg.addColorStop(1, `rgb(${pc[0] * .3},${pc[1] * .3},${pc[2] * .3})`);
    ctx.fillStyle = pg; roundRect(ctx, x - topW / 2, ft - topH, topW, topH + 2, topW * 0.08); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.18 * lit})`; ctx.fillRect(x - topW / 2 + topW * .06, ft - topH + topH * .12, topW * .88, topH * .1);
    ctx.restore();

    return { neckX: x, neckY: yt - shoulder - neckH * 0.5, neckW, w, top: ft - topH };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- price tag on a string ----------
  // anchor = neck point; tag hangs to (tx,ty) (top-centre of tag), rot in radians
  function drawTag(ctx, anchor, tx, ty, s, rot, lines, opts = {}) {
    const lit = opts.light == null ? 1 : opts.light;
    const tw = 170 * s, th = 96 * s;
    // string
    ctx.save();
    ctx.strokeStyle = `rgba(226,214,190,${0.85 * lit})`; ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.ellipse(anchor.neckX, anchor.neckY, anchor.neckW * 0.53, anchor.neckW * 0.11, 0, 0, Math.PI); ctx.stroke();
    const side = tx < anchor.neckX ? -1 : 1;
    const hX = -tw / 2 + 18 * s;   // hole position in tag space
    const hx = tx + Math.cos(rot) * hX, hy = ty + Math.sin(rot) * hX;
    const sx = anchor.neckX + side * anchor.neckW * .53, sy = anchor.neckY;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + side * 40 * s, sy + 60 * s, hx + (sx - hx) * .2, hy - 30 * s, hx, hy); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(rot);
    // shadow on desk
    ctx.save(); ctx.translate(16 * s, 22 * s); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.filter = `blur(${10 * s}px)`;
    tagPath(ctx, tw, th, s); ctx.fill(); ctx.restore();
    // paper
    const pg = ctx.createLinearGradient(-tw / 2, -th / 2, tw / 2, th / 2);
    pg.addColorStop(0, '#efe5d2'); pg.addColorStop(1, '#cdbf9f');
    ctx.fillStyle = pg; tagPath(ctx, tw, th, s); ctx.fill();
    // fibres
    const r = rng(opts.seed || 3);
    ctx.save(); tagPath(ctx, tw, th, s); ctx.clip();
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(90,70,40,${r() * .07})`; ctx.fillRect(-tw / 2 + r() * tw, -th / 2 + r() * th, r() * 9 * s, .8 * s); }
    ctx.restore();
    // reinforcement ring + hole
    ctx.fillStyle = '#d9cbb0'; ctx.beginPath(); ctx.arc(hX, 0, 9 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(hX, 0, 4 * s, 0, Math.PI * 2); ctx.fill();
    // text
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(28,26,23,.7)';
    ctx.font = `500 ${11 * s}px "Courier 10 Pitch", "Liberation Mono", monospace`;
    ctx.fillText(lines.kicker, -tw / 2 + 36 * s, -th / 2 + 24 * s);
    // stamped price (ink with dropout texture)
    ctx.save();
    ctx.rotate(-0.02);
    ctx.fillStyle = opts.ink || C.accent;
    ctx.font = `700 ${lines.size * s}px "Courier 10 Pitch", "Liberation Mono", monospace`;
    ctx.fillText(lines.price, -tw / 2 + 32 * s, th / 2 - 22 * s);
    ctx.globalCompositeOperation = 'destination-out';
    const r2 = rng((opts.seed || 3) + 99);
    for (let i = 0; i < 220; i++) { ctx.fillStyle = `rgba(0,0,0,${r2() * .6})`; ctx.fillRect(-tw / 2 + 30 * s + r2() * tw * .9, -6 * s + r2() * th * .55, r2() * 3 * s, r2() * 2 * s); }
    ctx.restore();
    // light falloff over the tag
    ctx.fillStyle = `rgba(0,0,0,${0.25 + (1 - lit) * .7})`;
    const lf = ctx.createLinearGradient(-tw / 2, -th / 2, tw / 2, th / 2);
    lf.addColorStop(0, `rgba(0,0,0,${(1 - lit) * .7})`); lf.addColorStop(1, `rgba(0,0,0,${0.35 + (1 - lit) * .6})`);
    ctx.fillStyle = lf; tagPath(ctx, tw, th, s); ctx.fill();
    ctx.restore();
  }
  function tagPath(ctx, tw, th, s) {
    const c = 16 * s;
    ctx.beginPath();
    ctx.moveTo(-tw / 2 + c, -th / 2); ctx.lineTo(tw / 2, -th / 2); ctx.lineTo(tw / 2, th / 2); ctx.lineTo(-tw / 2 + c, th / 2);
    ctx.lineTo(-tw / 2, th / 2 - c); ctx.lineTo(-tw / 2, -th / 2 + c); ctx.closePath();
  }

  // ---------- atmosphere: volumetric beam + dust ----------
  function drawBeam(ctx, t, power = 1) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(300, -100, 1000, 900);
    g.addColorStop(0, `rgba(255,228,190,${0.10 * power})`); g.addColorStop(1, 'rgba(255,228,190,0)');
    ctx.fillStyle = g; ctx.filter = 'blur(45px)';
    ctx.beginPath(); ctx.moveTo(380, -50); ctx.lineTo(760, -50); ctx.lineTo(1500, 1100); ctx.lineTo(300, 1100); ctx.closePath(); ctx.fill(); ctx.filter = 'none';
    const r = rng(42);
    for (let i = 0; i < 140; i++) {
      const bx = r() * 1900, by = r() * 1080, sp = 4 + r() * 10, ph = r() * 6.28;
      const x = bx + Math.sin(t * .3 + ph) * 18, y = (by + t * sp) % 1080;
      // only inside the beam
      const k = (x - 300) / 1200 - y / 1080 * 0.5;
      if (k < 0 || k > .7) continue;
      const a = (0.25 + r() * .5) * power * (1 - k);
      ctx.fillStyle = `rgba(255,240,215,${a})`;
      ctx.beginPath(); ctx.arc(x, y, .6 + r() * 1.6, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- finishing: bloom, vignette, grain, letterbox-free ----------
  function finish(ctx, t, opts = {}) {
    const cv = ctx.canvas;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    // bloom
    if (!cache.bloom) cache.bloom = canvas(W / 4, H / 4);
    const b = cache.bloom.getContext('2d');
    b.clearRect(0, 0, W / 4, H / 4);
    b.filter = 'brightness(1.6) contrast(2.2) blur(6px)';
    b.drawImage(cv, 0, 0, W / 4, H / 4); b.filter = 'none';
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = opts.bloom == null ? 0.35 : opts.bloom;
    ctx.drawImage(cache.bloom, 0, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // vignette
    const v = ctx.createRadialGradient(W * .46, H * .48, H * .25, W / 2, H / 2, H * .95);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    // grain
    const tile = grainTile(Math.floor(t * 30));
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  return { W, H, C, rng, clamp, lerp, ease, easeOut, seg, canvas, applyCamera, drawDesk, drawVial, drawTag, drawBeam, finish, roundRect };
})();
