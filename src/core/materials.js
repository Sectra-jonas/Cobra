// Shared PBR material library + UV helpers. Geometry gets world-scaled UVs so texel
// density stays consistent across props of different sizes.
import * as THREE from 'three';
import * as TX from './textures.js';

// Rewrites UVs by planar projection chosen per-vertex from the normal, in meters.
// `offset` lets adjacent pieces share a continuous texture.
export function worldUV(geo, metersPerTile = 2, offset = null, rotate = false) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  if (!nor) geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const ox = offset ? offset.x : 0, oy = offset ? offset.y : 0, oz = offset ? offset.z : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = z * Math.sign(n.getX(i) || 1); v = y; }
    else if (ay >= ax && ay >= az) { u = x; v = z; }
    else { u = x * Math.sign(n.getZ(i) || 1); v = y; }
    if (rotate) [u, v] = [v, u];
    uv[i * 2] = u / metersPerTile;
    uv[i * 2 + 1] = v / metersPerTile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function box(w, h, d, mpt = 2, offset = null) {
  return worldUV(new THREE.BoxGeometry(w, h, d), mpt, offset);
}

function fromSet(set, params = {}) {
  const p = { ...params };
  if (set.map) p.map = set.map;
  if (set.normalMap) p.normalMap = set.normalMap;
  if (set.roughnessMap) p.roughnessMap = set.roughnessMap;
  if (set.metalnessMap && params.metalness !== undefined) p.metalnessMap = set.metalnessMap;
  if (set.emissiveMap && params.useEmissive) {
    p.emissiveMap = set.emissiveMap;
    p.emissive = new THREE.Color(params.emissiveColor || '#ffffff');
  }
  delete p.useEmissive;
  delete p.emissiveColor;
  delete p.normalScale;
  const m = new THREE.MeshStandardMaterial(p);
  if (params.normalScale !== undefined) m.normalScale.set(params.normalScale, params.normalScale);
  return m;
}

