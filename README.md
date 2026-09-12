# BLITZ — a first-person webcam street-boxing fight vs. SOL VEGA

**To play:** double-click `Play BLITZ.cmd`. It serves the game at http://localhost:8321 and opens it.
Opening `index.html` directly also works, but browsers block some image effects on local files.
One example is the rooftop floor built from your backdrop, which falls back to plain concrete there.

First-person boxing where **your body is the controller**: your real arms drive the fists in the
foreground, your footwork moves the camera around the ring, and the opponent is SOL VEGA, the
reigning champion. Five 360° stages: two built from image assets (with painted fallbacks), three
drawn from procedural textures. Nothing to install: open `index.html` in Chrome or Edge, pick FIGHT.
All processing happens in your browser; the video never leaves it.

## How to play

You see the ring through your own eyes. Sol circles you and your view follows her, so the whole
stage scrolls past as she moves; the radar in the corner shows where she is. Punches only land when
the ring under her feet turns gold. She telegraphs every punch with a glowing glove and a hint at
the top: step back out of reach, sidestep off her line (your eyes stay put while she is committed
to a punch), or duck under the high ones and the announcer yells **DODGE!** and Sol is left
dizzy — that's your window to walk in and swing. Stand there and it's **NO DODGE!**

| Move          | Webcam                                                   | Keyboard     |
| ------------- | -------------------------------------------------------- | ------------ |
| Sidestep      | lean / step left or right (back to centre stops)         | A / D        |
| Forward / back| lean / step toward or away from the camera               | W / S        |
| Turn          | automatic: your eyes follow Sol                          | automatic    |
| Punch L / R   | snap either fist forward (in reach)                      | J / K        |
| Duck          | crouch                                                   | Space        |
| Block         | both fists up covering your face                         | F / Shift    |
| HAYMAKER      | full special meter + both hands over your head           | E            |
| Pause         | PAUSE button                                             | Esc          |
| Recalibrate   | RECAL button                                             | C            |
| Mute          | SOUND button                                             | M            |

Jabs and hooks can be ducked; the overhead can't be ducked or blocked; body blows and
uppercuts must be blocked or walked away from. Dodges fill the special meter; four dodges and
both hands up unleash the HAYMAKER. Punch into a wind-up early and you may counter. Every knockout
raises your rank: faster punches, faster footwork, more of them, better guard.

**Menu**: FIGHT (webcam), KEYBOARD FIGHT, STAGE SELECT (live previews, or cycle every rank),
CONTROLS, OPTIONS (volume, announcer voice, movement dead zone, punch sensitivity, reset rank).
Navigate with W/S or the mouse, Enter to confirm, Esc to go back.

**Stages** (in cycle order): K.O. MART WATERFRONT (pixel-art night plaza on the river: the corner
store's neon, a suspension bridge, lamp posts, shimmering water, wet pavement), ROOFTOP YARD (a
concrete rooftop with a red painted circle, chain-link and paper lanterns, oil drums, the skyline
and a water tower), BACKSTREET (a salmon apartment tower, corrugated shacks, awnings, cables,
steam, vending machine, dust in the low sun), SAKURA SHRINE (weathered torii, swaying cherry
trees, falling petals, mossy stone walls, mist), DRAGON TEMPLE (lacquered rails, swinging paper
lanterns, a bronze dragon, embers under a starry sky).

Stand about 1.5 m from the camera with your head and shoulders in frame. The first 2.5 s
calibrate your neutral stance; that spot is "standing still", and leaning or stepping away from
it walks you in that direction.

## Image assets (optional)

Drop these into `assets/` and reload; the menu status line lists whichever are still missing and
the game uses drawn fallbacks until they arrive (see `assets/PUT-IMAGES-HERE.txt`):

- `stage-waterfront.png` (2172x724) — the pixel-art waterfront. Treated as a full 360° cylinder:
  the image width is one turn of yaw, tiled and wrapped, horizon aligned to the renderer's, drawn
  with smoothing off so the pixels stay crisp.
- `stage-rooftop.png` (1676x943) — the rooftop yard, a single view. The 360° loop is the image
  and its mirror side by side so the seams match.
- `boxer.png`, `arm-left.png`, `arm-right.png` — the opponent and your arms.

