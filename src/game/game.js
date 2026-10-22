// Game orchestrator: owns the scene for the current level and runs gameplay.
import * as THREE from 'three';
import { World } from './physics.js';
import { Particles } from '../core/particles.js';
import { LightPool } from '../core/lightpool.js';
import { Sky, makeSkyline, Rain, Lightning, WetGround } from '../core/environment.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { Enemy, Pram, prewarmEnemies, freeRigs, ENEMY_TYPES } from './enemies.js';
import { Ingrid } from './ingrid.js';
import { Pickup, pickupWarmSet } from './pickups.js';
import { Projectiles, WEAPONS, projectileWarmSet } from './combat.js';
import { SUMMONS } from './boss.js';
import { Poses } from '../actors/rig.js';
import { Traffic, Helicopter } from './ambient.js';
import { LevelBuilder, loadProps } from './level.js';
import { buildAccents } from './accents.js';
import { rimUniforms } from '../actors/rig.js';
import { input } from '../core/input.js';
import { sound } from '../core/sound.js';

export const DIFFICULTY = {
  cop: { name: 'COP', damage: 0.6, enemyHp: 0.8, enemySpeed: 0.9, enemyCooldown: 1.3, playerDamage: 1.2, spawn: 0.75 },
  zombie: { name: 'ZOMBIE SQUAD', damage: 1, enemyHp: 1, enemySpeed: 1, enemyCooldown: 1, playerDamage: 1, spawn: 1 },
  cobra: { name: 'COBRA', damage: 1.5, enemyHp: 1.2, enemySpeed: 1.1, enemyCooldown: 0.75, playerDamage: 0.9, spawn: 1.3 },
};

function makeEnvMap(renderer, colors) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(colors.bg || '#05060a');
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: colors.room || '#0b0c12', side: THREE.BackSide }));
  s.add(room);
  for (const p of colors.panels || []) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.i || 3), side: THREE.DoubleSide }));
    m.position.set(...p.pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}

// The shadow pass draws every caster with one shared depth material and only re-picks its
// program (face side, instancing, map / alpha test copied from the caster) when some other
// parameter changes, so which depth variants exist depends on draw order: a pram's double-sided
// hood drawn right after an instanced mesh compiled a new one mid-game. Stand-ins for every
// combination, compiled with the level, cover any order. They must cast shadows: drawn only as
// ordinary meshes they compile the fogged variants, and the shadow pass (no scene, no fog) uses
// fog-less ones, which then existed only if the level's own casters happened to hit each order.
let depthStandIns = null;
function shadowDepthVariants() {
  if (depthStandIns) return depthStandIns;
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.01, 0.01);
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  tex.needsUpdate = true;
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    for (const [map, alphaTest] of [[null, 0], [tex, 0], [tex, 0.5]]) {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side, map, alphaTest });
      g.add(new THREE.Mesh(geo, m), new THREE.InstancedMesh(geo, m, 1));
    }
  }
  for (const c of g.children) c.castShadow = true;
  depthStandIns = g;
  return g;
}

export class Game {
  constructor(renderer, hud, levels) {
    this.renderer = renderer;
    this.hud = hud;
    this.levels = levels;
    this.camRig = new CameraRig(renderer.container.clientWidth / renderer.container.clientHeight);
    this.state = 'idle';
    this.difficulty = DIFFICULTY.zombie;
    this.hi = 50000;
    try { this.hi = Math.max(this.hi, parseInt(localStorage.getItem('cobra.hi') || '0', 10) || 0); } catch (e) { /* storage blocked */ }
    this.timeScale = 1;
    this.slowT = 0;
    this.stopT = 0;
    this.propsPromise = loadProps().then((p) => { this.props = p; return p; });
    this.onLevelComplete = null;
    this.onGameOver = null;
    this.onVictory = null;
  }

  newGame(difficulty = 'zombie') {
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.zombie;
    this.score = 0;
    this.lives = 3;
    this.nextLife = 10000;
    this.levelIndex = 0;
    this.combo = 1;
    this.comboT = 0;
    this.totalKills = 0;
  }