const registry = new Map();
const factories = {
  // --- city
  brickRed: () => fromSet(TX.brick({ color: '#7d3a2a', mortar: '#7e786e', seed: 3, wet: 0.5 }), { roughness: 1, normalScale: 1.2 }),
  brickDark: () => fromSet(TX.brick({ color: '#4b3a36', mortar: '#5d5853', seed: 8, grime: 0.7, wet: 0.5 }), { roughness: 1, normalScale: 1.2 }),
  brickBrown: () => fromSet(TX.brick({ color: '#6e5040', mortar: '#8a8274', seed: 12, wet: 0.4 }), { roughness: 1, normalScale: 1.2 }),
  brickYellow: () => fromSet(TX.brick({ color: '#a08250', mortar: '#8a8274', seed: 14, wet: 0.4 }), { roughness: 1, normalScale: 1.2 }),
  concrete: () => fromSet(TX.concrete({ color: '#7d7b7f', seed: 7, wet: 0.5 }), { roughness: 1 }),
  concreteDark: () => fromSet(TX.concrete({ color: '#4c4b50', seed: 9, stain: 0.8, wet: 0.5 }), { roughness: 1 }),
  sidewalk: () => fromSet(TX.concrete({ color: '#6d6b70', seed: 19, stain: 0.5, seams: true, wet: 0.8 }), { roughness: 1 }),
  stuccoBeige: () => fromSet(TX.stucco({ color: '#a58f73', seed: 61 }), { roughness: 1 }),
  stuccoPink: () => fromSet(TX.stucco({ color: '#a8746f', seed: 63 }), { roughness: 1 }),
  stuccoTeal: () => fromSet(TX.stucco({ color: '#4f7c7a', seed: 65 }), { roughness: 1 }),
  stuccoWhite: () => fromSet(TX.stucco({ color: '#c9c3b6', seed: 67, stain: 0.6 }), { roughness: 1 }),
  // painted iron/steel is a dielectric (paint) with worn spots, not bare metal: with metalness 1 a
  // dark plate has no diffuse response and fire escapes, ladders and rails stayed black at night
  ironBlack: () => fromSet(TX.metalPlate({ color: '#232527', seed: 17, rust: 0.35, diamond: false }), { roughness: 1, metalness: 0.35 }),
  steelPainted: () => fromSet(TX.metalPlate({ color: '#3d4650', seed: 18, rust: 0.2, diamond: false }), { roughness: 1, metalness: 0.35 }),
  diamondPlate: () => fromSet(TX.metalPlate({ color: '#6a6e73', seed: 19, rust: 0.15, diamond: true }), { roughness: 1, metalness: 1 }),
  rustMetal: () => fromSet(TX.metalPlate({ color: '#5a4a3e', seed: 21, rust: 0.85, diamond: false }), { roughness: 1, metalness: 1 }),
  corrugated: () => fromSet(TX.corrugated({ color: '#8d9399', seed: 51, rust: 0.45 }), { roughness: 1, metalness: 1 }),
  corrugatedRed: () => fromSet(TX.corrugated({ color: '#8b2c22', seed: 53, rust: 0.35 }), { roughness: 1, metalness: 1 }),
  glassDark: () => new THREE.MeshPhysicalMaterial({ color: '#0b1018', roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: 0.12, metalness: 1 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.85 }),
  plasticBlack: () => new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.5 }),
  paintBlack: () => new THREE.MeshPhysicalMaterial({ color: '#0a0b0d', roughness: 0.25, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 }),
  // --- rural
  woodBarnRed: () => fromSet(TX.wood({ color: '#8a2b1f', seed: 41, weathered: 0.55, planks: 8 }), { roughness: 1, normalScale: 1.3 }),
  woodWeathered: () => fromSet(TX.wood({ color: '#7a6450', seed: 43, weathered: 0.8, planks: 6 }), { roughness: 1, normalScale: 1.3 }),
  woodDark: () => fromSet(TX.wood({ color: '#4a3324', seed: 45, weathered: 0.3, planks: 5 }), { roughness: 1, normalScale: 1.3 }),
  woodPlankFloor: () => fromSet(TX.wood({ color: '#6b4c32', seed: 47, weathered: 0.4, planks: 8, vertical: false }), { roughness: 1 }),
  hay: () => fromSet(TX.hay({ seed: 71 }), { roughness: 1, normalScale: 1.5 }),
  grass: () => fromSet(TX.grass({ seed: 81, dry: 0.45 }), { roughness: 1 }),
  dirt: () => fromSet(TX.dirt({ seed: 91 }), { roughness: 1 }),
  // --- factory
  factoryConcrete: () => fromSet(TX.concrete({ color: '#55534f', seed: 33, stain: 0.9 }), { roughness: 1 }),
  factoryFloor: () => fromSet(TX.metalPlate({ color: '#4d4f52', seed: 37, rust: 0.4, diamond: true }), { roughness: 1, metalness: 1 }),
  safetyYellow: () => fromSet(TX.metalPlate({ color: '#c79a16', seed: 39, rust: 0.3, diamond: false }), { roughness: 1, metalness: 0.4 }),
};

export function mat(name) {
  if (!registry.has(name)) {
    const f = factories[name];
    if (!f) throw new Error(`Unknown material ${name}`);
    registry.set(name, f());
  }
  return registry.get(name);
}

export function grating(color = '#2b2d30') {
  const key = `grating${color}`;
  if (!registry.has(key)) {
    const g = TX.grating({ color });
    registry.set(key, new THREE.MeshStandardMaterial({ map: g.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.85 }));
  }
  return registry.get(key);
}

// Colored solid material (cached by params).
export function solid(color, roughness = 0.6, metalness = 0, extra = {}) {
  const key = `solid${color}${roughness}${metalness}${JSON.stringify(extra)}`;
  if (!registry.has(key)) registry.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  return registry.get(key);
}

