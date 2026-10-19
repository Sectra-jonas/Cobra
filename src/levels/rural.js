// LEVEL 2 — THE RURAL AREA (day). Golden hour outside the small town of Hayden:
// a gas station, a farm with a red barn and hay stacks, corn fields, the water tower,
// and the roadside motel where the gang makes its stand.
import * as THREE from 'three';
import { mat, solid, box, neonMat } from '../core/materials.js';
import * as TX from '../core/textures.js';

const T1 = 3.2;

// Rolling hills as a camera-facing strip with a noisy ridge line.
function hills(L, { z, height, base = 0, color, seed, x0 = -120, x1 = 420, rough = 1 }) {
  const n = 220;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    const u = i / n;
    const h = base + height * (0.45 + 0.55 * TX.fbm(u * 6 * rough, seed * 0.37, 64, 5, seed));
    pts.push([x, h]);
  }
  const pos = [], idx = [];
  pts.forEach(([x, h], i) => { pos.push(x, h, 0, x, -4, 0); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  m.position.z = z;
  L.scene.add(m);
  return m;
}

function groundStrip(L, z0, z1, material, uvScale = 4, y = 0) {
  const g = new THREE.PlaneGeometry(420, z1 - z0);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 210) / uvScale, (p.getZ(i) + (z1 - z0) / 2) / uvScale);
  const m = new THREE.Mesh(g, material);
  m.position.set(150, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  L.scene.add(m);
  return m;
}

function motelFallback(L, x, w) {
  const S = L.scene;
  const x0 = x - w / 2, x1 = x + w / 2;
  L.block(x0, x1, 0, 6.6, -9, -1.4, 'stuccoWhite');
  L.block(x0, x1, 3.05, 3.25, -1.4, 0.9, 'woodDark', { ledge: true });
  L.block(x0 - 0.3, x1 + 0.3, 6.6, 6.9, -9.3, -1.1, 'concreteDark');
  for (let i = 0; i < Math.floor(w / 3.4); i++) {
    for (const y of [0, T1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), solid(['#7a2a1a', '#2a4a6a', '#2a5a3a'][i % 3], 0.6));
      d.position.set(x0 + 1.7 + i * 3.4, y + 1.05, -1.38);
      S.add(d);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffc070', emissiveIntensity: (i + y) % 3 === 0 ? 1.2 : 0.15 }));
      w2.position.set(x0 + 2.9 + i * 3.4, y + 1.5, -1.38);
      S.add(w2);
    }
  }
  L.ladder(x1 - 0.8, 0, T1);
  const nm = neonMat('MOTEL', { color: '#ff3a5a', border: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * nm.userData.aspect, 1.3), nm);
  sign.position.set(x0 + 3, 8.2, -1.0);
  S.add(sign);
  L.light(x0 + 3, 8, 0.5, '#ff3a5a', 40, 12, { flicker: 0.1 });
}

