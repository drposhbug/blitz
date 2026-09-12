// arms.js — first-person arm SPRITES with dynamics. Replaces the procedural arms in render.js when
// assets/arm-left.png + assets/arm-right.png are present (see assets.js); draw() returns false when an
// image is missing so the caller keeps its procedural arms.
//
//   const arms = new ArmSprites();
//   arms.update(dt, { le, lw, re, rw });              // once per frame, dt in ms. Runs the springs.
//   arms.draw(ctx, 'L', { block, hit, t, punching }); // -> true if drawn, false if the image is missing
//   arms.drawPlaceholder(ctx, 'L', opts);             // same transform, capsule + ball (test pages)
//   arms.glove('L')                                   // -> smoothed {x, y, s, vx, vy, speed} for fx
//
// A pose point is {f, u, l} in shoulder widths (f forward, u up, l screen-right), projected exactly like
// Renderer._proj so the glove centre lands on the wrist point the game expects. The sprite is pinned at
// the glove and rotated so its glove->forearm axis points at a shoulder anchor below the bottom corner
// of the screen. Position, rotation and scale are spring-damped (slightly under-damped, so punches snap
// out and settle with a little overshoot).
//
// Depth cues: the glove is scaled by the perspective factor of the wrist point while the forearm is
// drawn as a tapered strip (piecewise-affine, two triangles per strip) whose base keeps the near-camera
// scale, so an extended arm visibly narrows into the screen; a soft ground shadow fades in under the
// glove as it goes out; a cached lighting pass (top-left highlight / lower-right shade, rotated with
// the sprite) plus the hit tint is baked into a 512x768 offscreen copy per side and only re-rendered
// when its inputs move by more than a small epsilon; lateral movement tilts the arm and the arm moving
// inward is drawn on top of the other one.
(function (global) {
  const W = 960, H = 540;
  const DEG = Math.PI / 180;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const GUARD = { le: { f: 0.35, u: -0.3, l: 0 }, lw: { f: 0.55, u: 0.25, l: 0.05 }, re: { f: 0.35, u: -0.3, l: 0 }, rw: { f: 0.55, u: 0.25, l: -0.05 } };

  // Image-space geometry of the 1024x1536 sources, measured from the PNGs' alpha + colour classes:
  //   glove  centre of the fist (all opaque pixels forward of the strap), r = its area radius
  //   strap  centre of the black wrist strap
  //   axis   principal axis of the bare-forearm pixels, glove -> forearm base (image space, y down)
  //   skin   axis distance (from the glove centre) where the strap ends and bare skin begins
  //   exit   the two ends of the cut where the forearm leaves the frame (bottom-left / bottom-right corner)
  //   k      per-side unit scale so both gloves come out the same size (the R art is ~6% larger)
  const GEO = {
    L: { glove: { x: 608, y: 471 }, r: 200, strap: { x: 457, y: 742 }, axis: 116.3 * DEG, skin: 478, exit: [{ x: 0, y: 1272 }, { x: 245, y: 1535 }], k: 1.0 },
    R: { glove: { x: 370, y: 383 }, r: 215, strap: { x: 543, y: 648 }, axis: 62.5 * DEG, skin: 500, exit: [{ x: 1023, y: 1126 }, { x: 791, y: 1535 }], k: 0.94 },
  };
  for (const k in GEO) {
    const g = GEO[k];
    g.ux = Math.cos(g.axis); g.uy = Math.sin(g.axis);                                   // along the axis, toward the base
    g.ax = p => ({ d: (p.x - g.glove.x) * g.ux + (p.y - g.glove.y) * g.uy, e: -(p.x - g.glove.x) * g.uy + (p.y - g.glove.y) * g.ux });
    g.im = (d, e) => ({ x: g.glove.x + g.ux * d - g.uy * e, y: g.glove.y + g.uy * d + g.ux * e });
    g.base = { x: (g.exit[0].x + g.exit[1].x) / 2, y: (g.exit[0].y + g.exit[1].y) / 2 };
    g.len = g.ax(g.base).d;                                                             // glove -> middle of the cut
    g.exitA = g.exit.map(g.ax);                                                         // cut ends in (d, e) axis space
    g.cut = g.r + 5;                                                                    // the taper starts right behind the glove ball
    g.dMax = Math.max(...[[0, 0], [1024, 0], [0, 1536], [1024, 1536]].map(([x, y]) => g.ax({ x, y }).d)) + 10;
    g.E = 330;                                                                          // half-extent across the axis holding every strap/forearm pixel
  }
  const SCALE = 0.40;        // screen px per image px at perspective s = 1 (glove ~230px wide at guard)
  const BASE_S = 1.05;       // perspective factor of the forearm base (near the camera, below the screen)
  const TAPER_MAX = 1.8;     // cap on base/glove scale ratio
  const ROT_GAIN = 0.8;      // how much of the anchor->glove angle the sprite follows
  const ROT_MAX = 38 * DEG;
  const TILT = 6 * DEG;      // lateral (l) tilt, reached at |l| = 0.4
  const MARGIN = 30;         // the forearm's cut edge must stay this far outside the canvas
  // springs: k (1/s^2), damping ratio (< 1 = a little overshoot)
  const SPR = { pos: [2200, 0.70], rot: [1600, 0.80], sc: [1800, 0.65] };

  function proj(side, a) {
    const sgn = side === 'L' ? -1 : 1;
    const f = clamp(a.f, -0.3, 2.5), u = clamp(a.u, -1.2, 1.6), l = clamp(a.l || 0, -1.5, 1.5); // f up to 2.5: full reach deep into the screen
    const bx = W / 2 + sgn * 250 + l * 170, by = H + 30 - (u + 0.35) * 260;
    const t = Math.min(0.88, Math.max(0, f) * 0.36);
    return { x: lerp(bx, W / 2 + l * 60, t), y: lerp(by, 250, t), s: 1 - t * 0.62 };
  }
  function spring(st, xk, vk, target, h, k, zeta) {
    const c = 2 * zeta * Math.sqrt(k);
    const a = k * (target - st[xk]) - c * st[vk];
    st[vk] += a * h; st[xk] += st[vk] * h;
  }
  // affine-map a source triangle onto a destination triangle (both {x,y}[3]) and paint through it.
  // The clip is grown ~0.7px from the triangle's centroid so neighbouring triangles overlap instead of
  // leaving anti-aliased hairline seams.
  function tri(ctx, s, d, paint) {
    const v1x = s[1].x - s[0].x, v1y = s[1].y - s[0].y, v2x = s[2].x - s[0].x, v2y = s[2].y - s[0].y;
    const det = v1x * v2y - v2x * v1y;
    if (Math.abs(det) < 1e-9) return;
    const w1x = d[1].x - d[0].x, w1y = d[1].y - d[0].y, w2x = d[2].x - d[0].x, w2y = d[2].y - d[0].y;
    const a = (w1x * v2y - w2x * v1y) / det, b = (w1y * v2y - w2y * v1y) / det;
    const c = (w2x * v1x - w1x * v2x) / det, dd = (w2y * v1x - w1y * v2x) / det;
    const e = d[0].x - a * s[0].x - c * s[0].y, f = d[0].y - b * s[0].x - dd * s[0].y;
    // grow the clip: push every edge out by GROW px along its normal (vertex = intersection of the two offset edges)
    const GROW = 1.25, area = (d[1].x - d[0].x) * (d[2].y - d[0].y) - (d[2].x - d[0].x) * (d[1].y - d[0].y), sgn = area > 0 ? 1 : -1;
    const nrm = (p, q) => { const ex = q.x - p.x, ey = q.y - p.y, L = Math.hypot(ex, ey) || 1; return { x: sgn * ey / L, y: -sgn * ex / L }; };
    ctx.save(); ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const n1 = nrm(d[(i + 2) % 3], d[i]), n2 = nrm(d[i], d[(i + 1) % 3]);
      const k = GROW / Math.max(0.25, 1 + n1.x * n2.x + n1.y * n2.y);
      const X = d[i].x + (n1.x + n2.x) * k, Y = d[i].y + (n1.y + n2.y) * k;
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, dd, e, f);
    paint(ctx);
    ctx.restore();
  }

  class ArmSprites {
    constructor() {
      this.time = 0; this.lastDt = 16; this._fid = 0;
      this.st = {};
      for (const side of ['L', 'R']) this.st[side] = { init: false, px: 0, py: 0, vx: 0, vy: 0, rot: 0, rv: 0, sc: SCALE, sv: 0, f: 0.5, l: 0, prevF: 0.5, fired: false, squash: 0, blk: 0, stretch: 1, tx: 0, ty: 0, anchor: { x: 0, y: 0 } };
      this._off = {};                       // per-side cached lit/tinted copies
      this._front = 'R';                    // which arm is drawn on top (the one moving inward)
      this._drawnAt = { L: -1, R: -1 };     // frame id each side was last drawn in
      this._queued = null;                  // a deferred draw of the front arm, flushed after the other one
    }

    // ---- dynamics -------------------------------------------------------------------------------
    update(dt, poses) {
      dt = clamp(Number.isFinite(dt) ? dt : 16, 0, 50);
      this.lastDt = dt; this.time += dt; this._fid++;
      poses = poses || GUARD;
      let inward = { L: 0, R: 0 };
      for (const side of ['L', 'R']) {
        const st = this.st[side], g = GEO[side], sgn = side === 'L' ? -1 : 1;
        const el = (side === 'L' ? poses.le : poses.re) || GUARD.le;
        const wr = (side === 'L' ? poses.lw : poses.rw) || GUARD.lw;
        const w = proj(side, wr);
        const u = clamp(wr.u, -1.2, 1.6), l = clamp(wr.l || 0, -1.5, 1.5);
        inward[side] = -sgn * l;
        // shoulder anchor: below the bottom corner on this arm's side, drifting a little with the pose
        const ax = W / 2 + sgn * 400 + l * 40 + clamp(el.l || 0, -1.5, 1.5) * 25;
        const ay = H + 230 - u * 40;
        const tilt = clamp(l * 2.5, -1, 1) * TILT;                                       // lateral movement leans the arm
        const rotT = clamp(wrap(Math.atan2(ay - w.y, ax - w.x) - g.axis) * ROT_GAIN + tilt, -ROT_MAX, ROT_MAX);
        const scT = SCALE * w.s;
        st.tx = w.x; st.ty = w.y; st.f = wr.f; st.l = l; st.anchor.x = ax; st.anchor.y = ay;
        if (!st.init) { st.init = true; st.px = w.x; st.py = w.y; st.rot = rotT; st.sc = scT; st.vx = st.vy = st.rv = st.sv = 0; continue; }
        const n = Math.max(1, Math.ceil(dt / 6)), h = dt / n / 1000;
        for (let i = 0; i < n; i++) {
          spring(st, 'px', 'vx', w.x, h, SPR.pos[0], SPR.pos[1]);
          spring(st, 'py', 'vy', w.y, h, SPR.pos[0], SPR.pos[1]);
          spring(st, 'rot', 'rv', rotT, h, SPR.rot[0], SPR.rot[1]);
          spring(st, 'sc', 'sv', scT, h, SPR.sc[0], SPR.sc[1]);
        }
      }
      // the arm crossing inward goes in front (with hysteresis so the order doesn't flicker at guard)
      if (inward.L > inward.R + 0.06) this._front = 'L'; else if (inward.R > inward.L + 0.06) this._front = 'R';
    }
    // the smoothed on-screen glove point + speed (for callers that want to spawn fx there)
    glove(side) { const st = this.st[side]; return { x: st.px, y: st.py, s: st.sc / SCALE, vx: st.vx, vy: st.vy, speed: Math.hypot(st.vx, st.vy) }; }

    // ---- drawing --------------------------------------------------------------------------------
    draw(ctx, side, opts) {
      const A = global.ASSETS;
      const img = A && A.get ? A.get(side === 'L' ? 'armL' : 'armR') : null;
      if (!img || !img.width) return false;
      if (!this.st.L.init || !this.st.R.init) this.update(0, GUARD);
      opts = opts || {};
      const fid = this._fid, other = side === 'L' ? 'R' : 'L';
      const paint = c => this._paintImage(c, side, img, opts);
      // a front arm left queued from a frame that never drew the other side: draw it now, one frame late
      if (this._queued && this._queued.fid !== fid) { const q = this._queued; this._queued = null; this._render(q.ctx, q.side, q.opts, q.paint); }
      if (side === this._front && this._drawnAt[other] !== fid && !this._queued) {
        this._queued = { fid, ctx, side, opts, paint };
        return true;
      }
      this._render(ctx, side, opts, paint); this._drawnAt[side] = fid;
      const q = this._queued;
      if (q && q.fid === fid && q.side === other) { this._queued = null; this._render(q.ctx, q.side, q.opts, q.paint); this._drawnAt[other] = fid; }
      return true;
    }
    drawPlaceholder(ctx, side, opts) {
      this._render(ctx, side, opts || {}, c => this._paintPlaceholder(c, side, clamp((opts && opts.hit) || 0, 0, 1) * 0.3));
      return true;
    }

    _render(ctx, side, opts, paint) {
      const st = this.st[side], g = GEO[side], sgn = side === 'L' ? -1 : 1, dt = this.lastDt;
      if (!st.init) this.update(0, GUARD);
      // block: eased so the inward twist / lift glides in
      st.blk += ((opts.block ? 1 : 0) - st.blk) * Math.min(1, dt / 110);
      // impact: the punch has reached extension (peak passed, or fully out) -> squash + jitter, once per punch
      const f = st.f;
      if (opts.punching && !st.fired && ((f >= 1.0 && f < st.prevF - 1e-4) || f >= 1.55)) { st.fired = true; st.squash = 80; }
      if (f < 0.8) st.fired = false;
      st.prevF = f;
      st.squash = Math.max(0, st.squash - dt);
      const sqk = st.squash > 0 ? Math.sin((st.squash / 80) * Math.PI) : 0;     // rises and falls over the 80ms
      const sqx = 1 + 0.12 * sqk, sqy = 1 - 0.08 * sqk;
      // idle life: guard breathing, the two arms out of phase
      const t = typeof opts.t === 'number' ? opts.t : this.time;
      const ph = side === 'L' ? 0 : Math.PI;
      const bob = Math.sin(t / 1100 + ph) * 4, sway = Math.sin(t / 1400 + ph * 0.7) * 1.5 * DEG;
      const hit = clamp(opts.hit || 0, 0, 1);
      const jit = (st.squash > 0 ? 3 : 0) + hit * 5;
      const jx = (Math.random() - 0.5) * 2 * jit, jy = (Math.random() - 0.5) * 2 * jit;
      const x = st.px + jx, y = st.py + bob + jy - st.blk * 18;
      const rot = st.rot + sway - sgn * st.blk * 12 * DEG;
      st.drawRot = rot;
      // ---- perspective taper: the glove at the wrist's perspective scale, the forearm base at the near scale
      const scG = st.sc * g.k;
      const scB = Math.min(SCALE * BASE_S * g.k, scG * TAPER_MAX);
      const sOf = d => d <= g.cut ? scG : scG + (scB - scG) * (d - g.cut) / (g.len - g.cut);   // across-axis scale at axis distance d
      const S0 = d => d <= g.cut ? scG * d : scG * d + (scB - scG) * (d - g.cut) * (d - g.cut) / (2 * (g.len - g.cut));   // integral: along-axis screen distance
      // when the glove is high the forearm would end on screen: stretch the bare-forearm piece (never the
      // glove or the strap) so both ends of the image's cut edge stay outside the canvas
      const th = g.axis + rot, sn = Math.sin(th), cs = Math.cos(th);
      let stT = 1;
      const Dskin = S0(g.skin);
      for (const p of g.exitA) {
        const es = p.e * sOf(p.d), ex = -sn * es, ey = cs * es;                     // where this cut end sits across the axis, on screen
        let need = Infinity;
        if (sn > 0.05) need = Math.min(need, (H + MARGIN - y - ey) / sn);
        if (sgn * cs > 0.05) need = Math.min(need, ((sgn > 0 ? W + MARGIN : -MARGIN) - x - ex) / cs);
        const D1 = S0(p.d);
        if (need > D1) stT = Math.max(stT, (need - Dskin) / (D1 - Dskin));
      }
      stT = clamp(stT, 1, 1.8);
      st.stretch += (stT - st.stretch) * Math.min(1, dt / 80);
      const stretch = st.stretch;
      const S = d => d <= g.skin ? S0(d) : Dskin + stretch * (S0(d) - Dskin);
      const loc = (d, e) => { const D = S(d), E = e * sOf(d); return { x: g.ux * D - g.uy * E, y: g.uy * D + g.ux * E }; };   // (d,e) -> sprite-local frame
      const sprite = (cx, cy, nStrips) => {
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(sqx, sqy); ctx.rotate(rot);
        // glove + start of the strap: plain uniform scale, clipped to the glove side of the taper start
        ctx.save();
        const dc = S(g.cut) + 1;
        const P = (a, e) => [g.ux * a - g.uy * e, g.uy * a + g.ux * e];
        ctx.beginPath(); ctx.moveTo(...P(dc, -4000)); ctx.lineTo(...P(dc, 4000)); ctx.lineTo(...P(dc - 6000, 4000)); ctx.lineTo(...P(dc - 6000, -4000)); ctx.closePath(); ctx.clip();
        ctx.scale(scG, scG); ctx.translate(-g.glove.x, -g.glove.y); paint(ctx);
        ctx.restore();
        // forearm: tapered strips, each a trapezoid = two affine triangles (exact along the strip edges)
        const bounds = [g.cut, g.skin];
        for (let i = 1; i < nStrips; i++) bounds.push(g.skin + (g.dMax - g.skin) * i / (nStrips - 1));
        for (let i = 0; i + 1 < bounds.length; i++) {
          const d0 = bounds[i], d1 = bounds[i + 1], E = g.E;
          const s = [g.im(d0, -E), g.im(d0, E), g.im(d1, E), g.im(d1, -E)];
          const d = [loc(d0, -E), loc(d0, E), loc(d1, E), loc(d1, -E)];
          tri(ctx, [s[0], s[1], s[2]], [d[0], d[1], d[2]], paint);
          tri(ctx, [s[0], s[2], s[3]], [d[0], d[2], d[3]], paint);
        }
        ctx.restore();
      };
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // ground shadow under the glove, fading in as the arm goes out and shrinking with distance
      const ext = clamp((f - 0.6) / 0.9, 0, 1);
      if (ext > 0.01) {
        const R = g.r * scG, sh = st.sc / SCALE;
        // offset inward (toward the opponent's centre) so it peeks out from behind the forearm, which comes in from the outer corner
        const shx = x - sgn * R * 0.55, shy = y + R * (1.05 + 0.25 * ext);
        ctx.save(); ctx.translate(shx, shy); ctx.scale(R * 1.3 * sh, R * 0.48 * sh);
        const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        const a = 0.34 * ext;
        sg.addColorStop(0, `rgba(0,0,0,${a})`); sg.addColorStop(0.5, `rgba(0,0,0,${a * 0.55})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // motion blur: ghosts trailing behind along the velocity, farthest first
      const speed = Math.hypot(st.vx, st.vy);
      const bs = clamp((speed - 450) / 1100, 0, 1);
      if (bs > 0) for (const [k, a] of [[3, 0.1], [2, 0.2], [1, 0.35]]) {
        ctx.globalAlpha = a * bs; sprite(x - st.vx * 0.014 * k, y - st.vy * 0.014 * k, 2);
      }
      ctx.globalAlpha = 1; sprite(x, y, 4);
      ctx.restore();
    }
    // the lit + tinted copy: 512x768 per side, re-rendered only when hit / light direction move enough
    _lit(side, img, hit, rot) {
      const g = GEO[side];
      let o = this._off[side];
      if (!o) { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 768; o = this._off[side] = { cv, c: cv.getContext('2d'), hit: -9, rot: 1e9, img: null }; }
      if (o.img === img && Math.abs(hit - o.hit) <= 0.02 && Math.abs(wrap(rot - o.rot)) <= 2.5 * DEG) return o.cv;
      o.img = img; o.hit = hit; o.rot = rot;
      const c = o.c;
      c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, 512, 768);
      c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, 512, 768);
      c.globalCompositeOperation = 'source-atop';
      // light from the screen's top-left, expressed in image space (the sprite is rotated by rot on screen)
      const la = Math.atan2(-0.8, -0.6) - rot, lx = Math.cos(la), ly = Math.sin(la);
      const gx = g.glove.x / 2, gy = g.glove.y / 2;
      const lg = c.createLinearGradient(gx + lx * 360, gy + ly * 360, gx - lx * 360, gy - ly * 360);
      lg.addColorStop(0, 'rgba(255,255,255,0.17)'); lg.addColorStop(0.45, 'rgba(255,255,255,0)');
      lg.addColorStop(0.55, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.30)');
      c.fillStyle = lg; c.fillRect(0, 0, 512, 768);
      // a soft specular on the glove ball
      const sx = gx + lx * g.r * 0.22, sy = gy + ly * g.r * 0.22;
      const rg = c.createRadialGradient(sx, sy, 0, sx, sy, g.r * 0.42);
      rg.addColorStop(0, 'rgba(255,255,255,0.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.fillRect(0, 0, 512, 768);
      if (hit > 0.005) { c.globalAlpha = 0.3 * hit; c.fillStyle = '#d23a2a'; c.fillRect(0, 0, 512, 768); }
      c.restore();
      return o.cv;
    }
    _paintImage(ctx, side, img, opts) {
      const lit = this._lit(side, img, clamp(opts.hit || 0, 0, 1), this.st[side].drawRot || 0);
      ctx.drawImage(lit, 0, 0, 1024, 1536);
    }
    _paintPlaceholder(ctx, side, tint) {
      const g = GEO[side];
      const dx = g.base.x - g.glove.x, dy = g.base.y - g.glove.y, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      ctx.save(); ctx.lineCap = 'round';
      // forearm capsule from the glove to where it leaves the frame (cut flat there, like the image)
      ctx.strokeStyle = '#e8b284'; ctx.lineWidth = 230; ctx.beginPath(); ctx.moveTo(g.glove.x + ux * 120, g.glove.y + uy * 120); ctx.lineTo(g.base.x - ux * 115, g.base.y - uy * 115); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(g.base.x - ux * 120, g.base.y - uy * 120); ctx.lineTo(g.base.x, g.base.y); ctx.stroke(); ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(60,20,0,0.35)'; ctx.lineWidth = 60; ctx.beginPath(); ctx.moveTo(g.glove.x + ux * 200 + uy * 80, g.glove.y + uy * 200 - ux * 80); ctx.lineTo(g.base.x + uy * 80 - ux * 30, g.base.y - ux * 80 - uy * 30); ctx.stroke();
      // wrist strap
      ctx.strokeStyle = '#151518'; ctx.lineWidth = 90; ctx.beginPath(); ctx.moveTo(g.strap.x - ux * 60, g.strap.y - uy * 60); ctx.lineTo(g.strap.x + ux * 60, g.strap.y + uy * 60); ctx.stroke();
      // glove ball
      const gg = ctx.createRadialGradient(g.glove.x - g.r * 0.35, g.glove.y - g.r * 0.4, g.r * 0.1, g.glove.x, g.glove.y, g.r);
      gg.addColorStop(0, '#e04a3a'); gg.addColorStop(0.55, '#a51f17'); gg.addColorStop(1, '#5c120b');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(g.glove.x, g.glove.y, g.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(g.glove.x, g.glove.y, g.r * 0.7, 0.4, 2.2); ctx.stroke();
      if (tint > 0.005) {
        ctx.globalAlpha = tint; ctx.fillStyle = '#d23a2a';
        ctx.beginPath(); ctx.arc(g.glove.x, g.glove.y, g.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d23a2a'; ctx.lineWidth = 230; ctx.beginPath(); ctx.moveTo(g.glove.x + ux * 120, g.glove.y + uy * 120); ctx.lineTo(g.base.x - ux * 115, g.base.y - uy * 115); ctx.stroke();
      }
      ctx.restore();
    }
  }
  ArmSprites.GEO = GEO; ArmSprites.SCALE = SCALE; ArmSprites.proj = proj;
  global.ArmSprites = ArmSprites;
})(typeof window !== 'undefined' ? window : globalThis);
