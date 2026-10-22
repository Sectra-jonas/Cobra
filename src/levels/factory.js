// LEVEL 3 — THE FACTORY. A steel mill at night: conveyor lines, molten pits, the
// furnace hall, the crane bay and the pour floor where the Night Slasher waits.
import * as THREE from 'three';
import { mat, solid, box, hazard } from '../core/materials.js';
import * as TX from '../core/textures.js';
import { Boss } from '../game/boss.js';
import { sound } from '../core/sound.js';

const T1 = 3.2, T2 = 6.4, T3 = 9.6;
const ARENA = { x0: 199, x1: 241, furnaceX: 239, hookY: 11 };

function ladder(L, x, y0, y1, z = -0.4) {
  if (L.has('makeLadderSteel')) {
    const m = L.prop('makeLadderSteel', { height: y1 - y0 });
    m.position.set(x, y0, z);
    L.scene.add(m);
    const rails = m.userData.ladders?.[0];
    L.ladderVis.set(L.world.addLadder(x, y0, y1), { z: z + (rails?.z ?? 0), w: rails?.w ?? 0.48 });
  } else L.ladder(x, y0, y1, { z });
}

function catwalk(L, x0, x1, y, o = {}) {
  const len = x1 - x0;
  if (L.has('makeCatwalk')) {
    L.place('makeCatwalk', (x0 + x1) / 2, 0, 0, { opts: { length: len, y, ...o } });
    if (L.has('makeCatwalkSupport') && o.supports !== false) {
      for (let x = x0 + 1; x <= x1 - 0.9; x += Math.max(4, len / Math.ceil(len / 6))) L.place('makeCatwalkSupport', x, 0, 0, { opts: { height: y } });
    }
  } else L.block(x0, x1, y - 0.12, y, -0.6, 0.6, 'diamondPlate', { ledge: true });
}

