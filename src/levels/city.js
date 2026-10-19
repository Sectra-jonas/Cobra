// LEVEL 1 — THE CITY (night). Rain-soaked 1986 Los Angeles: storefront strip,
// alleys, a parking lot, a construction site and a final street fight.
// Multi-tier platforming (street / 3.2 m / 6.4 m / 9.6 m) like the C64 original.
import * as THREE from 'three';
import { mat, facadeMat, neonMat, glow, solid, box } from '../core/materials.js';
import * as TX from '../core/textures.js';

const T1 = 3.2, T2 = 6.4, T3 = 9.6;

// ---------------------------------------------------------------- helpers

// Facade plane with lit windows, UV-scaled so windows keep real size on any building.
function facadePlane(w, h, look, x0 = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const tileW = 4 * 2.6, tileH = 6 * 3.2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) + w / 2 + x0) / tileW, (pos.getY(i) + h / 2) / tileH);
  }
  return new THREE.Mesh(g, facadeMat(look));
}

const LOOKS = [
  { wall: '#4a3b36', kind: 'brick', seed: 3, litRatio: 0.32, warm: 0.75 },
  { wall: '#3c4048', kind: 'panel', seed: 5, litRatio: 0.4, warm: 0.4 },
  { wall: '#6a5a48', kind: 'stucco', seed: 7, litRatio: 0.3, warm: 0.85 },
  { wall: '#3a2e2c', kind: 'brick', seed: 11, litRatio: 0.22, warm: 0.6 },
  { wall: '#4b5560', kind: 'stucco', seed: 13, litRatio: 0.35, warm: 0.5 },
];

function fallbackBuilding(L, cx, w, h, style, seed) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(box(w, h, 10, 2), mat(style === 'stucco' ? 'stuccoBeige' : style === 'panel' ? 'concrete' : 'brickDark'));
  body.position.set(0, h / 2, -6.2);
  body.castShadow = true;
  g.add(body);
  const f = facadePlane(w, h, LOOKS[seed % LOOKS.length], cx - w / 2);
  f.position.set(0, h / 2, -1.19);
  g.add(f);
  const cornice = new THREE.Mesh(box(w + 0.4, 0.5, 0.6, 1), mat('concreteDark'));
  cornice.position.set(0, h - 0.25, -1.1);
  g.add(cornice);
  g.userData.colliders = [{ type: 'ledge', x0: -w / 2, x1: w / 2, y: h }];
  return g;
}

function building(L, x0, w, h, o = {}) {
  const cx = x0 + w / 2;
  const seed = o.seed ?? Math.floor(x0 * 3 + h);
  const opts = { width: w, height: h, floors: Math.max(2, Math.round(h / 3.2)), style: o.style || 'brick', seed, ...(o.opts || {}) };
  const obj = (L.has('makeBuilding') && L.prop('makeBuilding', opts)) || fallbackBuilding(L, cx, w, h, opts.style, seed);
  L.place(obj, cx, 0, o.z || 0, { colliders: o.walkable !== false });
  return obj;
}

function storefront(L, x0, w, kind, name, neon) {
  const opts = { width: w, kind, name, neon };
  if (L.has('makeStorefront')) return L.place('makeStorefront', x0 + w / 2, 0, 0, { opts });
  // fallback: lit window + neon
  const g = new THREE.Group();
  const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 2.2), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffb070', emissiveIntensity: 0.9 }));
  win.position.set(0, 1.5, -1.15);
  g.add(win);
  const nm = neonMat(name, { color: neon });
  const n = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * nm.userData.aspect, 1.2), nm);
  n.position.set(0, 3.0, -1.0);
  g.add(n);
  g.userData.lights = [{ pos: new THREE.Vector3(0, 3, 0.6), color: neon, intensity: 30, distance: 10 }];
  return L.place(g, x0 + w / 2, 0, 0);
}

