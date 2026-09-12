// opponent.js — the human boxer opponent as a 2D cutout skeleton. ONE full-body image
// (assets/boxer.png, 1024x1536, guard stance facing the camera) is split into parts by source
// rectangles + masks and re-assembled as a bone hierarchy; when the image is missing a procedural
// silhouette is drawn on the very same skeleton so every state animates either way.
//
//   const rig = new Opponent();
//   const out = rig.draw(ctx, v);   // draws in the CURRENT transform -> { cue:{x,y,r}|null, headY }
//   v = { t, dt, state, attack, prog, hurtAge, hurtHand, walking, target:{x,y,r}, inRange }
//
// Local coordinates: origin at the centre of the feet, +y DOWN (canvas), so the body has negative
// y. The character stands 400 units tall (head top ~ -400) and ~260 wide. The caller applies
// translate/scale for perspective; returned cue/headY are in these local units.
//
// Naming: R = HER right arm/leg (viewer's LEFT, negative x). L = her left (viewer's right, +x).
// jab / hookR / overhead / body are thrown with R, hookL / uppercut with L.
//
// Image pipeline (built once per image, cached): every part is cut from the image with its mask
// (poly / capsule / ellipse), and where a part is covered by an OCCLUDER drawn later (gloves over the
// chest, shorts over the thighs) the covered pixels are removed and re-filled by smearing the part's
// own neighbouring pixels (mirror + 4-direction), so a glove flying away leaves chest, not a hole,
// and never drags a chunk of chest along. Per frame the parts are assembled into a screen-space
// layer, lit with a warm key (upper-left) + cool rim (right edge) via source-atop, then composited.
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeIn = t => { t = clamp(t, 0, 1); return t * t * t; };
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const EMPTY = [], NODYN = {};

  // --------------------------------------------------------------------------------------------
  // PART TABLE — measured against assets/boxer.png (tune with test/rig.html; it is plain data).
  // image: source pixel space -> local units. px -> local: x = (px - cx) * k, y = (py - feetY) * k
  //        feetY sits between the two soles (her left foot is nearer the camera and lower in the
  //        image); k makes her 400 units tall (hair top y=28 -> -399.6).
  // joints: rest-pose joint positions in SOURCE PIXELS (the guard stance as drawn in the image).
  // parts:  rect [x, y, w, h] in source pixels; bone [jointA, jointB] gives the part's rotation
  //         (the part turns with the vector A->B); pivot defaults to jointA.
  //         mask: 'poly' (+pts in source px), 'capsule' (+cap [rA, rB, extA, extB] around the bone),
  //         'ellipse' (inscribed in rect) — cuts neighbours out of the rect.
  //         occluder: parts drawn later that cut holes (re-filled) in the parts under them.
  //         sym: mirror axis (source x) used to re-fill holes (the bra is symmetric).
  //         hem: source y where the shorts start to lag (secondary motion shear below that line).
  //         Drawn in list order (first = furthest back); the striking arm is re-ordered to the front.
  // --------------------------------------------------------------------------------------------
  const DEFAULT_TABLE = {
    image: { w: 1024, h: 1536, cx: 515, feetY: 1445, k: 0.282 },
    joints: {
      headTop: [498, 28], headC: [496, 205], neck: [497, 300],
      ponyRoot: [556, 100], ponyTip: [640, 325],
      chest: [497, 425], waist: [505, 578], pelvis: [510, 690],
      shR: [368, 340], elR: [315, 532], wrR: [352, 438], glR: [402, 322],
      shL: [645, 348], elL: [708, 540], wrL: [662, 488], glL: [571, 377],
      hipR: [445, 790], kneeR: [322, 995], ankR: [245, 1195], toeR: [180, 1355],
      hipL: [590, 790], kneeL: [700, 1010], ankL: [800, 1250], toeL: [830, 1465],
    },
    parts: {
      ponytail:  { rect: [540, 28, 142, 324],  bone: ['ponyRoot', 'ponyTip'], mask: 'poly',
                   pts: [[548, 28], [682, 28], [682, 352], [590, 352], [592, 250], [576, 190], [562, 140], [548, 100]] },
      thighR:    { rect: [278, 755, 235, 275], bone: ['hipR', 'kneeR'], mask: 'capsule', cap: [78, 55, 40, 16], muscle: 'thigh' },
      shinR:     { rect: [188, 958, 205, 275], bone: ['kneeR', 'ankR'], mask: 'capsule', cap: [52, 42, 16, 24] },
      shoeR:     { rect: [148, 1160, 195, 240], bone: ['ankR', 'toeR'] },
      thighL:    { rect: [510, 755, 260, 290], bone: ['hipL', 'kneeL'], mask: 'capsule', cap: [82, 58, 40, 16], muscle: 'thigh' },
      shinL:     { rect: [632, 972, 215, 305], bone: ['kneeL', 'ankL'], mask: 'capsule', cap: [60, 42, 16, 24] },
      shoeL:     { rect: [752, 1222, 135, 275], bone: ['ankL', 'toeL'] },
      torso:     { rect: [378, 278, 300, 330], bone: ['waist', 'neck'], mask: 'poly', sym: 498,
                   pts: [[456, 280], [540, 280], [612, 298], [652, 328], [658, 370], [644, 430], [642, 500], [615, 606], [405, 606], [404, 500], [396, 440], [392, 400], [386, 360], [392, 330], [420, 298]] },
      hips:      { rect: [316, 581, 406, 267], bone: ['pelvis', 'waist'], mask: 'poly', occluder: true, hem: 690,
                   pts: [[324, 583], [702, 583], [704, 700], [720, 792], [664, 798], [646, 818], [604, 842], [470, 846], [410, 836], [362, 812], [322, 782], [318, 700]] },
      head:      { rect: [388, 14, 210, 316],  bone: ['neck', 'headTop'], mask: 'poly',
                   pts: [[390, 16], [548, 16], [548, 100], [562, 140], [576, 190], [592, 250], [592, 268], [545, 270], [538, 300], [536, 326], [458, 326], [456, 300], [450, 270], [390, 268]] },
      upperArmL: { rect: [612, 296, 130, 280], bone: ['shL', 'elL'], mask: 'capsule', cap: [46, 38, 36, 30], muscle: 'arm' },
      forearmL:  { rect: [596, 436, 140, 150], bone: ['elL', 'wrL'], mask: 'capsule', cap: [36, 32, 30, 28] },
      upperArmR: { rect: [280, 292, 140, 280], bone: ['shR', 'elR'], mask: 'capsule', cap: [46, 40, 36, 30], muscle: 'arm' },
      forearmR:  { rect: [270, 400, 130, 170], bone: ['elR', 'wrR'], mask: 'capsule', cap: [34, 28, 30, 26] },
      gloveL:    { rect: [486, 292, 224, 242], bone: ['wrL', 'glL'], pivot: 'glL', mask: 'poly', occluder: true, glove: true,
                   pts: [[570, 298], [610, 303], [637, 326], [652, 354], [656, 380], [666, 418], [676, 444], [673, 476], [660, 492], [640, 503], [612, 503], [594, 468], [552, 452], [520, 442], [500, 422], [491, 392], [494, 355], [514, 325], [540, 305]] },
      gloveR:    { rect: [306, 246, 175, 226], bone: ['wrR', 'glR'], pivot: 'glR', mask: 'poly', occluder: true, glove: true,
                   pts: [[395, 250], [436, 260], [451, 280], [458, 305], [457, 330], [447, 355], [438, 375], [432, 395], [428, 420], [423, 445], [417, 464], [380, 459], [345, 446], [318, 428], [314, 395], [318, 372], [330, 340], [342, 300], [362, 266]] },
    },
  };

  const COL = { skin: '#d9a77a', skinDark: '#b8845a', skinLight: '#e8bf95', black: '#1c1c22', black2: '#2c2c34', glove: '#c8281e', gloveDark: '#7d1a12', white: '#e8e4dc', red: '#c8281e', hair: '#2a1e18', gold: '#d4a13a', mouth: '#7a4438' };
  const HAND = { jab: 'R', hookR: 'R', overhead: 'R', body: 'R', hookL: 'L', uppercut: 'L' };
  const LINE_K = { jab: 1, body: 1, overhead: 1, hookR: 0.6, hookL: 0.6, uppercut: 0.75 }; // how straight (foreshortened) the striking arm is drawn
  const GLOVE_R = 22; // rest glove (mitt) radius in local units (image mitt ~150px * k / 2)
  const ARM_ORDER = { R: ['upperArmR', 'forearmR', 'gloveR'], L: ['upperArmL', 'forearmL', 'gloveL'] };
  const SMOOTH = { default: 70, glove: 110, body: 90, leg: 45 };
  const LAYER_MAX = 2048;

  // Re-fill pixels that were opaque in `before` and are transparent in `after` (holes cut by an
  // occluder) from the part's own remaining pixels. Clothing and skin continue mostly VERTICALLY
  // (the bra under a glove is what is below it, the thigh under the shorts is what is below the
  // hem), so the nearest opaque pixels above and below are blended (sharp 1/d^3 weights: a soft
  // seam roughly half-way, not a long smear); the mirror pixel across symX joins in when the part
  // is symmetric, and left/right only when a column has nothing above or below. Filled pixels are
  // darkened a little so they read as the shadow under the part that used to cover them.
  function inpaint(before, after, w, h, symX) {
    const A = before.data, B = after.data, n = w * h;
    const hole = new Uint8Array(n), ok = new Uint8Array(n);
    let holes = 0;
    for (let i = 0; i < n; i++) { const a0 = A[i * 4 + 3], a1 = B[i * 4 + 3]; if (a0 > 40 && a1 < 40) { hole[i] = 1; holes++; } else if (a1 > 40) ok[i] = 1; }
    if (!holes) return;
    const MAXD = 340;
    let r = 0, g = 0, b = 0, ws = 0;
    const take = (j, d) => { const wt = 1 / (d * d * d + 8); r += B[j * 4] * wt; g += B[j * 4 + 1] * wt; b += B[j * 4 + 2] * wt; ws += wt; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!hole[i]) continue;
      r = 0; g = 0; b = 0; ws = 0;
      let j, d, q;
      for (d = 1; d <= MAXD; d++) { q = y - d; if (q < 0) break; j = q * w + x; if (ok[j]) { take(j, d); break; } }
      for (d = 1; d <= MAXD; d++) { q = y + d; if (q >= h) break; j = q * w + x; if (ok[j]) { take(j, d); break; } }
      if (symX >= 0) { q = Math.round(2 * symX - x); if (q >= 0 && q < w) { j = y * w + q; if (ok[j]) take(j, 40); } }
      if (ws === 0) {
        for (d = 1; d <= MAXD; d++) { q = x - d; if (q < 0) break; j = y * w + q; if (ok[j]) { take(j, d); break; } }
        for (d = 1; d <= MAXD; d++) { q = x + d; if (q >= w) break; j = y * w + q; if (ok[j]) { take(j, d); break; } }
      }
      if (ws > 0) { B[i * 4] = r / ws * 0.84; B[i * 4 + 1] = g / ws * 0.84; B[i * 4 + 2] = b / ws * 0.84; B[i * 4 + 3] = A[i * 4 + 3]; }
    }
    // soften the filled area (two 5x5 box passes over hole pixels only) so column streaks blend
    const tmp = new Uint8ClampedArray(B.length);
    for (let pass = 0; pass < 2; pass++) {
      tmp.set(B);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!hole[i] || B[i * 4 + 3] < 40) continue;
        let r = 0, g = 0, b = 0, cnt = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
          const j = yy * w + xx; if (tmp[j * 4 + 3] < 40) continue; r += tmp[j * 4]; g += tmp[j * 4 + 1]; b += tmp[j * 4 + 2]; cnt++;
        }
        if (cnt) { B[i * 4] = r / cnt; B[i * 4 + 1] = g / cnt; B[i * 4 + 2] = b / cnt; }
      }
    }
  }

  class Opponent {
    constructor(table) {
      this.setTable(table || DEFAULT_TABLE);
      this.pose = null;          // smoothed scalar pose
      this.pony = { a: 0, va: 0, lastHx: null };
      this.hem = { a: 0, va: 0, last: null };   // shorts hem shear spring
      this.last = { hand: 'R', x: -60, y: -250, r: GLOVE_R }; // where the last strike ended (for 'recover')
      this.stateT0 = { state: null, t: 0 };
      this.scratch = null; this.layer = null; this.rim = null; this.lc = null; this.rc = null;
      this.keyGrad = null; this.shadowGrad = null;
      this.prevT = null;
      this.jsm = {}; this.dt = 16; this.armSnap = null;
      this.cache = null;         // { img, parts:{name:{cv,sx,sy,sw,sh,shadow,hot,pad}} } built per image
      this.explode = 0;          // debug: spread the parts apart (rig page) to check the masks
      this.lighting = true;      // debug: key/rim pass on/off
      this.dyn = {};
      for (const n of ['upperArmR', 'upperArmL', 'forearmR', 'forearmL', 'gloveR', 'gloveL', 'thighR', 'thighL', 'torso']) this.dyn[n] = {};
    }

    // Replace the part table (called by the rig page when the textarea changes).
    setTable(tbl) {
      const img = tbl.image, J = {};
      const k = img.k;
      for (const n in tbl.joints) J[n] = [(tbl.joints[n][0] - img.cx) * k, (tbl.joints[n][1] - img.feetY) * k];
      this.table = tbl; this.rest = J; this.k = k; this.img = img;
      // bone lengths + bend sides from the rest pose (so IK reproduces the image exactly at rest)
      const len = (a, b) => dist(J[a], J[b]);
      const side = (a, b, c) => { const d = [J[c][0] - J[a][0], J[c][1] - J[a][1]], e = [J[b][0] - J[a][0], J[b][1] - J[a][1]]; return (d[0] * e[1] - d[1] * e[0]) >= 0 ? 1 : -1; };
      this.chain = {
        R: { up: len('shR', 'elR'), fore: len('elR', 'wrR'), side: side('shR', 'elR', 'wrR') },
        L: { up: len('shL', 'elL'), fore: len('elL', 'wrL'), side: side('shL', 'elL', 'wrL') },
        legR: { up: len('hipR', 'kneeR'), fore: len('kneeR', 'ankR'), side: side('hipR', 'kneeR', 'ankR') },
        legL: { up: len('hipL', 'kneeL'), fore: len('kneeL', 'ankL'), side: side('hipL', 'kneeL', 'ankL') },
      };
      this.torsoLen = len('waist', 'neck');
      this.order = Object.keys(tbl.parts);
      this.orderBig = {};
      for (const h of ['R', 'L']) { const arm = ARM_ORDER[h]; this.orderBig[h] = this.order.filter(n => arm.indexOf(n) < 0).concat(arm); }
      this.partCentre = {};
      for (const n of this.order) { const r = tbl.parts[n].rect; this.partCentre[n] = [(r[0] + r[2] / 2 - img.cx) * k, (r[1] + r[3] / 2 - img.feetY) * k + 210]; }
      this.cache = null;
    }
    static get DEFAULT_TABLE() { return DEFAULT_TABLE; }

    // Draws the procedural silhouette in its rest pose (local units, current transform). The rig page
    // uses it to build a synthetic boxer image so the cutout pipeline can be checked without the asset.
    drawRest(ctx) { this.face = 'calm'; for (const name of this.order) { ctx.save(); this._fallbackPart(ctx, name, EMPTY); ctx.restore(); } }

    // ---------------------------------------------------------------- pose goals per state
    _goals(v) {
      const t = v.t || 0, st = v.state || 'idle', prog = clamp(v.prog || 0, 0, 1), walking = clamp(v.walking || 0, 0, 1);
      const R = this.rest, g = {};
      // idle life: weight shift, breathing, guard bob, glove circling
      g.px = Math.sin(t / 1300) * 7 + Math.sin(t / 3100) * 3;
      g.py = Math.sin(t / 900) * 1.5;
      g.breath = 1 + 0.02 * Math.sin(t / 900);
      g.torsoRot = Math.sin(t / 1300) * 0.02;
      g.headRot = Math.sin(t / 1700) * 0.04;
      g.headDx = 0; g.dx = 0; g.bodyRot = 0; g.bodyScale = 1; g.squash = 1; g.lift = 0; g.koLift = 0;
      g.shrug = 0; g.tap = 0; g.roll = 0; g.hipTwist = 0; g.sfRx = 0; g.sfRy = 0; g.sfLx = 0; g.sfLy = 0; g.lineR = 0; g.lineL = 0;
      const cx = Math.cos(t / 520), cy = Math.sin(t / 520);
      g.gRx = R.glR[0] + cx * 5;        g.gRy = R.glR[1] + cy * 5 + Math.sin(t / 210) * 3; g.gRr = GLOVE_R;
      g.gLx = R.glL[0] - cx * 4;        g.gLy = R.glL[1] - cy * 4 + Math.cos(t / 210) * 3; g.gLr = GLOVE_R;
      g.gRrot = 0; g.gLrot = 0;
      g.msR = 1.15; g.msL = 1.15; // max arm stretch (the striking arm may reach much further, toward the camera)
      // feet: shuffle while walking; shoulders roll with the steps
      const ph = t / 110;
      g.fRx = R.ankR[0] + Math.sin(ph) * 9 * walking;  g.fRy = R.ankR[1] - Math.max(0, Math.sin(ph)) * 14 * walking;
      g.fLx = R.ankL[0] - Math.sin(ph) * 9 * walking;  g.fLy = R.ankL[1] - Math.max(0, -Math.sin(ph)) * 14 * walking;
      g.py += Math.abs(Math.sin(ph)) * 5 * walking;
      g.px += Math.sin(ph) * 4 * walking;
      g.torsoRot += Math.sin(ph) * 0.03 * walking;
      g.roll = Math.sin(ph + 0.6) * walking;
      g.gRy += Math.abs(Math.sin(ph)) * 4 * walking; g.gLy += Math.abs(Math.cos(ph)) * 4 * walking;
      g.stars = 0; g.face = 'calm';

      let cue = false, snap = null, big = false, hand = null;
      const atk = v.attack && HAND[v.attack] ? v.attack : null;
      if (atk) hand = HAND[atk];
      const other = h => (h === 'R' ? 'L' : 'R');
      const setG = (h, x, y, r) => { g['g' + h + 'x'] = x; g['g' + h + 'y'] = y; if (r != null) g['g' + h + 'r'] = r; };
      const target = v.target || this.last.T || { x: 0, y: -170, r: 110 };
      // Glove centre along a punch path, u = 0 (pulled back at the end of the windup) .. 1 (on the
      // target). Straights run on the shoulder->target line (a slight arc over the top for the
      // overhead); hooks arc out horizontally at shoulder height and come in on the target; the
      // uppercut drops to the waist and rises on a vertical arc. Recover retraces the same path.
      const pathPt = (a, h, u, T) => {
        const s = h === 'R' ? -1 : 1, G = R[h === 'R' ? 'glR' : 'glL'], S = R[h === 'R' ? 'shR' : 'shL'];
        let p0x, p0y, cx, cy, quad = true;
        switch (a) {
          case 'jab':      p0x = G[0] + s * 6;  p0y = G[1] + 12; quad = false; break;
          case 'body':     p0x = G[0] + s * 4;  p0y = G[1] + 30; quad = false; break;
          case 'overhead': p0x = G[0] + s * 8;  p0y = G[1] - 50; cx = (S[0] + T.x) / 2 + s * 6; cy = (S[1] + T.y) / 2 - 26; break;
          case 'uppercut': p0x = G[0] + s * 10; p0y = G[1] + 70; cx = T.x + s * 12; cy = T.y + 70; break;
          default:         p0x = G[0] + s * 50; p0y = S[1] + 6;  cx = S[0] + s * 120; cy = S[1] + 10; break; // hooks
        }
        if (!quad) return [lerp(p0x, T.x, u), lerp(p0y, T.y, u)];
        const m = 1 - u; return [m * m * p0x + 2 * m * u * cx + u * u * T.x, m * m * p0y + 2 * m * u * cy + u * u * T.y];
      };
      // drive the punching shoulder toward the target (shoulder rotation into the punch)
      const shoulderFwd = (h, T, k) => { const S = R[h === 'R' ? 'shR' : 'shL'], dx = T.x - S[0], dy = T.y - S[1], L = Math.hypot(dx, dy) || 1; g['sf' + h + 'x'] = dx / L * 12 * k; g['sf' + h + 'y'] = dy / L * 12 * k; };
      const tuck = h => { const s = h === 'R' ? -1 : 1; return [s * 28, -335]; }; // guard hand at the chin

      switch (st) {
        case 'intro': {
          const b = Math.abs(Math.sin(t / 260));
          g.py -= b * 6; g.gRy -= 12 + b * 6; g.gLy -= 12 + b * 6; g.gRx += 14; g.gLx -= 14; // gloves touch
          break;
        }
        case 'windup': {
          if (atk) {
            const k = easeOut(Math.min(1, prog * 1.15)), s = hand === 'R' ? -1 : 1;
            const gl = R[hand === 'R' ? 'glR' : 'glL'], p = pathPt(atk, hand, 0, target);
            const shake = prog * prog * 3;
            setG(hand, lerp(gl[0], p[0], k) + Math.sin(t / 23) * shake, lerp(gl[1], p[1], k) + Math.cos(t / 31) * shake, GLOVE_R * (1 - 0.06 * k * (atk === 'jab' || atk === 'body' ? 1 : 0)));
            const tk = tuck(other(hand)); setG(other(hand), lerp(g['g' + other(hand) + 'x'], tk[0], k * 0.7), lerp(g['g' + other(hand) + 'y'], tk[1], k * 0.7));
            const wind = { jab: 0.05, body: 0.08, hookL: 0.16, hookR: 0.16, overhead: -0.1, uppercut: 0.12 }[atk];
            g.torsoRot += s * wind * k; g.headRot += s * wind * 0.5 * k; g.hipTwist = s * wind * 0.6 * k;
            g.px += s * 8 * k; g.py += (atk === 'uppercut' || atk === 'body' ? 8 : atk === 'overhead' ? -4 : 0) * k;
            if (atk === 'uppercut' || atk === 'body') g.lift = Math.max(g.lift, 0.8 * k); // knees bend
            g.face = 'angry';
            cue = true;
          }
          break;
        }
        case 'strike': {
          if (atk) {
            const u = easeIn(prog), s = hand === 'R' ? -1 : 1, p = pathPt(atk, hand, u, target);
            const r = lerp(GLOVE_R, target.r || 110, u);
            setG(hand, p[0], p[1], r);
            this.last = { hand, atk, x: p[0], y: p[1], r, t, T: target };
            const tk = tuck(other(hand)); setG(other(hand), tk[0], tk[1]);
            // torso twists ~12 deg into the punch, the rear hip turns with it, the shoulder drives forward
            g.torsoRot += -s * 0.2 * u; g.hipTwist = -s * 0.5 * u; g.headRot += -s * 0.06 * u; shoulderFwd(hand, target, u);
            g.px += -s * 10 * u; g.py -= 3 * u; g.bodyScale = 1 + 0.03 * u;
            if (atk === 'uppercut' || atk === 'body') g.lift = Math.max(g.lift, 0.8 * (1 - u));
            g.face = 'angry'; big = true; g['ms' + hand] = 1.9;
            // straights go fully "in line" (foreshortened arm); hooks/uppercut keep some elbow bend
            g['line' + hand] = smoothstep(prog / 0.4) * LINE_K[atk];
            snap = ['g' + hand + 'x', 'g' + hand + 'y', 'g' + hand + 'r', 'ms' + hand, 'line' + hand];
          }
          break;
        }
        case 'recover': {
          // retract along the same path, then settle into the guard
          const L = this.last, h = L.hand, s = h === 'R' ? -1 : 1, k = easeOut(prog);
          const gl = R[h === 'R' ? 'glR' : 'glL'], T = L.T || target;
          const p = L.atk ? pathPt(L.atk, h, 1 - k, T) : [L.x, L.y], home = smoothstep((prog - 0.4) / 0.6);
          setG(h, lerp(p[0], gl[0], home), lerp(p[1], gl[1], home), lerp(L.r, GLOVE_R, k));
          const tk = tuck(other(h)); setG(other(h), lerp(tk[0], g['g' + other(h) + 'x'], home), lerp(tk[1], g['g' + other(h) + 'y'], home));
          big = k < 0.55; g['ms' + h] = lerp(1.9, 1.15, k);
          g['line' + h] = (1 - smoothstep((prog - 0.3) / 0.6)) * (L.atk ? LINE_K[L.atk] : 1);
          g.torsoRot += -s * 0.2 * (1 - k); g.hipTwist = -s * 0.5 * (1 - k); shoulderFwd(h, T, 1 - k);
          g.px += -s * 10 * (1 - k);
          break;
        }
        case 'hurt': {
          // the hurtAge overlay below does the snap; here: keep gloves slightly open
          g.gRx -= 8; g.gLx += 8; g.face = 'ouch';
          break;
        }
        case 'stun': {
          const sw = Math.sin(t / 420);
          g.torsoRot += sw * 0.13; g.headRot += Math.sin(t / 310) * 0.32 + 0.12; g.px += sw * 9; g.py += 8;
          setG('R', R.glR[0] - 52, -205 + Math.sin(t / 380) * 6, GLOVE_R); setG('L', R.glL[0] + 75, -200 + Math.cos(t / 380) * 6, GLOVE_R);
          g.gRrot = -0.4; g.gLrot = 0.4; g.lift = 0.35; g.stars = 1; g.face = 'dizzy';
          break;
        }
        case 'ko': {
          if (this.stateT0.state !== 'ko') this.stateT0 = { state: 'ko', t };
          const k = smoothstep(Math.max(prog, (t - this.stateT0.t) / 600));
          g.bodyRot = k * 1.5; g.bodyScale = 1 - 0.12 * k; g.py -= 10 * Math.sin(k * Math.PI); g.koLift = 42 * k;
          g.torsoRot += 0.15 * k; g.headRot += 0.55 * k;
          setG('R', R.glR[0] - 70 * k, R.glR[1] + 40 * k, GLOVE_R); setG('L', R.glL[0] + 60 * k, R.glL[1] + 90 * k, GLOVE_R);
          g.fRx += -10 * k; g.fLx += 14 * k; g.fLy -= 30 * k; g.lift = 0.3 * k;
          g.face = 'x'; g.stars = k > 0.7 ? 1 : 0;
          break;
        }
        case 'taunt': {
          const b = Math.abs(Math.sin(t / 180));
          g.py -= b * 26; g.lift = (1 - b) * 0.4;
          setG('R', R.glR[0] - 45, -415 - b * 10, GLOVE_R); setG('L', R.glL[0] + 45, -415 - b * 10, GLOVE_R);
          g.headRot += Math.sin(t / 360) * 0.12; g.face = 'grin';
          break;
        }
        default: { // idle: every ~6s a shoulder shrug, and half-way through the cycle the gloves tap together
          const cyc = t % 6200;
          if (cyc < 520) g.shrug = Math.sin(cyc / 520 * Math.PI);
          if (cyc > 3200 && cyc < 3800) g.tap = Math.max(0, Math.sin((cyc - 3200) / 600 * TAU));
          g.gRy -= g.shrug * 9; g.gLy -= g.shrug * 9;
          g.gRx += g.tap * 12; g.gLx -= g.tap * 12; g.gRy -= g.tap * 7; g.gLy -= g.tap * 7; g.gRrot = g.tap * 0.15; g.gLrot = -g.tap * 0.15;
          break;
        }
      }
      if (st !== 'ko') this.stateT0 = { state: st, t };

      // hurt overlay: head snap away from the hitting hand, torso recoil, brief squash
      const ha = v.hurtAge == null ? 1e9 : v.hurtAge;
      const hk = st === 'hurt' ? Math.max(1 - prog, 1 - ha / 260) : 1 - ha / 260;
      if (hk > 0 && st !== 'ko') {
        const k = easeOut(hk), dir = v.hurtHand === 'L' ? 1 : -1;
        g.headRot += dir * 0.38 * k; g.headDx += dir * 10 * k; g.torsoRot += dir * 0.12 * k; g.dx += dir * 16 * k;
        g.squash = 1 - 0.09 * Math.max(0, 1 - ha / 120);
        if (hk > 0.4) g.face = 'ouch';
        // the first 100ms: an unsmoothed head snap (the head-echo blur in draw() follows it)
        if (ha >= 0 && ha < 100) { const s = 1 - ha / 100; g.headDx += dir * 14 * s; g.headRot += dir * 0.2 * s; snap = (snap || []).concat(['headDx', 'headRot']); }
      }
      return { g, cue, snap, big, hand };
    }

    // ---------------------------------------------------------------- smoothing
    _smooth(goal, dt, snap) {
      if (!this.pose) { this.pose = Object.assign({}, goal); return; }
      const P = this.pose;
      for (const k in goal) {
        if (typeof goal[k] !== 'number') { P[k] = goal[k]; continue; }
        if (snap && snap.indexOf(k) >= 0) { P[k] = goal[k]; continue; }
        const tau = k[0] === 'g' ? SMOOTH.glove : (k[0] === 'f' || k === 'lift') ? SMOOTH.leg : (k === 'bodyRot' || k === 'bodyScale') ? SMOOTH.body : SMOOTH.default;
        const a = 1 - Math.exp(-dt / tau);
        if (P[k] == null || !isFinite(P[k])) P[k] = goal[k]; else P[k] += (goal[k] - P[k]) * a;
      }
    }

    // ---------------------------------------------------------------- skeleton solve
    _ik(S, T, up, fore, side, out, maxStretch) {
      // two-bone IK: joint positions for shoulder S -> elbow -> wrist at T; stretches beyond reach
      let d = dist(S, T); const reach = up + fore;
      const dir = d > 1e-6 ? [(T[0] - S[0]) / d, (T[1] - S[1]) / d] : [0, -1];
      let stretch = 1;
      if (d > reach) { stretch = Math.min(maxStretch || 1.15, d / reach); d = reach; }
      const dd = Math.max(d, Math.abs(up - fore) + 1e-3);
      const a = clamp((up * up + dd * dd - fore * fore) / (2 * up * dd), -1, 1);
      const h = Math.sqrt(Math.max(0, up * up - (a * up) * (a * up)));
      const along = a * up * stretch;
      const perp = [-dir[1] * side, dir[0] * side];
      out.el = [S[0] + dir[0] * along + perp[0] * h, S[1] + dir[1] * along + perp[1] * h];
      out.wr = [S[0] + dir[0] * dd * stretch, S[1] + dir[1] * dd * stretch];
      out.stretch = stretch;
      out.ext = dist(S, out.wr) / reach;
      return out;
    }

    _solve(P) {
      const R = this.rest, J = {};
      const rot = (p, o, a) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + x * c - y * s, o[1] + x * s + y * c]; };
      const rel = (name, o, oRest, a) => rot([R[name][0] - oRest[0] + o[0], R[name][1] - oRest[1] + o[1]], o, a);
      // pelvis + hips
      J.pelvis = [R.pelvis[0] + P.px, R.pelvis[1] + P.py];
      const hipRot = P.torsoRot * 0.25 + P.hipTwist * 0.2;
      J.hipR = rel('hipR', J.pelvis, R.pelvis, hipRot); J.hipL = rel('hipL', J.pelvis, R.pelvis, hipRot);
      // torso: waist above pelvis, chest/shoulders/neck rotate about the waist; breathing scales the torso
      J.waist = rel('waist', J.pelvis, R.pelvis, hipRot);
      const tr = P.torsoRot, br = P.breath;
      const torsoPt = n => { const p = [R[n][0] - R.waist[0], (R[n][1] - R.waist[1]) * br]; return rot([J.waist[0] + p[0] * br, J.waist[1] + p[1]], J.waist, tr); };
      J.chest = torsoPt('chest'); J.neck = torsoPt('neck'); J.shR = torsoPt('shR'); J.shL = torsoPt('shL');
      // shoulders: shrug lifts both, the walking roll alternates them
      J.shR[1] -= P.shrug * 7 + P.roll * 4; J.shL[1] -= P.shrug * 7 - P.roll * 4;
      J.shR[0] += P.roll * 2; J.shL[0] += P.roll * 2;
      // the punching shoulder drives toward the target
      J.shR[0] += P.sfRx; J.shR[1] += P.sfRy; J.shL[0] += P.sfLx; J.shL[1] += P.sfLy;
      // head rotates about the neck
      const hr = P.headRot + tr;
      const headPt = n => { const p = rot([R[n][0] - R.neck[0] + J.neck[0], R[n][1] - R.neck[1] + J.neck[1]], J.neck, hr); p[0] += P.headDx; return p; };
      J.headTop = headPt('headTop'); J.headC = headPt('headC'); J.ponyRoot = headPt('ponyRoot');
      // ponytail: secondary spring rotates the tip about its root
      J.ponyTip = rot([R.ponyTip[0] - R.ponyRoot[0] + J.ponyRoot[0], R.ponyTip[1] - R.ponyRoot[1] + J.ponyRoot[1]], J.ponyRoot, hr + this.pony.a);
      // arms: wrist target sits one glove-offset back from the wanted glove centre, along the reach direction
      const arm = (h, S, gx, gy, extraRot) => {
        const ch = this.chain[h], wrR = R['wr' + h], glR = R['gl' + h];
        const off = [glR[0] - wrR[0], glR[1] - wrR[1]], offLen = Math.hypot(off[0], off[1]);
        const restFore = ang(R['el' + h], wrR);
        // rest-relative: if the glove is near its rest spot keep the exact rest geometry (image stays intact)
        const gd = Math.hypot(gx - glR[0], gy - glR[1]);
        const w = smoothstep((gd - 14) / 60);
        // wrist target for IK: glove centre minus the rest offset rotated to the reach direction
        const rr0 = ang(S, [gx, gy]) - ang(R['sh' + h], glR), restReach = Math.atan2(Math.sin(rr0), Math.cos(rr0)); // wrapped to +-pi
        const offR = rot([off[0], off[1]], [0, 0], restReach * w);
        const T = [gx - offR[0], gy - offR[1]];
        const o = this._ik(S, T, ch.up, ch.fore, ch.side, {}, this.pose['ms' + h]);
        // rigid guard: rest offsets + translation by the glove delta
        const dgx = gx - glR[0], dgy = gy - glR[1];
        const rigidEl = [R['el' + h][0] + dgx * 0.5 + (S[0] - R['sh' + h][0]) * 0.5, R['el' + h][1] + dgy * 0.5 + (S[1] - R['sh' + h][1]) * 0.5];
        const rigidWr = [wrR[0] + dgx, wrR[1] + dgy];
        // blend rigid-guard vs IK as elbow position + forearm ANGLE/LENGTH (never two free points, so the
        // forearm can neither collapse nor flip), then smooth those the same way. The striking arm is
        // exact (a = 1): it must reach v.target at the end of 'strike'.
        const lerpAng = (a0, a1, k) => a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * k;
        let el = [lerp(rigidEl[0], o.el[0], w), lerp(rigidEl[1], o.el[1], w)];
        let fa0 = lerpAng(ang(rigidEl, rigidWr), ang(o.el, o.wr), w), fl = lerp(ch.fore, dist(o.el, o.wr), w);
        const js = this.jsm, a = this.armSnap === h ? 1 : 1 - Math.exp(-this.dt / 90);
        if (!js['el' + h]) { js['el' + h] = el; js['fa' + h] = fa0; js['fl' + h] = fl; }
        else {
          const pe = js['el' + h]; el = [pe[0] + (el[0] - pe[0]) * a, pe[1] + (el[1] - pe[1]) * a];
          fa0 = lerpAng(js['fa' + h], fa0, a); fl = lerp(js['fl' + h], fl, a);
          js['el' + h] = el; js['fa' + h] = fa0; js['fl' + h] = fl;
        }
        let wr = [el[0] + Math.cos(fa0) * fl, el[1] + Math.sin(fa0) * fl];
        // glove centre follows the forearm direction (+ optional droop rotation)
        const fa = ang(el, wr) - restFore + extraRot;
        const go = rot([off[0], off[1]], [0, 0], fa);
        let gl = [wr[0] + go[0], wr[1] + go[1]];
        let stretch = lerp(1, o.stretch, w);
        // LINE MODE (punches): a punch thrown at the camera is a foreshortened arm, not a bent one.
        // Elbow and wrist sit on the shoulder->glove line (elbow behind the fist, glove leading), the
        // bones compress or stretch along it, the glove lands exactly on its goal and stays attached
        // to the forearm even when the goal is beyond the arm's reach.
        const lk = this.pose['line' + h] || 0;
        if (lk > 0.001) {
          const reach = ch.up + ch.fore, ms = this.pose['ms' + h] || 1.15;
          const dgl = Math.hypot(gx - S[0], gy - S[1]) || 1, ux = (gx - S[0]) / dgl, uy = (gy - S[1]) / dgl;
          const wd = clamp(dgl - offLen, reach * 0.3, reach * ms);
          const lel = [S[0] + ux * wd * ch.up / reach, S[1] + uy * wd * ch.up / reach], lwr = [S[0] + ux * wd, S[1] + uy * wd];
          // glove exactly on its goal while the arm can reach it (a near goal just tucks the forearm stub
          // under the big glove); beyond reach it stays one glove-offset ahead of the wrist
          const lgl = dgl - offLen <= reach * ms ? [gx, gy] : [lwr[0] + ux * offLen, lwr[1] + uy * offLen];
          el = [lerp(el[0], lel[0], lk), lerp(el[1], lel[1], lk)]; wr = [lerp(wr[0], lwr[0], lk), lerp(wr[1], lwr[1], lk)]; gl = [lerp(gl[0], lgl[0], lk), lerp(gl[1], lgl[1], lk)];
          stretch = lerp(stretch, wd / reach, lk);
        }
        J['el' + h] = el; J['wr' + h] = wr; J['gl' + h] = gl;
        return { ext: dist(S, wr) / (ch.up + ch.fore), stretch, w, fa };
      };
      const aR = arm('R', J.shR, P.gRx, P.gRy, P.gRrot), aL = arm('L', J.shL, P.gLx, P.gLy, P.gLrot);
      // legs: feet at their (shuffled) targets, knees from IK; knee bend "lift" lowers the pelvis
      const leg = (h, hip, fx, fy) => {
        const ch = this.chain['leg' + h], ankR = R['ank' + h], toeR = R['toe' + h];
        const o = this._ik(hip, [fx, fy], ch.up, ch.fore, ch.side, {});
        J['knee' + h] = o.el; J['ank' + h] = o.wr;
        const ta = ang(J['knee' + h], J['ank' + h]) - ang(R['knee' + h], ankR);
        const off = rot([toeR[0] - ankR[0], toeR[1] - ankR[1]], [0, 0], ta * 0.35);
        J['toe' + h] = [J['ank' + h][0] + off[0], J['ank' + h][1] + off[1]];
        return o;
      };
      const lR = leg('R', J.hipR, P.fRx, P.fRy), lL = leg('L', J.hipL, P.fLx, P.fLy);
      return { J, aR, aL, lR, lL };
    }

    // ---------------------------------------------------------------- drawing
    draw(ctx, v) {
      v = v || {};
      const t = v.t || 0;
      let dt = v.dt; if (dt == null) dt = this.prevT == null ? 16 : t - this.prevT; dt = clamp(dt, 0, 100); this.prevT = t;
      // leaving 'ko' means a new fight: hard-reset the smoothed pose instead of un-falling over a few frames
      if (this.lastState === 'ko' && v.state !== 'ko') { this.pose = null; this.jsm = {}; this.pony = { a: 0, va: 0, lastHx: null }; this.hem = { a: 0, va: 0, last: null }; }
      this.lastState = v.state;
      this.dt = dt;
      const G = this._goals(v);
      this._smooth(G.g, dt, G.snap);
      const P = this.pose;
      const ds = dt / 1000;
      // ponytail spring (secondary motion): driven by head sideways velocity + idle sway
      const hx = P.headDx + P.px + P.torsoRot * 60 + P.headRot * 40;
      const hv = this.pony.lastHx == null ? 0 : (hx - this.pony.lastHx) / Math.max(1, dt);
      this.pony.lastHx = hx;
      { const rest = Math.sin(t / 700) * 0.09 + P.bodyRot * 0.5;
        this.pony.va += (-(this.pony.a - rest) * 90 - this.pony.va * 9) * ds - hv * 1.4; this.pony.a += this.pony.va * ds; this.pony.a = clamp(this.pony.a, -1.2, 1.2); }
      // shorts hem spring: the hem lags behind the pelvis' sideways motion (a shear below the hem line)
      { const H = this.hem, px = P.px + P.dx, pv = H.last == null ? 0 : (px - H.last) / Math.max(1, dt); H.last = px;
        H.va += (-H.a * 140 - H.va * 11) * ds - pv * 0.7; H.a += H.va * ds; H.a = clamp(H.a, -0.35, 0.35); }
      this.armSnap = G.snap ? G.hand : null;
      const S = this._solve(P), J = S.J;
      const img = global.ASSETS && global.ASSETS.get ? global.ASSETS.get('boxer') : null;
      if (img && (!this.cache || this.cache.img !== img)) this._buildCache(img);
      const hand = G.hand || this.last.hand;
      const big = G.big && P['g' + hand + 'r'] > GLOVE_R * 1.35;
      const order = big ? this.orderBig[hand] : this.order;

      // per-part dynamic scale / overlays (persistent objects: no per-frame allocation)
      const flexR = smoothstep((S.aR.ext - 0.72) / 0.28), flexL = smoothstep((S.aL.ext - 0.72) / 0.28);
      const liftR = clamp((this.rest.ankR[1] - P.fRy) / 14, 0, 1), liftL = clamp((this.rest.ankL[1] - P.fLy) / 14, 0, 1);
      const dyn = this.dyn;
      const fsR = 1 + 0.45 * Math.max(0, 1 - S.aR.stretch), fsL = 1 + 0.45 * Math.max(0, 1 - S.aL.stretch); // foreshortened bones look thicker
      dyn.upperArmR.perp = (1 + 0.12 * flexR) * fsR; dyn.upperArmR.len = S.aR.stretch; dyn.upperArmR.hi = flexR;
      dyn.upperArmL.perp = (1 + 0.12 * flexL) * fsL; dyn.upperArmL.len = S.aL.stretch; dyn.upperArmL.hi = flexL;
      dyn.forearmR.perp = (1 + 0.25 * flexR * clamp((P.gRr - GLOVE_R) / 60, 0, 1)) * fsR; dyn.forearmR.len = S.aR.stretch;
      dyn.forearmL.perp = (1 + 0.25 * flexL * clamp((P.gLr - GLOVE_R) / 60, 0, 1)) * fsL; dyn.forearmL.len = S.aL.stretch;
      dyn.gloveR.uni = P.gRr / GLOVE_R; dyn.gloveL.uni = P.gLr / GLOVE_R;
      dyn.thighR.perp = 1 + 0.08 * liftR; dyn.thighR.hi = liftR * 0.8 + P.lift * 0.5;
      dyn.thighL.perp = 1 + 0.08 * liftL; dyn.thighL.hi = liftL * 0.8 + P.lift * 0.5;
      dyn.torso.len = dist(J.waist, J.neck) / this.torsoLen; dyn.torso.perp = 1 + (P.breath - 1) * 0.8;
      dyn.torso.sheen = img ? null : (Math.sin(t / 900) + 1) / 2;   // the lighting pass does this on the image
      this.face = P.face;
      // hit reaction: echo/radial blur of the head during the first 100ms after a hit
      const ha = v.hurtAge == null ? 1e9 : v.hurtAge;
      const echo = ha >= 0 && ha < 100 && v.state !== 'ko' ? 1 - ha / 100 : 0, hdir = v.hurtHand === 'L' ? 1 : -1;
      const kd = big ? clamp((P['g' + hand + 'r'] - GLOVE_R) / 80, 0, 1) : 0;   // how far the glove flies at the camera

      // whole-body transform: hurt shift, KO fall (about the feet), squash
      const cB = Math.cos(P.bodyRot), sB = Math.sin(P.bodyRot), bsx = P.bodyScale, bsy = P.bodyScale * P.squash;
      const bodyX = p => (p[0] * cB - p[1] * sB) * bsx + P.dx, bodyY = p => (p[0] * sB + p[1] * cB) * bsy - P.koLift;
      // local-space bounding box of the posed figure (for the screen-space layer)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n in J) { const p = J[n], bx = bodyX(p), by = bodyY(p); if (bx < x0) x0 = bx; if (bx > x1) x1 = bx; if (by < y0) y0 = by; if (by > y1) y1 = by; }
      const mg = Math.max(110, P.gRr * 2.6, P.gLr * 2.6); x0 -= mg; x1 += mg; y0 -= mg; y1 += mg * 0.6;

      const M = ctx.getTransform();
      const sc = Math.hypot(M.a, M.b) || 1;
      // (1) soft contact shadow under the feet, in local units; it stretches toward the camera (down the
      // screen) as the caller scales her up, and shrinks/fades when she leaves the ground
      this._contactShadow(ctx, P, sc);

      // assemble the parts into a screen-space layer so the lighting can be applied source-atop
      const cw = ctx.canvas ? ctx.canvas.width : 4096, chh = ctx.canvas ? ctx.canvas.height : 4096;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      for (let i = 0; i < 4; i++) {
        const lx = i & 1 ? x1 : x0, ly = i & 2 ? y1 : y0, X = M.a * lx + M.c * ly + M.e, Y = M.b * lx + M.d * ly + M.f;
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
      }
      bx0 = Math.floor(Math.max(bx0, -2)); by0 = Math.floor(Math.max(by0, -2)); bx1 = Math.ceil(Math.min(bx1, cw + 2)); by1 = Math.ceil(Math.min(by1, chh + 2));
      const lw = bx1 - bx0, lh = by1 - by0;
      if (lw > 0 && lh > 0 && isFinite(lw) && isFinite(lh)) {
        const q = Math.min(1, LAYER_MAX / lw, LAYER_MAX / lh), pw = Math.ceil(lw * q), ph = Math.ceil(lh * q);
        if (!this.layer) {
          this.layer = document.createElement('canvas'); this.rim = document.createElement('canvas');
          this.lc = this.layer.getContext('2d'); this.rc = this.rim.getContext('2d');
        }
        if (this.layer.width < pw || this.layer.height < ph) {
          this.layer.width = this.rim.width = Math.min(LAYER_MAX, Math.max(this.layer.width, pw));
          this.layer.height = this.rim.height = Math.min(LAYER_MAX, Math.max(this.layer.height, ph));
          this.keyGrad = null;
        }
        const lc = this.lc, rc = this.rc;
        lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.clearRect(0, 0, pw, ph);
        lc.setTransform(q * M.a, q * M.b, q * M.c, q * M.d, q * (M.e - bx0), q * (M.f - by0));
        lc.save();
        lc.translate(P.dx, -P.koLift); lc.rotate(P.bodyRot); lc.scale(bsx, bsy);
        for (let i = 0; i < order.length; i++) {
          const name = order[i];
          if (kd > 0.02 && name === 'glove' + hand) {
            // (2) depth on the striking arm: blurred dark shadow behind the glove, then a hotter copy on top
            lc.save(); lc.globalAlpha = 0.55 * kd; lc.translate(14 * kd, 20 * kd); this._part(lc, name, J, dyn[name] || NODYN, img,1); lc.restore();
            this._part(lc, name, J, dyn[name] || NODYN, img,0);
            lc.save(); lc.globalAlpha = 0.7 * kd; this._part(lc, name, J, dyn[name] || NODYN, img,2); lc.restore();
          } else if (echo > 0 && name === 'head') {
            // (5) head echo: three fading copies radiating away from the head centre along the hit
            const hc = J.headC;
            for (let e = 3; e >= 1; e--) {
              lc.save(); lc.globalAlpha = 0.26 * echo * (1 - e * 0.22);
              lc.translate(hc[0], hc[1]); lc.scale(1 + 0.05 * e * echo, 1 + 0.05 * e * echo); lc.translate(-hc[0] + hdir * 8 * e * echo, -hc[1] - 2 * e * echo);
              this._part(lc, name, J, dyn[name] || NODYN, img,0); lc.restore();
            }
            this._part(lc, name, J, dyn[name] || NODYN, img,0);
          } else this._part(lc, name, J, dyn[name] || NODYN, img,0);
        }
        if (P.stars > 0.05) this._stars(lc, J, t, P.stars);
        lc.restore();
        if (this.lighting) {
          // (3) key light: warm from the upper-left, cool from the right, source-atop so her own shading stays
          if (!this.keyGrad) {
            const g = lc.createLinearGradient(-170, -440, 220, -60);
            g.addColorStop(0, 'rgba(255,206,150,0.22)'); g.addColorStop(0.42, 'rgba(255,206,150,0)'); g.addColorStop(0.6, 'rgba(70,110,255,0)'); g.addColorStop(1, 'rgba(70,110,255,0.24)');
            this.keyGrad = g;
          }
          lc.globalCompositeOperation = 'source-atop'; lc.fillStyle = this.keyGrad; lc.fillRect(x0, y0, x1 - x0, y1 - y0);
          // rim light: the layer minus a copy shifted left/down leaves a crescent on the right/top edge
          const rpx = clamp(3.4 * sc * q, 1, 8);
          rc.setTransform(1, 0, 0, 1, 0, 0); rc.globalAlpha = 1;
          rc.globalCompositeOperation = 'copy'; rc.drawImage(this.layer, 0, 0, pw, ph, 0, 0, pw, ph);
          rc.globalCompositeOperation = 'destination-out'; rc.drawImage(this.layer, 0, 0, pw, ph, -rpx, rpx * 0.55, pw, ph);
          rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#cfe0ff'; rc.fillRect(0, 0, pw, ph);
          rc.globalCompositeOperation = 'source-over';
          lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 0.62; lc.drawImage(this.rim, 0, 0, pw, ph, 0, 0, pw, ph); lc.globalAlpha = 1;
        }
        lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.layer, 0, 0, pw, ph, bx0, by0, lw, lh); ctx.restore();
      }

      const headY = bodyY(J.headC);
      let cue = null;
      if (G.cue && hand) { const gl = J['gl' + hand]; cue = { x: bodyX(gl), y: bodyY(gl), r: P['g' + hand + 'r'] * P.bodyScale }; }
      return { cue, headY, joints: J };
    }

    _contactShadow(ctx, P, sc) {
      if (!this.shadowGrad) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)'); this.shadowGrad = g; }
      const st = clamp(sc / 0.9, 0.7, 1.8);                 // bigger on screen = closer to the camera
      const air = clamp(-(P.py - 4) / 34, 0, 1);            // jumps (taunt) lift her off the ground
      const fall = Math.abs(Math.sin(P.bodyRot));
      const rx = (100 + 40 * air * 0 + 150 * fall) * (1 - 0.25 * air), ry = (12 + 10 * st) * (1 - 0.3 * air) * (1 + 0.3 * fall);
      const cx = P.dx * 0.5 + P.px * 0.3 + Math.sin(P.bodyRot) * 150, cy = 3 + 7 * (st - 1) + 4 * air;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry); ctx.globalAlpha = 1 - 0.55 * air; ctx.fillStyle = this.shadowGrad; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    }

    _part(ctx, name, J, dyn, img, mode) {
      const p = this.table.parts[name]; if (!p) return;
      const R = this.rest, A = J[p.bone[0]], B = J[p.bone[1]], piv = J[p.pivot || p.bone[0]], pivRest = R[p.pivot || p.bone[0]];
      if (!A || !B || !piv) return;
      const aCur = ang(A, B), aRest = ang(R[p.bone[0]], R[p.bone[1]]);
      ctx.save();
      if (this.explode) { const c = this.partCentre[name]; ctx.translate(c[0] * this.explode, c[1] * this.explode); }
      ctx.translate(piv[0], piv[1]);
      ctx.rotate(aCur);
      const u = dyn.uni || 1;
      ctx.scale((dyn.len || 1) * u, (dyn.perp || 1) * u);
      ctx.rotate(-aRest);
      ctx.translate(-pivRest[0], -pivRest[1]);
      // now in rest-pose local units
      const e = img && this.cache ? this.cache.parts[name] : null;
      if (e) this._imgPart(ctx, p, e, mode ? EMPTY : this._overlays(name, dyn), mode);
      else if (!mode) this._fallbackPart(ctx, name, this._overlays(name, dyn));
      ctx.restore();
    }

    // soft specular highlights (muscle) and the abs sheen, authored in rest-pose local units
    _overlays(name, dyn) {
      const R = this.rest;
      const spot = (x, y, rx, ry, a, rotA) => c => { c.save(); c.translate(x, y); c.rotate(rotA || 0); c.scale(rx, ry); const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore(); };
      if (dyn.hi > 0.02 && (name === 'upperArmR' || name === 'upperArmL')) {
        const h = name === 'upperArmR' ? 'R' : 'L', S = R['sh' + h], E = R['el' + h];
        return [spot(S[0], S[1] + 6, 16, 12, 0.34 * dyn.hi),                                                       // deltoid
                spot(lerp(S[0], E[0], 0.55), lerp(S[1], E[1], 0.55), 10, 20, 0.26 * dyn.hi, ang(S, E) + Math.PI / 2)]; // biceps
      }
      if (dyn.hi > 0.02 && (name === 'thighR' || name === 'thighL')) {
        const h = name === 'thighR' ? 'R' : 'L', H = R['hip' + h], K = R['knee' + h];
        return [spot(lerp(H[0], K[0], 0.45), lerp(H[1], K[1], 0.45), 13, 26, 0.24 * dyn.hi, ang(H, K) + Math.PI / 2)]; // quad
      }
      if (dyn.sheen != null && name === 'torso') {
        const y0 = lerp(R.chest[1] + 10, R.waist[1] - 10, dyn.sheen), x0 = R.waist[0];
        return [c => { c.save(); const g = c.createLinearGradient(x0 - 40, y0 - 22, x0 + 40, y0 + 22); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.075)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x0 - 60, y0 - 40, 120, 80); c.restore(); }];
      }
      return EMPTY;
    }

    // ---------------------------------------------------------------- image parts (cached cutouts)
    // mask path of a part in SOURCE pixels (the context is expected to be in source-pixel space)
    _maskPath(c, name) {
      const p = this.table.parts[name], Jp = this.table.joints, r = p.rect;
      c.beginPath();
      if (p.mask === 'poly' && p.pts && p.pts.length > 2) { for (let i = 0; i < p.pts.length; i++) { const q = p.pts[i]; if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); } c.closePath(); }
      else if (p.mask === 'capsule') {
        const A = Jp[p.bone[0]], B = Jp[p.bone[1]], cap = p.cap || [40, 40, 20, 20];
        const d = ang(A, B), ux = Math.cos(d), uy = Math.sin(d), n = d + Math.PI / 2;
        c.arc(A[0] - ux * cap[2], A[1] - uy * cap[2], cap[0], n, n + Math.PI);
        c.arc(B[0] + ux * cap[3], B[1] + uy * cap[3], cap[1], n + Math.PI, n + TAU);
        c.closePath();
      }
      else if (p.mask === 'ellipse') c.ellipse(r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] / 2, r[3] / 2, 0, 0, TAU);
      else c.rect(r[0], r[1], r[2], r[3]);
    }

    // Cut every part out of the image once: mask it, remove what a later occluder covers and re-fill
    // that from the part itself, and pre-build the striking glove's blurred shadow + "hot" copy.
    _buildCache(img) {
      const T = this.table, names = this.order, parts = {};
      const occl = names.filter(n => T.parts[n].occluder);
      const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
      for (let i = 0; i < names.length; i++) {
        const name = names[i], p = T.parts[name], sx = p.rect[0], sy = p.rect[1], sw = p.rect[2], sh = p.rect[3];
        const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
        const c = cv.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        c.translate(-sx, -sy);
        if (p.mask) { c.globalCompositeOperation = 'destination-in'; this._maskPath(c, name); c.fill(); c.globalCompositeOperation = 'source-over'; }
        const later = occl.filter(o => o !== name && names.indexOf(o) > i && overlap(p.rect, T.parts[o].rect));
        if (later.length) {
          let before = null;
          try { before = c.getImageData(0, 0, sw, sh); } catch (err) { before = null; } // tainted (file://): keep the covered pixels rather than cut holes
          if (before) {
            c.globalCompositeOperation = 'destination-out';
            for (const o of later) { this._maskPath(c, o); c.fill(); }
            c.globalCompositeOperation = 'source-over';
            const after = c.getImageData(0, 0, sw, sh);
            inpaint(before, after, sw, sh, p.sym != null ? p.sym - sx : -1);
            c.putImageData(after, 0, 0);
          }
        }
        c.setTransform(1, 0, 0, 1, 0, 0);
        const e = { cv, sx, sy, sw, sh, pad: 0, shadow: null, hot: null };
        if (p.glove) {
          const pad = 30, W = sw + 2 * pad, H = sh + 2 * pad;
          const sil = document.createElement('canvas'); sil.width = W; sil.height = H;
          const s = sil.getContext('2d'); s.drawImage(cv, pad, pad); s.globalCompositeOperation = 'source-in'; s.fillStyle = '#000'; s.fillRect(0, 0, W, H);
          const bl = document.createElement('canvas'); bl.width = W; bl.height = H;
          const b = bl.getContext('2d'); b.filter = 'blur(11px)'; b.drawImage(sil, 0, 0); b.filter = 'none';
          e.shadow = bl; e.pad = pad;
          const hot = document.createElement('canvas'); hot.width = sw; hot.height = sh;
          const hc = hot.getContext('2d'); hc.filter = 'contrast(1.22) saturate(1.4) brightness(1.03)'; hc.drawImage(cv, 0, 0); hc.filter = 'none';
          e.hot = hot;
        }
        parts[name] = e;
      }
      this.cache = { img, parts };
    }

    _imgPart(ctx, p, e, ov, mode) {
      const I = this.img, k = this.k;
      const dx = (e.sx - I.cx) * k, dy = (e.sy - I.feetY) * k, dw = e.sw * k, dh = e.sh * k;
      if (mode === 1) { if (e.shadow) { const pd = e.pad * k; ctx.drawImage(e.shadow, dx - pd, dy - pd, dw + 2 * pd, dh + 2 * pd); } return; }
      if (mode === 2) { if (e.hot) ctx.drawImage(e.hot, dx, dy, dw, dh); return; }
      if (p.hem != null && !ov.length) {
        // (4) shorts: rigid above the hem line, sheared below it by the hem spring (continuous at the line)
        const hy = clamp(Math.round(p.hem - e.sy), 1, e.sh - 1), hl = dy + hy * k;
        ctx.drawImage(e.cv, 0, 0, e.sw, hy, dx, dy, dw, hy * k);
        ctx.save(); ctx.translate(0, hl); ctx.transform(1, 0, this.hem.a, 1, 0, 0); ctx.translate(0, -hl);
        ctx.drawImage(e.cv, 0, hy, e.sw, e.sh - hy, dx, hl, dw, (e.sh - hy) * k);
        ctx.restore();
        return;
      }
      if (!ov.length) { ctx.drawImage(e.cv, dx, dy, dw, dh); return; }
      // overlays must only tint opaque pixels: paint them source-atop on a scratch copy of the part
      if (!this.scratch) { this.scratch = document.createElement('canvas'); }
      const sc = this.scratch; if (sc.width < e.sw || sc.height < e.sh) { sc.width = Math.max(sc.width, e.sw); sc.height = Math.max(sc.height, e.sh); }
      const c = sc.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, e.sw, e.sh);
      c.drawImage(e.cv, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      c.setTransform(1 / k, 0, 0, 1 / k, I.cx - e.sx, I.feetY - e.sy); // local units -> scratch px
      for (const f of ov) f(c);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
      ctx.drawImage(sc, 0, 0, e.sw, e.sh, dx, dy, dw, dh);
    }

    // ---------------------------------------------------------------- procedural silhouette
    _fallbackPart(ctx, name, ov) {
      const R = this.rest;
      const capsule = (a, b, r0, r1) => { // tapered capsule from a (radius r0) to b (radius r1)
        const d = ang(a, b), n = d + Math.PI / 2;
        ctx.beginPath();
        ctx.arc(a[0], a[1], r0, n, n + Math.PI);
        ctx.arc(b[0], b[1], r1, n + Math.PI, n + TAU);
        ctx.closePath();
      };
      const shade = (a, b, r, base, dark) => { const g = ctx.createLinearGradient(a[0] - r, a[1], a[0] + r, a[1]); g.addColorStop(0, dark); g.addColorStop(0.45, base); g.addColorStop(1, dark); return g; };
      const sil = (fn) => { for (const f of ov) { ctx.save(); fn(); ctx.clip(); f(ctx); ctx.restore(); } };
      const face = this.face || 'calm';
      switch (name) {
        case 'ponytail': {
          const a = R.ponyRoot, b = R.ponyTip;
          capsule(a, b, 13, 7); ctx.fillStyle = COL.hair; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0] + 4, a[1] + 8); ctx.lineTo(b[0] + 1, b[1] - 6); ctx.stroke();
          ctx.fillStyle = COL.red; ctx.beginPath(); ctx.ellipse(a[0] + 2, a[1] + 4, 5, 4, ang(a, b), 0, TAU); ctx.fill();
          break;
        }
        case 'thighR': case 'thighL': {
          const h = name[5], a = R['hip' + h], b = R['knee' + h];
          const path = () => capsule(a, b, 24, 15);
          path(); ctx.fillStyle = shade(a, b, 24, COL.skin, COL.skinDark); ctx.fill(); sil(path);
          break;
        }
        case 'shinR': case 'shinL': {
          const h = name[4], a = R['knee' + h], b = R['ank' + h];
          const path = () => capsule(a, b, 15, 10);
          path(); ctx.fillStyle = shade(a, b, 15, COL.skin, COL.skinDark); ctx.fill(); sil(path);
          // sock
          ctx.fillStyle = COL.white; ctx.beginPath(); ctx.ellipse(b[0], b[1] - 4, 11, 8, ang(a, b), 0, TAU); ctx.fill();
          break;
        }
        case 'shoeR': case 'shoeL': {
          const h = name[4], a = R['ank' + h], b = R['toe' + h];
          const d = ang(a, b);
          ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(d);
          const L = dist(a, b);
          // high-top: white body, red toe cap and heel stripe, dark sole
          ctx.fillStyle = COL.white; ctx.beginPath(); ctx.roundRect(-12, -14, L + 16, 28, 11); ctx.fill();
          ctx.fillStyle = COL.red; ctx.beginPath(); ctx.roundRect(L - 14, -12, 18, 24, 8); ctx.fill();
          ctx.fillStyle = COL.red; ctx.fillRect(-8, -14, 6, 28);
          ctx.fillStyle = COL.black; ctx.beginPath(); ctx.roundRect(-12, 8, L + 16, 7, 3); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(2 + i * 8, -10); ctx.lineTo(6 + i * 8, -2); } ctx.stroke();
          ctx.restore();
          break;
        }
        case 'hips': {
          const w = R.waist, p = R.pelvis, hipR = R.hipR, hipL = R.hipL;
          const path = () => { ctx.beginPath(); ctx.moveTo(w[0] - 40, w[1] - 4); ctx.lineTo(w[0] + 40, w[1] - 4); ctx.quadraticCurveTo(hipL[0] + 34, p[1], hipL[0] + 30, hipL[1] + 26); ctx.lineTo(hipL[0] - 22, hipL[1] + 26); ctx.lineTo(p[0], p[1] + 30); ctx.lineTo(hipR[0] + 22, hipR[1] + 26); ctx.lineTo(hipR[0] - 30, hipR[1] + 26); ctx.quadraticCurveTo(hipR[0] - 34, p[1], w[0] - 40, w[1] - 4); ctx.closePath(); };
          path(); const g = ctx.createLinearGradient(w[0] - 60, 0, w[0] + 60, 0); g.addColorStop(0, '#141418'); g.addColorStop(0.5, COL.black2); g.addColorStop(1, '#141418'); ctx.fillStyle = g; ctx.fill();
          ctx.save(); path(); ctx.clip();
          ctx.fillStyle = COL.red; ctx.fillRect(w[0] - 60, w[1] - 4, 120, 9);            // waistband
          ctx.fillStyle = COL.white; ctx.fillRect(w[0] - 60, w[1] + 5, 120, 3);
          ctx.strokeStyle = COL.red; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(hipR[0] - 30, hipR[1] + 30); ctx.lineTo(hipR[0] - 12, w[1] + 8); ctx.moveTo(hipL[0] + 30, hipL[1] + 30); ctx.lineTo(hipL[0] + 12, w[1] + 8); ctx.stroke(); // side stripes
          ctx.strokeStyle = COL.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hipR[0] - 24, hipR[1] + 30); ctx.lineTo(hipR[0] - 7, w[1] + 8); ctx.moveTo(hipL[0] + 24, hipL[1] + 30); ctx.lineTo(hipL[0] + 7, w[1] + 8); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'torso': {
          const w = R.waist, n = R.neck, c = R.chest, shR = R.shR, shL = R.shL;
          const path = () => { ctx.beginPath(); ctx.moveTo(n[0] - 14, n[1]); ctx.quadraticCurveTo(shR[0] - 8, shR[1] - 14, shR[0] - 14, shR[1] + 8); ctx.quadraticCurveTo(w[0] - 44, c[1] + 40, w[0] - 36, w[1] + 6); ctx.lineTo(w[0] + 36, w[1] + 6); ctx.quadraticCurveTo(w[0] + 44, c[1] + 40, shL[0] + 14, shL[1] + 8); ctx.quadraticCurveTo(shL[0] + 8, shL[1] - 14, n[0] + 14, n[1]); ctx.closePath(); };
          path(); const g = ctx.createLinearGradient(w[0] - 60, 0, w[0] + 60, 0); g.addColorStop(0, COL.skinDark); g.addColorStop(0.42, COL.skin); g.addColorStop(0.6, COL.skin); g.addColorStop(1, COL.skinDark); ctx.fillStyle = g; ctx.fill();
          ctx.save(); path(); ctx.clip();
          // sports bra
          ctx.fillStyle = COL.black; ctx.beginPath(); ctx.moveTo(shR[0] - 4, shR[1] - 10); ctx.lineTo(shR[0] + 22, c[1] + 42); ctx.lineTo(shL[0] - 22, c[1] + 42); ctx.lineTo(shL[0] + 4, shL[1] - 10); ctx.lineTo(shL[0] - 10, shL[1] - 10); ctx.quadraticCurveTo(n[0], c[1] - 20, shR[0] + 10, shR[1] - 10); ctx.closePath(); ctx.fill();
          ctx.fillStyle = COL.red; ctx.fillRect(shR[0] + 18, c[1] + 36, shL[0] - shR[0] - 36, 4);
          // abs line + collarbone hints
          ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w[0], c[1] + 52); ctx.lineTo(w[0], w[1]); ctx.moveTo(w[0] - 22, c[1] + 62); ctx.lineTo(w[0] + 22, c[1] + 62); ctx.moveTo(w[0] - 20, c[1] + 82); ctx.lineTo(w[0] + 20, c[1] + 82); ctx.stroke();
          ctx.restore();
          sil(path);
          break;
        }
        case 'head': {
          const c = R.headC, n = R.neck; const rx = 31, ry = 37;
          // neck
          ctx.fillStyle = COL.skinDark; ctx.beginPath(); ctx.roundRect(n[0] - 13, c[1] + 20, 26, n[1] - c[1] - 8, 6); ctx.fill();
          // face
          ctx.beginPath(); ctx.ellipse(c[0], c[1] + 4, rx, ry, 0, 0, TAU);
          const g = ctx.createRadialGradient(c[0] - 8, c[1] - 8, 6, c[0], c[1], 44); g.addColorStop(0, COL.skinLight); g.addColorStop(0.7, COL.skin); g.addColorStop(1, COL.skinDark); ctx.fillStyle = g; ctx.fill();
          // hair: dark cap pulled back
          ctx.fillStyle = COL.hair; ctx.beginPath(); ctx.ellipse(c[0], c[1] - 14, rx + 3, 26, 0, Math.PI, TAU); ctx.lineTo(c[0] + rx + 3, c[1] - 4); ctx.quadraticCurveTo(c[0] + 12, c[1] - 20, c[0], c[1] - 12); ctx.quadraticCurveTo(c[0] - 12, c[1] - 20, c[0] - rx - 3, c[1] - 4); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c[0] - 16, c[1] - 34); ctx.quadraticCurveTo(c[0] + 6, c[1] - 30, c[0] + 22, c[1] - 14); ctx.stroke();
          // ears
          ctx.fillStyle = COL.skin; ctx.beginPath(); ctx.ellipse(c[0] - rx - 1, c[1] + 4, 5, 8, 0, 0, TAU); ctx.ellipse(c[0] + rx + 1, c[1] + 4, 5, 8, 0, 0, TAU); ctx.fill();
          // eyes / brows / mouth
          const ey = c[1] - 2, ex = 12;
          ctx.strokeStyle = COL.hair; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          ctx.fillStyle = COL.hair;
          if (face === 'x') {
            ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(c[0] + s * ex - 4, ey - 4); ctx.lineTo(c[0] + s * ex + 4, ey + 4); ctx.moveTo(c[0] + s * ex + 4, ey - 4); ctx.lineTo(c[0] + s * ex - 4, ey + 4); } ctx.stroke();
          } else if (face === 'dizzy') {
            ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(c[0] + s * ex - 5, ey); ctx.quadraticCurveTo(c[0] + s * ex, ey - 6, c[0] + s * ex + 5, ey); } ctx.stroke();
          } else if (face === 'ouch') {
            ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(c[0] + s * ex - 5, ey + 1); ctx.lineTo(c[0] + s * ex + 5, ey + 1); } ctx.stroke();
          } else {
            ctx.beginPath(); ctx.ellipse(c[0] - ex, ey, 4.2, face === 'angry' ? 2.8 : 3.6, 0, 0, TAU); ctx.ellipse(c[0] + ex, ey, 4.2, face === 'angry' ? 2.8 : 3.6, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(c[0] - ex + 1.5, ey - 1.5, 1.2, 0, TAU); ctx.arc(c[0] + ex + 1.5, ey - 1.5, 1.2, 0, TAU); ctx.fill();
          }
          // brows
          ctx.beginPath();
          const bl = face === 'angry' ? 4 : face === 'grin' ? -2 : 0;
          ctx.moveTo(c[0] - ex - 7, ey - 10 - bl * 0.3); ctx.lineTo(c[0] - ex + 5, ey - 10 + bl);
          ctx.moveTo(c[0] + ex + 7, ey - 10 - bl * 0.3); ctx.lineTo(c[0] + ex - 5, ey - 10 + bl);
          ctx.stroke();
          // nose + mouth
          ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c[0] - 2, ey + 4); ctx.lineTo(c[0] - 4, ey + 14); ctx.lineTo(c[0] + 2, ey + 15); ctx.stroke();
          ctx.strokeStyle = COL.mouth; ctx.lineWidth = 2.5; ctx.beginPath();
          const my = ey + 24;
          if (face === 'grin') { ctx.moveTo(c[0] - 10, my - 2); ctx.quadraticCurveTo(c[0], my + 9, c[0] + 10, my - 2); }
          else if (face === 'angry') { ctx.moveTo(c[0] - 9, my + 1); ctx.lineTo(c[0] + 9, my + 1); }
          else if (face === 'ouch' || face === 'dizzy' || face === 'x') { ctx.moveTo(c[0] - 6, my + 3); ctx.quadraticCurveTo(c[0], my - 5, c[0] + 6, my + 3); }
          else { ctx.moveTo(c[0] - 8, my); ctx.quadraticCurveTo(c[0], my + 4, c[0] + 8, my); }
          ctx.stroke();
          // mouthguard glint when angry
          if (face === 'angry') { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(c[0] - 7, my - 1, 14, 2.5); }
          break;
        }
        case 'upperArmR': case 'upperArmL': {
          const h = name[8], a = R['sh' + h], b = R['el' + h];
          const path = () => capsule(a, b, 19, 12);
          path(); ctx.fillStyle = shade(a, b, 19, COL.skin, COL.skinDark); ctx.fill();
          // deltoid cap
          ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.arc(a[0], a[1], 19, 0, TAU); ctx.fill();
          sil(path);
          break;
        }
        case 'forearmR': case 'forearmL': {
          const h = name[7], a = R['el' + h], b = R['wr' + h];
          const path = () => capsule(a, b, 12, 11);
          path(); ctx.fillStyle = shade(a, b, 12, COL.skin, COL.skinDark); ctx.fill(); sil(path);
          ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.beginPath(); ctx.arc(a[0], a[1], 11, 0, TAU); ctx.fill(); // elbow
          break;
        }
        case 'gloveR': case 'gloveL': {
          const h = name[5], w = R['wr' + h], gl = R['gl' + h], d = ang(w, gl);
          ctx.save(); ctx.translate(gl[0], gl[1]); ctx.rotate(d + Math.PI / 2);
          // wrist wrap / cuff (white)
          ctx.fillStyle = COL.white; ctx.beginPath(); ctx.roundRect(-15, 14, 30, 16, 5); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(-15, 22, 30, 3);
          // mitt
          const g = ctx.createRadialGradient(-8, -10, 4, 0, 0, 30); g.addColorStop(0, '#dc4a3c'); g.addColorStop(0.55, COL.glove); g.addColorStop(1, COL.gloveDark);
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, GLOVE_R, GLOVE_R * 1.08, 0, 0, TAU); ctx.fill();
          // thumb
          ctx.fillStyle = COL.glove; ctx.beginPath(); ctx.ellipse(h === 'R' ? 20 : -20, 6, 9, 12, h === 'R' ? 0.5 : -0.5, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 2, 18, 0.35, 2.8); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-9, -11, 8, 5, -0.6, 0, TAU); ctx.fill();
          ctx.restore();
          break;
        }
      }
    }

    _stars(ctx, J, t, a) {
      const c = J.headC;
      ctx.save(); ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = COL.gold;
      for (let i = 0; i < 5; i++) {
        const ph = t / 380 + i * TAU / 5, x = c[0] + Math.cos(ph) * 52, y = c[1] - 48 + Math.sin(ph) * 12, s = 5 + Math.sin(ph) * 1.5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t / 300 + i);
        ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? s * 0.45 : s, an = k * Math.PI / 5; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  Opponent.HAND = HAND;
  Opponent.GLOVE_R = GLOVE_R;
  global.Opponent = Opponent;
})(typeof window !== 'undefined' ? window : globalThis);