// Emissive glow material (neon tubes, bulbs). intensity > 1 drives bloom.
export function glow(color, intensity = 4) {
  const key = `glow${color}${intensity}`;
  if (!registry.has(key)) {
    registry.set(key, new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
  }
  return registry.get(key);
}

// Hazard stripes (yellow/black) for factory edges.
export function hazard() {
  if (!registry.has('hazard')) {
    const t = TX.painted('hazard', 256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d7a514';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#121212';
      for (let x = -h; x < w + h; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, h); ctx.lineTo(x + 24, h); ctx.lineTo(x + 24 + h, 0); ctx.lineTo(x + h, 0);
        ctx.fill();
      }
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = Math.random() * 30;
        img.data[i] -= n; img.data[i + 1] -= n; img.data[i + 2] -= n;
      }
      ctx.putImageData(img, 0, 0);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    registry.set('hazard', new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.2 }));
  }
  return registry.get('hazard');
}

// Facade material with lit windows (emissive). Each call with different seed = new look.
export function facadeMat(opts) {
  const key = `facade${JSON.stringify(opts)}`;
  if (!registry.has(key)) {
    const set = TX.facade(opts);
    const m = new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
      emissiveMap: set.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: opts.emissiveIntensity ?? 2.2,
      roughness: 1, metalness: 0,
    });
    registry.set(key, m);
  }
  return registry.get(key);
}

// Neon sign material: additive transparent plane using canvas texture.
export function neonMat(text, opts = {}) {
  const key = `neonmat${text}${JSON.stringify(opts)}`;
  if (!registry.has(key)) {
    const s = TX.neonSign(text, opts);
    const m = new THREE.MeshBasicMaterial({
      map: s.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color(1, 1, 1).multiplyScalar(opts.intensity ?? 3.2), toneMapped: true,
    });
    m.userData.aspect = s.aspect;
    registry.set(key, m);
  }
  return registry.get(key);
}

// --- factory level materials (appended)
Object.assign(factories, {
  rivetSteel: () => fromSet(TX.rivetPlate({ color: '#555b61', seed: 201, rust: 0.3, soot: 0.3 }), { roughness: 1, metalness: 0.85 }),
  rivetSteelDark: () => fromSet(TX.rivetPlate({ color: '#34363a', seed: 203, rust: 0.4, soot: 0.55, heat: 0.45 }), { roughness: 1, metalness: 0.85 }),
  ladleSteel: () => fromSet(TX.rivetPlate({ color: '#3a3b3d', seed: 205, rust: 0.45, soot: 0.7, heat: 0.8, panels: 1, pitch: 16 }), { roughness: 1, metalness: 0.8 }),
  fireBrick: () => fromSet(TX.brick({ color: '#7a4a35', mortar: '#3e3832', seed: 27, grime: 0.95 }), { roughness: 1, normalScale: 1.3 }),
  beltRubber: () => fromSet(TX.beltRubber({ seed: 211 }), { roughness: 1, normalScale: 1.5 }),
});

// --- rural level materials (appended)
Object.assign(factories, {
  shingles: () => fromSet(TX.shingles({ color: '#4a4541', seed: 301 }), { roughness: 1, normalScale: 1.3 }),
  shinglesBrown: () => fromSet(TX.shingles({ color: '#6a4a36', seed: 302, moss: 0.15 }), { roughness: 1, normalScale: 1.3 }),
  woodWhite: () => fromSet(TX.wood({ color: '#dcd6c8', seed: 303, weathered: 0.32, planks: 6 }), { roughness: 1, normalScale: 1.1 }),
  woodRail: () => fromSet(TX.wood({ color: '#8a7764', seed: 304, weathered: 0.9, planks: 1 }), { roughness: 1, normalScale: 1.4 }),
  truckPaint: () => fromSet(TX.metalPlate({ color: '#6c8797', seed: 305, rust: 0.55, diamond: false }), { roughness: 1, metalness: 0.35 }),
  tractorRed: () => fromSet(TX.metalPlate({ color: '#a8261c', seed: 307, rust: 0.4, diamond: false }), { roughness: 1, metalness: 0.3 }),
  galvanized: () => fromSet(TX.metalPlate({ color: '#9aa1a6', seed: 308, rust: 0.3, diamond: false }), { roughness: 1, metalness: 0.9 }),
  concreteDry: () => fromSet(TX.concrete({ color: '#9a958b', seed: 309, stain: 0.7 }), { roughness: 1 }),
  rockGrey: () => fromSet(TX.concrete({ color: '#857e74', seed: 311, stain: 0.5, seams: false }), { roughness: 1, normalScale: 1.6 }),
  barkOak: () => fromSet(TX.bark({ color: '#5e5145', seed: 313 }), { roughness: 1, normalScale: 2 }),
  barkPole: () => fromSet(TX.bark({ color: '#4e3d2e', seed: 315, fissure: 0.45, lichen: 0.1 }), { roughness: 1, normalScale: 1.5 }),
  woodGrey: () => fromSet(TX.wood({ color: '#9a9184', seed: 317, weathered: 0.85, planks: 7 }), { roughness: 1, normalScale: 1.4 }),
  cinderWhite: () => fromSet(TX.brick({ color: '#d4cfc2', mortar: '#aaa396', cols: 4, rows: 8, seed: 319, grime: 0.35 }), { roughness: 1, normalScale: 0.8 }),
});

