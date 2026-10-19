# COBRA (2026 remake) – engine conventions

Modern, AAA-styled remake of Ocean's 1986 *Cobra* (C64/Spectrum/CPC), a side-scrolling
multi-tier platform shooter based on the 1986 Stallone film. Runs in the browser:
Three.js r170 (ES modules from jsDelivr via importmap), no build step, no image/audio
assets – everything is procedural (canvas textures, Web Audio synthesis).

## Imports

```js
import * as THREE from 'three';                       // importmap -> three@0.170.0
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, solid, glow, grating, hazard, facadeMat, neonMat, box, worldUV } from '../core/materials.js';
import * as TX from '../core/textures.js';
```

Use relative imports between project modules. Never fetch external files at runtime
(the published artifact's CSP blocks everything except scripts from jsDelivr).

## World units & axes

- 1 unit = 1 meter. Player (Marion Cobretti) is 1.85 m tall.
- x = level progression (left -> right), y = up, z = toward the camera.
- Gameplay plane is z = 0. Building facades sit at about z = -1.2. The camera looks
  from +z (about 24 m away, slightly above, looking slightly down), so the FRONT (+z)
  faces and TOPS of props are what the player sees. Back faces can be cheap.
- Walkable tiers are typically at y = 0 (street), 3.2, 6.4, 9.6.

## Prop module API (src/props/*.js)

Each prop is an exported function `makeSomething(opts = {}) -> THREE.Group`:

- Origin: ground level (y = 0) at the horizontal center of the footprint; front faces +z.
  Vehicles are oriented with their length along x, nose toward +x.
- Every mesh: `castShadow` for meaningful silhouettes, `receiveShadow = true`.
- Use the shared material library (`mat('brickRed')`, `solid('#123', rough, metal)`,
  `glow('#ff2a6d', 4)`) so materials are shared and cached. Use `box(w,h,d, metersPerTile)`
  or `worldUV(geo, mpt)` to get world-scaled UVs for textured materials.
- Merge static sub-meshes sharing a material (`mergeGeometries`) when a prop has many
  parts, to keep draw calls low (a prop should be ~5–40 draw calls).
- Emissive parts (bulbs, neon, headlights, molten metal) use emissive intensity > 1 so the
  bloom pass picks them up.
- Optional `group.userData` fields the level builder reads:
  - `colliders: [{ type: 'ledge', x0, x1, y }]` – one-way platform tops (local coords).
  - `colliders: [{ type: 'solid', x0, x1, y0, y1 }]` – solid AABB in the x/y plane.
  - `ladders: [{ x, y0, y1 }]` – climbable ladders (local x, bottom y, top y).
  - `lights: [{ pos: THREE.Vector3, color, intensity, distance }]` – light *sources* that
    the engine's light pool may assign real PointLights to (intensity in three.js
    physical units; ~20–80 for a street lamp at distance 12–16).
  - `update(dt, time)` – per-frame animation (blinking neon, rotating windmill, etc).
  - `emitters: [{ type: 'steam'|'sparks'|'smoke'|'embers'|'drip', pos: THREE.Vector3, rate }]`
  - Named child objects for animation, e.g. `doorL`, `wheelFL`, `lightbar`, documented in a
    comment at the top of the function.
- Builders must be deterministic given `opts.seed` and fast (< 30 ms typical).

## Visual target

Neo-noir 1986 Los Angeles: rain-soaked night city with magenta/cyan neon and sodium
orange street lights; golden-hour rural America; a hellish steel foundry (the film's finale).
Reference mood: *Cobra* (1986), *Drive*, *Blade Runner*, *Hotline Miami* palettes, modern
AAA 2.5D games (*Trine*, *Shadow Complex*, *Inside*). Readable silhouettes from a side camera,
rich surface detail, bevels/edges catching light, grime, wear, and lots of small detail
(bolts, rivets, cables, signage, labels, stickers) – the camera sees mostly front faces and tops.

## Tools

- Local server: `python -m http.server 8123 --bind 127.0.0.1` from the project root
  (already running during development).
- Prop viewer: `http://127.0.0.1:8123/tools/viewer.html?module=../src/props/city.js&only=makeStreetLamp&mood=night|day|factory&cam=side|orbit`
- Screenshot: `python tools/shot.py "<url>" <out.png> --wait 2500` (prints console errors).
  Then view the PNG with the Read tool.
