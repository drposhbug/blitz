// fitness.js — calorie / activity tracker driven by the player's real movement.
//
// The game feeds per-frame signals (tick) and discrete events (event); this module estimates energy
// spent, keeps a live session, persists finished sessions to localStorage, publishes a live readout for
// the canvas HUD (Fitness.live) and renders a TRAINING LOG panel plus an optional DOM widget. No
// dependencies, no CSS file edits (styles are injected once under the 'fit-' class prefix).
//
// ENERGY MODEL — kinematic MET
// ----------------------------
// Energy is integrated per frame from a metabolic-equivalent estimate with the standard conversion
//   kcal/min = MET * 3.5 * kg / 200      (1 MET = 3.5 ml O2 / kg / min, ~5 kcal per litre of O2)
// Reference rates, ACSM Compendium of Physical Activities (Ainsworth et al. 2011):
//   15100 boxing, in ring, general ................. 12.8 MET   (top of the intensity scale)
//   15120 boxing, sparring .......................... 7.8 MET
//   shadow boxing (15100 family / sports lit.) ...... ~7.5 MET
//   15110 boxing, punching bag ...................... 5.5 MET
//   07040 standing, light effort .................... 2.0 MET   (guard stance, alert)
//   07021 standing quietly .......................... 1.3 MET   (used while the camera has lost you)
//   17152 / 17170 / 17190 / 17200 walking 2.0 / 2.5 / 3.0 / 3.5 mph (0.9 / 1.1 / 1.3 / 1.6 m/s)
//                                                    2.8 / 3.0 / 3.5 / 4.3 MET
// With pose kinematics (webcam):   MET = base + move + arm + crouch + squat
//   base   2.0 while a body is tracked, 1.3 while it is not.
//   move   2.5 * min(1, vHip / 1.3). Walking at 1.3 m/s (3 mph) costs 3.5-4.3 MET, i.e. about +2.5 over
//          standing. vHip = horizontal torso speed in m/s over a 400 ms window, 0.08 m/s noise floor,
//          capped at 2.5 m/s.
//   arm    5.5 * tanh(vArm / 2.2) / tanh(3 / 2.2). vArm = mean wrist speed of both hands over the last
//          2 s (100 ms windows, 0.15 m/s noise floor). Anchors: 0 at rest; a sustained 3 m/s (non-stop
//          shadow boxing) gives +5.5 -> 7.5 MET total, the shadow-boxing / sparring band; ~1.9 m/s (bag
//          work with the feet planted) gives +3.5 -> 5.5 MET = punching bag. Saturates at ~+6.3.
//   crouch +1.0 while the torso is held >= 0.15 m below its standing height (quad / glute isometric,
//          between standing-light 2.0 and calisthenics-light 2.8).
//   squat  +1.5 * clamp(depth / 0.30 m, 0.5, 2) for 6 s after every completed duck / squat cycle, at
//          most three cycles stacked. Physics check: raising 75 kg by 0.30 m at ~22% gross efficiency
//          (concentric + eccentric) is 75 * 9.81 * 0.30 / 0.22 ≈ 1.0 kJ ≈ 0.24 kcal; +1.5 MET for 6 s
//          at 75 kg is 0.20 kcal.
// Without pose (keyboard, tests): move = 2.5 * moving^1.2 (joystick magnitude 0..1; a full stick is a
//   brisk walk), arm = 0, crouch = +1.0 while the duck flag is held, one squat boost per duck press.
// Punches are discrete kinetic work on top of the integral (a 150 ms punch is invisible to a 2 s mean):
//   kcal = 0.5 * m_eff * v^2 / 4184 * 4
//   m_eff = 0.053 * kg (≈ 4 kg at 75 kg: the arm plus the shoulder mass that travels with it; Walilko
//   et al. 2005 measured ~2.9 kg effective mass at the fist alone). x4 for ~25% gross muscular
//   efficiency. v = peak frame-to-frame wrist speed in the 300 ms before the punch event (camera) or
//   3.5 + 2.0 * power m/s from the gesture power (1..2) when no kinematics are available (amateur
//   straight punches peak at 5-8 m/s). v is capped at 10 m/s -> <= 0.19 kcal per punch at 75 kg; a
//   6 m/s punch is 0.07 kcal.
// Without kinematics, dodges (0.05 kcal) and supers (0.1 kcal) are also credited as bursts, and punches
// / dodges raise a display-only burst term (effective MET = MET + 3 * burst, 3 s decay) so a keyboard
// flurry counts as active time. With kinematics the arm term already sees the flurry, so no burst.
// Intensity (0..1) maps effective MET 1.3..12.8 onto the bar. Labels use the ACSM cut points:
// LOW < 3 MET, MODERATE 3-6, HIGH >= 6. Active time = frames at >= 3 MET.
// Accuracy: frames with tracking lost are integrated at 1.3 MET and counted in lostMs; when that exceeds
// 20% of the session, the summary and live readout carry a note that the estimate is low.
// Body scale: wrist speeds use MediaPipe world landmarks (metres, hip-centred). Torso position comes from
// the normalised image landmarks through a pinhole model: distance = F * shoulderWidth_m / shoulderWidth_img
// with F = 0.83 (≈ 62° horizontal FOV, a typical laptop webcam) and the real shoulder width taken from the
// world landmarks (default 0.38 m). The mid-shoulder point stands in for the centre of mass (hips are often
// out of a webcam's frame); its height drop drives the crouch / squat terms.
(function (global) {
  const STORE_KEY = 'dogefight.fitness';
  const SETTINGS_KEY = 'dogefight.fitness.settings';
  const CAP = 200;
  const UNIT_M = 1.2;                 // metres per arena unit (keyboard-mode distance)
  const ACTIVE_MET = 3.0;
  const TAU_MS = 3000;                // intensity decay time constant
  const MET_LO = 1.3, MET_HI = 12.8;  // intensity scale: standing quietly .. boxing in ring
  const BASE_TRACK = 2.0, BASE_LOST = 1.3;
  const MOVE_MAX = 2.5, MOVE_V = 1.3;                       // +2.5 MET at 1.3 m/s hip speed
  const ARM_MAX = 5.5, ARM_V0 = 2.2, ARM_NORM = Math.tanh(3 / ARM_V0); // +5.5 MET at 3 m/s mean wrist speed
  const CROUCH_MET = 1.0;
  const SQUAT = { met: 1.5, ms: 6000, ref: 0.30, drop: 0.15, release: 0.06, stack: 3 };
  const PUNCH = { massFrac: 0.053, ineff: 4, vMax: 10, v0: 3.5, vPow: 2.0, peakWin: 300 };
  const KIN = { wristWin: 100, hipWin: 400, meanWin: 2000, keep: 2500, noiseWrist: 0.15, noiseHip: 0.08, vWristMax: 12, vHipMax: 2.5, ySmooth: 150, yBase: 4000, yBaseBand: 0.08 };
  const F_NORM = 0.83;                // focal length in normalised image-width units
  const SHOULDER_M = 0.38;            // default real shoulder width (m)
  const LOST_NOTE = 0.2;              // tracking lost for more than this fraction -> accuracy note
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pad2 = n => ('0' + n).slice(-2);
  const dateKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const sameSig = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  // ---------- storage (localStorage may be missing, disabled or full) ----------
  function load(key, fallback) {
    try { const raw = global.localStorage.getItem(key); if (!raw) return fallback; const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ---------- injected styles ----------
  const CSS = `
.fit-hud{position:absolute;left:14px;bottom:14px;z-index:4;min-width:188px;padding:10px 14px 12px;background:rgba(15,16,18,.72);border:1px solid rgba(232,228,220,.14);color:#e8e4dc;font-family:"Segoe UI",Barlow,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;user-select:none}
.fit-hud .fit-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.fit-hud .fit-lbl,.fit-log .fit-lbl{font:600 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.22em;color:#8c9199;text-transform:uppercase}
.fit-hud .fit-kcal{font:700 30px/1 Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;letter-spacing:.02em;color:#e8e4dc}
.fit-hud .fit-kcal small{font:600 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.2em;color:#d4a13a;margin-left:5px;vertical-align:baseline}
.fit-hud .fit-bar{position:relative;height:5px;margin:9px 0 6px;background:rgba(232,228,220,.12);overflow:hidden}
.fit-hud .fit-bar i{position:absolute;left:0;top:0;bottom:0;width:0;background:#d4a13a;transition:width .25s linear,background .3s}
.fit-hud .fit-bar i.fit-high{background:#c8281e}
.fit-hud .fit-bar i.fit-low{background:#8c9199}
.fit-hud .fit-int{font:600 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.22em;color:#d4a13a}
.fit-hud .fit-int.fit-high{color:#ff5a4a}
.fit-hud .fit-int.fit-low{color:#8c9199}
.fit-hud .fit-meta{font:500 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.16em;color:#8c9199}
.fit-sum{font:500 14px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.08em;color:#8c9199}
.fit-sum b{color:#e8e4dc;font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:18px;font-weight:600}
.fit-sum b.fit-gold{color:#d4a13a}
.fit-sum .fit-note{display:block;margin-top:4px;font:500 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.12em;color:#8c9199}
.fit-log{background:rgba(15,16,18,.86);border:1px solid rgba(232,228,220,.14);padding:22px 26px 24px;color:#e8e4dc;font-family:"Segoe UI",Barlow,system-ui,sans-serif;max-width:100%}
.fit-log .fit-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}
.fit-log .fit-kicker{font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:12px;letter-spacing:.42em;color:#d4a13a}
.fit-log h3{margin:2px 0 0;font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:30px;font-weight:700;line-height:1;letter-spacing:.03em;color:#e8e4dc}
.fit-log .fit-sub{font:500 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.18em;color:#8c9199;text-align:right}
.fit-log .fit-totals{display:flex;flex-wrap:wrap;gap:26px;padding:12px 0 16px;border-top:1px solid rgba(232,228,220,.14);border-bottom:1px solid rgba(232,228,220,.14)}
.fit-log .fit-tot{display:flex;flex-direction:column;gap:5px}
.fit-log .fit-tot b{font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:26px;font-weight:600;line-height:1;color:#e8e4dc}
.fit-log .fit-tot b.fit-gold{color:#d4a13a}
.fit-log .fit-tot b small{font:600 11px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.16em;color:#8c9199;margin-left:4px}
.fit-log .fit-chartwrap{margin:18px 0 6px}
.fit-log .fit-chartwrap .fit-lbl{display:block;margin-bottom:8px}
.fit-log canvas{display:block;width:100%;height:120px}
.fit-log table{border-collapse:collapse;width:100%;margin-top:16px;font:400 13px "Segoe UI",Barlow,system-ui,sans-serif}
.fit-log th{text-align:left;font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:12px;font-weight:600;letter-spacing:.26em;color:#d4a13a;padding:0 10px 8px 0;white-space:nowrap}
.fit-log td{padding:6px 10px 6px 0;border-top:1px solid rgba(232,228,220,.14);color:#cfcbc3;white-space:nowrap;vertical-align:middle}
.fit-log td:first-child{color:#e8e4dc;font-weight:600}
.fit-log th.fit-num,.fit-log td.fit-num{text-align:right;font-variant-numeric:tabular-nums}
.fit-log td.fit-kcalcell{color:#e8e4dc;font-family:Bahnschrift,"Oswald","Arial Narrow","Segoe UI",sans-serif;font-size:15px}
.fit-log .fit-res{display:inline-block;padding:2px 8px;font:600 10px "Segoe UI",Barlow,system-ui,sans-serif;letter-spacing:.18em;border:1px solid rgba(232,228,220,.22);color:#8c9199}
.fit-log .fit-res.fit-win{color:#d4a13a;border-color:rgba(212,161,58,.6)}
.fit-log .fit-res.fit-lose{color:#ff5a4a;border-color:rgba(200,40,30,.6)}
.fit-log .fit-empty{padding:14px 0 4px;font:400 13px "Segoe UI",Barlow,system-ui,sans-serif;color:#8c9199;letter-spacing:.06em}
.fit-log .fit-tablewrap{overflow-x:auto}
`;
  let styled = false;
  function ensureStyle() {
    if (styled || !global.document) return;
    const s = global.document.createElement('style'); s.id = 'fit-style'; s.textContent = CSS;
    (global.document.head || global.document.documentElement).appendChild(s);
    styled = true;
  }

  const metOfIntensity = i => MET_LO + clamp(i, 0, 1) * (MET_HI - MET_LO);
  const intensityOfMet = m => clamp((m - MET_LO) / (MET_HI - MET_LO), 0, 1);
  const metLabel = m => m >= 6 ? 'HIGH' : m >= 3 ? 'MODERATE' : 'LOW';
  const intensityLabel = i => metLabel(metOfIntensity(i));
  const intensityClass = i => { const l = intensityLabel(i); return l === 'HIGH' ? 'fit-high' : l === 'MODERATE' ? 'fit-mod' : 'fit-low'; };
  const fmtMin = ms => (ms / 60000).toFixed(1);
  const fmtTime = t => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  const fmtDate = t => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const lostNote = s => { const lost = s && s.totalMs > 0 ? (s.lostMs || 0) / s.totalMs : 0; return lost > LOST_NOTE ? 'tracking lost ' + Math.round(lost * 100) + '% of the time - estimate is low' : ''; };

  // Live readout for the canvas HUD (render.js reads window.Fitness.live; no instance reference needed).
  const LIVE = { on: false, kcal: 0, met: 0, intensity: 0, label: 'LOW', ms: 0, note: '', kinematic: false };

  class Fitness {
    constructor(opts) {
      const saved = load(SETTINGS_KEY, {});
      this.settings = Object.assign({ weightKg: 75, heightCm: 175 }, saved, opts || {});
      this.kcalScale = Number((opts || {}).kcalScale) || 1; // display multiplier on every kcal added (game uses 2)
      this.weightKg = clamp(Number(this.settings.weightKg) || 75, 20, 300);
      this.heightCm = clamp(Number(this.settings.heightCm) || 175, 100, 250);
      this.sessions = load(STORE_KEY, []);
      if (!Array.isArray(this.sessions)) this.sessions = [];
      this.session = null;           // live session (see startSession)
      this.last = null;              // most recently ended session record
      this.burst = 0;                // punch/dodge display burst (keyboard path only), decays
      this.intensity = 0;            // displayed intensity 0..1, decays with TAU_MS
      this.met = 0;                  // effective MET of the last tick
      this.terms = null;             // { base, move, arm, crouch, squat, met, kinematic } of the last tick
      this.kin = null;               // last measured kinematics (null when no usable pose)
      this.lastPunch = null;         // { v, kcal, measured } of the last punch event
      this._kin = this._newKin(); this._now = 0; this._wasDuck = false;
      this._hud = null; this._hudTimer = null;
      this.saveSettings();
    }
    _newKin() { return { S: SHOULDER_M, samples: [], speeds: [], ySm: null, yBase: null, inSquat: false, depth: 0, squats: 0, boosts: [], cur: null }; }

    // ---------- settings ----------
    setWeight(kg) { this.weightKg = clamp(Number(kg) || this.weightKg, 20, 300); this.settings.weightKg = this.weightKg; this.saveSettings(); return this; }
    setHeight(cm) { this.heightCm = clamp(Number(cm) || this.heightCm, 100, 250); this.settings.heightCm = this.heightCm; this.saveSettings(); return this; }
    saveSettings() { return save(SETTINGS_KEY, { weightKg: this.weightKg, heightCm: this.heightCm }); }

    // ---------- session lifecycle ----------
    startSession(meta) {
      if (this.session) this.endSession('quit');
      const now = Date.now();
      this.session = {
        startedAt: now, endedAt: null, date: dateKey(now),
        stage: (meta && meta.stage) || '', rank: (meta && meta.rank) || 0, mode: (meta && meta.mode) || 'kb', result: null,
        kcal: 0, punchKcal: 0, activeMs: 0, totalMs: 0, lostMs: 0, kinMs: 0, punches: 0, punchesLanded: 0, dodges: 0, ducks: 0, squats: 0, hitsTaken: 0, supers: 0,
        distance: 0, peakIntensity: 0, avgIntensity: 0, met: 0, _intMs: 0,
      };
      this.burst = 0; this.intensity = 0; this.met = BASE_TRACK; this.terms = null; this.kin = null; this.lastPunch = null;
      this._kin = this._newKin(); this._now = 0; this._wasDuck = false;
      this._publish();
      return this.session;
    }
    endSession(result) {
      const s = this.session; if (!s) return null;
      s.result = result || 'quit'; s.endedAt = Date.now();
      s.avgIntensity = s.totalMs > 0 ? s._intMs / s.totalMs : 0;
      s.squats = this._kin.squats;
      s.met = 0;
      this.session = null;
      const rec = this._record(s);
      this.last = rec;
      // keep only sessions with some duration so a mis-click does not spam the log
      if (rec.totalMs >= 1000) { this.sessions.push(rec); if (this.sessions.length > CAP) this.sessions.splice(0, this.sessions.length - CAP); save(STORE_KEY, this.sessions); }
      this.burst = 0; this.intensity = 0; this.met = 0; this.terms = null; this.kin = null;
      this._publish();
      return rec;
    }
    _record(s) {
      return { startedAt: s.startedAt, endedAt: s.endedAt, date: s.date, stage: s.stage, rank: s.rank, mode: s.mode, result: s.result,
        kcal: +s.kcal.toFixed(3), punchKcal: +s.punchKcal.toFixed(3), activeMs: Math.round(s.activeMs), totalMs: Math.round(s.totalMs), lostMs: Math.round(s.lostMs), kinematic: s.kinMs > 0,
        punches: s.punches, punchesLanded: s.punchesLanded, dodges: s.dodges, ducks: s.ducks, squats: s.squats, hitsTaken: s.hitsTaken, supers: s.supers, distance: +s.distance.toFixed(3),
        peakIntensity: +s.peakIntensity.toFixed(3), avgIntensity: +s.avgIntensity.toFixed(3) };
    }

    // ---------- per-frame ----------
    // dt in ms; s = { moving: 0..1, duck, block, handsUp, tracking, pose }
    // pose (optional, webcam) = { world: 33 MediaPipe world landmarks (m, hip-centred) or null,
    //                             img: 33 normalised image landmarks, aspect: video width/height, t: ms timestamp }
    tick(dt, s) {
      const ses = this.session; if (!ses) return;
      dt = clamp(Number(dt) || 0, 0, 250); if (dt <= 0) return;
      s = s || {};
      const tracking = s.tracking !== false;
      const pose = s.pose || null;
      const pt = pose ? Number(pose.t) : NaN;
      this._now = isFinite(pt) ? Math.max(this._now, pt) : this._now + dt;
      const now = this._now, KN = this._kin;
      const kin = pose && tracking ? this._kinematics(pose, now) : null;
      if (!kin) this._dropKin();
      this.kin = kin;
      const moving = clamp(Number(s.moving) || 0, 0, 1);
      const duck = !!s.duck;
      // squat cycles: measured from the torso height with a camera, from the duck flag otherwise
      if (kin) { if (kin.cycle) { this._squat(now, kin.cycleDepth); kin.cycle = false; } }
      else if (duck && !this._wasDuck) this._squat(now, SQUAT.ref);
      if (duck && !this._wasDuck) ses.ducks++;   // a duck is counted once per hold
      this._wasDuck = duck;
      while (KN.boosts.length && now - KN.boosts[0].t >= SQUAT.ms) KN.boosts.shift();
      let squat = 0; for (const b of KN.boosts) squat += b.amt; squat = Math.min(squat, SQUAT.stack * SQUAT.met);
      const base = tracking ? BASE_TRACK : BASE_LOST;
      const move = kin ? MOVE_MAX * Math.min(1, kin.vHip / MOVE_V) : MOVE_MAX * Math.pow(moving, 1.2);
      const arm = kin ? ARM_MAX * Math.tanh(kin.vArm / ARM_V0) / ARM_NORM : 0;
      const crouch = (kin ? kin.crouch : duck) ? CROUCH_MET : 0;
      const met = base + move + arm + crouch + squat;
      this.terms = { base, move, arm, crouch, squat, met, kinematic: !!kin };
      // kcal from the MET integral (punch bursts are added in event())
      ses.kcal += met * 3.5 * this.weightKg / 200 / 60000 * dt * this.kcalScale;
      // display burst from recent punches/dodges (keyboard path only), 3 s time constant
      const decay = Math.exp(-dt / TAU_MS);
      this.burst *= decay;
      const effMet = met + (kin ? 0 : 3.0 * this.burst);
      this.met = ses.met = effMet;
      if (effMet >= ACTIVE_MET) ses.activeMs += dt;
      ses.totalMs += dt;
      if (!tracking) ses.lostMs += dt;
      if (kin) ses.kinMs += dt;
      // distance: measured torso travel with a camera, joystick * player speed otherwise (arena units)
      const pspeed = (global.ARENA && global.ARENA.PSPEED) || 1.4;
      ses.distance += kin ? kin.vHip * dt / 1000 / UNIT_M : moving * pspeed * dt / 1000;
      // intensity: 0 at quiet standing, 1 at boxing-in-ring; never falls faster than the 3 s tail
      const raw = intensityOfMet(effMet);
      this.intensity = Math.max(raw, this.intensity * decay);
      ses.peakIntensity = Math.max(ses.peakIntensity, this.intensity);
      ses._intMs += this.intensity * dt;
      this._publish();
    }
    _squat(now, depth) {
      const KN = this._kin;
      KN.boosts.push({ t: now, amt: SQUAT.met * clamp((depth || SQUAT.ref) / SQUAT.ref, 0.5, 2) });
      KN.squats++;
      if (this.session) this.session.squats = KN.squats;
    }
    _dropKin() { const KN = this._kin; KN.samples.length = 0; KN.speeds.length = 0; KN.ySm = null; KN.yBase = null; KN.inSquat = false; KN.depth = 0; KN.cur = null; }

    // Per-frame body kinematics from the pose. Returns { vL, vR, vArm, vHip, drop, crouch, squats, cycle, cycleDepth, dist } or null.
    _kinematics(pose, now) {
      const img = pose.img, world = pose.world;
      if (!img || img.length < 25) return null;
      const ls = img[11], rs = img[12], lwI = img[15], rwI = img[16];
      if (!ls || !rs || !lwI || !rwI) return null;
      const aspect = Number(pose.aspect) > 0 ? Number(pose.aspect) : 4 / 3;
      const KN = this._kin;
      const sw = Math.hypot(ls.x - rs.x, (ls.y - rs.y) / aspect);   // shoulder width in image-width units
      if (!(sw > 0.03)) return null;
      const hasW = !!(world && world.length >= 25 && world[11] && world[12] && world[15] && world[16]);
      // the renderer runs faster than the camera: a frame already sampled must not be sampled again
      // (it would halve every time base and double every speed), so compare the raw landmark values first
      const w15 = hasW ? world[15] : null, w16 = hasW ? world[16] : null;
      const sig = [ls.x, ls.y, rs.x, rs.y, lwI.x, lwI.y, lwI.z || 0, rwI.x, rwI.y, rwI.z || 0,
        w15 ? w15.x : 0, w15 ? w15.y : 0, w15 ? w15.z || 0 : 0, w16 ? w16.x : 0, w16 ? w16.y : 0, w16 ? w16.z || 0 : 0];
      const S = KN.samples, last = S[S.length - 1];
      if (last && sameSig(last.sig, sig)) return KN.cur; // same camera frame as last tick
      if (last && now - last.t < 1) return KN.cur;
      if (hasW) { const Sm = dist3({ x: world[11].x, y: world[11].y, z: world[11].z || 0 }, { x: world[12].x, y: world[12].y, z: world[12].z || 0 }); if (Sm > 0.2 && Sm < 0.7) KN.S += (Sm - KN.S) * 0.05; }
      // pinhole: distance to the camera from the apparent shoulder width, then the torso in metres
      const d = F_NORM * KN.S / sw;
      const cx = (ls.x + rs.x) / 2, cy = (ls.y + rs.y) / 2;
      const tor = { x: (cx - 0.5) * d / F_NORM, y: (cy - 0.5) / aspect * d / F_NORM, z: d };
      const zc = ((ls.z || 0) + (rs.z || 0)) / 2;
      const wr = (w, p) => w ? { x: w.x, y: w.y, z: w.z || 0 } : { x: (p.x - cx) / sw * KN.S, y: (p.y - cy) / aspect / sw * KN.S, z: ((p.z || 0) - zc) / sw * KN.S };
      const lw = wr(w15, lwI), rw = wr(w16, rwI);
      const smp = { t: now, sig, lw, rw, tor, vlF: 0, vrF: 0 };
      if (last) { const a = (now - last.t) / 1000; smp.vlF = Math.min(KIN.vWristMax, dist3(lw, last.lw) / a); smp.vrF = Math.min(KIN.vWristMax, dist3(rw, last.rw) / a); }
      S.push(smp); while (S.length && now - S[0].t > KIN.keep) S.shift();
      const refAt = age => { for (let i = S.length - 1; i >= 0; i--) if (now - S[i].t >= age) return S[i]; return null; };
      // wrist speeds over a 100 ms window (noise floor removed), torso speed over 400 ms
      const r1 = refAt(KIN.wristWin); let vL = 0, vR = 0;
      if (r1) { const a = (now - r1.t) / 1000; vL = clamp(dist3(lw, r1.lw) / a - KIN.noiseWrist, 0, KIN.vWristMax); vR = clamp(dist3(rw, r1.rw) / a - KIN.noiseWrist, 0, KIN.vWristMax); }
      const r2 = refAt(KIN.hipWin); let vHip = 0;
      if (r2) { const a = (now - r2.t) / 1000; vHip = clamp(Math.hypot(tor.x - r2.tor.x, tor.z - r2.tor.z) / a - KIN.noiseHip, 0, KIN.vHipMax); }
      // vertical centre of mass: smoothed shoulder height vs a slow standing baseline (image y grows downward)
      const dtl = last ? now - last.t : 0;
      if (KN.ySm == null) { KN.ySm = tor.y; KN.yBase = tor.y; } else KN.ySm += (tor.y - KN.ySm) * Math.min(1, dtl / KIN.ySmooth);
      const drop = KN.ySm - KN.yBase;
      if (!KN.inSquat && Math.abs(drop) < KIN.yBaseBand) KN.yBase += (KN.ySm - KN.yBase) * Math.min(1, dtl / KIN.yBase);
      let cycle = false, cycleDepth = 0;
      if (!KN.inSquat) { if (drop > SQUAT.drop) { KN.inSquat = true; KN.depth = drop; } }
      else { KN.depth = Math.max(KN.depth, drop); if (drop < SQUAT.release) { KN.inSquat = false; cycle = true; cycleDepth = KN.depth; } }
      // 2 s history of speeds for the arm-work mean and the punch peak
      const SP = KN.speeds; SP.push({ t: now, va: (vL + vR) / 2, vlF: smp.vlF, vrF: smp.vrF });
      while (SP.length && now - SP[0].t > KIN.meanWin) SP.shift();
      let sum = 0; for (const p of SP) sum += p.va;
      KN.cur = { vL, vR, vArm: sum / SP.length, vHip, drop, crouch: KN.inSquat, squats: KN.squats, cycle, cycleDepth, dist: d, shoulderM: KN.S, frames: S.length };
      return KN.cur;
    }
    // peak frame-to-frame wrist speed of a hand over the last 300 ms (null without kinematics)
    _peakWrist(hand) {
      const SP = this._kin.speeds; if (!this.kin || !SP.length) return null;
      let pk = 0;
      for (let i = SP.length - 1; i >= 0 && this._now - SP[i].t <= PUNCH.peakWin; i--) {
        const p = SP[i]; pk = Math.max(pk, hand === 'L' ? p.vlF : hand === 'R' ? p.vrF : Math.max(p.vlF, p.vrF));
      }
      return pk > 0 ? pk : null;
    }
    punchKcal(v) { v = Math.min(PUNCH.vMax, Math.max(0, v)); return 0.5 * PUNCH.massFrac * this.weightKg * v * v / 4184 * PUNCH.ineff; }

    // ---------- discrete efforts ----------
    // 'punch' {hand, power(1..2), result}, 'dodge' {how}, 'hitTaken' {dmg}, 'super'
    event(type, data) {
      const ses = this.session; if (!ses) return;
      data = data || {};
      const w = this.weightKg / 70;
      switch (type) {
        case 'punch': {
          const power = clamp(Number(data.power) || 1, 0.5, 3);
          ses.punches++;
          if (data.result === 'hit' || data.result === 'crit' || data.result === 'counter') ses.punchesLanded++;
          const measured = this._peakWrist(data.hand);
          const v = measured != null ? measured : PUNCH.v0 + PUNCH.vPow * power;
          const kcal = this.punchKcal(v);
          ses.kcal += kcal * this.kcalScale; ses.punchKcal += kcal * this.kcalScale;
          this.lastPunch = { v: Math.min(PUNCH.vMax, v), kcal, measured: measured != null };
          this.burst = Math.min(1.5, this.burst + 0.22 * power);
          break;
        }
        case 'dodge':
          ses.dodges++;
          if (!this.kin) ses.kcal += 0.05 * w * this.kcalScale;   // with a camera the footwork is already in the hip term
          this.burst = Math.min(1.5, this.burst + 0.18);
          break;
        case 'hitTaken':
          ses.hitsTaken++;
          this.burst = Math.min(1.5, this.burst + 0.08); // bracing / recovering
          break;
        case 'super':
          ses.supers++;
          if (!this.kin) ses.kcal += 0.1 * w * this.kcalScale;    // both arms overhead for a beat
          this.burst = Math.min(1.5, this.burst + 0.3);
          break;
      }
      // make keyboard bursts visible immediately instead of waiting for the next tick
      if (!this.kin) this.intensity = Math.max(this.intensity, intensityOfMet((this.terms ? this.terms.met : BASE_TRACK) + 3.0 * this.burst));
      ses.peakIntensity = Math.max(ses.peakIntensity, this.intensity);
      this._publish();
    }

    // ---------- live readout (window.Fitness.live) ----------
    _publish() {
      const ses = this.session;
      LIVE.on = !!ses;
      LIVE.kcal = ses ? ses.kcal : (this.last ? this.last.kcal : 0);
      LIVE.met = ses ? this.met : 0;
      LIVE.intensity = ses ? this.intensity : 0;
      LIVE.label = ses ? metLabel(this.met) : 'LOW';
      LIVE.ms = ses ? ses.totalMs : 0;
      LIVE.kinematic = !!(ses && this.kin);
      LIVE.note = ses ? lostNote(ses) : '';
      return LIVE;
    }
    get live() { return LIVE; }
    static get live() { return LIVE; }

    // ---------- queries ----------
    // aggregate numbers for today (persisted sessions + the live one)
    today() {
      const key = dateKey(Date.now());
      const list = this.sessions.filter(s => s.date === key);
      if (this.session && this.session.date === key) list.push(this.session);
      return this._aggregate(list, key);
    }
    // oldest -> newest, one entry per calendar day ending today
    history(days) {
      days = Math.max(1, Math.min(365, days | 0 || 7));
      const out = [], byDay = {};
      const all = this.sessions.slice(); if (this.session) all.push(this.session);
      for (const s of all) (byDay[s.date] = byDay[s.date] || []).push(s);
      const t0 = new Date(); t0.setHours(12, 0, 0, 0);
      for (let i = days - 1; i >= 0; i--) { const key = dateKey(t0.getTime() - i * 86400000); out.push(this._aggregate(byDay[key] || [], key)); }
      return out;
    }
    _aggregate(list, key) {
      const a = { date: key, kcal: 0, minutes: 0, activeMinutes: 0, punches: 0, punchesLanded: 0, dodges: 0, distanceM: 0, sessions: list.length, wins: 0 };
      for (const s of list) { a.kcal += s.kcal; a.minutes += s.totalMs / 60000; a.activeMinutes += s.activeMs / 60000; a.punches += s.punches; a.punchesLanded += s.punchesLanded || 0; a.dodges += s.dodges; a.distanceM += (s.distance || 0) * UNIT_M; if (s.result === 'win') a.wins++; }
      a.kcal = +a.kcal.toFixed(2); a.minutes = +a.minutes.toFixed(2); a.activeMinutes = +a.activeMinutes.toFixed(2); a.distanceM = +a.distanceM.toFixed(1);
      return a;
    }
    metres(units) { return (units || 0) * UNIT_M; }
    lastSessions(n) { return this.sessions.slice(-(n || 10)).reverse(); }

    // ---------- result screen line ----------
    summaryHTML(rec) {
      ensureStyle();
      const s = rec || this.session || this.last;
      if (!s) return '<span class="fit-sum">no training data</span>';
      const avg = s.endedAt ? s.avgIntensity : (s.totalMs > 0 ? s._intMs / s.totalMs : 0);
      const note = lostNote(s);
      return '<span class="fit-sum">' +
        'burned <b class="fit-gold">' + s.kcal.toFixed(1) + '</b> kcal · ' +
        'active <b>' + fmtMin(s.activeMs) + '</b> min · ' +
        'punches <b>' + s.punches + '</b> · ' +
        'dodges <b>' + s.dodges + '</b> · ' +
        'avg intensity <b>' + Math.round(avg * 100) + '%</b> ' + esc(intensityLabel(avg)) +
        (note ? '<span class="fit-note">' + esc(note) + '</span>' : '') +
        '</span>';
    }

    // ---------- live HUD widget (DOM; the game draws Fitness.live on its canvas instead) ----------
    mountHud(container, opts) {
      ensureStyle();
      this.unmountHud();
      const el = global.document.createElement('div'); el.className = 'fit-hud';
      if (opts && opts.style) Object.assign(el.style, opts.style);
      el.innerHTML = '<div class="fit-row"><span class="fit-lbl">Burn</span><span class="fit-meta fit-time">0:00</span></div>' +
        '<div class="fit-kcal"><span class="fit-val">0.0</span><small>KCAL</small></div>' +
        '<div class="fit-bar"><i></i></div>' +
        '<div class="fit-row"><span class="fit-int">LOW</span><span class="fit-meta fit-met">1.3 MET</span></div>';
      (container || global.document.body).appendChild(el);
      this._hud = el;
      const refresh = () => this._refreshHud();
      refresh();
      this._hudTimer = global.setInterval(refresh, 250);
      el.refresh = refresh;
      return el;
    }
    unmountHud() {
      if (this._hudTimer) { global.clearInterval(this._hudTimer); this._hudTimer = null; }
      if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
      this._hud = null;
    }
    _refreshHud() {
      const el = this._hud; if (!el) return;
      const s = this.session || this.last;
      const kcal = s ? s.kcal : 0, i = this.session ? this.intensity : 0, met = this.session ? this.met : 0;
      const cls = intensityClass(i);
      el.querySelector('.fit-val').textContent = kcal.toFixed(1);
      const bar = el.querySelector('.fit-bar i'); bar.style.width = Math.round(clamp(i, 0, 1) * 100) + '%'; bar.className = cls;
      const lab = el.querySelector('.fit-int'); lab.textContent = this.session ? metLabel(met) : 'LOW'; lab.className = 'fit-int ' + cls;
      el.querySelector('.fit-met').textContent = met.toFixed(1) + ' MET';
      const ms = s ? s.totalMs : 0, m = Math.floor(ms / 60000), sec = Math.floor(ms / 1000) % 60;
      el.querySelector('.fit-time').textContent = m + ':' + pad2(sec);
    }

    // ---------- TRAINING LOG panel ----------
    renderLog(container, opts) {
      ensureStyle();
      const days = (opts && opts.days) || 7, rows = (opts && opts.rows) || 10;
      const t = this.today(), hist = this.history(days), recent = this.lastSessions(rows);
      const el = global.document.createElement('div'); el.className = 'fit-log';
      const total = this.sessions.reduce((a, s) => a + s.kcal, 0);
      el.innerHTML =
        '<div class="fit-head"><div><div class="fit-kicker">TRAINING LOG</div><h3>TODAY</h3></div>' +
        '<div class="fit-sub">' + this.sessions.length + ' SESSIONS · ' + total.toFixed(0) + ' KCAL ALL TIME<br>' + this.weightKg + ' KG</div></div>' +
        '<div class="fit-totals">' +
          tot('kcal burned', t.kcal.toFixed(1), '', true) +
          tot('active', t.activeMinutes.toFixed(1), 'MIN') +
          tot('total', t.minutes.toFixed(1), 'MIN') +
          tot('punches', t.punches, '') +
          tot('dodges', t.dodges, '') +
          tot('walked', t.distanceM.toFixed(0), 'M') +
          tot('sessions', t.sessions, '') +
        '</div>' +
        '<div class="fit-chartwrap"><span class="fit-lbl">KCAL · LAST ' + days + ' DAYS</span><canvas width="640" height="120"></canvas></div>' +
        '<div class="fit-tablewrap"><table><thead><tr><th>WHEN</th><th>STAGE</th><th class="fit-num">MIN</th><th class="fit-num">KCAL</th><th class="fit-num">PUNCHES</th><th>RESULT</th></tr></thead><tbody>' +
        (recent.length ? recent.map(s =>
          '<tr><td>' + esc(fmtDate(s.startedAt)) + ' ' + esc(fmtTime(s.startedAt)) + '</td>' +
          '<td>' + esc(s.stage || '—') + (s.rank ? ' <span class="fit-meta">R' + pad2(s.rank) + '</span>' : '') + '</td>' +
          '<td class="fit-num">' + fmtMin(s.totalMs) + '</td>' +
          '<td class="fit-num fit-kcalcell">' + s.kcal.toFixed(1) + '</td>' +
          '<td class="fit-num">' + s.punches + '</td>' +
          '<td><span class="fit-res fit-' + esc(s.result) + '">' + esc(String(s.result || '').toUpperCase()) + '</span></td></tr>').join('') :
          '<tr><td colspan="6" class="fit-empty">No fights logged yet. Go throw some punches.</td></tr>') +
        '</tbody></table></div>';
      (container || global.document.body).appendChild(el);
      this._drawChart(el.querySelector('canvas'), hist);
      return el;
      function tot(label, val, unit, gold) { return '<div class="fit-tot"><span class="fit-lbl">' + label + '</span><b' + (gold ? ' class="fit-gold"' : '') + '>' + val + (unit ? '<small>' + unit + '</small>' : '') + '</b></div>'; }
    }
    _drawChart(cv, hist) {
      if (!cv || !cv.getContext) return;
      const c = cv.getContext('2d'); if (!c) return;
      const W = cv.width, H = cv.height, padL = 34, padB = 22, padT = 14, padR = 6;
      c.clearRect(0, 0, W, H);
      const max = Math.max(1, ...hist.map(h => h.kcal));
      const nice = max <= 10 ? 10 : Math.ceil(max / 25) * 25;
      const iw = W - padL - padR, ih = H - padT - padB, n = hist.length, slot = iw / n, bw = Math.min(46, slot * 0.58);
      const todayKey = dateKey(Date.now());
      // gridlines + axis labels
      c.font = '600 10px "Segoe UI", Barlow, system-ui, sans-serif'; c.textBaseline = 'middle';
      for (let k = 0; k <= 2; k++) {
        const v = nice * k / 2, y = padT + ih - ih * k / 2;
        c.strokeStyle = 'rgba(232,228,220,.12)'; c.lineWidth = 1; c.beginPath(); c.moveTo(padL, Math.round(y) + .5); c.lineTo(W - padR, Math.round(y) + .5); c.stroke();
        c.fillStyle = '#8c9199'; c.textAlign = 'right'; c.fillText(String(Math.round(v)), padL - 6, y);
      }
      hist.forEach((h, i) => {
        const x = padL + slot * i + (slot - bw) / 2, bh = Math.max(h.kcal > 0 ? 2 : 0, ih * h.kcal / nice), y = padT + ih - bh;
        const isToday = h.date === todayKey;
        c.fillStyle = isToday ? '#d4a13a' : 'rgba(232,228,220,.55)';
        c.fillRect(x, y, bw, bh);
        if (h.kcal > 0) { c.fillStyle = isToday ? '#d4a13a' : '#e8e4dc'; c.textAlign = 'center'; c.fillText(h.kcal.toFixed(0), x + bw / 2, y - 8); }
        const d = new Date(h.date + 'T12:00:00');
        c.fillStyle = isToday ? '#e8e4dc' : '#8c9199'; c.textAlign = 'center';
        c.fillText(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()], x + bw / 2, H - padB / 2);
      });
      // baseline in red like the menu rule
      c.fillStyle = '#c8281e'; c.fillRect(padL, padT + ih, iw, 2);
    }

    // ---------- maintenance ----------
    clear() { this.sessions = []; this.last = null; save(STORE_KEY, this.sessions); }
    static get KEYS() { return { STORE_KEY, SETTINGS_KEY }; }
    static get MODEL() { return { BASE_TRACK, BASE_LOST, MOVE_MAX, MOVE_V, ARM_MAX, ARM_V0, CROUCH_MET, SQUAT, PUNCH, KIN, F_NORM, SHOULDER_M, MET_LO, MET_HI, ACTIVE_MET, UNIT_M }; }
  }

  global.Fitness = Fitness;
})(typeof window !== 'undefined' ? window : this);
