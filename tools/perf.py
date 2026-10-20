"""Gameplay frame-pacing profiler: plays a level with the chaos bot and reports hitches.

Usage:
  python tools/perf.py [--level 0] [--dur 60] [--warm 3] [--top 20] [--json out.json]
                       [--w 1600] [--h 900] [--url http://127.0.0.1:8123/index.html] [--nobot]
                       [--seed 7] [--headed] [--script tools/force_finale.js]

Serve the project first (python -m http.server 8123 --bind 127.0.0.1). Uses installed
Chrome on the real GPU. Every rAF interval is recorded together with what the frame that
caused it did (tools/perfhooks.js): blocking WebGL calls (shader compile/link, uploads),
draw calls, timed JS segments, spawns and program/geometry/texture counts. Prints frame
time percentiles, hitch counts, a breakdown of the worst frames, and every shader program
or character rig created during play (both should be zero: see docs/ENGINE_CONVENTIONS.md).
Compare against a baseline by serving a `git worktree` of it on another port (--url) and
running both with the same --seed.
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = pathlib.Path(__file__).resolve().parent

ap = argparse.ArgumentParser()
ap.add_argument("--level", default="0")
ap.add_argument("--url", default="http://127.0.0.1:8123/index.html")
ap.add_argument("--query", default="", help="extra query string, e.g. 'difficulty=cobra'")
ap.add_argument("--dur", type=float, default=60)
ap.add_argument("--warm", type=float, default=3, help="seconds to skip after ready")
ap.add_argument("--top", type=int, default=20)
ap.add_argument("--json", default="")
ap.add_argument("--w", type=int, default=1600)
ap.add_argument("--h", type=int, default=900)
ap.add_argument("--nobot", action="store_true")
ap.add_argument("--headed", action="store_true")
ap.add_argument("--seed", type=int, default=0, help="seed Math.random for repeatable runs (0 = off)")
ap.add_argument("--script", default="", help="JS file evaluated after setup (e.g. tools/force_finale.js); use with --nobot")
args = ap.parse_args()

INSTRUMENT = r"""async () => {
  const P = __perf, g = __game;
  const imp = async (p) => { try { return await import(p); } catch (e) { return {}; } };
  const [en, pk, au, pl, cb, pa, am, ig, rg, env, cam] = await Promise.all(['/src/game/enemies.js', '/src/game/pickups.js',
    '/src/core/audio.js', '/src/game/player.js', '/src/game/combat.js', '/src/core/particles.js', '/src/game/ambient.js',
    '/src/game/ingrid.js', '/src/actors/rig.js', '/src/core/environment.js', '/src/game/camera.js'].map(imp));
  const se = g.spawnEnemy;
  g.spawnEnemy = function (type, ...a) { P.event('spawn:' + type); return se.call(this, type, ...a); };
  const rs = g.renderer.resize;
  g.renderer.resize = function (...a) { P.event('resize:' + this.pixelRatio.toFixed(2)); return rs.apply(this, a); };
  const kill = g.onEnemyKilled;
  g.onEnemyKilled = function (e, ...a) { P.event('kill:' + e.type); return kill.call(this, e, ...a); };
  const death = g.onPlayerDeath;
  g.onPlayerDeath = function (...a) { P.event('playerDeath'); return death.apply(this, a); };
  for (const [o, n, l] of [[g, 'update', 'game.update'], [g, 'render', 'game.render'], [g.renderer.composer, 'render', 'composer'],
    [g.renderer, 'resize', 'renderer.resize'], [g, 'spawnEnemy', 'spawnEnemy'], [g, 'onEnemyKilled', 'onEnemyKilled'],
    [g, 'respawn', 'respawn'], [g, 'addPickup', 'addPickup'], [g.hud, 'update', 'hud.update'], [g.hud, 'popup', 'hud.popup'],
    [g.hud, 'toast', 'hud.toast'], [g.hud, 'banner', 'hud.banner'], [g.lights, 'update', 'lights.update'],
    [g, 'updateAtmosphere', 'atmosphere'], [g, 'updateEmitters', 'emitters'], [au.audio, 'sfx', 'sfx'], [g.builder, 'syncLights', 'syncLights'],
    [g.renderer.gl, 'compile', 'gl.compile']]) P.wrap(o, n, l);
  if (g.wet) P.wrap(g.wet, 'update', 'wet.update');
  const R = g.renderer;
  P.wrap(g.scene, 'updateMatrixWorld', 'matrixWorld');
  P.wrap(R.gl.shadowMap, 'render', 'pass.shadow');
  P.wrap(R.renderPass, 'render', 'pass.main');
  P.wrap(R.bloom, 'render', 'pass.bloom');
  P.wrap(R.final, 'render', 'pass.final');
  P.wrap(R.output, 'render', 'pass.output');
  P.wrap(R.sanitize, 'render', 'pass.sanitize');
  P.wrap(g.hud, 'update', 'hud.update');
  P.wrapProto(en.Enemy, 'Enemy'); P.wrapProto(en.Pram, 'Pram'); P.wrapProto(pk.Pickup, 'Pickup');
  P.wrapProto(pl.Player, 'Player'); P.wrapProto(cb.Projectiles, 'Proj'); P.wrapProto(pa.Particles, 'Particles');
  P.wrapProto(am.Traffic, 'Traffic'); P.wrapProto(am.Helicopter, 'Heli'); P.wrapProto(ig.Ingrid, 'Ingrid');
  if (rg.Rig) {
    const of = rg.Rig.prototype._outfit;
    rg.Rig.prototype._outfit = function (...a) {
      const st = (new Error().stack || '').split(String.fromCharCode(10)).slice(3, 7).map((l) => l.trim().replace(/^at /, '').replace(/[(]?http:[^)]*[/]src[/]/, '').replace(/[)]$/, '')).join(' < ');
      P.event('NEW RIG ' + (a[3]?.name || a[3]?.kind || '?') + ': ' + st);
      return of.apply(this, a);
    };
  }
  P.wrapProto(rg.Rig, 'Rig'); P.wrapProto(cam.CameraRig, 'Cam');
  for (const c of ['Sky', 'Rain', 'Lightning']) P.wrapProto(env[c], c);
  const info = g.renderer.gl.info;
  // name the object whose draw links a new program (the last one about to render or cast)
  const THREE = await import('three');
  let lastDraw = null;
  const describe = (o) => {
    const chain = [];
    for (let p = o; p && chain.length < 5; p = p.parent) chain.push(p.name || p.type);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return chain.join('<') + ` (${m && m.type} side ${m && m.side}${o.isInstancedMesh ? ' instanced' : ''})`;
  };
  THREE.Object3D.prototype.onBeforeShadow = function () { lastDraw = ['shadow', this]; };
  const obr = THREE.Mesh.prototype.onBeforeRender;
  THREE.Mesh.prototype.onBeforeRender = function (...a) { lastDraw = ['draw', this]; return obr.apply(this, a); };
  const glc = g.renderer.gl.getContext(), link = glc.linkProgram;
  glc.linkProgram = function (...a) { if (lastDraw) P.event('LINK during ' + lastDraw[0] + ' of ' + describe(lastDraw[1])); return link.apply(this, a); };
  let nProg = info.programs.length;
  const progEvents = () => {
    for (; nProg < info.programs.length; nProg++) {
      const pr = info.programs[nProg], key = String(pr.cacheKey);
      P.event('NEW PROGRAM ' + pr.name + ' ' + key.slice(0, 40) + ' ... ' + key.slice(-70));
    }
    nProg = info.programs.length;
  };
  P.sample = () => (progEvents(), { prog: info.programs.length, geo: info.memory.geometries, tex: info.memory.textures,
    tris: info.render.triangles, pr: g.renderer.pixelRatio, x: +g.player.body.x.toFixed(1), st: g.state,
    en: g.enemies.length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 });
  const r = g.renderer.gl.getContext();
  const dbg = r.getExtension('WEBGL_debug_renderer_info');
  return dbg ? r.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
}"""

SEED = """(seed) => { let s = seed >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }"""


def pct(xs, p):
    s = sorted(xs)
    return s[min(len(s) - 1, int(len(s) * p))]


with sync_playwright() as p:
    b = p.chromium.launch(headless=not args.headed, channel="chrome",
                          args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
                                "--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"])
    pg = b.new_page(viewport={"width": args.w, "height": args.h})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
    pg.add_init_script(path=str(TOOLS / "perfhooks.js"))
    if args.seed:
        pg.add_init_script(f"({SEED})({args.seed})")
    q = f"level={args.level}" + (f"&{args.query}" if args.query else "")
    pg.goto(f"{args.url}?{q}")
    pg.wait_for_function("window.__ready === true", timeout=120000)
    gpu = pg.evaluate(INSTRUMENT)
    load = pg.evaluate("({ ready: Math.round(performance.now()), warm: __game.warmMs, programs: __game.renderer.gl.info.programs.length })")
    pg.evaluate((TOOLS / "scenario.js").read_text(encoding="utf-8"))
    pg.evaluate("__game.lives = 99")
    if not args.nobot:
        pg.evaluate((TOOLS / "bot.js").read_text(encoding="utf-8"))
    if args.script:
        pg.evaluate(pathlib.Path(args.script).read_text(encoding="utf-8"))
    pg.wait_for_timeout(int(args.warm * 1000))
    pg.evaluate("__perf.on = true")
    pg.wait_for_timeout(int(args.dur * 1000))
    pg.evaluate("__perf.on = false")
    frames = pg.evaluate("__perf.frames")
    longtasks = pg.evaluate("__perf.longtasks")
    state = pg.evaluate("window.__state ? __state() : null")
    b.close()

t0 = frames[0]["t"]
dts = [f["dt"] for f in frames]
print(f"GPU: {gpu}")
print(f"ready at {load['ready']} ms (GPU warm-up {load['warm']} ms, {load['programs']} programs)")
print(f"level {args.level}: {len(frames)} frames in {(frames[-1]['t'] - t0) / 1000:.1f}s, "
      f"avg {1000 * len(frames) / max(1, frames[-1]['t'] - t0):.1f} fps, pixelRatio {frames[0].get('pr')}->{frames[-1].get('pr')}")
print("frame ms  p50 %.1f  p90 %.1f  p99 %.1f  p99.9 %.1f  max %.1f" % (pct(dts, .5), pct(dts, .9), pct(dts, .99), pct(dts, .999), max(dts)))
print("hitches   >25ms %d  >33ms %d  >50ms %d  >100ms %d  >250ms %d" % tuple(sum(d > k for d in dts) for k in (25, 33.4, 50, 100, 250)))
print(f"programs {frames[0].get('prog')} -> {frames[-1].get('prog')}, geometries {frames[0].get('geo')} -> {frames[-1].get('geo')}, "
      f"textures {frames[0].get('tex')} -> {frames[-1].get('tex')}, heap {frames[0].get('heap')} -> {frames[-1].get('heap')} MB")
print("end state:", json.dumps(state))

# totals of blocking GL work and segments over the run
tot = {}
for f in frames:
    for k, (n, ms) in f["gl"].items():
        a = tot.setdefault("gl." + k, [0, 0.0]); a[0] += n; a[1] += ms
seg = {}
for f in frames:
    for k, (n, ms) in f["seg"].items():
        a = seg.setdefault(k, [0, 0.0]); a[0] += n; a[1] += ms
print("\nGL totals (calls, ms):", ", ".join(f"{k[3:]} {n}/{ms:.0f}" for k, (n, ms) in sorted(tot.items(), key=lambda kv: -kv[1][1])[:10]))
print("JS segment avg ms/frame:", ", ".join(f"{k} {ms / len(frames):.2f}" for k, (n, ms) in sorted(seg.items(), key=lambda kv: -kv[1][1])[:14]))
# median per-frame cost of each segment over frames that ran it (robust to jitter spikes)
med = {}
for f in frames:
    for k, (n, ms) in f["seg"].items():
        med.setdefault(k, []).append(ms)
print("JS segment median ms (frames that ran it):", ", ".join(f"{k} {sorted(v)[len(v) // 2]:.2f}" for k, v in sorted(med.items(), key=lambda kv: -sorted(kv[1])[len(kv[1]) // 2])[:16]))
work = sorted(f["seg"].get("game.update", [0, 0])[1] + f["seg"].get("game.render", [0, 0])[1] for f in frames)
print("game work/frame ms: p50 %.1f  p90 %.1f  p99 %.1f" % (work[len(work) // 2], work[int(len(work) * .9)], work[int(len(work) * .99)]))

print(f"\nworst {args.top} frames:")
prev = {}
by_t = {id(f): i for i, f in enumerate(frames)}
for f in sorted(frames, key=lambda f: -f["dt"])[: args.top]:
    i = by_t[id(f)]
    pf = frames[i - 1] if i else f
    gl = ", ".join(f"{k} {n}x/{ms:.0f}" for k, (n, ms) in sorted(f["gl"].items(), key=lambda kv: -kv[1][1]) if ms >= 1 or k in ("compileShader", "linkProgram"))
    sg = ", ".join(f"{k} {ms:.0f}" for k, (n, ms) in sorted(f["seg"].items(), key=lambda kv: -kv[1][1]) if ms >= 2)
    d = []
    for k in ("prog", "geo", "tex"):
        if f.get(k) is not None and pf.get(k) is not None and f[k] != pf[k]:
            d.append(f"{k}{f[k] - pf[k]:+d}")
    print(f"  {f['dt']:6.1f}ms @{(f['t'] - t0) / 1000:5.1f}s x={f.get('x')} draws={f['draws']} {' '.join(d)}")
    if gl: print(f"      gl: {gl}")
    if sg: print(f"      js: {sg}")
    if f["ev"]: print(f"      ev: {', '.join(f['ev'])}")
lt = [x for x in longtasks if x[0] >= t0]
progs = [e for f in frames for e in f["ev"] if e.startswith("NEW PROGRAM") or e.startswith("LINK during")]
print(f"\nruntime shader programs: {len(progs)}", *progs[:6], sep="\n  ")
news = [e for f in frames for e in f["ev"] if e.startswith("NEW RIG")]
print(f"\nruntime character builds: {len(news)}", *news[:6], sep="\n  ")
print(f"\nlong tasks during run: {len(lt)}; worst: {sorted(lt, key=lambda x: -x[1])[:8]}")
if errs:
    print("console:", errs[:8])
if args.json:
    pathlib.Path(args.json).write_text(json.dumps({"frames": frames, "longtasks": longtasks}), encoding="utf-8")
