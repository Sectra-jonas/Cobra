# COBRA — a modern remake

A modern, cinematic remake of **Cobra** (Ocean Software, 1986; Commodore 64, ZX Spectrum,
Amstrad CPC), the side-scrolling platform shooter based on the Warner Bros. film starring
Sylvester Stallone as Lt. Marion "Cobra" Cobretti.

*Crime is a disease. He's the cure.*

Everything runs in the browser with Three.js. All models, textures, music and sound effects
are generated procedurally at runtime: there are no image, model or audio files.

## Run it

```bash
cd "C:/work/AI Research/Cobra"
python -m http.server 8123
# open http://127.0.0.1:8123/
```

An internet connection is needed for Three.js (jsDelivr) and the fonts (Google Fonts).
Use a desktop browser with WebGL2; headphones help.

Useful URL switches:

| URL | What it does |
|---|---|
| `/` | Full experience: press any key, intro cinematic, title, game |
| `/?skipintro` | Straight to the title screen |
| `/?level=0` `1` `2` | Jump into a level (0 City, 1 Rural, 2 Factory) |
| `/?level=0&debug` | Draws colliders: ledges green, solids red, ladders yellow, hazards orange |
| `/?level=test` | Primitive test range |
| `/?difficulty=cop\|zombie\|cobra` | Difficulty for direct starts |
| `/?touch` | Force the on-screen touch controls |

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Run | ← → / A D | Stick / D-pad |
| Jump (hold for height) | Space, ↑ / W | A |
| Climb ladders | ↑ ↓ at a ladder | Stick / D-pad |
| Duck / drop through (↓ + Space) | ↓ / S | Stick down |
| **MURDER** (headbutt or weapon) | J / Z / Ctrl | X / RT |
| Grenade | K / X | B |
| Pause | Esc / P | Start |
| C64 mode (320×200, 16-colour palette, dithered) | F2 / C | Select |

## The rules (faithful to 1986)

- Cobra starts unarmed and **headbutts**. Weapons hide inside **beef burgers**: knife,
  .45 pistol, laser-sighted SMG and the **invincibility pill**.
- Every weapon wears out. The **Quackometer** (a rubber duck) shows how long it lasts.
- Carrying a tougher weapon brings more of the gang onto the street.
- To clear a section: find **all four burgers**, rescue **Ingrid** (touch her and she
  follows), and take down the **gang quota**.
- If Ingrid is with you, a lethal hit takes her instead of a life: she is snatched away and
  must be found again. Shoot her and she runs off.
- Enemies from the original: bouncers in shades, knife throwers, gunmen, **bazooka women**,
  **pram-pushing ladies** (jump the pram!), axe men, bikers, bombers and kidnappers.
- 3 lives, bonus lives at 10,000 and every 20,000 points.
- Three playfields: **the City** (night), **the Rural area** (day) and **the Factory**,
  where you confront **the Night Slasher**.

## What's new

- In-engine opening cinematic: crime statistics on a typewriter, the '50 Mercury in the
  rain, the laser sight on the lens, and the chrome logo slam.
- Physically based lighting: a pooled dynamic light system for hundreds of neon signs, lamps
  and furnaces, soft shadows, ACES tone mapping, bloom, film grain, chromatic aberration,
  heat haze and colour grading per level.
- Planar reflections on rain-soaked streets with procedural puddles and ripples, plus GPU
  rain, lightning, steam and embers.
- Procedural characters with layered procedural animation, hit reactions and secondary motion.
- A synthesized 80s action score with dynamic intensity layers, and layered synthesized sound
  effects (no samples).
- A three-phase boss fight that ends the way the film does.
- A C64 hi-score table with name entry, three difficulties, gamepad and touch support.

## Project layout

```
index.html              page shell, importmap, fonts
src/main.js             boot and flow (press start → intro → title → levels → victory)
src/core/               renderer + post FX, textures, materials, particles, light pool,
                        environment (sky, skyline, rain, lightning, wet ground), input, audio
src/actors/             procedural humanoid rig + poses, character roster, hand-held gear
src/props/              procedural props: city, vehicles, rural, factory
src/game/               game loop, physics, player, enemies, Ingrid, boss, pickups,
                        combat, camera, HUD, menus, intro cinematic, logo
src/levels/             level layouts: city, rural, factory, test range
tools/                  prop/character viewers, screenshot and play-test helpers
docs/                   engine conventions
```

## Credits for the original

*Cobra* (1986) was published by Ocean Software. The C64 version was written by Zach Townsend
with graphics by Karen Davies, from an idea by Jonathan Smith. Smith's ZX Spectrum version won
Newsfield's 1987 award for Best Platform Game. Music by Martin Galway. Based on the film
*Cobra* © Warner Bros. This remake is a non-commercial tribute.