function fireEscape(L, x, floors, width = 6, z = 0) {
  if (L.has('makeFireEscape')) return L.place('makeFireEscape', x, 0, z, { opts: { floors, width, floorHeight: T1 } });
  const g = new THREE.Group();
  const lad = [];
  const cols = [];
  for (let i = 1; i <= floors; i++) {
    const y = i * T1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 2.1), mat('ironBlack'));
    deck.position.set(0, y - 0.04, -0.15);
    deck.castShadow = true;
    g.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.05), mat('ironBlack'));
    rail.position.set(0, y + 1.0, 0.9);
    g.add(rail);
    cols.push({ type: 'ledge', x0: -width / 2, x1: width / 2, y });
    lad.push({ x: (i % 2 ? 1 : -1) * (width / 2 - 0.5), y0: y - T1, y1: y });
  }
  g.userData.colliders = cols;
  g.userData.ladders = lad;
  const obj = L.place(g, x, 0, z);
  for (const l of lad) {
    const m = L.has('makeLadderSteel') ? L.prop('makeLadderSteel', { height: T1 }) : null;
    if (m) { m.position.set(x + l.x, l.y0, z - 0.35); L.scene.add(m); }
    else { const v = L.ladder; v.call(L, x + l.x, l.y0, l.y1, { visual: true }); L.world.ladders.pop(); }
  }
  return obj;
}

function awning(L, x0, x1, y, color) {
  if (L.has('makeAwning')) return L.place('makeAwning', (x0 + x1) / 2, 0, 0, { opts: { width: x1 - x0, y, color } });
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, 2.0), solid(color, 0.7));
  a.position.set(0, y - 0.06, -0.2);
  a.rotation.x = 0.12;
  a.castShadow = true;
  g.add(a);
  g.userData.colliders = [{ type: 'ledge', x0: -(x1 - x0) / 2, x1: (x1 - x0) / 2, y }];
  return L.place(g, (x0 + x1) / 2, 0, 0);
}

function simpleProp(L, name, x, y = 0, z = 0, opts = {}, o = {}) {
  if (!L.has(name)) return null;
  return L.place(name, x, y, z, { opts, ...o });
}

// The lamp heads are seen from below at gameplay distance; tame their glow so they
// don't bloom into a second moon (materials are shared, so dim each one only once).
function dimGlow(obj, k) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || m.userData.dimmed) continue;
      m.userData.dimmed = true;
      if (m.emissive && m.emissiveIntensity > 1) m.emissiveIntensity *= k;
      if (m.blending === THREE.AdditiveBlending) {
        if (m.uniforms?.uIntensity) m.uniforms.uIntensity.value *= k;
        else if (m.color) m.color.multiplyScalar(k);
        if (m.opacity !== undefined) m.opacity *= Math.sqrt(k);
      }
    }
  });
}

function streetLamp(L, x, z = -0.75, flicker = false) {
  if (L.has('makeStreetLamp')) {
    const lamp = L.place('makeStreetLamp', x, 0, z, { opts: { flicker }, lightScale: 0.8 });
    if (lamp) dimGlow(lamp, 0.4);
    return lamp;
  }
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 7.5, 8), mat('steelPainted'));
  pole.position.y = 3.75;
  g.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.4), glow('#ff9a40', 6));
  head.position.set(0.6, 7.4, 0.3);
  g.add(head);
  g.userData.lights = [{ pos: new THREE.Vector3(0.6, 7.1, 0.5), color: '#ff9a48', intensity: 140, distance: 18, flicker: flicker ? 0.6 : 0 }];
  return L.place(g, x, 0, z);
}

// Sign mounted on a facade (vertical hotel signs etc.)
function neonSign(L, text, x, y, z, color, h = 1.2, vertical = false, flicker = 0) {
  if (L.has('makeNeonSign')) {
    // real bent-glass tube neon (origin = bottom centre of the board's back face)
    const opts = { text, color, height: h * 0.62, vertical, border: !vertical, flicker: flicker > 0.12, broken: flicker > 0.25 ? [1] : undefined };
    const probe = L.prop('makeNeonSign', opts);
    const hh = probe?.userData?.size?.h ?? h;
    return L.place(probe, x, y - hh / 2, z - 0.05);
  }
  const nm = neonMat(text, { color, border: !vertical });
  const asp = nm.userData.aspect;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(h * asp + 0.3, h + 0.25, 0.12), solid('#0b0b0f', 0.5, 0.6));
  board.position.z = -0.08;
  g.add(board);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(h * asp, h), nm);
  p.position.z = 0.0;
  g.add(p);
  if (vertical) g.rotation.z = -Math.PI / 2;
  g.position.set(x, y, z);
  L.scene.add(g);
  L.light(x, y, z + 1.2, color, 26 * h, 7 + h * 3, { flicker });
  return g;
}

