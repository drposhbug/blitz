// assets.js — optional image assets. Everything in the game must keep working when a file is
// missing (procedural fallback); when present, the image is used. Drop files into /assets:
//   boxer.png            1024x1536  the opponent, full body, transparent background
//   arm-left.png         1024x1536  your left arm + glove (arm enters from bottom-right)
//   arm-right.png        1024x1536  your right arm + glove (arm enters from bottom-left)
//   stage-waterfront.png 2172x724   pixel-art night waterfront panorama (K.O. MART)
//   stage-rooftop.png    1676x943   rooftop fight yard with chain-link fence and lanterns
(function (global) {
  const FILES = { boxer: 'assets/boxer.png', armL: 'assets/arm-left.png', armR: 'assets/arm-right.png', waterfront: 'assets/stage-waterfront.png', rooftop: 'assets/stage-rooftop.png' };
  const imgs = {}, status = {};
  const listeners = [];
  function load(name, src) {
    const im = new Image();
    status[name] = 'loading';
    im.onload = () => { imgs[name] = im; status[name] = 'ok'; listeners.forEach(fn => fn(name, im)); };
    im.onerror = () => { status[name] = 'missing'; listeners.forEach(fn => fn(name, null)); };
    im.src = src;
  }
  const ASSETS = {
    get(name) { return imgs[name] || null; },          // HTMLImageElement or null while loading / when missing
    has(name) { return !!imgs[name]; },
    status(name) { return status[name] || 'unknown'; },
    onLoad(fn) { listeners.push(fn); },
    files: FILES,
    // which of the named assets are present; used by the menu to tell the player what to drop in
    missing() { return Object.keys(FILES).filter(k => status[k] === 'missing'); },
  };
  if (typeof Image !== 'undefined') for (const k in FILES) load(k, FILES[k]);
  global.ASSETS = ASSETS;
})(typeof window !== 'undefined' ? window : globalThis);