// --- city prop materials (appended for src/props/city.js)
Object.assign(factories, {
  tileWhite: () => fromSet(TX.tiles({ color: '#cdc7b8', seed: 31 }), { roughness: 1 }),
  tileChecker: () => fromSet(TX.tiles({ color: '#d6d0c0', color2: '#1d1d20', seed: 33 }), { roughness: 1 }),
  tileTeal: () => fromSet(TX.tiles({ color: '#2f7c78', seed: 35, grout: '#2a2e2c' }), { roughness: 1 }),
  tileMaroon: () => fromSet(TX.tiles({ color: '#6e1f22', seed: 37, grout: '#2a2422', count: 16 }), { roughness: 1 }),
  steelGreen: () => fromSet(TX.metalPlate({ color: '#2c4636', seed: 401, rust: 0.35, diamond: false }), { roughness: 1, metalness: 0.6 }),
  steelBlue: () => fromSet(TX.metalPlate({ color: '#1f3f73', seed: 403, rust: 0.2, diamond: false }), { roughness: 1, metalness: 0.5 }),
  steelGrey: () => fromSet(TX.metalPlate({ color: '#6c7176', seed: 405, rust: 0.25, diamond: false }), { roughness: 1, metalness: 0.8 }),
  roofTar: () => fromSet(TX.concrete({ color: '#2a292c', seed: 407, stain: 0.7, seams: false, wet: 0.8 }), { roughness: 1 }),
  plywood: () => fromSet(TX.wood({ color: '#9c7a52', seed: 409, weathered: 0.5, planks: 2 }), { roughness: 1 }),
  crateWood: () => fromSet(TX.wood({ color: '#8a6a44', seed: 411, weathered: 0.45, planks: 5, vertical: false }), { roughness: 1, normalScale: 1.3 }),
  shutterGrey: () => fromSet(TX.corrugated({ color: '#6f757b', seed: 413, rust: 0.12, ribs: 48 }), { roughness: 1, metalness: 0.7 }),
});

// Shared material for 3D building windows: map each window quad's UVs to one cell of
// `material.userData.atlas` (TX.windowAtlas). Lit cells glow, dark cells reflect.
export function windowMat() {
  if (!registry.has('windowAtlas')) {
    const A = TX.windowAtlas();
    const m = new THREE.MeshStandardMaterial({
      map: A.map, emissiveMap: A.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.45,
      roughness: 0.16, metalness: 0.25,
    });
    m.userData.atlas = A;
    registry.set('windowAtlas', m);
  }
  return registry.get('windowAtlas');
}

// Alpha-blended chain-link fence mesh (double sided). Use world UVs ~0.45 m per tile.
export function chainLinkMat(color = '#a4abb2') {
  const key = `chainlink${color}`;
  if (!registry.has(key)) {
    const t = TX.chainLink({ color });
    registry.set(key, new THREE.MeshStandardMaterial({
      map: t.map, transparent: true, alphaTest: 0.03, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.85,
    }));
  }
  return registry.get(key);
}
