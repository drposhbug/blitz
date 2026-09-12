// main.js — glue: menus, webcam/keyboard input -> gestures -> fight -> audio/render.
(function () {
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const errors = [];
  window.addEventListener('error', e => { errors.push(String(e.message)); const el = $('#errlog'); if (el) el.textContent = errors.join('\n'); });
  window.addEventListener('unhandledrejection', e => { errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)); const el = $('#errlog'); if (el) el.textContent = errors.join('\n'); });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pad2 = n => ('0' + n).slice(-2);

  const canvas = $('#game'), video = $('#cam'), pipc = $('#pipc');
  const renderer = new Renderer(canvas);
  const sfx = new SFX();
  const gest = new GestureDetector();
  const fitness = new Fitness({ weightKg: 75, kcalScale: 2 }); // calorie / activity tracker driven by your real movement
  let cam = null, fight = null, mode = null, running = false, paused = false, screen = 'menu';
  // progress + options
  const prog = Object.assign({ level: 1, bestCombo: 0, kos: 0 }, JSON.parse(localStorage.getItem('dogefight.progress') || '{}'));
  if (localStorage.getItem('dogefight.level')) { prog.level = parseInt(localStorage.getItem('dogefight.level'), 10) || prog.level; }
  const opts = Object.assign({ volume: 80, voice: true, dead: 25, punch: 100, weight: 75, difficulty: 0.6 }, JSON.parse(localStorage.getItem('dogefight.opts') || '{}'));
  let arenaChoice = localStorage.getItem('dogefight.arena') || 'cycle';
  const saveProg = () => { localStorage.setItem('dogefight.progress', JSON.stringify(prog)); localStorage.setItem('dogefight.level', String(prog.level)); };
  const saveOpts = () => localStorage.setItem('dogefight.opts', JSON.stringify(opts));

  let timeScale = 1, slowUntil = 0, lastT = 0, calibUntil = 0;
  const kb = { L: false, R: false, fwd: false, back: false, duck: false, block: false, up: false };
  const walk = { phase: 0, speed: 0 };
  let crouch = 0;
  const kbArms = JSON.parse(JSON.stringify(GUARD_ARMS));
  const kbPunch = { L: 1e9, R: 1e9 };

  function setStatus(s) { $('#status').textContent = s; $('#pipStatus').textContent = s; $('#camStatus').textContent = s.length > 26 ? s.slice(0, 26) + '…' : s.toUpperCase(); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function applyOpts() {
    sfx.setVolume(opts.volume / 100); sfx.voice = !!opts.voice;
    gest.o.punchDelta = 0.25 * (100 / opts.punch); gest.o.punchSpeed = 1.6 * (100 / opts.punch); gest.o.punchSpeedWorld = 1.1 * (100 / opts.punch); // lenient: MediaPipe under-reads motion toward the lens
    fitness.setWeight(opts.weight); if ($('#optWeight')) $('#optWeight').value = opts.weight;
    $('#optVolume').value = opts.volume; $('#optVoice').checked = !!opts.voice; $('#optDead').value = opts.dead; $('#optPunch').value = opts.punch;
    $$('.val').forEach(v => { v.textContent = $('#' + v.dataset.for).value; });
  }
  function refreshMenu() {
    $('#rankVal').textContent = pad2(prog.level); $('#comboVal').textContent = pad2(prog.bestCombo); $('#koVal').textContent = pad2(prog.kos);
    const a = (window.ARENAS || [])[pickArena()]; $('#stageChip').textContent = arenaChoice === 'cycle' ? 'CYCLE · ' + (a ? a.name : '') : (a ? a.name : '');
    assetNote();
  }
  // tell the player which optional image files are still missing from /assets
  function assetNote() {
    const A = window.ASSETS; if (!A) return;
    const miss = A.missing().map(k => A.files[k].replace(/^assets\//, ''));
    if (miss.length) $('#status').textContent = 'drop ' + miss.join(', ') + ' into /assets for the full look';
    else if (/into \/assets/.test($('#status').textContent)) $('#status').textContent = '';
  }
  if (window.ASSETS) window.ASSETS.onLoad(() => { if (screen === 'menu') assetNote(); });

  // ---------- screens ----------
  const SCREENS = ['menu', 'stages', 'controls', 'options', 'log', 'pause', 'intro', 'end'];
  function goto(name) {
    screen = name;
    for (const s of SCREENS) show('#' + s, s === name);
    if (name === 'menu') { refreshMenu(); selectMenu(menuSel); }
    if (name === 'stages') { buildStages(); }
    if (name === 'log') { const b = $('#logBody'); b.innerHTML = ''; fitness.renderLog(b); }
    show('#topbar', name === null);
  }
  let menuSel = 0;
  function selectMenu(i) { const items = $$('#menuList .mi'); menuSel = (i + items.length) % items.length; items.forEach((el, k) => el.classList.toggle('sel', k === menuSel)); }
  function activateMenu() {
    const act = $$('#menuList .mi')[menuSel].dataset.action;
    if (act === 'cam') start('cam'); else if (act === 'kb') start('kb'); else goto(act);
  }

  // ---------- stage select (live thumbnails) ----------
  const thumbs = [];
  function buildStages() {
    const grid = $('#stageGrid'); grid.innerHTML = ''; thumbs.length = 0;
    const DESC = { waterfront: ['A pixel-art night plaza on the river. The K.O. MART neon buzzes on the corner, the bridge lights shimmer on the water, the pavement is still wet.', ['NIGHT', 'PIXEL ART', 'CITY']], rooftop: ['A concrete yard on a rooftop, red circle painted on the floor. Chain-link, paper lanterns, oil drums, the skyline and a water tower behind.', ['NIGHT', 'ROOFTOP']], backstreet: ['A cramped alley under a salmon apartment block. Corrugated shacks, green awnings, cables in the sky, steam from the manhole.', ['LATE AFTERNOON', 'CITY']], shrine: ['Wet stone under weathered torii. Cherry trees move in the wind and shed petals across the cage.', ['MISTY MORNING', 'SHRINE']], temple: ['Lacquered rails and swinging paper lanterns at night. A bronze dragon watches over the cage.', ['NIGHT', 'TEMPLE']] };
    (window.ARENAS || []).forEach((a, i) => {
      const card = document.createElement('div'); card.className = 'card-stage' + (arenaChoice === a.key ? ' sel' : ''); card.dataset.key = a.key;
      const d = DESC[a.key] || ['', []];
      card.innerHTML = `<div class="thumbwrap"><canvas width="960" height="540"></canvas><div class="badge${arenaChoice === a.key ? '' : ' hidden'}">SELECTED</div></div><div class="body"><h3>${a.name}</h3><p>${d[0]}</p><div class="tags">${d[1].map(t => '<span>' + t + '</span>').join('')}</div></div>`;
      card.addEventListener('click', () => chooseStage(a.key));
      card.addEventListener('dblclick', () => { chooseStage(a.key); start(lastMode || 'kb'); });
      grid.appendChild(card);
      const r = new Renderer(card.querySelector('canvas')); r.setArena(i); r.t = i * 1300; thumbs.push(r);
    });
    $('#cycle').checked = arenaChoice === 'cycle';
  }
  function chooseStage(key) {
    arenaChoice = key; localStorage.setItem('dogefight.arena', key);
    $$('.card-stage').forEach(c => { const on = c.dataset.key === key; c.classList.toggle('sel', on); c.querySelector('.badge').classList.toggle('hidden', !on); });
    $('#cycle').checked = false; renderer.setArena(pickArena()); refreshMenu();
  }
  function pickArena() {
    const list = window.ARENAS || [];
    const i = list.findIndex(a => a.key === arenaChoice);
    return i >= 0 ? i : (prog.level - 1) % Math.max(1, list.length);
  }

  // ---------- start / end ----------
  let lastMode = null, introUntil = 0;
  async function start(m) {
    mode = m; lastMode = m;
    sfx.init();
    goto(null);
    $('#pip').classList.toggle('hidden', m !== 'cam');
    if (m === 'cam') {
      try {
        if (!cam) { cam = new PoseCam(video); await cam.start(setStatus); }
        gest.calibrate(); calibUntil = performance.now() + 2500;
        setStatus('stand in guard, hands up by your chin');
        $('#camDot').className = 'dot on';
      } catch (e) {
        setStatus('webcam failed: ' + (e.message || e) + ' - keyboard mode');
        $('#camDot').className = 'dot bad';
        mode = 'kb'; $('#pip').classList.add('hidden');
      }
    }
    newFight();
    if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(loop); }
  }
  function newFight() {
    fight = new Fight({ level: prog.level, difficulty: opts.difficulty }); // 0.6 = easy CPU by default
    fitness.startSession({ stage: renderer.arena ? renderer.arena.name : '', rank: prog.level, mode });
    renderer.setArena(pickArena());
    renderer.hpLagP = 100; renderer.hpLagN = 100; renderer.floats = []; renderer.ann = null; renderer.sub = null;
    $('#introStage').textContent = renderer.arena ? renderer.arena.name : ''; $('#introRank').textContent = 'RANK ' + pad2(prog.level);
    paused = false; goto('intro'); introUntil = curNow + 1900;
  }
  function endScreen(result) {
    const p = fight.player;
    $('#endKicker').textContent = result === 'win' ? 'RANK ' + pad2(prog.level) + ' CLEARED' : 'RANK ' + pad2(prog.level);
    $('#endTitle').textContent = result === 'win' ? 'VICTORY' : 'DEFEAT';
    $('#endTitle').className = result;
    $('#endStats').innerHTML = `dodges <b>${p.dodges}</b> · hits taken <b>${p.hitsTaken}</b> · landed <b>${p.landed}</b> · whiffs <b>${p.whiffs}</b> · best combo <b>${p.maxCombo}</b>`;
    fitness.endSession(result); $('#endStats').insertAdjacentHTML('beforeend', '<br>' + fitness.summaryHTML());
    $('#btnNext').classList.toggle('hidden', result !== 'win');
    endAt = curNow + 1200;
    prog.bestCombo = Math.max(prog.bestCombo, p.maxCombo);
    if (result === 'win') { prog.level++; prog.kos++; }
    saveProg();
  }

  // ---------- keyboard ----------
  const KEYS = { KeyA: 'L', ArrowLeft: 'L', KeyD: 'R', ArrowRight: 'R', KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', Space: 'duck', KeyF: 'block', ShiftLeft: 'block', ShiftRight: 'block', KeyE: 'up' };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (screen === 'menu') {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') selectMenu(menuSel - 1);
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') selectMenu(menuSel + 1);
      else if (e.code === 'Enter' || e.code === 'Space') activateMenu();
      return;
    }
    if (screen === 'stages') {
      const keys = (window.ARENAS || []).map(a => a.key); let i = keys.indexOf(arenaChoice);
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') chooseStage(keys[(Math.max(i, 0) - 1 + keys.length) % keys.length]);
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') chooseStage(keys[(i + 1) % keys.length]);
      else if (e.code === 'Enter') start(lastMode || 'kb');
      else if (e.code === 'Escape') goto('menu');
      return;
    }
    if (screen === 'controls' || screen === 'options' || screen === 'log') { if (e.code === 'Escape' || e.code === 'Enter') goto('menu'); return; }
    if (screen === 'pause') { if (e.code === 'Escape' || e.code === 'Enter') resume(); return; }
    if (screen === 'end') { if (e.code === 'Enter') ($('#btnNext').classList.contains('hidden') ? $('#btnRematch') : $('#btnNext')).click(); else if (e.code === 'Escape') $('#btnMenu').click(); return; }
    if (screen === 'intro') return;
    // in the fight
    if (e.code === 'Escape') { pause(); return; }
    if (e.code === 'KeyJ' || e.code === 'KeyZ') punch('L', 1, 'straight');
    else if (e.code === 'KeyK' || e.code === 'KeyX') punch('R', 1, 'straight');
    else if (e.code === 'KeyC') recalibrate();
    else if (e.code === 'KeyM') toggleMute();
    else if (KEYS[e.code]) { kb[KEYS[e.code]] = true; if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { if (KEYS[e.code]) kb[KEYS[e.code]] = false; });

  function pause() { if (!fight || fight.over) return; paused = true; goto('pause'); }
  function resume() { paused = false; goto(null); }
  function quitToMenu() { paused = false; if (fitness.session) fitness.endSession('quit'); fight = null; show('#pip', false); goto('menu'); }
  function punch(hand, power, kind) {
    if (!fight || fight.over || paused || screen === 'intro') return;
    renderer.playerPunch(hand);
    kbPunch[hand] = 0;
    const res = fight.punch(hand, power, kind); fitness.event('punch', { hand, power, result: res || 'none' }); return res;
  }
  function recalibrate() { if (mode === 'cam') { gest.calibrate(); calibUntil = performance.now() + 2500; setStatus('recalibrating - stand in guard'); } }
  function toggleMute() { sfx.setMuted(!sfx.muted); $('#btnMute').textContent = sfx.muted ? 'MUTED' : 'SOUND'; }

  // ---------- arms ----------
  function armsFromPose(lm) {
    const ls = lm[11], rs = lm[12];
    const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y, (ls.z || 0) - (rs.z || 0)) || 1e-3;
    // f carries a 1.4 depth gain: the camera under-reads reach toward the lens
    const J = (i, sh) => ({ f: 1.4 * (sh.z - (lm[i].z || 0)) / sw, u: (sh.y - lm[i].y) / sw, l: (sh.x - lm[i].x) / sw });
    return { le: J(13, ls), lw: J(15, ls), re: J(14, rs), rw: J(16, rs) };
  }
  // A real jab travels straight at the lens, so the tracked wrist barely moves in the camera image and
  // the on-screen fist would hardly extend. The tracked pose is smoothed, and every detected punch plays
  // a full, visible punch on top of it (out toward the opponent, then back to your real guard).
  const camArms = JSON.parse(JSON.stringify(GUARD_ARMS));
  const PUNCH_POSE = { L: { e: { f: 1.35, u: 0.3, l: 0.25 }, w: { f: 2.4, u: 0.4, l: 0.5 } }, R: { e: { f: 1.35, u: 0.3, l: -0.25 }, w: { f: 2.4, u: 0.4, l: -0.5 } } }; // full extension
  function withPunches(src, dt) {
    const k = Math.min(1, dt / 60);
    for (const key in camArms) for (const c of ['f', 'u', 'l']) camArms[key][c] += (((src[key] && src[key][c]) || 0) - (camArms[key][c] || 0)) * k;
    const out = JSON.parse(JSON.stringify(camArms));
    for (const h of ['L', 'R']) {
      kbPunch[h] += dt;
      const a = kbPunch[h];
      if (a >= 320) continue;
      const p = a < 90 ? a / 90 : Math.max(0, 1 - (a - 90) / 230); // fast out, slower retract
      const e = h === 'L' ? out.le : out.re, w = h === 'L' ? out.lw : out.rw, P = PUNCH_POSE[h];
      for (const c of ['f', 'u', 'l']) { e[c] += (P.e[c] - e[c]) * p; w[c] += (P.w[c] - w[c]) * p; }
    }
    return out;
  }
  function armsFromKeys(dt) {
    const tgt = JSON.parse(JSON.stringify(GUARD_ARMS));
    if (kb.block) { tgt.le = { f: 0.3, u: -0.1, l: 0.15 }; tgt.re = { f: 0.3, u: -0.1, l: -0.15 }; tgt.lw = { f: 0.45, u: 0.55, l: 0.45 }; tgt.rw = { f: 0.45, u: 0.55, l: -0.45 }; }
    if (kb.up) { tgt.le = { f: 0.1, u: 0.7, l: 0 }; tgt.re = { f: 0.1, u: 0.7, l: 0 }; tgt.lw = { f: 0.15, u: 1.4, l: 0.1 }; tgt.rw = { f: 0.15, u: 1.4, l: -0.1 }; }
    for (const h of ['L', 'R']) {
      kbPunch[h] += dt;
      const a = kbPunch[h];
      if (a < 260) {
        const k = a < 100 ? a / 100 : Math.max(0, 1 - (a - 100) / 160);
        const e = h === 'L' ? tgt.le : tgt.re, w = h === 'L' ? tgt.lw : tgt.rw;
        e.f += 0.55 * k; e.u += 0.35 * k; w.f += 1.15 * k; w.u += 0.05 * k; w.l += (h === 'L' ? 0.35 : -0.35) * k;
      }
    }
    const k = Math.min(1, dt / 45);
    for (const key in tgt) for (const c of ['f', 'u', 'l']) kbArms[key][c] += ((tgt[key][c] || 0) - (kbArms[key][c] || 0)) * k;
    return kbArms;
  }

  // ---------- pip skeleton ----------
  const PAIRS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
  function drawPip(lm, st) {
    const c = pipc.getContext('2d'); const w = pipc.width, h = pipc.height;
    c.clearRect(0, 0, w, h);
    if (!lm) return;
    c.save(); c.translate(w, 0); c.scale(-1, 1);
    c.strokeStyle = st.calibrating ? '#d4a13a' : '#e8e4dc'; c.lineWidth = 3; c.lineCap = 'round';
    for (const [a, b] of PAIRS) { c.beginPath(); c.moveTo(lm[a].x * w, lm[a].y * h); c.lineTo(lm[b].x * w, lm[b].y * h); c.stroke(); }
    c.fillStyle = '#c8281e'; for (const i of [0, 15, 16]) { c.beginPath(); c.arc(lm[i].x * w, lm[i].y * h, 5, 0, 6.28); c.fill(); }
    c.restore();
  }

  // ---------- main loop ----------
  function loop() {
    const now = performance.now();
    const realDt = Math.max(0, Math.min(50, now - lastT)); lastT = now;
    if (!window.__fight.freeze) frame(realDt, now);
    requestAnimationFrame(loop);
  }
  let fakeNow = 0, curNow = 0, endAt = Infinity;
  function step(realDt) { fakeNow += realDt; frame(realDt, fakeNow); } // deterministic driver for tests
  let lastPunchSeen = { t: -1e9, hand: 'L', kind: 'straight' };
  const stick = v => { const dz = opts.dead / 100; return Math.sign(v) * Math.max(0, Math.abs(v) - dz) / (1 - dz); };
  // sideways: a bigger dead zone so leaning in your guard doesn't start a strafe; you have to really step
  const stickLean = v => { const dz = Math.max(opts.dead, 40) / 100; return Math.sign(v) * Math.max(0, Math.abs(v) - dz) / (1 - dz); };
  function frame(realDt, now) {
    curNow = now;
    if (screen === 'intro' && now >= introUntil) { show('#intro', false); screen = null; show('#topbar', true); }
    const live = screen === null && !paused;
    timeScale = now < slowUntil ? 0.3 : 1;
    const dt = live ? realDt * timeScale : 0;
    let input, arms, status = null, duck = false;
    if (mode === 'cam') {
      const lm = cam && cam.ready ? cam.detect(now) : null;
      const ev = gest.update(lm, now, cam && cam.ready ? cam.lastWorld : null);
      const st = gest.state;
      drawPip(lm, st);
      for (const e of ev) { if (e.type === 'punch') { lastPunchSeen = { t: now, hand: e.hand, kind: e.kind }; if (now > calibUntil) punch(e.hand, e.power, e.kind); } }
      const tracking = st.tracking && !st.calibrating;
      duck = st.duck;
      input = { mx: tracking ? stickLean(st.x) : 0, mz: tracking ? stick(st.z) : 0, duck, block: st.block, handsUp: st.handsUp };
      arms = withPunches(lm ? armsFromPose(cam.lastWorld || gest.sm || lm) : GUARD_ARMS, realDt);
      if (!cam || !cam.ready) status = $('#status').textContent;
      else if (!lm) status = 'NO BODY DETECTED - step back so your shoulders are in view';
      else if (st.calibrating || now < calibUntil) status = 'CALIBRATING - stand still in your guard (' + Math.max(0, Math.ceil((calibUntil - now) / 1000)) + ')';
      if (now > calibUntil && cam && cam.ready && lm) $('#pipStatus').textContent = now - lastPunchSeen.t < 450 ? 'PUNCH ' + (lastPunchSeen.hand === 'L' ? 'LEFT' : 'RIGHT') + ' · ' + lastPunchSeen.kind.toUpperCase() : st.duck ? 'DUCK' : st.block ? 'BLOCK' : st.handsUp ? 'HANDS UP' : (input.mx || input.mz ? 'WALKING' : 'tracking');
    } else {
      duck = kb.duck;
      input = { mx: (kb.R ? 1 : 0) - (kb.L ? 1 : 0), mz: (kb.fwd ? 1 : 0) - (kb.back ? 1 : 0), duck, block: kb.block, handsUp: kb.up };
      arms = armsFromKeys(realDt);
    }
    if (!live) input = { mx: 0, mz: 0, duck: false, block: false, handsUp: false };
    const spd = Math.min(1, Math.hypot(input.mx, input.mz));
    walk.speed += (spd - walk.speed) * Math.min(1, realDt / 120);
    walk.phase += realDt / 1000 * 9 * Math.max(0.15, walk.speed) * (walk.speed > 0.05 ? 1 : 0);
    crouch += ((duck ? 1 : 0) - crouch) * Math.min(1, realDt / 90);

    if (fight) {
      const frozen = (mode === 'cam' && now < calibUntil) || !live;
      if (!frozen) fight.update(dt, input);
      // pose kinematics for the calorie model: world landmarks (metres) for the wrists, image landmarks + video aspect for the torso
      if (!frozen) fitness.tick(dt, { moving: spd, duck: !!input.duck, block: !!input.block, handsUp: !!input.handsUp, tracking: mode !== 'cam' || !!(cam && cam.ready && now > calibUntil && gest.state.tracking),
        // raw cam.last, not gest.sm: it only changes on a new video frame, so fitness.js can drop repeated frames (the EMA moves every tick)
        pose: mode === 'cam' && cam && cam.ready && gest.state.tracking && cam.last ? { world: cam.lastWorld, img: cam.last, aspect: video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 4 / 3, t: now } : null });
      for (const e of fight.drain()) handle(e);
      if (now >= endAt) { endAt = Infinity; goto('end'); }
    }
    renderer.draw(dt, { fight, input, arms, crouch, walk, status, timeScale, mode });
  }

  function handle(e) {
    switch (e.type) {
      case 'sfx': sfx.play(e.name, e); break;
      case 'announce': renderer.announce(e.text, e.kind, e.big, e.sub); break;
      case 'float': renderer.float(e.text, e.side, e.kind); break;
      case 'shake': renderer.shake(e.amt); break;
      case 'flash': renderer.flash(e.color); break;
      case 'slowmo': slowUntil = curNow + e.ms; break;
      case 'hint': renderer.setHint(e.text, e.dur); break;
      case 'superFx': renderer.superFx(); fitness.event('super'); break;
      case 'playerHit': renderer.playerHit(e.hand); fitness.event('hitTaken', { dmg: e.dmg }); break;
      case 'dodged': fitness.event('dodge', { how: e.how }); break;
      case 'over': endScreen(e.result); break;
    }
  }

  // ---------- UI wiring ----------
  $$('#menuList .mi').forEach((el, i) => { el.addEventListener('mouseenter', () => selectMenu(i)); el.addEventListener('click', () => { selectMenu(i); activateMenu(); }); });
  $('#btnStagesBack').addEventListener('click', () => goto('menu'));
  $('#btnStagesFight').addEventListener('click', () => start(lastMode || 'kb'));
  $('#btnControlsBack').addEventListener('click', () => goto('menu'));
  $('#btnOptionsBack').addEventListener('click', () => goto('menu'));
  $('#cycle').addEventListener('change', e => { if (e.target.checked) { arenaChoice = 'cycle'; localStorage.setItem('dogefight.arena', 'cycle'); $$('.card-stage').forEach(c => { c.classList.remove('sel'); c.querySelector('.badge').classList.add('hidden'); }); renderer.setArena(pickArena()); refreshMenu(); } });
  $('#btnNext').addEventListener('click', () => newFight());
  $('#btnRematch').addEventListener('click', () => newFight());
  $('#btnMenu').addEventListener('click', quitToMenu);
  $('#btnResume').addEventListener('click', resume);
  $('#btnPauseMenu').addEventListener('click', quitToMenu);
  $('#btnPause').addEventListener('click', pause);
  $('#btnMute').addEventListener('click', toggleMute);
  $('#btnRecal').addEventListener('click', recalibrate);
  $('#btnReset').addEventListener('click', () => { prog.level = 1; prog.bestCombo = 0; prog.kos = 0; saveProg(); refreshMenu(); });
  for (const id of ['optVolume', 'optDead', 'optPunch', 'optWeight']) $('#' + id).addEventListener('input', e => { opts[id.slice(3).toLowerCase()] = parseInt(e.target.value, 10); saveOpts(); applyOpts(); });
  $('#optVoice').addEventListener('change', e => { opts.voice = e.target.checked; saveOpts(); applyOpts(); });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#camStatus').textContent = 'NO WEBCAM API'; $('#camDot').className = 'dot bad'; }
  applyOpts();
  // the live calorie readout is drawn on the canvas HUD (render.js reads Fitness.live); no DOM widget is mounted
  $('#btnLogBack').addEventListener('click', () => goto('menu'));

  function fit() {
    const r = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H);
    canvas.style.width = Math.floor(GAME_W * r) + 'px'; canvas.style.height = Math.floor(GAME_H * r) + 'px';
  }
  window.addEventListener('resize', fit); fit();

  // attract-mode render behind the menus (and live stage thumbnails while stage select is open)
  let attractLast = performance.now(), thumbTick = 0;
  (function attract(now) {
    if (!running) {
      const dt = Math.min(50, now - attractLast); attractLast = now;
      renderer.draw(dt, { fight: null, input: {}, arms: GUARD_ARMS, crouch: 0, walk, status: null, timeScale: 1, noArms: screen !== 'menu' });
      if (screen === 'stages' && (thumbTick++ % 4 === 0)) for (const r of thumbs) r.draw(dt * 4, { fight: null, input: {}, arms: GUARD_ARMS, crouch: 0, walk, status: null, timeScale: 1, noArms: true });
      requestAnimationFrame(attract);
    }
  })(performance.now());

  renderer.setArena(pickArena());
  goto('menu');

  // test/debug hook
  window.__fight = { get fight() { return fight; }, gest, renderer, sfx, kb, errors, start, punch, step, armsFromPose, freeze: false, get arms() { return kbArms; }, get mode() { return mode; }, get screen() { return screen; }, set slow(ms) { slowUntil = curNow + ms; }, setArena: i => renderer.setArena(i), goto, get opts() { return opts; } };
  const q = new URLSearchParams(location.search);
  if (q.get('arena')) { arenaChoice = q.get('arena'); renderer.setArena(pickArena()); }
  if (q.get('autostart')) start(q.get('mode') === 'cam' ? 'cam' : 'kb');
})();
