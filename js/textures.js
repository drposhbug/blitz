// textures.js — procedural, tileable materials generated pixel by pixel at startup.
// No image files: plaster, corrugated steel, concrete, brick, asphalt, canvas mat, chain-link,
// wood, roof tile, skin, fur, brushed metal. TEX.pattern(ctx, name) returns a CanvasPattern.
(function (global) {
  const SIZE = 256;
  const cache = {}, patterns = {};

  // deterministic RNG
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // tileable value noise, octaves summed, values 0..1
  function noise(seed, octaves, baseCells) {
    const out = new Float32Array(SIZE * SIZE);
    let amp = 1, total = 0, cells = baseCells || 4;
    for (let o = 0; o < octaves; o++) {
      const r = rng(seed * 31 + o * 7 + 1);
      const grid = new Float32Array(cells * cells);
      for (let i = 0; i < grid.length; i++) grid[i] = r();
      const step = SIZE / cells;
      for (let y = 0; y < SIZE; y++) {
        const gy = y / step, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < SIZE; x++) {
          const gx = x / step, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const a = grid[(y0 % cells) * cells + (x0 % cells)], b = grid[(y0 % cells) * cells + ((x0 + 1) % cells)];
          const c = grid[((y0 + 1) % cells) * cells + (x0 % cells)], d = grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
          out[y * SIZE + x] += ((a + (b - a) * sx) + ((c + (a - a) * 0) + (d - c) * sx - (a + (b - a) * sx)) * sy) * amp;
        }
      }
      total += amp; amp *= 0.5; cells *= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  function canvas() { const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE; return c; }
  // paint pixels from a function (x, y, n) -> [r,g,b,a]
  function paint(fn) {
    const c = canvas(), ctx = c.getContext('2d'), img = ctx.createImageData(SIZE, SIZE), d = img.data;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4, p = fn(x, y, y * SIZE + x);
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = p[3] === undefined ? 255 : p[3];
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const shade = (rgb, k) => [clamp(rgb[0] * k, 0, 255), clamp(rgb[1] * k, 0, 255), clamp(rgb[2] * k, 0, 255)];

  const BUILD = {
    plaster(base, seed) {
      const b = hex(base), n1 = noise(seed, 4, 4), n2 = noise(seed + 9, 2, 32);
      return paint((x, y, i) => shade(b, 0.82 + n1[i] * 0.28 + (n2[i] - 0.5) * 0.12));
    },
    concrete(base, seed) {
      const b = hex(base), n1 = noise(seed, 5, 4), n2 = noise(seed + 3, 1, 64), r = rng(seed + 77);
      const stains = noise(seed + 5, 2, 2);
      return paint((x, y, i) => { let k = 0.8 + n1[i] * 0.3 + (n2[i] - 0.5) * 0.18 - Math.max(0, stains[i] - 0.6) * 0.5; if (r() < 0.02) k -= 0.25; return shade(b, k); });
    },
    asphalt(base, seed) {
      const b = hex(base), n1 = noise(seed, 3, 8), n2 = noise(seed + 1, 1, 128), r = rng(seed + 5);
      return paint((x, y, i) => { let k = 0.85 + (n1[i] - 0.5) * 0.3 + (n2[i] - 0.5) * 0.35; if (r() < 0.03) k += 0.35; return shade(b, k); });
    },
    corrugated(base, seed) {
      const b = hex(base), rust = hex('#8b4a2b'), n1 = noise(seed, 3, 4), n2 = noise(seed + 2, 2, 16), grime = noise(seed + 4, 2, 2);
      const period = 16;
      return paint((x, y, i) => {
        const ph = (x % period) / period;
        const rib = 0.75 + 0.35 * Math.max(0, Math.cos(ph * Math.PI * 2)) - 0.12 * Math.max(0, -Math.cos(ph * Math.PI * 2 + 0.6));
        const rk = Math.max(0, n1[i] - 0.62) * 2.2;
        const col = [b[0] * (1 - rk) + rust[0] * rk, b[1] * (1 - rk) + rust[1] * rk, b[2] * (1 - rk) + rust[2] * rk];
        return shade(col, rib * (0.9 + (n2[i] - 0.5) * 0.2) * (1 - Math.max(0, grime[i] - 0.5) * 0.5) * (1 - (y / SIZE) * 0.18));
      });
    },
    brick(base, mortar, seed) {
      const b = hex(base), m = hex(mortar), n = noise(seed, 3, 32), r = rng(seed + 11);
      const bw = 32, bh = 14; const tint = {};
      return paint((x, y, i) => {
        const row = Math.floor(y / bh), off = (row % 2) * (bw / 2), col = Math.floor((x + off) / bw);
        const inMortar = (y % bh) < 2 || ((x + off) % bw) < 2;
        if (inMortar) return shade(m, 0.85 + n[i] * 0.3);
        const key = row * 97 + col; if (tint[key] === undefined) tint[key] = 0.78 + r() * 0.4;
        return shade(b, tint[key] * (0.9 + (n[i] - 0.5) * 0.3));
      });
    },
    mat(base, seed) {
      const b = hex(base), n1 = noise(seed, 2, 64), n2 = noise(seed + 1, 3, 4), r = rng(seed + 9);
      return paint((x, y, i) => { let k = 0.9 + (n1[i] - 0.5) * 0.12 + (n2[i] - 0.5) * 0.14; if (((x + y) % 3 === 0) && r() < 0.15) k -= 0.05; return shade(b, k); });
    },
    wood(base, seed) {
      const b = hex(base), n1 = noise(seed, 3, 2), n2 = noise(seed + 4, 2, 64);
      return paint((x, y, i) => { const grain = Math.sin((y / SIZE * 6 + n1[i] * 3) * Math.PI * 2) * 0.5 + 0.5; return shade(b, 0.72 + grain * 0.32 + (n2[i] - 0.5) * 0.1); });
    },
    skin(base, seed) {
      const b = hex(base), n1 = noise(seed, 3, 8), n2 = noise(seed + 2, 1, 128);
      return paint((x, y, i) => shade(b, 0.93 + (n1[i] - 0.5) * 0.14 + (n2[i] - 0.5) * 0.08));
    },
    fur(base, seed) {
      const b = hex(base), n1 = noise(seed, 3, 8), n2 = noise(seed + 2, 2, 64);
      return paint((x, y, i) => { const strand = Math.sin((x * 0.9 + n1[i] * 20) * 1.3) * 0.5 + 0.5; return shade(b, 0.86 + strand * 0.18 + (n2[i] - 0.5) * 0.12); });
    },
    metal(base, seed) {
      const b = hex(base), n1 = noise(seed, 1, 128), n2 = noise(seed + 3, 3, 4);
      return paint((x, y, i) => shade(b, 0.85 + (n1[(y * SIZE + ((x * 7) % SIZE))] - 0.5) * 0.25 + (n2[i] - 0.5) * 0.2));
    },
    chainlink(seed) {
      const c = canvas(), ctx = c.getContext('2d'); ctx.clearRect(0, 0, SIZE, SIZE);
      const cell = 32;
      ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      for (const [col, off] of [['rgba(0,0,0,0.55)', 1], ['rgba(190,190,196,0.85)', 0]]) {
        ctx.strokeStyle = col; ctx.beginPath();
        for (let k = -SIZE; k < SIZE * 2; k += cell) { ctx.moveTo(k + off, 0); ctx.lineTo(k + SIZE + off, SIZE); ctx.moveTo(k + SIZE + off, 0); ctx.lineTo(k + off, SIZE); }
        ctx.stroke();
      }
      return c;
    },
    tile(base, seed) {
      const b = hex(base), n = noise(seed, 2, 16);
      const c = canvas(), ctx = c.getContext('2d');
      ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
      const img = ctx.getImageData(0, 0, SIZE, SIZE), d = img.data;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const i = (y * SIZE + x) * 4, k = 0.85 + (n[y * SIZE + x] - 0.5) * 0.3; d[i] = b[0] * k; d[i + 1] = b[1] * k; d[i + 2] = b[2] * k; }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2;
      for (let row = 0; row < SIZE / 16; row++) for (let col = -1; col < SIZE / 32 + 1; col++) { const x = col * 32 + (row % 2) * 16, y = row * 16; ctx.beginPath(); ctx.arc(x + 16, y + 16, 16, Math.PI, 0); ctx.stroke(); }
      return c;
    },
  };

  const TEX = {
    // name -> canvas (built once)
    get(name) {
      if (cache[name]) return cache[name];
      const spec = TEX.specs[name]; if (!spec) throw new Error('unknown texture ' + name);
      return (cache[name] = BUILD[spec[0]].apply(null, spec.slice(1)));
    },
    pattern(ctx, name) {
      const key = name; if (patterns[key]) return patterns[key];
      return (patterns[key] = ctx.createPattern(TEX.get(name), 'repeat'));
    },
    specs: {
      plasterSalmon: ['plaster', '#d39c8c', 11], plasterCream: ['plaster', '#e2d8c4', 12], plasterGrey: ['plaster', '#b9b4aa', 13], plasterWhite: ['plaster', '#efe9dc', 14],
      concrete: ['concrete', '#9a9590', 21], concreteDark: ['concrete', '#6d6a66', 22], stone: ['concrete', '#7e8580', 23], stoneDark: ['concrete', '#4d554f', 24],
      asphalt: ['asphalt', '#3a3a3c', 31], gravel: ['asphalt', '#5a5750', 32],
      steelOlive: ['corrugated', '#6b7a5a', 41], steelGrey: ['corrugated', '#7d8280', 42], steelRust: ['corrugated', '#8a6a4a', 43],
      brickRed: ['brick', '#8d4b3b', '#b7ab9c', 51], brickDark: ['brick', '#5a3a30', '#6f665c', 52],
      mat: ['mat', '#d9d2c2', 61], matDark: ['mat', '#b8b1a2', 62],
      wood: ['wood', '#8a5a34', 71], woodDark: ['wood', '#4a2e1a', 72], woodRed: ['wood', '#a8321f', 73],
      skin: ['skin', '#e8b284', 81], skinDark: ['skin', '#b8784a', 82],
      fur: ['fur', '#d9a55a', 91], furCream: ['fur', '#f2e2c4', 92],
      metal: ['metal', '#2a2b30', 101], metalLight: ['metal', '#6d7076', 102],
      chainlink: ['chainlink', 111],
      tileGrey: ['tile', '#5b6068', 121], tileRed: ['tile', '#7a3a2a', 122],
    },
    // grain overlay for post-processing
    grain() {
      if (cache.__grain) return cache.__grain;
      const r = rng(999);
      return (cache.__grain = paint(() => { const v = 128 + (r() - 0.5) * 90; return [v, v, v, 255]; }));
    },
  };
  global.TEX = TEX;
})(typeof window !== 'undefined' ? window : globalThis);