  // ------------------------------------------------------------ loading
  async loadLevel(index) {
    await this.propsPromise;
    this.dispose();
    this.loading = true;
    this.loadId = (this.loadId || 0) + 1;
    this.levelIndex = index;
    const def = this.levels[index];
    const scene = new THREE.Scene();
    // the root never moves: without this every render recomputes all ~3000 world matrices
    // (static props opt out via matrixAutoUpdate, but a dirty root forces its whole tree);
    // render() updates the graph once per frame for both the reflection and the main pass
    scene.matrixAutoUpdate = false;
    scene.matrixWorldAutoUpdate = false;
    this.scene = scene;
    this.world = new World();
    this.world.minX = def.minX ?? -6;
    this.world.maxX = def.length + 6;
    this.particles = new Particles(scene);
    this.lights = new LightPool(scene, def.lightPool ?? 10);
    this.projectiles = new Projectiles(this);
    this.enemies = [];
    this.prams = [];
    this.pickups = [];
    this.kills = 0;
    this.burgers = new Set();
    this.time = 0;
    this.spawnT = 3;
    this.exitOpen = false;
    this.lock = null;
    this.bossActive = false;
    this.bossStarted = false;
    this.bossDone = false;
    this.boss = null;
    this.finaleHook = null;
    this.arenaBurgers = null;
    this.fl1 = this.fl2 = this.fl3 = this.fl4 = this.fl5 = false;
    this.outroIn = this.outroDoor = this.outroEngine = this.outroDone = false;
    this.exitCar = null;
    this.startCar = null;
    this.introDressing = null;
    this.hud.boss(null);

    // atmosphere
    scene.fog = new THREE.FogExp2(def.fog.color, def.fog.density);
    scene.background = new THREE.Color(def.fog.color);
    scene.environment = makeEnvMap(this.renderer.gl, def.env || {});
    scene.environmentIntensity = def.envIntensity ?? 0.6;
    this.sky = new Sky(scene, def.sky);
    const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.intensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 18; sc.bottom = -12; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.sunDir = new THREE.Vector3(...def.sun.dir).normalize();
    this.sunBase = def.sun.intensity;
    if (def.fill) {
      const fill = new THREE.DirectionalLight(def.fill.color, def.fill.intensity);
      fill.position.set(...def.fill.dir).multiplyScalar(50);
      scene.add(fill);
    }
    rimUniforms.uRimColor.value.set(def.rim?.color || '#7fb6ff');
    rimUniforms.uRimStrength.value = def.rim?.strength ?? 0.22;

    for (const sl of def.skyline || []) {
      const m = makeSkyline(scene, { x0: -160, x1: def.length + 120, ...sl, fogColor: def.fog.color, count: sl.count || 80 });
      this.levelUpdaters = this.levelUpdaters || [];
      (this.skylineMeshes ||= []).push(m);
    }
    this.rain = def.rain ? new Rain(scene, def.rainOpts || {}) : null;
    this.lightning = def.lightning ? new Lightning(scene, this.sky) : null;
    if (this.lightning) this.lightning.onStrike = (dist) => {
      setTimeout(() => sound.thunder(dist), 300 + dist * 2200);
    };
    this.wet = def.wet ? new WetGround(this.renderer.gl, { strength: def.wet.strength ?? 0.85, coverage: def.wet.coverage ?? 0.55, rain: def.rain ? 1 : 0 }) : null;

    // build
    const L = new LevelBuilder(this, def, this.props || {});
    this.builder = L;
    def.build(L, this);
    if (L.missing.size) console.warn('[cobra] missing props:', [...L.missing].join(', '));
    if (def.accents) scene.add(buildAccents(this.world, L, def.accents));
    if (this.wet) for (const m of L.wetMeshes || []) this.wet.apply(m);
    if (new URLSearchParams(location.search).has('debug')) this.drawColliders();

    // ambient life
    this.traffic = def.traffic ? new Traffic(this, def.traffic) : null;
    this.heli = def.helicopter ? new Helicopter(this, def.helicopter) : null;

    // actors
    this.player = new Player(this);
    this.player.reset(true);
    this.player.spawnAt(def.start.x, def.start.y);
    this.checkpoint = { x: def.start.x, y: def.start.y };
    this.ingrid = new Ingrid(this);
    this.ingrid.setSpots(L.ingridSpots);
    this.ingridTrigger = def.ingridTrigger ?? def.length * 0.3;
    for (const b of L.burgers) this.pickups.push(new Pickup(this, 'burger', b.x, b.y, { weapon: b.weapon }));
    for (const p of L.pickups) this.pickups.push(new Pickup(this, p.kind, p.x, p.y));
    this.particles.floorAt = (x, y) => { const g = this.world.groundAt(x, y); return isFinite(g) ? g : -20; };
    this.particles.onShellBounce = (it) => sound.sfx('shell', { x: it.x, volume: 0.25 });

    this.camRig.setBounds(this.world.minX, this.world.maxX);
    this.camRig.minY = 0;
    this.camRig.snap(def.start.x, def.start.y);
    this.renderer.setGrade(def.grade || {});
    this.hud.update(0, this.hudState());
    const foes = prewarmEnemies(this, def.boss ? [...SUMMONS, ...SUMMONS] : []);
    const loadId = this.loadId;
    await this.warmGpu([...foes.extra, ...(this.traffic?.pool || []), projectileWarmSet(), pickupWarmSet()], [...foes.rigs, this.ingrid.rig]);
    if (loadId !== this.loadId) return def;
    this.loading = false;
    this.state = 'play';
    this.tipT = 0;
    this.tips = index === 0 ? [
      { at: 3.5, text: '← → RUN · SPACE JUMP · ↑ CLIMB LADDERS' },
      { at: 7.5, text: 'J / Z / CTRL — "MURDER" (HEADBUTT)' },
      { at: 12, text: 'BURGERS HIDE WEAPONS — FIND ALL FOUR', dur: 3.6 },
      { at: 16, text: 'SOME ARE UP HIGH — CLIMB THE FIRE ESCAPES ↑', dur: 3.6 },
      { at: 30, text: '↓ DUCK · ↓ + SPACE DROPS THROUGH PLATFORMS' },
      { at: 45, text: 'K — GRENADE', dur: 2.4 },
    ] : null;
    sound.playMusic(def.music || 'city');
    sound.setAmbience(def.ambience || null);
    sound.setMusicIntensity(0.3);
    return def;
  }