// ------------------------------------------------------------------ level

export default {
  id: 'city',
  name: 'LEVEL 1 — THE CITY',
  subtitle: 'NIGHT · RAIN · THE NIGHT SLASHER\'S GANG OWNS THE STREETS',
  location: 'LOS ANGELES · 11:47 PM',
  locationSub: 'NIGHT SLASHER VICTIMS: 16',
  hudName: 'L1 · THE CITY',
  length: 300,
  start: { x: 6, y: 0 },
  quota: 25,
  rain: true,
  lightning: true,
  wet: { strength: 0.95, coverage: 0.55 },
  fog: { color: '#0a0c17', density: 0.0105 },
  sky: { top: '#020309', horizon: '#2b1532', bottom: '#06060b', glow: '#ff5a2a', glowAmt: 0.6, moon: true, sunDir: [0.35, 0.5, -1], sunColor: '#d6deff', sunSize: 0.99935, stars: 0.5, clouds: 0.8, cloudColor: '#161220', cloudLit: '#ff6a32' },
  hemi: { sky: '#46588c', ground: '#24141c', intensity: 1.15 },
  sun: { color: '#8fa6ff', intensity: 1.25, dir: [0.35, 0.85, 0.5] },
  fill: { color: '#ff3a8a', intensity: 0.25, dir: [-0.6, 0.3, 0.5] },
  rim: { color: '#6cc4ff', strength: 0.5 },
  envIntensity: 0.8,
  env: { panels: [
    { color: '#ff2f8e', w: 6, h: 3, pos: [-8, 2, -6], i: 4 }, { color: '#2fd2ff', w: 6, h: 3, pos: [8, 3, -6], i: 4 },
    { color: '#ff9a40', w: 12, h: 2, pos: [0, 7, 4], i: 3 }, { color: '#6070ff', w: 20, h: 6, pos: [0, 9, -2], i: 0.6 },
  ] },
  grade: { exposure: 1.12, lift: [0.015, 0.01, 0.035], gain: [1.0, 0.97, 1.04], gamma: [1, 1, 1], sat: 1.12, contrast: 1.1, vignette: 0.5, grain: 0.055, ca: 0.0016, heat: 0, lensRain: 0.8, bloom: { strength: 0.75, radius: 0.55, threshold: 0.84 } },
  skyline: [
    { z: -48, minH: 18, maxH: 42, lit: 0.32, layerFade: 0.18, seed: 21, wall: '#0d0f17' },
    { z: -105, minH: 30, maxH: 95, lit: 0.28, layerFade: 0.38, seed: 3, wall: '#0b0d14' },
    { z: -210, minH: 50, maxH: 170, lit: 0.22, layerFade: 0.6, seed: 9, wall: '#0a0c12' },
  ],
  music: 'city',
  ambience: 'rain',
  enemyPool: [['thug', 4], ['knifer', 3], ['gunner', 2.2], ['granny', 1.4], ['bazooka', 1], ['biker', 0.9], ['grabber', 0.8], ['axeman', 0.6]],
  maxAlive: 4,
  spawnInterval: 3.4,
  safeStart: 14,
  ingridTrigger: 95,
  exitText: 'Get Ingrid to the Mercury — head east',
  traffic: { kinds: ['makeSedan80s', 'makeSedan80s', 'makePoliceCar', 'makeGangVan'], lanes: [{ z: 11, dir: 1, speed: 15 }, { z: 6.5, dir: -1, speed: 13 }], interval: [9, 18], lights: true, spray: true },
  helicopter: { z: -46, y: 32, speed: 6 },

  build(L, game) {
    const S = L.scene;

    // ---------------------------------------------------------- ground
    const roadMat = mat('concreteDark').clone();
    const asphalt = TX.asphalt();
    roadMat.map = asphalt.map; roadMat.normalMap = asphalt.normalMap; roadMat.roughnessMap = asphalt.roughnessMap;
    roadMat.color.set('#ffffff');
    const roadGeo = new THREE.PlaneGeometry(480, 70, 1, 1);
    roadGeo.rotateX(-Math.PI / 2);
    const ruv = roadGeo.attributes.uv, rp = roadGeo.attributes.position;
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (rp.getX(i) + 150) / 7, (rp.getZ(i) + 34) / 7);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(130, 0, 34.0 - 0.6);
    road.receiveShadow = true;
    S.add(road);
    // sidewalk strip behind the gameplay lane
    const swMat = mat('sidewalk').clone();
    const swGeo = box(480, 0.14, 1.5, 1.6);
    const sw = new THREE.Mesh(swGeo, swMat);
    sw.position.set(130, 0.07, -1.35);
    sw.receiveShadow = true;
    S.add(sw);
    const curb = new THREE.Mesh(box(480, 0.16, 0.2, 1), mat('concrete'));
    curb.position.set(130, 0.08, -0.55);
    S.add(curb);
    // lane markings (wet paint)
    const lineMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.35 });
    const dashMat = new THREE.MeshStandardMaterial({ color: '#b9bcc4', roughness: 0.35 });
    for (const zz of [7.8, 8.05]) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(420, 0.12), lineMat);
      ln.rotation.x = -Math.PI / 2;
      ln.position.set(150, 0.004, zz);
      S.add(ln);
    }
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.14).rotateX(-Math.PI / 2), dashMat, 60);
    const dm = new THREE.Object3D();
    for (let i = 0; i < 60; i++) { dm.position.set(-20 + i * 7, 0.004, 15); dm.updateMatrix(); dash.setMatrixAt(i, dm.matrix); }
    S.add(dash);
    // back lots / alleys behind the sidewalk (seen through gaps between buildings)
    const lotMat = mat('concreteDark').clone();
    const lotGeo = new THREE.PlaneGeometry(480, 40);
    lotGeo.rotateX(-Math.PI / 2);
    const luv = lotGeo.attributes.uv, lp = lotGeo.attributes.position;
    for (let i = 0; i < luv.count; i++) luv.setXY(i, lp.getX(i) / 4, lp.getZ(i) / 4);
    const lot = new THREE.Mesh(lotGeo, lotMat);
    lot.position.set(130, 0.0, -2.1 - 20);
    lot.receiveShadow = true;
    S.add(lot);
    L.wetMeshes = [road, sw, lot];
    L.solid(-110, 380, -6, 0); // the street

    // ---------------------------------------------------------- mid-distance city (second row)
    const midRow = [[-92, 22, 30], [-70, 24, 44], [-40, 20, 34], [-20, 16, 26], [-4, 22, 40], [18, 18, 30], [36, 24, 48], [60, 16, 28], [76, 22, 36], [98, 30, 52], [128, 20, 30], [148, 18, 44], [166, 26, 34], [192, 20, 58], [212, 24, 30], [236, 18, 40], [254, 28, 46], [282, 22, 34], [304, 26, 50], [330, 24, 36]];
    midRow.forEach(([x0, w, h], i) => {
      const f = facadePlane(w, h, { ...LOOKS[i % LOOKS.length], seed: 40 + i, litRatio: 0.28 }, x0);
      f.position.set(x0 + w / 2, h / 2, -22 - (i % 3) * 4);
      S.add(f);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, 8), solid('#0c0d12', 0.9));
      roof.position.set(x0 + w / 2, h + 0.3, -26 - (i % 3) * 4);
      S.add(roof);
      if (i % 4 === 1) neonSign(L, ['HOTEL', 'BAR', 'ROOMS', 'CLUB'][i % 4], x0 + w / 2, h - 3, -21.5 - (i % 3) * 4, ['#ff2f6d', '#2fd2ff', '#ffb02f', '#b05aff'][(i >> 2) % 4], 1.6);
    });

    // ---------------------------------------------------------- off-level block (seen in the intro)
    building(L, -78, 18, 25.6, { style: 'panel', seed: 31, walkable: false });
    building(L, -60, 16, 12.8, { style: 'stucco', seed: 32, walkable: false });
    storefront(L, -59.5, 15, 'diner', 'ALL NITE', '#ff2f6d');
    building(L, -44, 18, 19.2, { style: 'brick', seed: 33, walkable: false });
    storefront(L, -43.5, 17, 'pawn', 'GUNS · PAWN', '#ffd02f');
    streetLamp(L, -50);
    streetLamp(L, -32);
    // ---------------------------------------------------------- far side of the street
    // Only the intro's street-level shot looks across the road; no colliders, no pooled lights,
    // no shadows, and hidden outside the intro (game.introDressing), so gameplay never pays for it.
    {
      const dressing = (game.introDressing = []);
      const keep = (o) => { if (o) { o.visible = false; dressing.push(o); } return o; };
      const zb = 19.1; // building origin (facade 1.2 m toward the street, i.e. z ~ 20.3)
      const far = { colliders: false, lights: false, shadows: false, rotY: Math.PI };
      const row = [[-36, 16, 19.2, 'brick'], [-20, 14, 12.8, 'stucco'], [-6, 18, 25.6, 'panel'], [12, 12, 16, 'brick'],
        [24, 16, 22.4, 'stucco'], [40, 14, 12.8, 'brick'], [54, 20, 28.8, 'panel'], [74, 16, 19.2, 'brick'], [90, 18, 16, 'stucco']];
      row.forEach(([x0, w, h, style], i) => {
        const opts = { width: w, height: h, floors: Math.max(2, Math.round(h / 3.2)), style, seed: 60 + i };
        const b = (L.has('makeBuilding') && L.prop('makeBuilding', opts)) || fallbackBuilding(L, x0 + w / 2, w, h, style, 60 + i);
        keep(L.place(b, x0 + w / 2, 0, zb, far));
      });
      if (L.has('makeStorefront')) {
        for (const [x0, w, kind, name, neon] of [[-19.5, 13, 'diner', 'ALL NITE', '#ff2f6d'], [24.5, 15, 'pawn', 'PAWN', '#ffd02f'], [54.5, 19, 'liquor', 'LIQUOR', '#2fd2ff']]) {
          keep(L.place('makeStorefront', x0 + w / 2, 0, zb, { ...far, opts: { width: w, kind, name, neon } }));
        }
      }
      const fsw = new THREE.Mesh(box(170, 0.14, 2.9, 1.6), mat('sidewalk'));
      fsw.position.set(25, 0.07, 18.95);
      fsw.receiveShadow = true;
      S.add(keep(fsw));
      const fcurb = new THREE.Mesh(box(170, 0.16, 0.2, 1), mat('concrete'));
      fcurb.position.set(25, 0.08, 17.45);
      S.add(keep(fcurb));
      if (L.has('makeStreetLamp')) {
        for (const x of [-8, 14, 36, 58]) { const lamp = keep(L.place('makeStreetLamp', x, 0, 17.9, far)); if (lamp) dimGlow(lamp, 0.4); }
      }
      if (L.has('makeSedan80s')) {
        for (const [x, seed] of [[9, 3], [31, 17]]) {
          const c = keep(L.place('makeSedan80s', x, 0, 16.4, { colliders: false, lights: false, shadows: false, opts: { seed, headlights: false } }));
          c?.userData.setLights?.(false);
        }
      }
    }
    // ---------------------------------------------------------- block A: the strip
    building(L, -26, 14, 19.2, { style: 'brick', seed: 1 });
    building(L, -12, 16, T3, { style: 'stucco', seed: 2 });
    storefront(L, -11, 14, 'supermarket', 'SUPERMARKET', '#2fd2ff');
    building(L, 4, 12, 16, { style: 'brick', seed: 3 });
    storefront(L, 4.5, 11, 'liquor', 'LIQUOR', '#ff2f6d');
    fireEscape(L, 10, 3, 6);
    building(L, 16, 10, T2, { style: 'stucco', seed: 4 });
    storefront(L, 16.5, 9, 'pizza', 'PIZZA', '#ff7a1a');
    awning(L, 17, 25, T1, '#1d6b3a');
    building(L, 26, 14, 22.4, { style: 'panel', seed: 5 });
    storefront(L, 26.5, 13, 'arcade', 'ARCADE', '#b05aff');
    neonSign(L, 'HOTEL', 38.6, 12, -0.9, '#ff2f6d', 1.1, true, 0.15);
    streetLamp(L, 2);
    streetLamp(L, 22, -0.75, true);
    simpleProp(L, 'makePhoneBooth', -3, 0, -0.65);
    simpleProp(L, 'makeNewspaperBox', 1, 0, -0.75);
    simpleProp(L, 'makeFireHydrant', 14.5, 0, -0.6);
    simpleProp(L, 'makeTrashCan', 26, 0, -0.75);
    simpleProp(L, 'makeParkingMeter', 33, 0, -0.65);
    simpleProp(L, 'makeManhole', 8, 0, 3.5);
    if (!L.has('makeManhole')) L.emitter('steam', 8, 0, 3.5, 3);
    L.emitter('steam', 31, 0, 5.5, 2.5);
    // Cobretti's Mercury parked at the start: nose toward -x at the curb, driver door to the camera
    if (L.has('makeMercury50')) {
      const car = L.place('makeMercury50', 0.5, 0, 2.6, { opts: { headlights: true }, colliders: false, static: false, rotY: Math.PI });
      car.userData.setLights?.(true);
      game.startCar = car;
    }
    L.burger(10.0 - 1.6, T1, 'knife');
    L.checkpoint(4);
    L.door(10.4); L.door(32.5);
    L.encounter(18, [{ type: 'thug', dx: 16 }, { type: 'thug', x: 32.5, emerge: true, delay: 1.2 }]);

    // ---------------------------------------------------------- block B: pawn shop, alley, burger joint, hotel
    building(L, 40, 12, 12.8, { style: 'brick', seed: 6 });
    storefront(L, 40.5, 11, 'pawn', 'PAWN', '#ffd02f');
    fireEscape(L, 46, 3, 6);
    // alley
    simpleProp(L, 'makeChainLinkFence', 55, 0, -4.5, { width: 6, height: 3.4 });
    simpleProp(L, 'makeDumpster', 54.2, 0, -0.4);
    simpleProp(L, 'makeTrashCan', 56.6, 0, -0.9);
    simpleProp(L, 'makeGraffitiWall', 55, 0, -8, { width: 6, height: 6 });
    L.emitter('steam', 55.5, 0.2, -2.5, 2);
    L.emitter('drip', 52.2, T3, -0.3, 1.5);
    building(L, 58, 16, T3, { style: 'brick', seed: 7 });
    storefront(L, 58.5, 15, 'burger', 'BURGERS', '#ff9a1a');
    awning(L, 59.5, 67.5, T1, '#9c1b22');
    fireEscape(L, 71, 3, 5);
    if (L.has('makeBillboard')) L.place('makeBillboard', 66, T3, 0, { opts: { text: 'TASTE THE HEAT', art: 'cola' } });
    L.burger(66, L.has('makeBillboard') ? T3 + 2.4 : T3, 'pistol');
    building(L, 74, 22, 19.2, { style: 'stucco', seed: 8 });
    storefront(L, 74.5, 10, 'hotel', 'HOTEL', '#ff2f6d');
    storefront(L, 85, 10.5, 'diner', 'COCKTAILS', '#2fd2ff');
    fireEscape(L, 90, 3, 6);
    neonSign(L, 'VACANCY', 80, 7.6, -1.0, '#3dff8a', 0.7, false, 0.3);
    streetLamp(L, 50);
    streetLamp(L, 70);
    streetLamp(L, 88);
    simpleProp(L, 'makeMailbox', 44, 0, -0.75);
    simpleProp(L, 'makeFireHydrant', 63, 0, -0.6);
    simpleProp(L, 'makeNewspaperBox', 79, 0, -0.75);
    simpleProp(L, 'makeManhole', 62, 0, 4.5);
    simpleProp(L, 'makeTrafficLight', 96.8, 0, -0.7);
    L.checkpoint(42);
    L.door(44); L.door(65); L.door(79);
    L.encounter(48, [{ type: 'knifer', x: 46, y: T1 + 0.05 }, { type: 'granny', dx: 15, delay: 0.8 }]);
    L.encounter(78, [{ type: 'bazooka', x: 92, y: T2 + 0.05 }, { type: 'gunner', dx: 16, delay: 0.5 }, { type: 'thug', x: 79, emerge: true, delay: 2 }]);

    // ---------------------------------------------------------- block C: parking lot
    building(L, 97, 30, 25.6, { style: 'panel', seed: 9, z: -10, walkable: false });
    simpleProp(L, 'makeChainLinkFence', 103, 0, -2.2, { width: 12, height: 3.2 });
    simpleProp(L, 'makeChainLinkFence', 116, 0, -2.2, { width: 12, height: 3.2 });
    simpleProp(L, 'makeGraffitiWall', 110, 0, -6, { width: 26, height: 4.5 });
    if (L.has('makePoliceCar')) L.place('makePoliceCar', 103, 0, 0, { opts: { seed: 2 }, static: false });
    if (L.has('makeSedan80s')) L.place('makeSedan80s', 111, 0, 0, { opts: { seed: 5 } });
    if (L.has('makeGangVan')) { const van = L.place('makeGangVan', 120, 0, 0, { opts: { seed: 3 } }); van.userData.setDoor?.(0.85); }
    L.door(120.5);
    streetLamp(L, 99.5);
    streetLamp(L, 116, -2.0, true);
    simpleProp(L, 'makeBarrel', 107, 0, -1.6);
    simpleProp(L, 'makePowerBox', 124.5, 0, -1.8);
    L.emitter('steam', 108, 0, 4, 2);
    L.ingrid(118, 2.06);
    L.checkpoint(98);
    L.encounter(104, [{ type: 'thug', x: 120.5, emerge: true }, { type: 'thug', x: 120.5, emerge: true, delay: 1.4 }, { type: 'knifer', dx: 20, delay: 0.6 }]);

    // ---------------------------------------------------------- block C2: unfinished building + scaffold
    building(L, 126, 12, 12.8, { style: 'brick', seed: 10 });
    storefront(L, 126.5, 11, 'liquor', 'BAR', '#2fd2ff');
    building(L, 138, 18, 16, { style: 'panel', seed: 11 });
    if (L.has('makeScaffold')) L.place('makeScaffold', 147, 0, 0, { opts: { width: 16, levels: 3 } });
    else {
      for (const y of [T1, T2, T3]) L.block(139, 155, y - 0.12, y, -1.0, 0.9, 'woodPlankFloor', { ledge: true });
      L.ladder(140, 0, T1); L.ladder(154, T1, T2); L.ladder(140, T2, T3);
    }
    streetLamp(L, 136);
    simpleProp(L, 'makeCrates', 157, 0, -0.2, { seed: 4 });
    L.checkpoint(128);
    L.encounter(140, [{ type: 'axeman', dx: 15 }, { type: 'axeman', dx: 18, delay: 0.9 }, { type: 'bomber', x: 150, y: T3 + 0.05, delay: 0.4 }]);

    // ---------------------------------------------------------- block D: diner, water tower, bus stop
    building(L, 158, 12, T3, { style: 'stucco', seed: 12 });
    storefront(L, 158.5, 11, 'diner', 'DINER', '#ff2f6d');
    awning(L, 159, 169, T1, '#1d3f8a');
    if (L.has('makeWaterTower')) L.place('makeWaterTower', 163, T3, 0);
    else { L.block(160.5, 165.5, T3 + 4, T3 + 4.2, -1.5, 1, 'woodWeathered', { ledge: true }); L.ladder(165, T3, T3 + 4.2); }
    L.burger(163, T3 + (L.has('makeWaterTower') ? 3.4 : 4.2), 'smg');
    building(L, 170, 16, 22.4, { style: 'brick', seed: 13 });
    storefront(L, 170.5, 15, 'pawn', 'CHECKS CASHED', '#3dff8a');
    fireEscape(L, 173, 3, 6);
    if (L.has('makeBusShelter')) L.place('makeBusShelter', 182, 0, 0);
    building(L, 186, 14, T2, { style: 'stucco', seed: 14 });
    storefront(L, 186.5, 13, 'pizza', 'VIDEO', '#ff2f6d');
    if (L.has('makeNewsstand')) L.place('makeNewsstand', 192, 0, 0);
    building(L, 200, 18, 16, { style: 'brick', seed: 15 });
    storefront(L, 200.5, 17, 'supermarket', 'MARKET', '#2fd2ff');
    fireEscape(L, 210, 2, 6);
    streetLamp(L, 166);
    streetLamp(L, 184);
    streetLamp(L, 202, -0.75, true);
    simpleProp(L, 'makeBench', 178, 0, -0.85);
    simpleProp(L, 'makeFireHydrant', 197, 0, -0.6);
    simpleProp(L, 'makeManhole', 175, 0, 3);
    simpleProp(L, 'makeTrafficLight', 216.5, 0, -0.7);
    L.ingrid(173 + 2.5, T2);
    L.checkpoint(160);
    L.door(164); L.door(178); L.door(193); L.door(207);
    L.encounter(168, [{ type: 'biker', x: 200, facing: -1 }, { type: 'gunner', x: 173, y: T1 + 0.05, delay: 0.5 }]);
    L.encounter(196, [{ type: 'granny', dx: 16 }, { type: 'biker', x: 225, facing: -1, delay: 2.5 }, { type: 'grabber', dx: -14, delay: 1.5 }]);

    // ---------------------------------------------------------- block E: construction site
    building(L, 236, 24, 28.8, { style: 'panel', seed: 16, z: -9, walkable: false });
    simpleProp(L, 'makeChainLinkFence', 224, 0, -2.5, { width: 12, height: 3.2 });
    simpleProp(L, 'makeChainLinkFence', 236, 0, -2.5, { width: 12, height: 3.2 });
    if (L.has('makeScaffold')) L.place('makeScaffold', 241, 0, 0, { opts: { width: 10, levels: 2 } });
    else { for (const y of [T1, T2]) L.block(236, 246, y - 0.12, y, -1.0, 0.9, 'woodPlankFloor', { ledge: true }); L.ladder(237, 0, T1); L.ladder(245, T1, T2); }
    if (L.has('makeCrates')) { L.place('makeCrates', 226, 0, 0, { opts: { seed: 2, count: 4 } }); L.place('makeCrates', 231, 0, 0, { opts: { seed: 9, count: 6 } }); }
    else { L.block(225, 228, 0, 1.2, -0.8, 0.8, 'woodWeathered', { solid: true }); L.block(230, 233, 0, 2.4, -0.8, 0.8, 'woodWeathered', { solid: true }); }
    simpleProp(L, 'makePallets', 234, 0, -0.3);
    simpleProp(L, 'makeBarrel', 222, 0, 0);
    simpleProp(L, 'makeBarrel', 222.8, 0, -0.6);
    L.burger(231.5, L.has('makeCrates') ? 2.4 : 2.4, 'pill');
    L.ingrid(241, T2);
    L.light(230, 5, 2, '#ffd27a', 60, 16);
    L.light(244, 8, 1, '#ff3b2a', 25, 8, { pulse: 4 });
    L.checkpoint(220);
    L.encounter(226, [{ type: 'bomber', x: 244, y: T2 + 0.05 }, { type: 'axeman', dx: 16, delay: 0.6 }, { type: 'knifer', dx: -14, delay: 1.5 }]);

    // ---------------------------------------------------------- block F: final street fight
    building(L, 248, 16, 12.8, { style: 'brick', seed: 17 });
    storefront(L, 248.5, 15, 'arcade', 'LAZER TAG', '#b05aff');
    fireEscape(L, 252, 2, 6);
    building(L, 264, 14, T2, { style: 'stucco', seed: 18 });
    storefront(L, 264.5, 13, 'liquor', 'LIQUOR', '#ff2f6d');
    awning(L, 265, 277, T1, '#6b1d6b');
    building(L, 278, 30, 25.6, { style: 'panel', seed: 19 });
    storefront(L, 278.5, 14, 'hotel', 'MOTEL', '#ffb02f');
    streetLamp(L, 256);
    streetLamp(L, 274);
    streetLamp(L, 290);
    simpleProp(L, 'makeDumpster', 262.5, 0, -0.4);
    L.checkpoint(250);
    L.door(256); L.door(270); L.door(285);
    L.encounter(258, [
      { type: 'thug', dx: 12 }, { type: 'axeman', dx: -12, delay: 0.5 }, { type: 'gunner', x: 252, y: T1 + 0.05, delay: 1.5 },
      { type: 'thug', x: 270, emerge: true, delay: 3 }, { type: 'bazooka', x: 271, y: T1 + 0.05, delay: 4 }, { type: 'knifer', dx: 13, delay: 5.5 },
    ], { lock: 13, banner: 'AMBUSH!', sub: 'The Night Slasher\'s gang closes in' });
    // exit: the Mercury waits at the end of the street
    if (L.has('makeMercury50')) {
      const car2 = L.place('makeMercury50', 296, 0, 2.6, { opts: { headlights: true }, colliders: false, static: false });
      car2.userData.setLights?.(true);
      game.exitCar = car2;
    }
    L.exit(292);
  },
};