export default {
  id: 'factory',
  name: 'LEVEL 3 — THE FACTORY',
  subtitle: 'THE STEEL MILL · WHERE THE NIGHT SLASHER WAITS',
  location: 'HAYDEN STEEL MILL No. 4 · 2:13 AM',
  locationSub: "THE NEW WORLD'S NEST",
  hudName: 'L3 · THE FACTORY',
  length: 244,
  start: { x: 4, y: 0 },
  quota: 20,
  rain: false,
  lightning: false,
  metalFloor: true,
  wet: { strength: 0.3, coverage: 0.22 },
  fog: { color: '#120907', density: 0.017 },
  sky: { top: '#030202', horizon: '#241008', bottom: '#050302', glow: '#ff5a1a', glowAmt: 0.5, moon: false, sunDir: [0, -1, 0], sunColor: '#000000', sunSize: 0.9999, stars: 0, clouds: 0 },
  hemi: { sky: '#4a3430', ground: '#1e0f08', intensity: 1.9 },
  sun: { color: '#7f9cff', intensity: 2.6, dir: [-0.2, 0.95, -0.25] },
  fill: { color: '#ff6a20', intensity: 0.35, dir: [0.4, 0.2, 0.8] },
  accents: { color: '#e0a868' },
  rim: { color: '#ff7a30', strength: 0.36 },
  envIntensity: 0.7,
  env: { bg: '#0a0504', room: '#120806', panels: [
    { color: '#ff6a10', w: 12, h: 3, pos: [0, -2, -8], i: 4 }, { color: '#ffb040', w: 4, h: 4, pos: [8, 2, 2], i: 3 },
    { color: '#6a8aff', w: 10, h: 2, pos: [-4, 8, -6], i: 1.5 },
  ] },
  grade: { exposure: 1.12, lift: [0.02, 0.008, 0.0], gain: [1.06, 0.97, 0.9], gamma: [1, 1, 1], sat: 1.12, contrast: 1.1, vignette: 0.55, grain: 0.06, ca: 0.0018, heat: 0.55, bloom: { strength: 0.85, radius: 0.55, threshold: 0.8 } },
  skyline: [],
  music: 'factory',
  ambience: 'factory',
  enemyPool: [['axeman', 4], ['thug', 3], ['knifer', 2], ['gunner', 2], ['bomber', 1.4], ['bazooka', 1], ['grabber', 0.6]],
  maxAlive: 4,
  spawnInterval: 3.3,
  safeStart: 12,
  spawnEnd: 192,
  ingridTrigger: 110,
  boss: true,
  final: true,
  arena: ARENA,
  arenaBurgers: [{ x: 201.5, y: T1, weapon: 'pistol' }, { x: 230.5, y: T1, weapon: 'smg' }],
  exitText: 'The gate to the pour floor is open — the Night Slasher waits',

  build(L, game) {
    const S = L.scene;

    // ---------------------------------------------------------- floor, roof, walls
    const floorSet = TX.metalPlate({ color: '#4a4b4d', seed: 37, rust: 0.45, diamond: false });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorSet.map, normalMap: floorSet.normalMap, metalness: 0.25, roughness: 0.78, color: '#9a948c' });
    const fg = new THREE.PlaneGeometry(300, 40);
    fg.rotateX(-Math.PI / 2);
    const fuv = fg.attributes.uv, fp = fg.attributes.position;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, (fp.getX(i) + 150) / 4, (fp.getZ(i) + 20) / 4);
    const floor = new THREE.Mesh(fg, floorMat);
    floor.position.set(120, 0, 16);
    floor.receiveShadow = true;
    S.add(floor);
    L.wetMeshes = [floor];
    L.solid(-40, 290, -6, 0);
    // painted safety walkway lines
    const lineMat = new THREE.MeshStandardMaterial({ color: '#c79a16', roughness: 0.6 });
    for (const z of [1.6, 2.8]) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(300, 0.1), lineMat);
      ln.rotation.x = -Math.PI / 2;
      ln.position.set(120, 0.004, z);
      S.add(ln);
    }
    // back wall
    for (let x = -12; x < 260; x += 24) {
      if (L.has('makeFactoryWall')) L.place('makeFactoryWall', x + 12, 0, -3.4, { opts: { width: 24, height: 16, seed: Math.floor(x) + 50 } });
      else L.block(x, x + 24, 0, 16, -4, -3.4, 'corrugated');
    }
    // roof & trusses
    const roof = new THREE.Mesh(new THREE.BoxGeometry(320, 0.6, 40), solid('#0b0907', 0.9));
    roof.position.set(120, 19, 0);
    S.add(roof);
    const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.5, 30), mat('steelPainted'), 30);
    const chordGeo = new THREE.BoxGeometry(0.3, 2.6, 0.3);
    const chords = new THREE.InstancedMesh(chordGeo, mat('steelPainted'), 60);
    const dm = new THREE.Object3D();
    for (let i = 0; i < 30; i++) {
      dm.position.set(-10 + i * 10, 17.4, 0); dm.rotation.set(0, 0, 0); dm.updateMatrix(); truss.setMatrixAt(i, dm.matrix);
      for (const z of [-6, 6]) { dm.position.set(-10 + i * 10, 18, z); dm.rotation.set(0, 0, 0.5); dm.updateMatrix(); chords.setMatrixAt(i * 2 + (z > 0 ? 1 : 0), dm.matrix); }
    }
    S.add(truss, chords);
    const runway = new THREE.Mesh(box(320, 0.7, 0.5, 2), mat('steelPainted'));
    runway.position.set(120, 15.2, -2.2);
    S.add(runway);
    // drifting embers & dust all along the hall
    for (let x = 0; x < 244; x += 7) { L.emitter('embers', x, 0.4, 1.5 + (x % 3), 0.6); L.emitter('dust', x + 3, 6, -1, 0.4); }

    // ---------------------------------------------------------- 1. shipping bay (0–40)
    L.checkpoint(4);
    if (L.has('makeCrateStack')) L.place('makeCrateStack', 13, 0, 0, { opts: { cols: 3, seed: 3 } });
    else { L.block(11, 13, 0, 1.2, -0.6, 0.6, 'woodWeathered', { solid: true }); L.block(13, 15, 0, 2.4, -0.6, 0.6, 'woodWeathered', { solid: true }); }
    catwalk(L, 18, 30, T1);
    ladder(L, 30.8, 0, T1);
    L.burger(24, T1, 'knife');
    if (L.has('makePipes')) L.place('makePipes', 8, 0, -1.6, { opts: { length: 10, count: 4, y: 1.2, walkable: false, seed: 2 } });
    if (L.has('makeControlBooth')) L.place('makeControlBooth', 36, 0, -1.9);
    else L.block(34, 38.2, 0, T1, -3, -0.8, 'corrugated', { ledge: true });
    if (L.has('makeWarningLight')) { L.place('makeWarningLight', 10, 0, -0.6, { lightScale: 0.35, opts: { pole: 3.4 } }); L.place('makeWarningLight', 40, 0, -0.6, { lightScale: 0.35, opts: { pole: 3.4 } }); }
    L.door(6);
    L.encounter(16, [{ type: 'axeman', dx: 16 }, { type: 'thug', x: 6, emerge: true, delay: 1.5 }]);

    // ---------------------------------------------------------- 2. conveyor line (40–90)
    L.checkpoint(42);
    if (L.has('makeConveyor')) {
      L.place('makeConveyor', 48, 0, 0, { opts: { length: 12, height: 1.1, speed: 1.4, cargo: 4 } });
      L.place('makeConveyor', 72, 0, 0, { opts: { length: 12, height: 1.1, speed: -1.6, cargo: 3 } });
    } else { L.block(42, 54, 0.9, 1.1, -0.6, 0.6, 'rubber', { ledge: true }); L.block(66, 78, 0.9, 1.1, -0.6, 0.6, 'rubber', { ledge: true }); }
    if (L.has('makeMoltenPool')) L.place('makeMoltenPool', 60.2, 0, 0, { opts: { width: 4.6, depth: 3 } });
    else L.world.addHazard(58, 62.4, -1, 0.6, 'molten');
    if (L.has('makeLadle')) L.place('makeLadle', 60, 0, -5.2, { colliders: false, opts: { tilt: 0.6, hangY: 7.5 } });
    if (L.has('makeMoltenPool')) L.place('makeMoltenPool', 60.5, 0, -5.2, { colliders: false, opts: { width: 6, depth: 2.5 } });
    catwalk(L, 45, 59, T2);
    catwalk(L, 61, 76, T2);
    ladder(L, 44.4, 0, T2);
    ladder(L, 76.8, T1 - T1, T2);
    L.burger(69, T2, 'pistol');
    L.light(60, 2.2, 1.5, '#ff6a18', 90, 12, { flicker: 0.1 });
    L.encounter(46, [{ type: 'bomber', x: 66, y: T2 + 0.05 }, { type: 'knifer', dx: 18, delay: 0.8 }]);
    L.encounter(70, [{ type: 'thug', dx: 14 }, { type: 'axeman', dx: -12, delay: 1.2 }, { type: 'gunner', x: 52, y: T2 + 0.05, delay: 2 }]);

    // ---------------------------------------------------------- 3. furnace hall (90–140)
    L.checkpoint(88);
    if (L.has('makeTank')) L.place('makeTank', 92, 0, -1.8, { opts: { radius: 1.8, height: 6 } });
    if (L.has('makeFurnace')) L.place('makeFurnace', 106, 0, -3.1, { opts: { width: 10, height: 13 } });
    else L.block(101, 111, 0, 12, -5, -0.6, 'brickDark');
    // deck height of the furnace's charging deck is ~6.4 (tier) — burger up there
    L.burger(101.6, T2, 'smg');
    catwalk(L, 113, 120, T1);
    ladder(L, 113.4, 0, T1);
    if (L.has('makeIngots')) { L.place('makeIngots', 117, 0, 0, { opts: { hot: false, layers: 3, seed: 4 } }); L.place('makeIngots', 119.5, 0, -2.4, { colliders: false, opts: { hot: true, layers: 4, seed: 6 } }); }
    if (L.has('makeMoltenPool')) L.place('makeMoltenPool', 127, 0, 0, { opts: { width: 6, depth: 3 } });
    else L.world.addHazard(124, 130, -1, 0.6, 'molten');
    catwalk(L, 122, 133, T1);
    ladder(L, 133.6, 0, T1);
    L.ingrid(127, T1);
    L.encounter(96, [{ type: 'axeman', dx: 14 }, { type: 'axeman', dx: 17, delay: 0.5 }, { type: 'bazooka', x: 116, y: T1 + 0.05, delay: 1.5 }]);
    L.encounter(120, [{ type: 'grabber', dx: 14 }, { type: 'thug', dx: -12, delay: 1 }]);

    // ---------------------------------------------------------- 4. crane bay (140–196)
    L.checkpoint(138);
    catwalk(L, 140, 156, T2);
    ladder(L, 139.4, 0, T2);
    if (L.has('makeGantryCrane')) L.place('makeGantryCrane', 152, 0, -0.2, { opts: { span: 22, y: T3, hookY: 4, trolleyX: 4 } });
    else L.block(141, 163, T3 - 0.8, T3, -0.4, 0.4, 'safetyYellow', { ledge: true });
    ladder(L, 155.4, T2, T3);
    L.burger(146, T3, 'pill');
    catwalk(L, 158, 170, T1);
    ladder(L, 170.6, 0, T1);
    if (L.has('makePipes')) L.place('makePipes', 168, 0, -1.6, { opts: { length: 14, count: 5, y: 1.0, walkable: false, seed: 7 } });
    if (L.has('makeCrateStack')) { L.place('makeCrateStack', 175, 0, 0, { opts: { cols: 2, seed: 8 } }); L.place('makeCrateStack', 180, 0, 0, { opts: { cols: 3, seed: 11, drums: false } }); }
    if (L.has('makeMoltenPool')) L.place('makeMoltenPool', 186.3, 0, 0, { opts: { width: 4.4, depth: 3 } });
    else L.world.addHazard(184, 188.6, -1, 0.6, 'molten');
    if (L.has('makeControlBooth')) L.place('makeControlBooth', 192, 0, -1.9);
    L.ingrid(176, 0);
    if (L.has('makeWarningLight')) { L.place('makeWarningLight', 160, 0, -0.6, { lightScale: 0.35, opts: { pole: 3.6 } }); L.place('makeWarningLight', 194, 0, -0.6, { lightScale: 0.35, opts: { pole: 4, color: '#ff2a1a' } }); }
    L.encounter(150, [{ type: 'bomber', x: 166, y: T1 + 0.05 }, { type: 'axeman', dx: 15, delay: 0.6 }, { type: 'gunner', x: 146, y: T2 + 0.05, delay: 1.4 }]);
    L.encounter(178, [{ type: 'thug', dx: 12 }, { type: 'axeman', dx: 14, delay: 0.7 }, { type: 'knifer', dx: -12, delay: 1.5 }], { lock: 12, banner: 'THEY KNOW YOU\'RE HERE', sub: 'Clear the bay' });

    // ---------------------------------------------------------- the gate
    const gateMat = mat('corrugatedRed');
    const gate = new THREE.Mesh(box(1.0, 7, 4, 2), gateMat);
    gate.position.set(197, 3.5, 0);
    gate.castShadow = true;
    S.add(gate);
    const frame = new THREE.Mesh(box(1.6, 0.6, 4.4, 1), hazard());
    frame.position.set(197, 7.3, 0);
    S.add(frame);
    const gateSolid = L.solid(196.5, 197.5, 0, 7.6);
    L.light(197, 6, 2, '#ff2a1a', 30, 10, { pulse: 5 });
    L.exit(195);
    let gateOpen = 0;
    L.update((dt) => {
      if (game.exitOpen && gateOpen < 1) {
        if (gateOpen === 0) { sound.sfx('alarm'); sound.sfx('hookChain', { x: 197 }); }
        gateOpen = Math.min(1, gateOpen + dt * 0.35);
        gate.position.y = 3.5 + gateOpen * 6.5;
        if (gateOpen > 0.5 && L.world.solids.includes(gateSolid)) L.world.removeSolid(gateSolid);
      }
    });

    // ---------------------------------------------------------- arena: the pour floor
    catwalk(L, 200, 209, T1);
    ladder(L, 209.6, 0, T1);
    catwalk(L, 221, 231, T1);
    ladder(L, 220.4, 0, T1);
    if (L.has('makeFurnace')) L.place('makeFurnace', ARENA.furnaceX + 2, 0, -3.1, { opts: { width: 10, height: 14, ladder: false } });
    if (L.has('makeHookConveyor')) L.place('makeHookConveyor', 220, 0, -0.4, { opts: { length: 36, count: 8, y: 13.5, chain: 2.6, speed: 1.2 } });
    if (L.has('makeWarningLight')) { L.place('makeWarningLight', 203, 0, -0.6, { lightScale: 0.35, opts: { pole: 5 } }); L.place('makeWarningLight', 228, 0, -0.6, { lightScale: 0.35, opts: { pole: 5, color: '#ff2a1a' } }); }
    if (L.has('makeIngots')) L.place('makeIngots', 214, 0, -2.6, { colliders: false, opts: { hot: true, layers: 3, seed: 9 } });
    L.light(215, 7, 2, '#ff4a12', 80, 18, { flicker: 0.2 });
    // the finale hook (lowered during the ending)
    const fh = L.has('makeChainHook') ? L.prop('makeChainHook', { length: 3, top: 3.2, swing: 0.0 }) : null;
    if (fh) { fh.visible = false; S.add(fh); game.finaleHook = fh; }
    // the Night Slasher waits on the right-hand catwalk
    game.boss = new Boss(game, 226, T1 + 0.05, ARENA);
  },
};