  // three.js compiles shaders and uploads meshes/textures lazily, on first draw. On D3D
  // (ANGLE + FXC) a lit-material shader takes 100-400 ms to compile, so every enemy type,
  // prop or effect seen for the first time froze the game. Before play, every program the
  // level can use is compiled in parallel (KHR_parallel_shader_compile) for the render-target
  // output the pipeline really draws into (compiling for the canvas gives other, tone-mapped
  // variants), then one frame is drawn with everything visible and unculled so all meshes,
  // textures and shadow-depth variants are GPU-resident. `extra` are objects that only enter
  // the scene during play; `rigs` also get their fade-out (transparent) variants compiled.
  async warmGpu(extra, rigs) {
    const R = this.renderer, gl = R.gl, scene = this.scene, cam = this.camRig.cam;
    const t0 = performance.now();
    const tmp = new THREE.Group();
    tmp.add(shadowDepthVariants());
    for (const o of extra) tmp.add(o);
    for (const r of rigs) if (r && !r.root.parent) tmp.add(r.root);
    scene.add(tmp);
    // lights keep their effective visibility: the light count is part of every program
    const lit = new Map();
    scene.traverse((o) => {
      if (!o.isLight) return;
      let v = true;
      for (let p = o; p; p = p.parent) if (!p.visible) { v = false; break; }
      lit.set(o, v);
    });
    const saved = [];
    scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = lit.has(o) ? lit.get(o) : true;
      o.frustumCulled = false;
    });
    const compile = () => {
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(R.composer.renderTarget1);
      const done = gl.compileAsync(scene, cam);
      gl.setRenderTarget(prev);
      return done;
    };
    const draw = () => {
      scene.updateMatrixWorld();
      if (this.wet) this.wet.update(0, scene, cam);
      R.render(scene, cam, 0);
    };
    const fade = R.fade;
    try {
      await compile();
      for (const r of rigs) r?.setOpacity(0.5);
      await compile();
      R.fade = 1;
      draw(); // ANGLE finishes some D3D shader work on a program's first draw, not at link
      for (const r of rigs) r?.setOpacity(1);
      draw();
    } finally {
      R.fade = fade;
      for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
      scene.remove(tmp);
    }
    this.warmMs = Math.round(performance.now() - t0);
  }

  drawColliders() {
    const g = new THREE.Group();
    const lm = (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    const seg = (pts, c) => { const geo = new THREE.BufferGeometry().setFromPoints(pts); const l = new THREE.Line(geo, lm(c)); l.renderOrder = 999; g.add(l); };
    const V = (x, y) => new THREE.Vector3(x, y, 0.6);
    for (const l of this.world.ledges) seg([V(l.x0, l.y), V(l.x1, l.y)], '#3dff6a');
    for (const s of this.world.solids) if (s.y1 - s.y0 < 50) seg([V(s.x0, s.y0), V(s.x1, s.y0), V(s.x1, s.y1), V(s.x0, s.y1), V(s.x0, s.y0)], '#ff3b3b');
    for (const l of this.world.ladders) seg([V(l.x, l.y0), V(l.x, l.y1)], '#ffe14d');
    for (const h of this.world.hazards) seg([V(h.x0, h.y0), V(h.x1, h.y0), V(h.x1, h.y1), V(h.x0, h.y1), V(h.x0, h.y0)], '#ff9a1a');
    this.scene.add(g);
  }

  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
      }
    });
    this.wet?.rt.dispose();
    this.scene = null;
    this.skylineMeshes = [];
  }

  // ------------------------------------------------------------ queries
  hittables() {
    const out = [];
    for (const e of this.enemies) if (e.alive) out.push(e);
    for (const p of this.prams) if (p.alive) out.push(p);
    if (this.boss && this.boss.alive) out.push(this.boss);
    if (this.ingrid && (this.ingrid.state === 'following' || this.ingrid.state === 'waiting')) out.push(this.ingrid);
    return out;
  }

  playerHittables() { return [this.player]; }

  get def() { return this.levels[this.levelIndex]; }

  weaponTier() { return WEAPONS[this.player.weapon].tier + (this.player.pill > 0 ? 1 : 0); }

  // ------------------------------------------------------------ events
  hitStop(t) { this.stopT = Math.max(this.stopT, t); }
  slowMo(t, scale = 0.25) { this.slowT = t; this.slowScale = scale; sound.setSlowMo(scale); sound.sfx('slowmo'); }

  addScore(points, x, y) {
    const pts = points > 0 ? points * this.combo : points;
    const before = this.score;
    this.score = Math.max(0, this.score + pts);
    if (x !== undefined) {
      const s = this.camRig.toScreen(new THREE.Vector3(x, y, 0), this.renderer.width, this.renderer.height);
      this.hud.popup(s.x, s.y, (pts > 0 ? '+' : '') + pts, pts < 0);
    }
    while (this.score >= this.nextLife) {
      this.lives++;
      this.nextLife += 20000;
      sound.sfx('extraLife');
      this.hud.toast('EXTRA LIFE!');
    }
    if (this.score > this.hi) { this.hi = this.score; }
    return before;
  }

  onEnemyKilled(e, info) {
    this.kills++;
    this.totalKills++;
    if (this.comboT > 0) this.combo = Math.min(5, this.combo + 1);
    else this.combo = 1;
    this.comboT = 2.6;
    if (e.cfg) this.addScore(e.cfg.score, e.body.x, e.body.y + 2.1);
    if (Math.random() < 0.07) this.pickups.push(new Pickup(this, 'grenades', e.body.x, Math.max(0, this.world.groundAt(e.body.x, e.body.y + 0.5))));
    if (this.kills === this.def.quota) {
      this.hud.toast('GANG QUOTA MET');
      sound.sfx('objective');
      this.checkObjectives();
    }
    if (this.lock && this.lock.enemies && this.lock.enemies.every((x) => !x.alive)) this.slowMo(0.9, 0.3);
  }

  onBurger(w) {
    this.burgers.add(w);
    if (this.burgers.size === 4) { sound.sfx('objective'); this.hud.toast('ALL FOUR BURGERS FOUND'); }
    this.checkObjectives();
  }

  onIngridRescued() { this.checkObjectives(); }

  objectivesMet() {
    return this.burgers.size >= 4 && this.kills >= this.def.quota && this.ingrid.state === 'following';
  }

  checkObjectives() {
    if (!this.exitOpen && this.objectivesMet()) {
      this.exitOpen = true;
      sound.sfx('sectionClear');
      this.hud.banner('SECTION CLEAR', this.def.exitText || 'Head east with Ingrid', 3);
      sound.setMusicIntensity(1);
      if (this.def.onExitOpen) this.def.onExitOpen(this);
    }
  }

  onPlayerDeath() {
    this.lives--;
    this.combo = 1;
    this.deathT = 2.6;
    this.camRig.zoomTarget = 1.25;
    this.hud.banner(this.lives > 0 ? 'COBRA DOWN' : 'GAME OVER', this.lives > 0 ? `${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT` : 'Crime wins this round', 2.4);
  }

  respawn() {
    const P = this.player;
    P.reset(false);
    const cp = this.checkpoint;
    P.spawnAt(cp.x, cp.y + 0.5);
    P.invuln = 2.5;
    this.camRig.zoomTarget = 1;
    // clear nearby threats so the respawn is fair
    for (const e of this.enemies) if (e.alive && Math.abs(e.body.x - cp.x) < 10) { e.alive = false; e.remove(); }
    this.projectiles.clear();
    if (this.ingrid.state === 'following') { this.ingrid.body.x = cp.x - 1.5; this.ingrid.body.y = cp.y; this.ingrid.trail.length = 0; this.ingrid.startFollowing(); }
  }

  spawnEnemy(type, x, y, opts = {}) {
    if (!ENEMY_TYPES[type]) return null;
    const e = new Enemy(this, type, x, y, opts);
    this.enemies.push(e);
    return e;
  }

  spawnPram(mesh, x, y, vx) {
    if (Math.abs(vx) < 0.5) { mesh.removeFromParent(); return; }
    this.prams.push(new Pram(this, mesh, x, y, vx));
  }

  // Picks a spawn location just off-screen on a random walkable tier.
  ambientSpawn() {
    const def = this.def;
    const cam = this.camRig;
    const half = cam.visibleHalfWidth();
    const P = this.player.body;
    const pool = def.enemyPool;
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = Math.random() * total, type = pool[0][0];
    for (const [t, w] of pool) { r -= w; if (r <= 0) { type = t; break; } }
    if (this.lock && type === 'biker') type = 'thug';
    // never generate a character mid-game: fall back to a type with a pooled rig
    if (!freeRigs(type)) {
      const alt = pool.filter(([t]) => freeRigs(t) && !(this.lock && t === 'biker'));
      if (!alt.length) return null;
      type = alt[Math.floor(Math.random() * alt.length)][0];
    }
    // door spawn when a doorway is on screen
    const doors = this.builder.doors.filter((d) => Math.abs(d.x - cam.focus.x) < half - 2 && Math.abs(d.x - P.x) > 4);
    if (doors.length && Math.random() < 0.35 && type !== 'biker') {
      const d = doors[Math.floor(Math.random() * doors.length)];
      return this.spawnEnemy(type, d.x, d.y, { emerge: true, facing: P.x > d.x ? 1 : -1 });
    }
    const side = Math.random() < (P.vx > 1 ? 0.75 : P.vx < -1 ? 0.25 : 0.5) ? 1 : -1;
    const x = cam.focus.x + side * (half + 1.5);
    if (x < this.world.minX + 1 || x > this.world.maxX - 1) return null;
    if (type === 'biker') {
      if (!isFinite(this.world.groundAt(x, 0.1))) return null;
      return this.spawnEnemy('biker', x, 0, { facing: -side });
    }
    // collect tiers at x
    const tiers = [];
    for (const it of this.world.query(x - 0.1, x + 0.1)) {
      if ((it._kind === 'ledge' || it._kind === 'solid') && x >= it.x0 + 0.4 && x <= it.x1 - 0.4) tiers.push(it._kind === 'ledge' ? it.y : it.y1);
    }
    if (!tiers.length) return null;
    const preferHigh = type === 'bazooka' || type === 'bomber';
    tiers.sort((a, b) => a - b);
    let y = preferHigh ? tiers[tiers.length - 1] : tiers[Math.floor(Math.random() * tiers.length)];
    if (y > 14) y = tiers[0];
    return this.spawnEnemy(type, x, y + 0.05, { facing: -side });
  }

  // ------------------------------------------------------------ update
  update(rawDt) {
    if (this.state === 'idle' || !this.scene || this.loading) return;
    if (input.pressed('pause') && (this.state === 'play' || this.state === 'paused')) this.togglePause();
    if (this.state === 'paused') { this.renderOnly = true; return; }
    this.renderOnly = false;

    let dt = rawDt;
    if (this.stopT > 0) { this.stopT -= rawDt; dt = rawDt * 0.02; }
    if (this.slowT > 0) {
      this.slowT -= rawDt;
      dt *= this.slowScale;
      if (this.slowT <= 0) sound.setSlowMo(1);
    }
    this.dt = dt;
    this.time += dt;
    const def = this.def;
    const P = this.player;

    // combo timer
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 1; }

    P.update(dt);
    this.ingrid.update(dt);
    if (this.ingrid.state === 'hidden' && (P.body.x > this.ingridTrigger || this.weaponTier() >= 2 && P.body.x > this.ingridTrigger * 0.6) && this.builder.ingridSpots.length) {
      this.ingrid.appear(this.ingrid.nextSpot());
    }
    for (const e of this.enemies) e.update(dt);
    this.enemies = this.enemies.filter((e) => !e.removed);
    // keep the gang from stacking into one spot
    const live = this.enemies.filter((e) => e.alive && !e.bike && !e.seekLadder && !e.body.climbing);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i].body, c = live[j].body;
        const dx = c.x - a.x;
        if (Math.abs(dx) < 0.62 && Math.abs(a.y - c.y) < 0.5) {
          const push = (0.62 - Math.abs(dx)) * 0.5 * Math.min(1, dt * 12) * (dx >= 0 ? 1 : -1);
          a.x -= push; c.x += push;
        }
      }
    }
    for (const p of this.prams) p.update(dt);
    this.prams = this.prams.filter((p) => !p.dead);
    this.projectiles.update(dt);
    for (const p of this.pickups) p.update(dt);
    this.pickups = this.pickups.filter((p) => !p.taken);
    if (this.boss) this.boss.update(dt);

    // scripted encounters (never from a cinematic moving the player around, e.g. the intro drive-in)
    for (const enc of this.builder.encounters) {
      if (enc.done || P.body.x < enc.x || this.state !== 'play') continue;
      if (enc.requires && !enc.requires(this)) continue;
      enc.done = true;
      enc.spawned = [];
      const loadId = this.loadId;
      for (const s of enc.spawns) {
        setTimeout(() => {
          if (!this.scene || this.state === 'idle' || this.loadId !== loadId) return;
          const e = this.spawnEnemy(s.type, s.x ?? enc.x + (s.dx || 0), s.y ?? 0.05, { emerge: s.emerge, facing: s.facing });
          if (e) enc.spawned.push(e);
        }, (s.delay || 0) * 1000);
      }
      if (enc.banner) this.hud.banner(enc.banner, enc.sub || '', 2.2);
      if (enc.lock) {
        this.lock = { enc, x0: enc.x - enc.lock, x1: enc.x + enc.lock, until: this.time + 1 + Math.max(...enc.spawns.map((s) => s.delay || 0)) };
        this.camRig.setBounds(this.lock.x0 - 2, this.lock.x1 + 2);
        this.world.minX = this.lock.x0; this.world.maxX = this.lock.x1;
        sound.setMusicIntensity(1);
      }
      if (enc.onStart) enc.onStart(this);
    }
    if (this.lock) {
      this.lock.enemies = this.lock.enc.spawned;
      if (this.time > this.lock.until && this.lock.enemies.every((e) => !e.alive)) {
        this.world.minX = def.minX ?? -6; this.world.maxX = def.length + 6;
        this.camRig.setBounds(this.world.minX, this.world.maxX);
        this.hud.toast('AREA CLEAR — MOVE ON');
        if (this.lock.enc.onClear) this.lock.enc.onClear(this);
        this.lock = null;
        sound.setMusicIntensity(0.5);
      }
    }

    // ambient spawning (faithful: tougher weapon => more opposition)
    if (this.state === 'play' && P.alive && !this.bossActive && def.enemyPool.length) {
      const tier = this.weaponTier();
      this.spawnT -= dt * this.difficulty.spawn * (1 + tier * 0.22);
      const alive = this.enemies.filter((e) => e.alive).length;
      const maxAlive = (def.maxAlive ?? 4) + tier + (this.lock ? 2 : 0);
      if (this.spawnT <= 0 && alive < maxAlive && P.body.x > (def.safeStart ?? 12) && P.body.x < (def.spawnEnd ?? def.length - 10)) {
        this.ambientSpawn();
        this.spawnT = (def.spawnInterval ?? 3.6) * (0.7 + Math.random() * 0.6);
      }
      const near = this.enemies.filter((e) => e.alive && Math.abs(e.body.x - P.body.x) < 14).length;
      sound.setMusicIntensity(this.exitOpen ? 1 : Math.min(1, 0.3 + near * 0.18));
    }

    // checkpoints
    for (const c of this.builder.checkpoints) {
      if (this.state === 'play' && P.alive && P.body.onGround && P.body.x > c.x && c.x > this.checkpoint.x) {
        this.checkpoint = { x: c.x, y: c.y };
        if (c.x > def.start.x + 5) { this.hud.toast('CHECKPOINT', 1.4); sound.sfx('objective', { volume: 0.4 }); }
      }
    }
    // first-time prompts
    if (this.tips && this.state === 'play') {
      this.tipT = (this.tipT || 0) + dt;
      const tip = this.tips[0];
      if (tip && this.tipT > tip.at && (!tip.when || tip.when(this))) { this.hud.toast(tip.text, tip.dur || 3.2); this.tips.shift(); }
    }
    // pull the camera back a touch when a crowd is on screen
    const crowd = this.enemies.filter((e) => e.alive && Math.abs(e.body.x - P.body.x) < 16).length;
    if (!this.camRig.override) this.camRig.zoomTarget = P.alive ? (crowd >= 3 ? 0.9 : 1) : this.camRig.zoomTarget;

    // death / respawn
    if (!P.alive) {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        if (this.lives > 0) this.respawn();
        else if (this.state !== 'gameover') { this.state = 'gameover'; sound.playMusic('gameover'); this.saveHi(); setTimeout(() => this.onGameOver && this.onGameOver(), 2200); }
      }
    }

    // exit
    if (this.state === 'play' && this.exitOpen && P.body.x >= this.builder.exitX && P.alive) {
      if (def.boss && !this.bossDone) { /* boss handled by level */ }
      else this.completeLevel();
    }
    if (this.state === 'play' && P.body.x >= this.builder.exitX - 2 && !this.exitOpen && !this.exitNagT) {
      this.exitNagT = 4;
      const need = [];
      if (this.burgers.size < 4) need.push(`${4 - this.burgers.size} BURGER${4 - this.burgers.size > 1 ? 'S' : ''}`);
      if (this.ingrid.state !== 'following') need.push('INGRID');
      if (this.kills < def.quota) need.push(`${def.quota - this.kills} MORE KILLERS`);
      this.hud.banner('NOT YET', 'Still need: ' + need.join(' · '), 2.6);
    }
    if (this.exitNagT) { this.exitNagT -= dt; if (this.exitNagT <= 0) this.exitNagT = 0; }

    // boss arena
    if (def.boss && this.boss && this.exitOpen && !this.bossStarted && P.body.x > def.arena.x0 + 4 && P.alive) this.startBoss();
    if (this.bossActive && this.boss) this.hud.boss(this.boss.name, this.boss.hp / this.boss.maxHp);
    if (this.state === 'finale') this.updateFinale(dt);
    if (this.state === 'outro') this.updateOutro(dt);
    if (this.arenaBurgers) {
      for (const ab of this.arenaBurgers) {
        if (ab.pickup && ab.pickup.taken) { ab.pickup = null; ab.t = 22; }
        if (!ab.pickup && this.bossActive) { ab.t -= dt; if (ab.t <= 0) ab.pickup = this.addPickup('burger', ab.x, ab.y, ab.weapon); }
      }
    }

    // level scripts & props animation
    for (const u of this.builder.updaters) u(dt, this.time);
    this.builder.syncLights();
    if (def.onUpdate) def.onUpdate(this, dt);
    this.updateEmitters(dt);
    if (this.traffic) this.traffic.update(dt);
    if (this.heli) this.heli.update(dt);

    // camera
    const cb = P.body;
    this.camRig.update(rawDt * (this.slowT > 0 ? 0.6 : 1), { x: cb.x, y: cb.y, facing: P.facing, vx: cb.vx, onGround: cb.onGround, climbing: cb.climbing });
    sound.setListenerX(this.camRig.focus.x);
    this.updateAtmosphere(dt);
    this.particles.update(dt);
    this.lights.update(dt, this.camRig.focus, this.time);
    this.updatePointers();
    this.hud.update(rawDt, this.hudState());
  }

  updateEmitters(dt) {
    const fx = this.camRig.focus.x;
    const P = this.particles;
    for (const e of this.builder.emitters) {
      if (Math.abs(e.pos.x - fx) > 26) continue;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const p = e.pos;
        switch (e.type) {
          case 'steam': P.steam(p.x, p.y, p.z); break;
          case 'smoke': P.smoke(p.x, p.y, p.z, { color: [0.18, 0.17, 0.17, 0.4], color1: [0.3, 0.29, 0.29, 0], size: 1, size1: 4, life: 4, vy: 1.4 }); break;
          case 'sparks': if (Math.random() < 0.4) P.sparks(p.x, p.y, p.z, 8); break;
          case 'embers': P.embers(p.x, p.y, p.z, 2, 1.2); break;
          case 'drip': P.splash(p.x, Math.max(0, this.world.groundAt(p.x, p.y)), p.z, 3); break;
          case 'dust': P.dust(p.x, p.y, p.z, 1, [0.8, 0.7, 0.5]); break;
          default: break;
        }
      }
    }
  }

  updateAtmosphere(dt) {
    const cam = this.camRig.cam;
    this.sky.update(dt, cam);
    for (const m of this.skylineMeshes || []) m.userData.update?.(dt);
    // shadow camera follows the action
    const f = this.camRig.focus;
    this.sun.target.position.set(f.x, f.y, 0);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 60);
    let flash = 0;
    if (this.lightning) {
      this.lightning.update(dt, cam);
      flash = this.lightning.level;
      this.sun.intensity = this.sunBase + flash * 6;
      if (flash > 0.8) this.renderer.doFlash('#cfd8ff', 0.08, 10);
    }
    if (this.rain) {
      this.rain.update(dt, cam, flash);
      // ambient splashes on the street around the camera
      const half = this.camRig.visibleHalfWidth();
      for (let i = 0; i < 3; i++) {
        const x = f.x + (Math.random() * 2 - 1) * half;
        const z = Math.random() * 6 - 1;
        const gy = this.world.groundAt(x, 20);
        this.particles.splash(x, z > 0.8 ? 0 : (isFinite(gy) ? gy : 0), z, 2);
      }
    }
    this.particles.setScale(this.renderer.height * this.renderer.pixelRatio / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
  }

  updatePointers() {
    const w = this.renderer.width, h = this.renderer.height;
    const half = this.camRig.visibleHalfWidth();
    const fx = this.camRig.focus.x;
    let target = null, kind = null;
    const ing = this.ingrid;
    if ((ing.state === 'waiting' || ing.state === 'carried') && Math.abs(ing.body.x - fx) > half - 1) { target = ing.body; kind = 'heart'; }
    else if (this.exitOpen && Math.abs(this.builder.exitX - fx) > half - 1) { target = { x: this.builder.exitX, y: 1 }; kind = 'exit'; }
    if (target) {
      const s = this.camRig.toScreen(new THREE.Vector3(target.x, target.y + 1.2, 0), w, h);
      this.hud.arrow(kind, s.x, s.y, w, h);
    } else this.hud.arrow(null);
    // second pointer: the nearest of the four burgers still missing, while it is out of frame
    // (two city burgers sit on rooftops, above the camera's view from the street)
    const b = this.state === 'play' ? this.missingBurger() : null;
    const s = b && this.camRig.toScreen(new THREE.Vector3(b.x, b.y + 0.5, 0), w, h);
    if (s && (s.x < 20 || s.x > w - 20 || s.y < 20 || s.y > h - 20)) this.hud.arrow('burger', s.x, s.y, w, h, 'h-barrow');
    else this.hud.arrow(null, 0, 0, w, h, 'h-barrow');
  }

  missingBurger() {
    const pb = this.player.body;
    let best = null, bd = Infinity;
    for (const p of this.pickups) {
      if (p.kind !== 'burger' || p.taken || this.burgers.has(p.weapon)) continue;
      const d = Math.hypot(p.x - pb.x, p.y - pb.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  hudState() {
    const P = this.player;
    return {
      score: this.score, hi: this.hi, lives: this.lives, grenades: P.grenades, weapon: P.weapon, owned: P.owned,
      quack: P.weapon === 'headbutt' ? 0 : P.weaponTime, pill: P.pill, hp: P.hp, burgers: this.burgers, ingrid: this.ingrid.state,
      kills: this.kills, quota: this.def.quota, level: this.def.hudName || this.def.name, combo: this.combo,
    };
  }

  togglePause() {
    if (this.state === 'play') {
      this.state = 'paused';
      this.hud.$('h-banner').classList.remove('on');
      sound.setMuffle(0.85);
      sound.sfx('pause');
      this.onPause && this.onPause(true);
    } else if (this.state === 'paused') {
      this.state = 'play';
      sound.setMuffle(0);
      this.onPause && this.onPause(false);
    }
  }

  addPickup(kind, x, y, weapon) {
    const p = new Pickup(this, kind, x, y, { weapon });
    this.pickups.push(p);
    return p;
  }

  startBoss() {
    const def = this.def;
    const A = def.arena;
    this.bossStarted = true;
    this.bossActive = true;
    this.world.minX = A.x0 - 1; this.world.maxX = A.x1 + 1;
    this.camRig.setBounds(A.x0 - 3, A.x1 + 3);
    for (const e of this.enemies) if (e.alive && (e.body.x < A.x0 || e.body.x > A.x1)) { e.alive = false; e.remove(); }
    if (this.ingrid.state === 'following') {
      this.ingrid.state = 'hiding';
      this.ingrid.body.x = A.x0 - 0.5; this.ingrid.body.y = 0;
    }
    this.boss.wake();
    this.arenaBurgers = (def.arenaBurgers || []).map((b) => ({ ...b, t: 6, pickup: null }));
    sound.playMusic('boss', { fade: 0.5 });
    sound.sfx('bossLaugh', { x: this.boss.body.x });
    this.hud.banner('THE NIGHT SLASHER', 'He has been waiting for you', 3);
    this.renderer.letterbox = 1;
    this.player.control = false;
    const bx = this.boss.body.x, by = this.boss.body.y;
    this.camRig.override = { pos: new THREE.Vector3(bx - 2, by + 1.8, 7.5), look: new THREE.Vector3(bx, by + 1.7, 0), fov: 28, blendTime: 0.9 };
    setTimeout(() => {
      this.camRig.override = null;
      this.renderer.letterbox = 0;
      this.player.control = true;
    }, 3200);
  }

  bossDefeated(boss) {
    this.state = 'finale';
    this.finaleT = 0;
    this.bossActive = false;
    this.bossDone = true;
    this.hud.boss(null);
    this.player.control = false;
    this.player.body.vx = 0;
    this.slowMo(1.6, 0.3);
    sound.sfx('bossRoar', { x: boss.body.x });
    sound.duck(0.6, 2);
    for (const e of this.enemies) if (e.alive) e.hit(999, { dir: 1, kind: 'explosion' });
    this.renderer.letterbox = 1;
  }

  // The film's ending: a moving hook catches the Night Slasher and carries him into the furnace.
  updateFinale(dt) {
    const B = this.boss;
    const A = this.def.arena;
    this.finaleT += dt;
    const t = this.finaleT;
    const b = B.body;
    const P = this.player;
    const p = B.pose;
    for (const k in p) p[k] = 0;
    const hook = this.finaleHook;
    if (t < 1.4) {
      // staggers back toward the furnace while the hook comes down
      const dir = Math.sign(A.furnaceX - b.x) || 1;
      b.x += dir * 1.6 * dt;
      B.facing = -dir;
      B.rig.setFacing(B.facing);
      p.spineX = -0.3; p.headX = -0.4; p.shLZ = 0.8; p.shRZ = -0.8; p.knLX = 0.3; p.knRX = 0.4;
      B.rig.update(dt, p, 8);
      B.rig.root.position.set(b.x, b.y, 0);
      if (hook) { hook.visible = true; hook.position.set(b.x, 12 - Math.min(1, t / 1.4) * 7.4, 0); }
      if (t > 0.2 && !this.fl1) { this.fl1 = true; sound.sfx('hookChain', { x: b.x }); }
    } else {
      if (!this.fl2) {
        this.fl2 = true;
        sound.sfx('metalHit', { x: b.x, pitch: 0.5 });
        sound.sfx('bossRoar', { x: b.x });
        this.particles.blood(b.x, b.y + 1.4, 0.2, 1, 24);
        this.camRig.shake(0.6);
        this.hud.banner("\u201CYOU'RE THE DISEASE\u2026\u201D", '', 2.2);
        this.hookX0 = b.x;
      }
      // carried up and along to the furnace mouth
      const k = Math.min(1, (t - 1.4) / 4.2);
      const e = k * k * (3 - 2 * k);
      const hx = THREE.MathUtils.lerp(this.hookX0, A.furnaceX, e);
      const hy = 4.6 + Math.sin(e * Math.PI) * 1.2 - (k > 0.85 ? (k - 0.85) * 12 : 0);
      if (hook) hook.position.set(hx, hy, 0);
      b.x = hx; b.y = hy - 1.6;
      Poses.idle(p, t);
      p.spineX = 0.5; p.neckX = 0.4; p.shLX = 0.3; p.shRX = 0.4; p.shLZ = 0.15; p.shRZ = -0.15; p.elLX = -0.2; p.elRX = -0.3;
      p.thLX = Math.sin(t * 3) * 0.2; p.thRX = -Math.sin(t * 3) * 0.2; p.knLX = 0.4; p.knRX = 0.5;
      B.rig.update(dt, p, 6);
      B.rig.root.position.set(b.x, b.y, 0);
      if (Math.random() < 0.6) this.particles.embers(b.x, b.y, 0.3, 1, 0.5);
      if (t > 3.6 && !this.fl3) { this.fl3 = true; this.hud.banner("\u201C\u2026AND I'M THE CURE.\u201D", '', 2.6); }
      if (k >= 1 && !this.fl4) {
        this.fl4 = true;
        B.rig.root.visible = false;
        if (hook) hook.visible = false;
        this.particles.explosion(A.furnaceX, 2.2, 0.5, 2.2);
        this.lights.flash(A.furnaceX, 3, 3, '#ff7a20', 600, 30, 1.2);
        this.renderer.doFlash('#ffb070', 0.5, 2);
        this.camRig.shake(0.9);
        sound.sfx('furnaceRoar');
        sound.sfx('explosion');
      }
    }
    // camera: wide dramatic angle on the action
    const cx = (P.body.x + b.x) / 2;
    this.camRig.override = { pos: new THREE.Vector3(cx - 3, 3.2, 15), look: new THREE.Vector3(b.x, Math.max(2, b.y + 1), 0), fov: 32, blendTime: 1.2 };
    // Cobretti watches; Ingrid runs to him
    const pp = P.tmp;
    for (const k2 in pp) pp[k2] = 0;
    Poses.idle(pp, t, 0);
    P.facing = Math.sign(b.x - P.body.x) || 1;
    P.scripted = true;
    P.scriptPose = pp;
    P.scriptPos = new THREE.Vector3(P.body.x, P.body.y, 0);
    P.scriptYaw = null;
    P.rig.setFacing(P.facing);
    if (t > 6.5 && this.ingrid.state === 'hiding') {
      // she runs to Cobretti (quietly — the moment belongs to the finale)
      this.ingrid.state = 'following';
      this.ingrid.trail.length = 0;
      this.ingrid.trail.push({ x: this.ingrid.body.x, y: 0, c: false, gr: true }, { x: P.body.x, y: P.body.y, c: false, gr: true });
      sound.sfx('ingridThanks');
    }
    if (t > 9 && !this.fl5) {
      this.fl5 = true;
      this.state = 'victory';
      this.addScore(25000, P.body.x, P.body.y + 2.5);
      this.saveHi();
      this.renderer.letterbox = 0;
      setTimeout(() => this.onVictory && this.onVictory(), 1500);
    }
  }

  completeLevel() {
    this.state = 'outro';
    this.outroT = 0;
    const P = this.player;
    P.control = false;
    this.saveHi();
    const bonus = 2000 + Math.max(0, Math.round(P.hp)) * 20;
    this.outroStats = { kills: this.kills, time: this.time, bonus };
    this.addScore(bonus);
    sound.playMusic('levelclear');
    this.hud.banner('SECTION COMPLETE', this.def.outroText || 'Ingrid is safe — for now', 3);
    setTimeout(() => this.hud.show(false), 2600);
    for (const e of this.enemies) if (e.alive) { e.alive = false; e.remove(); }
    this.renderer.letterbox = 1;
  }

  // Exit cinematic: Cobra (and Ingrid) walk to the Mercury, climb in, and it pulls away.
  updateOutro(dt) {
    const P = this.player;
    const car = this.exitCar;
    this.outroT += dt;
    const t = this.outroT;
    const tx = car ? car.position.x - 0.4 : P.body.x + 30;
    const pp = P.tmp;
    for (const k in pp) pp[k] = 0;
    P.scripted = true;
    P.scriptPose = pp;
    P.scriptYaw = null;
    const b = P.body;
    if (!this.outroIn) {
      const dx = tx - b.x;
      if (Math.abs(dx) > 0.15 && t < 6) {
        b.x += Math.sign(dx) * Math.min(Math.abs(dx), 4.2 * dt);
        P.facing = Math.sign(dx);
        P.runPhase += dt * 4.2 * (2 * Math.PI / 3.1);
        Poses.walk(pp, P.runPhase, 1);
      } else {
        this.outroIn = true;
        this.outroInT = t;
        if (car) { car.userData.setDoor?.(1, 'L'); sound.sfx('carDoor'); }
      }
      P.scriptPos = new THREE.Vector3(b.x, b.y, Math.min(1, t * 0.3) * (car ? car.position.z - 1.4 : 0));
    } else {
      const k = t - this.outroInT;
      Poses.idle(pp, t);
      P.scriptVisible = k < 0.7;
      if (this.ingrid.state === 'following' && k > 0.9) { this.ingrid.state = 'hidden'; this.ingrid.rig.root.visible = false; }
      if (car) {
        if (k > 1.0 && !this.outroDoor) { this.outroDoor = true; car.userData.setDoor?.(0, 'L'); sound.sfx('carDoor'); }
        if (k > 1.6 && !this.outroEngine) { this.outroEngine = true; sound.sfx('engineIdle'); car.userData.setLights?.(true); }
        if (k > 2.2) {
          const v = Math.min(18, (k - 2.2) * 9);
          car.position.x += v * dt;
          for (const n of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) { const w = car.getObjectByName(n); if (w) w.rotation.z -= v * dt / 0.36; }
          if (Math.random() < 0.7) this.particles.splash(car.position.x - 2.4, 0, car.position.z, 3);
        }
      }
    }
    const fx = car ? Math.min(car.position.x, (this.builder.exitX || b.x) + 8) : b.x;
    this.camRig.override = { pos: new THREE.Vector3(fx - 6, 2.2, 12), look: new THREE.Vector3(fx, 1.2, 0), fov: 32, blendTime: 1.5 };
    if (t > 7.5 && !this.outroDone) {
      this.outroDone = true;
      this.renderer.fade = 0;
      this.onLevelComplete && this.onLevelComplete(this.outroStats);
    }
    if (t > 6.2) this.renderer.fade = Math.min(1, (t - 6.2) / 1.2);
  }

  saveHi() {
    try { localStorage.setItem('cobra.hi', String(this.hi)); } catch (e) { /* storage blocked */ }
  }

  // ------------------------------------------------------------ render
  render(rawDt) {
    if (!this.scene || this.loading) return;
    const cam = this.camRig.cam;
    this.scene.updateMatrixWorld();
    if (this.wet && !this.renderOnly) this.wet.update(this.dt || rawDt, this.scene, cam);
    this.renderer.render(this.scene, cam, rawDt);
  }
}