Both image stages are `full` stages: they paint everything from sky to floor themselves, so the
renderer skips its crowd, cage and mat for them, and animates lights, neon, water and sky on top.

## Layout

- `js/textures.js` — procedural, tileable materials generated pixel by pixel at startup (plaster, corrugated steel, concrete, brick, asphalt, canvas mat, chain-link, wood, roof tile, skin, fur, metal) plus film grain
- `js/assets.js` — optional image files; `ASSETS.get(name)` is the image or null, `ASSETS.onLoad(fn)` fires when one arrives, `ASSETS.missing()` lists the absent ones
- `js/gesture.js` — pose landmarks → punch events plus a movement joystick (x/z), duck, block, hands-up (pure)
- `js/game.js` — circular ring, your facing that tracks Sol, reach rules, her footwork and attacks, damage, events (pure)
- `js/arenas.js` — the five 360° stages: the two panorama stages (loop canvas built from the image or painted procedurally, tiled by yaw) and the three textured ones (facades with side faces, windows, awnings, signs, props, particles)
- `js/render.js` — first-person canvas: stage panorama, crowd, chain-link octagon, foreshortened mat (procedural stages), the opponent scaled by distance, your arms and fists, lighting, grain, HUD, radar
- `js/audio.js` — all sound effects synthesized in Web Audio, plus the speech-synth announcer
- `js/pose.js` — webcam + MediaPipe PoseLandmarker (loaded from CDN at runtime), keeps world landmarks for arm depth
- `js/main.js` — menus, options, pause, fight intro, stage previews, missing-asset note, keyboard fallback, `window.__fight` debug hook

The menu, stage select and HUD were designed first on a Claude Design canvas (title screen,
stage select, fight HUD, Backstreet concept) and then built into the game.

## Your images (assets/)

Drop the five PNGs into `assets/` with these exact names and reload; the menu's status line
lists any that are still missing, and every one has a drawn fallback until then:

| file | what |
| --- | --- |
| `boxer.png` (1024x1536, transparent) | Sol, the opponent. Cut into a 2D skeleton (`js/opponent.js`): head, ponytail, torso, hips, arms, gloves, legs, shoes. Breathing, weight shifts, wind-ups, strikes at your face, hit reactions, stun, KO, muscle flex highlights. Tune the part table in `test/rig.html`. |
| `arm-left.png`, `arm-right.png` (1024x1536, transparent) | Your gloves. Spring-damped position/rotation/scale, motion-blur ghosts on fast punches, impact squash, breathing sway, block twist, hit tint (`js/arms.js`, `test/arms.html`). |
| `stage-waterfront.png` (2172x724) | Pixel-art night waterfront, wrapped into a full 360° panorama with flickering lights, blinking K.O. MART neon, water shimmer and drifting clouds. |
| `stage-rooftop.png` (1676x943) | Rooftop fight yard, mirrored into a 360° loop with lantern pulse, star twinkle, window flicker and a headlight sweep. |

## Calorie tracker

`js/fitness.js` estimates energy from what your body actually does in front of the camera:
a MET model (guard stance, footwork intensity, ducking, blocking) plus per-punch and per-dodge
bursts, scaled by your body weight (OPTIONS → BODY WEIGHT). A live BURN widget sits on the HUD
during the fight, the result screen shows the session's kcal, active minutes and punches, and
TRAINING LOG in the menu keeps today's totals, a 7-day chart and your last sessions (stored in
the browser).

## Tests (no Node needed)

Both are browser pages that set their `<title>` to PASS or FAIL:

```
chrome --headless=new --disable-gpu --dump-dom "file:///C:/Users/thorn/doge-fight/test/tests.html" | grep -o "<title>[^<]*"
chrome --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=15000 --dump-dom "file:///C:/Users/thorn/doge-fight/test/smoke.html" | grep -o "<title>[^<]*"
```

`test/tests.html` unit-tests the gesture detector with synthetic skeletons and the fight rules.
`test/smoke.html` drives the real page frame-by-frame through a whole fight in keyboard mode
and renders every arena once.
`test/shot.html?at=idle|walk|turn|windup|punch|dodge|hit|duck|ko&arena=waterfront|rooftop|backstreet|shrine|temple`
freezes the live loop and steps to a moment for `--screenshot` checks of the rendering.
