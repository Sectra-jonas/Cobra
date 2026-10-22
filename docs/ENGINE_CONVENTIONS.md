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
  - `ladders: [{ x, y0, y1, z, w }]` – climbable ladders (local x, bottom y, top y) and where
    the visual rails are (`z` of the ladder, `w` rail spacing) so the readability accents
    can glint on them; `stairs: true` for a staircase registered as a ladder (no rail glints).
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

## Frame pacing (no runtime builds, compiles or uploads)

three.js compiles a shader, uploads a mesh and uploads a texture the first time each is drawn.
On Windows/ANGLE (D3D11 + FXC) one lit-material shader takes 100-400 ms, so anything seen for
the first time mid-game freezes it. Rules:

- Never build models, characters or materials during play. Everything a level can show is
  built in `Game.loadLevel` and made GPU-resident by `Game.warmGpu` (parallel shader compile
  for the composer's render-target variant, then one frame drawn with everything visible and
  unculled). Runtime-spawned things come from pools/warm sets: `prewarmEnemies` (rig pools
  sized from the level's encounters + ambient crowd, bike/pram), `Traffic` (fleet built in its
  constructor), `projectileWarmSet`, `pickupWarmSet`. A new spawnable thing needs an entry there.
- Don't toggle material state that changes the program (`transparent`, `side`, defines,
  `needsUpdate`) at runtime unless warmGpu covers that variant (rig fade-outs are covered).
- The light count is part of every program: don't add, remove or show/hide real lights during
  play or cinematics (use `LightPool` sources; the title logo's sweep is shaded in its own
  material for this reason).
- Static props: `place()` freezes every node's matrix except the nodes `update()` moves (named /
  `userData.dynamic` nodes or ones seen moving). Moving props need `{ static: false }`.
- Don't read layout (`clientWidth`, `getBoundingClientRect`) per frame - use
  `renderer.width/height`. HUD elements that change often animate `transform`/`opacity` only
  and sit in their own compositor layer (`will-change`), so they never re-raster big areas.
  The browser compiles its own raster shaders on the first HUD paint, so `hud.prime()` paints
  the HUD once (1% opaque) at boot.
- Shadow-pass depth programs differ from ordinary draws (no scene, so no fog flag) and the
  shared depth material only re-picks its program when a non-`side` parameter changes, so
  `shadowDepthVariants()` stand-ins cast shadows to compile every side/map/instancing variant.
- Every real light is evaluated for every lit pixel (and is part of every program): get a
  lighting look from the existing moon/hemisphere/pool sources rather than adding lights.
- Check with `python tools/perf.py --level N [--headed] [--seed 7]`: it plays the level with
  the chaos bot and must report `programs a -> a` (no runtime compiles), no geometry/texture
  growth and `runtime character builds: 0`, plus frame-time percentiles and the worst frames.

## Readability (every platform and ladder must be visible)

Night levels are lit for mood by practicals (lamps, neon, windows); between them roofs, decks
and ladders must still read against the walls behind. Rules:

- Value structure: the level's `sun` is a high moon and the `hemi` sky is brighter than its
  ground, so what faces up (everything walkable) is lit more than facades.
- `accents.js` glints the front edge of every prop-backed ledge and solid top and both rails of
  every ladder (level def `accents: { color, ledges, ladders }`). Colliders added directly
  by level scripts (`L.ledge/L.solid`: the street, gates that open) get none. Ladder entries
  must say where their rails are (`z`, `w`, see the prop API above).
- Painted metal (fire escapes, ladders, railings) is a dielectric, `metalness` <= ~0.4: a dark
  pure metal has no diffuse response and stays black under night lighting.
- The grade's contrast is an S-curve that keeps the toe; never clip the shadows to black.
- Check with `python tools/readability.py --level N`: it stands on every ledge and scores each
  ledge and ladder in CIE L*. Keep ledges at median >= 15 with < 10% invisible (< 8).

## Tools

- Local server: `python -m http.server 8123 --bind 127.0.0.1` from the project root
  (already running during development).
- Prop viewer: `http://127.0.0.1:8123/tools/viewer.html?module=../src/props/city.js&only=makeStreetLamp&mood=night|day|factory&cam=side|orbit`
- Screenshot: `python tools/shot.py "<url>" <out.png> --wait 2500` (prints console errors).
  Then view the PNG with the Read tool.
- Readability audit: `python tools/readability.py --level N [--shots dir] [--eval "js"]`
  (`--eval` tries lighting values live before measuring).