export default {
  id: 'rural',
  name: 'LEVEL 2 — THE RURAL AREA',
  subtitle: 'GOLDEN HOUR · HAYDEN COUNTY · THEY FOLLOWED YOU OUT OF TOWN',
  location: 'HAYDEN COUNTY · 6:52 PM',
  locationSub: '83 MILES NORTH OF L.A.',
  hudName: 'L2 · RURAL AREA',
  length: 292,
  start: { x: 4, y: 0 },
  quota: 25,
  rain: false,
  lightning: false,
  dusty: true,
  wet: null,
  fog: { color: '#d9a77c', density: 0.0052 },
  sky: { top: '#2f5f9e', horizon: '#ffb47a', bottom: '#b8805a', glow: '#ff8a3a', glowAmt: 0.55, moon: false, sunDir: [-0.42, 0.2, -0.88], sunColor: '#fff0c8', sunSize: 0.99935, stars: 0, clouds: 0.6, cloudColor: '#8f6a8a', cloudLit: '#ffd59a' },
  hemi: { sky: '#9cc2ff', ground: '#8a6a40', intensity: 1.35 },
  sun: { color: '#ffd29a', intensity: 3.3, dir: [-0.42, 0.42, -0.8] },
  fill: { color: '#7fa6ff', intensity: 0.45, dir: [0.5, 0.4, 0.8] },
  rim: { color: '#ffb46a', strength: 0.42 },
  envIntensity: 0.9,
  env: { bg: '#9fb8d8', room: '#6a5a48', panels: [{ color: '#ffd090', w: 20, h: 4, pos: [-6, 3, -8], i: 2.4 }, { color: '#8ab4ff', w: 30, h: 10, pos: [0, 10, 4], i: 1.2 }] },
  grade: { exposure: 1.0, lift: [0.01, 0.005, 0.0], gain: [1.06, 1.0, 0.92], gamma: [1, 1, 1], sat: 1.08, contrast: 1.06, vignette: 0.4, grain: 0.045, ca: 0.0012, heat: 0.12, bloom: { strength: 0.55, radius: 0.5, threshold: 0.92 } },
  skyline: [],
  music: 'rural',
  ambience: 'wind',
  enemyPool: [['thug', 3.5], ['biker', 2], ['knifer', 2.5], ['gunner', 2], ['axeman', 1.6], ['granny', 1.2], ['bazooka', 1.2], ['grabber', 0.8], ['bomber', 0.8]],
  maxAlive: 4,
  spawnInterval: 3.3,
  safeStart: 14,
  ingridTrigger: 105,
  exitText: 'The Mercury is waiting past the motel',
  outroText: 'Next stop: the steel mill',
  traffic: { kinds: ['makePickupTruck', 'makeSedan80s', 'makePickupTruck'], lanes: [{ z: 9.5, dir: 1, speed: 18 }, { z: 5, dir: -1, speed: 16 }], interval: [8, 16], lights: false, dust: true },

  build(L, game) {
    const S = L.scene;

    // ---------------------------------------------------------- ground bands
    const dirtSet = TX.dirt({ seed: 91, color: '#8a6a48' });
    const dirtMat = new THREE.MeshStandardMaterial({ map: dirtSet.map, normalMap: dirtSet.normalMap, roughness: 1, color: '#e8d2b8' });
    groundStrip(L, -2.2, 2.2, dirtMat, 5);
    const asphalt = TX.asphalt({ seed: 17 });
    const roadMat = new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.roughnessMap, color: '#c9c2b8', roughness: 1 });
    groundStrip(L, 2.2, 12, roadMat, 7, -0.02);
    const lane = new THREE.MeshStandardMaterial({ color: '#d9b030', roughness: 0.7 });
    for (const z of [7.0, 7.25]) { const ln = new THREE.Mesh(new THREE.PlaneGeometry(420, 0.12), lane); ln.rotation.x = -Math.PI / 2; ln.position.set(150, -0.015, z); S.add(ln); }
    const grassSet = TX.grass({ seed: 81, dry: 0.65 });
    const grassMat = new THREE.MeshStandardMaterial({ map: grassSet.map, normalMap: grassSet.normalMap, roughness: 1, color: '#f0e0b0' });
    groundStrip(L, -80, -2.2, grassMat, 6);
    groundStrip(L, 12, 60, grassMat, 6, -0.03);
    L.solid(-60, 360, -6, 0);

    // ---------------------------------------------------------- distant landscape
    hills(L, { z: -380, height: 70, base: 10, color: '#8a7aa8', seed: 3, rough: 0.6 });
    hills(L, { z: -210, height: 30, base: 4, color: '#9a8a70', seed: 7, rough: 0.9 });
    hills(L, { z: -110, height: 14, base: 1, color: '#8a8a48', seed: 11, rough: 1.4 });
    hills(L, { z: -55, height: 6, base: 0, color: '#7a7a3a', seed: 13, rough: 2.2 });
    // tree lines and poplars on the middle distance
    if (L.has('makeTree')) {
      for (let i = 0; i < 26; i++) {
        const x = -30 + i * 14 + (i * 37 % 9);
        L.place('makeTree', x, 0, -38 - (i % 3) * 6, { opts: { kind: i % 4 === 0 ? 'poplar' : 'oak', seed: 100 + i, scale: 1.1 + (i % 3) * 0.2 }, colliders: false, shadows: false });
      }
    }
    // corn behind the farm
    if (L.has('makeCornRows')) {
      for (let x = 98; x < 160; x += 12) L.place('makeCornRows', x, 0, -5.5, { opts: { width: 12, rows: 6, seed: x }, colliders: false });
      for (let x = 30; x < 50; x += 12) L.place('makeCornRows', x, 0, -6, { opts: { width: 12, rows: 5, seed: x }, colliders: false });
    }
    // telephone line along the road
    if (L.has('makeTelephonePole')) for (let x = -12; x < 300; x += 24) L.place('makeTelephonePole', x, 0, -2.6, { opts: { height: 9, span: 24, withWires: true, transformer: x % 72 === 0, lamp: x % 48 === 12, seed: x }, colliders: false });
    for (let x = 0; x < 290; x += 9) L.emitter('dust', x, 0.8 + (x % 5) * 0.4, 1.5, 0.35);

    // ---------------------------------------------------------- 1. gas station (0–40)
    L.checkpoint(4);
    if (L.has('makePickupTruck')) L.place('makePickupTruck', 6.2, 0, 0, { opts: { seed: 2 } });
    else L.block(3.5, 8.8, 0, 1.86, -1, 1, 'rustMetal', { ledge: true });
    if (L.has('makeGasStation')) L.place('makeGasStation', 19.5, 0, -3.5, { opts: { seed: 16 } });
    else { L.block(10, 16.5, 0, 3.6, -6, -0.5, 'stuccoWhite', { ledge: true }); L.block(18, 27, 4.6, 4.8, -2, 2, 'steelPainted', { ledge: true }); }
    L.burger(24, 4.8, 'knife');
    if (L.has('makeMailboxRural')) L.place('makeMailboxRural', 33, 0, -1.4);
    L.encounter(16, [{ type: 'thug', dx: 16 }, { type: 'biker', x: 60, facing: -1, delay: 1.5 }]);

    // ---------------------------------------------------------- 2. the farm (40–100)
    L.checkpoint(40);
    if (L.has('makeWoodFence')) for (let x = 38; x < 100; x += 6) L.place('makeWoodFence', x + 3, 0, -2.1, { opts: { width: 6, seed: x }, colliders: false });
    if (L.has('makeHayBales')) L.place('makeHayBales', 50, 0, 0, { opts: { kind: 'square', count: 4, rows: 3, stair: 'right', seed: 4 } });
    else { L.block(47.6, 52.4, 0, 0.6, -0.6, 0.6, 'hay', { solid: true }); L.block(48.8, 52.4, 0.6, 1.2, -0.6, 0.6, 'hay', { solid: true }); L.block(50, 52.4, 1.2, 1.8, -0.6, 0.6, 'hay', { solid: true }); }
    if (L.has('makeBarn')) {
      const barn = L.place('makeBarn', 60, 0, -6.3, { opts: { width: 12, height: 8, depth: 10, leanTo: true, seed: 1 } });
      const loftY = barn?.userData?.loftY ?? 4.16;
      L.burger(59.5, loftY, 'pistol');
    } else {
      L.block(54, 66, 0, 8, -11.3, -1.3, 'woodBarnRed');
      L.block(56.7, 61.25, 4.0, 4.16, -1.3, 0.4, 'woodDark', { ledge: true });
      L.ladder(55.5, 0, 4.16);
      L.burger(59.5, 4.16, 'pistol');
    }
    if (L.has('makeHayBales')) L.place('makeHayBales', 79, 0, 0, { opts: { kind: 'round', count: 3, rows: 2, seed: 7 } });
    if (L.has('makeWindmill')) L.place('makeWindmill', 90, 0, -0.6, { opts: { height: 10, seed: 4 } });
    else { L.block(88.9, 91.1, 7.2, 7.4, -0.6, 0.6, 'ironBlack', { ledge: true }); L.ladder(90, 0, 7.4); }
    if (L.has('makeTree')) L.place('makeTree', 97, 0, -0.4, { opts: { kind: 'oak', seed: 21, scale: 1 } });
    L.door(62);
    L.encounter(46, [{ type: 'granny', dx: 16 }, { type: 'knifer', x: 60, y: 4.2, delay: 1 }]);
    L.encounter(76, [{ type: 'axeman', dx: 15 }, { type: 'gunner', x: 90, y: 7.45, delay: 0.6 }, { type: 'thug', x: 62, emerge: true, delay: 1.6 }]);

    // ---------------------------------------------------------- 3. the fields (100–150)
    L.checkpoint(100);
    if (L.has('makeShed')) {
      L.place('makeShed', 108, 0, -2.3, { opts: { width: 6, height: 4, depth: 4, seed: 2 } });
      L.place('makeShed', 125, 0, -2.3, { opts: { width: 7, height: 4, depth: 4, seed: 5 } });
    } else {
      L.block(105, 111, 0, 4, -4.3, -0.3, 'woodWeathered', { ledge: true }); L.ladder(110.5, 0, 4);
      L.block(121.5, 128.5, 0, 4, -4.3, -0.3, 'woodWeathered', { ledge: true }); L.ladder(128, 0, 4);
    }
    if (L.has('makeHayBales')) L.place('makeHayBales', 116.5, 0, 0, { opts: { kind: 'square', count: 4, rows: 3, stair: 'pyramid', seed: 9 } });
    if (L.has('makeTractor')) L.place('makeTractor', 134, 0, 0, { opts: { seed: 3 } });
    if (L.has('makeHedge')) L.place('makeHedge', 143, 0, -0.2, { opts: { width: 6, height: 1.5, seed: 9 } });
    if (L.has('makeRocks')) L.place('makeRocks', 149, 0, 0, { opts: { seed: 12 } });
    L.ingrid(125, 4);
    L.encounter(112, [{ type: 'biker', x: 150, facing: -1 }, { type: 'bazooka', x: 108, y: 4.05, delay: 0.8 }, { type: 'thug', dx: 14, delay: 1.4 }]);
    L.encounter(138, [{ type: 'grabber', dx: 14 }, { type: 'knifer', dx: 17, delay: 0.6 }]);

    // ---------------------------------------------------------- 4. water tower & silo (150–200)
    L.checkpoint(152);
    if (L.has('makePickupTruck')) L.place('makePickupTruck', 156, 0, 0, { opts: { seed: 9 } });
    if (L.has('makeWaterTowerRural')) {
      const wt = L.place('makeWaterTowerRural', 168, 0, -3.7, { opts: { height: 14, name: 'HAYDEN', seed: 5 } });
      L.burger(165.5, 14 * 0.55, 'smg');
      void wt;
    } else {
      L.block(163.9, 172.1, 7.5, 7.7, -0.4, 0.4, 'ironBlack', { ledge: true }); L.ladder(171.6, 0, 7.7);
      L.burger(165.5, 7.7, 'smg');
    }
    if (L.has('makeSilo')) L.place('makeSilo', 184, 0, -3.6, { opts: { height: 14, radius: 2.4, seed: 6 } });
    if (L.has('makeHayBales')) L.place('makeHayBales', 191, 0, 0, { opts: { kind: 'square', count: 3, rows: 2, stair: 'left', seed: 15 } });
    if (L.has('makeTree')) L.place('makeTree', 197, 0, -0.6, { opts: { kind: 'dead', seed: 31 } });
    L.encounter(160, [{ type: 'bomber', x: 166, y: 7.75, delay: 0.3 }, { type: 'axeman', dx: 16, delay: 0.5 }, { type: 'biker', x: 205, facing: -1, delay: 2 }]);

    // ---------------------------------------------------------- 5. the motel (200–260)
    L.checkpoint(204);
    if (L.has('makeMotel')) L.place('makeMotel', 228, 0, -3.0, { opts: { width: 28 } });
    else motelFallback(L, 228, 28);
    if (L.has('makeDiner')) L.place('makeDiner', 252, 0, -3.2);
    else L.block(246, 258, 0, 3.6, -7, -1.4, 'chrome', { ledge: true });
    if (L.has('makeSedan80s')) { L.place('makeSedan80s', 212, 0, 0, { opts: { seed: 11 } }); L.place('makeSedan80s', 240, 0, 0, { opts: { seed: 4 } }); }
    L.burger(219, T1, 'pill');
    L.ingrid(234, T1);
    L.door(216); L.door(223); L.door(230); L.door(237);
    L.encounter(222, [
      { type: 'gunner', x: 236, y: T1 + 0.05 }, { type: 'thug', x: 216, emerge: true, delay: 0.6 }, { type: 'thug', x: 230, emerge: true, delay: 1.5 },
      { type: 'biker', x: 262, facing: -1, delay: 2.4 }, { type: 'bazooka', x: 214, y: T1 + 0.05, delay: 3.5 }, { type: 'knifer', dx: 13, delay: 4.8 },
    ], { lock: 14, banner: 'MOTEL SHOOTOUT', sub: 'They were waiting for you' });

    // ---------------------------------------------------------- road out
    if (L.has('makeMercury50')) {
      const car = L.place('makeMercury50', 287, 0, 2.6, { opts: { headlights: false }, colliders: false, static: false });
      game.exitCar = car;
    }
    L.exit(282);
  },
};
