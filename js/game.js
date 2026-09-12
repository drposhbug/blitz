// game.js — the fight itself. Pure logic, no DOM/audio. Emits events for main.js.
// The ring is a circle of radius RING on a 2D plane. You have a position and a facing (yaw) that
// automatically tracks Sol unless she is mid-punch; she circles around you. You only trade punches
// when she is within REACH in front of you and roughly lined up (LANE). Dodging is footwork: back
// off, sidestep out of her line, or duck under the high ones.
(function (global) {
  const REACH = 0.42, LANE = 0.45, MIN_GAP = 0.25, RING = 1.7, TURN = 2.8, PSPEED = 1.4, STRAFE = 0.65; // STRAFE: sideways steps are slower than forward/back
  const ATTACKS = {
    jab:      { name: 'JAB',        hand: 'R', high: true,  blockable: true,  dmg: 8,  windup: 700, hint: 'STEP BACK, SIDESTEP or DUCK' },
    hookL:    { name: 'LEFT HOOK',  hand: 'L', high: true,  blockable: true,  dmg: 12, windup: 820, hint: 'BACK OFF, SIDESTEP or DUCK' },
    hookR:    { name: 'RIGHT HOOK', hand: 'R', high: true,  blockable: true,  dmg: 12, windup: 820, hint: 'BACK OFF, SIDESTEP or DUCK' },
    overhead: { name: 'OVERHEAD',   hand: 'R', high: false, blockable: false, dmg: 16, windup: 950, hint: 'GET OUT OF REACH - no duck, no block' },
    uppercut: { name: 'UPPERCUT',   hand: 'L', high: false, blockable: true,  dmg: 14, windup: 880, hint: 'STEP BACK or BLOCK' },
    body:     { name: 'BODY BLOW',  hand: 'R', high: false, blockable: true,  dmg: 10, windup: 650, hint: 'STEP BACK or BLOCK' },
  };
  const ORDER = ['jab', 'body', 'hookL', 'hookR', 'uppercut', 'overhead'];
  // ringside caller lingo for the floating words
  const WOW = {
    dodge: ['SLIPPED', 'CLEAN', 'NOTHING THERE', 'TOO SLOW'],
    hit:   ['TAGGED', 'ROCKED', 'FLUSH', 'THAT LANDED'],
    land:  ['CLEAN SHOT', 'FLUSH', 'BODY!', 'ON THE BUTTON'],
    block: ['BLOCKED', 'GUARD UP'],
    whiff: ['AIR', 'NOTHING', 'WHIFF'],
  };
  const pick = (rng, a) => a[Math.floor(rng() * a.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  function clampRing(o, r) { const d = Math.hypot(o.x, o.z); if (d > r) { o.x *= r / d; o.z *= r / d; } }

  class Fight {
    constructor(opts) {
      this.o = Object.assign({ level: 1, rng: Math.random, hp: 100, difficulty: 1 }, opts || {});
      this.diff = Math.max(0.3, Math.min(1.5, this.o.difficulty)); // 1 = normal; < 1 = easier CPU (slower, weaker, less guarded)
      this.rng = this.o.rng;
      this.level = this.o.level;
      this.events = [];
      this.t = 0;
      this.over = null; // 'win' | 'lose'
      this.player = { x: 0, z: -0.55, yaw: 0, hp: this.o.hp, maxHp: this.o.hp, super: 0, combo: 0, maxCombo: 0, dodges: 0, hitsTaken: 0, landed: 0, whiffs: 0, lastHitT: -1e9, lastPunchT: -1e9, lastPunchHand: 'R' };
      this.npc = { x: 0, z: 0.55, vx: 0, vz: 0, hp: this.o.hp, maxHp: this.o.hp, state: 'intro', plan: 'aggro', planSide: 1, attack: null, lastAttack: null, sT: 0, dur: 1500, hurtT: -1e9, hurtHand: 'R', attacksThrown: 0 };
      this.handsUpT = 0;
      this.input = { mx: 0, mz: 0, duck: false, block: false, handsUp: false };
      this.emit('announce', { text: 'FIGHT!', big: true });
      this.emit('sfx', { name: 'bell' });
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }
    drain() { const e = this.events; this.events = []; return e; }

    // difficulty scaling
    // difficulty scaling (this.diff < 1: longer wind-ups, longer rests, weaker guard, slower footwork)
    get speed() { return Math.max(0.45, 1 - 0.09 * (this.level - 1)) / Math.sqrt(this.diff); }
    get guardChance() { return Math.min(0.7, 0.3 + 0.07 * (this.level - 1)) * this.diff; }
    get walkSpeed() { return Math.min(1.4, 0.6 + 0.08 * (this.level - 1)) * Math.sqrt(this.diff); } // arena units / s
    get idleGap() { return [Math.max(300, 800 - 80 * (this.level - 1)) / this.diff, Math.max(600, 1600 - 130 * (this.level - 1)) / this.diff]; }
    get pool() { return ORDER.slice(0, Math.min(ORDER.length, 2 + this.level)); }

    _setNpc(state, dur, attack) {
      this.npc.state = state; this.npc.sT = this.t; this.npc.dur = dur; this.npc.attack = attack || null;
    }
    get npcProgress() { return Math.min(1, (this.t - this.npc.sT) / Math.max(1, this.npc.dur)); }

    // Sol relative to your eyes: fwd = how far in front, lat = how far to your right, dist, ang = world bearing
    get rel() {
      const p = this.player, n = this.npc;
      const dx = n.x - p.x, dz = n.z - p.z, s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      return { fwd: dx * s + dz * c, lat: dx * c - dz * s, dist: Math.hypot(dx, dz), ang: Math.atan2(dx, dz) };
    }
    // Can the two fighters touch each other right now?
    inRange(slack) { const r = this.rel; return r.fwd > 0 && r.fwd <= REACH * (slack || 1) && Math.abs(r.lat) <= LANE; }

    update(dt, input) {
      if (this.over) return;
      this.t += dt;
      if (input) this.input = input;
      const n = this.npc, p = this.player, i = this.input;
      const s = dt / 1000;

      // you walk in the direction you are looking: mx = sideways, mz = forward (each -1..1)
      const mx = clamp(i.mx || 0, -1, 1), mz = clamp(i.mz || 0, -1, 1);
      if (mx || mz) {
        const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
        const ml = mx * STRAFE;
        p.x += (ml * cy + mz * sy) * PSPEED * s;
        p.z += (-ml * sy + mz * cy) * PSPEED * s;
        clampRing(p, RING - 0.15);
      }
      // your eyes follow Sol, except while she is committed to a punch (so a sidestep takes you off her line)
      if (n.state !== 'windup' && n.state !== 'strike') {
        // no spinning: start turning only when she is clearly off-centre, stop once centred (hysteresis),
        // slow down as she comes to centre, and hold still when she is so close her bearing is unstable
        const r0 = this.rel, err = wrap(r0.ang - p.yaw);
        // while you strafe (lean sideways) the view holds: it only turns once she nears the edge of view, and slowly
        const strafing = Math.abs(mx) > 0.1;
        if (Math.abs(err) > (strafing ? 0.6 : 0.18)) this.turning = true; else if (Math.abs(err) < 0.03) this.turning = false;
        if (this.turning && r0.dist > 0.3) {
          const rate = TURN * (strafing ? 0.35 : 1) * Math.min(1, Math.abs(err) / 0.6);
          p.yaw = wrap(p.yaw + clamp(err, -rate * s, rate * s));
        }
      }

      // super: hold both hands up while meter is full
      if (i.handsUp && p.super >= 100) {
        this.handsUpT += dt;
        if (this.handsUpT >= 350) this._super();
      } else this.handsUpT = 0;

      const el = this.t - n.sT;
      n.vx = 0; n.vz = 0;
      switch (n.state) {
        case 'intro':
          if (el >= n.dur) this._idle();
          break;
        case 'idle': {
          this._walk(s);
          if (el >= n.dur) {
            if (this.inRange(0.95)) this._windup();
            else { n.dur += 150; if (n.plan !== 'aggro' && el > 1400) n.plan = 'aggro'; } // done circling/spacing: come get him
          }
          break;
        }
        case 'windup':
          if (el >= n.dur) { this._setNpc('strike', 170, n.attack); this.emit('sfx', { name: 'whoosh' }); }
          break;
        case 'strike': {
          this._moveToward(p, 0.25 * s); // small lunge at you
          if (el >= n.dur) this._resolveStrike(ATTACKS[n.attack]);
          break;
        }
        case 'recover':
          if (el >= n.dur) this._idle();
          break;
        case 'stun':
          if (el >= n.dur) this._setNpc('recover', 300);
          break;
        case 'hurt':
          if (el >= n.dur) this._idle();
          break;
      }
      this._separate();
    }

    _moveToward(target, step) {
      const n = this.npc;
      const dx = target.x - n.x, dz = target.z - n.z, d = Math.hypot(dx, dz) || 1e-6;
      const k = Math.min(1, step / d);
      n.x += dx * k; n.z += dz * k;
      clampRing(n, RING);
    }
    // Sol's footwork while idle: close in, keep spacing, or circle around you.
    _walk(s) {
      const n = this.npc, p = this.player;
      const r = this.rel;
      const want = n.plan === 'space' ? 0.85 : REACH * 0.8;
      const ta = r.ang + (n.plan === 'circle' ? n.planSide * 0.6 * s * 4 : 0); // circle: drift slowly around you (fast orbits made the view spin)
      const tx = p.x + Math.sin(ta) * want, tz = p.z + Math.cos(ta) * want;
      const spd = this.walkSpeed;
      const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz) || 1e-6;
      const k = Math.min(1, spd * s / d);
      const mx = dx * k, mz = dz * k;
      n.x += mx; n.z += mz; clampRing(n, RING);
      n.vx = mx / Math.max(1e-6, s); n.vz = mz / Math.max(1e-6, s);
    }
    _separate() {
      const n = this.npc, p = this.player;
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d < MIN_GAP) {
        const ux = d > 1e-6 ? dx / d : Math.sin(p.yaw), uz = d > 1e-6 ? dz / d : Math.cos(p.yaw);
        n.x = p.x + ux * MIN_GAP; n.z = p.z + uz * MIN_GAP;
        if (Math.hypot(n.x, n.z) > RING) { clampRing(n, RING); p.x = n.x - ux * MIN_GAP; p.z = n.z - uz * MIN_GAP; }
      }
    }

    _idle() {
      const [lo, hi] = this.idleGap;
      const r = this.rng();
      const n = this.npc;
      n.plan = r < 0.25 ? 'space' : r < 0.33 ? 'circle' : 'aggro';
      if (n.plan === 'circle') n.planSide = this.rng() < 0.5 ? -1 : 1;
      this._setNpc('idle', lo + this.rng() * (hi - lo));
    }
    _windup() {
      const pool = this.pool;
      let key = pick(this.rng, pool);
      if (key === this.npc.lastAttack && this.rng() < 0.6) key = pick(this.rng, pool);
      this.npc.lastAttack = key;
      const a = ATTACKS[key];
      this._setNpc('windup', a.windup * this.speed, key);
      this.npc.attacksThrown++;
      this.emit('sfx', { name: 'windup', dur: a.windup * this.speed });
      if (this.npc.attacksThrown <= 8 || this.level === 1) this.emit('hint', { text: a.name + ' - ' + a.hint, dur: a.windup * this.speed });
    }
    _resolveStrike(a) {
      const i = this.input;
      if (!this.inRange(1.1 * Math.min(1, 0.85 + 0.15 * this.diff))) return this._dodged(a, 'footwork'); // easier CPU = easier to step out of reach
      if (i.duck && a.high) return this._dodged(a, 'duck');
      if (i.block && a.blockable) return this._blocked(a);
      this._hitPlayer(a);
    }
    _dodged(a, how) {
      const p = this.player;
      p.dodges++; p.super = Math.min(100, p.super + 25);
      this._setNpc('stun', Math.max(600, 1000 * this.speed));
      this.emit('announce', { text: 'DODGE!', kind: 'good' });
      this.emit('float', { text: pick(this.rng, WOW.dodge), side: 'player', kind: 'good' });
      this.emit('sfx', { name: 'dodge' });
      this.emit('slowmo', { ms: 260 });
      this.emit('dodged', { how });
      if (p.super >= 100) this.emit('announce', { text: 'HANDS UP = HAYMAKER', kind: 'super', sub: true });
    }
    _blocked(a) {
      const p = this.player;
      const d = Math.ceil(a.dmg * 0.25);
      p.hp = Math.max(0, p.hp - d);
      this._setNpc('recover', 350);
      this.emit('announce', { text: 'BLOCKED', kind: 'meh' });
      this.emit('float', { text: pick(this.rng, WOW.block), side: 'player', kind: 'meh' });
      this.emit('sfx', { name: 'block' });
      this.emit('shake', { amt: 4 });
      this._checkKo();
    }
    _hitPlayer(a) {
      const p = this.player;
      const d = Math.round(a.dmg * (1 + 0.05 * (this.level - 1)) * this.diff);
      p.hp = Math.max(0, p.hp - d); p.hitsTaken++; p.combo = 0; p.lastHitT = this.t;
      this._setNpc('recover', 450);
      this.emit('announce', { text: 'NO DODGE!', kind: 'bad' });
      this.emit('float', { text: pick(this.rng, WOW.hit), side: 'player', kind: 'bad' });
      this.emit('sfx', { name: 'nodoge' });
      this.emit('shake', { amt: 14 });
      this.emit('flash', { color: 'rgba(255,40,60,0.45)' });
      this.emit('playerHit', { hand: a.hand, dmg: d });
      this._checkKo();
    }

    // Player throws a punch. Returns a result string for tests/HUD.
    punch(hand, power, kind) {
      if (this.over) return 'over';
      power = power || 1;
      const n = this.npc, p = this.player;
      p.lastPunchT = this.t; p.lastPunchHand = hand;
      this.emit('sfx', { name: 'whoosh' });
      this.emit('playerPunch', { hand, kind: kind || 'straight' });
      if (n.state === 'intro' || n.state === 'ko' || n.state === 'taunt') return 'none';
      if (!this.inRange(1.05)) {
        p.whiffs++;
        this.emit('float', { text: pick(this.rng, WOW.whiff), side: 'player', kind: 'meh' });
        return 'whiff';
      }
      let result, dmg = 0;
      if (n.state === 'stun') {
        dmg = Math.round(11 * power * 1.5);
        result = 'crit';
        n.dur = Math.max(n.dur, this.t - n.sT + 400); // keep him stunned a bit longer
      } else if (n.state === 'windup' && this.npcProgress < 0.4 && this.rng() < 0.65) {
        dmg = Math.round(12 * power);
        result = 'counter';
        this._setNpc('stun', 800);
        this.emit('announce', { text: 'COUNTER!', kind: 'good' });
        this.emit('sfx', { name: 'counter' });
        this.emit('slowmo', { ms: 200 });
      } else if (n.state === 'idle' && this.rng() < this.guardChance) {
        dmg = 2; result = 'guarded';
        this.emit('sfx', { name: 'guard' });
        this.emit('float', { text: 'GUARDED', side: 'npc', kind: 'meh' });
        n.hurtT = this.t; n.hurtHand = hand;
      } else {
        dmg = Math.round(7 * power); result = 'hit';
        if (n.state === 'idle') this._setNpc('hurt', 320);
      }
      if (result !== 'guarded') {
        n.hurtT = this.t; n.hurtHand = hand;
        // knocked back a touch, away from you
        const r = this.rel; n.x += Math.sin(r.ang) * 0.05; n.z += Math.cos(r.ang) * 0.05; clampRing(n, RING);
        p.combo++; p.maxCombo = Math.max(p.maxCombo, p.combo); p.landed++;
        this.emit('sfx', { name: result === 'crit' ? 'crit' : 'hit' });
        this.emit('shake', { amt: result === 'crit' ? 9 : 5 });
        this.emit('float', { text: pick(this.rng, WOW.land), side: 'npc', kind: 'good' });
        if (p.combo >= 3 && p.combo % 3 === 0) this.emit('announce', { text: p.combo + ' COMBO', kind: 'good', sub: true });
      }
      n.hp = Math.max(0, n.hp - dmg);
      this._checkKo();
      return result;
    }

    _super() {
      const n = this.npc, p = this.player;
      p.super = 0; this.handsUpT = -1e9;
      const dmg = 30;
      n.hp = Math.max(0, n.hp - dmg);
      n.hurtT = this.t; n.hurtHand = 'R';
      p.combo += 3; p.landed++;
      this._setNpc('stun', 1300);
      this.emit('announce', { text: 'HAYMAKER', kind: 'super', big: true });
      this.emit('float', { text: 'HAYMAKER', side: 'npc', kind: 'super' });
      this.emit('sfx', { name: 'super' });
      this.emit('shake', { amt: 18 });
      this.emit('flash', { color: 'rgba(255,220,80,0.6)' });
      this.emit('slowmo', { ms: 500 });
      this.emit('superFx', {});
      this._checkKo();
    }

    _checkKo() {
      if (this.over) return;
      if (this.npc.hp <= 0) {
        this.over = 'win'; this._setNpc('ko', 1e9);
        this.emit('announce', { text: 'K.O.', big: true, kind: 'super' });
        this.emit('sfx', { name: 'ko' });
        this.emit('slowmo', { ms: 900 });
        this.emit('over', { result: 'win' });
      } else if (this.player.hp <= 0) {
        this.over = 'lose'; this._setNpc('taunt', 1e9);
        this.emit('announce', { text: 'YOU ARE OUT', big: true, kind: 'bad' });
        this.emit('sfx', { name: 'ko' });
        this.emit('slowmo', { ms: 900 });
        this.emit('over', { result: 'lose' });
      }
    }
  }

  global.Fight = Fight;
  global.ATTACKS = ATTACKS;
  global.ARENA = { REACH, LANE, MIN_GAP, RING, TURN, PSPEED };
})(typeof window !== 'undefined' ? window : globalThis);
