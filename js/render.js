// render.js — first-person canvas renderer: a 360° stage around an octagon cage seen through your
// eyes, DOGE in front of you scaled by distance, your own arms and fists in the foreground driven by
// your real arms, plus lighting, film grain and the fight HUD. Textures come from textures.js.
(function (global) {
  const W = 960, H = 540;
  const HZ = 240; // horizon
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const FONT = 'Bahnschrift, "Oswald", "Arial Narrow", "Segoe UI", sans-serif';
  const UI = '"Segoe UI", Barlow, system-ui, sans-serif';
  const COL = {
    bone: '#e8e4dc', ink: '#0f1012', fog: '#8c9199', red: '#c8281e', gold: '#d4a13a', good: '#e8e4dc', bad: '#ff5a4a', meh: '#d4a13a', super: '#f0cc70',
    doge: '#d9a55a', dogeDark: '#a8763a', cream: '#f2e2c4', glove: '#a51f17', gloveDark: '#5c120b',
    skin: '#e8b284', skinDark: '#b8784a', skinLight: '#f6cfa6', mma: '#1c1c22', mmaTrim: '#c8281e', wrap: '#e8e4dc',
  };
  const GUARD = { le: { f: 0.35, u: -0.3, l: 0 }, lw: { f: 0.55, u: 0.25, l: 0.05 }, re: { f: 0.35, u: -0.3, l: 0 }, rw: { f: 0.55, u: 0.25, l: -0.05 } };

  // a point on the ring floor at (fwd, lat) relative to your eyes -> screen
  function project(fwd, lat) {
    const sc = 0.72 / (Math.max(0.05, fwd) + 0.32);
    return { sx: W / 2 + lat * 600 * sc, sy: HZ + 230 * sc, sc };
  }
  const T = (ctx, n) => global.TEX.pattern(ctx, n);

  class Renderer {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      canvas.width = W; canvas.height = H;
      this.t = 0; this.floats = []; this.ann = null; this.sub = null; this.hint = null; this.shakeAmt = 0;
      this.flashC = null; this.flashAge = 0; this.superAge = 1e9; this.hitAge = 1e9; this.hitHand = 'R';
      this.hpLagP = 100; this.hpLagN = 100;
      this.pos = { player: { x: W / 2, y: 380 }, npc: { x: W / 2, y: 180 } };
      this.crowd = []; for (let i = 0; i < 220; i++) this.crowd.push({ a: i * TAU / 220 + ((i * 0.37) % 1) * 0.02, row: i % 3, r: 7 + ((i * 7) % 5), p: (i * 1.7) % TAU, h: (i * 0.37) % 1 });
      this.stars = [0, 1, 2, 3, 4];
      this.arenaIdx = 0; this.pstate = {};
      this.grainOff = 0;
    }
    setArena(i) { const list = global.ARENAS || []; this.arenaIdx = ((i % list.length) + list.length) % list.length; this.pstate = {}; }
    get arena() { return (global.ARENAS || [])[this.arenaIdx]; }

    // ----- fx API (called by main from fight events) -----
    announce(text, kind, big, sub) { const a = { text, kind: kind || 'good', age: 0, life: big ? 1900 : 950, big: !!big }; if (sub) this.sub = a; else this.ann = a; }
    float(text, side, kind) {
      const p = this.pos[side === 'npc' ? 'npc' : 'player'];
      this.floats.push({ text, x: p.x + (Math.random() - 0.5) * 120, y: p.y - 30 - Math.random() * 30, vy: -0.05 - Math.random() * 0.03, vx: (Math.random() - 0.5) * 0.04, age: 0, life: 1300, kind: kind || 'good', rot: (Math.random() - 0.5) * 0.3, size: kind === 'super' ? 60 : 26 + Math.random() * 10 });
    }
    shake(amt) { this.shakeAmt = Math.max(this.shakeAmt, amt); }
    flash(color) { this.flashC = color; this.flashAge = 0; }
    setHint(text, dur) { this.hint = { text, until: this.t + dur }; }
    superFx() { this.superAge = 0; }
    playerPunch() {}
    playerHit(hand) { this.hitAge = 0; this.hitHand = hand; }

    // ----- main draw -----
    draw(dt, v) {
      this.t += dt;
      const ctx = this.ctx, t = this.t;
      const f = v.fight;
      this.shakeAmt *= Math.pow(0.02, dt / 1000);
      this.hitAge += dt;
      const hit = this.hitAge < 260 ? 1 - this.hitAge / 260 : 0;
      const walk = v.walk || { phase: 0, speed: 0 };
      const crouch = clamp(v.crouch || 0, 0, 1);
      const yaw = f ? f.player.yaw : t / 7000; // attract mode slowly looks around
      const cam = { yaw, t, W, H, HZ };
      const rel = f ? f.rel : { fwd: 1.1, lat: 0 };
      const sx = (Math.random() - 0.5) * this.shakeAmt * 2, sy = (Math.random() - 0.5) * this.shakeAmt * 2;
      ctx.save();
      ctx.translate(W / 2 + sx, H / 2 + sy);
      ctx.rotate(hit * (this.hitHand === 'L' ? 0.06 : -0.06));
      ctx.translate(-W / 2, -H / 2 + crouch * 95 + Math.abs(Math.sin(walk.phase)) * 7 * walk.speed - hit * 20);
      this.world(cam, v, f);
      const N = f ? f.npc : { state: 'idle', vx: 0, vz: 0, hurtT: -1e9 };
      this.lastDt = dt;
      if (rel.fwd > -0.1) { if (global.Opponent) this.opponent(N, rel, f, v); else this.doge(N, rel, f, v); }
      const ar = this.arena; if (ar) { if (ar.near) ar.near(ctx, cam); if (ar.particles) ar.particles(ctx, cam, dt, this.pstate); }
      ctx.restore();
      ctx.save(); ctx.translate(sx, sy);
      if (!v.noArms) this.arms(v, f);
      ctx.restore();
      this.post(dt, v);
      this.overlays(dt, v);
      if (f && !v.noHud) this.hud(dt, f, v);
    }

    // ---------- THE 360° WORLD: sky, stage, crowd, mesh, cage, mat ----------
    world(cam, v, f) {
      const ctx = this.ctx, t = cam.t, yaw = cam.yaw;
      const ar = this.arena;
      const P = f ? f.player : { x: 0, z: -0.55 };
      const RING = global.ARENA ? global.ARENA.RING : 1.7;
      // image stages paint everything themselves, sky through floor: no crowd, mesh, cage or mat
      if (ar && ar.full) { ar.draw(ctx, cam, P); return; }
      if (ar) { ar.sky(ctx, cam); ar.far(ctx, cam); ar.mid(ctx, cam); }
      else { ctx.fillStyle = '#1a1a1e'; ctx.fillRect(0, -200, W, HZ + 200); }
      // the stands: a dark tier the crowd sits on
      const stands = ctx.createLinearGradient(0, HZ - 130, 0, HZ - 60); stands.addColorStop(0, 'rgba(8,6,10,0)'); stands.addColorStop(1, 'rgba(8,6,10,0.92)');
      ctx.fillStyle = stands; ctx.fillRect(-60, HZ - 130, W + 120, 70);
      const excited = f && (f.npc.state === 'stun' || f.over) ? 1 : 0.35;
      const hue = ar ? ar.crowdHue : 30;
      for (const c of this.crowd) {
        const x = global.arenaSx(cam, c.a, 0.1); if (x === null) continue;
        const bob = Math.sin(t / 260 + c.p) * 4 * excited;
        const y = HZ - 64 - c.row * 13 + bob, r = c.r * (1 - c.row * 0.12);
        ctx.fillStyle = `hsl(${hue + c.h * 40},18%,${10 + c.h * 10}%)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); // head
        ctx.fillRect(x - r * 1.6, y + r * 0.6, r * 3.2, r * 1.6); // shoulders
        if (c.h > 0.9) { ctx.fillStyle = 'rgba(210,225,255,0.7)'; ctx.fillRect(x - 1, y - r * 2.2, 3, 4); }
      }
      // cage apron/base
      ctx.fillStyle = '#121014'; ctx.fillRect(-60, HZ - 60, W + 120, 74);
      // the mat: canvas texture in bands so it foreshortens
      const matName = ar ? ar.mat : 'mat';
      let yy = HZ + 14, band = 8, k = 0;
      while (yy < H + 160) {
        const s = 0.35 + k * 0.16;
        ctx.save(); ctx.translate(0, yy); ctx.scale(s * 1.6, s); ctx.fillStyle = T(ctx, matName); ctx.fillRect(-60 / (s * 1.6), 0, (W + 120) / (s * 1.6), band / s + 1); ctx.restore();
        yy += band; band = Math.round(band * 1.32); k++;
      }
      // mat lighting: spot in the middle, dark edges
      const spot = ctx.createRadialGradient(W / 2, HZ + 190, 40, W / 2, HZ + 190, 620);
      spot.addColorStop(0, 'rgba(255,245,225,0.16)'); spot.addColorStop(0.5, 'rgba(0,0,0,0)'); spot.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = spot; ctx.fillRect(-60, HZ + 14, W + 120, H + 200);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-60, HZ + 14, W + 120, 3);
      // faded centre logo + octagon edge on the mat, projected
      const toScr = (wx, wz) => { const dx = wx - P.x, dz = wz - P.z, s = Math.sin(yaw), c = Math.cos(yaw); const fwd = dx * s + dz * c, lat = dx * c - dz * s; if (fwd < -0.05) return null; const p = project(fwd, lat); return [p.sx, p.sy, p.sc]; };
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.beginPath(); let started = false;
      for (let i = 0; i <= 8; i++) { const a = i * TAU / 8 + Math.PI / 8; const q = toScr(Math.sin(a) * RING * 0.98, Math.cos(a) * RING * 0.98); if (!q) { started = false; continue; } if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.restore();
      const cen = toScr(0, 0);
      if (cen) { ctx.save(); ctx.translate(cen[0], cen[1]); ctx.scale(cen[2] * 1.4, cen[2] * 0.4); ctx.rotate(-yaw * 0); ctx.font = `700 120px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(120,30,20,0.18)'; ctx.fillText('BLITZ', 0, 40); ctx.strokeStyle = 'rgba(120,30,20,0.18)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 210, 0, TAU); ctx.stroke(); ctx.restore(); }
      // chain-link mesh between you and the crowd, with the octagon's posts and rails
      ctx.save(); ctx.globalAlpha = 0.9; ctx.translate(((yaw * 560) % 32 + 32) % 32 * -1, 0); ctx.fillStyle = T(ctx, 'chainlink'); ctx.fillRect(-60, HZ - 112, W + 200, 126); ctx.restore();
      const rail = (y, h, top) => { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, top ? '#7a1d16' : '#2a2a30'); g.addColorStop(0.5, top ? '#4d100c' : '#151518'); g.addColorStop(1, top ? '#2e0906' : '#0a0a0c'); ctx.fillStyle = g; ctx.fillRect(-60, y, W + 120, h); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-60, y, W + 120, 2); };
      rail(HZ - 118, 12, true); rail(HZ + 6, 10, false);
      for (let k2 = 0; k2 < 8; k2++) {
        const a = Math.PI / 8 + k2 * TAU / 8, x = global.arenaSx(cam, a, 0.6); if (x === null) continue;
        const g = ctx.createLinearGradient(x - 9, 0, x + 9, 0); g.addColorStop(0, '#0c0c0e'); g.addColorStop(0.4, '#34343a'); g.addColorStop(1, '#0a0a0c');
        ctx.fillStyle = g; ctx.fillRect(x - 9, HZ - 124, 18, 142);
        ctx.fillStyle = '#5c120b'; ctx.fillRect(x - 10, HZ - 124, 20, 8);
      }
    }

    // ---------- DOGE, front view, scaled by distance ----------
    // ---------- SOL, the human boxer: cutout rig from opponent.js, front view, scaled by distance ----------
    opponent(N, rel, f, v) {
      const ctx = this.ctx, t = this.t;
      const { sx, sy, sc } = project(rel.fwd, rel.lat);
      const inR = f ? f.inRange() : false;
      ctx.save(); ctx.globalAlpha = inR ? 0.85 : 0.3; ctx.strokeStyle = inR ? COL.gold : '#8c9199'; ctx.lineWidth = 3; ctx.setLineDash(inR ? [] : [8, 8]);
      ctx.beginPath(); ctx.ellipse(sx, sy + 6 * sc, 190 * sc, 42 * sc, 0, 0, TAU); ctx.stroke(); ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(sx, sy + 4 * sc, 140 * sc, 30 * sc, 0, 0, TAU); ctx.fill();
      this.pos.npc = { x: sx, y: sy - 400 * sc };
      if (!this.rig) this.rig = new global.Opponent();
      const atk = N.attack;
      // where her striking glove must end up: at YOUR face (screen centre), big
      const scrY = { jab: 300, body: 430, hookL: 300, hookR: 300, overhead: 250, uppercut: 240 }[atk] || 300;
      const s = sc * 1.02; // she is 400 units tall: life-size against your gloves (head top ≈ y 60 at punching range)
      const target = { x: (W / 2 - sx) / s, y: (scrY - sy) / s, r: 120 / s };
      ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s);
      const out = this.rig.draw(ctx, { t, dt: this.lastDt || 16, state: N.state, attack: atk, prog: f ? f.npcProgress : 0, hurtAge: f ? f.t - N.hurtT : 1e9, hurtHand: N.hurtHand || 'R', walking: clamp(Math.hypot(N.vx || 0, N.vz || 0) / 0.8, 0, 1), target, inRange: inR });
      ctx.restore();
      if (out && out.cue && N.state === 'windup' && atk) {
        const a = global.ATTACKS[atk], prog = f ? f.npcProgress : 0;
        const cx = sx + out.cue.x * s, cy = sy + out.cue.y * s, cr = out.cue.r * s, col = a && a.blockable ? COL.red : COL.gold;
        ctx.save(); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.lineWidth = 3;
        const r = cr + 10 + (1 - prog) * 60; ctx.globalAlpha = 0.4 + prog * 0.6;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, cr * prog, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    doge(N, rel, f, v) {
      const ctx = this.ctx, t = this.t;
      const { sx, sy, sc } = project(rel.fwd, rel.lat);
      const st = N.state, atk = N.attack ? global.ATTACKS[N.attack] : null;
      const prog = f ? f.npcProgress : 0;
      const hurtAge = f ? f.t - N.hurtT : 1e9;
      const inR = f ? f.inRange() : false;
      ctx.save(); ctx.globalAlpha = inR ? 0.85 : 0.3; ctx.strokeStyle = inR ? COL.gold : '#8c9199'; ctx.lineWidth = 3; ctx.setLineDash(inR ? [] : [8, 8]);
      ctx.beginPath(); ctx.ellipse(sx, sy + 6 * sc, 150 * sc, 34 * sc, 0, 0, TAU); ctx.stroke(); ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(sx, sy + 4 * sc, 110 * sc, 24 * sc, 0, 0, TAU); ctx.fill();
      this.pos.npc = { x: sx, y: sy - 330 * sc };

      let rot = 0, squash = 1, dy = 0, dxo = 0;
      let eyes = 'doge', mouth = 'smug';
      let gl = { x: -70, y: -190, r: 36 }, gr = { x: 70, y: -190, r: 36 };
      if (hurtAge < 220) { const k = 1 - hurtAge / 220; squash = 1 - 0.15 * k; rot = (N.hurtHand === 'L' ? 1 : -1) * 0.22 * k; dxo = (N.hurtHand === 'L' ? 1 : -1) * 22 * k; eyes = 'ouch'; mouth = 'ouch'; }
      if (st === 'stun') { eyes = 'dizzy'; mouth = 'dizzy'; rot = Math.sin(t / 120) * 0.12; dy = 14; gl = { x: -100, y: -130, r: 36 }; gr = { x: 100, y: -130, r: 36 }; }
      if (st === 'hurt') { eyes = 'ouch'; mouth = 'ouch'; }
      if (st === 'ko') { rot = 1.45; dy = -40; dxo = 60; eyes = 'x'; mouth = 'tongue'; }
      if (st === 'taunt') { dy = Math.abs(Math.sin(t / 180)) * -30; gl = { x: -90, y: -330, r: 36 }; gr = { x: 90, y: -330, r: 36 }; eyes = 'wink'; mouth = 'grin'; }
      let cue = null, big = false;
      if (atk && (st === 'windup' || st === 'strike' || (st === 'recover' && N.attack))) {
        const g = atk.hand === 'L' ? gr : gl;
        const sgn = atk.hand === 'L' ? 1 : -1;
        const pull = { jab: { x: 45 * sgn, y: -170 }, body: { x: 45 * sgn, y: -130 }, hookL: { x: 200 * sgn, y: -210 }, hookR: { x: 200 * sgn, y: -210 }, overhead: { x: 30 * sgn, y: -380 }, uppercut: { x: 45 * sgn, y: -80 } }[N.attack];
        const scrY = { jab: 300, body: 430, hookL: 300, hookR: 300, overhead: 250, uppercut: 240 }[N.attack];
        const target = { x: (W / 2 - sx) / sc, y: (scrY - sy) / sc, r: 120 / sc };
        if (st === 'windup') {
          const k = ease(Math.min(1, prog * 1.2));
          g.x = lerp(g.x, pull.x, k); g.y = lerp(g.y, pull.y, k); g.r = 36 + Math.sin(t / 60) * 3 * prog;
          eyes = 'angry'; mouth = 'grr'; dxo += (Math.random() - 0.5) * 6 * prog * prog;
          cue = { x: sx + (g.x + dxo) * sc, y: sy + (g.y + dy) * sc, r: g.r * sc, prog, col: atk.blockable ? COL.red : COL.gold };
        } else if (st === 'strike') {
          const k = ease(prog);
          g.x = lerp(pull.x, target.x, k); g.y = lerp(pull.y, target.y, k); g.r = lerp(36, target.r, k);
          eyes = 'angry'; mouth = 'grr'; big = true;
        } else {
          const k = ease(prog);
          g.x = lerp(target.x, sgn * 70, k); g.y = lerp(target.y, -190, k); g.r = lerp(target.r, 36, k); big = k < 0.6;
        }
      }
      if (st === 'idle' || st === 'intro' || st === 'recover') { gl.y += Math.sin(t / 200) * 5; gr.y += Math.cos(t / 200) * 5; }
      const walking = clamp(Math.hypot(N.vx || 0, N.vz || 0) / 0.8, 0, 1);

      ctx.save(); ctx.translate(sx, sy); ctx.scale(sc, sc); ctx.translate(dxo, dy); ctx.rotate(rot); ctx.scale(1, squash);
      const furFill = (x, y, w, h) => { ctx.save(); ctx.translate(x, y); ctx.scale(0.5, 0.5); ctx.fillStyle = T(ctx, 'fur'); ctx.fillRect(0, 0, w * 2, h * 2); ctx.restore(); };
      // legs + sneakers
      for (const s of [-1, 1]) {
        const lift = Math.max(0, s * Math.sin(t / 90)) * 10 * walking;
        ctx.save(); ctx.beginPath(); ctx.roundRect(s * 34 - 13, -84, 26, 78 - lift, 13); ctx.clip(); furFill(s * 34 - 13, -84, 26, 80); ctx.fillStyle = s < 0 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)'; ctx.fillRect(s * 34 - 13, -84, 26, 80); ctx.restore();
        ctx.fillStyle = '#e9e6e0'; ctx.beginPath(); ctx.ellipse(s * 42, -lift - 6, 25, 11, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c8281e'; ctx.beginPath(); ctx.ellipse(s * 42, -lift - 8, 12, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(s * 42, -lift - 2, 25, 4, 0, 0, TAU); ctx.fill();
      }
      // hoodie with fabric shading + shorts with sheen
      const hood = ctx.createLinearGradient(-78, -230, 78, -80); hood.addColorStop(0, '#3b3446'); hood.addColorStop(0.5, '#2a2436'); hood.addColorStop(1, '#171320');
      ctx.fillStyle = hood; ctx.beginPath(); ctx.roundRect(-78, -230, 156, 150, 34); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-20, -226); ctx.lineTo(-24, -170); ctx.moveTo(20, -226); ctx.lineTo(24, -170); ctx.stroke();
      const shorts = ctx.createLinearGradient(-72, -110, 72, -66); shorts.addColorStop(0, '#8a1d16'); shorts.addColorStop(0.5, '#c8281e'); shorts.addColorStop(1, '#6d150f');
      ctx.fillStyle = shorts; ctx.beginPath(); ctx.roundRect(-72, -110, 144, 44, 12); ctx.fill();
      ctx.fillStyle = COL.gold; ctx.fillRect(-72, -110, 144, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `700 16px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('WOW', 0, -80);
      const drawArm = g => { ctx.save(); ctx.strokeStyle = COL.doge; ctx.lineWidth = 24; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(g.x > 0 ? 58 : -58, -200); ctx.lineTo(g.x, g.y); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo((g.x > 0 ? 58 : -58) + 6, -196); ctx.lineTo(g.x + 6, g.y + 4); ctx.stroke(); ctx.restore(); };
      const drawGlove = g => {
        const gg = ctx.createRadialGradient(g.x - g.r * 0.35, g.y - g.r * 0.4, g.r * 0.1, g.x, g.y, g.r);
        gg.addColorStop(0, '#e04a3a'); gg.addColorStop(0.5, COL.glove); gg.addColorStop(1, COL.gloveDark);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(g.x + 5, g.y + 7, g.r, 0, TAU); ctx.fill();
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 0.72, 0.4, 2.2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(g.x - g.r * 0.35, g.y - g.r * 0.4, g.r * 0.3, g.r * 0.18, -0.6, 0, TAU); ctx.fill();
        ctx.fillStyle = COL.cream; ctx.beginPath(); ctx.roundRect(g.x - g.r * 0.5, g.y + g.r * 0.55, g.r, g.r * 0.35, 6); ctx.fill();
      };
      const gA = atk && atk.hand === 'L' ? gr : gl, gB = atk && atk.hand === 'L' ? gl : gr;
      drawArm(gB); drawGlove(gB);
      if (!big) { drawArm(gA); drawGlove(gA); }
      // head: fur texture under a soft shading gradient
      const hy = -300, hr = 68;
      ctx.fillStyle = COL.dogeDark;
      [[-1], [1]].forEach(([s]) => { ctx.beginPath(); ctx.moveTo(s * 30, hy - hr + 10); ctx.lineTo(s * 78, hy - hr - 40); ctx.lineTo(s * 66, hy - hr + 40); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e9c4a0'; ctx.beginPath(); ctx.moveTo(s * 40, hy - hr + 8); ctx.lineTo(s * 70, hy - hr - 24); ctx.lineTo(s * 62, hy - hr + 24); ctx.closePath(); ctx.fill(); ctx.fillStyle = COL.dogeDark; });
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, hy, hr + 6, hr, 0, 0, TAU); ctx.clip(); furFill(-hr - 6, hy - hr, (hr + 6) * 2, hr * 2);
      const hs = ctx.createRadialGradient(-20, hy - 30, 10, 0, hy, hr + 10); hs.addColorStop(0, 'rgba(255,240,210,0.35)'); hs.addColorStop(0.6, 'rgba(0,0,0,0)'); hs.addColorStop(1, 'rgba(60,30,0,0.45)'); ctx.fillStyle = hs; ctx.fillRect(-hr - 6, hy - hr, (hr + 6) * 2, hr * 2); ctx.restore();
      // cheek fur tufts
      ctx.fillStyle = COL.doge; for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(s * (hr - 2), hy + 10 + k * 12); ctx.lineTo(s * (hr + 14), hy + 16 + k * 12); ctx.lineTo(s * (hr - 6), hy + 22 + k * 12); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = COL.cream; ctx.beginPath(); ctx.ellipse(0, hy + 22, 44, 36, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-30, hy - 8, 20, 14, 0, 0, TAU); ctx.ellipse(30, hy - 8, 20, 14, 0, 0, TAU); ctx.fill();
      const eye = (ex, ey) => {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, 13, 11, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(ex, ey, 13, 11, 0, 0, TAU); ctx.stroke();
        if (eyes === 'doge') { const ig = ctx.createRadialGradient(ex + 5, ey + 1, 1, ex + 5, ey + 1, 7); ig.addColorStop(0, '#6a4a2a'); ig.addColorStop(0.6, '#1a1a1a'); ig.addColorStop(1, '#000'); ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ex + 5 + Math.sin(t / 900) * 2, ey + 1, 7, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 7, ey - 2, 2.5, 0, TAU); ctx.fill(); }
        else if (eyes === 'angry') { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(ex, ey + 2, 8, 0, TAU); ctx.fill(); const sg = ex < 0 ? 1 : -1; ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ex - 16 * sg, ey - 24); ctx.lineTo(ex + 14 * sg, ey - 13); ctx.stroke(); }
        else if (eyes === 'ouch') { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(ex, ey - 2, 4, 0, TAU); ctx.fill(); }
        else if (eyes === 'dizzy') { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5; ctx.beginPath(); for (let a = 0; a < 12; a += 0.3) { const r = a * 0.8; ctx.lineTo(ex + Math.cos(a + t / 150) * r, ey + Math.sin(a + t / 150) * r); } ctx.stroke(); }
        else if (eyes === 'x') { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 8, ey - 8); ctx.lineTo(ex + 8, ey + 8); ctx.moveTo(ex + 8, ey - 8); ctx.lineTo(ex - 8, ey + 8); ctx.stroke(); }
        else if (eyes === 'wink') { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(ex + 4, ey, 7, 0, TAU); ctx.fill(); }
      };
      eye(-30, hy - 10); eye(30, hy - 10);
      const ng = ctx.createRadialGradient(-3, hy + 15, 1, 0, hy + 18, 11); ng.addColorStop(0, '#3a3a3a'); ng.addColorStop(1, '#0a0a0a'); ctx.fillStyle = ng; ctx.beginPath(); ctx.ellipse(0, hy + 18, 11, 8, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
      const my = hy + 36;
      if (mouth === 'smug') { ctx.moveTo(-14, my); ctx.quadraticCurveTo(0, my + 10, 16, my - 2); }
      else if (mouth === 'grr') { ctx.moveTo(-18, my + 4); ctx.lineTo(-8, my - 2); ctx.lineTo(0, my + 4); ctx.lineTo(8, my - 2); ctx.lineTo(18, my + 4); }
      else if (mouth === 'ouch' || mouth === 'dizzy') { ctx.moveTo(-10, my + 4); ctx.quadraticCurveTo(0, my - 6, 10, my + 4); }
      else if (mouth === 'grin') { ctx.moveTo(-18, my - 2); ctx.quadraticCurveTo(0, my + 18, 18, my - 2); }
      else if (mouth === 'tongue') { ctx.moveTo(-10, my + 2); ctx.lineTo(10, my + 2); }
      ctx.stroke();
      if (mouth === 'tongue') { ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.ellipse(6, my + 10, 8, 12, 0.3, 0, TAU); ctx.fill(); }
      if (st === 'stun') {
        ctx.fillStyle = COL.gold; ctx.shadowColor = COL.gold; ctx.shadowBlur = 12; ctx.font = `700 22px ${FONT}`; ctx.textAlign = 'center';
        for (const i of this.stars) { const a = t / 300 + i * 1.26; ctx.fillText('*', Math.cos(a) * 85, hy - hr - 10 + Math.sin(a) * 18); }
        ctx.shadowBlur = 0;
      }
      if (big) { drawArm(gA); drawGlove(gA); }
      ctx.restore();

      if (cue) {
        ctx.save(); ctx.strokeStyle = cue.col; ctx.shadowColor = cue.col; ctx.shadowBlur = 18; ctx.lineWidth = 3;
        const r = cue.r + 10 + (1 - cue.prog) * 60; ctx.globalAlpha = 0.4 + cue.prog * 0.6;
        ctx.beginPath(); ctx.arc(cue.x, cue.y, r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(cue.x, cue.y, cue.r * cue.prog, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    // ---------- YOUR ARMS (first person) ----------
    arms(v, f) {
      const inp = v.input || {};
      const arms = v.arms || GUARD;
      const hit = this.hitAge < 260 ? 1 - this.hitAge / 260 : 0;
      this.pos.player = { x: W / 2, y: 330 };
      // real arm images with spring dynamics when the PNGs are present; procedural arms otherwise
      if (global.ArmSprites) {
        if (!this.sprites) this.sprites = new global.ArmSprites();
        this.sprites.update(this.lastDt || 16, arms);
        const punching = !!(f && f.t - f.player.lastPunchT < 320);
        const opts = { block: !!inp.block, hit, t: this.t, punching };
        const okL = this.sprites.draw(this.ctx, 'L', opts);
        const okR = this.sprites.draw(this.ctx, 'R', opts);
        if (okL && okR) return;
        if (!okL) this._arm('L', arms.le, arms.lw, inp, hit);
        if (!okR) this._arm('R', arms.re, arms.rw, inp, hit);
        return;
      }
      this._arm('L', arms.le, arms.lw, inp, hit);
      this._arm('R', arms.re, arms.rw, inp, hit);
    }
    _proj(side, a) {
      const sgn = side === 'L' ? -1 : 1;
      const f = clamp(a.f, -0.3, 1.9), u = clamp(a.u, -1.2, 1.6), l = clamp(a.l || 0, -1.5, 1.5);
      const bx = W / 2 + sgn * 250 + l * 170, by = H + 30 - (u + 0.35) * 260;
      const t = Math.max(0, f) * 0.36;
      return { x: lerp(bx, W / 2 + l * 60, t), y: lerp(by, 250, t), s: 1 - t * 0.62 };
    }
    _arm(side, el, wr, inp, hit) {
      const ctx = this.ctx;
      const sgn = side === 'L' ? -1 : 1;
      const sh = { x: W / 2 + sgn * 250, y: H + 30 - 0.35 * 260 + 100, s: 1.15 };
      const e = this._proj(side, el), w = this._proj(side, wr);
      this._limb(sh, e, 80, 64, hit);
      this._limb(e, w, 64 * e.s, 46 * w.s, hit);
      ctx.save(); ctx.beginPath(); ctx.arc(e.x, e.y, 32 * e.s, 0, TAU); ctx.clip(); ctx.fillStyle = T(ctx, 'skin'); ctx.fillRect(e.x - 40, e.y - 40, 80, 80);
      const eg = ctx.createRadialGradient(e.x - 10 * e.s, e.y - 10 * e.s, 2, e.x, e.y, 32 * e.s); eg.addColorStop(0, 'rgba(255,240,220,0.25)'); eg.addColorStop(1, 'rgba(60,20,0,0.35)'); ctx.fillStyle = eg; ctx.fillRect(e.x - 40, e.y - 40, 80, 80);
      if (hit) { ctx.fillStyle = `rgba(200,40,30,${hit * 0.3})`; ctx.fillRect(e.x - 40, e.y - 40, 80, 80); } ctx.restore();
      this._fist(side, e, w, inp.block, hit);
    }
    _limb(a, b, wa, wb, hit) {
      const ctx = this.ctx;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x + nx * wa / 2, a.y + ny * wa / 2); ctx.lineTo(b.x + nx * wb / 2, b.y + ny * wb / 2);
      ctx.lineTo(b.x - nx * wb / 2, b.y - ny * wb / 2); ctx.lineTo(a.x - nx * wa / 2, a.y - ny * wa / 2); ctx.closePath();
      ctx.clip();
      ctx.fillStyle = T(ctx, 'skin'); ctx.fillRect(Math.min(a.x, b.x) - 60, Math.min(a.y, b.y) - 60, Math.abs(dx) + 120, Math.abs(dy) + 120);
      const g = ctx.createLinearGradient(a.x + nx * wa / 2, a.y + ny * wa / 2, a.x - nx * wa / 2, a.y - ny * wa / 2);
      g.addColorStop(0, 'rgba(255,240,220,0.35)'); g.addColorStop(0.4, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,20,0,0.5)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(a.x, b.x) - 60, Math.min(a.y, b.y) - 60, Math.abs(dx) + 120, Math.abs(dy) + 120);
      if (hit) { ctx.fillStyle = `rgba(200,40,30,${hit * 0.3})`; ctx.fillRect(Math.min(a.x, b.x) - 60, Math.min(a.y, b.y) - 60, Math.abs(dx) + 120, Math.abs(dy) + 120); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(a.x + nx * wa / 2, a.y + ny * wa / 2); ctx.lineTo(b.x + nx * wb / 2, b.y + ny * wb / 2); ctx.moveTo(b.x - nx * wb / 2, b.y - ny * wb / 2); ctx.lineTo(a.x - nx * wa / 2, a.y - ny * wa / 2); ctx.stroke();
    }
    // the back of your fist in an MMA glove: padded knuckle block, curled fingers, thumb, wrist strap
    _fist(side, e, w, block, hit) {
      const ctx = this.ctx;
      const s = w.s * 1.05, sgn = side === 'L' ? -1 : 1;
      const ang = Math.atan2(w.y - e.y, w.x - e.x) + Math.PI / 2;
      ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(ang * 0.35); ctx.scale(s, s);
      ctx.fillStyle = COL.wrap; ctx.beginPath(); ctx.roundRect(-30, 8, 60, 26, 8); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 10; k < 34; k += 6) ctx.fillRect(-30, k, 60, 1.5);
      ctx.fillStyle = COL.mmaTrim; ctx.fillRect(-30, 18, 60, 6);
      const gg = ctx.createLinearGradient(-44, -46, 44, 16); gg.addColorStop(0, '#34343c'); gg.addColorStop(0.5, COL.mma); gg.addColorStop(1, '#08080a');
      ctx.fillStyle = gg; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-44, -46, 88, 62, 20); ctx.fill(); ctx.stroke();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(220,220,230,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(-40, -42, 80, 54, 17); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COL.mmaTrim; ctx.beginPath(); ctx.roundRect(-38, -40, 76, 9, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `700 9px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('BLITZ', 0, -20);
      ctx.fillStyle = '#2c2c34'; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      for (let i = 0; i < 4; i++) { const kg = ctx.createRadialGradient(-30 + i * 20 - 3, -47, 1, -30 + i * 20, -44, 11); kg.addColorStop(0, '#4a4a54'); kg.addColorStop(1, '#1a1a20'); ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(-30 + i * 20, -44, 11, 0, TAU); ctx.fill(); ctx.stroke(); }
      const skin = hit ? '#f0937c' : COL.skin, dark = hit ? '#b8604a' : COL.skinDark;
      ctx.fillStyle = skin; ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.roundRect(-38 + i * 19, 6, 17, 22, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-35 + i * 19, 9, 6, 3); ctx.fillStyle = skin; }
      ctx.beginPath(); ctx.ellipse(-sgn * 42, -6, 12, 20, sgn * 0.5, 0, TAU); ctx.fill(); ctx.stroke();
      if (block) { ctx.globalAlpha = 0.3; ctx.fillStyle = COL.gold; ctx.beginPath(); ctx.arc(0, -10, 70, 0, TAU); ctx.fill(); }
      ctx.restore();
    }

    // ---------- POST: grade, vignette, grain ----------
    post(dt, v) {
      const ctx = this.ctx, ar = this.arena;
      if (ar) { ctx.fillStyle = ar.grade; ctx.fillRect(0, 0, W, H); }
      const vg = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 720);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      this.grainOff = (this.grainOff + 37) % 256;
      ctx.save(); ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay'; const g = global.TEX.grain(); const ox = this.grainOff, oy = (this.grainOff * 3) % 256; for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(g, x, y); ctx.restore();
    }

    // ---------- OVERLAYS ----------
    overlays(dt, v) {
      const ctx = this.ctx, t = this.t;
      if (this.hint && this.t < this.hint.until) {
        ctx.save(); ctx.font = `600 15px ${UI}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(this.hint.text).width + 44;
        ctx.fillStyle = 'rgba(15,16,18,0.78)'; ctx.fillRect(W / 2 - tw / 2, 96, tw, 30); ctx.strokeStyle = 'rgba(232,228,220,0.16)'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - tw / 2 + 0.5, 96.5, tw - 1, 29);
        ctx.save(); ctx.translate(W / 2 - tw / 2 + 16, 111); ctx.rotate(Math.PI / 4); ctx.fillStyle = COL.red; ctx.fillRect(-4, -4, 8, 8); ctx.restore();
        ctx.fillStyle = COL.bone; ctx.fillText(this.hint.text, W / 2 - tw / 2 + 30, 111); ctx.restore();
      }
      this.superAge += dt;
      if (this.superAge < 900) {
        const k = this.superAge / 900;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(this.pos.npc.x, this.pos.npc.y + 60); ctx.rotate(t / 400); ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillStyle = COL.gold;
        for (let i = 0; i < 14; i++) { ctx.rotate(6.283 / 14); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(900, -30); ctx.lineTo(900, 30); ctx.fill(); }
        ctx.restore();
      }
      if (this.flashC) {
        this.flashAge += dt;
        const a = 1 - this.flashAge / 220;
        if (a > 0) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = this.flashC; ctx.fillRect(0, 0, W, H); ctx.restore(); } else this.flashC = null;
      }
      if (v.timeScale < 1) {
        const gr = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 620);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(212,161,58,0.25)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }
      for (const fl of this.floats) {
        fl.age += dt; fl.x += fl.vx * dt; fl.y += fl.vy * dt;
        const k = fl.age / fl.life, a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(fl.rot); ctx.globalAlpha = Math.max(0, a);
        const pop = 1 + Math.max(0, 0.5 - fl.age / 150);
        ctx.scale(pop, pop);
        ctx.font = `700 ${fl.size}px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillStyle = COL[fl.kind] || COL.bone; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        ctx.fillText(fl.text.toUpperCase(), 0, 0);
        ctx.restore();
      }
      this.floats = this.floats.filter(f => f.age < f.life);
      const drawAnn = (a, y, base) => {
        a.age += dt; if (a.age > a.life) return false;
        const k = a.age / a.life;
        const pop = a.age < 120 ? 1.5 - 0.5 * (a.age / 120) : 1;
        const alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        ctx.save(); ctx.translate(W / 2, y); ctx.rotate(-0.05); ctx.scale(pop, pop); ctx.globalAlpha = alpha;
        ctx.font = `700 ${base}px ${FONT}`; ctx.textAlign = 'center';
        const col = a.kind === 'bad' ? COL.bad : a.kind === 'meh' ? COL.gold : a.kind === 'super' ? COL.super : COL.bone;
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = Math.round(base * 0.07); ctx.fillStyle = '#1a1a1e'; ctx.fillText(a.text, 0, 0);
        ctx.shadowOffsetY = 0; ctx.shadowBlur = 30; ctx.shadowColor = a.kind === 'bad' ? 'rgba(200,40,30,0.7)' : 'rgba(212,161,58,0.55)'; ctx.fillStyle = col; ctx.fillText(a.text, 0, 0);
        ctx.restore();
        return true;
      };
      if (this.ann && !drawAnn(this.ann, 190, this.ann.big ? 112 : 78)) this.ann = null;
      if (this.sub && !drawAnn(this.sub, 240, 30)) this.sub = null;
      if (v.status) {
        ctx.save(); ctx.font = `600 18px ${UI}`; ctx.textAlign = 'center'; ctx.fillStyle = COL.gold; ctx.shadowColor = '#000'; ctx.shadowBlur = 10;
        ctx.fillText(v.status, W / 2, 150); ctx.restore();
      }
    }

    // ---------- HUD ----------
    hud(dt, f, v) {
      const ctx = this.ctx, t = this.t;
      this.hpLagP += (f.player.hp - this.hpLagP) * Math.min(1, dt / 350);
      this.hpLagN += (f.npc.hp - this.hpLagN) * Math.min(1, dt / 350);
      const bar = (x, y, w, hp, lag, max, col, col2, flip) => {
        ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, flip ? 0.32 : -0.32, 1, 0, 0);
        ctx.fillStyle = 'rgba(15,16,18,0.75)'; ctx.fillRect(0, 0, w, 16); ctx.strokeStyle = 'rgba(232,228,220,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, 15);
        const fw = w * Math.max(0, lag / max), hw = w * Math.max(0, hp / max);
        ctx.fillStyle = 'rgba(232,228,220,0.35)'; ctx.fillRect(flip ? w - fw : 0, 0, fw, 16);
        const g = ctx.createLinearGradient(0, 0, 0, 16); g.addColorStop(0, col); g.addColorStop(1, col2); ctx.fillStyle = g; ctx.fillRect(flip ? w - hw : 0, 0, hw, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(flip ? w - hw : 0, 0, hw, 3);
        ctx.restore();
      };
      const portrait = (x, y, who) => {
        const g = ctx.createLinearGradient(0, y, 0, y + 46); g.addColorStop(0, '#2a2e34'); g.addColorStop(1, '#131519'); ctx.fillStyle = g; ctx.fillRect(x, y, 46, 46);
        ctx.strokeStyle = 'rgba(232,228,220,0.25)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, 45, 45);
        ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, 42, 42); ctx.clip();
        if (who === 'you') { ctx.fillStyle = COL.skin; ctx.beginPath(); ctx.roundRect(x + 10, y + 12, 26, 34, 10); ctx.fill(); ctx.fillStyle = COL.mma; ctx.beginPath(); ctx.roundRect(x + 8, y + 8, 30, 16, 6); ctx.fill(); ctx.fillStyle = COL.mmaTrim; ctx.fillRect(x + 10, y + 12, 26, 3); }
        else { // SOL: a silhouette, ponytail head and shoulders in skin and black
          ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.ellipse(x + 34, y + 24, 6, 15, 0.45, 0, TAU); ctx.fill(); // ponytail
          ctx.beginPath(); ctx.roundRect(x + 3, y + 34, 40, 16, 7); ctx.fill(); // shoulders / sports top
          ctx.fillStyle = COL.skin; ctx.fillRect(x + 18, y + 27, 10, 9); // neck
          ctx.beginPath(); ctx.ellipse(x + 23, y + 20, 11, 13, 0, 0, TAU); ctx.fill(); // head
          ctx.fillStyle = '#0c0c10'; ctx.beginPath(); ctx.ellipse(x + 23, y + 12, 12, 7, 0, Math.PI, TAU); ctx.fill(); ctx.fillRect(x + 11, y + 11, 24, 3); // hair
          ctx.beginPath(); ctx.arc(x + 31, y + 11, 5, 0, TAU); ctx.fill(); // hair tie
        }
        ctx.restore();
      };
      ctx.save(); ctx.font = `700 15px ${FONT}`; ctx.fillStyle = COL.bone; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
      portrait(20, 18, 'you'); ctx.textAlign = 'left'; ctx.fillText('YOU', 78, 32); ctx.restore();
      bar(80, 40, 320, f.player.hp, this.hpLagP, f.player.maxHp, '#f2eee6', '#b9b3a8', false);
      ctx.save(); ctx.font = `700 15px ${FONT}`; ctx.fillStyle = COL.bone; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
      portrait(W - 66, 18, 'sol'); ctx.textAlign = 'right'; ctx.fillText('SOL', W - 78, 32); ctx.restore();
      bar(W - 400, 40, 320, f.npc.hp, this.hpLagN, f.npc.maxHp, '#d94a3a', '#8a1d16', true);
      // centre: clock, rank, stage
      const secs = Math.floor(f.t / 1000), mm = Math.floor(secs / 60), ss = ('0' + (secs % 60)).slice(-2);
      ctx.save(); ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.font = `700 34px ${FONT}`; ctx.fillStyle = COL.bone; ctx.fillText(mm + ':' + ss, W / 2, 46);
      ctx.font = `600 10px ${UI}`; ctx.fillStyle = COL.gold; ctx.fillText('RANK ' + ('0' + f.level).slice(-2) + '   ◆   ' + (this.arena ? this.arena.name : ''), W / 2, 64);
      ctx.restore();
      // calorie readout: a small ink pill under the rank line (y 72-92, clear of the hint pill at 96), fed by
      // fitness.js through the Fitness.live global so the renderer needs no reference to the tracker
      const live = global.Fitness && global.Fitness.live;
      if (live && live.on) {
        const lab = live.label || 'LOW', labCol = lab === 'HIGH' ? COL.bad : lab === 'MODERATE' ? COL.gold : COL.fog;
        const segs = [
          [Number(live.kcal || 0).toFixed(1), `700 15px ${FONT}`, COL.bone], [' KCAL', `600 9px ${UI}`, COL.gold],
          ['   ·   ', `600 9px ${UI}`, COL.fog], [lab, `600 9px ${UI}`, labCol],
          ['   ·   ', `600 9px ${UI}`, COL.fog], [Number(live.met || 0).toFixed(1), `700 13px ${FONT}`, COL.bone], [' MET', `600 9px ${UI}`, COL.gold],
        ];
        if (live.note) segs.push(['   ·   ', `600 9px ${UI}`, COL.fog], ['LOW ACCURACY', `600 9px ${UI}`, COL.fog]);
        ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        let tw = 0; for (const s of segs) { ctx.font = s[1]; s[3] = ctx.measureText(s[0]).width; tw += s[3]; }
        const ph = 20, py = 72, pw = tw + 30, px = Math.round(W / 2 - pw / 2);
        ctx.fillStyle = 'rgba(15,16,18,0.74)'; ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(232,228,220,0.16)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        ctx.fillStyle = COL.gold; ctx.fillRect(px, py, 3, ph);
        let x = px + 15; for (const s of segs) { ctx.font = s[1]; ctx.fillStyle = s[2]; ctx.fillText(s[0], x, py + ph / 2 + 1); x += s[3]; }
        ctx.restore();
      }
      // combo
      if (f.player.combo >= 2) {
        ctx.save(); ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
        ctx.font = `700 44px ${FONT}`; ctx.fillStyle = COL.gold; ctx.fillText(String(f.player.combo), 150, H - 40);
        ctx.font = `700 14px ${FONT}`; ctx.fillStyle = COL.bone; ctx.fillText('HIT COMBO', 150 + ctx.measureText(String(f.player.combo)).width * 2.6, H - 42); ctx.restore();
      }
      // radar
      const rx = 70, ry = H - 66, rr = 34;
      ctx.save(); ctx.fillStyle = 'rgba(15,16,18,0.7)'; ctx.beginPath(); ctx.arc(rx, ry, rr + 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(232,228,220,0.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(rx, ry, rr + 8, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(rx, ry, rr * 0.55, 0, TAU); ctx.stroke();
      ctx.fillStyle = COL.bone; ctx.beginPath(); ctx.moveTo(rx, ry - 8); ctx.lineTo(rx - 6, ry + 6); ctx.lineTo(rx + 6, ry + 6); ctx.closePath(); ctx.fill();
      const r = f.rel, dd = Math.min(1, r.dist / (global.ARENA ? global.ARENA.RING * 1.2 : 2));
      ctx.fillStyle = COL.red; ctx.shadowColor = COL.red; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(rx + r.lat / Math.max(0.05, r.dist) * dd * rr, ry - r.fwd / Math.max(0.05, r.dist) * dd * rr, 5, 0, TAU); ctx.fill();
      ctx.restore();
      // special meter: four segments
      ctx.save(); ctx.textAlign = 'right'; ctx.font = `600 10px ${UI}`; ctx.fillStyle = COL.fog; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
      const full = f.player.super >= 100;
      ctx.fillText('SPECIAL', W - 24, H - 46); ctx.font = `700 13px ${FONT}`; ctx.fillStyle = COL.gold; ctx.fillText(full ? (Math.floor(t / 300) % 2 ? 'HANDS UP FOR HAYMAKER' : 'HAYMAKER READY') : 'HAYMAKER', W - 24, H - 32);
      for (let i = 0; i < 4; i++) { const on = f.player.super >= (i + 1) * 25; ctx.save(); ctx.translate(W - 24 - (4 - i) * 62, H - 26); ctx.transform(1, 0, -0.32, 1, 0, 0); ctx.fillStyle = on ? COL.gold : 'rgba(232,228,220,0.14)'; if (on && full) { ctx.shadowColor = COL.gold; ctx.shadowBlur = 10 + Math.sin(t / 80) * 6; } ctx.fillRect(0, 0, 56, 10); ctx.restore(); }
      ctx.restore();
    }
  }
  global.Renderer = Renderer;
  global.GUARD_ARMS = GUARD;
  global.GAME_W = W; global.GAME_H = H;
})(typeof window !== 'undefined' ? window : globalThis);
