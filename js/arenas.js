// arenas.js — five 360° stages. Two are built from image assets (with painted fallbacks when the
// file is missing): the rooftop is one camera view split into a far cylinder and a real ground
// plane, the waterfront a cylindrical panorama. Three are built from procedural textures (see
// textures.js). Everything is placed by world bearing (radians) and drawn where the camera's yaw
// puts it on screen, so turning around shows the whole environment. Procedural arenas: sky(),
// far(), mid(), near(), particles() + palette. Image arenas: full: true + draw(ctx, cam, P).
(function (global) {
  const TAU = Math.PI * 2;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const hash = i => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const PPR = 560; // pixels per radian of view

  // cam: { yaw, t, W, H, HZ }  ->  screen x of a bearing, or null when it is out of view
  function sx(cam, ang, margin) { const d = wrap(ang - cam.yaw); if (Math.abs(d) > 1.05 + (margin || 0)) return null; return cam.W / 2 + d * PPR; }
  const T = (ctx, name) => global.TEX.pattern(ctx, name);

  // textured rect with a lighting overlay: k < 1 darkens, > 1 lightens (drawn as white)
  function texRect(ctx, name, x, y, w, h, scale, k) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale || 1, scale || 1);
    ctx.fillStyle = T(ctx, name); ctx.fillRect(0, 0, w / (scale || 1), h / (scale || 1)); ctx.restore();
    if (k !== undefined && k !== 1) { ctx.fillStyle = k < 1 ? `rgba(10,8,12,${1 - k})` : `rgba(255,245,230,${(k - 1) * 0.6})`; ctx.fillRect(x, y, w, h); }
  }
  // vertical ambient-occlusion band at the base of a wall
  function groundAO(ctx, x, y, w, h) { const g = ctx.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = g; ctx.fillRect(x, y - h, w, h); }
  // a lit building front + a darker receding side face (light from upper-left)
  function facade(ctx, x, y, w, h, tex, scale, o) {
    o = o || {};
    const side = o.side === undefined ? Math.round(w * 0.16) : o.side;
    // side face, sheared
    if (side) {
      ctx.save(); ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + side, y - side * 0.35); ctx.lineTo(x + w + side, y + h - side * 0.35); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.clip();
      texRect(ctx, tex, x + w, y - side * 0.35, side, h + side * 0.35, scale, 0.58); ctx.restore();
    }
    texRect(ctx, tex, x, y, w, h, scale, o.k === undefined ? 1 : o.k);
    // parapet / roof line
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y + 4, w, 2);
    groundAO(ctx, x, y + h, w + side, Math.min(60, h * 0.35));
  }
  // window grid with frames, glass and some lights on
  function windows(ctx, x, y, w, h, cols, rows, seed, t, o) {
    o = o || {};
    const cw = w / cols, ch = h / rows, ww = cw * 0.5, wh = ch * 0.55;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const wx = x + c * cw + (cw - ww) / 2, wy = y + r * ch + (ch - wh) / 2;
      const lit = o.night ? hash(seed + r * 13 + c) > 0.45 : hash(seed + r * 13 + c) > 0.85;
      ctx.fillStyle = '#2b2a30'; ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      if (lit) { g.addColorStop(0, '#ffe2b0'); g.addColorStop(1, '#d9a95a'); }
      else { g.addColorStop(0, o.night ? '#1a1c26' : '#8fa4b3'); g.addColorStop(0.5, o.night ? '#242836' : '#c9d5dc'); g.addColorStop(1, o.night ? '#151720' : '#6f8593'); }
      ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh); ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);
      if (o.balcony && r > 0) { ctx.fillStyle = '#4a4a50'; ctx.fillRect(wx - 8, wy + wh + 2, ww + 16, 4); ctx.strokeStyle = '#3a3a40'; ctx.lineWidth = 1.5; for (let k = 0; k <= 6; k++) { ctx.beginPath(); ctx.moveTo(wx - 8 + k * (ww + 16) / 6, wy + wh - 10); ctx.lineTo(wx - 8 + k * (ww + 16) / 6, wy + wh + 2); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(wx - 8, wy + wh - 10); ctx.lineTo(wx + ww + 8, wy + wh - 10); ctx.stroke(); }
      if (o.ac && hash(seed * 3 + r * 7 + c) > 0.7) { ctx.fillStyle = '#c9c6bd'; ctx.fillRect(wx + ww - 12, wy + wh + 4, 16, 10); ctx.fillStyle = '#7a7873'; ctx.fillRect(wx + ww - 10, wy + wh + 6, 12, 6); }
    }
  }
  function awning(ctx, x, y, w, t, col, col2) {
    const sag = Math.sin(t / 900) * 2;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 10, y + 26 + sag); ctx.lineTo(x + 10, y + 26 + sag); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.clip();
    ctx.fillStyle = col2; for (let k = 0; k < w; k += 28) ctx.fillRect(x + k, y, 14, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + 20 + sag, w, 8);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 6, y + 26 + sag, w - 12, 10);
    // scalloped edge
    ctx.fillStyle = col; for (let k = 12; k < w - 10; k += 16) { ctx.beginPath(); ctx.arc(x + k, y + 26 + sag, 7, 0, Math.PI); ctx.fill(); }
  }
  function signboard(ctx, x, y, w, h, text, t, seed) {
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    const flick = hash(Math.floor(t / 300) + seed) > 0.06 ? 1 : 0.4;
    ctx.fillStyle = `rgba(240,236,224,${flick})`; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.translate(x + w / 2, y + 10); ctx.fillStyle = `rgba(34,30,30,${flick})`; ctx.font = `bold ${Math.floor(w * 0.62)}px "Yu Gothic", "Meiryo", "MS Gothic", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < text.length; i++) ctx.fillText(text[i], 0, i * w * 0.7);
    ctx.restore();
  }
  function vending(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-26, -2, 60, 6);
    const g = ctx.createLinearGradient(-24, 0, 24, 0); g.addColorStop(0, '#d64a3a'); g.addColorStop(0.6, '#b8342a'); g.addColorStop(1, '#7c1f18');
    ctx.fillStyle = g; ctx.fillRect(-24, -96, 48, 96);
    ctx.fillStyle = '#1c1c22'; ctx.fillRect(-20, -90, 40, 36);
    ctx.fillStyle = `rgba(255,240,200,${0.75 + Math.sin(t / 400) * 0.1})`; ctx.fillRect(-18, -88, 36, 32);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { ctx.fillStyle = ['#3a7bd5', '#e0c040', '#3fa35a', '#d94a3a'][(c + r) % 4]; ctx.fillRect(-16 + c * 9, -84 + r * 14, 6, 10); }
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(-20, -48, 40, 12); ctx.fillRect(-20, -30, 16, 22);
    ctx.fillStyle = '#e8e4dc'; ctx.fillRect(4, -46, 12, 6);
    ctx.restore();
  }
  function boxes(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    for (const [bx, by, bw, bh] of [[0, -30, 44, 30], [10, -56, 34, 26], [48, -24, 30, 24]]) {
      ctx.fillStyle = '#b48a5a'; ctx.fillRect(bx, by, bw, bh); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx + bw - 10, by, 10, bh); ctx.strokeStyle = '#7a5a36'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh); ctx.fillStyle = '#8a6a44'; ctx.fillRect(bx + 4, by + 6, bw - 14, 3);
    }
    ctx.restore();
  }
  function pole(ctx, x, y, h) {
    ctx.fillStyle = '#3d3a36'; ctx.fillRect(x - 5, y - h, 10, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x - 5, y - h, 3, h);
    ctx.fillStyle = '#3d3a36'; ctx.fillRect(x - 34, y - h + 14, 68, 6); ctx.fillRect(x - 26, y - h + 34, 52, 5);
    ctx.fillStyle = '#c9c6bd'; for (const k of [-30, -12, 8, 26]) ctx.fillRect(x + k, y - h + 8, 4, 8);
    groundAO(ctx, x - 5, y, 10, 30);
  }
  function drainpipe(ctx, x, y, h) { ctx.fillStyle = '#5b5e5a'; ctx.fillRect(x, y - h, 7, h); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y - h, 2, h); ctx.fillStyle = '#4a4d48'; for (let k = 0; k < h; k += 40) ctx.fillRect(x - 2, y - h + k, 11, 5); }
  function manholeSteam(ctx, x, y, t, seed) {
    ctx.fillStyle = '#2c2c2e'; ctx.beginPath(); ctx.ellipse(x, y, 34, 9, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#55554f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const k = ((t / 2800 + i * 0.17 + hash(seed + i)) % 1);
      ctx.globalAlpha = 0.18 * (1 - k); ctx.fillStyle = '#e8e6e0';
      ctx.beginPath(); ctx.arc(x + Math.sin(k * 5 + i) * 18 + k * 30, y - k * 150, 12 + k * 34, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function cable(ctx, x0, y0, x1, y1, sag, t, seed) {
    if (x0 === null || x1 === null) return;
    ctx.strokeStyle = 'rgba(24,22,26,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag + Math.sin(t / 1300 + seed) * 4, x1, y1); ctx.stroke();
  }

  // ---------- shrine props ----------
  function tree(ctx, x, y, s, t, seed, blossom) {
    const sway = Math.sin(t / 1400 + seed * 7) * 5;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    // trunk with bark texture
    ctx.save(); ctx.beginPath(); ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-4, -80, sway * 0.4 - 6, -150); ctx.lineTo(sway * 0.4 + 6, -150); ctx.quadraticCurveTo(8, -80, 12, 0); ctx.closePath(); ctx.clip();
    texRect(ctx, 'woodDark', -20, -160, 40, 170, 0.5, 0.95); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(4, -160, 10, 170); ctx.restore();
    ctx.strokeStyle = '#3b2418'; ctx.lineCap = 'round'; ctx.lineWidth = 7;
    for (let i = 0; i < 6; i++) { const a = -2.1 + i * 0.6 + (hash(seed + i) - 0.5) * 0.4, len = 70 + hash(seed + 9 * i) * 40; const bx = Math.cos(a) * len + sway, by = -125 + Math.sin(a) * len * 0.6; ctx.beginPath(); ctx.moveTo(sway * 0.4, -135); ctx.quadraticCurveTo(bx * 0.5, -160, bx, by); ctx.stroke(); }
    // canopy: clusters of small leaves, three tones, lit from above-left
    const tones = blossom ? ['#f6cfe0', '#e9a9c4', '#c97ea0'] : ['#8fc16a', '#4f8a3f', '#2f5a2c'];
    for (let i = 0; i < 16; i++) {
      const h = hash(seed * 3 + i), h2 = hash(seed * 5 + i);
      const cx = (h - 0.5) * 240 + sway * (0.6 + h2 * 0.8), cy = -175 - h2 * 95 + Math.sin(t / 800 + i) * 3;
      const r = 24 + hash(seed + 11 * i) * 26;
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, tones[0]); g.addColorStop(0.55, tones[1]); g.addColorStop(1, tones[2]);
      ctx.fillStyle = g; ctx.beginPath();
      for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, rr = r * (0.8 + hash(seed + i * 7 + k) * 0.35); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    groundAO(ctx, x - 40 * s, y, 80 * s, 24);
  }
  function torii(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    for (const px of [-70, 54]) { texRect(ctx, 'woodRed', px, -170, 18, 170, 0.35, 1); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px + 12, -170, 6, 170); ctx.fillStyle = '#2a2a2e'; ctx.fillRect(px - 4, -6, 26, 8); }
    texRect(ctx, 'woodDark', -62, -132, 126, 12, 0.35, 0.9);
    ctx.save(); ctx.beginPath(); ctx.moveTo(-104, -176); ctx.quadraticCurveTo(0, -196, 104, -176); ctx.lineTo(104, -160); ctx.quadraticCurveTo(0, -180, -104, -160); ctx.closePath(); ctx.clip(); texRect(ctx, 'woodRed', -104, -200, 208, 44, 0.35, 1.05); ctx.restore();
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.moveTo(-108, -194); ctx.quadraticCurveTo(0, -214, 108, -194); ctx.lineTo(108, -186); ctx.quadraticCurveTo(0, -206, -108, -186); ctx.closePath(); ctx.fill();
    // shimenawa rope + paper zigzags
    ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-58, -128); ctx.quadraticCurveTo(0, -104 + Math.sin(t / 1000) * 2, 58, -128); ctx.stroke();
    ctx.fillStyle = '#f4efe4'; for (const k of [-30, 0, 30]) { ctx.beginPath(); ctx.moveTo(k - 5, -120); ctx.lineTo(k + 5, -120); ctx.lineTo(k + 2, -100); ctx.lineTo(k - 6, -94); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    groundAO(ctx, x - 80 * s, y, 160 * s, 20);
  }
  function stoneLantern(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    texRect(ctx, 'stone', -14, -60, 28, 60, 0.4, 0.95); texRect(ctx, 'stone', -26, -68, 52, 8, 0.4, 1.05);
    texRect(ctx, 'stone', -18, -100, 36, 34, 0.4, 1); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(10, -100, 8, 34);
    ctx.fillStyle = '#ffd98a'; ctx.globalAlpha = 0.8; ctx.fillRect(-10, -94, 20, 22); ctx.globalAlpha = 1;
    ctx.fillStyle = '#6a746e'; ctx.beginPath(); ctx.moveTo(-32, -100); ctx.lineTo(0, -124); ctx.lineTo(32, -100); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(80,120,70,0.5)'; ctx.fillRect(-14, -14, 12, 14); ctx.fillRect(6, -22, 8, 22);
    ctx.restore();
    groundAO(ctx, x - 20 * s, y, 40 * s, 16);
  }
  function stoneWall(ctx, x0, x1, y, h, mossSeed) {
    if (x0 === null || x1 === null) return;
    texRect(ctx, 'stoneDark', x0, y - h, x1 - x0, h, 0.6, 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let yy = y - h; yy < y; yy += 22) { ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); const off = ((yy / 22) % 2) * 30; for (let xx = x0 + off; xx < x1; xx += 60) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 22); ctx.stroke(); } }
    ctx.fillStyle = 'rgba(90,130,70,0.35)'; for (let k = 0; k < (x1 - x0) / 40; k++) { const mx = x0 + k * 40 + hash(mossSeed + k) * 30; ctx.beginPath(); ctx.ellipse(mx, y - 6 - hash(mossSeed * 3 + k) * 14, 14, 7, 0, 0, TAU); ctx.fill(); }
    groundAO(ctx, x0, y, x1 - x0, 14);
  }
  function mountains(ctx, cam, col, amp, seed, yBase) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-10, yBase + 40);
    for (let px = -10; px <= cam.W + 10; px += 12) {
      const a = cam.yaw + (px - cam.W / 2) / PPR;
      const h = (Math.sin(a * 2.1 + seed) + Math.sin(a * 5.3 + seed * 2) * 0.5 + Math.sin(a * 11 + seed * 3) * 0.25) * amp;
      ctx.lineTo(px, yBase - Math.max(0, h + amp * 0.6));
    }
    ctx.lineTo(cam.W + 10, yBase + 40); ctx.closePath(); ctx.fill();
  }

  // ---------- temple props ----------
  function lantern(ctx, x, y, s, t, seed) {
    const sw = Math.sin(t / 900 + seed * 3) * 0.1;
    ctx.save(); ctx.translate(x, y); ctx.rotate(sw); ctx.scale(s, s);
    ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.stroke();
    const g = ctx.createRadialGradient(0, 50, 4, 0, 50, 80); g.addColorStop(0, 'rgba(255,170,60,0.45)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 50, 80, 0, TAU); ctx.fill();
    const b = ctx.createLinearGradient(-22, 0, 22, 0); b.addColorStop(0, '#b8481c'); b.addColorStop(0.35, '#ff8a3a'); b.addColorStop(0.6, '#ffb060'); b.addColorStop(1, '#a83f18');
    ctx.fillStyle = b; ctx.beginPath(); ctx.ellipse(0, 50, 22, 28, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(60,20,5,0.35)'; ctx.lineWidth = 1.5; for (let k = -18; k <= 18; k += 9) { ctx.beginPath(); ctx.ellipse(0, 50 + k, 22 * Math.sqrt(1 - (k / 28) ** 2), 3, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = '#3a1a0a'; ctx.fillRect(-10, 22, 20, 5); ctx.fillRect(-10, 74, 20, 5);
    ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 79); ctx.lineTo(0, 98); ctx.stroke();
    ctx.restore();
  }
  function lacquerRail(ctx, x0, x1, y, h) {
    if (x0 === null || x1 === null) return;
    const g = ctx.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, '#8a1f14'); g.addColorStop(0.5, '#c8281e'); g.addColorStop(1, '#5c120b');
    ctx.fillStyle = g; ctx.fillRect(x0, y - h, x1 - x0, 8); ctx.fillRect(x0, y - 8, x1 - x0, 8);
    ctx.fillStyle = 'rgba(255,200,160,0.35)'; ctx.fillRect(x0, y - h, x1 - x0, 2);
    ctx.fillStyle = '#7a1a10';
    for (let x = x0; x < x1; x += 46) { ctx.fillRect(x, y - h, 5, h); ctx.fillRect(x + 12, y - h + 14, 24, 4); ctx.fillRect(x + 12, y - 18, 24, 4); ctx.fillRect(x + 12, y - h + 14, 4, h - 28); ctx.fillRect(x + 32, y - h + 14, 4, h - 28); ctx.fillRect(x + 22, y - h + 14, 4, h * 0.45); }
    groundAO(ctx, x0, y, x1 - x0, 12);
  }
  function dragon(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const glow = ctx.createRadialGradient(0, -140, 20, 0, -140, 280); glow.addColorStop(0, 'rgba(255,180,80,0.28)'); glow.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -140, 280, 0, TAU); ctx.fill();
    const body = ctx.createLinearGradient(-60, 0, 60, 0); body.addColorStop(0, '#6a4a18'); body.addColorStop(0.45, '#d4a13a'); body.addColorStop(0.6, '#f0cc70'); body.addColorStop(1, '#5a3c12');
    ctx.strokeStyle = body; ctx.lineWidth = 36; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-120, 0); ctx.bezierCurveTo(-140, -120, 40, -60, 20, -150); ctx.bezierCurveTo(0, -230, -110, -190, -60, -260); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,40,10,0.55)'; ctx.lineWidth = 5;
    for (let i = 0; i < 14; i++) { const k = i / 14; ctx.beginPath(); ctx.moveTo(-120 + k * 140 - 12, -k * 150 - 8); ctx.lineTo(-120 + k * 140 + 12, -k * 150 + 8); ctx.stroke(); }
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(-60, -270, 50, 30, -0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-100, -280); ctx.lineTo(-156, -292); ctx.lineTo(-96, -262); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#a07a2a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-50, -298); ctx.lineTo(-30, -352); ctx.moveTo(-72, -296); ctx.lineTo(-70, -354); ctx.stroke();
    ctx.fillStyle = '#ff3d1a'; ctx.beginPath(); ctx.arc(-84, -276, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e0b04a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-104, -268); ctx.quadraticCurveTo(-150 + Math.sin(t / 500) * 6, -250, -170, -270); ctx.stroke();
    ctx.restore();
  }
  function pagoda(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#0c0818';
    for (let i = 0; i < 4; i++) { const w = 130 - i * 26, yy = -i * 46; ctx.beginPath(); ctx.moveTo(-w, yy); ctx.quadraticCurveTo(-w - 20, yy - 6, -w - 10, yy - 24); ctx.lineTo(w + 10, yy - 24); ctx.quadraticCurveTo(w + 20, yy - 6, w, yy); ctx.closePath(); ctx.fill(); ctx.fillRect(-w + 22, yy - 46, 2 * w - 44, 24); }
    ctx.fillRect(-4, -210, 8, 30);
    ctx.restore();
  }

  function makeParticles(n, init) { const a = []; for (let i = 0; i < n; i++) a.push(init(i)); return a; }
  function drift(cam, st) { const d = -(cam.yaw - (st.yaw === undefined ? cam.yaw : st.yaw)) * PPR; st.yaw = cam.yaw; return d; }

  // ---------- image stages ----------
  // A stage built from an image asset (see assets.js) is a cylindrical panorama: one loop canvas
  // whose width is a full turn (2π·PPR px), tiled horizontally as the yaw changes. The image already
  // contains the floor, so these stages are `full: true` and render.js world() draws nothing else
  // behind the opponent. When the file is missing the same loop is painted procedurally.
  const PANO_W = Math.round(TAU * PPR); // 3519 px = one full turn
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const asset = name => (global.ASSETS && global.ASSETS.get(name)) || null;
  // tile the loop so that its column `face` (0..1) sits at bearing 0; `top` = screen y of the loop's top edge
  function tilePano(ctx, cam, pano, top, face, shift) {
    const period = pano.width;
    let x = ((cam.W / 2 - cam.yaw * PPR - face * period + (shift || 0)) % period + period) % period - period;
    for (; x < cam.W; x += period) ctx.drawImage(pano, Math.round(x), Math.round(top));
  }
  // screen x of loop fraction u (0..1 around the turn), or null when it is well off screen
  const ux = (cam, u, face, margin) => sx(cam, (u - face) * TAU, margin === undefined ? 0.4 : margin);
  // soft radial light; col is an rgba string with 'A' where the alpha goes
  function glow(ctx, x, y, r, col, a) { if (x === null || a <= 0) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col.replace('A', a.toFixed(3))); g.addColorStop(1, col.replace('A', '0')); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  function vignette(ctx, cam, col, a) { const g = ctx.createRadialGradient(cam.W / 2, cam.HZ + 40, 220, cam.W / 2, cam.HZ + 40, 780); g.addColorStop(0, col.replace('A', '0')); g.addColorStop(1, col.replace('A', String(a))); ctx.fillStyle = g; ctx.fillRect(-120, -400, cam.W + 240, cam.H + 800); }

  // where the lights are, as fractions of the source image (u across, v down); the procedural
  // fallbacks paint their lamps at exactly these spots, the real images get best-effort glows
  const WF = { lamps: [[0.26, 0.30], [0.50, 0.30], [0.75, 0.30]], neon: [0.105, 0.25], open: [0.13, 0.45], windows: [[0.85, 0.16], [0.89, 0.16], [0.85, 0.27], [0.89, 0.27], [0.85, 0.38], [0.89, 0.38]] };

  // ---------- rooftop: one painted camera view, split at its horizon ----------
  // The picture is a single view, not a panorama, so it is used as two things. Everything above the
  // fence base (sky, skyline, fence, lanterns, drums) is a far cylinder wrapped around the turn as
  // image, mirror, image, mirror: the fence pattern and the drums on both edges hide the seams. The
  // concrete below the fence base is unprojected once into a top-down floor texture and re-projected
  // every frame as a true ground plane with render.js's project(), so the painted red circle stays on
  // the floor around the ring centre and turns and slides with the player.
  const RF = {
    W: 1672, H: 941, HZ: 508,          // picture size; row where the floor meets the fence base (measured)
    COPIES: 4, SY: 1.1,                // fence copies per turn; extra vertical stretch of the strip
    FADE0: 520, FADE1: 610,            // floor rows kept on the cylinder under the fence, fading out over the plane
    // the picture's own camera, fitted to the painted circle so that it is the ring edge (radius
    // RING = 1.7 at the world origin): sx = 836 + lat*A/(fwd+B), sy = HZ + C/(fwd+B), eye D behind the origin
    A: 473, C: 181, B: 0.32, D: 2.11,
    TEX: 1536, EXT: 4,                 // floor texture: TEX px across ±EXT world units (192 px per unit)
    lanterns: [[160, 214], [1508, 214]], posts: [130, 490, 895, 1245, 1520],
    windows: [[350, 147], [455, 147], [1455, 147], [1555, 147], [590, 262], [1140, 215], [950, 300], [1140, 330]],
    stars: [[620, 34], [1172, 64], [1000, 91], [760, 120], [900, 110], [1050, 130], [1220, 140], [580, 125], [960, 60], [1130, 100], [1300, 90]],
    sky: '#090b14', flat: [44, 36, 31], flatCss: 'rgb(44,36,31)',
  };
  const PT = { x: 0, y: 0, u: 0 }; // scratch result of the rooftop's point mapping (no per-frame allocation)

  // the far strip: rows 0..FADE1 of the picture, COPIES times around the turn (mirrored every other
  // copy), the floor rows under the fence base fading to transparent so the ground plane shows through
  function buildRoofStrip(src) {
    const cw = PANO_W / RF.COPIES, s = cw / RF.W, sy = s * RF.SY, h = Math.round(RF.FADE1 * sy);
    const c = mkCanvas(PANO_W, h), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    for (let i = 0; i < RF.COPIES; i++) {
      const x0 = Math.round(i * cw), w = Math.round((i + 1) * cw) - x0;
      g.save(); if (i % 2) { g.translate(x0 + w, 0); g.scale(-1, 1); } else g.translate(x0, 0);
      g.drawImage(src, 0, 0, RF.W, RF.FADE1, 0, 0, w, h); g.restore();
      const k = [0, 0.08, 0.15, 0.08][i % 4]; // the copies away from the front a touch darker, for depth
      if (k) { g.fillStyle = `rgba(4,6,14,${k})`; g.fillRect(x0, 0, w, h); }
    }
    const f0 = RF.FADE0 * sy, fade = g.createLinearGradient(0, f0, 0, h); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, f0, PANO_W, h - f0);
    return { c, s, sy, cw, h, base: RF.HZ * sy };
  }

  // the floor plane: the picture's concrete unprojected through its fitted camera into a top-down
  // texture. The crisp near half of the picture is used in front of the ring centre and, point-
  // mirrored, behind it (the mirror keeps the circle a circle); the blurry far rows only fill the
  // wedges neither covers, and beyond the yard the concrete fades to plain dark.
  // Built with drawImage only: the picture is a file:// image, so its pixels can never be read (a
  // canvas it touches is tainted), but it can be copied freely. The texture is a map with +z up.
  function buildRoofFloor(src) {
    const N = RF.TEX, ppu = N / (2 * RF.EXT), IH = RF.H - RF.HZ, { A, C, B, D } = RF, h = N / 2;
    // every picture row below the horizon is a strip of floor at one depth (fwd + B = C / rows below
    // the horizon): copy it to where that strip lies on the map. Rows entirely beyond the map are skipped.
    const rows = g => {
      for (let j = 1; j < IH; j++) {
        const qFar = C / j, qNear = C / (j + 1), qMid = C / (j + 0.5); if (qNear - B - D > RF.EXT + 0.2) continue;
        const y0 = h - (qFar - B - D) * ppu, y1 = h - (qNear - B - D) * ppu, half = 836 * qMid / A * ppu;
        g.drawImage(src, 0, RF.HZ + j, RF.W, 1, h - half, y0, half * 2, y1 - y0);
      }
    };
    const out = mkCanvas(N, N), og = out.getContext('2d'); og.imageSmoothingQuality = 'high';
    og.fillStyle = RF.flatCss; og.fillRect(0, 0, N, N);
    og.setTransform(-1, 0, 0, -1, N, N); rows(og); og.setTransform(1, 0, 0, 1, 0, 0); // the picture point-mirrored: fills what the picture itself cannot reach behind the eye
    rows(og);                                                                          // the picture: crisp near rows in front of the ring centre, blurry far rows behind it
    // the crisp near rows again, point-mirrored over the far half (a point mirror keeps the circle a
    // circle), blended in across the middle
    const tmp = mkCanvas(N, N), tg = tmp.getContext('2d'); tg.imageSmoothingQuality = 'high';
    tg.setTransform(-1, 0, 0, -1, N, N); rows(tg); tg.setTransform(1, 0, 0, 1, 0, 0);
    const mask = tg.createLinearGradient(0, h + 0.25 * ppu, 0, h - 0.25 * ppu); mask.addColorStop(0, 'rgba(0,0,0,0)'); mask.addColorStop(1, 'rgba(0,0,0,1)');
    tg.globalCompositeOperation = 'destination-in'; tg.fillStyle = mask; tg.fillRect(0, 0, N, N);
    og.drawImage(tmp, 0, 0);
    // beyond the yard the concrete fades to plain dark
    const fade = og.createRadialGradient(h, h, 2.6 * ppu, h, h, 3.9 * ppu); fade.addColorStop(0, `rgba(${RF.flat.join(',')},0)`); fade.addColorStop(1, RF.flatCss);
    og.fillStyle = fade; og.fillRect(0, 0, N, N);
    // a 64 px/unit copy for the far rows (stepwise, so it stays clean), and the two per-frame patches
    const half = mkCanvas(N / 2, N / 2); half.getContext('2d').drawImage(out, 0, 0, N / 2, N / 2);
    const ppuM = 64, M = 2 * RF.EXT * ppuM, mid = mkCanvas(M, M); mid.getContext('2d').drawImage(half, 0, 0, M, M);
    const ppuN = ppu, fwdN = 2, fwdM0 = 1.8, fwdM1 = 5.2; // the near patch at the texture's own resolution (upscaling it would gain nothing)
    const near = mkCanvas(2 * 2.75 * ppuN, fwdN * ppuN), midc = mkCanvas(2 * 6.5 * ppuM, Math.ceil((fwdM1 - fwdM0) * ppuM));
    return { tex: out, mid, ppuT: ppu, ppuM, ppuN, fwdN, fwdM0, fwdM1, near, nearG: near.getContext('2d'), midc, midG: midc.getContext('2d') };
  }

  // draw the floor plane for this frame: the texture is warped into the camera frame (across = lat,
  // down = fwd) once at two resolutions, then every screen row below the horizon copies the slice of
  // it that render.js's project() says is there (sc = 0.72/(fwd+0.32), y = HZ + 230*sc, x = W/2 + lat*600*sc)
  function drawRoofFloor(ctx, cam, P, F) {
    const HZ = cam.HZ, W = cam.W, s = Math.sin(cam.yaw), c = Math.cos(cam.yaw), px = P ? P.x : 0, pz = P ? P.z : -0.55;
    const warp = (g, tex, texPpu, ppu, fwd0) => {
      const k = ppu / texPpu, h = tex.width / 2, W2 = g.canvas.width / 2;
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = RF.flatCss; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
      g.setTransform(k * c, k * s, k * s, -k * c, W2 - k * h * (c + s) - ppu * (px * c - pz * s), k * h * (c - s) - ppu * (px * s + pz * c + fwd0));
      g.drawImage(tex, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    };
    warp(F.nearG, F.tex, F.ppuT, F.ppuN, 0); warp(F.midG, F.mid, F.ppuM, F.ppuM, F.fwdM0);
    ctx.fillStyle = RF.flatCss; ctx.fillRect(-120, HZ, W + 240, cam.H + 200);
    const yTop = HZ + Math.ceil(165.6 / (F.fwdM1 + 0.32)), yBot = cam.H + 160;
    for (let y = yTop; y < yBot;) {
      const h = Math.max(1, Math.floor((y - HZ) / 60)); // bands grow with nearness; the width error at a band's edge stays under 3 px
      const fA = 165.6 / (y - HZ) - 0.32, fB = 165.6 / (y + h - HZ) - 0.32, lh = 191.67 / (y + h / 2 - HZ); // far edge, near edge, half width in lat (covers -20..W+20)
      const nearBand = fA <= F.fwdN, src = nearBand ? F.near : F.midc, ppu = nearBand ? F.ppuN : F.ppuM, f0 = nearBand ? 0 : F.fwdM0;
      const sw = 2 * lh * ppu, sy0 = Math.max(0, (fB - f0) * ppu), sh = Math.min(src.height - sy0, Math.max(0.5, (fA - f0) * ppu - sy0));
      ctx.drawImage(src, src.width / 2 - sw / 2, sy0, sw, sh, -20, y, W + 40, h);
      y += h;
    }
  }

  // pixel-art night waterfront, painted small (1173x390) and scaled x3 with no smoothing
  function procWaterfront(g, W, H) {
    const hz = Math.round(H * 0.38), X = u => Math.round(u * W), Y = v => Math.round(v * H);
    const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#0a0722'); sky.addColorStop(0.5, '#2e1547'); sky.addColorStop(0.82, '#7c2f52'); sky.addColorStop(1, '#e8823c'); g.fillStyle = sky; g.fillRect(0, 0, W, hz);
    for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + hash(i) * 0.6})`; g.fillRect(Math.floor(hash(i * 7.1) * W), Math.floor(hash(i * 13.3) * hz * 0.55), i % 3 === 0 ? 2 : 1, 1); }
    // skyline: two layers of towers with lit windows
    const towers = (col, seed, hmin, hmax, litCol) => { let x = -10; while (x < W) { const w = 22 + Math.floor(hash(seed + x) * 50), h = Math.round(hmin + hash(seed * 3 + x) * (hmax - hmin)); g.fillStyle = col; g.fillRect(x, hz - h, w, h); if (hash(seed + x * 5) > 0.6) g.fillRect(x + (w >> 1) - 1, hz - h - 10, 3, 10); g.fillStyle = litCol; for (let r = 2; r < h - 4; r += 6) for (let c = 2; c < w - 3; c += 5) if (hash(seed + x * 11 + r * 31 + c * 7) > 0.6) g.fillRect(x + c, hz - h + r, 2, 3); x += w + 2 + Math.floor(hash(seed + x + 1) * 10); } };
    towers('#241a3d', 3, 30, 110, 'rgba(255,200,120,0.55)'); towers('#120d24', 9, 12, 60, 'rgba(255,220,150,0.9)');
    // suspension bridge across the middle
    { const bx0 = X(0.33), bx1 = X(0.67), t0 = X(0.41), t1 = X(0.59), by = hz - 5, th = 44, mid = (t0 + t1) / 2, half = (t1 - t0) / 2;
      const cy = x => x < t0 ? by - th * ((x - bx0) / (t0 - bx0)) ** 2 : x > t1 ? by - th * ((bx1 - x) / (bx1 - t1)) ** 2 : (by - 8) - (th - 8) * ((x - mid) / half) ** 2;
      g.strokeStyle = '#0c0916'; g.lineWidth = 1; for (let x = bx0 + 6; x < bx1; x += 8) { g.beginPath(); g.moveTo(x + 0.5, by); g.lineTo(x + 0.5, cy(x)); g.stroke(); }
      g.lineWidth = 2; g.beginPath(); g.moveTo(bx0, by); for (let x = bx0; x <= bx1; x += 4) g.lineTo(x, cy(x)); g.stroke();
      g.fillStyle = '#0c0916'; g.fillRect(bx0, by, bx1 - bx0, 4); g.fillRect(t0 - 3, by - th, 6, th + 6); g.fillRect(t1 - 3, by - th, 6, th + 6);
      g.fillStyle = '#ffe6a0'; for (let x = bx0 + 4; x < bx1; x += 12) g.fillRect(x, by - 1, 2, 1); g.fillStyle = '#ff4a3a'; g.fillRect(t0 - 1, by - th - 3, 2, 2); g.fillRect(t1 - 1, by - th - 3, 2, 2); }
    // river with light reflections
    const bal = Y(0.55), pav = Y(0.60);
    const rv = g.createLinearGradient(0, hz, 0, bal); rv.addColorStop(0, '#2a1640'); rv.addColorStop(0.3, '#160f2c'); rv.addColorStop(1, '#0a0818'); g.fillStyle = rv; g.fillRect(0, hz, W, bal - hz);
    const sun = g.createLinearGradient(0, hz, 0, hz + 40); sun.addColorStop(0, 'rgba(240,130,60,0.5)'); sun.addColorStop(1, 'rgba(240,130,60,0)'); g.fillStyle = sun; g.fillRect(0, hz, W, 40);
    for (let i = 0; i < 160; i++) { const x = Math.floor(hash(i * 2.7) * W), len = 8 + Math.floor(hash(i * 3.1) * 40), col = hash(i * 5.3) > 0.6 ? '255,220,140' : '255,150,80'; for (let k = 0; k < len; k += 3) { g.fillStyle = `rgba(${col},${0.5 * (1 - k / len)})`; g.fillRect(x + Math.round(Math.sin(k * 0.9 + i) * 1.5), hz + 2 + k, 2, 2); } }
    // stone balustrade, then wet cracked pavement with painted lines
    g.fillStyle = '#4b4659'; g.fillRect(0, bal, W, pav - bal); g.fillStyle = '#6c667c'; g.fillRect(0, bal, W, 3); g.fillStyle = '#2d2937'; for (let x = 0; x < W; x += 7) g.fillRect(x, bal + 5, 3, pav - bal - 9); g.fillStyle = '#5a5568'; g.fillRect(0, pav - 4, W, 4);
    const pg = g.createLinearGradient(0, pav, 0, H); pg.addColorStop(0, '#2a2634'); pg.addColorStop(1, '#171520'); g.fillStyle = pg; g.fillRect(0, pav, W, H - pav);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 0; x < W; x += 26) g.fillRect(x, pav, 1, H - pav); for (let y = pav, s = 6; y < H; y += s, s = Math.round(s * 1.25)) g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(230,190,70,0.55)'; for (let x = 0; x < W; x += 36) g.fillRect(x, Y(0.78), 22, 2); g.fillRect(0, Y(0.9), W, 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; for (let i = 0; i < 30; i++) { let x = hash(i * 4.4) * W, y = pav + 10 + hash(i * 6.6) * (H - pav - 20); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (hash(i * 9 + k) - 0.5) * 24; y += hash(i * 7 + k) * 8; g.lineTo(x, y); } g.stroke(); }
    // K.O. MART corner store on the left
    { const x0 = X(0.03), x1 = X(0.18), top = Y(0.14), gl = Y(0.40);
      g.fillStyle = '#3b2a4a'; g.fillRect(x0, top, x1 - x0, bal - top); g.fillStyle = '#2a1d36'; g.fillRect(x0, top, x1 - x0, 4); g.fillStyle = '#4a3658'; for (let y = top + 8; y < gl - 10; y += 10) g.fillRect(x0, y, x1 - x0, 1);
      g.fillStyle = '#ffd88a'; g.fillRect(x0 + 8, gl, x1 - x0 - 16, bal - gl - 2); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = x0 + 8; x < x1 - 8; x += 18) g.fillRect(x, gl, 2, bal - gl - 2);
      g.fillStyle = '#c8281e'; g.fillRect(x0 + 4, gl - 8, x1 - x0 - 8, 8); g.fillStyle = '#f0e0d0'; for (let x = x0 + 4; x < x1 - 4; x += 12) g.fillRect(x, gl - 8, 6, 8);
      g.fillStyle = '#14101c'; g.fillRect(x0 + 6, Y(0.20), x1 - x0 - 12, 32); g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ff5fb0'; g.shadowColor = '#ff2a9a'; g.shadowBlur = 8; g.fillText('K.O. MART', X(WF.neon[0]), Y(WF.neon[1])); g.shadowBlur = 0;
      g.fillStyle = '#7bffb0'; g.font = 'bold 10px monospace'; g.fillText('OPEN', X(WF.open[0]), Y(WF.open[1]));
      g.fillStyle = 'rgba(255,200,120,0.18)'; g.fillRect(x0, bal, x1 - x0, 50); }
    // fire-escape building on the right
    { const x0 = X(0.82), x1 = X(0.95), top = Y(0.08);
      g.fillStyle = '#4a2c30'; g.fillRect(x0, top, x1 - x0, bal - top); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = top; y < bal; y += 4) g.fillRect(x0 + ((y / 4) % 2) * 4, y, x1 - x0, 1);
      for (const [u, v] of WF.windows) { const x = X(u), y = Y(v), lit = hash(u * 100 + v * 10) > 0.4; g.fillStyle = '#1a1420'; g.fillRect(x - 9, y - 11, 18, 22); g.fillStyle = lit ? '#ffcf7a' : '#2a2438'; g.fillRect(x - 7, y - 9, 14, 18); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x - 1, y - 9, 2, 18); }
      g.strokeStyle = '#111016'; g.lineWidth = 2; const fx = x1 - 42; for (let y = Y(0.13); y < bal - 10; y += 38) { g.strokeRect(fx, y + 24, 36, 4); g.beginPath(); g.moveTo(fx + 4, y + 24); g.lineTo(fx + 30, y - 12); g.stroke(); for (let k = 0; k < 36; k += 6) { g.beginPath(); g.moveTo(fx + k, y + 24); g.lineTo(fx + k, y + 14); g.stroke(); } } }
    // lamp posts on the balustrade line, with their light pooling on the wet ground
    for (const [u, v] of WF.lamps) { const x = X(u), y = Y(v); g.fillStyle = 'rgba(255,190,110,0.16)'; g.beginPath(); g.ellipse(x, pav + 30, 46, 40, 0, 0, TAU); g.fill(); g.fillStyle = '#1e1c26'; g.fillRect(x - 2, y, 4, pav - y); g.fillRect(x - 7, pav - 3, 14, 4); g.fillRect(x - 7, y - 4, 14, 5); g.fillStyle = '#ffe2a8'; g.fillRect(x - 5, y - 3, 10, 3); g.fillStyle = 'rgba(255,190,110,0.25)'; g.fillRect(x - 8, y + 1, 16, 30); }
  }

  // painted night rooftop yard at the picture's own size and layout (RF: horizon row, rail, lanterns,
  // the red circle as the ring edge), used while the file loads and when it is missing
  function procRooftop(g, W, H) {
    const hz = 200, railY = 230, floorY = RF.HZ, wallY = floorY - 95;
    const sky = g.createLinearGradient(0, 0, 0, hz + 60); sky.addColorStop(0, '#04060f'); sky.addColorStop(0.7, '#111630'); sky.addColorStop(1, '#2a2444'); g.fillStyle = sky; g.fillRect(0, 0, W, hz + 60);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + hash(i * 1.7) * 0.7})`; g.fillRect(hash(i * 7.3) * W, hash(i * 3.9) * 150, 2, 2); }
    const towers = (col, seed, hmin, hmax, y0) => { let x = -20; while (x < W) { const w = 50 + hash(seed + x) * 120, h = hmin + hash(seed * 3 + x) * (hmax - hmin); g.fillStyle = col; g.fillRect(x, y0 - h, w, h); g.fillStyle = 'rgba(255,214,140,0.8)'; for (let r = 8; r < h - 8; r += 16) for (let c = 8; c < w - 8; c += 14) if (hash(seed + x * 3 + r * 5 + c * 11) > 0.55) g.fillRect(x + c, y0 - h + r, 6, 8); x += w + 6 + hash(seed + x) * 30; } };
    towers('#0d1020', 4, 60, 220, hz + 20); towers('#151a30', 8, 30, 120, hz + 50);
    // water tower
    { const x = 690, y = hz + 30; g.fillStyle = '#0a0c16'; g.fillRect(x - 40, y - 150, 8, 150); g.fillRect(x + 32, y - 150, 8, 150); g.fillRect(x - 46, y - 150, 92, 6); g.fillRect(x - 50, y - 230, 100, 80); g.beginPath(); g.moveTo(x - 56, y - 230); g.lineTo(x, y - 275); g.lineTo(x + 56, y - 230); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; for (let k = -215; k < -150; k += 16) { g.beginPath(); g.moveTo(x - 50, y + k); g.lineTo(x + 50, y + k); g.stroke(); } g.fillStyle = '#ff3d2a'; g.fillRect(x - 2, y - 282, 4, 4); }
    // concrete floor with the red painted circle and a pool of light in the middle
    g.save(); g.translate(0, floorY); g.scale(1.6, 1.6); g.fillStyle = T(g, 'concreteDark'); g.fillRect(0, 0, W / 1.6, (H - floorY) / 1.6); g.restore();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, floorY, W, H - floorY);
    const sp = g.createRadialGradient(836, 654, 100, 836, 654, 900); sp.addColorStop(0, 'rgba(255,200,140,0.10)'); sp.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = sp; g.fillRect(0, floorY, W, H - floorY);
    g.strokeStyle = 'rgba(190,40,30,0.8)'; g.lineWidth = 18; g.beginPath(); g.ellipse(836, 654, 462, 102, 0, 0, TAU); g.stroke();
    // low concrete wall, chain-link fence with a red top rail, posts and paper lanterns
    texRect(g, 'concrete', 0, wallY, W, floorY - wallY, 1.2, 0.5);
    g.save(); g.globalAlpha = 0.75; g.fillStyle = T(g, 'chainlink'); g.fillRect(0, railY, W, wallY - railY); g.restore();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, railY, W, wallY - railY);
    const rg = g.createLinearGradient(0, railY - 7, 0, railY + 7); rg.addColorStop(0, '#e0453a'); rg.addColorStop(0.5, '#b8251b'); rg.addColorStop(1, '#6a1410'); g.fillStyle = rg; g.fillRect(0, railY - 7, W, 14);
    for (const x of RF.posts) { const pg = g.createLinearGradient(x - 9, 0, x + 9, 0); pg.addColorStop(0, '#1c1e26'); pg.addColorStop(0.4, '#4a4d58'); pg.addColorStop(1, '#15161c'); g.fillStyle = pg; g.fillRect(x - 9, railY - 34, 18, wallY - railY + 44); g.fillStyle = '#b8251b'; g.fillRect(x - 11, railY - 38, 22, 8); }
    for (const [x, ly] of RF.lanterns) {
      const px = x < W / 2 ? x - 30 : x + 30; g.strokeStyle = '#2a2a30'; g.lineWidth = 4; g.beginPath(); g.moveTo(px, ly - 40); g.lineTo(x, ly - 40); g.lineTo(x, ly - 30); g.stroke();
      const gl = g.createRadialGradient(x, ly, 6, x, ly, 110); gl.addColorStop(0, 'rgba(255,170,70,0.45)'); gl.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = gl; g.fillRect(x - 110, ly - 110, 220, 220);
      const lb = g.createLinearGradient(x - 24, 0, x + 24, 0); lb.addColorStop(0, '#b8481c'); lb.addColorStop(0.35, '#ff8a3a'); lb.addColorStop(0.6, '#ffb060'); lb.addColorStop(1, '#a83f18'); g.fillStyle = lb; g.beginPath(); g.ellipse(x, ly, 24, 30, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(60,20,5,0.35)'; g.lineWidth = 1.5; for (let k = -20; k <= 20; k += 10) { g.beginPath(); g.ellipse(x, ly + k, 24 * Math.sqrt(1 - (k / 30) ** 2), 3, 0, 0, TAU); g.stroke(); }
      g.fillStyle = '#3a1a0a'; g.fillRect(x - 10, ly - 33, 20, 5); g.fillRect(x - 10, ly + 28, 20, 5);
      // its light pooling on the floor below
      g.fillStyle = 'rgba(255,190,110,0.14)'; g.beginPath(); g.ellipse(x, floorY + 60, 70, 90, 0, 0, TAU); g.fill();
    }
    groundAO(g, 0, floorY + 6, W, 30);
    // red oil drums and crates in the corners
    const drum = (x, y, s) => { g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(4, 4, 36, 9, 0, 0, TAU); g.fill(); const d = g.createLinearGradient(-30, 0, 30, 0); d.addColorStop(0, '#5a120c'); d.addColorStop(0.4, '#c8281e'); d.addColorStop(0.7, '#a01d15'); d.addColorStop(1, '#4a0e0a'); g.fillStyle = d; g.fillRect(-30, -90, 60, 90); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-30, -62, 60, 4); g.fillRect(-30, -34, 60, 4); g.fillStyle = '#7a1a12'; g.beginPath(); g.ellipse(0, -90, 30, 8, 0, 0, TAU); g.fill(); g.restore(); };
    drum(90, floorY - 6, 1.3); drum(1585, floorY - 6, 1.3); boxes(g, 1500, floorY - 10, 1.6); boxes(g, 20, floorY - 10, 1.3);
  }

  const ARENAS = [
    {
      key: 'rooftop', name: 'ROOFTOP YARD', full: true, mat: 'matDark', crowdHue: 220, grade: 'rgba(40,50,110,0.10)', light: 'night', _pano: null, _floor: null,
      // the picture at RF's layout, or its painted stand-in while it loads / when it is missing
      source() {
        const img = asset('rooftop'); let src = img;
        if (!img) { src = mkCanvas(RF.W, RF.H); procRooftop(src.getContext('2d'), RF.W, RF.H); }
        else if (img.width !== RF.W || img.height !== RF.H) { src = mkCanvas(RF.W, RF.H); src.getContext('2d').drawImage(img, 0, 0, RF.W, RF.H); }
        return src;
      },
      // the wrapped strip and the floor plane, built once. While the file is still loading only the cheap
      // strip is built from the stand-in (ASSETS.onLoad clears both when the picture arrives or fails).
      pano() {
        if (this._pano) return this._pano;
        const loading = !!global.ASSETS && global.ASSETS.status('rooftop') === 'loading', src = this.source();
        this._pano = buildRoofStrip(src); this._pano.real = !!asset('rooftop');
        this._floor = loading ? null : buildRoofFloor(src);
        return this._pano;
      },
      draw(ctx, cam, P) {
        const t = cam.t, S = this.pano(), HZ = cam.HZ, W = cam.W, top = HZ - S.base;
        ctx.save(); ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = RF.sky; ctx.fillRect(-120, -400, W + 240, top + 402);
        // stars in the open sky above the picture's top edge (seen when the view drops: crouch, walk bob)
        for (let i = 0; i < 40; i++) { const x = sx(cam, hash(i * 3.3) * TAU, 0.1); if (x === null) continue; ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.6 * Math.abs(Math.sin(t / (500 + hash(i) * 900) + i))})`; ctx.fillRect(Math.round(x), Math.round(top - 8 - hash(i * 5.5) * 110), 2, 2); }
        // the ground plane, then the far strip whose lowest rows fade over it
        if (this._floor) drawRoofFloor(ctx, cam, P, this._floor); else { ctx.fillStyle = RF.flatCss; ctx.fillRect(-120, HZ, W + 240, cam.H + 200); }
        tilePano(ctx, cam, S.c, top, 0.5 / RF.COPIES);
        // screen point of picture pixel (xi, yi) in fence copy k (0 ahead, 1 right, 2 behind, 3 left), or null off screen
        const pt = (k, xi, yi, margin) => { const xm = k % 2 ? RF.W - xi : xi, x = sx(cam, (k + xm / RF.W - 0.5) * TAU / RF.COPIES, margin === undefined ? 0.25 : margin); if (x === null) return null; PT.x = x; PT.y = top + yi * S.sy; PT.u = k * S.cw + xm * S.s; return PT; };
        // heat shimmer above the lanterns: thin slices of the strip redrawn with a slow sideways wobble
        ctx.globalAlpha = 0.5;
        for (let k = 0; k < RF.COPIES; k++) for (let j = 0; j < RF.lanterns.length; j++) {
          const [xi, yi] = RF.lanterns[j], p = pt(k, xi, yi, 0.1); if (!p) continue;
          const w = 110 * S.s, y0 = (yi - 78) * S.sy, u = p.u - w / 2, sh = 11;
          for (let i = 0; i < 4; i++) ctx.drawImage(S.c, u, y0 + i * sh, w, sh, p.x - w / 2 + Math.sin(t / 130 + i * 1.9 + k + j * 2.3) * 1.4, top + y0 + i * sh, w, sh);
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
        // lantern glow pulse, lit windows flickering, stars twinkling, on every copy in view
        for (let k = 0; k < RF.COPIES; k++) {
          const dim = k === 0 ? 1 : k === 2 ? 0.8 : 0.9;
          for (let j = 0; j < RF.lanterns.length; j++) { const p = pt(k, RF.lanterns[j][0], RF.lanterns[j][1]); if (p) glow(ctx, p.x, p.y, 78, 'rgba(255,150,60,A)', dim * (0.24 + 0.07 * Math.sin(t / 620 + (k * 2 + j) * 1.7) + 0.02 * Math.sin(t / 97 + j))); }
          for (let j = 0; j < RF.windows.length; j++) { if (hash(Math.floor(t / 700) + (k * 8 + j) * 5) < 0.25) continue; const p = pt(k, RF.windows[j][0], RF.windows[j][1]); if (p) glow(ctx, p.x, p.y, 22, 'rgba(255,200,130,A)', dim * (0.13 + 0.05 * Math.sin(t / 140 + j + k))); }
          for (let j = 0; j < RF.stars.length; j++) { const p = pt(k, RF.stars[j][0], RF.stars[j][1]); if (!p) continue; const a = 0.25 + 0.65 * Math.abs(Math.sin(t / (500 + hash(j + k * 7) * 900) + j * 1.3)); ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2); glow(ctx, p.x, p.y, 7, 'rgba(200,220,255,A)', a * 0.5); }
        }
        // the headlights of a car passing below sweep along the fence every ~9 s
        const ph = (t % 9000) / 9000;
        if (ph < 0.25) { const k = ph / 0.25, a = Math.sin(k * Math.PI) * 0.16, x = sx(cam, 2.4 + (k - 0.5) * 2.2, 1.2); if (x !== null) { const g = ctx.createLinearGradient(x - 260, 0, x + 260, 0); g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(0.5, `rgba(255,240,200,${a})`); g.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g; const y0 = top + 222 * S.sy; ctx.fillRect(x - 260, y0, 520, HZ - y0); } }
        ctx.globalCompositeOperation = 'source-over';
        vignette(ctx, cam, 'rgba(5,8,20,A)', 0.5);
        ctx.restore();
      },
      near() {}, particles() {},
    },
    {
      key: 'waterfront', name: 'K.O. MART WATERFRONT', full: true, face: 0.5, hz: 0.38, mat: 'matDark', crowdHue: 300, grade: 'rgba(120,50,90,0.10)', light: 'night', _pano: null,
      // the loop canvas: the pixel-art panorama scaled so its width is one turn, or the painted fallback
      pano() {
        if (this._pano) return this._pano;
        const img = asset('waterfront'); let src = img;
        if (!src) { src = mkCanvas(1173, 390); procWaterfront(src.getContext('2d'), 1173, 390); }
        const H = Math.round(src.height * PANO_W / src.width), c = mkCanvas(PANO_W, H), g = c.getContext('2d');
        g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, PANO_W, H);
        return (this._pano = { c, H, real: !!img });
      },
      draw(ctx, cam) {
        const t = cam.t, { c, H } = this.pano(), top = cam.HZ - this.hz * H, vy = v => top + v * H, face = this.face;
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#0a0722'; ctx.fillRect(-120, -400, cam.W + 240, top + 402);
        tilePano(ctx, cam, c, top, face);
        // drifting clouds: a faint second copy of the sky, slowly sliding sideways
        ctx.save(); ctx.beginPath(); ctx.rect(-120, top - 1, cam.W + 240, H * 0.3); ctx.clip(); ctx.globalAlpha = 0.12; tilePano(ctx, cam, c, top, face, t / 90 + 140); ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        const flick = i => 0.85 + 0.1 * Math.sin(t / 160 + i * 2.1) + 0.05 * (hash(Math.floor(t / 70) + i) - 0.5);
        WF.lamps.forEach(([u, v], i) => glow(ctx, ux(cam, u, face), vy(v), 90, 'rgba(255,190,110,A)', 0.28 * flick(i)));
        WF.windows.forEach(([u, v], i) => { if (hash(Math.floor(t / 900) + i * 7) > 0.3) glow(ctx, ux(cam, u, face), vy(v), 26, 'rgba(255,200,130,A)', 0.16 * flick(i + 3)); });
        const neonOn = hash(Math.floor(t / 80) * 1.7) > 0.05;
        if (neonOn) { glow(ctx, ux(cam, WF.neon[0], face), vy(WF.neon[1]), 120, 'rgba(255,60,140,A)', 0.22 + 0.04 * Math.sin(t / 300)); glow(ctx, ux(cam, WF.open[0], face), vy(WF.open[1]), 40, 'rgba(120,255,160,A)', 0.2); }
        ctx.globalCompositeOperation = 'source-over';
        if (!neonOn) glow(ctx, ux(cam, WF.neon[0], face), vy(WF.neon[1]), 70, 'rgba(10,5,15,A)', 0.55);
        // shimmer on the water: translucent streaks of light sliding along the river
        ctx.save(); ctx.beginPath(); ctx.rect(-120, vy(0.39), cam.W + 240, H * 0.16); ctx.clip();
        for (let i = 0; i < 14; i++) {
          const u = hash(i * 3) + t / (40000 + hash(i) * 30000) * (i % 2 ? 1 : -1), x = ux(cam, u - Math.floor(u), face, 0.5); if (x === null) continue;
          const y = vy(0.40 + hash(i * 5) * 0.14), len = 60 + hash(i * 7) * 160, a = 0.05 + 0.1 * Math.abs(Math.sin(t / 700 + i));
          ctx.fillStyle = `rgba(255,190,120,${a})`; ctx.fillRect(x - len / 2, y, len, 2); ctx.fillStyle = `rgba(255,230,190,${a * 0.6})`; ctx.fillRect(x - len / 4, y + 4, len / 2, 1);
        }
        ctx.restore();
        vignette(ctx, cam, 'rgba(70,20,30,A)', 0.45);
        ctx.restore();
      },
      near() {}, particles() {},
    },
    {
      key: 'backstreet', name: 'BACKSTREET', mat: 'mat', crowdHue: 30, grade: 'rgba(120,80,30,0.10)', light: 'warm',
      sky(ctx, cam) {
        const g = ctx.createLinearGradient(0, -100, 0, cam.HZ); g.addColorStop(0, '#8fa6b8'); g.addColorStop(0.6, '#c6cfd4'); g.addColorStop(1, '#e3dccd'); ctx.fillStyle = g; ctx.fillRect(0, -200, cam.W, cam.HZ + 200);
        const sxx = sx(cam, -0.6, 0.6); if (sxx !== null) { const s = ctx.createRadialGradient(sxx, 20, 10, sxx, 20, 260); s.addColorStop(0, 'rgba(255,235,200,0.7)'); s.addColorStop(1, 'rgba(255,220,180,0)'); ctx.fillStyle = s; ctx.fillRect(0, -200, cam.W, cam.HZ + 200); }
        // hazy distant towers
        for (let i = 0; i < 9; i++) { const a = i * TAU / 9 + 0.2, x = sx(cam, a, 0.3); if (x === null) continue; const w = 70 + hash(i) * 90, h = 120 + hash(i * 3) * 160; ctx.fillStyle = 'rgba(150,165,178,0.55)'; ctx.fillRect(x - w / 2, cam.HZ - 60 - h, w, h + 60); ctx.fillStyle = 'rgba(120,135,150,0.35)'; for (let r = 0; r < h / 18; r++) for (let c = 0; c < w / 16; c++) if (hash(i * 17 + r * 5 + c) > 0.6) ctx.fillRect(x - w / 2 + 4 + c * 16, cam.HZ - 60 - h + 6 + r * 18, 6, 8); }
      },
      far(ctx, cam) {
        // the salmon apartment tower
        let x = sx(cam, 0.0, 0.5); if (x !== null) { const w = 250, h = 420, y = cam.HZ - 44; facade(ctx, x - w / 2, y - h, w, h, 'plasterSalmon', 0.7, { side: 44 }); windows(ctx, x - w / 2 + 10, y - h + 30, w - 20, h - 60, 4, 6, 3, cam.t, { balcony: true, ac: true }); ctx.fillStyle = '#3a3532'; ctx.fillRect(x - w / 2 - 6, y - h - 10, w + 56, 10); signboard(ctx, x + w / 2 - 6, y - h + 60, 34, 210, '拉麺居酒屋', cam.t, 7); }
        // concrete block with shutter
        x = sx(cam, 2.3, 0.5); if (x !== null) { const w = 320, h = 210, y = cam.HZ - 44; facade(ctx, x - w / 2, y - h, w, h, 'concrete', 0.8, { side: 40 }); windows(ctx, x - w / 2 + 20, y - h + 20, w - 40, 70, 4, 1, 9, cam.t); ctx.fillStyle = '#5a5d5a'; ctx.fillRect(x - 60, y - 120, 120, 120); ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let k = 0; k < 120; k += 8) ctx.fillRect(x - 60, y - 120 + k, 120, 3); ctx.fillStyle = 'rgba(200,60,40,0.6)'; ctx.font = 'bold 26px Impact, sans-serif'; ctx.fillText('K.O.', x - 36, y - 60); }
        // brick wall block
        x = sx(cam, -2.3, 0.5); if (x !== null) { const w = 300, h = 240, y = cam.HZ - 44; facade(ctx, x - w / 2, y - h, w, h, 'brickRed', 0.8, { side: 36 }); windows(ctx, x - w / 2 + 16, y - h + 26, w - 32, 120, 3, 2, 21, cam.t); for (let k = 0; k < 4; k++) { ctx.fillStyle = ['#e8e0c8', '#d8c8a8', '#c9d3dc', '#e8d0c0'][k]; ctx.fillRect(x - 120 + k * 60 + hash(k) * 10, y - 90 + hash(k * 3) * 20, 44, 58); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 110 + k * 60 + hash(k) * 10, y - 80 + hash(k * 3) * 20, 24, 3); ctx.fillRect(x - 110 + k * 60 + hash(k) * 10, y - 70 + hash(k * 3) * 20, 30, 2); } drainpipe(ctx, x + w / 2 - 20, y, h - 6); }
      },
      mid(ctx, cam) {
        const y = cam.HZ - 30;
        // asphalt strip between cage and buildings
        const a0 = sx(cam, cam.yaw - 1.2, 1), a1 = sx(cam, cam.yaw + 1.2, 1); if (a0 !== null && a1 !== null) { texRect(ctx, 'asphalt', a0 - 40, cam.HZ - 62, a1 - a0 + 80, 40, 0.9, 0.9); }
        // corrugated shacks
        let x = sx(cam, -0.95, 0.5); if (x !== null) { const w = 340, h = 150; facade(ctx, x - w / 2, y - h, w, h, 'steelOlive', 0.9, { side: 36 }); ctx.fillStyle = '#3f4238'; ctx.beginPath(); ctx.moveTo(x - w / 2 - 12, y - h + 2); ctx.lineTo(x + w / 2 + 48, y - h - 14); ctx.lineTo(x + w / 2 + 48, y - h - 2); ctx.lineTo(x - w / 2 - 12, y - h + 14); ctx.closePath(); ctx.fill(); windows(ctx, x - 40, y - h + 40, 90, 50, 1, 1, 5, cam.t); ctx.fillStyle = '#2a2a2e'; ctx.fillRect(x + 60, y - 90, 50, 90); ctx.fillStyle = '#5a4a3a'; ctx.fillRect(x + 64, y - 86, 42, 82); boxes(ctx, x - w / 2 + 10, y, 0.9); drainpipe(ctx, x - w / 2 + 4, y, h - 10); }
        x = sx(cam, 0.95, 0.5); if (x !== null) { const w = 380, h = 140; facade(ctx, x - w / 2, y - h, w, h, 'steelGrey', 0.9, { side: 30 }); awning(ctx, x - w / 2 + 10, y - h + 24, w - 20, cam.t, '#4f7a55', '#3f6446'); ctx.fillStyle = '#1e2024'; ctx.fillRect(x - 70, y - 100, 140, 100); ctx.fillStyle = 'rgba(230,220,200,0.9)'; ctx.fillRect(x - 64, y - 94, 128, 60); ctx.fillStyle = '#2a2a2e'; ctx.font = 'bold 20px "Yu Gothic", "Meiryo", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('中華そば', x, y - 58); vending(ctx, x + w / 2 - 40, y, 1, cam.t); }
        // utility poles + cables
        const p1 = sx(cam, 1.65, 0.8), p2 = sx(cam, -1.75, 0.8), p3 = sx(cam, 3.0, 0.8);
        [p1, p2, p3].forEach(px => { if (px !== null) pole(ctx, px, y + 4, 300); });
        cable(ctx, p2, y - 280, sx(cam, 0.0, 1.2), y - 250, 40, cam.t, 1); cable(ctx, sx(cam, 0.0, 1.2), y - 250, p1, y - 280, 40, cam.t, 2); cable(ctx, p1, y - 262, p3, y - 262, 60, cam.t, 3); cable(ctx, p3, y - 282, p2, y - 282, 60, cam.t, 4);
        x = sx(cam, 1.4); if (x !== null) manholeSteam(ctx, x, y + 2, cam.t, 4);
      },
      near() {},
      particles(ctx, cam, dt, st) {
        if (!st.p) st.p = makeParticles(40, i => ({ x: Math.random() * cam.W, y: Math.random() * cam.H, v: 0.006 + Math.random() * 0.01, ph: Math.random() * TAU, r: 1 + Math.random() * 1.5 }));
        const d = drift(cam, st); ctx.save();
        for (const p of st.p) { p.y -= p.v * dt; p.ph += dt / 700; p.x += d + Math.sin(p.ph) * 0.25; if (p.y < -10) { p.y = cam.H + 10; p.x = Math.random() * cam.W; } if (p.x < 0) p.x += cam.W; if (p.x > cam.W) p.x -= cam.W; ctx.fillStyle = `rgba(255,236,200,${0.25 + 0.25 * Math.abs(Math.sin(p.ph * 1.3))})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
        ctx.restore();
      },
    },
    {
      key: 'shrine', name: 'SAKURA SHRINE', mat: 'matDark', crowdHue: 200, grade: 'rgba(160,190,210,0.10)', light: 'cool',
      sky(ctx, cam) {
        const g = ctx.createLinearGradient(0, -100, 0, cam.HZ); g.addColorStop(0, '#8ea3b5'); g.addColorStop(1, '#e7ecee'); ctx.fillStyle = g; ctx.fillRect(0, -200, cam.W, cam.HZ + 200);
        mountains(ctx, cam, 'rgba(100,120,140,0.5)', 70, 3, cam.HZ - 90);
        mountains(ctx, cam, 'rgba(70,90,110,0.65)', 45, 7, cam.HZ - 62);
        const fog = ctx.createLinearGradient(0, cam.HZ - 120, 0, cam.HZ - 44); fog.addColorStop(0, 'rgba(230,238,242,0)'); fog.addColorStop(1, 'rgba(230,238,242,0.9)'); ctx.fillStyle = fog; ctx.fillRect(0, cam.HZ - 120, cam.W, 76);
      },
      far(ctx, cam) {
        [[0.0, 1.0], [1.9, 0.7], [-2.6, 0.8], [3.0, 0.6]].forEach(([a, s]) => { const x = sx(cam, a, 0.3); if (x !== null) torii(ctx, x, cam.HZ - 44, s, cam.t); });
      },
      mid(ctx, cam) {
        const a0 = sx(cam, cam.yaw - 1.2, 1), a1 = sx(cam, cam.yaw + 1.2, 1);
        if (a0 !== null && a1 !== null) { texRect(ctx, 'gravel', a0 - 40, cam.HZ - 62, a1 - a0 + 80, 40, 0.9, 0.95); }
        // low mossy stone wall in segments around the ring
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8, x0 = sx(cam, a - 0.3, 0.6), x1 = sx(cam, a + 0.3, 0.6); if (x0 !== null && x1 !== null && x1 > x0) stoneWall(ctx, x0, x1, cam.HZ - 26, 34, i * 5); }
        [[-0.75, 1.0, 1], [0.95, 0.9, 2], [2.5, 1.05, 3], [-2.1, 0.85, 4], [-1.5, 0.7, 5]].forEach(([a, s, seed]) => { const x = sx(cam, a, 0.5); if (x !== null) tree(ctx, x, cam.HZ - 30, s, cam.t, seed, true); });
        [1.45, -1.2, 3.05].forEach(a => { const x = sx(cam, a); if (x !== null) stoneLantern(ctx, x, cam.HZ - 24, 0.9); });
      },
      near() {},
      particles(ctx, cam, dt, st) {
        if (!st.p) st.p = makeParticles(70, () => ({ x: Math.random() * cam.W, y: Math.random() * cam.H, v: 0.04 + Math.random() * 0.05, ph: Math.random() * TAU, r: 3 + Math.random() * 4, rot: Math.random() * TAU }));
        const d = drift(cam, st); ctx.save();
        for (const p of st.p) {
          p.y += p.v * dt; p.ph += dt / 600; p.x += d + Math.sin(p.ph) * 0.4 + 0.02 * dt; p.rot += dt / 900;
          if (p.y > cam.H + 10) { p.y = -10; p.x = Math.random() * cam.W; } if (p.x < -10) p.x += cam.W + 20; if (p.x > cam.W + 10) p.x -= cam.W + 20;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = 'rgba(245,200,215,0.9)'; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(200,120,150,0.5)'; ctx.beginPath(); ctx.ellipse(p.r * 0.3, 0, p.r * 0.4, p.r * 0.3, 0, 0, TAU); ctx.fill(); ctx.restore();
        }
        ctx.restore();
      },
    },
    {
      key: 'temple', name: 'DRAGON TEMPLE', mat: 'matDark', crowdHue: 20, grade: 'rgba(120,60,10,0.14)', light: 'night',
      sky(ctx, cam) {
        const g = ctx.createLinearGradient(0, -100, 0, cam.HZ); g.addColorStop(0, '#040614'); g.addColorStop(1, '#2a1a2e'); ctx.fillStyle = g; ctx.fillRect(0, -200, cam.W, cam.HZ + 200);
        ctx.fillStyle = '#fff'; for (let i = 0; i < 120; i++) { const a = i * 0.0524, x = sx(cam, a); if (x !== null) { ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(cam.t / 900 + i)); ctx.fillRect(x, 20 + hash(i) * 150, 2, 2); } } ctx.globalAlpha = 1;
        mountains(ctx, cam, '#0a0716', 30, 5, cam.HZ - 80);
        [0.9, -1.6, 2.6].forEach((a, i) => { const x = sx(cam, a, 0.4); if (x !== null) pagoda(ctx, x, cam.HZ - 80, 0.8 + i * 0.15); });
      },
      far(ctx, cam) {
        const x = sx(cam, 0.55, 0.5); if (x !== null) dragon(ctx, x, cam.HZ - 40, 0.9, cam.t);
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.5, xx = sx(cam, a, 0.5); if (xx === null) continue; const w = 260, h = 170; facade(ctx, xx - w / 2, cam.HZ - 44 - h, w, h, 'woodDark', 0.7, { side: 30, k: 0.7 }); windows(ctx, xx - w / 2 + 20, cam.HZ - 44 - h + 24, w - 40, 60, 3, 1, i * 7, cam.t, { night: true }); ctx.fillStyle = '#1a0c08'; ctx.beginPath(); ctx.moveTo(xx - w / 2 - 20, cam.HZ - 44 - h); ctx.quadraticCurveTo(xx, cam.HZ - 44 - h - 40, xx + w / 2 + 50, cam.HZ - 44 - h); ctx.lineTo(xx + w / 2 + 50, cam.HZ - 44 - h + 12); ctx.quadraticCurveTo(xx, cam.HZ - 44 - h - 28, xx - w / 2 - 20, cam.HZ - 44 - h + 12); ctx.closePath(); ctx.fill(); }
      },
      mid(ctx, cam) {
        const a0 = sx(cam, cam.yaw - 1.2, 1), a1 = sx(cam, cam.yaw + 1.2, 1);
        if (a0 !== null && a1 !== null) { texRect(ctx, 'tileGrey', a0 - 40, cam.HZ - 62, a1 - a0 + 80, 40, 0.8, 0.55); const off = ((cam.yaw * PPR) % 46 + 46) % 46; lacquerRail(ctx, a0 - off, a1 + 46, cam.HZ - 28, 70); }
        for (let i = 0; i < 18; i++) { const a = i * TAU / 18, x = sx(cam, a, 0.2); if (x !== null) lantern(ctx, x, cam.HZ - 160 + (i % 2) * 40, 0.7 + (i % 3) * 0.12, cam.t, i); }
      },
      near() {},
      particles(ctx, cam, dt, st) {
        if (!st.p) st.p = makeParticles(50, () => ({ x: Math.random() * cam.W, y: Math.random() * cam.H, v: 0.02 + Math.random() * 0.03, ph: Math.random() * TAU, r: 1.5 + Math.random() * 2 }));
        const d = drift(cam, st); ctx.save();
        for (const p of st.p) {
          p.y -= p.v * dt; p.ph += dt / 500; p.x += d + Math.sin(p.ph) * 0.3;
          if (p.y < -10) { p.y = cam.H + 10; p.x = Math.random() * cam.W; } if (p.x < 0) p.x += cam.W; if (p.x > cam.W) p.x -= cam.W;
          ctx.fillStyle = `rgba(255,${160 + Math.floor(60 * Math.abs(Math.sin(p.ph)))},80,${0.5 + 0.4 * Math.abs(Math.sin(p.ph * 1.7))})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        }
        ctx.restore();
      },
    },
  ];

  // when an image arrives after startup (or turns out to be missing), rebuild that stage from it
  if (global.ASSETS) global.ASSETS.onLoad(name => { for (const a of ARENAS) if (a.key === name) { a._pano = null; a._floor = null; } });

  global.ARENAS = ARENAS;
  global.ARENA_PPR = PPR;
  global.arenaSx = sx;
  global.arenaTexRect = texRect;
})(typeof window !== 'undefined' ? window : globalThis);
