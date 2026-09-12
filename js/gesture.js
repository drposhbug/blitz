// gesture.js — turns MediaPipe pose landmarks into fighting inputs.
// Pure logic, no DOM. Coordinates are MediaPipe normalized image coords
// (x right, y down, z toward camera is negative). The display is mirrored,
// so "L" everywhere means the PLAYER'S left, which is screen-left.
//
//   update(lm, t, world) -> [events]
//     lm    : 33 normalized landmarks {x, y, z, visibility}
//     t     : ms
//     world : optional 33 world landmarks in metres (hip-centred, same axes). When present they
//             drive the punch kinematics (m/s) and yaw-correct the depth joystick.
//   state  : { tracking, calibrating, x, z, duck, block, handsUp, sw, ext:{L,R} }
//   events : { type:'calibrated' } | { type:'punch', hand:'L'|'R', power:1..2, kind:'straight'|'hook'|'uppercut' }
//
// Punch rule (per hand, evaluated every frame on a ring buffer of shoulder-relative wrist positions):
//   speed of the wrist relative to its own shoulder over the last ~90 ms  >= punchSpeed (2.2 sw/s, or 1.6 m/s in world space)
//   AND extension gained >= punchDelta (sw) within punchWindow (150 ms)
//   AND the arm is armed (was retracted inside retractExt, or came back 0.5 sw from its last peak)
//   AND wrist visible, above the hips, not blocking, torso not turning, cooldown elapsed.
//   Fires on the rising edge; power = speed / threshold clamped to 1..2; kind from the travel direction.
(function (global) {
  const LM = { NOSE: 0, LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16, LHIP: 23, RHIP: 24 };
  const USED = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  const Z_W = 0.6;      // normalized z is noisier than x/y: weight it down (world z is used as-is)
  const HIST_MS = 400;  // wrist ring buffer length
  const FEAT = ['cx', 'cy', 'sw', 'swc', 'hw', 'hipY'];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const dist3 = (a, b, zw) => Math.hypot(a.x - b.x, a.y - b.y, ((a.z || 0) - (b.z || 0)) * zw);
  const vis = p => (p && typeof p.visibility === 'number') ? p.visibility : 1;
  const isNum = v => v === v; // not NaN
  function median(vals) {
    const s = vals.filter(isNum).sort((a, b) => a - b), n = s.length;
    if (!n) return NaN;
    return n & 1 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  // travel = shoulder-relative wrist displacement over the punch window
  function classify(tr) {
    const lat = Math.abs(tr.x), up = Math.max(0, -tr.y), fwd = Math.max(0, -tr.z);
    if (lat > 1.25 * fwd && lat >= up) return 'hook';
    if (up > 1.25 * fwd && up > lat) return 'uppercut';
    return 'straight';
  }

  class GestureDetector {
    constructor(opts) {
      this.o = Object.assign({
        punchDelta: 0.35,     // extension gain (shoulder widths) inside punchWindow
        punchWindow: 150,     // ms
        punchSpeed: 2.2,      // shoulder-widths / s of the wrist relative to its shoulder (normalized landmarks)
        punchSpeedWorld: 1.6, // m / s when world landmarks are available
        speedWindow: 90,      // ms the speed is measured over (>= 2 frames at 30 fps, ~3 at 25)
        retractExt: 0.9,      // the arm re-arms once the wrist is back inside this many sw of the shoulder
        retractDrop: 0.5,     // ...or once it came back this far (sw) from the peak of the last punch
        punchCooldown: 300,   // ms per hand
        turnRate: 0.25,       // shoulder width changing by this fraction over the median window = torso turning: no punches
        walkRange: 0.28,      // fraction of the frame width that maps to full left/right
        deadMin: 0.03,        // adaptive dead zone bounds for x, in shoulder widths
        deadMax: 0.15,
        depthRange: 0.25,     // +25% apparent width vs baseline = fully forward
        duckThresh: 0.45,     // shoulder-centre drop, in shoulder widths
        duckHip: 0.35,        // hip-centre drop, in shoulder widths
        minVis: 0.5,          // landmarks below this visibility are ignored
        smooth: 0.5,          // EMA factor for landmarks
        median: 5,            // frames in the body-position median filter
        calibFrames: 15,
        drift: 0.01,
      }, opts || {});
      this.reset();
    }

    reset() {
      this.base = null;
      this.samples = [];
      this.sm = null;      // EMA'd normalized landmarks (main.js reads this for the arm rig)
      this.smw = null;     // EMA'd world landmarks
      this.feat = [];      // last N raw body features, for the median filter
      this.m = null;       // median-filtered + lightly smoothed body features
      this.noise = { x: 0, z: 0 };
      this.hist = { L: [], R: [] };
      this.armed = { L: true, R: true };
      this.peak = { L: 0, R: 0 };
      this.lastPunch = { L: -1e9, R: -1e9 };
      this.state = this._neutral();
    }

    calibrate() { this.base = null; this.samples = []; }
    get calibrated() { return !!this.base; }

    _neutral() {
      return { tracking: false, calibrating: !this.base, x: 0, z: 0, duck: false,
        block: false, handsUp: false, sw: 0, ext: { L: 0, R: 0 } };
    }

    _lost() {
      this.sm = null; this.smw = null; this.feat = []; this.m = null;
      this.hist.L.length = 0; this.hist.R.length = 0;
      this.state = this._neutral();
    }

    _ema(prev, raw) {
      const a = this.o.smooth;
      if (!prev) return raw.map(p => ({ x: p.x, y: p.y, z: p.z || 0, visibility: vis(p) }));
      for (const i of USED) {
        const s = prev[i], p = raw[i];
        s.x += (p.x - s.x) * a; s.y += (p.y - s.y) * a; s.z += ((p.z || 0) - s.z) * a; s.visibility = vis(p);
      }
      return prev;
    }

    // lm: array of 33 landmarks, t: ms, world: optional 33 world landmarks (metres). Returns list of discrete events.
    update(rawLm, t, world) {
      const events = [], o = this.o;
      if (!rawLm || rawLm.length < 25) { this._lost(); return events; }
      if (Math.min(vis(rawLm[LM.LSH]), vis(rawLm[LM.RSH])) < o.minVis) { this._lost(); return events; }
      const lm = this.sm = this._ema(this.sm, rawLm);
      const ls = lm[LM.LSH], rs = lm[LM.RSH], nose = lm[LM.NOSE];
      const sw = dist2(ls, rs);
      if (sw < 0.04) { this._lost(); return events; }

      // world landmarks, only when they look sane (both shoulders seen, plausible shoulder width)
      let wl = null;
      if (world && world.length >= 25 && Math.min(vis(world[LM.LSH]), vis(world[LM.RSH])) >= o.minVis &&
          dist3(world[LM.LSH], world[LM.RSH], 1) > 0.15) wl = this.smw = this._ema(this.smw, world);
      else this.smw = null;

      // --- body features from the RAW landmarks: the median filter has to see a glitch frame as a glitch, not an EMA smear of it
      const rls = rawLm[LM.LSH], rrs = rawLm[LM.RSH], rlh = rawLm[LM.LHIP], rrh = rawLm[LM.RHIP];
      const hipsOk = Math.min(vis(rlh), vis(rrh)) >= o.minVis;
      // fraction of a 3D width the camera actually sees (1 = square on, smaller = turned)
      const yaw = (a, b) => clamp(Math.abs(a.x - b.x) / (dist3(a, b, 1) || 1e-6), 0.4, 1);
      const rsw = dist2(rls, rrs);
      const f = {
        cx: (rls.x + rrs.x) / 2, cy: (rls.y + rrs.y) / 2, sw: rsw,
        swc: wl ? rsw / yaw(wl[LM.LSH], wl[LM.RSH]) : rsw,                             // yaw-corrected shoulder width
        hw: hipsOk ? dist2(rlh, rrh) / (wl ? yaw(wl[LM.LHIP], wl[LM.RHIP]) : 1) : NaN,  // yaw-corrected hip width
        hipY: hipsOk ? (rlh.y + rrh.y) / 2 : NaN,
      };
      this.feat.push(f); while (this.feat.length > o.median) this.feat.shift();
      const med = {}; for (const k of FEAT) med[k] = median(this.feat.map(s => s[k]));
      if (!this.m) this.m = Object.assign({}, med);
      else for (const k of FEAT) this.m[k] = !isNum(med[k]) ? NaN : !isNum(this.m[k]) ? med[k] : this.m[k] + (med[k] - this.m[k]) * o.smooth;
      const m = this.m;

      if (!this.base) {
        this.samples.push(Object.assign({}, m));
        if (this.samples.length >= o.calibFrames) {
          const b = {}; for (const k of FEAT) b[k] = median(this.samples.map(s => s[k]));
          this.base = b;
          events.push({ type: 'calibrated' });
        } else {
          const st = this._neutral(); st.tracking = true; st.sw = sw; this.state = st; return events;
        }
      }
      const b = this.base;
      // slow drift of the baseline while roughly neutral
      const near = (v, ref, tol) => isNum(v) && isNum(ref) && Math.abs(v - ref) < tol;
      for (const k of ['cx', 'cy', 'hipY']) if (near(m[k], b[k], 0.15 * sw)) b[k] += (m[k] - b[k]) * o.drift;
      for (const k of ['sw', 'swc', 'hw']) if (near(m[k], b[k], 0.08 * b[k])) b[k] += (m[k] - b[k]) * o.drift;
      // hips came into view after calibration: adopt them while the shoulders are where they were
      if (!isNum(b.hipY) && isNum(m.hipY) && Math.abs(m.cy - b.cy) < 0.15 * sw) { b.hipY = m.hipY; b.hw = m.hw; }

      const st = { tracking: true, calibrating: false, sw, ext: { L: 0, R: 0 } };
      // Where you are standing, as an absolute joystick: x = left/right in the room (mirrored, so
      // screen-right is positive), z = toward the camera (bigger apparent shoulders/hips) positive.
      // Dead zones adapt to the jitter measured while you stand still (never while you walk).
      const dx = m.cx - b.cx;
      if (Math.abs(dx) < 0.25 * o.walkRange) this.noise.x += (Math.min(Math.abs(f.cx - m.cx), 0.2 * sw) - this.noise.x) * 0.05;
      const deadX = clamp(4 * this.noise.x, o.deadMin * sw, o.deadMax * sw);
      st.x = clamp(-Math.sign(dx) * Math.max(0, Math.abs(dx) - deadX) / Math.max(1e-3, o.walkRange - deadX), -1, 1);

      let scale = m.swc / b.swc;                                                   // apparent size vs baseline
      if (hipsOk && b.hw > 0 && isNum(m.hw)) scale = (scale + m.hw / b.hw) / 2;     // hips turn less than shoulders
      const dz = scale - 1;
      if (Math.abs(dz) < 0.25 * o.depthRange) this.noise.z += (Math.min(Math.abs(f.swc - m.swc) / b.swc, 0.2) - this.noise.z) * 0.05;
      const deadZ = clamp(4 * this.noise.z, 0.02, 0.08);
      st.z = clamp(Math.sign(dz) * Math.max(0, Math.abs(dz) - deadZ) / Math.max(1e-3, o.depthRange - deadZ), -1, 1);

      // duck = the torso drops, not the head (a head tilt or a look-down is not a duck)
      const dropS = (m.cy - b.cy) / m.sw, dropH = (m.hipY - b.hipY) / m.sw;
      st.duck = dropS > o.duckThresh || dropH > o.duckHip;

      const lw = lm[LM.LWR], rw = lm[LM.RWR], le = lm[LM.LEL], re = lm[LM.REL];
      // gloves covering the face (hands at the nose, forearms vertical); a normal chin-high guard is not a block
      const glove = (w, e) => dist2(w, nose) < 0.9 * sw && w.y < nose.y + 0.35 * sw && e.y > w.y;
      st.block = glove(lw, le) && glove(rw, re);
      st.handsUp = lw.y < nose.y - 0.4 * sw && rw.y < nose.y - 0.4 * sw;

      // --- punches
      const unit = b.sw * scale; // current apparent shoulder width, resistant to a turning torso
      const turning = this.feat.length >= 3 && Math.abs(f.sw - this.feat[0].sw) / b.sw > o.turnRate;
      const cand = {};
      for (const hand of ['L', 'R']) {
        const wi = hand === 'L' ? LM.LWR : LM.RWR, si = hand === 'L' ? LM.LSH : LM.RSH, hi = hand === 'L' ? LM.LHIP : LM.RHIP;
        const h = this.hist[hand];
        if (vis(rawLm[wi]) < o.minVis) { h.length = 0; continue; }
        const useWorld = !!(wl && vis(world[wi]) >= o.minVis);
        if (h.length && h[h.length - 1].w !== useWorld) h.length = 0; // don't mix coordinate spaces
        let p, ext, thresh;
        if (useWorld) {
          const w = wl[wi], s = wl[si];
          p = { x: w.x - s.x, y: w.y - s.y, z: w.z - s.z };                       // metres
          ext = Math.hypot(p.x, p.y, p.z) / dist3(wl[LM.LSH], wl[LM.RSH], 1);
          thresh = o.punchSpeedWorld;
        } else {
          const w = lm[wi], s = lm[si];
          p = { x: (w.x - s.x) / unit, y: (w.y - s.y) / unit, z: (w.z - s.z) * Z_W / unit }; // shoulder widths
          ext = Math.hypot(p.x, p.y, p.z);
          thresh = o.punchSpeed;
        }
        st.ext[hand] = ext;
        h.push({ t, p, ext, w: useWorld });
        while (h.length && t - h[0].t > HIST_MS) h.shift();
        if (!this.armed[hand]) {
          this.peak[hand] = Math.max(this.peak[hand], ext);
          if (ext < o.retractExt || ext < this.peak[hand] - o.retractDrop) this.armed[hand] = true;
        }
        // newest samples at least speedWindow / punchWindow old
        let vref = null, eref = null;
        for (const s of h) { if (t - s.t >= o.speedWindow) vref = s; if (t - s.t >= o.punchWindow) eref = s; }
        if (!vref || !eref) continue;
        const dt = (t - vref.t) / 1000;
        const v = { x: (p.x - vref.p.x) / dt, y: (p.y - vref.p.y) / dt, z: (p.z - vref.p.z) / dt };
        const speed = Math.hypot(v.x, v.y, v.z);
        const delta = ext - eref.ext;
        const aboveHips = vis(rawLm[hi]) < o.minVis || lm[wi].y < lm[hi].y;
        const ok = this.armed[hand] && delta >= o.punchDelta && speed >= thresh && aboveHips && !st.block && !turning &&
          t - this.lastPunch[hand] >= o.punchCooldown;
        cand[hand] = { ok, v, speed, thresh, travel: { x: p.x - eref.p.x, y: p.y - eref.p.y, z: p.z - eref.p.z } };
      }
      // both arms thrusting the same way at once is the body moving (lunge, lean, stumble), not a punch
      if (cand.L && cand.R && cand.L.ok && cand.R.ok) {
        const a = cand.L.v, c = cand.R.v;
        if ((a.x * c.x + a.y * c.y + a.z * c.z) / (cand.L.speed * cand.R.speed) > 0.8) cand.L.ok = cand.R.ok = false;
      }
      for (const hand of ['L', 'R']) {
        const c = cand[hand]; if (!c || !c.ok) continue;
        this.lastPunch[hand] = t; this.armed[hand] = false; this.peak[hand] = st.ext[hand];
        events.push({ type: 'punch', hand, power: clamp(c.speed / c.thresh, 1, 2), kind: classify(c.travel) });
      }
      this.state = st;
      return events;
    }
  }

  global.GestureDetector = GestureDetector;
  global.POSE_LM = LM;
})(typeof window !== 'undefined' ? window : globalThis);
