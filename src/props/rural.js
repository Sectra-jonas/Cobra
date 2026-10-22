// Level 2 "RURAL AREA – DAY" props: golden-hour farmland and small-town America, 1986 (the
// film's second half leaves LA for a small town and a motel). Everything is procedural: static
// parts are merged per material (Batch), repeats are instanced, and foliage/corn sway in the
// vertex shader off one shared clock that every animated prop's update() advances.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, solid, glow, neonMat, worldUV } from '../core/materials.js';
import * as TX from '../core/textures.js';

// ================================================================== helper kit

const PI = Math.PI, TAU = Math.PI * 2;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Applies a TRS transform to a geometry in place (Euler XYZ).
function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m4);
}

function normGeo(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

// Collects geometries per material and merges them into one mesh per material. `mpt` > 0
// projects world-scaled UVs in prop space (continuous across pieces); `off` shifts that
// projection per prop instance so repeated props don't share identical texture placement.
class Batch {
  constructor(off = null) { this.parts = new Map(); this.off = off; }
  add(material, geo, mpt = 0) {
    if (mpt) worldUV(geo, mpt, this.off);
    let a = this.parts.get(material);
    if (!a) this.parts.set(material, (a = []));
    a.push(geo);
    return geo;
  }
  build(parent, cast = true) {
    const out = [];
    for (const [m, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos.map(normGeo), false), m);
      mesh.castShadow = cast && !m.transparent && !m.userData.noShadow;
      mesh.receiveShadow = !m.transparent;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

const B = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
// Box with UVs projected in its own frame before placement (grain follows rotated boards).
const BL = (w, h, d, mpt, x, y, z, rx = 0, ry = 0, rz = 0, swap = false) =>
  place(worldUV(new THREE.BoxGeometry(w, h, d), mpt, null, swap), x, y, z, rx, ry, rz);
const RB = (w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0, seg = 2) => place(new RoundedBoxGeometry(w, h, d, seg, r), x, y, z, rx, ry, rz);
const cylX = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z, 0, 0, PI / 2);
const cylY = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z);
const cylZ = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z, PI / 2);

// Cylinder between two points.
function cylBetween(a, b, r0, r1 = r0, seg = 10, open = false) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  _m4.compose(_p.copy(a).lerp(b, 0.5), _q, _s.set(1, 1, 1));
  return g.applyMatrix4(_m4);
}

// Extrudes a polygon (x/y points, optional rectangular holes [x0,y0,x1,y1]) along +z from z0.
function extrude(pts, depth, z0 = 0, holes = [], bevel = 0) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [x0, y0, x1, y1] of holes) {
    const h = new THREE.Path();
    h.moveTo(x0, y0); h.lineTo(x0, y1); h.lineTo(x1, y1); h.lineTo(x1, y0); h.lineTo(x0, y0);
    sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 10 });
  return place(g, 0, 0, z0);
}

// Tube with radius tapering from r0 to r1 along a smooth curve through `pts` (branches, poles).
function taperTube(pts, r0, r1, radial = 7, segs = 0) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = segs || Math.max(2, pts.length * 3);
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], nor = [], uv = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const t = i / n, P = curve.getPointAt(t), N = frames.normals[i], Bn = frames.binormals[i];
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * Bn.x, ny = c * N.y + s * Bn.y, nz = c * N.z + s * Bn.z;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
      uv.push((j / radial) * Math.max(0.25, r0 * 2.2), (t * len) / 1.5);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b2 = a + radial + 1;
    idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Points along a hanging wire between a and b (parabolic sag approximation of a catenary).
function catenary(a, b, sag, n = 14) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(new THREE.Vector3().lerpVectors(a, b, t).add(V(0, -4 * sag * t * (1 - t), 0)));
  }
  return out;
}

const cacheM = new Map();
const once = (key, fn) => (cacheM.has(key) ? cacheM.get(key) : (cacheM.set(key, fn()), cacheM.get(key)));

function shade(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

// Seeded jitter helper: returns value in [-a, a].
const jit = (R, a) => (R() * 2 - 1) * a;

// ------------------------------------------------------------- shared materials

// Shared rural clock (foliage sway, neon); each animated prop's update() sets it.
const uTime = { value: 0 };

// Soft contact shadow under props (darkens ground where they meet it).
const blobMat = () => once('blobMat', () => new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, depthWrite: false, opacity: 0.55,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  map: TX.painted('rural_blob', 128, 128, (ctx, w, h) => {
    const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }),
}));
function blob(parent, w, d, x = 0, z = 0, opacity = 0.55) {
  const m = opacity === 0.55 ? blobMat() : once(`blob${opacity}`, () => { const c = blobMat().clone(); c.opacity = opacity; return c; });
  const mesh = new THREE.Mesh(once('planeXZ', () => new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)), m);
  mesh.scale.set(w, 1, d);
  mesh.position.set(x, 0.012, z);
  mesh.renderOrder = 1;
  parent.add(mesh);
  return mesh;
}

// Dirt / rain-splash grime rising from the ground on walls (vertical gradient with streaks).
const grimeMat = () => once('grimeMat', () => new THREE.MeshBasicMaterial({
  color: '#1c140c', transparent: true, depthWrite: false, opacity: 0.75,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  map: TX.painted('rural_grime', 256, 128, (ctx, w, h) => {
    const R = TX.rng(77);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = y / h;
      const n = TX.fbm(x / w * 12, y / h * 3, 12, 4, 5);
      const streak = TX.fbm(x / w * 40, y / h * 1.2, 40, 3, 9);
      const a = Math.max(0, Math.min(1, (v - 0.15 - n * 0.45) * 1.6 + streak * 0.35 * v));
      const j = (y * w + x) * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      img.data[j + 3] = a * a * 255;
    }
    ctx.putImageData(img, 0, 0);
    R();
  }),
}));
function grime(b, x, y0, w, h, z, ry = 0) {
  b.add(grimeMat(), place(new THREE.PlaneGeometry(w, h), x, y0 + h / 2, z, 0, ry, 0));
}

// Painted sign / decal material (cached per key).
function signMat(key, w, h, draw, extra = {}) {
  return once(`sign_${key}`, () => {
    const t = TX.painted(`rural_${key}`, w, h, draw);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.05, ...extra });
  });
}
// Distressed paint/weathering overlay for sign canvases.
function weather(ctx, w, h, seed = 1, amt = 0.35) {
  const R = TX.rng(seed);
  ctx.save();
  for (let i = 0; i < 260 * amt; i++) {
    ctx.globalAlpha = 0.08 + R() * 0.25;
    ctx.fillStyle = R() < 0.6 ? '#3b2a1c' : '#d8cfc0';
    const s = 1 + R() * 6 * (w / 512);
    ctx.fillRect(R() * w, R() * h, s * (0.5 + R() * 2), s * 0.6);
  }
  const gr = ctx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(40,25,10,0)'); gr.addColorStop(1, `rgba(40,25,10,${0.35 * amt})`);
  ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Hay with the library albedo toned down for golden-hour light.
const hayMat = () => once('hayMat', () => { const m = mat('hay').clone(); m.color.set('#cdbb98'); return m; });

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

// Plain-color helpers used throughout the rural set.
const M = {
  iron: () => solid('#24211e', 0.55, 0.75),
  ironRust: () => mat('rustMetal'),
  dark: () => solid('#120d09', 0.95, 0),
  rope: () => solid('#8d7a55', 0.95, 0),
  rubber: () => mat('rubber'),
  chrome: () => mat('chrome'),
  glass: () => mat('glassDark'),
  bulb: (c = '#ffd59a', k = 6) => glow(c, k),
};

// ------------------------------------------------------------- shared builders

// Vertical wooden ladder (rails + round rungs). Rails extend `over` above y1 as handholds.
function woodLadder(b, m, x, y0, y1, z, w = 0.52, over = 0.9) {
  const top = y1 + over, len = top - y0;
  b.add(m, BL(0.075, len, 0.055, 1.2, x - w / 2, y0 + len / 2, z, 0, 0, 0, true));
  b.add(m, BL(0.075, len, 0.055, 1.2, x + w / 2, y0 + len / 2, z, 0, 0, 0, true));
  for (let y = y0 + 0.28; y < top - 0.1; y += 0.3) b.add(m, cylX(0.022, w, x, y, z, 7), 1);
}

// Board-framed opening casing (trim around doors/windows) in the x/y plane at depth z.
function casing(b, m, x0, y0, x1, y1, z, t = 0.14, d = 0.045, sill = true) {
  b.add(m, BL(t, y1 - y0 + t, d, 1.6, x0 - t / 2, (y0 + y1) / 2 + t / 2, z, 0, 0, 0, true));
  b.add(m, BL(t, y1 - y0 + t, d, 1.6, x1 + t / 2, (y0 + y1) / 2 + t / 2, z, 0, 0, 0, true));
  b.add(m, BL(x1 - x0 + t * 2.4, t, d * 1.2, 1.6, (x0 + x1) / 2, y1 + t / 2, z + 0.004));
  if (sill) b.add(m, BL(x1 - x0 + t * 2.4, 0.06, d + 0.07, 1.6, (x0 + x1) / 2, y0 - 0.03, z + 0.035));
}

// X-braced board door leaf with perimeter frame (classic barn door). `rows` X panels stacked.
function xDoor(b, mBoard, mTrim, x, y, w, h, z, rows = 1, t = 0.07) {
  b.add(mBoard, BL(w, h, t, 2.4, x, y + h / 2, z));
  const f = 0.15, fz = z + t / 2 + 0.02;
  b.add(mTrim, BL(f, h, 0.04, 1.6, x - w / 2 + f / 2, y + h / 2, fz, 0, 0, 0, true));
  b.add(mTrim, BL(f, h, 0.04, 1.6, x + w / 2 - f / 2, y + h / 2, fz, 0, 0, 0, true));
  for (let r = 0; r <= rows; r++) b.add(mTrim, BL(w - f * 2, f, 0.04, 1.6, x, y + f / 2 + (h - f) * (r / rows), fz));
  const ih = (h - f * (rows + 1)) / rows, iw = w - f * 2;
  for (let r = 0; r < rows; r++) {
    const cy = y + f + ih / 2 + r * (ih + f), L = Math.hypot(iw, ih) - f * 0.6, a = Math.atan2(ih, iw);
    b.add(mTrim, BL(L, f * 0.9, 0.035, 1.6, x, cy, fz - 0.004, 0, 0, a));
    b.add(mTrim, BL(L, f * 0.9, 0.035, 1.6, x, cy, fz - 0.002, 0, 0, -a));
  }
}

// Multi-pane window: recessed dark glass, sash bars, casing. Returns nothing (batched).
function paneWindow(b, mTrim, x, yc, w, h, z, cols = 2, rows = 2, opt = {}) {
  const glass = opt.glass || M.glass(), sash = opt.sash || mTrim;
  b.add(glass, B(w, h, 0.02, x, yc, z - 0.06));
  if (opt.inner) b.add(opt.inner, B(w, h, 0.02, x, yc, z - 0.09));
  const s = 0.045;
  for (let i = 1; i < cols; i++) b.add(sash, B(s, h, 0.04, x - w / 2 + (w * i) / cols, yc, z - 0.04));
  for (let i = 1; i < rows; i++) b.add(sash, B(w, s, 0.04, x, yc - h / 2 + (h * i) / rows, z - 0.04));
  b.add(sash, B(w, s * 1.3, 0.05, x, yc - h / 2 + 0.02, z - 0.035));
  b.add(sash, B(w, s * 1.3, 0.05, x, yc + h / 2 - 0.02, z - 0.035));
  casing(b, mTrim, x - w / 2, yc - h / 2, x + w / 2, yc + h / 2, z, 0.12, 0.05, true);
}

// Alpha-tested foliage material with wind sway in the vertex shader and un-flipped normals on
// back faces (cards carry hand-authored "volume" normals). mode 0: sway weighted by the card's
// own height (grass, corn); mode 1: weighted by height in the prop (tree crowns, hedges).
function foliageMat(key, map, { sway = 0.06, mode = 0, height = 8, alphaTest = 0.45, color = '#ffffff', rough = 0.85 } = {}) {
  return once(`fol_${key}`, () => {
    const m = new THREE.MeshStandardMaterial({ map, alphaTest, side: THREE.DoubleSide, roughness: rough, color });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <project_vertex>', `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  vec3 wp = (modelMatrix * mvPosition).xyz;
  float hw = ${mode === 0 ? 'max(transformed.y, 0.0) * 2.0' : `pow(max(mvPosition.y, 0.0) / ${height.toFixed(2)}, 1.6)`};
  float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.05);
  float sx = sin(uTime * 1.3 + wp.x * 0.45 + wp.z * 0.3) * 0.7 + sin(uTime * 2.9 + wp.y * 1.7 + wp.x * 1.3) * 0.3;
  float sz = sin(uTime * 1.7 + wp.x * 0.6 + 1.3);
  mvPosition.x += sx * hw * ${sway.toFixed(3)} * gust;
  mvPosition.z += sz * hw * ${(sway * 0.5).toFixed(3)} * gust;
  mvPosition.y -= abs(sx) * hw * ${(sway * 0.15).toFixed(3)};
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;');
    };
    m.customProgramCacheKey = () => `fol_${key}`;
    return m;
  });
}

// Grass tuft card texture: tapered blades fanning from the bottom centre.
const tuftTex = (dry = 0.5) => TX.painted(`rural_tuft${dry}`, 256, 256, (ctx, w, h) => {
  const R = TX.rng(91 + Math.round(dry * 10));
  for (let i = 0; i < 90; i++) {
    const x0 = w / 2 + jit(R, w * 0.16), len = h * (0.3 + R() * 0.66), lean = jit(R, w * 0.42) * (0.4 + (1 - len / h));
    const hue = 48 + R() * 40 - dry * 18, sat = 28 + R() * 25, li = 22 + R() * 26 + dry * 14 * R();
    const bw = 2 + R() * 3.5;
    ctx.fillStyle = `hsl(${hue},${sat}%,${li}%)`;
    ctx.beginPath();
    ctx.moveTo(x0 - bw, h);
    ctx.quadraticCurveTo(x0 + lean * 0.25 - bw * 0.5, h - len * 0.55, x0 + lean, h - len);
    ctx.quadraticCurveTo(x0 + lean * 0.25 + bw * 0.5, h - len * 0.55, x0 + bw, h);
    ctx.fill();
  }
  // a few seed heads
  for (let i = 0; i < 6; i++) {
    const x = w / 2 + jit(R, w * 0.3), y = h * (0.05 + R() * 0.3);
    ctx.fillStyle = `hsl(${40 + R() * 10},35%,${55 + R() * 10}%)`;
    ctx.beginPath(); ctx.ellipse(x, y, 3, 10, jit(R, 0.4), 0, TAU); ctx.fill();
  }
});

// Instanced grass tufts (crossed cards). placeFn(R, o, i) positions each Object3D `o`.
function grassTufts(parent, n, seed, placeFn, dry = 0.5) {
  const geo = once('tuftGeo', () => {
    const a = new THREE.PlaneGeometry(0.7, 0.5).translate(0, 0.25, 0);
    const c = a.clone().rotateY(PI / 2);
    const m2 = mergeGeometries([a, c]);
    const nor = m2.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0.15, 0.95, 0.25);
    return m2;
  });
  const m = foliageMat(`tuft${dry}`, tuftTex(dry), { sway: 0.12, mode: 0, alphaTest: 0.5 });
  const im = new THREE.InstancedMesh(geo, m, n);
  const R = TX.rng(seed), o = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    o.position.set(0, 0, 0); o.rotation.set(0, R() * TAU, 0); o.scale.setScalar(0.6 + R() * 0.8);
    placeFn(R, o, i);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  }
  im.castShadow = false;
  im.receiveShadow = true;
  parent.add(im);
  return im;
}
// Tufts along a line on the ground (x0..x1 at depth z ± dz).
const tuftsAlong = (parent, n, seed, x0, x1, z, dz = 0.25, dry = 0.5) =>
  grassTufts(parent, n, seed, (R, o) => { o.position.set(x0 + R() * (x1 - x0), 0, z + jit(R, dz)); }, dry);

// Loose straw strands (instanced thin blades) scattered by a placement callback.
function strawStrands(parent, n, seed, placeFn, color = '#d9b86a') {
  const geo = once('strawGeo', () => {
    const a = new THREE.PlaneGeometry(0.26, 0.012);
    return a;
  });
  const m = once(`straw${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
  const im = new THREE.InstancedMesh(geo, m, n);
  const R = TX.rng(seed), o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    placeFn(R, o, i);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    c.setHSL(0.11 + R() * 0.03, 0.45 + R() * 0.2, 0.45 + R() * 0.25);
    im.setColorAt(i, c);
  }
  im.castShadow = false;
  im.receiveShadow = true;
  parent.add(im);
  return im;
}

// ===================================================================== BARN

/**
 * Classic red gambrel-roof barn, gable end facing the camera: weathered board-and-batten
 * siding, white trim, X-braced sliding doors (right leaf slid open), hay-loft door with hay
 * inside, hay hood + hoist beam with pulley and hook, cupola with weathervane, gooseneck lamp,
 * and an optional open-front machine lean-to on the right.
 * Origin: ground, centre of the barn body (lean-to extends to +x). Front face at z = depth/2.
 * @param {object} opts
 * @param {number} [opts.width=12]  gable width (x)
 * @param {number} [opts.height=8]  ridge height
 * @param {number} [opts.depth=10]  barn length (z)
 * @param {boolean} [opts.leanTo=true] add the machine lean-to (x: width/2 .. width/2 + 4.6)
 * @param {number} [opts.seed=1]
 * Colliders: ledge = loft landing deck (y = loftY ≈ 0.52·height, x ≈ -3.3..1.25);
 *   ledge = lean-to roof front edge (y = 3.2). Ladders: ground→landing at x = -(door/2+0.75);
 *   ground→lean-to roof. userData.loftY. Lights: barn lamp over the doors.
 *   (A gambrel roof has no flat ridge, so no ridge walkway.)
 */
export function makeBarn(opts = {}) {
  const { width: W = 12, height: H = 8, depth: D = 10, leanTo = true, seed = 1 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'barn';
  const b = new Batch(V(R() * 40, R() * 40, R() * 40));
  const red = mat('woodBarnRed'), white = mat('woodWhite'), roofM = mat('corrugated'), found = mat('concreteDry');
  const wood = mat('woodDark'), iron = M.iron(), dark = M.dark(), hay = hayMat();
  const eave = H * 0.45, kneeY = H * 0.78, kneeX = W * 0.34, zf = D / 2, fz = 0.45;
  const loftY = Math.round(H * 0.52 * 10) / 10;
  const dw = Math.min(4.2, W * 0.36), dh = Math.min(eave - 0.3, 3.4);
  const lw = 2.0, ly0 = loftY, ly1 = Math.min(loftY + 1.9, kneeY + (H - kneeY) * 0.35);
  const winX = (dw / 2 + W / 2) / 2 + 0.1, winY = 1.95, winW = 0.9, winH = 1.1;
  const prof = (x) => {
    const ax = Math.abs(x);
    if (ax >= W / 2) return eave;
    if (ax >= kneeX) return eave + ((W / 2 - ax) / (W / 2 - kneeX)) * (kneeY - eave);
    return kneeY + ((kneeX - ax) / kneeX) * (H - kneeY);
  };
  const gable = [[-W / 2, 0], [W / 2, 0], [W / 2, eave], [kneeX, kneeY], [0, H], [-kneeX, kneeY], [-W / 2, eave]];

  // --- shell: front gable (with openings), back gable, side walls
  const holes = [[-dw / 2, 0.001, dw / 2, dh], [-lw / 2, ly0, lw / 2, ly1], [-winX - winW / 2, winY - winH / 2, -winX + winW / 2, winY + winH / 2], [winX - winW / 2, winY - winH / 2, winX + winW / 2, winY + winH / 2]];
  // ExtrudeGeometry with a hole touching the outline is invalid, so the door hole starts just above 0.
  b.add(red, extrude(gable, 0.2, zf - 0.2, holes), 2.4);
  b.add(red, extrude(gable, 0.2, -zf), 2.4);
  b.add(red, B(0.2, eave, D - 0.02, -W / 2 + 0.1, eave / 2, 0), 2.4);
  b.add(red, B(0.2, eave, D - 0.02, W / 2 - 0.1, eave / 2, 0), 2.4);
  // floor of the ground interior and the loft (seen through the openings)
  b.add(mat('dirt'), B(W - 0.4, 0.04, D - 0.4, 0, 0.02, 0), 3);
  b.add(mat('woodPlankFloor'), B(W - 0.4, 0.12, D - 0.4, 0, loftY - 0.06, 0), 2);
  // interior gloom: back drop behind the loft and stall partitions behind the doors
  b.add(dark, B(lw + 1.2, ly1 - ly0 + 0.6, 0.05, 0, (ly0 + ly1) / 2, zf - 3.2));
  b.add(wood, B(0.12, dh, 3.6, -dw / 2 - 0.4, dh / 2, zf - 2.2), 2);
  b.add(wood, B(dw + 0.8, 1.3, 0.08, 0, 0.65, zf - 3.8), 2);
  b.add(wood, B(0.14, dh, 0.14, 0.5, dh / 2, zf - 2.6), 2);

  // --- foundation band (gap at the door)
  const fw = W / 2 - dw / 2;
  b.add(found, B(fw + 0.08, fz, 0.3, -dw / 2 - fw / 2 - 0.04, fz / 2, zf - 0.1), 1.5);
  b.add(found, B(fw + 0.08, fz, 0.3, dw / 2 + fw / 2 + 0.04, fz / 2, zf - 0.1), 1.5);
  b.add(found, B(0.3, fz, D, -W / 2 + 0.1, fz / 2, 0), 1.5);
  b.add(found, B(0.3, fz, D, W / 2 - 0.1, fz / 2, 0), 1.5);

  // --- battens on the gable (skip openings)
  const skip = (x, y) => (Math.abs(x) < dw / 2 + 0.2 && y < dh + 0.2) || (Math.abs(x) < lw / 2 + 0.2 && y > ly0 - 0.15 && y < ly1 + 0.2) ||
    (Math.abs(Math.abs(x) - winX) < winW / 2 + 0.2 && Math.abs(y - winY) < winH / 2 + 0.2);
  for (let x = -W / 2 + 0.6; x < W / 2 - 0.3; x += 0.6) {
    const top = prof(x) - 0.22;
    let y = fz, start = null;
    const step = 0.05;
    for (; y <= top; y += step) {
      const s = skip(x, y);
      if (!s && start === null) start = y;
      if ((s || y + step > top) && start !== null) {
        const end = s ? y : top;
        if (end - start > 0.15) b.add(red, BL(0.065, end - start, 0.035, 2.4, x, (start + end) / 2, zf + 0.0175, 0, 0, 0, true));
        start = null;
      }
    }
  }

  // --- white trim: corner boards, fascia along the gambrel, belt board at loft level
  for (const sx of [-1, 1]) {
    b.add(white, BL(0.2, eave - fz, 0.05, 1.6, sx * (W / 2 - 0.1), fz + (eave - fz) / 2, zf + 0.025, 0, 0, 0, true));
    b.add(white, BL(0.05, eave - fz, 0.2, 1.6, sx * (W / 2 + 0.025), fz + (eave - fz) / 2, zf - 0.1, 0, 0, 0, true));
  }
  const ovh = 0.45, rt = 0.09;
  const segs = [[[-W / 2, eave], [-kneeX, kneeY]], [[-kneeX, kneeY], [0, H]], [[0, H], [kneeX, kneeY]], [[kneeX, kneeY], [W / 2, eave]]];
  for (const [[x0, y0], [x1, y1]] of segs) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const nx = -dy / L, ny = dx / L; // outward/up normal (segments run left → right)
    // extend the lower ends past the walls as eave overhang
    const ex0 = x0 === -W / 2 ? 0.4 : 0, ex1 = x1 === W / 2 ? 0.4 : 0;
    const L2 = L + ex0 + ex1 + 0.06, cx = (x0 + x1) / 2 + ((ex1 - ex0) / 2) * (dx / L), cy = (y0 + y1) / 2 + ((ex1 - ex0) / 2) * (dy / L);
    // roof sheet (UV swapped so corrugation ribs run down the slope)
    b.add(roofM, BL(L2, rt, D + ovh * 2, 3.2, cx + nx * (rt / 2 + 0.02), cy + ny * (rt / 2 + 0.02), 0, 0, 0, a, true));
    // fascia (front rake board) and its shadow line
    b.add(white, BL(L2, 0.24, 0.05, 1.6, cx - nx * 0.08, cy - ny * 0.08, zf + ovh - 0.02, 0, 0, a));
    b.add(white, BL(L2, 0.24, 0.05, 1.6, cx - nx * 0.08, cy - ny * 0.08, -zf - ovh + 0.02, 0, 0, a));
    // rafter tails under the overhang
    b.add(wood, BL(L2, 0.14, ovh, 1.6, cx - nx * 0.05, cy - ny * 0.05, zf + ovh / 2 - 0.03, 0, 0, a));
  }
  // ridge cap
  b.add(mat('galvanized'), BL(0.5, 0.05, D + ovh * 2, 1.5, 0, H + rt + 0.04, 0));
  b.add(mat('galvanized'), BL(0.32, 0.12, D + ovh * 2, 1.5, 0, H + rt - 0.02, 0));
  b.add(white, BL(W * 0.95, 0.16, 0.05, 1.6, 0, ly0 - 0.2, zf + 0.03));

  // --- main doors: left leaf closed, right leaf slid open; track + hangers
  const lw2 = dw / 2 + 0.06;
  xDoor(b, red, white, -dw / 4 - 0.01, 0.02, lw2, dh + 0.06, zf + 0.09, 2);
  const slide = Math.min(1.5, dw * 0.36);
  xDoor(b, red, white, dw / 4 + slide, 0.02, lw2, dh + 0.06, zf + 0.12, 2);
  b.add(iron, B(dw + slide + 0.7, 0.1, 0.06, slide / 2 + 0.1, dh + 0.2, zf + 0.12));
  for (const x of [-dw / 2 + 0.25, -0.25, 0.25 + slide, dw / 2 - 0.25 + slide]) {
    b.add(iron, B(0.06, 0.26, 0.03, x, dh + 0.1, zf + 0.17));
    b.add(iron, cylZ(0.06, 0.04, x, dh + 0.24, zf + 0.17, 10));
  }
  b.add(iron, B(0.04, 0.4, 0.05, -0.18, 1.2, zf + 0.2));
  b.add(white, BL(dw + 0.5, 0.16, 0.05, 1.6, 0, dh + 0.42, zf + 0.03));

  // --- windows
  for (const sx of [-1, 1]) paneWindow(b, white, sx * winX, winY, winW, winH, zf + 0.05, 2, 3, { inner: dark });

  // --- hay loft: casing, open leaf, hay mound, bales, landing deck with knee braces
  casing(b, white, -lw / 2, ly0, lw / 2, ly1, zf + 0.03, 0.15, 0.05, false);
  {
    const leaf = new THREE.Group();
    const lb = new Batch();
    xDoor(lb, red, white, lw / 2, 0, lw, ly1 - ly0, 0, 1, 0.06);
    lb.add(iron, B(0.5, 0.06, 0.02, 0.25, 0.3, 0.07));
    lb.add(iron, B(0.5, 0.06, 0.02, 0.25, ly1 - ly0 - 0.3, 0.07));
    lb.build(leaf);
    leaf.position.set(-lw / 2, ly0, zf + 0.05);
    leaf.rotation.y = -1.95;
    leaf.name = 'loftDoor';
    g.add(leaf);
  }
  // hay inside the loft
  {
    const mound = new THREE.SphereGeometry(1, 18, 10, 0, TAU, 0, PI / 2);
    b.add(hay, place(mound.clone(), 0.15, loftY, zf - 1.9, 0, 0, 0, 1.7, 1.35, 1.4), 1.2);
    b.add(hay, place(mound, -0.75, loftY, zf - 0.8, 0, 0.4, 0, 0.8, 0.5, 0.7), 1.2);
    for (const [x, y, z] of [[0.75, 0, -1.0], [0.75, 0.48, -1.1], [-0.9, 0, -2.4]]) {
      b.add(hay, place(worldUV(new RoundedBoxGeometry(1.05, 0.46, 0.7, 2, 0.05), 1.2, null, true), x, loftY + 0.23 + y, zf + z, 0, 0.12 * (x > 0 ? 1 : -1), 0));
    }
  }
  // landing deck in front of the loft door
  const ldX0 = -dw / 2 - 1.2, ldX1 = lw / 2 + 0.25, ldD = 1.3;
  for (let x = ldX0 + 0.08; x < ldX1; x += 0.155) b.add(wood, BL(0.145, 0.07, ldD, 1.2, x, loftY - 0.035, zf + ldD / 2, 0, 0, 0, true));
  b.add(wood, BL(ldX1 - ldX0, 0.2, 0.09, 1.6, (ldX0 + ldX1) / 2, loftY - 0.17, zf + ldD - 0.05));
  for (const x of [ldX0 + 0.1, (ldX0 + ldX1) / 2, ldX1 - 0.1]) {
    b.add(wood, BL(0.1, 0.18, ldD, 1.2, x, loftY - 0.16, zf + ldD / 2, 0, 0, 0, true));
    const L = Math.hypot(1.0, ldD - 0.1);
    b.add(wood, BL(0.09, L, 0.09, 1.2, x, loftY - 0.7, zf + (ldD - 0.1) / 2, Math.atan2(ldD - 0.1, 1.0), 0, 0, true));
  }
  // ladder up to the landing
  const ladX = -dw / 2 - 0.75;
  woodLadder(b, wood, ladX, 0, loftY, zf + 0.25, 0.5, 0.95);

  // --- hay hood + hoist beam + pulley + rope + hook
  {
    // pointed hood: steeper than the roof, ridge just above the main ridge, projecting forward
    const ha = 0.72, hx = 1.3, hl = hx / Math.cos(ha), hd = 1.75, hz0 = zf - 0.1, hy = H + 0.22;
    for (const s of [-1, 1]) {
      const cx = (s * hx) / 2, cy = hy - (hx * Math.tan(ha)) / 2;
      b.add(roofM, BL(hl + 0.12, rt, hd, 3.2, cx, cy + rt / 2, hz0 + hd / 2, 0, 0, -s * ha, true));
      b.add(white, BL(hl + 0.12, 0.2, 0.05, 1.6, cx - s * 0.05, cy - 0.1, hz0 + hd + 0.02, 0, 0, -s * ha));
    }
    b.add(white, BL(0.12, 0.12, hd + 0.04, 1.6, 0, hy + 0.04, hz0 + hd / 2));
    const by = hy - hx * Math.tan(ha) + 0.05, bz = zf + 1.45;
    b.add(wood, BL(0.18, 0.24, 2.0, 1.5, 0, by, zf + 0.4, 0, 0, 0));
    b.add(iron, cylX(0.13, 0.06, 0, by - 0.24, bz - 0.15, 14));
    b.add(iron, B(0.04, 0.3, 0.04, -0.05, by - 0.12, bz - 0.15));
    b.add(iron, B(0.04, 0.3, 0.04, 0.05, by - 0.12, bz - 0.15));
    const ropeBot = loftY + 0.9;
    b.add(M.rope(), cylBetween(V(0, by - 0.3, bz - 0.02), V(0.02, ropeBot, bz - 0.05), 0.016, 0.016, 6));
    b.add(M.rope(), cylBetween(V(0, by - 0.3, bz - 0.28), V(-0.25, loftY + 0.15, zf + 0.55), 0.016, 0.016, 6));
    const hook = new THREE.TorusGeometry(0.11, 0.022, 6, 12, PI * 1.3);
    b.add(iron, place(hook, 0.02, ropeBot - 0.13, bz - 0.05, 0, 0, -PI * 0.15));
    b.add(iron, cylY(0.03, 0.08, 0.02, ropeBot - 0.02, bz - 0.05, 8));
  }

  // --- cupola + weathervane on the ridge
  {
    const cy0 = H - 0.2, cw = Math.min(1.5, W * 0.12), ch = 1.0;
    b.add(white, BL(cw, ch, cw, 1.6, 0, cy0 + ch / 2, 0));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) b.add(white, BL(cw * 0.7, 0.03, 0.09, 1.6, 0, cy0 + 0.3 + i * 0.12, s * (cw / 2 + 0.015), s * 0.6, 0, 0));
      b.add(dark, B(cw * 0.7, 0.62, 0.02, 0, cy0 + 0.55, s * (cw / 2 - 0.02)));
    }
    const cone = new THREE.ConeGeometry(cw * 0.9, 0.7, 4, 1);
    b.add(mat('galvanized'), place(cone, 0, cy0 + ch + 0.35, 0, 0, PI / 4, 0), 1);
    b.add(iron, cylY(0.018, 1.0, 0, cy0 + ch + 1.1, 0, 6));
    b.add(iron, B(0.9, 0.025, 0.025, 0, cy0 + ch + 1.25, 0, 0, 0.5, 0));
    b.add(iron, place(new THREE.ConeGeometry(0.06, 0.16, 4), 0.45 * Math.cos(0.5), cy0 + ch + 1.25, -0.45 * Math.sin(0.5), 0, 0.5, -PI / 2));
    // rooster silhouette
    const rooster = [[0, 0], [0.32, 0], [0.38, 0.12], [0.3, 0.2], [0.33, 0.33], [0.27, 0.38], [0.22, 0.3], [0.12, 0.22], [-0.05, 0.3], [-0.12, 0.45], [-0.08, 0.22], [-0.02, 0.1]];
    b.add(iron, place(extrude(rooster, 0.015, -0.0075), -0.15, cy0 + ch + 1.3, 0, 0, 0.5, 0));
    for (const [dx, dz] of [[0.25, 0], [0, 0.25]]) b.add(iron, B(dx ? 0.5 : 0.02, 0.02, dz ? 0.5 : 0.02, 0, cy0 + ch + 1.0, 0));
  }

  // --- gooseneck barn lamp above the doors
  {
    const lx = dw / 2 + 0.6, ly = dh + 0.85;
    b.add(iron, place(new THREE.TorusGeometry(0.28, 0.022, 6, 14, PI / 2), lx, ly - 0.02, zf + 0.04, PI / 2, 0, 0));
    b.add(iron, cylBetween(V(lx, ly + 0.26, zf + 0.04), V(lx, ly + 0.27, zf + 0.04), 0.02));
    b.add(iron, B(0.18, 0.3, 0.02, lx, ly + 0.22, zf + 0.04));
    const shadeG = new THREE.CylinderGeometry(0.06, 0.3, 0.18, 18, 1, true);
    b.add(solid('#2f4a3a', 0.45, 0.4, { side: THREE.DoubleSide }), place(shadeG, lx, ly - 0.08, zf + 0.33));
    b.add(M.bulb('#ffd7a0', 4), place(new THREE.SphereGeometry(0.075, 10, 8), lx, ly - 0.16, zf + 0.33));
    g.userData.lights = [{ pos: V(lx, ly - 0.4, zf + 0.6), color: '#ffc27a', intensity: 6, distance: 8 }];
  }

  // --- lean-to machine shed on the right (open front, mono-pitch roof draining to the back)
  const colliders = [{ type: 'ledge', x0: ldX0, x1: ldX1, y: loftY }];
  const ladders = [{ x: ladX, y0: 0, y1: loftY, z: zf + 0.25, w: 0.5 }];
  if (leanTo) {
    const LW = 4.6, hf = 3.2, hb = 2.5, x0 = W / 2, x1 = W / 2 + LW, zr = zf + 0.25;
    const a = Math.atan2(hf - hb, D + 0.5);
    const rz0 = -zf - 0.25;
    // roof: top surface at the front edge is exactly hf
    const midY = hf - ((zr - (zr + rz0) / 2) * Math.tan(a));
    b.add(roofM, BL(LW + 0.3, 0.08, (zr - rz0) / Math.cos(a), 3.2, x0 + LW / 2 + 0.1, midY - 0.04 / Math.cos(a), (zr + rz0) / 2, a, 0, 0, true));
    b.add(white, BL(LW + 0.3, 0.26, 0.05, 1.6, x0 + LW / 2 + 0.1, hf - 0.15, zr + 0.01));
    b.add(wood, BL(LW, 0.24, 0.16, 1.6, x0 + LW / 2, hf - 0.35, zf - 0.15));
    for (const px of [x0 + 0.15, x0 + LW / 2, x1 - 0.12]) {
      b.add(wood, BL(0.18, hf - 0.4, 0.18, 1.2, px, (hf - 0.4) / 2, zf - 0.15, 0, 0, 0, true));
      b.add(found, B(0.3, 0.12, 0.3, px, 0.06, zf - 0.15), 1);
    }
    // knee braces at the posts
    for (const px of [x0 + LW / 2]) for (const s of [-1, 1]) b.add(wood, BL(0.08, 0.85, 0.08, 1.2, px + s * 0.3, hf - 0.75, zf - 0.15, 0, 0, s * 0.78, true));
    // side + back walls
    b.add(red, B(0.15, hb, D, x1 - 0.06, hb / 2, -0.2), 2.4);
    b.add(red, B(LW, hb, 0.15, x0 + LW / 2, hb / 2, -zf + 0.1), 2.4);
    b.add(white, BL(0.05, hb, 0.18, 1.6, x1 + 0.0, hb / 2, zf - 0.3, 0, 0, 0, true));
    // stuff under the lean-to: barrels, bales, old wagon wheel
    for (const [x, z] of [[x0 + 0.6, zf - 1.6], [x0 + 1.25, zf - 1.9]]) b.add(mat('rustMetal'), cylY(0.3, 0.9, x, 0.45, z, 16), 1);
    b.add(hay, place(worldUV(new RoundedBoxGeometry(1.1, 0.45, 0.7, 2, 0.05), 1.2, null, true), x1 - 1.1, 0.23, zf - 1.5, 0, 0.2, 0));
    b.add(hay, place(worldUV(new RoundedBoxGeometry(1.1, 0.45, 0.7, 2, 0.05), 1.2, null, true), x1 - 1.0, 0.69, zf - 1.6, 0, -0.1, 0));
    const wheel = new THREE.TorusGeometry(0.55, 0.04, 6, 24);
    b.add(wood, place(wheel, x0 + 2.6, 0.58, zf - 2.6, 0, 0, 0));
    for (let i = 0; i < 6; i++) b.add(wood, place(new THREE.BoxGeometry(1.06, 0.035, 0.035), x0 + 2.6, 0.58, zf - 2.6, 0, 0, (i / 6) * PI));
    const llx = x1 - 0.55;
    woodLadder(b, wood, llx, 0, hf, zr + 0.18, 0.5, 0.9);
    colliders.push({ type: 'ledge', x0: x0, x1: x1 + 0.25, y: hf });
    ladders.push({ x: llx, y0: 0, y1: hf, z: zr + 0.18, w: 0.5 });
    grime(b, x0 + LW / 2, 0, LW, 1.0, -zf + 0.18);
    blob(g, LW + 1, D + 1, x0 + LW / 2, 0, 0.35);
  }

  // --- barn quilt (painted star block hung as a diamond) on the upper gable
  {
    const qs = Math.min(1.3, W * 0.1), qx = Math.min(kneeX - 0.9, lw / 2 + 1.5), qy = (ly0 + ly1) / 2 + 0.1;
    const qm = signMat('barnQuilt', 256, 256, (ctx, w, h) => {
      const cols = ['#e9e0c9', '#9c2a1e', '#23395b', '#d4a23a'];
      ctx.fillStyle = cols[0]; ctx.fillRect(0, 0, w, h);
      const c = w / 4;
      const tri = (x0, y0, x1, y1, x2, y2, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.fill(); };
      // eight-point star (Ohio star variant)
      ctx.fillStyle = cols[2]; ctx.fillRect(c, c, c * 2, c * 2);
      ctx.fillStyle = cols[3]; ctx.fillRect(c * 1.5, c * 1.5, c, c);
      for (const [ax, ay, bx, by, cx, cy] of [[c, c, 3 * c, c, 2 * c, 0], [c, 3 * c, 3 * c, 3 * c, 2 * c, 4 * c], [c, c, c, 3 * c, 0, 2 * c], [3 * c, c, 3 * c, 3 * c, 4 * c, 2 * c]]) tri(ax, ay, bx, by, cx, cy, cols[1]);
      for (const [x, y] of [[0, 0], [3 * c, 0], [0, 3 * c], [3 * c, 3 * c]]) { tri(x, y, x + c, y, x, y + c, cols[2]); tri(x + c, y + c, x + c, y, x, y + c, cols[1]); }
      ctx.strokeStyle = '#1b1712'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
      weather(ctx, w, h, 11, 0.8);
    });
    b.add(white, BL(qs + 0.1, qs + 0.1, 0.05, 1.6, qx, qy, zf + 0.04, 0, 0, PI / 4));
    b.add(qm, place(new THREE.PlaneGeometry(qs, qs), qx, qy, zf + 0.067, 0, 0, PI / 4));
  }
  // lightning rods with blue glass balls along the ridge
  for (const z of [-D * 0.32, D * 0.3]) {
    b.add(iron, cylY(0.012, 1.1, 0, H + rt + 0.6, z, 5));
    b.add(solid('#3b6fb0', 0.08, 0.1, { transparent: true, opacity: 0.85 }), place(new THREE.SphereGeometry(0.07, 12, 8), 0, H + rt + 0.55, z));
  }
  // milk cans + pitchfork leaning by the right window
  {
    const can = once('milkCan', () => new THREE.LatheGeometry([[0, 0], [0.17, 0], [0.17, 0.02], [0.16, 0.45], [0.1, 0.55], [0.09, 0.62], [0.11, 0.64], [0.11, 0.68], [0, 0.69]].map(([x, y]) => new THREE.Vector2(x, y)), 18));
    for (const [x, z, ry] of [[winX - 0.25, zf + 0.35, 0], [winX + 0.15, zf + 0.42, 1], [winX + 0.5, zf + 0.75, 2]]) {
      b.add(mat('galvanized'), place(can.clone(), x, 0, z, 0, ry, 0), 0.8);
    }
    const fx = winX + 0.95, lean = 0.28;
    b.add(wood, cylBetween(V(fx, 0, zf + 0.42), V(fx + 0.06, 1.55, zf + 0.42 - lean + 0.08), 0.02, 0.02, 6));
    for (let i = -2; i <= 1; i++) b.add(iron, cylBetween(V(fx + 0.07 + i * 0.035, 1.53, zf + 0.15), V(fx + 0.07 + i * 0.04, 1.93, zf + 0.06), 0.008, 0.005, 4));
    b.add(iron, B(0.17, 0.04, 0.03, fx + 0.055, 1.55, zf + 0.15));
  }

  // --- grime at the base of the front wall
  grime(b, -dw / 2 - fw / 2, fz, fw, 1.3, zf + 0.04);
  grime(b, dw / 2 + fw / 2, fz, fw, 1.3, zf + 0.04);
  b.build(g);

  // loose straw spilling from the loft sill and around the doors
  strawStrands(g, 220, seed + 5, (R2, o, i) => {
    if (i < 70) {
      o.position.set(jit(R2, lw / 2), loftY + 0.02 + R2() * 0.04, zf + R2() * 0.25);
      o.rotation.set(-PI / 2 + jit(R2, 0.3), 0, R2() * TAU);
    } else if (i < 100) {
      o.position.set(jit(R2, lw / 2 - 0.1), loftY - 0.02 - R2() * 0.12, zf + 0.02 + R2() * 0.2);
      o.rotation.set(jit(R2, 0.4), R2() * 0.4, PI / 2 + jit(R2, 0.5));
    } else {
      const a = R2() * TAU, r = Math.sqrt(R2()) * 2.6;
      o.position.set(Math.cos(a) * r * 1.4 + 0.4, 0.015, zf + 0.8 + Math.sin(a) * r * 0.5);
      o.rotation.set(-PI / 2, 0, R2() * TAU);
    }
    o.scale.setScalar(0.6 + R2() * 0.8);
  });
  blob(g, W + 1.2, D + 1.4, 0, 0, 0.5);
  tuftsAlong(g, 26, seed + 9, -W / 2 - 0.4, -dw / 2 - 0.2, zf + 0.25, 0.2);
  tuftsAlong(g, 22, seed + 10, dw / 2 + slide + 0.2, W / 2 + 0.4, zf + 0.25, 0.2);
  if (leanTo) tuftsAlong(g, 14, seed + 11, W / 2 + 4.6 - 0.2, W / 2 + 5.2, zf, 0.6);

  g.userData.colliders = colliders;
  g.userData.ladders = ladders;
  g.userData.loftY = loftY;
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ===================================================================== SHED

/**
 * Weathered wooden outbuilding (the C64 level's sheds): grey board siding, rusty tin roof that is
 * flat in x (drains to the back), Z-braced plank door with strap hinges, four-pane window with a
 * broken pane, front ladder, oil drum, tyres, lantern, and a firewood rack on the left.
 * Origin: ground, centre of the shed body. Front face at z = depth/2.
 * @param {object} opts
 * @param {number} [opts.width=6]   (x)
 * @param {number} [opts.height=4]  roof top at the front edge
 * @param {number} [opts.depth=4]   (z)
 * @param {number} [opts.seed=2]
 * Colliders: ledge = roof (y = height, x = ±(width/2 + 0.3)); ledge = firewood rack top.
 * Ladders: ground → roof at x = width/2 − 0.45.
 */
export function makeShed(opts = {}) {
  const { width: W = 6, height: H = 4, depth: D = 4, seed = 2 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'shed';
  const b = new Batch(V(R() * 40, R() * 40, R() * 40));
  const plank = mat('woodGrey'), dk = mat('woodDark'), roofM = mat('corrugatedRed'), iron = M.iron(), dark = M.dark();
  const zf = D / 2, wallTop = H - 0.12, base = 0.22;
  // body + block footing
  b.add(plank, B(W, wallTop - base, D, 0, base + (wallTop - base) / 2, 0), 2.0);
  b.add(mat('concreteDry'), B(W + 0.06, base, D + 0.06, 0, base / 2, 0), 1.2);
  for (const sx of [-1, 1]) {
    b.add(dk, BL(0.14, wallTop - base, 0.05, 1.4, sx * (W / 2 - 0.07), base + (wallTop - base) / 2, zf + 0.025, 0, 0, 0, true));
    b.add(dk, BL(0.05, wallTop - base, 0.14, 1.4, sx * (W / 2 + 0.025), base + (wallTop - base) / 2, zf - 0.07, 0, 0, 0, true));
  }
  // roof: flat across x, sloping to the back; front edge top = H exactly
  const ov = 0.3, a = Math.atan2(0.35, D + ov * 2), zr = zf + ov, zb = -zf - ov, L = (zr - zb) / Math.cos(a);
  const midY = H - (zr - (zr + zb) / 2) * Math.tan(a);
  b.add(roofM, BL(W + ov * 2, 0.07, L, 3.0, 0, midY - 0.035 / Math.cos(a), (zr + zb) / 2, a, 0, 0, true));
  b.add(dk, BL(W + ov * 2, 0.22, 0.05, 1.6, 0, H - 0.13, zr + 0.01));
  b.add(dk, BL(W, 0.16, 0.14, 1.6, 0, wallTop - 0.08, zf + 0.07));
  for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 6) b.add(dk, BL(0.07, 0.13, ov + 0.08, 1, x, H - 0.13, zf + ov / 2, 0, 0, 0, true));
  // door (Z-braced) with frame, strap hinges, latch
  const dx = -W * 0.22, dwid = 1.1, dht = 2.15, dz = zf + 0.04;
  b.add(dark, B(dwid + 0.02, dht, 0.02, dx, base + dht / 2, zf + 0.002));
  b.add(mat('woodRail'), BL(dwid, dht, 0.05, 2.0, dx, base + dht / 2, dz, 0, 0, 0, true));
  for (let i = 1; i < 6; i++) b.add(dark, B(0.012, dht, 0.01, dx - dwid / 2 + (dwid * i) / 6, base + dht / 2, dz + 0.026));
  for (const yy of [0.35, dht - 0.35]) b.add(dk, BL(dwid - 0.1, 0.14, 0.04, 1.4, dx, base + yy, dz + 0.045));
  {
    const ih = dht - 0.84, L2 = Math.hypot(dwid - 0.24, ih);
    b.add(dk, BL(L2, 0.13, 0.035, 1.4, dx, base + dht / 2, dz + 0.042, 0, 0, -Math.atan2(ih, dwid - 0.24)));
  }
  for (const yy of [0.35, dht - 0.35]) {
    b.add(iron, B(0.55, 0.05, 0.015, dx - dwid / 2 + 0.27, base + yy, dz + 0.072));
    b.add(iron, cylY(0.022, 0.12, dx - dwid / 2 - 0.02, base + yy, dz + 0.03, 6));
  }
  b.add(iron, B(0.18, 0.04, 0.03, dx + dwid / 2 - 0.15, base + 1.05, dz + 0.07));
  casing(b, dk, dx - dwid / 2, base, dx + dwid / 2, base + dht, zf + 0.02, 0.12, 0.05, false);
  // window: four panes, one broken (shard + dark hole)
  const wx = W * 0.14, wy = 1.75, ww = 1.0, wh = 0.85;
  b.add(dark, B(ww, wh, 0.02, wx, wy, zf - 0.1));
  b.add(mat('glassDark'), B(ww / 2, wh, 0.015, wx - ww / 4, wy, zf - 0.06));
  b.add(mat('glassDark'), B(ww / 2, wh / 2, 0.015, wx + ww / 4, wy - wh / 4, zf - 0.06));
  b.add(mat('glassDark'), place(extrude([[0, 0], [ww / 2, 0], [ww / 2, 0.14], [0.14, 0.3], [0, 0.12]], 0.015), wx, wy, zf - 0.068));
  paneWindow(b, mat('woodRail'), wx, wy, ww, wh, zf + 0.04, 2, 2, { glass: dark });
  // lantern on a hook, horseshoe over the door, rusty sign
  const lnx = dx + dwid / 2 + 0.35;
  b.add(iron, B(0.03, 0.03, 0.18, lnx, 2.15, zf + 0.09));
  b.add(iron, place(new THREE.TorusGeometry(0.05, 0.008, 4, 10), lnx, 2.1, zf + 0.17, 0, PI / 2, 0));
  b.add(solid('#5b1d14', 0.5, 0.5), cylY(0.08, 0.05, lnx, 2.02, zf + 0.17, 10));
  b.add(solid('#5b1d14', 0.5, 0.5), cylY(0.075, 0.04, lnx, 1.79, zf + 0.17, 10));
  b.add(solid('#d9cfa5', 0.1, 0, { transparent: true, opacity: 0.55 }), cylY(0.06, 0.19, lnx, 1.9, zf + 0.17, 10));
  b.add(iron, place(new THREE.TorusGeometry(0.09, 0.018, 5, 12, PI * 1.25), dx, base + dht + 0.3, zf + 0.05, 0, 0, -PI * 0.125 + PI));
  const sm = signMat('noTrespass', 512, 192, (ctx, w, h) => {
    ctx.fillStyle = '#d8cfb8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9b1d16'; ctx.fillRect(0, 0, w, 52);
    ctx.fillStyle = '#efe7d4'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('NO', w / 2, 42);
    ctx.fillStyle = '#1d1a16'; ctx.font = `bold 62px ${FONT}`; ctx.fillText('TRESPASSING', w / 2, 128);
    ctx.font = `bold 22px ${FONT}`; ctx.fillText('VIOLATORS WILL BE PROSECUTED', w / 2, 172);
    weather(ctx, w, h, 5, 1);
    const R2 = TX.rng(9);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${110 + R2() * 40},${50 + R2() * 20},20,${0.3 + R2() * 0.4})`; ctx.beginPath(); ctx.arc(R2() * w, R2() * h, 2 + R2() * 12, 0, TAU); ctx.fill(); }
  });
  b.add(sm, place(new THREE.PlaneGeometry(0.9, 0.34), wx, 2.85, zf + 0.012, 0, 0, 0.03));
  for (const [x, y] of [[-0.42, 0.14], [0.42, 0.14], [-0.42, -0.14], [0.42, -0.14]]) b.add(iron, cylZ(0.012, 0.02, wx + x, 2.85 + y, zf + 0.02, 5));
  // ladder at the right front corner
  const lx = W / 2 - 0.45;
  woodLadder(b, dk, lx, 0, H, zr + 0.12, 0.48, 0.9);
  // oil drum + tyres
  const drum = once('drumLathe', () => new THREE.LatheGeometry([[0, 0], [0.29, 0], [0.29, 0.02], [0.28, 0.03], [0.28, 0.29], [0.295, 0.3], [0.28, 0.31], [0.28, 0.59], [0.295, 0.6], [0.28, 0.61], [0.28, 0.86], [0.29, 0.87], [0.29, 0.89], [0, 0.89]].map(([x, y]) => new THREE.Vector2(x, y)), 20));
  b.add(solid('#2c4a66', 0.6, 0.4), place(drum.clone(), -W / 2 + 0.45, 0, zf + 0.5, 0, R() * 3, 0));
  b.add(mat('rustMetal'), place(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 20), -W / 2 + 0.45, 0.885, zf + 0.5), 0.6);
  const tyre = once('tyreGeo', () => new THREE.TorusGeometry(0.32, 0.12, 8, 18).rotateX(PI / 2).scale(1, 1.25, 1));
  for (let i = 0; i < 2; i++) b.add(M.rubber(), place(tyre.clone(), W / 2 - 1.25, 0.15 + i * 0.3, zf + 0.6, 0, 0, jit(R, 0.05)));
  b.add(M.rubber(), place(tyre.clone(), W / 2 - 1.95, 0.4, zf + 0.42, PI / 2 - 0.25, 0, 0.1));
  // firewood rack on the left: log ends face the camera, top is level (a ledge)
  const fx0 = -W / 2 - 1.55, fx1 = -W / 2 - 0.12, logR = 0.1, rows = 5, logTop = 0.12 + rows * logR * 2;
  b.add(dk, BL(fx1 - fx0 + 0.1, 0.1, 0.9, 1.2, (fx0 + fx1) / 2, 0.06, zf - 0.6));
  for (const x of [fx0, fx1]) b.add(dk, BL(0.09, logTop + 0.25, 0.09, 1.2, x, (logTop + 0.25) / 2, zf - 0.2, 0, 0, 0, true));
  const logGeo = once('logGeo', () => new THREE.CylinderGeometry(1, 1, 1, 9).rotateX(PI / 2));
  const endM = signMat('logEnd', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a07a4e'; ctx.fillRect(0, 0, w, h);
    for (let r = 60; r > 0; r -= 6) { ctx.strokeStyle = `rgba(90,60,30,${0.25 + (r % 12 ? 0.1 : 0.2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w / 2 + 3, h / 2 - 2, r, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(40,25,10,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w * 0.9, h * 0.3); ctx.stroke();
  });
  for (let r = 0; r < rows; r++) {
    const n = Math.floor((fx1 - fx0 - 0.1) / (logR * 2));
    for (let i = 0; i < n; i++) {
      const rr = logR * (0.85 + R() * 0.2), x = fx0 + 0.1 + logR + i * logR * 2 + (r % 2) * logR * 0.5, y = 0.12 + logR + r * logR * 2;
      if (x + rr > fx1 - 0.04) continue;
      const len = 0.8 + R() * 0.12, z = zf - 0.6 + jit(R, 0.05);
      b.add(mat('barkOak'), place(logGeo.clone(), x, y, z, 0, 0, R() * 3, rr, rr, len));
      b.add(endM, place(new THREE.CircleGeometry(rr * 0.92, 9), x, y, z + len / 2 + 0.002));
    }
  }
  // grime, blob, tufts
  grime(b, 0, base, W, 1.1, zf + 0.012);
  b.build(g);
  blob(g, W + 1.5, D + 1.2, 0, 0, 0.5);
  blob(g, 2.2, 1.6, (fx0 + fx1) / 2, zf - 0.5, 0.45);
  tuftsAlong(g, 18, seed + 3, -W / 2 - 1.8, W / 2 + 0.6, zf + 0.15, 0.25);
  g.userData.colliders = [
    { type: 'ledge', x0: -W / 2 - ov, x1: W / 2 + ov, y: H },
    { type: 'ledge', x0: fx0, x1: fx1, y: logTop },
  ];
  g.userData.ladders = [{ x: lx, y0: 0, y1: H, z: zr + 0.12, w: 0.48 }];
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ================================================================ HAY BALES

const baleEndTex = () => TX.painted('rural_baleEnd', 256, 256, (ctx, w, h) => {
  const R = TX.rng(17);
  ctx.fillStyle = '#9c7a3c'; ctx.fillRect(0, 0, w, h);
  const C = w / 2;
  for (let i = 0; i < 2600; i++) {
    const t = Math.sqrt(R()), r = t * C * 0.98, a = R() * TAU;
    const len = 0.15 + R() * 0.5;
    ctx.strokeStyle = `hsl(${38 + R() * 10},${40 + R() * 25}%,${32 + R() * 34}%)`;
    ctx.lineWidth = 1 + R() * 1.6;
    ctx.beginPath(); ctx.arc(C, C, Math.max(1, r), a, a + len); ctx.stroke();
  }
  const gr = ctx.createRadialGradient(C, C, 0, C, C, C);
  gr.addColorStop(0, 'rgba(60,40,15,0.45)'); gr.addColorStop(0.3, 'rgba(60,40,15,0)'); gr.addColorStop(0.92, 'rgba(60,40,15,0)'); gr.addColorStop(1, 'rgba(60,40,15,0.5)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
});

/**
 * Hay bales. `kind: 'square'` → stepped stack of rectangular bales (two deep) with baling twine
 * and loose straw — a platforming staircase. `kind: 'round'` → round bales (axis toward the
 * camera, spiral ends) stacked as a log pyramid, some in plastic wrap.
 * Origin: ground, centre of the bottom row.
 * @param {object} opts
 * @param {'square'|'round'} [opts.kind='square']
 * @param {number} [opts.count]  bales in the bottom row (square default 4, round default 3)
 * @param {number} [opts.rows]   stack levels, clamped to count (square default 3, round default 2)
 * @param {'pyramid'|'left'|'right'} [opts.stair='pyramid'] square: where the steps rise (left/right = flush side)
 * @param {number} [opts.wrapped=0.4] round: fraction in plastic wrap
 * @param {number} [opts.seed=3]
 * Colliders: square → one `solid` per level {x0,x1,y0,y1} (bale 1.2 × 0.6 m); round → `ledge`
 * on the crown (±0.3 m) of every uncovered bale (r = 0.75 m).
 */
export function makeHayBales(opts = {}) {
  const { kind = 'square', seed = 3 } = opts;
  return kind === 'round' ? roundBales(opts, seed) : squareBales(opts, seed);
}

function squareBales(opts, seed) {
  const count = Math.max(1, opts.count ?? 4), rows = Math.max(1, Math.min(opts.rows ?? 3, count)), stair = opts.stair || 'pyramid';
  const L = 1.2, Hh = 0.6, Dd = 0.82;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'hayBales';
  const b = new Batch();
  const hayM = hayMat(), twine = solid('#c46f2c', 0.7, 0);
  const baleGeo = once('baleGeo', () => new RoundedBoxGeometry(L - 0.03, Hh - 0.012, Dd - 0.03, 2, 0.07));
  const colliders = [], tops = [];
  const m4 = new THREE.Matrix4(), part = (geo) => geo.applyMatrix4(m4);
  for (let k = 0; k < rows; k++) {
    const n = count - k;
    const x0 = stair === 'left' ? -count * L / 2 : stair === 'right' ? count * L / 2 - n * L : -count * L / 2 + (k * L) / 2;
    colliders.push({ type: 'solid', x0, x1: x0 + n * L, y0: k * Hh, y1: (k + 1) * Hh });
    for (let i = 0; i < n; i++) {
      for (let zr = 0; zr < 2; zr++) {
        if (zr === 0 && k === rows - 1 && R() < 0.3) continue; // occasional missing back bale on top
        const cx = x0 + L / 2 + i * L + jit(R, 0.012), cy = k * Hh + Hh / 2, cz = (zr ? Dd / 2 : -Dd / 2) + jit(R, 0.05);
        m4.compose(_p.set(cx, cy, cz), _q.setFromEuler(_e.set(0, jit(R, 0.05), jit(R, 0.006))), _s.set(1, 1, 1));
        b.add(hayM, part(worldUV(baleGeo.clone(), 1.1, V(R() * 9, R() * 9, R() * 9), true)));
        for (const tx of [-L * 0.27, L * 0.27]) {
          b.add(twine, part(B(0.022, 0.008, Dd - 0.06, tx, Hh / 2 - 0.004, 0)));
          b.add(twine, part(B(0.022, Hh - 0.08, 0.008, tx, 0, Dd / 2 - 0.011)));
          b.add(twine, part(B(0.022, Hh - 0.08, 0.008, tx, 0, -Dd / 2 + 0.011)));
        }
        if (zr === 1) tops.push([cx, (k + 1) * Hh, cz]);
      }
    }
  }
  b.build(g);
  // loose straw: on top faces, sticking out of the front faces, and on the ground
  strawStrands(g, 40 + count * 40, seed + 7, (R2, o, i) => {
    const t = tops[i % tops.length];
    const mode = i % 3;
    if (mode === 0) {
      o.position.set(t[0] + jit(R2, L / 2), t[1] + 0.005, t[2] + jit(R2, Dd / 2));
      o.rotation.set(-PI / 2 + jit(R2, 0.2), 0, R2() * TAU);
    } else if (mode === 1) {
      o.position.set(t[0] + jit(R2, L / 2), t[1] - R2() * Hh, t[2] + Dd / 2 + 0.02);
      o.rotation.set(jit(R2, 0.6), jit(R2, 0.8), R2() * TAU);
    } else {
      o.position.set(colliders[0].x0 + (count * L) / 2 + jit(R2, count * L / 2 + 0.8), 0.012, Dd + R2() * 0.9 - 0.2);
      o.rotation.set(-PI / 2, 0, R2() * TAU);
    }
    o.scale.setScalar(0.6 + R2() * 0.9);
  });
  blob(g, count * L + 0.8, Dd * 2 + 0.7, colliders[0].x0 + (count * L) / 2, 0, 0.55);
  g.userData.colliders = colliders;
  return g;
}

function roundBales(opts, seed) {
  const count = Math.max(1, opts.count ?? 3), rows = Math.max(1, Math.min(opts.rows ?? 2, count)), wrapped = opts.wrapped ?? 0.4;
  const r = 0.75, len = 1.25, gap = 0.04;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'hayBalesRound';
  const b = new Batch();
  const hayM = hayMat();
  const endM = once('baleEndMat', () => new THREE.MeshStandardMaterial({ map: baleEndTex(), roughness: 0.95, normalMap: TX.noiseNormal(256, 131, 16, 4) }));
  const wrapTex = (key, base) => TX.painted(`rural_wrap${key}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    const R2 = TX.rng(key.length + 3);
    for (let i = 0; i < 14; i++) { // overlapping stretch-film bands
      ctx.fillStyle = `rgba(${R2() < 0.5 ? '255,255,255' : '40,45,40'},${0.04 + R2() * 0.07})`;
      const y = R2() * h; ctx.save(); ctx.translate(0, y); ctx.rotate(-0.25 + R2() * 0.1); ctx.fillRect(-w, 0, w * 3, 20 + R2() * 40); ctx.restore();
    }
    for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(0,0,0,${0.05 + R2() * 0.08})`; ctx.lineWidth = 1; ctx.beginPath(); const x = R2() * w, y = R2() * h; ctx.moveTo(x, y); ctx.lineTo(x + 20 + R2() * 40, y + jit(R2, 6)); ctx.stroke(); }
  });
  const wrapM = once('wrapWhite', () => new THREE.MeshStandardMaterial({ map: wrapTex('w', '#a9aea6'), roughness: 0.38 }));
  const wrapG = once('wrapGreen', () => new THREE.MeshStandardMaterial({ map: wrapTex('g', '#56704a'), roughness: 0.42 }));
  const side = once('baleSide', () => {
    const c = new THREE.CylinderGeometry(r, r, len, 30, 1, true).rotateX(PI / 2);
    const uv = c.attributes.uv; // swap so straw runs around the bale
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v * (len / 1.1), u * ((TAU * r) / 1.1)); }
    return c;
  });
  const capF = once('baleCap', () => new THREE.CircleGeometry(r * 0.985, 30));
  const dome = once('baleDome', () => { const rs = (r * 0.995) / Math.sin(0.32); return new THREE.SphereGeometry(rs, 30, 4, 0, TAU, 0, 0.32).rotateX(PI / 2).translate(0, 0, -rs * Math.cos(0.32)); });
  const colliders = [], levels = [];
  for (let k = 0; k < rows; k++) {
    const n = count - k, row = [];
    for (let i = 0; i < n; i++) row.push({ x: (i - (n - 1) / 2) * (2 * r + gap), y: r + k * Math.sqrt(3) * (r + gap / 2) });
    levels.push(row);
  }
  levels.forEach((row, k) => row.forEach((p) => {
    const wrap = R() < wrapped, z = jit(R, 0.12), rz = R() * TAU, wm = R() < 0.75 ? wrapM : wrapG;
    b.add(wrap ? wm : hayM, place(side.clone(), p.x, p.y, z, 0, 0, rz));
    for (const s of [1, -1]) {
      const zz = z + (s * len) / 2;
      if (wrap) b.add(wm, place(dome.clone(), p.x, p.y, zz, 0, s < 0 ? PI : 0, rz));
      else b.add(endM, place(capF.clone(), p.x, p.y, zz + s * 0.002, 0, s < 0 ? PI : 0, rz));
    }
    const covered = k + 1 < rows && levels[k + 1].some((q) => Math.abs(q.x - p.x) < 2 * r);
    if (!covered) colliders.push({ type: 'ledge', x0: p.x - 0.3, x1: p.x + 0.3, y: p.y + r });
  }));
  b.build(g);
  strawStrands(g, 60 * count, seed + 3, (R2, o) => {
    o.position.set(jit(R2, count * (r + gap) + 0.6), 0.012, jit(R2, len / 2 + 0.7));
    o.rotation.set(-PI / 2, 0, R2() * TAU);
    o.scale.setScalar(0.6 + R2() * 0.9);
  });
  blob(g, count * (2 * r + gap) + 0.8, len + 1.2, 0, 0, 0.55);
  g.userData.colliders = colliders;
  return g;
}

// Box beam of section w × d running from a to b.
function beamBetween(a, b, w, d, roll = 0) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const geo = new THREE.BoxGeometry(w, len, d);
  if (roll) geo.rotateY(roll);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  _m4.compose(_p.copy(a).lerp(b, 0.5), _q, _s.set(1, 1, 1));
  return geo.applyMatrix4(_m4);
}

// Cylindrical UVs around a vertical axis (cx, cz); u = arc length at radius r0, v = height.
function cylUV(geo, mpt = 2, cx = 0, cz = 0, r0 = 1, v0 = 0) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (Math.atan2(p.getX(i) - cx, p.getZ(i) - cz) * r0) / mpt;
    uv[i * 2 + 1] = (p.getY(i) + v0) / mpt;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Galvanised steel ladder (two flat rails + round rungs); optional safety cage hoops.
function steelLadder(b, m, x, y0, y1, z, w = 0.46, { cage = 0, over = 1.0, cageFrom = 2.2 } = {}) {
  const top = y1 + over, len = top - y0;
  for (const s of [-1, 1]) b.add(m, B(0.05, len, 0.012, x + (s * w) / 2, y0 + len / 2, z));
  for (let y = y0 + 0.3; y < top - 0.05; y += 0.3) b.add(m, cylX(0.014, w, x, y, z, 6));
  if (cage) {
    const rc = 0.38;
    for (let y = y0 + cageFrom; y <= top; y += 0.9) b.add(m, place(new THREE.TorusGeometry(rc, 0.016, 4, 14, PI), x, y, z + 0.02, PI / 2, 0, PI));
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * PI;
      b.add(m, B(0.035, top - y0 - cageFrom, 0.008, x + Math.cos(a) * rc, y0 + cageFrom + (top - y0 - cageFrom) / 2, z + 0.02 + Math.sin(a) * rc));
    }
  }
}

// ================================================================== WINDMILL

/**
 * American farm windpump: tapered four-leg lattice tower (angle-iron legs, girts, X rods), a
 * service platform below the head, an 18-blade galvanised wheel with sail rings (named child
 * `rotor`, spins in update with gusting speed), gearbox head and painted tail vane (child
 * `head`, yawed toward the camera), pump rod, pump jack and a round stock tank with water.
 * Origin: ground, tower centre. The wheel faces +z (rotated by opts.yaw).
 * @param {object} opts
 * @param {number} [opts.height=10] hub height ≈ height
 * @param {number} [opts.yaw=0.85]  head yaw (radians) so wheel and vane both read from the side
 * @param {number} [opts.seed=4]
 * Colliders: ledge = platform (y = height − 2.6, x = ±1.1). Ladders: ground → platform at x = 0
 * (inside the open lattice, through a hatch).
 */
export function makeWindmill(opts = {}) {
  const { height: H = 10, yaw = 0.85, seed = 4 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'windmill';
  const b = new Batch();
  const steel = mat('galvanized'), dk = mat('woodDark'), iron = M.iron();
  const top = H - 0.7, wb = 1.45, wt = 0.32;
  const halfW = (y) => wb + (wt - wb) * (y / top);
  // legs (angle iron approximated with thin rotated boxes)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = V(sx * wb, 0, sz * wb), c = V(sx * wt, top, sz * wt);
    b.add(steel, beamBetween(a, c, 0.075, 0.075, PI / 4));
    b.add(mat('concreteDry'), B(0.45, 0.25, 0.45, sx * wb, 0.08, sz * wb), 1);
  }
  // girts + X rods per panel
  const levels = [0.35, 2.3, 4.1, 5.7, 7.0, top - 0.05].filter((y) => y < top);
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i], hw = halfW(y);
    for (const s of [-1, 1]) {
      b.add(steel, B(hw * 2, 0.05, 0.05, 0, y, s * hw));
      b.add(steel, B(0.05, 0.05, hw * 2, s * hw, y, 0));
    }
    if (i + 1 < levels.length) {
      const y2 = levels[i + 1], hw2 = halfW(y2);
      for (const s of [-1, 1]) {
        b.add(steel, cylBetween(V(-hw, y, s * hw), V(hw2, y2, s * hw2), 0.011, 0.011, 4));
        b.add(steel, cylBetween(V(hw, y, s * hw), V(-hw2, y2, s * hw2), 0.011, 0.011, 4));
        b.add(steel, cylBetween(V(s * hw, y, -hw), V(s * hw2, y2, hw2), 0.011, 0.011, 4));
        b.add(steel, cylBetween(V(s * hw, y, hw), V(s * hw2, y2, -hw2), 0.011, 0.011, 4));
      }
    }
  }
  // service platform (wood deck on steel frame), hatch for the ladder
  const py = H - 2.6, pw = 1.1;
  for (let x = -pw + 0.07; x < pw; x += 0.14) {
    if (Math.abs(x) < 0.3) continue;
    b.add(dk, BL(0.13, 0.05, pw * 2, 1.2, x, py - 0.025, 0, 0, 0, 0, true));
  }
  for (const zz of [-pw + 0.07, pw - 0.07]) for (let x = -0.3; x < 0.3; x += 0.14) b.add(dk, BL(0.13, 0.05, 0.14, 1.2, x + 0.07, py - 0.025, zz));
  for (const s of [-1, 1]) {
    b.add(steel, B(pw * 2, 0.08, 0.05, 0, py - 0.09, s * (pw - 0.03)));
    b.add(steel, B(0.05, 0.08, pw * 2, s * (pw - 0.03), py - 0.09, 0));
  }
  // ladder up the middle (through the hatch) and pump rod behind it
  steelLadder(b, steel, 0, 0, py, 0.22, 0.4, { over: 1.0 });
  b.add(iron, cylY(0.016, top - 0.6, 0, (top - 0.6) / 2 + 0.6, -0.12, 5));
  // pump jack + spout + stock tank
  b.add(iron, cylY(0.08, 0.9, 0, 0.45, -0.12, 10));
  b.add(iron, cylBetween(V(0, 0.75, -0.12), V(0.75, 0.68, -0.12), 0.04, 0.04, 8));
  b.add(iron, B(0.05, 0.6, 0.05, 0.12, 1.0, -0.12));
  const tx = 2.35, tr = 1.05;
  const tank = once('stockTank', () => new THREE.CylinderGeometry(tr, tr, 0.62, 36, 1, true));
  b.add(steel, cylUV(place(tank.clone(), tx, 0.31, 0.2), 0.6, tx, 0.2, tr));
  b.add(steel, cylUV(place(new THREE.CylinderGeometry(tr - 0.03, tr - 0.03, 0.6, 36, 1, true).scale(-1, 1, 1), tx, 0.31, 0.2), 0.6, tx, 0.2, tr));
  b.add(steel, place(new THREE.TorusGeometry(tr, 0.025, 5, 36), tx, 0.62, 0.2, PI / 2, 0, 0));
  for (let i = 0; i < 4; i++) b.add(steel, place(new THREE.TorusGeometry(tr + 0.006, 0.012, 4, 36), tx, 0.12 + i * 0.13, 0.2, PI / 2, 0, 0));
  b.add(once('waterMat', () => new THREE.MeshPhysicalMaterial({ color: '#1d2a26', roughness: 0.05, metalness: 0, clearcoat: 1 })), place(new THREE.CircleGeometry(tr - 0.03, 36), tx, 0.5, 0.2, -PI / 2, 0, 0));
  b.add(iron, cylBetween(V(0.75, 0.68, -0.12), V(tx - 0.6, 0.66, 0.0), 0.03, 0.03, 6));
  b.build(g);

  // --- head: turntable, gearbox, wheel, tail
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, top, 0);
  head.rotation.y = yaw;
  const hb = new Batch();
  hb.add(steel, cylY(0.22, 0.25, 0, 0.12, 0, 14));
  hb.add(steel, RB(0.36, 0.42, 0.75, 0.08, 0, 0.45, 0.05));
  hb.add(solid('#8e2a20', 0.6, 0.3), RB(0.38, 0.12, 0.6, 0.05, 0, 0.7, 0.05));
  hb.add(iron, cylZ(0.05, 0.5, 0, 0.5, 0.55, 10));
  // tail boom + vane
  hb.add(steel, cylBetween(V(0, 0.55, -0.2), V(0, 0.85, -2.6), 0.035, 0.03, 6));
  hb.add(steel, cylBetween(V(0, 0.3, -0.2), V(0, 0.45, -2.3), 0.02, 0.02, 5));
  const vaneM = signMat('windVane', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b7bcbe'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8e9496'; ctx.lineWidth = 4;
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.fillStyle = '#9b2a1f'; ctx.font = `bold 92px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WESTSTAR', w / 2, h * 0.45);
    ctx.font = `bold 30px ${FONT}`; ctx.fillStyle = '#2a2a2a'; ctx.fillText('HAYDEN · KANSAS', w / 2, h * 0.78);
    weather(ctx, w, h, 23, 1.2);
    const R2 = TX.rng(4);
    for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(120,55,20,${0.2 + R2() * 0.4})`; ctx.fillRect(R2() * w, R2() * h * 0.3, 2 + R2() * 4, 20 + R2() * 80); }
  }, { side: THREE.DoubleSide, metalness: 0.4, roughness: 0.6 });
  const vane = new THREE.PlaneGeometry(1.7, 0.85);
  hb.add(vaneM, place(vane, 0, 0.8, -2.6, 0, -PI / 2, 0.04));
  hb.add(steel, B(0.03, 0.9, 0.04, 0.0, 0.8, -1.75));
  hb.build(head);
  g.add(head);

  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  rotor.position.set(0, 0.5, 0.82);
  const rb = new Batch();
  const rOut = 1.8, rIn = 0.5, nBl = 18;
  const blade = once('wmBlade', () => {
    const geo = new THREE.BoxGeometry(0.2, rOut - rIn, 0.008, 1, 3, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { // widen toward the tip and curve the sheet
      const t = (p.getY(i) + (rOut - rIn) / 2) / (rOut - rIn);
      p.setX(i, p.getX(i) * (0.6 + t * 0.7));
      p.setZ(i, p.getZ(i) - Math.abs(p.getX(i)) * 0.25);
    }
    geo.computeVertexNormals();
    return geo.translate(0, (rOut + rIn) / 2, 0);
  });
  for (let i = 0; i < nBl; i++) {
    const a = (i / nBl) * TAU;
    rb.add(steel, place(blade.clone().rotateY(0.45), 0, 0, 0, 0, 0, a));
  }
  for (const rr of [0.95, rOut - 0.08]) rb.add(steel, place(new THREE.TorusGeometry(rr, 0.018, 4, 48), 0, 0, -0.02));
  for (let i = 0; i < 6; i++) rb.add(steel, place(new THREE.BoxGeometry(0.03, rOut * 2 - 0.1, 0.03), 0, 0, -0.03, 0, 0, (i / 6) * PI));
  rb.add(iron, cylZ(0.16, 0.22, 0, 0, 0.02, 14));
  rb.add(solid('#8e2a20', 0.6, 0.3), place(new THREE.SphereGeometry(0.12, 12, 8, 0, TAU, 0, PI / 2), 0, 0, 0.13, PI / 2, 0, 0));
  rb.build(rotor);
  head.add(rotor);
  // spokes are centred boxes: shift them out so they read as arms from hub to rim
  blob(g, wb * 2 + 1.5, wb * 2 + 1.5, 0, 0, 0.45);
  blob(g, tr * 2.4, tr * 2.4, tx, 0.2, 0.4);
  grassTufts(g, 26, seed + 2, (R2, o) => { const a = R2() * TAU, r = 0.8 + R2() * 2.4; o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); });

  let ang = R() * TAU;
  g.userData.colliders = [{ type: 'ledge', x0: -pw, x1: pw, y: py }];
  g.userData.ladders = [{ x: 0, y0: 0, y1: py, z: 0.22, w: 0.4 }];
  g.userData.update = (dt, t) => {
    uTime.value = t;
    const w = 2.2 + Math.sin(t * 0.23) * 0.9 + Math.sin(t * 0.71) * 0.4;
    ang += w * dt;
    rotor.rotation.z = ang;
    head.rotation.y = yaw + Math.sin(t * 0.11) * 0.06;
  };
  return g;
}

// ============================================================== WATER TOWER

/**
 * Small-town water tower painted "HAYDEN": riveted steel tank with a conical roof, finial and
 * blinking red obstruction light, shallow bowl bottom, four splayed tubular legs with struts and
 * X tension rods, central riser pipe, and a grated balcony ring with railing around the tank.
 * Origin: ground, tower centre. Tank radius 3.2 m; the balcony's front walkway is at local
 * z ≈ 3.3..4.1 (place the tower so that strip sits on the gameplay plane).
 * @param {object} opts
 * @param {number} [opts.height=14]  top of the finial
 * @param {string} [opts.name='HAYDEN']
 * @param {number} [opts.seed=5]
 * Colliders: ledge = balcony (y = balconyY ≈ 0.55·height, x = ±4.15). Ladders: ground → balcony
 * at x = 3.65 (right side, through a hatch). Lights: red beacon on the roof.
 */
export function makeWaterTowerRural(opts = {}) {
  const { height: H = 14, name = 'HAYDEN', seed = 5 } = opts;
  const g = new THREE.Group();
  g.name = 'waterTower';
  const b = new Batch();
  const Rt = 3.2, tankH = 4.0, by = Math.round(H * 0.55 * 10) / 10, tTop = by + tankH;
  const paint = solid('#aab3b7', 0.55, 0.55), roofP = solid('#8c979c', 0.5, 0.6), steel = mat('galvanized'), iron = M.iron();
  // tank side with painted name (u = 0.5 faces +z)
  const tankM = once(`towerTank${name}`, () => {
    const t = TX.painted(`rural_tower_${name}`, 2048, 420, (ctx, w, h) => {
      ctx.fillStyle = '#b6c0c4'; ctx.fillRect(0, 0, w, h);
      const R2 = TX.rng(31);
      // panel seams + rivets
      ctx.strokeStyle = 'rgba(70,80,86,0.55)'; ctx.lineWidth = 3;
      for (const y of [h * 0.33, h * 0.66]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let x = 0; x < w; x += 128) for (let r = 0; r < 3; r++) { const o = r % 2 ? 64 : 0; ctx.beginPath(); ctx.moveTo(x + o, r * h / 3); ctx.lineTo(x + o, (r + 1) * h / 3); ctx.stroke(); }
      ctx.fillStyle = 'rgba(60,66,70,0.6)';
      for (let x = 0; x < w; x += 12) for (const y of [h * 0.33, h * 0.66, 6, h - 6]) { ctx.beginPath(); ctx.arc(x, y + 6, 2, 0, TAU); ctx.fill(); }
      // rust weeping + grime
      for (let i = 0; i < 160; i++) {
        const x = R2() * w, y0 = [6, h * 0.33, h * 0.66][Math.floor(R2() * 3)], len = 20 + R2() * 140;
        const gr = ctx.createLinearGradient(0, y0, 0, y0 + len);
        gr.addColorStop(0, `rgba(122,58,22,${0.25 + R2() * 0.45})`); gr.addColorStop(1, 'rgba(122,58,22,0)');
        ctx.fillStyle = gr; ctx.fillRect(x, y0, 2 + R2() * 6, len);
      }
      const gg = ctx.createLinearGradient(0, 0, 0, h);
      gg.addColorStop(0, 'rgba(40,40,35,0.25)'); gg.addColorStop(0.2, 'rgba(40,40,35,0)'); gg.addColorStop(0.85, 'rgba(60,45,30,0)'); gg.addColorStop(1, 'rgba(60,45,30,0.35)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
      // the name, centred at u = 0.5 (front)
      ctx.save();
      ctx.font = `900 150px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 12; ctx.strokeStyle = '#f2efe6'; ctx.strokeText(name, w / 2, h * 0.5);
      ctx.fillStyle = '#1f3b6b'; ctx.fillText(name, w / 2, h * 0.5);
      ctx.restore();
      weather(ctx, w, h, 37, 0.6);
    });
    t.wrapS = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.45, normalMap: TX.noiseNormal(256, 141, 24, 1.5) });
    m.normalScale.set(0.25, 0.25);
    return m;
  });
  const side = new THREE.CylinderGeometry(Rt, Rt, tankH, 64, 1, true, PI, TAU);
  b.add(tankM, place(side, 0, by + tankH / 2, 0));
  // bowl, roof, finial
  b.add(paint, place(new THREE.SphereGeometry(Rt, 48, 8, 0, TAU, PI / 2, PI / 2), 0, by, 0, 0, 0, 0, 1, 0.35, 1));
  b.add(roofP, place(new THREE.ConeGeometry(Rt + 0.2, 1.5, 64, 1, true), 0, tTop + 0.75, 0));
  b.add(paint, place(new THREE.TorusGeometry(Rt + 0.02, 0.05, 6, 64), 0, tTop, 0, PI / 2, 0, 0));
  b.add(steel, cylY(0.25, 0.35, 0, tTop + 1.55, 0, 12));
  b.add(steel, place(new THREE.ConeGeometry(0.4, 0.3, 12), 0, tTop + 1.85, 0));
  b.add(iron, cylY(0.03, 0.8, 0, tTop + 2.3, 0, 6));
  b.add(steel, place(new THREE.SphereGeometry(0.1, 10, 8), 0, tTop + 2.72, 0));
  const beacon = M.bulb('#ff2a1a', 6);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), beacon.clone());
  bulb.position.set(0, tTop + 2.0, 0.3);
  g.add(bulb);
  b.add(iron, cylZ(0.02, 0.3, 0, tTop + 1.95, 0.15, 6));
  // legs, struts, tension rods, riser
  const legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = V(sx * 3.0, 0, sz * 3.0), c = V(sx * Rt * 0.72, by + 0.2, sz * Rt * 0.72);
    legs.push([a, c]);
    b.add(paint, cylBetween(a, c, 0.17, 0.15, 14));
    b.add(mat('concreteDry'), B(0.8, 0.3, 0.8, a.x, 0.1, a.z), 1);
  }
  const lerpLeg = (i, t) => new THREE.Vector3().lerpVectors(legs[i][0], legs[i][1], t);
  for (const t of [0.42, 0.78]) {
    for (let i = 0; i < 4; i++) b.add(paint, cylBetween(lerpLeg(i, t), lerpLeg((i + 1) % 4, t), 0.06, 0.06, 8));
  }
  for (const [t0, t1] of [[0.05, 0.42], [0.42, 0.78], [0.78, 0.98]]) {
    for (let i = 0; i < 4; i++) {
      b.add(iron, cylBetween(lerpLeg(i, t0), lerpLeg((i + 1) % 4, t1), 0.015, 0.015, 4));
      b.add(iron, cylBetween(lerpLeg((i + 1) % 4, t0), lerpLeg(i, t1), 0.015, 0.015, 4));
    }
  }
  b.add(paint, cylY(0.45, by - 0.9, 0, (by - 0.9) / 2, 0, 18));
  b.add(mat('concreteDry'), cylY(0.9, 0.3, 0, 0.12, 0, 18), 1);
  // balcony: grating ring + railing
  const r0 = Rt + 0.05, r1 = Rt + 0.95;
  const deck = new THREE.RingGeometry(r0, r1, 64, 1).rotateX(-PI / 2);
  { const p = deck.attributes.position, uv = deck.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.2, p.getZ(i) / 1.2); }
  const grate = once('towerGrate', () => { const m = mat('steelPainted').clone(); m.map = TX.grating({ color: '#4a5258' }).map; m.alphaTest = 0.5; m.side = THREE.DoubleSide; return m; });
  b.add(grate, place(deck, 0, by + 0.02, 0));
  b.add(paint, place(new THREE.TorusGeometry(r1, 0.04, 4, 64), 0, by - 0.02, 0, PI / 2, 0, 0));
  b.add(paint, place(new THREE.TorusGeometry(r1, 0.03, 5, 64), 0, by + 1.05, 0, PI / 2, 0, 0));
  b.add(paint, place(new THREE.TorusGeometry(r1, 0.02, 4, 64), 0, by + 0.55, 0, PI / 2, 0, 0));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    b.add(paint, cylY(0.022, 1.05, Math.sin(a) * r1, by + 0.52, Math.cos(a) * r1, 5));
    if (i % 2 === 0) b.add(iron, beamBetween(V(Math.sin(a) * r1, by - 0.03, Math.cos(a) * r1), V(Math.sin(a) * (Rt - 0.05), by - 0.55, Math.cos(a) * (Rt - 0.05)), 0.04, 0.04));
  }
  // ladder ground → balcony on the right, with standoff arms to the legs
  const lx = Rt + 0.45;
  steelLadder(b, steel, lx, 0, by, 0, 0.42, { cage: 1, over: 1.0, cageFrom: 2.4 });
  for (const t of [0.42, 0.78]) {
    const y = (by + 0.2) * t, x = 3.0 + (Rt * 0.72 - 3.0) * t;
    b.add(iron, cylBetween(V(lx - 0.2, y, 0), V(x, y, 0), 0.025, 0.025, 5));
  }
  b.build(g);
  blob(g, 7.5, 7.5, 0, 0, 0.4);
  grassTufts(g, 30, seed + 1, (R2, o) => { const a = R2() * TAU, r = 0.5 + R2() * 3.6; o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); });
  const light = { pos: V(0, tTop + 2.0, 0.6), color: '#ff2a1a', intensity: 6, distance: 8 };
  g.userData.lights = [light];
  g.userData.colliders = [{ type: 'ledge', x0: -r1, x1: r1, y: by + 0.02 }];
  g.userData.ladders = [{ x: lx, y0: 0, y1: by + 0.02, z: 0, w: 0.42 }];
  g.userData.balconyY = by + 0.02;
  g.userData.update = (dt, t) => {
    uTime.value = t;
    const on = Math.sin(t * PI * 0.8) > 0.2 ? 1 : 0.05;
    bulb.material.emissiveIntensity = 6 * on;
    light.intensity = 6 * on;
  };
  return g;
}

// ===================================================================== SILO

/**
 * Concrete-stave grain silo with steel hoops, galvanised dome cap, filler pipe gooseneck,
 * unloading chute, caged ladder and a small top landing with railing.
 * Origin: ground, silo centre. Front of the wall at z = radius.
 * @param {object} opts
 * @param {number} [opts.height=14]  wall top (dome adds ≈ 0.55·radius)
 * @param {number} [opts.radius=2.4]
 * @param {number} [opts.seed=6]
 * Colliders: ledge = top landing (y = height, x = −1.05..0.35). Ladders: ground → top at x = −0.5.
 */
export function makeSilo(opts = {}) {
  const { height: H = 14, radius: Rs = 2.4, seed = 6 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'silo';
  const b = new Batch();
  const conc = mat('concreteDry'), steel = mat('galvanized'), iron = M.iron(), hoopM = solid('#3a3632', 0.6, 0.6);
  b.add(conc, cylUV(new THREE.CylinderGeometry(Rs, Rs, H, 48, 1, true).translate(0, H / 2, 0), 1.5, 0, 0, Rs, R() * 10));
  b.add(conc, place(new THREE.CylinderGeometry(Rs + 0.12, Rs + 0.18, 0.35, 48), 0, 0.17, 0), 1.5);
  let y = 0.5;
  while (y < H - 0.2) {
    b.add(hoopM, place(new THREE.TorusGeometry(Rs + 0.012, 0.018, 4, 48), 0, y, 0, PI / 2, 0, 0));
    y += 0.35 + (y / H) * 0.5;
  }
  b.add(steel, place(new THREE.TorusGeometry(Rs + 0.02, 0.06, 6, 48), 0, H, 0, PI / 2, 0, 0));
  const dome = new THREE.SphereGeometry(Rs + 0.06, 48, 12, 0, TAU, 0, PI / 2).scale(1, 0.55, 1).translate(0, H, 0);
  b.add(steel, cylUV(dome, 0.6, 0, 0, Rs));
  b.add(steel, place(new THREE.CylinderGeometry(0.35, 0.4, 0.4, 16), 0, H + Rs * 0.55 + 0.1, 0));
  b.add(steel, place(new THREE.ConeGeometry(0.5, 0.35, 16), 0, H + Rs * 0.55 + 0.45, 0));
  // unloading chute down the front (left of the ladder)
  const cx = -1.25, cz = Rs * Math.cos(Math.asin(1.25 / Rs)) + 0.25;
  b.add(steel, B(0.6, H - 0.6, 0.42, cx, (H - 0.6) / 2 + 0.6, cz - 0.05), 1.5);
  for (let yy = 1.2; yy < H; yy += 0.75) b.add(iron, B(0.66, 0.04, 0.46, cx, yy, cz - 0.05));
  b.add(steel, B(0.9, 0.5, 0.9, cx, 0.35, cz + 0.1), 1);
  // filler pipe: up the left side, gooseneck over the dome
  const fp = [V(-Rs - 0.25, 0.8, 0.4), V(-Rs - 0.25, H * 0.5, 0.4), V(-Rs - 0.25, H + 0.3, 0.4), V(-Rs * 0.7, H + Rs * 0.55 + 0.4, 0.3), V(-0.25, H + Rs * 0.55 + 0.35, 0.1)];
  b.add(steel, taperTube(fp, 0.12, 0.12, 10, 30));
  for (let yy = 2; yy < H; yy += 2.5) b.add(iron, B(0.32, 0.05, 0.08, -Rs - 0.12, yy, 0.4));
  // caged ladder + top landing with railing
  const lx = -0.5, lz = Rs * Math.cos(Math.asin(0.5 / Rs)) + 0.32;
  steelLadder(b, steel, lx, 0, H, lz, 0.42, { cage: 1, over: 1.1, cageFrom: 2.5 });
  const lx0 = lx - 0.55, lx1 = lx + 0.85, lcx = (lx0 + lx1) / 2;
  b.add(iron, B(lx1 - lx0, 0.06, 0.8, lcx, H - 0.03, Rs + 0.05));
  b.add(steel, B(lx1 - lx0, 0.02, 0.8, lcx, H + 0.005, Rs + 0.05));
  for (const xx of [lx0, lx1]) b.add(steel, cylY(0.022, 1.05, xx, H + 0.52, Rs + 0.42, 6));
  b.add(steel, cylX(0.022, lx1 - lx0, lcx, H + 1.05, Rs + 0.42, 6));
  b.add(steel, cylX(0.018, lx1 - lx0, lcx, H + 0.55, Rs + 0.42, 6));
  for (const yy of [H * 0.25, H * 0.5, H * 0.75]) b.add(iron, B(0.6, 0.05, 0.3, lx, yy, lz - 0.2));
  // faded painted band
  const bandM = signMat('siloBand', 640, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(150,40,30,0.85)'; ctx.fillRect(0, 20, w, h - 40);
    ctx.fillStyle = 'rgba(238,230,214,0.9)'; ctx.font = `bold 64px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MILLER FARMS', w / 2, h / 2 + 2);
    weather(ctx, w, h, 41, 1.5);
  }, { transparent: true, alphaTest: 0.1 });
  const band = new THREE.CylinderGeometry(Rs + 0.02, Rs + 0.02, 0.9, 32, 1, true, -0.02, 1.25);
  b.add(bandM, place(band, 0, H * 0.78, 0));
  b.build(g);
  blob(g, Rs * 3, Rs * 3, 0, 0, 0.5);
  grassTufts(g, 24, seed + 4, (R2, o) => { const a = R2() * PI + PI * 0.05, r = Rs + 0.2 + R2() * 1.2; o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.9); });
  g.userData.colliders = [{ type: 'ledge', x0: lx0, x1: lx1, y: H }];
  g.userData.ladders = [{ x: lx, y0: 0, y1: H, z: lz, w: 0.42 }];
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ==================================================================== FENCE

/**
 * Weathered post-and-board farm fence (three rails nailed to the posts' front faces), leaning
 * posts, one broken/hanging board, grass tufts at the posts.
 * Origin: ground, centre; spans x = ±width/2 on the plane z = 0 (boards on the +z side).
 * @param {object} opts
 * @param {number} [opts.width=6]
 * @param {number} [opts.height=1.2]
 * @param {number} [opts.seed=7]
 * No colliders (decor).
 */
export function makeWoodFence(opts = {}) {
  const { width: W = 6, height: H = 1.2, seed = 7 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'woodFence';
  const b = new Batch(V(R() * 30, R() * 30, R() * 30));
  const wood = mat('woodRail'), iron = M.iron();
  const n = Math.max(1, Math.round(W / 2.0)), sp = W / n;
  const broken = n > 1 ? Math.floor(R() * n) : -1, brokenRail = Math.floor(R() * 3);
  const posts = [];
  for (let i = 0; i <= n; i++) {
    const x = -W / 2 + i * sp, lean = jit(R, 0.05), ph = H + 0.08 + R() * 0.08;
    posts.push(x);
    b.add(wood, BL(0.13, ph, 0.13, 1.4, x, ph / 2, 0, jit(R, 0.03), 0, lean, true));
    b.add(wood, place(new THREE.ConeGeometry(0.095, 0.08, 4), x + lean * -ph, ph + 0.04, 0, 0, PI / 4, 0));
  }
  const ys = [H * 0.3, H * 0.6, H * 0.9];
  for (let i = 0; i < n; i++) {
    const x0 = posts[i], x1 = posts[i + 1];
    ys.forEach((y, r) => {
      const yy = y + jit(R, 0.025);
      if (i === broken && r === brokenRail) {
        // snapped board hanging from one nail
        const L = sp * 0.62;
        b.add(wood, BL(L, 0.14, 0.028, 2.0, x0 + Math.cos(-0.5) * L / 2 + 0.05, yy + Math.sin(-0.5) * L / 2, 0.085, 0, 0, -0.5));
        return;
      }
      const L = sp + 0.12, tilt = jit(R, 0.015);
      b.add(wood, BL(L, 0.14 + jit(R, 0.012), 0.028, 2.0, (x0 + x1) / 2, yy, 0.085, 0, 0, tilt));
      for (const xn of [x0, x1]) b.add(iron, cylZ(0.008, 0.015, xn + jit(R, 0.02), yy + jit(R, 0.03), 0.104, 4));
    });
  }
  b.build(g);
  grassTufts(g, Math.round(W * 4), seed + 1, (R2, o, i) => {
    const near = i % 2 === 0;
    o.position.set(near ? posts[Math.floor(R2() * posts.length)] + jit(R2, 0.25) : jit(R2, W / 2), 0, jit(R2, 0.3));
    o.scale.multiplyScalar(near ? 1.2 : 0.9);
  });
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ========================================================== TELEPHONE POLE

/**
 * Creosoted wooden telephone/power pole: crossarm with steel braces, green glass insulators,
 * step pegs, optional pole-top transformer and cobra-head street lamp, and catenary wires
 * running to the next pole at x + span (same height).
 * Origin: ground at the pole. Crossarm along x.
 * @param {object} opts
 * @param {number} [opts.height=9]
 * @param {boolean} [opts.withWires=true]
 * @param {number} [opts.span=12]   distance to the next pole (wires end there)
 * @param {number} [opts.sag=0.5]
 * @param {boolean} [opts.transformer=false]
 * @param {boolean} [opts.lamp=false]  sodium street lamp arm toward +z (adds a light)
 * @param {number} [opts.seed=8]
 * No colliders.
 */
export function makeTelephonePole(opts = {}) {
  const { height: H = 9, withWires = true, span = 12, sag = 0.5, transformer = false, lamp = false, seed = 8 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'telephonePole';
  const b = new Batch();
  const pole = once('poleMat', () => { const m = mat('barkPole').clone(); m.color.set('#c9b8a6'); return m; }), dk = mat('woodDark'), iron = M.iron(), steel = mat('galvanized');
  const glassM = once('insulatorGlass', () => new THREE.MeshPhysicalMaterial({ color: '#3f8f6d', roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.88, emissive: '#0b2a1d', emissiveIntensity: 0.6 }));
  b.add(pole, cylUV(new THREE.CylinderGeometry(0.11, 0.16, H, 14, 4).translate(0, H / 2, 0), 1.2, 0, 0, 0.14, R() * 5));
  b.add(pole, place(new THREE.SphereGeometry(0.11, 10, 6, 0, TAU, 0, PI / 2), 0, H, 0));
  // crossarm + braces + insulators
  const ay = H - 0.55, armW = 2.4;
  b.add(dk, BL(armW, 0.11, 0.1, 1.5, 0, ay, 0.17));
  for (const s of [-1, 1]) b.add(steel, beamBetween(V(s * 0.7, ay - 0.06, 0.12), V(0, ay - 0.75, 0.13), 0.04, 0.008));
  b.add(iron, cylZ(0.02, 0.32, 0, ay, 0.06, 6));
  const ins = once('insulatorGeo', () => new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.065, 0.03], [0.045, 0.05], [0.06, 0.08], [0.04, 0.11], [0.025, 0.13], [0, 0.135]].map(([x, y]) => new THREE.Vector2(x, y)), 12));
  const insX = [-1.05, -0.4, 0.4, 1.05];
  for (const x of insX) {
    b.add(dk, cylY(0.015, 0.1, x, ay + 0.1, 0.17, 5));
    b.add(glassM, place(ins.clone(), x, ay + 0.1, 0.17));
  }
  // step pegs
  for (let y = 2.4, s = 1; y < H - 1.2; y += 0.45, s = -s) b.add(steel, cylX(0.014, 0.24, s * 0.21, y, 0, 5));
  // pole tag
  b.add(solid('#b8a76a', 0.5, 0.6), B(0.12, 0.08, 0.01, 0, 1.8, 0.152));
  if (transformer) {
    b.add(solid('#7d878c', 0.5, 0.7), cylY(0.28, 0.75, 0, H - 2.1, 0.42, 16));
    b.add(solid('#7d878c', 0.5, 0.7), place(new THREE.SphereGeometry(0.28, 16, 4, 0, TAU, 0, 0.5), 0, H - 1.73, 0.42));
    b.add(iron, B(0.12, 0.6, 0.18, 0, H - 2.1, 0.17));
    for (const x of [-0.1, 0.1]) b.add(solid('#6b5a4a', 0.4, 0), cylY(0.03, 0.14, x, H - 1.6, 0.42, 6));
    b.add(iron, cylBetween(V(-0.1, H - 1.53, 0.42), V(-0.4, ay + 0.2, 0.17), 0.008, 0.008, 4));
  }
  let lampLight = null;
  if (lamp) {
    const ly = H - 1.6;
    b.add(steel, taperTube([V(0, ly, 0.12), V(0, ly + 0.3, 0.8), V(0, ly + 0.35, 1.8)], 0.04, 0.035, 6, 12));
    b.add(solid('#5c6266', 0.45, 0.6), RB(0.32, 0.14, 0.62, 0.06, 0, ly + 0.3, 2.1));
    b.add(M.bulb('#ffb35a', 8), place(new THREE.SphereGeometry(0.12, 12, 6).scale(1, 0.35, 1.6), 0, ly + 0.22, 2.1));
    lampLight = { pos: V(0, ly - 0.1, 2.1), color: '#ffad55', intensity: 30, distance: 14 };
  }
  // wires to the next pole
  if (withWires && span > 0) {
    const wireM = solid('#161514', 0.6, 0.3);
    for (const x of insX) {
      const a = V(x, ay + 0.2, 0.17), c = V(span + x, ay + 0.2, 0.17);
      b.add(wireM, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(catenary(a, c, sag + jit(R, 0.06), 16)), 24, 0.011, 4, false));
    }
    // telephone cable lower on the pole
    b.add(wireM, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(catenary(V(0.17, H - 2.6, 0), V(span + 0.17, H - 2.6, 0), sag * 1.3, 16)), 24, 0.02, 5, false));
    b.add(iron, B(0.2, 0.05, 0.05, 0.08, H - 2.6, 0));
  }
  b.build(g);
  blob(g, 0.9, 0.9, 0, 0, 0.5);
  grassTufts(g, 7, seed + 2, (R2, o) => { o.position.set(jit(R2, 0.45), 0, jit(R2, 0.35)); });
  if (lampLight) g.userData.lights = [lampLight];
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ================================================================= FOLIAGE

// A clump of leaf cards inside a unit sphere with normals bent outward from the clump centre,
// so instanced clumps shade like soft volumes instead of flat cards.
function leafClump(cards = 9, seed = 1) {
  return once(`clump${cards}_${seed}`, () => {
    const R = TX.rng(seed), parts = [];
    for (let i = 0; i < cards; i++) {
      const q = new THREE.PlaneGeometry(1, 1);
      const c = V(jit(R, 0.32), jit(R, 0.28), jit(R, 0.32));
      place(q, c.x, c.y, c.z, R() * TAU, R() * TAU, R() * TAU, 0.85 + R() * 0.3, 0.85 + R() * 0.3, 1);
      const p = q.attributes.position, n = q.attributes.normal;
      for (let k = 0; k < p.count; k++) {
        const nx = p.getX(k) * 0.9 + n.getX(k) * 0.15, ny = p.getY(k) * 0.9 + 0.35 + n.getY(k) * 0.15, nz = p.getZ(k) * 0.9 + n.getZ(k) * 0.15;
        const l = Math.hypot(nx, ny, nz) || 1;
        n.setXYZ(k, nx / l, ny / l, nz / l);
      }
      parts.push(q);
    }
    return mergeGeometries(parts);
  });
}

// Instanced leaf clumps. pts: [{p: Vector3, s: scale, k: brightness 0..1}]
function clumps(parent, geo, material, pts, seed) {
  const im = new THREE.InstancedMesh(geo, material, pts.length);
  const R = TX.rng(seed), o = new THREE.Object3D(), c = new THREE.Color();
  pts.forEach((q, i) => {
    o.position.copy(q.p);
    o.rotation.set(R() * TAU, R() * TAU, R() * TAU);
    o.scale.setScalar(q.s);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    const k = q.k;
    c.setRGB(0.55 + k * 0.5, 0.58 + k * 0.47, 0.5 + k * 0.4);
    im.setColorAt(i, c);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  parent.add(im);
  return im;
}

// ==================================================================== HEDGE

/**
 * Bushy farm hedge: a dark inner mass covered in instanced leaf clumps (wind sway), slightly
 * trimmed so the top is level enough to stand on.
 * Origin: ground, centre. Spans x = ±width/2, z = ±depth/2.
 * @param {object} opts
 * @param {number} [opts.width=6]
 * @param {number} [opts.height=1.5]
 * @param {number} [opts.depth=1.2]
 * @param {number} [opts.seed=9]
 * Colliders: ledge = hedge top (y = height, x = ±(width/2 − 0.25)).
 */
export function makeHedge(opts = {}) {
  const { width: W = 6, height: H = 1.5, depth: D = 1.2, seed = 9 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'hedge';
  const inner = solid('#1f2a14', 0.95, 0);
  const core = new THREE.Mesh(new RoundedBoxGeometry(W - 0.2, H - 0.15, D - 0.25, 3, 0.35), inner);
  core.position.y = (H - 0.15) / 2;
  g.add(shade(core));
  const leafM = foliageMat('hedge', TX.leafCard({ seed: 331, hue: 0.26, dry: 0.1, leaves: 90 }).map, { sway: 0.025, mode: 1, height: H, alphaTest: 0.42 });
  const pts = [];
  const n = Math.round(W * D * H * 34);
  for (let i = 0; i < n; i++) {
    // sample on the surface of a rounded box, biased to the visible front and top
    const face = R();
    let x = jit(R, W / 2 - 0.15), y, z;
    if (face < 0.45) { y = 0.15 + R() * (H - 0.3); z = D / 2 - 0.12 - R() * 0.1; }
    else if (face < 0.8) { y = H - 0.18 - R() * 0.12; z = jit(R, D / 2 - 0.1); }
    else { y = 0.15 + R() * (H - 0.3); z = -D / 2 + 0.15 + R() * 0.1; }
    const k = Math.min(1, 0.25 + (y / H) * 0.6 + (z > 0 ? 0.15 : 0) + R() * 0.15);
    pts.push({ p: V(x, y, z), s: 0.45 + R() * 0.35, k });
  }
  clumps(g, leafClump(7, seed), leafM, pts, seed + 1);
  blob(g, W + 0.6, D + 0.8, 0, 0, 0.6);
  grassTufts(g, Math.round(W * 2), seed + 5, (R2, o) => { o.position.set(jit(R2, W / 2), 0, D / 2 + R2() * 0.2); });
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2 + 0.25, x1: W / 2 - 0.25, y: H }];
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ===================================================================== TREE

/**
 * Stylised but lush tree. kind 'oak': broad crown on a thick gnarled trunk with a low horizontal
 * limb (a platform); 'poplar': tall Lombardy column; 'dead': bare grey snag with a crow.
 * Foliage = instanced leaf clumps with shader wind sway (shadows are alpha-tested).
 * Origin: ground at the trunk base.
 * @param {object} opts
 * @param {'oak'|'poplar'|'dead'} [opts.kind='oak']
 * @param {number} [opts.seed=10]
 * @param {number} [opts.scale=1]
 * Colliders: oak → ledge on the low limb (y ≈ 3.5·scale, x ≈ 0.9..2.8·scale); dead → ledge on its
 * stub limb. Poplar: none.
 */
export function makeTree(opts = {}) {
  const { kind = 'oak', seed = 10, scale: S = 1 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = `tree_${kind}`;
  const b = new Batch();
  const bark = mat('barkOak');
  const colliders = [];
  const branch = (pts, r0, r1, radial = 7) => b.add(bark, taperTube(pts.map((p) => p.clone().multiplyScalar(S)), r0 * S, r1 * S, radial));
  // recursive branch generator: returns tip points
  const tips = [];
  const grow = (p, dir, len, r, depth, maxD) => {
    const pts = [p.clone()];
    let q = p.clone(), d = dir.clone();
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      d.add(V(jit(R, 0.35), jit(R, 0.2) + 0.08, jit(R, 0.35))).normalize();
      q = q.clone().addScaledVector(d, len / steps);
      pts.push(q);
    }
    branch(pts, r, r * 0.55, depth < 2 ? 7 : 5);
    if (depth >= maxD) { tips.push(q); return; }
    const kids = depth === 0 ? 2 : 2 + (R() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const nd = d.clone().add(V(jit(R, 0.9), 0.15 + R() * 0.4, jit(R, 0.9))).normalize();
      grow(q, nd, len * (0.6 + R() * 0.15), r * 0.55, depth + 1, maxD);
    }
  };

  if (kind === 'poplar') {
    const h = 13;
    branch([V(0, 0, 0), V(0.05, h * 0.35, 0), V(-0.05, h * 0.7, 0.05), V(0, h * 0.95, 0)], 0.28, 0.06, 9);
    b.add(bark, place(new THREE.CylinderGeometry(0.29 * S, 0.45 * S, 0.7 * S, 9, 1, true), 0, 0.3 * S, 0));
    for (let i = 0; i < 9; i++) {
      const y = 2.2 + i * 1.15, a = R() * TAU;
      branch([V(0, y, 0), V(Math.cos(a) * 0.5, y + 1.0, Math.sin(a) * 0.5), V(Math.cos(a) * 0.7, y + 2.0, Math.sin(a) * 0.7)], 0.07, 0.025, 5);
    }
    b.build(g);
    const leafM = foliageMat('poplar', TX.leafCard({ seed: 341, hue: 0.24, dry: 0.25, shape: 'poplar', leaves: 80 }).map, { sway: 0.22, mode: 1, height: h * S, alphaTest: 0.42 });
    const pts = [];
    for (let i = 0; i < 150; i++) {
      const t = R(), y = 2.0 + t * (h - 1.6);
      const rad = (Math.sin(Math.min(1, t * 1.15) * PI) * 0.75 + 0.25) * 1.5 * (0.65 + R() * 0.4);
      const a = R() * TAU;
      pts.push({ p: V(Math.cos(a) * rad, y, Math.sin(a) * rad * 0.9).multiplyScalar(S), s: (0.9 + R() * 0.5) * S, k: Math.min(1, 0.25 + t * 0.55 + (Math.sin(a) > 0 ? 0.15 : 0) + R() * 0.15) });
    }
    clumps(g, leafClump(9, seed), leafM, pts, seed + 1);
    blob(g, 3.4 * S, 3.4 * S, 0, 0, 0.5);
  } else if (kind === 'dead') {
    b.add(bark, place(new THREE.CylinderGeometry(0.34 * S, 0.58 * S, 0.8 * S, 9, 1, true), 0, 0.35 * S, 0));
    branch([V(0, 0, 0), V(0.2, 1.8, 0), V(-0.15, 3.6, 0.1), V(0.1, 5.2, 0)], 0.36, 0.16, 9);
    const top = V(0.1, 5.2, 0);
    for (let k = 0; k < 4; k++) grow(top, V(jit(R, 1), 0.7, jit(R, 0.6)).normalize(), 2.0 + R(), 0.15, 1, 3);
    // stub limb (a perch / platform)
    branch([V(0.1, 3.2, 0), V(1.2, 3.35, 0.05), V(2.3, 3.4, 0.1)], 0.16, 0.08, 7);
    colliders.push({ type: 'ledge', x0: 0.5 * S, x1: 2.1 * S, y: (3.36 + 0.13) * S });
    for (let k = 0; k < 2; k++) grow(V(0.2, 2.4, 0), V(k ? 1 : -1, 0.4, jit(R, 0.4)).normalize(), 1.4, 0.09, 2, 3);
    b.build(g);
    // crow on the stub limb
    const crow = new THREE.Group();
    const cb = new Batch();
    const black = solid('#0b0b0d', 0.4, 0.1);
    cb.add(black, place(new THREE.SphereGeometry(0.1, 10, 8), 0, 0.12, 0, 0, 0, 0, 1.5, 0.95, 0.9));
    cb.add(black, place(new THREE.SphereGeometry(0.065, 10, 8), 0.14, 0.21, 0));
    cb.add(solid('#1a1a1a', 0.3, 0.2), place(new THREE.ConeGeometry(0.025, 0.09, 6), 0.23, 0.2, 0, 0, 0, -PI / 2));
    cb.add(black, place(new THREE.BoxGeometry(0.16, 0.02, 0.07), -0.18, 0.1, 0, 0, 0, 0.35));
    cb.add(black, cylY(0.006, 0.08, 0.02, 0.03, 0.03, 4));
    cb.build(crow);
    crow.position.set(1.7 * S, (3.38 + 0.12) * S, 0.1 * S);
    crow.name = 'crow';
    g.add(crow);
    blob(g, 2.4 * S, 2.4 * S, 0, 0, 0.5);
  } else {
    // oak: flared trunk, main limbs, a low near-horizontal limb, broad crown
    b.add(bark, place(new THREE.CylinderGeometry(0.44 * S, 0.78 * S, 0.9 * S, 10, 1, true), 0, 0.4 * S, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      branch([V(0, 0.45, 0), V(Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55), V(Math.cos(a) * 0.95, -0.05, Math.sin(a) * 0.95)], 0.22, 0.08, 6);
    }
    branch([V(0, 0, 0), V(0.15, 1.6, 0), V(0.05, 3.0, 0.05), V(-0.1, 4.0, 0)], 0.45, 0.3, 10);
    const limbY = 3.35;
    branch([V(0.05, limbY - 0.25, 0.05), V(1.0, limbY, 0.12), V(2.0, limbY + 0.05, 0.2), V(3.0, limbY + 0.35, 0.25)], 0.22, 0.12, 8);
    colliders.push({ type: 'ledge', x0: 0.9 * S, x1: 2.8 * S, y: (limbY + 0.2) * S });
    const crownC = V(0.1, 6.3, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + jit(R, 0.4);
      grow(V(0, 3.6 + R() * 0.5, 0), V(Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.6).normalize(), 2.4 + R() * 0.6, 0.2, 0, 2);
    }
    b.build(g);
    const leafM = foliageMat('oak', TX.leafCard({ seed: 351, hue: 0.27, dry: 0.12, leaves: 85 }).map, { sway: 0.12, mode: 1, height: 9 * S, alphaTest: 0.42 });
    const pts = [];
    // lumpy crown: clumps gathered around lobes on an ellipsoid shell (gaps between lobes)
    const lobes = [];
    for (let i = 0; i < 9; i++) {
      const u = (i / 9) * TAU + jit(R, 0.3), v = 0.35 + R() * 1.2;
      lobes.push(V(Math.sin(v) * Math.cos(u) * 3.3, Math.cos(v) * 2.2 + 0.2, Math.sin(v) * Math.sin(u) * 2.5));
    }
    lobes.push(V(0, 2.4, 0), V(0, 0.6, 0));
    for (let i = 0; i < 240; i++) {
      const L = lobes[i % lobes.length], u = R() * TAU, v = Math.acos(jit(R, 1)), rr = Math.pow(R(), 0.6) * 1.9;
      let x = L.x + Math.sin(v) * Math.cos(u) * rr, y = L.y + Math.cos(v) * rr * 0.8, z = L.z + Math.sin(v) * Math.sin(u) * rr;
      if (y < -1.5) y = -1.5 - (y + 1.5) * 0.3; // flatter underside
      const p = V(x, y, z).add(crownC);
      const k = Math.min(1, 0.15 + ((y + 2.9) / 5.8) * 0.6 + (z > 0 ? 0.1 : -0.05) + (rr / 1.9) * 0.15 + R() * 0.1);
      pts.push({ p: p.multiplyScalar(S), s: (1.2 + R() * 0.8) * S, k });
    }
    for (const t of tips) pts.push({ p: t.clone().multiplyScalar(S), s: (1.1 + R() * 0.6) * S, k: 0.7 });
    // clumps around the low limb's tip
    for (let i = 0; i < 8; i++) pts.push({ p: V(3.0 + jit(R, 0.6), limbY + 0.6 + R() * 0.8, jit(R, 0.6)).multiplyScalar(S), s: (0.9 + R() * 0.5) * S, k: 0.65 });
    clumps(g, leafClump(9, seed), leafM, pts, seed + 1);
    blob(g, 9 * S, 7 * S, 0.3 * S, 0, 0.45);
  }
  grassTufts(g, 16, seed + 7, (R2, o) => { const a = R2() * TAU, r = 0.5 + R2() * 1.4; o.position.set(Math.cos(a) * r * S, 0, Math.sin(a) * r * S); });
  if (colliders.length) g.userData.colliders = colliders;
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// =============================================================== CORN ROWS

const cornTex = () => TX.painted('rural_corn', 256, 1024, (ctx, w, h) => {
  const R = TX.rng(61);
  const cx = w / 2;
  const leaf = (y, dir, len, droop, hue, li) => {
    ctx.fillStyle = `hsl(${hue},${38 + R() * 15}%,${li}%)`;
    ctx.beginPath();
    const x1 = cx + dir * len, y1 = y + droop;
    ctx.moveTo(cx, y);
    ctx.quadraticCurveTo(cx + dir * len * 0.5, y - len * 0.45, x1, y1);
    ctx.quadraticCurveTo(cx + dir * len * 0.45, y - len * 0.3 + 14, cx, y + 16);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue},30%,${li + 12}%,0.7)`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, y + 6); ctx.quadraticCurveTo(cx + dir * len * 0.5, y - len * 0.4 + 5, x1, y1); ctx.stroke();
  };
  // stalk
  const sg = ctx.createLinearGradient(0, 0, 0, h);
  sg.addColorStop(0, '#a99a52'); sg.addColorStop(0.5, '#7f8a3e'); sg.addColorStop(1, '#8a7a40');
  ctx.fillStyle = sg; ctx.fillRect(cx - 6, 90, 12, h - 90);
  for (let y = 180; y < h; y += 110) { ctx.fillStyle = 'rgba(70,60,30,0.6)'; ctx.fillRect(cx - 7, y, 14, 5); }
  // leaves (lower ones dry/yellow)
  for (let i = 0; i < 9; i++) {
    const y = 160 + i * 92 + R() * 20, t = y / h;
    const dry = t > 0.62;
    leaf(y, i % 2 ? 1 : -1, w * (0.32 + R() * 0.16), 120 + R() * 90, dry ? 44 + R() * 8 : 70 + R() * 18, dry ? 40 + R() * 12 : 26 + R() * 14);
  }
  // cob with husk + silk
  ctx.fillStyle = '#9fa45a';
  ctx.beginPath(); ctx.ellipse(cx + 16, 520, 13, 62, 0.22, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#7a4a26'; ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(cx + 26, 462); ctx.lineTo(cx + 30 + i * 3, 430 + R() * 12); ctx.stroke(); }
  // tassel
  ctx.strokeStyle = '#c9a85a'; ctx.lineWidth = 3;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(cx, 100); ctx.quadraticCurveTo(cx + jit(R, 30), 50, cx + jit(R, 50), 4 + R() * 30); ctx.stroke(); }
});

/**
 * Late-summer corn field strip: instanced crossed-card corn plants (stalk, arching leaves with
 * dry lower leaves, cobs, tassels) in 30-inch rows receding in z over furrowed dirt; sways.
 * Origin: ground, centre of the strip. Rows run along x, the first row at z = +depth/2.
 * @param {object} opts
 * @param {number} [opts.width=10]
 * @param {number} [opts.rows=4]
 * @param {number} [opts.height=2.4]
 * @param {number} [opts.seed=11]
 * No colliders.
 */
export function makeCornRows(opts = {}) {
  const { width: W = 10, rows = 4, height: Hc = 2.4, seed = 11 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'cornRows';
  const rowSp = 0.76, D = rows * rowSp;
  const plantGeo = once('cornGeo', () => {
    const a = new THREE.PlaneGeometry(0.62, 2.4, 1, 4).translate(0, 1.2, 0);
    const c = a.clone().rotateY(PI / 2);
    const m2 = mergeGeometries([a, c]);
    const n = m2.attributes.normal, p = m2.attributes.position;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, p.getX(i) * 0.6, 0.6, 0.5 + p.getZ(i) * 0.6);
    return m2;
  });
  const cornM = foliageMat('corn', cornTex(), { sway: 0.035, mode: 0, alphaTest: 0.45 });
  const per = Math.round(W / 0.2);
  const im = new THREE.InstancedMesh(plantGeo, cornM, per * rows);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const z = D / 2 - rowSp / 2 - r * rowSp;
    for (let k = 0; k < per; k++) {
      o.position.set(-W / 2 + (k + 0.5) * (W / per) + jit(R, 0.06), 0, z + jit(R, 0.07));
      o.rotation.set(jit(R, 0.05), R() * TAU, jit(R, 0.05));
      const s = (Hc / 2.4) * (0.82 + R() * 0.3);
      o.scale.set(s * (0.9 + R() * 0.3), s, s);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      const k2 = 0.7 + R() * 0.35 - r * 0.06;
      c.setRGB(k2, k2, k2 * 0.95);
      im.setColorAt(i++, c);
    }
  }
  im.castShadow = true;
  im.receiveShadow = true;
  g.add(im);
  // furrowed dirt: ridged strip under the rows
  const ground = new THREE.PlaneGeometry(W + 0.6, D + 0.4, 8, rows * 6).rotateX(-PI / 2);
  { const p = ground.attributes.position; for (let j = 0; j < p.count; j++) { const z = p.getZ(j); p.setY(j, 0.02 + 0.06 * (0.5 + 0.5 * Math.cos(((z - D / 2) / rowSp) * TAU)) * (Math.abs(z) < D / 2 ? 1 : 0)); } ground.computeVertexNormals(); }
  const gm = new THREE.Mesh(worldUV(ground, 2.5), mat('dirt'));
  gm.receiveShadow = true;
  g.add(gm);
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ==================================================================== ROCKS

/**
 * Cluster of weathered boulders (noise-displaced, faceted) with pebbles. The big rock has a
 * flat-topped crown so it works as a step.
 * Origin: ground, centre of the big rock.
 * @param {object} opts
 * @param {number} [opts.count=5]  rocks including the big one
 * @param {number} [opts.size=1]   big rock radius ≈ 0.9·size
 * @param {number} [opts.seed=12]
 * Colliders: ledge on the big rock's flat top.
 */
export function makeRocks(opts = {}) {
  const { count = 5, size = 1, seed = 12 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'rocks';
  const b = new Batch();
  const rockM = once('rockMat', () => { const m = mat('rockGrey').clone(); m.color.set('#d8d2c8'); return m; });
  const ph = Array.from({ length: 9 }, () => R() * TAU);
  const rock = (r, sx, sy, sz, flatTop = 0) => {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.16 * Math.sin(x * 3.1 + ph[0]) * Math.sin(y * 2.7 + ph[1]) + 0.1 * Math.sin(z * 4.3 + ph[2] + x * 2) + 0.06 * Math.sin(y * 7 + ph[3] + z * 5);
      let X = x * n * r * sx, Y = y * n * r * sy, Z = z * n * r * sz;
      if (flatTop && Y > flatTop) Y = flatTop + (Y - flatTop) * 0.08;
      if (Y < -r * sy * 0.35) Y = -r * sy * 0.35;
      p.setXYZ(i, X, Y + r * sy * 0.35, Z);
    }
    const ng = geo.index ? geo.toNonIndexed() : geo;
    ng.computeVertexNormals();
    return ng;
  };
  const r0 = 0.9 * size, top = r0 * 0.62;
  const big = rock(r0, 1.25, 0.95, 1.0, top);
  b.add(rockM, big, 1.6);
  // measure the flat crown for the collider
  let tx0 = Infinity, tx1 = -Infinity, ty = -Infinity;
  { const p = big.attributes.position; for (let i = 0; i < p.count; i++) ty = Math.max(ty, p.getY(i)); for (let i = 0; i < p.count; i++) if (p.getY(i) > ty - 0.04 && Math.abs(p.getZ(i)) < 0.3 * size) { tx0 = Math.min(tx0, p.getX(i)); tx1 = Math.max(tx1, p.getX(i)); } }
  for (let i = 1; i < count; i++) {
    const r = r0 * (0.3 + R() * 0.4), a = (i / count) * TAU + jit(R, 0.5), d = r0 * 1.2 + r * 0.8;
    b.add(rockM, place(rock(r, 1 + R() * 0.4, 0.7 + R() * 0.3, 1 + R() * 0.3), Math.cos(a) * d * 1.2, -r * 0.1, Math.sin(a) * d * 0.7, 0, R() * TAU, 0), 1.6);
  }
  for (let i = 0; i < 14; i++) {
    const a = R() * TAU, d = r0 * (1.3 + R() * 1.4);
    b.add(rockM, place(rock(0.06 + R() * 0.08, 1.2, 0.7, 1), Math.cos(a) * d, 0, Math.sin(a) * d * 0.7, 0, R() * 3, 0), 1);
  }
  b.build(g);
  blob(g, r0 * 4.2, r0 * 3.2, 0, 0, 0.55);
  grassTufts(g, 14, seed + 1, (R2, o) => { const a = R2() * TAU, d = r0 * (1.0 + R2() * 0.8); o.position.set(Math.cos(a) * d * 1.3, 0, Math.sin(a) * d * 0.8); });
  if (tx1 > tx0) g.userData.colliders = [{ type: 'ledge', x0: tx0 + 0.05, x1: tx1 - 0.05, y: ty }];
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ================================================================== MAILBOX

/**
 * Rural route mailbox on a weathered post: tunnel-top steel box seen side-on (door toward +x),
 * raised red flag, painted family name and box number.
 * Origin: ground at the post.
 * @param {object} opts
 * @param {string} [opts.name='MILLER']
 * @param {boolean} [opts.flagUp=true]
 * @param {number} [opts.seed=13]
 * No colliders. Named child `flag`.
 */
export function makeMailboxRural(opts = {}) {
  const { name = 'MILLER', flagUp = true, seed = 13 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'mailbox';
  const b = new Batch();
  const wood = mat('woodRail'), boxM = solid('#3d4247', 0.5, 0.65), iron = M.iron();
  b.add(wood, BL(0.11, 1.05, 0.11, 1.2, 0, 0.52, 0, 0, 0, jit(R, 0.03), true));
  b.add(wood, BL(0.62, 0.08, 0.16, 1.2, 0.05, 1.07, 0));
  b.add(wood, BL(0.06, 0.35, 0.06, 1.2, 0.15, 0.92, 0, 0, 0, -0.75));
  // tunnel box: profile in the z/y plane extruded along x
  const w = 0.17, hb = 0.12, L = 0.5;
  const prof = new THREE.Shape();
  prof.moveTo(-w / 2, 0); prof.lineTo(w / 2, 0); prof.lineTo(w / 2, hb); prof.absarc(0, hb, w / 2, 0, PI, false); prof.lineTo(-w / 2, 0);
  const tunnel = new THREE.ExtrudeGeometry(prof, { depth: L, bevelEnabled: false, curveSegments: 12 }).rotateY(PI / 2);
  b.add(boxM, place(tunnel, -L / 2 + 0.05, 1.11, 0));
  b.add(solid('#2b2f33', 0.5, 0.6), place(new THREE.ShapeGeometry(prof, 12).rotateY(PI / 2), L / 2 + 0.056, 1.11, 0));
  b.add(iron, B(0.02, 0.05, 0.04, L / 2 + 0.065, 1.11 + hb + 0.03, 0));
  const nameM = signMat(`mail_${name}`, 256, 96, (ctx, cw, ch) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#efe9da'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, cw / 2, ch * 0.38);
    ctx.font = `bold 22px ${FONT}`; ctx.fillText('R.R. 2  BOX 47', cw / 2, ch * 0.78);
    weather(ctx, cw, ch, 3, 0.5);
  }, { transparent: true });
  b.add(nameM, place(new THREE.PlaneGeometry(0.42, 0.16), 0.05, 1.11 + 0.1, w / 2 + 0.002));
  b.add(iron, cylZ(0.012, 0.02, -0.08, 1.17, w / 2 + 0.006, 6));
  b.build(g);
  const flag = new THREE.Group();
  flag.name = 'flag';
  const fb = new Batch();
  const red = solid('#b3221b', 0.45, 0.3);
  fb.add(red, B(0.025, 0.24, 0.008, 0, 0.12, 0));
  fb.add(red, B(0.11, 0.08, 0.008, 0.055, 0.2, 0));
  fb.build(flag);
  flag.position.set(-0.08, 1.17, w / 2 + 0.012);
  flag.rotation.z = flagUp ? 0 : -PI / 2;
  g.add(flag);
  blob(g, 0.6, 0.5, 0, 0, 0.45);
  grassTufts(g, 6, seed, (R2, o) => { o.position.set(jit(R2, 0.3), 0, jit(R2, 0.25)); });
  g.userData.update = (dt, t) => { uTime.value = t; };
  return g;
}

// ================================================================= VEHICLES

// Tyre cross-section revolved around the axle (axis along z after the rotation).
function tyreGeo(r, w, rim, seg = 28) {
  return once(`tyre${r}_${w}_${rim}_${seg}`, () => {
    const pts = [[rim, -w / 2 + 0.02], [r - 0.07, -w / 2], [r - 0.02, -w / 2 + 0.03], [r, -w / 2 + 0.07], [r, w / 2 - 0.07], [r - 0.02, w / 2 - 0.03], [r - 0.07, w / 2], [rim, w / 2 - 0.02]];
    return new THREE.LatheGeometry(pts.map(([a, b2]) => new THREE.Vector2(a, b2)), seg).rotateX(PI / 2);
  });
}

// Wheel group (named, axle along z, outer face toward +z when side > 0). Rolls via rotation.z.
function wheel(name, x, y, z, { r = 0.38, w = 0.24, rim = 0.24, rimM, side = 1, lugs = 0, capM = null, tread = null } = {}) {
  const grp = new THREE.Group();
  grp.name = name;
  grp.position.set(x, y, z);
  grp.userData.radius = r;
  const wb = new Batch();
  wb.add(M.rubber(), tyreGeo(r - (tread ? 0.06 : 0), w, rim));
  const rs = side;
  wb.add(rimM, place(new THREE.CylinderGeometry(rim + 0.01, rim + 0.01, w * 0.7, 20, 1, true), 0, 0, 0, PI / 2, 0, 0));
  wb.add(rimM, place(new THREE.CircleGeometry(rim + 0.01, 20), 0, 0, (rs * w * 0.22), 0, rs < 0 ? PI : 0, 0));
  wb.add(rimM, place(new THREE.TorusGeometry(rim * 0.98, 0.022, 5, 22), 0, 0, rs * w * 0.3));
  if (capM) wb.add(capM, place(new THREE.SphereGeometry(rim * 0.55, 16, 6, 0, TAU, 0, PI / 2).scale(1, 0.35, 1), 0, 0, rs * w * 0.23, rs * PI / 2, 0, 0));
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * TAU;
    wb.add(M.chrome(), place(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6), Math.cos(a) * rim * 0.42, Math.sin(a) * rim * 0.42, rs * w * 0.24, PI / 2, 0, 0));
  }
  if (tread) {
    // chevron lugs (tractor tyres)
    const n = tread.count, lw = w / 2 - 0.02;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      for (const s of [-1, 1]) {
        const lug = new THREE.BoxGeometry(0.075, 0.07, lw * 1.15);
        place(lug, 0, 0, 0, 0, s * 0.55, 0);
        place(lug, 0, r - 0.045, (s * lw) / 2 + (i % 2 ? 0.02 : -0.02), 0, 0, 0);
        place(lug, 0, 0, 0, 0, 0, a);
        wb.add(M.rubber(), lug);
      }
    }
  }
  wb.build(grp);
  return grp;
}

const rollFn = (wheels) => (dx) => { for (const w of wheels) w.rotation.z -= dx / w.userData.radius; };

// Side-profile helper: Shape from points with an upward wheel-arch notch at each {x, cy, r}
// along the bottom edge (y = y0), extruded across z (centred, width `wid`).
function profileWithArches(x0, x1, y0, arches, upper, wid, bevel = 0.035) {
  const sh = new THREE.Shape();
  sh.moveTo(x0, y0);
  for (const a of arches) {
    const dy = y0 - a.cy, ang = Math.asin(Math.min(0.99, dy / a.r)), dx = Math.cos(ang) * a.r;
    sh.lineTo(a.x - dx, y0);
    sh.absarc(a.x, a.cy, a.r, PI - ang, ang, true);
  }
  sh.lineTo(x1, y0);
  for (const [x, y] of upper) sh.lineTo(x, y);
  sh.lineTo(x0, y0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: wid - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 14 });
  return g.translate(0, 0, -(wid - bevel * 2) / 2);
}

/**
 * Rusty early-80s square-body pickup (nose toward +x) with a load of hay: extruded body with real
 * wheel arches, cab glass with vent wings, chrome grille + quad headlights, west-coast mirrors,
 * bed with stacked bales and loose straw, chassis detail.
 * Origin: ground, centre of the wheelbase. Length ≈ 5.4 m along x, width 2.0 m.
 * Named children: `wheelFL`, `wheelFR`, `wheelRL`, `wheelRR` (L = −z; roll about z, r = 0.38),
 *   `headlights` (emissive mesh: set material.emissiveIntensity to switch on).
 * userData.rollBy(dx) spins the wheels for a move of dx metres.
 * Colliders: ledge hood (y 1.23), ledge cab roof (y 1.86), ledge bed hay (y 1.27, rear part),
 *   solid bales stacked against the cab (y 1.27..1.68).
 * @param {object} opts
 * @param {number} [opts.seed=14]
 * @param {boolean} [opts.hay=true]
 */
export function makePickupTruck(opts = {}) {
  const { seed = 14, hay = true } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'pickupTruck';
  const b = new Batch(V(R() * 20, R() * 20, R() * 20));
  const paint = mat('truckPaint'), chrome = M.chrome(), dark = solid('#0d0e10', 0.8, 0.2), glass = M.glass(), iron = M.iron();
  const HW = 0.99, axF = 1.55, axR = -1.65, wr = 0.38;
  // cab + front clip
  b.add(paint, profileWithArches(-0.58, 2.6, 0.5, [{ x: axF, cy: 0.42, r: 0.5 }], [[2.64, 0.6], [2.64, 1.1], [2.57, 1.17], [1.08, 1.23], [0.52, 1.83], [-0.42, 1.86], [-0.55, 1.79]], HW * 2), 2);
  // bed sides, floor, front wall, tailgate
  for (const s of [-1, 1]) {
    const side = profileWithArches(-2.6, -0.64, 0.55, [{ x: axR, cy: 0.46, r: 0.5 }], [[-0.64, 1.25], [-2.6, 1.25]], 0.07, 0.015);
    b.add(paint, place(side, 0, 0, s * (HW - 0.035)), 2);
    b.add(paint, B(1.98, 0.05, 0.12, -1.62, 1.265, s * (HW - 0.05)), 2);
  }
  b.add(paint, B(1.92, 0.06, HW * 2 - 0.1, -1.62, 0.84, 0), 2);
  b.add(paint, B(0.06, 0.72, HW * 2 - 0.08, -0.67, 0.89, 0), 2);
  b.add(paint, B(0.07, 0.68, HW * 2 - 0.02, -2.6, 0.9, 0), 2);
  // wheel-well liners and underbody
  for (const ax of [axF, axR]) b.add(dark, B(1.0, 0.52, HW * 2 - 0.5, ax, 0.68, 0));
  for (const s of [-1, 1]) b.add(iron, B(4.9, 0.16, 0.08, 0, 0.4, s * 0.45));
  b.add(iron, place(new THREE.SphereGeometry(0.16, 12, 8), axR, 0.38, 0.12, 0, 0, 0, 1, 0.8, 1));
  b.add(iron, cylZ(0.06, HW * 2 - 0.3, axR, 0.38, 0, 8));
  b.add(iron, cylX(0.035, 2.9, -1.2, 0.3, 0.55, 8));
  b.add(iron, cylX(0.04, 0.2, -2.68, 0.32, 0.55, 8));
  // chrome molding, door seams, handle, side marker lights
  for (const s of [-1, 1]) {
    const z = s * (HW + 0.004);
    b.add(chrome, B(4.9, 0.025, 0.012, 0.0, 0.98, z));
    b.add(dark, B(0.012, 0.66, 0.006, 0.97, 0.88 + 0.08, z));
    b.add(dark, B(0.012, 1.24, 0.006, -0.5, 1.14, z));
    b.add(chrome, B(0.16, 0.035, 0.03, -0.32, 1.12, s * (HW + 0.012)));
    b.add(solid('#d77a1a', 0.3, 0, { emissive: '#4a2000' }), B(0.08, 0.04, 0.012, 2.45, 0.78, z));
    b.add(solid('#8a1410', 0.3, 0, { emissive: '#2a0000' }), B(0.08, 0.04, 0.012, -2.48, 0.78, z));
    // side glass with vent wing divider
    b.add(glass, place(extrude([[0.97, 1.28], [0.5, 1.78], [-0.38, 1.79], [-0.4, 1.28]], 0.012), 0, 0, s > 0 ? HW - 0.005 : -HW - 0.007));
    b.add(chrome, place(new THREE.BoxGeometry(0.025, 0.5, 0.02), 0.72, 1.53, s * (HW + 0.004), 0, 0, -0.5));
    // west-coast mirror
    b.add(chrome, cylBetween(V(0.9, 1.3, s * HW), V(0.86, 1.33, s * (HW + 0.2)), 0.012, 0.012, 5));
    b.add(chrome, cylBetween(V(0.9, 1.62, s * HW), V(0.86, 1.6, s * (HW + 0.2)), 0.012, 0.012, 5));
    b.add(dark, B(0.04, 0.34, 0.16, 0.86, 1.47, s * (HW + 0.22)));
  }
  // windshield + rear window
  {
    const L = Math.hypot(0.56, 0.6), a = Math.atan2(0.6, -0.56);
    b.add(glass, BL(L - 0.06, 0.012, HW * 2 - 0.2, 1, 0.808, 1.537, 0, 0, 0, a));
    b.add(chrome, BL(L - 0.04, 0.02, 0.03, 1, 0.8, 1.53, HW - 0.09, 0, 0, a));
    b.add(chrome, BL(L - 0.04, 0.02, 0.03, 1, 0.8, 1.53, -HW + 0.09, 0, 0, a));
    b.add(glass, B(0.012, 0.42, HW * 2 - 0.5, -0.585, 1.52, 0));
    b.add(dark, cylBetween(V(1.05, 1.27, 0.2), V(0.75, 1.55, 0.25), 0.008, 0.008, 4));
  }
  // grille, quad headlights, bumpers, hood details
  b.add(chrome, B(0.05, 0.46, HW * 2 - 0.1, 2.645, 0.88, 0));
  b.add(dark, B(0.03, 0.38, 1.0, 2.67, 0.88, 0));
  for (const y of [0.76, 0.88, 1.0]) b.add(chrome, B(0.03, 0.025, 1.0, 2.69, y, 0));
  for (let z = -0.45; z <= 0.46; z += 0.15) b.add(chrome, B(0.03, 0.38, 0.018, 2.69, 0.88, z));
  const head = new THREE.MeshStandardMaterial({ color: '#d9d4c4', roughness: 0.15, metalness: 0.2, emissive: '#fff1cc', emissiveIntensity: 0.02 });
  const heads = [];
  for (const s of [-1, 1]) for (const y of [0.79, 0.98]) {
    b.add(chrome, B(0.03, 0.17, 0.2, 2.67, y, s * 0.66));
    heads.push(B(0.02, 0.13, 0.16, 2.69, y, s * 0.66));
  }
  const headMesh = new THREE.Mesh(mergeGeometries(heads.map(normGeo)), head);
  headMesh.name = 'headlights';
  g.add(headMesh);
  b.add(chrome, RB(0.16, 0.22, HW * 2 + 0.08, 0.04, 2.76, 0.52, 0));
  b.add(mat('rustMetal'), B(0.06, 0.06, HW * 2, 2.82, 0.45, 0), 1);
  b.add(chrome, RB(0.16, 0.2, HW * 2 + 0.04, 0.04, -2.72, 0.55, 0));
  b.add(dark, B(0.02, 0.35, 0.16, -2.645, 1.0, 0.82));
  b.add(solid('#8a1410', 0.3, 0, { emissive: '#3a0000', emissiveIntensity: 1 }), B(0.03, 0.3, 0.14, -2.645, 1.0, 0.82));
  b.add(solid('#8a1410', 0.3, 0, { emissive: '#3a0000', emissiveIntensity: 1 }), B(0.03, 0.3, 0.14, -2.645, 1.0, -0.82));
  b.add(chrome, B(0.25, 0.05, 0.06, 2.45, 1.21, 0));
  b.add(chrome, cylY(0.006, 0.9, 2.2, 1.65, HW + 0.02, 4));
  // rust holes / patches on rockers and arches
  // rubber lips around the wheel arches
  for (const [ax, cy, y0] of [[axF, 0.42, 0.5], [axR, 0.46, 0.55]]) {
    const ang = Math.asin((y0 - cy) / 0.5);
    for (const s of [-1, 1]) b.add(dark, place(new THREE.TorusGeometry(0.5, 0.022, 4, 18, PI - 2 * ang), ax, cy, s * (HW + 0.004), 0, 0, ang));
  }
  // hay load
  const colliders = [];
  if (hay) {
    const hayM = hayMat(), bl = 0.92, bh = 0.41, bd = 0.45;
    const baleG = once('truckBale', () => new RoundedBoxGeometry(bl - 0.02, bh - 0.01, bd - 0.02, 2, 0.05));
    for (let i = 0; i < 2; i++) for (let k = 0; k < 4; k++) {
      b.add(hayM, place(worldUV(baleG.clone(), 1.1, V(R() * 5, R() * 5, R() * 5), true), -2.52 + bl / 2 + i * (bl + 0.005), 0.87 + bh / 2, -0.9 + bd / 2 + k * bd, 0, jit(R, 0.04), 0));
    }
    for (let k = 0; k < 3; k++) b.add(hayM, place(worldUV(baleG.clone(), 1.1, V(R() * 5, R() * 5, R() * 5), true), -0.7 - bl / 2, 1.28 + bh / 2, -0.62 + k * bd * 0.98, 0, jit(R, 0.05), 0));
    colliders.push({ type: 'ledge', x0: -2.6, x1: -0.7 - bl, y: 1.27 });
    colliders.push({ type: 'solid', x0: -0.7 - bl, x1: -0.66, y0: 1.27, y1: 1.27 + bh });
  }
  colliders.push({ type: 'ledge', x0: 1.08, x1: 2.6, y: 1.23 }, { type: 'ledge', x0: -0.42, x1: 0.52, y: 1.86 });
  b.build(g);
  if (hay) {
    strawStrands(g, 95, seed + 1, (R2, o, i) => {
      if (i < 70) { o.position.set(-2.55 + R2() * 1.85, 1.28 + (R2() < 0.3 ? 0.41 : 0), jit(R2, 0.9)); o.rotation.set(-PI / 2 + jit(R2, 0.4), 0, R2() * TAU); }
      else { o.position.set(-2.55 + R2() * 1.85, 1.24 + R2() * 0.04, HW - 0.05 + R2() * 0.08); o.rotation.set(jit(R2, 0.3), jit(R2, 0.6), -0.3 + jit(R2, 0.5)); }
      o.scale.setScalar(0.6 + R2() * 0.8);
    });
  }
  // wheels: white steel rims + chrome baby-moon caps
  const rimM = solid('#bab5a8', 0.45, 0.4);
  const wheels = [];
  for (const [n, x, z] of [['wheelFL', axF, -0.8], ['wheelFR', axF, 0.8], ['wheelRL', axR, -0.8], ['wheelRR', axR, 0.8]]) {
    const w = wheel(n, x, wr, z, { r: wr, w: 0.24, rim: 0.22, rimM, side: z > 0 ? 1 : -1, lugs: 6, capM: chrome });
    g.add(w);
    wheels.push(w);
  }
  blob(g, 5.8, 2.6, 0, 0, 0.6);
  g.userData.colliders = colliders;
  g.userData.rollBy = rollFn(wheels);
  return g;
}

/**
 * Old red row-crop tractor (late-40s tricycle style, nose toward +x): narrow hood with grille and
 * exhaust stack + pre-cleaner, exposed engine, big chevron-lug rear tyres under round fenders,
 * pan seat on a spring bar, steering wheel, drawbar, painted "FARMHAND" decal.
 * Origin: ground, centre between the axles. Length ≈ 3.4 m.
 * Named children: `wheelFL/FR/RL/RR` (L = −z; rear r = 0.76, front r = 0.34; roll about z).
 * userData.rollBy(dx). Colliders: ledge on the hood (y 1.42, x −0.15..1.55).
 * @param {object} opts
 * @param {number} [opts.seed=15]
 */
export function makeTractor(opts = {}) {
  const { seed = 15 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'tractor';
  const b = new Batch(V(R() * 20, R() * 20, R() * 20));
  const red = mat('tractorRed'), iron = M.iron(), dark = solid('#2b2826', 0.6, 0.5), chrome = M.chrome();
  const redDS = once('tractorRedDS', () => { const m = red.clone(); m.side = THREE.DoubleSide; return m; });
  const axR = -0.75, axF = 1.45, rr = 0.76, fr = 0.34;
  // hood, grille housing, engine, transmission, rear axle housing
  b.add(red, RB(1.75, 0.46, 0.56, 0.08, 0.68, 1.19, 0), 1.5);
  b.add(red, RB(0.22, 0.9, 0.62, 0.05, 1.62, 0.98, 0), 1.5);
  for (let z = -0.22; z <= 0.23; z += 0.055) b.add(dark, B(0.03, 0.66, 0.025, 1.735, 0.98, z));
  b.add(dark, B(0.025, 0.7, 0.5, 1.72, 0.98, 0));
  b.add(dark, B(1.25, 0.42, 0.42, 0.55, 0.75, 0), 1);
  for (let i = 0; i < 4; i++) b.add(iron, cylZ(0.035, 0.08, 0.15 + i * 0.25, 0.85, 0.23, 8));
  b.add(iron, cylX(0.05, 0.9, 0.5, 0.64, 0.24, 8));
  b.add(red, RB(0.95, 0.5, 0.62, 0.08, -0.38, 0.78, 0), 1.5);
  b.add(red, cylZ(0.14, 1.25, axR, rr, 0, 14), 1.5);
  b.add(iron, cylZ(0.1, 1.6, axR, rr, 0, 12));
  // front pedestal + fork
  b.add(red, cylY(0.09, 0.6, axF, 0.75, 0, 10), 1.5);
  for (const s of [-1, 1]) b.add(iron, B(0.05, 0.42, 0.05, axF, 0.5, s * 0.2));
  b.add(iron, cylZ(0.03, 0.5, axF, fr, 0, 8));
  // fenders over the rear wheels (curved shells) with flat platforms
  for (const s of [-1, 1]) {
    const f = new THREE.CylinderGeometry(rr + 0.08, rr + 0.08, 0.42, 26, 1, true, PI - 1.3, 2.6).rotateX(PI / 2);
    b.add(redDS, place(f, axR, rr, s * 0.72), 1.5);
    b.add(red, place(new THREE.TorusGeometry(rr + 0.08, 0.02, 4, 26, 2.6).rotateZ(PI / 2 - 1.3), axR, rr, s * 0.72 + 0.21));
    b.add(red, B(0.6, 0.03, 0.34, axR + 0.35, 0.95, s * 0.48));
  }
  // operator: seat on spring bar, steering column + wheel, pedals
  b.add(iron, cylBetween(V(-0.35, 0.9, 0), V(-1.0, 1.15, 0), 0.03, 0.03, 6));
  b.add(solid('#1c1a18', 0.5, 0.3), place(new THREE.SphereGeometry(0.24, 14, 6, 0, TAU, PI * 0.55, PI * 0.45), -1.05, 1.42, 0, 0, 0, 0, 1, 0.5, 1));
  b.add(solid('#1c1a18', 0.5, 0.3), B(0.05, 0.22, 0.4, -1.27, 1.43, 0, 0, 0, 0.2));
  b.add(iron, cylBetween(V(0.2, 1.38, 0), V(-0.45, 1.72, 0), 0.025, 0.025, 6));
  b.add(dark, new THREE.TorusGeometry(0.2, 0.02, 6, 20).rotateY(PI / 2).rotateZ(-0.48).translate(-0.47, 1.74, 0));
  // exhaust stack + pre-cleaner + radiator cap
  b.add(iron, cylY(0.045, 0.95, 1.05, 1.85, -0.07, 8));
  b.add(iron, place(new THREE.CylinderGeometry(0.06, 0.045, 0.06, 8), 1.05, 2.33, -0.07));
  b.add(solid('#8c8e8a', 0.15, 0.1, { transparent: true, opacity: 0.6 }), cylY(0.065, 0.25, 0.78, 1.55, 0.08, 12));
  b.add(red, cylY(0.07, 0.04, 0.78, 1.69, 0.08, 12));
  b.add(chrome, cylY(0.04, 0.04, 1.42, 1.44, 0, 10));
  // drawbar + tool box
  b.add(iron, B(0.6, 0.05, 0.14, -1.35, 0.42, 0));
  b.add(red, B(0.3, 0.2, 0.16, -0.4, 1.1, 0.33));
  // decal
  const decal = signMat('tractorDecal', 512, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#cfc3a6'; ctx.font = `bold italic 66px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText('FARMHAND', 14, h / 2 + 4);
    weather(ctx, w, h, 8, 0.6);
  }, { transparent: true });
  b.add(decal, place(new THREE.PlaneGeometry(1.0, 0.19), 0.72, 1.2, 0.282));
  b.add(decal, place(new THREE.PlaneGeometry(1.0, 0.19), 0.72, 1.2, -0.282, 0, PI, 0));
  b.build(g);
  // wheels: big chevron-lug rears, small ribbed fronts
  const rimM = solid('#b8b2a2', 0.5, 0.5);
  const wheels = [];
  for (const [n, x, z, rad, wdt, rim, tread] of [['wheelRL', axR, -0.72, rr, 0.32, 0.47, { count: 22 }], ['wheelRR', axR, 0.72, rr, 0.32, 0.47, { count: 22 }], ['wheelFL', axF, -0.13, fr, 0.13, 0.2, null], ['wheelFR', axF, 0.13, fr, 0.13, 0.2, null]]) {
    const w = wheel(n, x, rad, z, { r: rad, w: wdt, rim, rimM: n.startsWith('wheelR') ? red : rimM, side: z > 0 ? 1 : -1, lugs: n.startsWith('wheelR') ? 8 : 5, tread });
    g.add(w);
    wheels.push(w);
  }
  blob(g, 3.6, 2.2, 0.2, 0, 0.6);
  g.userData.colliders = [{ type: 'ledge', x0: -0.15, x1: 1.55, y: 1.42 }];
  g.userData.rollBy = rollFn(wheels);
  return g;
}

// ============================================================== GAS STATION

// Painted panel material with an optional emissive (back-lit) layer drawn by `drawE`.
function panelMat(key, w, h, draw, drawE = null, intensity = 2.5, extra = {}) {
  return once(`panel_${key}`, () => {
    const map = TX.painted(`rural_${key}`, w, h, draw);
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.1, ...extra });
    if (drawE) {
      m.emissiveMap = TX.painted(`rural_${key}_e`, w, h, (ctx, cw, ch) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); drawE(ctx, cw, ch); });
      m.emissive = new THREE.Color('#ffffff');
      m.emissiveIntensity = intensity;
    }
    return m;
  });
}

// "89⁹"-style price with the tenth-cent superscript.
function priceText(ctx, x, y, main, size, color = '#111') {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(main, x, y);
  const w = ctx.measureText(main).width;
  ctx.font = `bold ${Math.round(size * 0.5)}px ${FONT}`;
  ctx.fillText('9', x + w + 2, y - size * 0.45);
}

const sunLogo = (ctx, cx, cy, r) => {
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 1.6); ctx.clip();
  for (let i = 0; i < 9; i++) {
    const a = PI + (i / 8) * PI;
    ctx.strokeStyle = '#f2a81d'; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 1.15); ctx.lineTo(cx + Math.cos(a) * r * 1.55, cy + Math.sin(a) * r * 1.55); ctx.stroke();
  }
  const gr = ctx.createLinearGradient(0, cy - r, 0, cy);
  gr.addColorStop(0, '#ffd23a'); gr.addColorStop(1, '#e8541a');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, PI, TAU); ctx.fill();
  ctx.restore();
};

/**
 * Small 80s roadside gas station: white cinder-block office with lit window (shelves, register,
 * OPEN neon), half-open service bay, flat canopy over a pump island (two 80s mechanical-dial
 * pumps with hoses), lit canopy panels, striped "SUNRISE" fascia, tall "GAS" pole sign with a
 * 1986 price board, ice chest, cola machine, tyre rack, oil cans, bollards and an oil-stained apron.
 * Origin: ground, centre of the lot. Office x −9.5..−3, canopy x −1.5..7.5, sign at x ≈ 9.6.
 * Front of office/pumps faces +z (office front at z = 3).
 * @param {object} opts
 * @param {number} [opts.seed=16]
 * Colliders: ledge canopy top (y 4.8, x −1.5..7.5); ledge office roof (y 3.6, x −9.5..−3).
 * Lights: canopy (2), office window, pole sign. update() flickers a canopy tube.
 */
export function makeGasStation(opts = {}) {
  const { seed = 16 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'gasStation';
  const b = new Batch(V(R() * 20, R() * 20, R() * 20));
  const block = mat('cinderWhite'), redP = solid('#9a1f18', 0.45, 0.3), whiteP = solid('#b3afa5', 0.55, 0.2), iron = M.iron(), dark = M.dark(), chrome = M.chrome(), conc = mat('concreteDry');
  // apron + oil stains
  b.add(conc, B(20.5, 0.04, 7.0, -0.5, 0.02, 1.0), 3);
  const stainM = once('oilStain', () => { const m = blobMat().clone(); m.opacity = 0.4; return m; });
  for (let i = 0; i < 7; i++) b.add(stainM, place(new THREE.PlaneGeometry(0.6 + R() * 1.0, 0.4 + R() * 0.7).rotateX(-PI / 2), -1 + R() * 8, 0.045, -0.5 + R() * 4, 0, R() * 3, 0));

  // ---------------- office + service bay
  const ox0 = -9.5, ox1 = -3.0, oz = 3.0, oh = 3.6, od = 6;
  const ocx = (ox0 + ox1) / 2;
  const bayX0 = ox0 + 0.35, bayX1 = ox0 + 3.15, bayH = 2.7;
  const winX0 = -6.1, winX1 = -4.0, winY0 = 0.85, winY1 = 2.6, doorX = -3.55;
  b.add(block, extrude([[ox0, 0.04], [ox1, 0.04], [ox1, oh - 0.55], [ox0, oh - 0.55]], 0.3, oz - 0.3, [[bayX0, 0.05, bayX1, bayH], [winX0, winY0, winX1, winY1], [doorX - 0.45, 0.05, doorX + 0.45, 2.2]]), 1.6);
  b.add(block, B(ox1 - ox0, oh - 0.55, od - 0.3, ocx, (oh - 0.55) / 2, oz - 0.3 - (od - 0.3) / 2), 1.6);
  // red fascia band + parapet cap + lettering
  b.add(redP, B(ox1 - ox0 + 0.1, 0.55, 0.12, ocx, oh - 0.275, oz + 0.02));
  b.add(mat('concreteDark'), B(ox1 - ox0 - 0.1, 0.05, od - 0.2, ocx, oh - 0.32, oz - od / 2), 2);
  b.add(whiteP, B(ox1 - ox0 + 0.16, 0.08, 0.2, ocx, oh - 0.04, oz + 0.02));
  for (const x of [ox0, ox1]) b.add(whiteP, B(0.2, 0.08, od, x, oh - 0.04, oz - od / 2 + 0.1));
  b.add(whiteP, B(ox1 - ox0, 0.3, 0.15, ocx, oh - 0.15, oz - od + 0.08));
  for (const x of [ox0 + 0.05, ox1 - 0.05]) b.add(block, B(0.15, 0.55, od - 0.2, x, oh - 0.3, oz - od / 2), 1.6);
  const svc = panelMat('svcLetters', 1024, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f1ece0'; ctx.font = `bold 66px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HAYDEN SERVICE', w / 2, h / 2 + 4);
  }, null, 0, { transparent: true });
  b.add(svc, place(new THREE.PlaneGeometry(5.2, 0.48), ocx, oh - 0.28, oz + 0.085));
  // service bay: interior, lift, roll-up door half open
  b.add(dark, B(bayX1 - bayX0, bayH, 0.05, (bayX0 + bayX1) / 2, bayH / 2, oz - 2.6));
  b.add(mat('concreteDark'), B(bayX1 - bayX0, 0.02, 2.6, (bayX0 + bayX1) / 2, 0.05, oz - 1.3), 2);
  for (const x of [bayX0 + 0.5, bayX1 - 0.5]) b.add(solid('#b7a43a', 0.5, 0.4), B(0.18, 2.3, 0.18, x, 1.15, oz - 1.8));
  b.add(M.rubber(), place(tyreGeo(0.33, 0.2, 0.2).clone(), (bayX0 + bayX1) / 2, 0.3, oz - 1.0, PI / 2, 0, 0));
  const doorY0 = 1.45;
  for (let y = doorY0; y < bayH; y += 0.16) b.add(whiteP, B(bayX1 - bayX0 - 0.02, 0.15, 0.04, (bayX0 + bayX1) / 2, y + 0.075, oz - 0.12));
  b.add(iron, B(bayX1 - bayX0, 0.05, 0.06, (bayX0 + bayX1) / 2, doorY0 + 0.02, oz - 0.1));
  for (const x of [bayX0 - 0.03, bayX1 + 0.03]) b.add(whiteP, B(0.08, bayH, 0.06, x, bayH / 2, oz + 0.01));
  // office window with lit interior + OPEN neon, glass door
  const interior = panelMat('gasInterior', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a4630'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7a6a52'; ctx.fillRect(0, h * 0.62, w, h);
    const R2 = TX.rng(5);
    for (let s = 0; s < 3; s++) { // shelves of oil cans / snacks
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(w * 0.05, h * (0.18 + s * 0.16), w * 0.42, 6);
      for (let i = 0; i < 14; i++) { ctx.fillStyle = ['#c23b22', '#e0b030', '#2f5fa0', '#f0f0e0', '#3a8a40'][Math.floor(R2() * 5)]; ctx.fillRect(w * 0.06 + i * w * 0.029, h * (0.18 + s * 0.16) - 22, w * 0.022, 22); }
    }
    ctx.fillStyle = '#2a2018'; ctx.fillRect(w * 0.55, h * 0.5, w * 0.4, h * 0.5);
    ctx.fillStyle = '#c0b49a'; ctx.fillRect(w * 0.55, h * 0.48, w * 0.4, 8);
    ctx.fillStyle = '#222'; ctx.fillRect(w * 0.78, h * 0.36, w * 0.1, h * 0.12);
    ctx.fillStyle = '#e8e0c8'; ctx.fillRect(w * 0.62, h * 0.08, w * 0.12, h * 0.2);
    ctx.fillStyle = '#c03a2a'; ctx.fillRect(w * 0.62, h * 0.08, w * 0.12, h * 0.06);
    for (let y = 0; y < h * 0.45; y += 10) { ctx.fillStyle = 'rgba(230,225,210,0.35)'; ctx.fillRect(0, y, w, 4); }
  }, (ctx, w, h) => {
    const gr = ctx.createRadialGradient(w * 0.5, h * 0.2, 10, w * 0.5, h * 0.3, w * 0.7);
    gr.addColorStop(0, '#9a8060'); gr.addColorStop(1, '#2a1e12');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }, 0.9);
  b.add(interior, B(winX1 - winX0, winY1 - winY0, 0.02, (winX0 + winX1) / 2, (winY0 + winY1) / 2, oz - 0.35));
  b.add(M.glass(), B(winX1 - winX0, winY1 - winY0, 0.012, (winX0 + winX1) / 2, (winY0 + winY1) / 2, oz - 0.12));
  b.add(whiteP, B(0.05, winY1 - winY0, 0.05, (winX0 + winX1) / 2, (winY0 + winY1) / 2, oz - 0.1));
  casing(b, whiteP, winX0, winY0, winX1, winY1, oz + 0.01, 0.07, 0.04, true);
  const openN = neonMat('OPEN', { color: '#ff3b3b' });
  const openMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4 * openN.userData.aspect, 0.4), openN);
  openMesh.position.set(winX1 - 0.55, 2.15, oz - 0.1);
  g.add(openMesh);
  b.add(interior, B(0.88, 2.13, 0.02, doorX, 1.08, oz - 0.33));
  b.add(M.glass(), B(0.8, 2.05, 0.012, doorX, 1.08, oz - 0.12));
  b.add(chrome, B(0.88, 0.05, 0.05, doorX, 1.05, oz - 0.08));
  casing(b, chrome, doorX - 0.44, 0.04, doorX + 0.44, 2.17, oz - 0.08, 0.05, 0.04, false);
  const officeSign = panelMat('officeSign', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1e3d6e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2eee2'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OFFICE', w / 2, h / 2 + 2);
  });
  b.add(officeSign, B(0.9, 0.22, 0.03, doorX, 2.55, oz + 0.02));
  // ice chest + cola machine + tyre rack + oil can pyramid
  const ice = panelMat('iceChest', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c3c8cc'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a64b0'; ctx.font = `bold 120px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ICE', w / 2, h * 0.46);
    ctx.font = `bold 26px ${FONT}`; ctx.fillText('PARTY ICE · 10 LB', w / 2, h * 0.78);
    ctx.strokeStyle = '#9aa4ad'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
    weather(ctx, w, h, 14, 0.4);
  });
  b.add(ice, B(1.2, 1.05, 0.7, -5.05, 0.53, oz + 0.45));
  b.add(whiteP, B(1.24, 0.06, 0.74, -5.05, 1.08, oz + 0.45));
  const cola = panelMat('colaMachine', 256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#b3181c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4efe6'; ctx.font = `bold italic 64px ${FONT}`; ctx.textAlign = 'center'; ctx.save(); ctx.translate(w * 0.36, h * 0.45); ctx.rotate(-PI / 2); ctx.fillText('Cola', 0, 20); ctx.restore();
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(w * 0.68, h * 0.1, w * 0.25, h * 0.8);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = '#f0f0f0'; ctx.fillRect(w * 0.71, h * (0.14 + i * 0.12), w * 0.19, h * 0.07); }
    ctx.fillStyle = '#222'; ctx.fillRect(w * 0.1, h * 0.86, w * 0.5, h * 0.08);
  }, (ctx, w, h) => {
    ctx.fillStyle = '#a01010'; ctx.fillRect(w * 0.05, h * 0.05, w * 0.6, h * 0.78);
    ctx.fillStyle = '#ffffff'; ctx.font = `bold italic 64px ${FONT}`; ctx.textAlign = 'center'; ctx.save(); ctx.translate(w * 0.36, h * 0.45); ctx.rotate(-PI / 2); ctx.fillText('Cola', 0, 20); ctx.restore();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = '#9a9a9a'; ctx.fillRect(w * 0.71, h * (0.14 + i * 0.12), w * 0.19, h * 0.07); }
  }, 1.4);
  b.add(solid('#9c1418', 0.45, 0.3), B(0.95, 1.85, 0.8, -2.45, 0.95, oz - 0.1));
  b.add(cola, place(new THREE.PlaneGeometry(0.93, 1.83), -2.45, 0.95, oz + 0.302));
  for (let i = 0; i < 4; i++) b.add(M.rubber(), place(tyreGeo(0.32, 0.2, 0.2).clone(), bayX1 + 0.6, 0.12 + i * 0.21, oz + 0.5, PI / 2, 0, jit(R, 0.08)));
  // ---------------- canopy
  const cx0 = -1.5, cx1 = 7.5, cz0 = -1.5, cz1 = 4.0, cyB = 4.1, cyT = 4.8, ccx = (cx0 + cx1) / 2, ccz = (cz0 + cz1) / 2;
  const fasciaFront = panelMat('canopyFront', 1536, 128, (ctx, w, h) => {
    ctx.fillStyle = '#cfccc3'; ctx.fillRect(0, 0, w, h);
    const bands = [['#c4261c', 0.62], ['#e8641c', 0.74], ['#f2b21f', 0.86]];
    for (const [c, y] of bands) { ctx.fillStyle = c; ctx.fillRect(0, h * y, w, h * 0.1); }
    sunLogo(ctx, w * 0.5 - 250, h * 0.58, 40);
    ctx.fillStyle = '#c4261c'; ctx.font = `900 italic 78px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('SUNRISE', w * 0.5 - 190, h * 0.56);
    weather(ctx, w, h, 19, 0.3);
  }, (ctx, w, h) => {
    ctx.fillStyle = '#e0301c'; ctx.font = `900 italic 78px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('SUNRISE', w * 0.5 - 190, h * 0.56);
  }, 0.6);
  const fasciaSide = panelMat('canopySide', 512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#cfccc3'; ctx.fillRect(0, 0, w, h);
    for (const [c, y] of [['#c4261c', 0.62], ['#e8641c', 0.74], ['#f2b21f', 0.86]]) { ctx.fillStyle = c; ctx.fillRect(0, h * y, w, h * 0.1); }
    weather(ctx, w, h, 21, 0.3);
  });
  b.add(fasciaFront, B(cx1 - cx0, cyT - cyB, 0.12, ccx, (cyB + cyT) / 2, cz1));
  b.add(fasciaSide, B(0.12, cyT - cyB, cz1 - cz0, cx0, (cyB + cyT) / 2, ccz));
  b.add(fasciaSide, B(0.12, cyT - cyB, cz1 - cz0, cx1, (cyB + cyT) / 2, ccz));
  b.add(whiteP, B(cx1 - cx0, cyT - cyB, 0.12, ccx, (cyB + cyT) / 2, cz0));
  b.add(mat('galvanized'), B(cx1 - cx0 - 0.1, 0.06, cz1 - cz0 - 0.1, ccx, cyT - 0.06, ccz), 2);
  b.add(whiteP, B(cx1 - cx0 - 0.1, 0.04, cz1 - cz0 - 0.1, ccx, cyB + 0.12, ccz));
  const tubeM = glow('#eaf4ff', 3.2);
  const tubes = [];
  for (const x of [0.2, 3.0, 5.8]) for (const z of [0.2, 2.4]) {
    b.add(solid('#9aa0a6', 0.4, 0.6), B(1.5, 0.05, 0.42, x, cyB + 0.085, z));
    tubes.push(place(new THREE.BoxGeometry(1.35, 0.03, 0.3), x, cyB + 0.065, z));
  }
  const tubeMesh = new THREE.Mesh(mergeGeometries(tubes.map(normGeo)), tubeM);
  g.add(tubeMesh);
  for (const x of [1.0, 5.0]) {
    b.add(whiteP, B(0.34, cyB, 0.34, x, cyB / 2, 1.25));
    b.add(redP, B(0.36, 0.5, 0.36, x, 0.45, 1.25));
  }
  // pump island
  b.add(conc, RB(5.8, 0.22, 1.1, 0.05, 3.0, 0.13, 1.25), 1.5);
  b.add(hazardYellow(), B(5.82, 0.05, 1.12, 3.0, 0.215, 1.25), 0.4);
  for (const x of [0.25, 5.75]) { b.add(solid('#d6a419', 0.5, 0.3), cylY(0.09, 0.95, x, 0.7, 1.25, 12)); b.add(solid('#d6a419', 0.5, 0.3), place(new THREE.SphereGeometry(0.09, 12, 6, 0, TAU, 0, PI / 2), x, 1.18, 1.25)); }
  const pumps = [['REGULAR', '.89', '#b3211a', 2.0], ['UNLEADED', '.97', '#1f4f9a', 4.0]];
  for (const [grade, price, col, px] of pumps) {
    const face = panelMat(`pump${grade}`, 256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#dcd8cc'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = col; ctx.fillRect(0, 0, w, h * 0.17); ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.fillStyle = '#f5f1e6'; ctx.font = `900 italic 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SUNRISE', w / 2, h * 0.09);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(w * 0.12, h * 0.22, w * 0.76, h * 0.34);
      ctx.fillStyle = '#c8c4b8'; ctx.font = `bold 15px ${FONT}`;
      ctx.fillText('TOTAL SALE', w / 2, h * 0.245); ctx.fillText('GALLONS', w / 2, h * 0.36); ctx.fillText('PRICE PER GALLON', w / 2, h * 0.475);
      ctx.fillStyle = '#f2efe4'; ctx.font = `bold 38px "Courier New", monospace`;
      ctx.fillText('$ 12.40', w / 2, h * 0.3); ctx.fillText('13.8', w / 2, h * 0.415);
      priceText(ctx, w * 0.33, h * 0.55, price, 40, '#f2efe4');
      ctx.fillStyle = col; ctx.font = `bold 34px ${FONT}`; ctx.fillText(grade, w / 2, h * 0.64);
      ctx.fillStyle = '#555'; ctx.fillRect(w * 0.3, h * 0.7, w * 0.4, h * 0.1);
      weather(ctx, w, h, grade.length, 0.5);
    }, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.font = `900 italic 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SUNRISE', w / 2, h * 0.09);
      ctx.fillStyle = '#4a4a40'; ctx.fillRect(w * 0.12, h * 0.22, w * 0.76, h * 0.34);
    }, 1.2);
    b.add(solid('#cfcabd', 0.5, 0.3), B(0.72, 1.55, 0.46, px, 0.22 + 0.775, 1.25));
    b.add(face, place(new THREE.PlaneGeometry(0.7, 1.53), px, 0.22 + 0.775, 1.25 + 0.232));
    b.add(solid(col, 0.45, 0.3), B(0.76, 0.12, 0.5, px, 1.83, 1.25));
    // nozzle holster on the right side, hose looping down
    b.add(iron, B(0.08, 0.3, 0.14, px + 0.4, 1.15, 1.35));
    b.add(M.rubber(), taperTube([V(px + 0.36, 1.6, 1.25), V(px + 0.55, 1.3, 1.45), V(px + 0.62, 0.6, 1.6), V(px + 0.5, 0.45, 1.55), V(px + 0.42, 1.0, 1.4), V(px + 0.42, 1.18, 1.36)], 0.022, 0.022, 6, 30));
    b.add(solid('#2a2a2a', 0.4, 0.6), B(0.06, 0.12, 0.22, px + 0.42, 1.26, 1.36, 0.4, 0, 0));
  }
  // oil can pyramid + trash can + squeegee bucket
  const can = once('oilCan', () => new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10));
  const canM = solid('#1f4f9a', 0.4, 0.5);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) b.add(canM, place(can.clone(), 0.45 + i * 0.12 + r * 0.06, 0.32 + r * 0.16, 1.55));
  b.add(solid('#4a5a3a', 0.6, 0.4), cylY(0.25, 0.9, 5.6, 0.47, 0.75, 14));
  b.add(solid('#2a64b0', 0.5, 0.3), cylY(0.17, 0.32, 0.6, 1.0, 1.0, 12));
  b.add(iron, cylY(0.02, 0.7, 0.6, 0.6, 1.0, 5));
  // ---------------- pole sign: GAS + price board
  const sx = 9.6, poleH = 7.6;
  for (const dx of [-0.5, 0.5]) b.add(iron, cylY(0.1, poleH, sx + dx, poleH / 2, 0.5, 10));
  b.add(conc, cylY(0.3, 0.3, sx - 0.5, 0.15, 0.5, 12), 1);
  b.add(conc, cylY(0.3, 0.3, sx + 0.5, 0.15, 0.5, 12), 1);
  const gasM = panelMat('gasSign', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b4201a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f2efe4'; ctx.lineWidth = 12; ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#f7f3e8'; ctx.font = `900 178px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('GAS', w / 2, h / 2 + 8);
    weather(ctx, w, h, 29, 0.4);
  }, (ctx, w, h) => {
    ctx.fillStyle = '#3a0806'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe9d0'; ctx.font = `900 178px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('GAS', w / 2, h / 2 + 8);
  }, 1.5);
  const priceM = panelMat('priceBoard', 512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#d3d0c6'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1f4f9a'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
    const rows = [['REGULAR', '.89'], ['UNLEADED', '.97'], ['DIESEL', '.85']];
    rows.forEach(([n, p], i) => {
      const y = 92 + i * 92;
      ctx.fillStyle = '#1f4f9a'; ctx.font = `bold 36px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(n, 30, y - 18);
      priceText(ctx, 300, y, p, 76, '#151515');
    });
    weather(ctx, w, h, 31, 0.5);
  });
  b.add(gasM, B(2.6, 1.3, 0.3, sx, poleH - 0.65, 0.5));
  b.add(priceM, B(2.4, 1.5, 0.12, sx, poleH - 2.15, 0.5));
  b.add(iron, B(2.7, 0.08, 0.34, sx, poleH + 0.04, 0.5));
  b.add(iron, B(2.5, 0.06, 0.18, sx, poleH - 2.93, 0.5));
  b.build(g);
  blob(g, ox1 - ox0 + 1, od + 1.2, ocx, 0, 0.45);
  tuftsAlong(g, 14, seed + 3, sx - 1.3, sx + 1.8, 0.6, 0.5);
  tuftsAlong(g, 10, seed + 4, ox0 - 0.6, ox0 + 0.6, 2.5, 1.2);

  const lights = [
    { pos: V(1.6, cyB - 0.3, 1.3), color: '#e6f0ff', intensity: 22, distance: 10 },
    { pos: V(5.4, cyB - 0.3, 1.3), color: '#e6f0ff', intensity: 22, distance: 10 },
    { pos: V((winX0 + winX1) / 2, 1.8, oz + 0.8), color: '#ffc98a', intensity: 8, distance: 6 },
    { pos: V(sx, poleH - 0.65, 1.4), color: '#ff5a3c', intensity: 10, distance: 7 },
  ];
  g.userData.lights = lights;
  g.userData.colliders = [
    { type: 'ledge', x0: cx0, x1: cx1, y: cyT },
    { type: 'ledge', x0: ox0, x1: ox1, y: oh },
  ];
  g.userData.update = (dt, t) => {
    uTime.value = t;
    // one ageing fluorescent tube stutters now and then
    const f = Math.sin(t * 0.7) > 0.93 ? (Math.sin(t * 61) > 0 ? 0.3 : 1) : 1;
    tubeM.emissiveIntensity = 3.2 * (0.92 + 0.08 * f);
    lights[0].intensity = 22 * f;
  };
  return g;
}

// Tileable hazard-stripe paint for curb edges (local; the library version seams when repeated).
function hazardYellow() {
  return once('ruralHazard', () => {
    const t = TX.painted('rural_hazardStripe', 256, 32, (ctx, w, h) => {
      ctx.fillStyle = '#d4a419'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1a1a1a';
      for (let x = -64; x < w + 64; x += 64) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 32, h); ctx.lineTo(x + 64, 0); ctx.lineTo(x + 32, 0); ctx.fill(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
    return m;
  });
}

// ==================================================================== MOTEL

// Curtained window: lit (warm, emissive) or dark variant.
const motelWindow = (lit) => panelMat(lit ? 'motelWinLit' : 'motelWinDark', 256, 192, (ctx, w, h) => {
  const gr = ctx.createLinearGradient(0, 0, 0, h);
  if (lit) { gr.addColorStop(0, '#d9a868'); gr.addColorStop(1, '#8a5a2c'); } else { gr.addColorStop(0, '#2a2a30'); gr.addColorStop(1, '#141418'); }
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  // curtains: patterned panels; lit = parted, dark = closed
  const pat = (x0, x1) => {
    ctx.fillStyle = lit ? '#9c4a1c' : '#4a3a2e'; ctx.fillRect(x0, 0, x1 - x0, h);
    for (let x = x0; x < x1; x += 10) { ctx.fillStyle = lit ? 'rgba(60,20,5,0.35)' : 'rgba(0,0,0,0.35)'; ctx.fillRect(x, 0, 4, h); }
    for (let y = 18; y < h; y += 36) for (let x = x0 + 8; x < x1; x += 28) { ctx.fillStyle = lit ? 'rgba(240,170,60,0.5)' : 'rgba(150,120,80,0.35)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); }
  };
  if (lit) { pat(0, w * 0.26); pat(w * 0.74, w); ctx.fillStyle = 'rgba(255,235,200,0.25)'; ctx.fillRect(w * 0.26, 0, w * 0.48, h); }
  else pat(0, w);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.35, 0); ctx.lineTo(w * 0.55, 0); ctx.lineTo(w * 0.2, h); ctx.fill();
}, lit ? (ctx, w, h) => {
  const gr = ctx.createRadialGradient(w / 2, h * 0.4, 5, w / 2, h * 0.5, w * 0.6);
  gr.addColorStop(0, '#ffcf8a'); gr.addColorStop(1, '#6a3a12');
  ctx.fillStyle = gr; ctx.fillRect(w * 0.2, 0, w * 0.6, h);
  ctx.fillStyle = '#5a2208'; ctx.fillRect(0, 0, w * 0.26, h); ctx.fillRect(w * 0.74, 0, w * 0.26, h);
} : null, 1.3);

// Brass room-number plates: atlas 8×4 cells holding 1..32 (row-major).
const numberAtlas = () => once('motelNumbers', () => {
  const t = TX.painted('rural_motelNumbers', 512, 256, (ctx, w, h) => {
    const cw = w / 8, ch = h / 4;
    for (let i = 0; i < 32; i++) {
      const cx = (i % 8) * cw, cy = Math.floor(i / 8) * ch;
      ctx.fillStyle = '#c9a24a'; ctx.fillRect(cx + 2, cy + 2, cw - 4, ch - 4);
      ctx.strokeStyle = '#6b5220'; ctx.lineWidth = 3; ctx.strokeRect(cx + 5, cy + 5, cw - 10, ch - 10);
      ctx.fillStyle = '#1d1a14'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const n = i < 16 ? i + 1 : i - 16 + 11 + (i >= 16 ? 0 : 0);
      ctx.fillText(String(i < 16 ? n : 100 + (i - 15)), cx + cw / 2, cy + ch / 2 + 2);
    }
  });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.7 });
});
// Plane geometry showing atlas cell `i` of the number atlas.
function numberPlate(i, x, y, z) {
  const geo = new THREE.PlaneGeometry(0.2, 0.13);
  const u0 = (i % 8) / 8, v1 = 1 - Math.floor(i / 8) / 4, uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 8, v1 - (1 - uv.getY(k)) / 4);
  return place(geo, x, y, z);
}

/**
 * Two-storey roadside motel (the film's motel shootout): stucco-and-brick block of numbered rooms
 * (turquoise doors downstairs 1.., orange upstairs 101..), curtained windows (some lit), AC units,
 * door sconces, office bay, concrete upper walkway with picket railing on steel posts, shingled
 * mansard overhang, external steel stairs on the right, ice & soda machines, housekeeping cart,
 * and a tall roadside neon sign on the left: "Sunset" script, stacked "MOTEL" letters, a chasing
 * bulb arrow and a blinking "VACANCY" box.
 * Origin: ground, centre of the building; front wall at z = 4, walkway edge at z = 5.8.
 * Sign pole at x = −width/2 − 3.6, z = 7.
 * @param {object} opts
 * @param {number} [opts.width=20]
 * @param {string} [opts.name='Sunset']
 * @param {number} [opts.seed=17]
 * Colliders: ledge upper walkway (y 3.2, x −width/2 .. width/2 + 1.2 incl. stair landing);
 *   ledge roof (y 6.4, x ±(width/2 + 0.2)). Ladders: stairs at x = width/2 + 0.6, 0 → 3.2.
 * Lights: neon MOTEL (red), VACANCY (green), arrow, two walkway lamps. update(): neon blink/chase.
 * Named children: `neonSign`, `vacancy`, `arrowBulbs`.
 */
export function makeMotel(opts = {}) {
  const { width: W = 20, name = 'Sunset', seed = 17 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'motel';
  const b = new Batch(V(R() * 20, R() * 20, R() * 20));
  const D = 8, zf = D / 2, walk = 1.8, f1 = 3.0, deckTop = 3.2, roofTop = 6.4;
  const stucco = once('motelStucco', () => { const m = mat('stuccoWhite').clone(); m.color.set('#e9d3b8'); return m; }), brick = mat('brickBrown'), conc = mat('concreteDry'), iron = M.iron(), dark = M.dark();
  const cream = solid('#c9c0ac', 0.55, 0.3), trim = solid('#8a4a22', 0.6, 0.2), postM = solid('#bdb6a6', 0.4, 0.6);
  const doorM = [solid('#2f7f80', 0.45, 0.2), solid('#c2652a', 0.45, 0.2)];
  // body
  b.add(stucco, B(W, roofTop - 0.4, D, 0, (roofTop - 0.4) / 2, 0), 2);
  b.add(brick, B(W + 0.04, 0.9, 0.06, 0, 0.45, zf + 0.03), 1.6);
  b.add(cream, B(W + 0.06, 0.07, 0.1, 0, 0.93, zf + 0.04));
  b.add(trim, B(W + 0.04, 0.22, 0.08, 0, f1 - 0.11, zf + 0.04));
  // walkways: ground sidewalk + upper deck slab with fascia
  b.add(conc, B(W + 1.2, 0.12, walk + 0.4, 0.6, 0.06, zf + (walk + 0.4) / 2), 2);
  b.add(conc, B(W + 1.2, deckTop - f1, walk, 0.6, (f1 + deckTop) / 2, zf + walk / 2), 2);
  b.add(trim, B(W + 1.22, 0.26, 0.06, 0.6, deckTop - 0.11, zf + walk + 0.01));
  // rooms: bays across both floors
  const bayW = 3.4, n = Math.max(2, Math.floor(W / bayW)), bw = W / n;
  const plates = [], sconces = [], winLit = [], winDark = [];
  for (let fl = 0; fl < 2; fl++) {
    const y0 = fl === 0 ? 0.12 : deckTop;
    for (let i = 0; i < n; i++) {
      const bx = -W / 2 + i * bw;
      const office = fl === 0 && i === 0;
      const dx = bx + 0.9, wx = bx + bw * 0.66;
      if (office) {
        // office: wide lit window + glass door
        b.add(motelWindow(true), B(1.9, 1.5, 0.02, bx + 2.05, y0 + 1.55, zf + 0.01));
        casing(b, cream, bx + 1.1, y0 + 0.8, bx + 3.0, y0 + 2.3, zf + 0.03, 0.08, 0.05, true);
        b.add(dark, B(0.9, 2.1, 0.02, bx + 0.55, y0 + 1.05, zf + 0.01));
        b.add(M.glass(), B(0.8, 1.95, 0.012, bx + 0.55, y0 + 1.05, zf + 0.025));
        casing(b, cream, bx + 0.1, y0, bx + 1.0, y0 + 2.1, zf + 0.03, 0.06, 0.05, false);
        continue;
      }
      const num = fl === 0 ? i - 1 : 16 + i;
      b.add(doorM[fl], B(0.92, 2.08, 0.05, dx, y0 + 1.04, zf + 0.02));
      b.add(M.chrome(), place(new THREE.SphereGeometry(0.035, 8, 6), dx + 0.36, y0 + 1.0, zf + 0.06));
      b.add(M.chrome(), B(0.8, 0.2, 0.01, dx, y0 + 0.12, zf + 0.05));
      casing(b, cream, dx - 0.46, y0, dx + 0.46, y0 + 2.08, zf + 0.03, 0.07, 0.05, false);
      plates.push(numberPlate(Math.min(31, num), dx, y0 + 1.6, zf + 0.052));
      sconces.push(place(new THREE.SphereGeometry(0.07, 10, 8, 0, TAU, 0, PI * 0.6), dx + 0.7, y0 + 2.0, zf + 0.12));
      b.add(iron, B(0.1, 0.16, 0.08, dx + 0.7, y0 + 2.05, zf + 0.05));
      const lit = R() < 0.4;
      (lit ? winLit : winDark).push(B(1.5, 1.15, 0.02, wx, y0 + 1.55, zf + 0.01));
      b.add(cream, B(0.04, 1.15, 0.04, wx, y0 + 1.55, zf + 0.03));
      casing(b, cream, wx - 0.75, y0 + 0.98, wx + 0.75, y0 + 2.13, zf + 0.03, 0.08, 0.05, true);
      // through-wall AC unit
      b.add(solid('#b9b09a', 0.5, 0.4), B(0.7, 0.42, 0.34, wx, y0 + 0.62, zf + 0.15));
      for (let k = 0; k < 6; k++) b.add(dark, B(0.6, 0.02, 0.01, wx, y0 + 0.47 + k * 0.05, zf + 0.322));
      if (fl === 0) b.add(dark, place(new THREE.PlaneGeometry(0.5, 0.4).rotateX(-PI / 2), dx, 0.125, zf + 0.35));
    }
  }
  for (const gm of winLit) b.add(motelWindow(true), gm);
  for (const gm of winDark) b.add(motelWindow(false), gm);
  b.add(numberAtlas(), mergeGeometries(plates.map(normGeo)));
  const sconceM = glow('#ffd59a', 2.2);
  b.add(sconceM, mergeGeometries(sconces.map(normGeo)));
  // office sign
  const offM = panelMat('motelOffice', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2a5e5e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f0e6cc'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OFFICE', w / 2, h / 2 + 2);
  }, (ctx, w, h) => { ctx.fillStyle = '#f0e6cc'; ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OFFICE', w / 2, h / 2 + 2); }, 0.8);
  b.add(offM, B(1.2, 0.3, 0.04, -W / 2 + 2.05, 2.62, zf + 0.04));
  // posts (ground → deck, deck → overhang)
  const postZ = zf + walk - 0.15;
  for (let i = 0; i <= n; i++) {
    const x = -W / 2 + i * bw + (i === 0 ? 0.15 : i === n ? -0.15 : 0);
    b.add(postM, cylY(0.07, f1, x, f1 / 2, postZ, 10));
    b.add(postM, cylY(0.06, 5.75 - deckTop, x, (deckTop + 5.75) / 2, postZ, 10));
  }
  // railing: top rail, bottom rail, pickets
  const rx0 = -W / 2 + 0.05, rx1 = W / 2 + 1.15, rz = zf + walk - 0.05;
  b.add(postM, B(rx1 - rx0, 0.05, 0.08, (rx0 + rx1) / 2, deckTop + 1.0, rz));
  b.add(postM, B(rx1 - rx0, 0.04, 0.04, (rx0 + rx1) / 2, deckTop + 0.12, rz));
  const pick = [];
  for (let x = rx0 + 0.06; x < rx1; x += 0.13) pick.push(B(0.025, 0.86, 0.025, x, deckTop + 0.55, rz));
  b.add(postM, mergeGeometries(pick.map(normGeo)));
  // mansard overhang (shingles) + soffit + flat roof edge
  const ovZ0 = zf - 0.1, ovZ1 = zf + walk + 0.15, ovY0 = 5.75;
  {
    const L = Math.hypot(ovZ1 - ovZ0, roofTop - ovY0), a = Math.atan2(roofTop - ovY0, ovZ1 - ovZ0);
    b.add(mat('shinglesBrown'), BL(W + 0.5, 0.08, L, 2.4, 0, (ovY0 + roofTop) / 2 + 0.04, (ovZ0 + ovZ1) / 2, a, 0, 0, true));
    b.add(trim, B(W + 0.5, 0.1, 0.08, 0, ovY0 - 0.02, ovZ1 + 0.02));
    b.add(cream, B(W + 0.3, 0.04, ovZ1 - zf, 0, ovY0 - 0.05, (zf + ovZ1) / 2));
    b.add(trim, B(W + 0.5, 0.08, D + 0.3, 0, roofTop - 0.04, -0.15));
    b.add(mat('concreteDark'), B(W, 0.04, D - 0.2, 0, roofTop - 0.02, -0.2), 2);
  }
  // external stairs on the right: landing + 17 steps descending toward +x
  const lx0 = W / 2, lx1 = W / 2 + 1.2, sz0 = zf + 0.25, sz1 = zf + 1.55;
  b.add(conc, B(lx1 - lx0, deckTop - f1, walk, (lx0 + lx1) / 2, (f1 + deckTop) / 2, zf + walk / 2), 2);
  const steps = 17, rise = deckTop / steps, run = 0.22;
  const stepM = solid('#77736c', 0.7, 0.4);
  for (let i = 0; i < steps - 1; i++) {
    const y = deckTop - (i + 1) * rise, x = lx1 + i * run + run / 2;
    b.add(stepM, B(run + 0.02, 0.04, sz1 - sz0, x, y - 0.02, (sz0 + sz1) / 2));
  }
  const sx1 = lx1 + (steps - 1) * run;
  for (const z of [sz0 - 0.03, sz1 + 0.03]) b.add(iron, beamBetween(V(lx1, deckTop - 0.1, z), V(sx1, -0.05, z), 0.04, 0.22, 0));
  for (const z of [sz0 - 0.05, sz1 + 0.05]) {
    b.add(postM, cylBetween(V(lx1, deckTop + 0.95, z), V(sx1, 0.95, z), 0.025, 0.025, 6));
    b.add(postM, cylY(0.025, 0.95, sx1, 0.47, z, 6));
    b.add(postM, cylY(0.025, 1.0, lx1 + 1.6, deckTop - 1.6 * (rise / run) + 0.48, z, 6));
  }
  b.add(postM, cylY(0.07, f1, lx1 - 0.1, f1 / 2, zf + walk - 0.15, 10));
  // walkway clutter: ice machine, soda machine, housekeeping cart, potted plants
  const iceM = panelMat('motelIce', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b9bec2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#244d8a'; ctx.font = `bold 96px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ICE', w / 2, h * 0.32);
    ctx.fillStyle = '#7a8086'; ctx.fillRect(w * 0.2, h * 0.55, w * 0.6, h * 0.3);
    weather(ctx, w, h, 15, 0.4);
  });
  b.add(iceM, B(0.75, 1.5, 0.65, -W / 2 + 3.65, 0.87, zf + 0.42));
  b.add(solid('#1c4f8a', 0.45, 0.3), B(0.85, 1.8, 0.7, -W / 2 + 4.55, 1.02, zf + 0.42));
  b.add(glow('#cfe3ff', 1.2), B(0.5, 1.2, 0.01, -W / 2 + 4.48, 1.1, zf + 0.775));
  const cartX = W * 0.15;
  b.add(solid('#d0cabb', 0.5, 0.3), B(1.0, 0.9, 0.5, cartX, deckTop + 0.55, zf + 0.6));
  for (let k = 0; k < 3; k++) b.add(k === 1 ? solid('#4a6a8a', 0.8, 0) : cream, B(0.9, 0.12, 0.42, cartX, deckTop + 0.2 + k * 0.28, zf + 0.62));
  b.add(solid('#4a6a8a', 0.8, 0), B(0.3, 0.6, 0.3, cartX + 0.62, deckTop + 0.4, zf + 0.6));
  for (const x of [-W / 2 + 5.6, W / 2 - 1.6]) {
    b.add(trim, place(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 12), x, 0.34, zf + 0.5));
  }
  b.build(g);
  for (const x of [-W / 2 + 5.6, W / 2 - 1.6]) {
    const pm = foliageMat('pottedPlant', TX.leafCard({ seed: 361, hue: 0.3, dry: 0.05, leaves: 60 }).map, { sway: 0.02, mode: 0, alphaTest: 0.42 });
    const pts = [];
    for (let k = 0; k < 9; k++) pts.push({ p: V(x + jit(R, 0.18), 0.75 + R() * 0.45, zf + 0.5 + jit(R, 0.18)), s: 0.45 + R() * 0.2, k: 0.6 + R() * 0.3 });
    clumps(g, leafClump(5, 7), pm, pts, seed + k2(x));
  }
  blob(g, W + 2, D + 3, 0.6, 0.8, 0.45);
  tuftsAlong(g, 20, seed + 5, -W / 2 - 1, W / 2 + 4.5, zf + walk + 0.5, 0.4);

  // ---------------- roadside neon sign
  const sign = new THREE.Group();
  sign.name = 'neonSign';
  sign.position.set(-W / 2 - 3.6, 0, zf + 3.0);
  g.add(sign);
  const sb = new Batch();
  const cab = solid('#2f7f80', 0.45, 0.4), cabEdge = solid('#d9cfb8', 0.5, 0.3);
  sb.add(iron, cylY(0.16, 9.2, 0, 4.6, -0.3, 12));
  sb.add(conc, cylY(0.45, 0.35, 0, 0.17, -0.3, 14), 1);
  // vertical MOTEL cabinet
  const cy0 = 4.3, cy1 = 8.9;
  sb.add(cab, B(1.25, cy1 - cy0, 0.42, 0, (cy0 + cy1) / 2, 0));
  sb.add(cabEdge, B(1.33, cy1 - cy0 + 0.08, 0.36, 0, (cy0 + cy1) / 2, 0));
  // name board on top (script)
  sb.add(solid('#c2652a', 0.45, 0.3), RB(2.6, 0.95, 0.35, 0.12, 0.2, cy1 + 0.55, 0));
  // arrow board (bulb-studded) pointing right toward the motel
  const arrowPts = [[-1.2, 0.35], [1.4, 0.35], [1.4, 0.75], [2.4, 0], [1.4, -0.75], [1.4, -0.35], [-1.2, -0.35]];
  const ay = 3.25;
  sb.add(solid('#7a1c18', 0.5, 0.3), place(extrude(arrowPts, 0.22, -0.11), 0.5, ay, 0.0));
  // vacancy box
  sb.add(solid('#1b1d22', 0.5, 0.3), B(2.3, 0.75, 0.3, 0.5, 1.95, 0));
  sb.add(cabEdge, B(2.36, 0.81, 0.24, 0.5, 1.95, 0));
  sb.build(sign);
  // neon letters (additive planes) — cloned so blinking never touches shared materials
  const neonPlane = (text, color, h, x, y, z, font) => {
    const m = neonMat(text, { color, border: false, ...(font ? { font } : {}) }).clone();
    const p = new THREE.Mesh(new THREE.PlaneGeometry(h * m.userData.aspect, h), m);
    p.position.set(x, y, z);
    p.renderOrder = 2;
    sign.add(p);
    return p;
  };
  // stacked MOTEL letters on one additive card (own canvas: the library sign is horizontal)
  const motelM = once('motelVertical', () => {
    const t = TX.painted('rural_motelVertical', 160, 640, (ctx, w, h) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const pass = (blur, lw, style, a) => {
        ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = '#ff2238'; ctx.shadowBlur = blur; ctx.strokeStyle = style; ctx.lineWidth = lw;
        ctx.font = `700 112px "Teko", "Arial Narrow", sans-serif`;
        'MOTEL'.split('').forEach((ch, i) => ctx.strokeText(ch, w / 2, 64 + i * 124));
        ctx.restore();
      };
      pass(30, 12, '#ff2238', 0.6); pass(12, 7, '#ff2238', 0.95); pass(0, 2.2, '#ffd0d4', 0.8);
    });
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.4, 2.0, 2.0) });
  }).clone();
  const motelCard = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4.4), motelM);
  motelCard.position.set(0, (cy0 + cy1) / 2, 0.23);
  motelCard.renderOrder = 2;
  sign.add(motelCard);
  const letters = [motelCard];
  neonPlane(name, '#ffcf3a', 0.82, 0.2, cy1 + 0.55, 0.19, 'italic 700 110px "Brush Script MT", "Segoe Script", cursive');
  const vacancy = neonPlane('VACANCY', '#3dff7a', 0.62, 0.75, 1.95, 0.17);
  vacancy.name = 'vacancy';
  // arrow outline tube + chasing bulbs (3 phases)
  const outline = new THREE.CurvePath();
  { const pp = arrowPts.concat([arrowPts[0]]).map(([x, y]) => V(x * 0.92 + 0.55, ay + y * 0.8, 0.13)); for (let i = 0; i < pp.length - 1; i++) outline.add(new THREE.LineCurve3(pp[i], pp[i + 1])); }
  const tubeMat = glow('#ff6a2a', 4).clone();
  const tube = new THREE.Mesh(new THREE.TubeGeometry(outline, 120, 0.025, 5, false), tubeMat);
  sign.add(tube);
  const bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const phases = [0, 1, 2].map(() => glow('#ffd27a', 5).clone());
  const bulbs = new THREE.Group();
  bulbs.name = 'arrowBulbs';
  const bulbPos = [[], [], []];
  for (let i = 0; i < 34; i++) {
    const p = outline.getPointAt(i / 34);
    bulbPos[i % 3].push(place(bulbGeo.clone(), p.x, p.y, 0.16));
  }
  for (let k = 0; k < 3; k++) bulbs.add(new THREE.Mesh(mergeGeometries(bulbPos[k]), phases[k]));
  sign.add(bulbs);
  const sp = sign.position;
  const lights = [
    { pos: V(sp.x, 6.6, sp.z + 1.8), color: '#ff2a3c', intensity: 9, distance: 10 },
    { pos: V(sp.x + 0.75, 1.95, sp.z + 1.5), color: '#3dff7a', intensity: 4, distance: 6 },
    { pos: V(sp.x + 1.2, ay, sp.z + 1.6), color: '#ffb35a', intensity: 4, distance: 6 },
    { pos: V(-W / 4, f1 - 0.4, zf + 1.2), color: '#ffd59a', intensity: 6, distance: 7 },
    { pos: V(W / 4, roofTop - 0.9, zf + 1.2), color: '#ffd59a', intensity: 6, distance: 7 },
  ];
  g.userData.lights = lights;
  g.userData.colliders = [
    { type: 'ledge', x0: -W / 2, x1: lx1, y: deckTop },
    { type: 'ledge', x0: -W / 2 - 0.2, x1: W / 2 + 0.2, y: roofTop },
  ];
  g.userData.ladders = [{ x: W / 2 + 0.6, y0: 0, y1: deckTop, stairs: true }];
  const base = letters.map((l) => l.material.color.clone());
  g.userData.update = (dt, t) => {
    uTime.value = t;
    // VACANCY: on 1.4 s / off 0.5 s
    const vOn = (t % 1.9) < 1.4;
    vacancy.visible = vOn;
    lights[1].intensity = vOn ? 4 : 0;
    // arrow chase
    const ph = Math.floor(t * 7) % 3;
    phases.forEach((m, k) => { m.emissiveIntensity = k === ph ? 6 : 0.4; });
    tubeMat.emissiveIntensity = 3.5 + Math.sin(t * 40) * 0.2;
    // the tube buzzes and dips now and then
    const bad = Math.sin(t * 0.9) > 0.86 && Math.sin(t * 53) > -0.2;
    letters.forEach((l, i) => { l.material.color.copy(base[i]).multiplyScalar(bad ? 0.35 : 1); });
    lights[0].intensity = bad ? 4 : 9;
  };
  return g;
}
const k2 = (x) => Math.round(Math.abs(x) * 10);

// ==================================================================== DINER

/**
 * Optional chrome roadside diner car: fluted stainless lower body, red enamel bands, long window
 * band with a lit interior (counter, stools, booths, pie case), barrel roof with a rooftop red
 * "DINER" neon and "OPEN 24 HRS", entrance vestibule with steps.
 * Origin: ground, centre. Length ≈ 14 m along x, front (windows) toward +z at z = 2.1.
 * @param {object} opts
 * @param {number} [opts.length=14]
 * @param {number} [opts.seed=18]
 * Colliders: ledge roof crown (y ≈ 3.95, x ±(length/2 − 0.6)); ledge vestibule roof (y 3.0).
 * Lights: interior glow (2), neon sign. update(): neon flicker.
 */
export function makeDiner(opts = {}) {
  const { length: L = 14, seed = 18 } = opts;
  const R = TX.rng(seed);
  const g = new THREE.Group();
  g.name = 'diner';
  const b = new Batch(V(R() * 20, R() * 20, R() * 20));
  const steel = solid('#c3c8cc', 0.22, 1.0), red = solid('#a5161b', 0.35, 0.2), cream = solid('#cdc6b4', 0.5, 0.2), dark = M.dark(), conc = mat('concreteDry');
  const D = 4.2, zf = D / 2, baseY = 0.55, winY0 = 1.45, winY1 = 2.45, eaveY = 3.0, crown = 3.95;
  // plinth + body box + fluted stainless skirt
  b.add(mat('brickRed'), B(L - 0.2, baseY, D - 0.3, 0, baseY / 2, 0), 1.6);
  b.add(cream, B(L, eaveY - baseY, D, 0, (baseY + eaveY) / 2, 0));
  const flutes = [];
  for (let x = -L / 2 + 0.04; x < L / 2; x += 0.085) flutes.push(B(0.05, winY0 - 0.2 - baseY, 0.03, x, (baseY + winY0 - 0.2) / 2, zf + 0.015));
  b.add(steel, mergeGeometries(flutes.map(normGeo)));
  b.add(steel, B(L + 0.04, 0.1, 0.06, 0, baseY + 0.02, zf + 0.02));
  for (const y of [winY0 - 0.12, winY1 + 0.18]) b.add(red, B(L + 0.04, 0.16, 0.05, 0, y, zf + 0.025));
  b.add(steel, B(L + 0.06, 0.04, 0.06, 0, winY0 - 0.02, zf + 0.03));
  b.add(steel, B(L + 0.06, 0.04, 0.06, 0, winY1 + 0.02, zf + 0.03));
  // frieze with name
  const frieze = panelMat('dinerFrieze', 1024, 64, (ctx, w, h) => {
    ctx.fillStyle = '#c8c1ae'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a5161b'; ctx.font = `bold 46px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H A Y D E N   D I N E R', w / 2, h / 2 + 2);
  });
  b.add(frieze, place(new THREE.PlaneGeometry(L * 0.6, 0.24), 0, winY1 + 0.385, zf + 0.012));
  // window band with lit interior
  const interior = panelMat('dinerInterior', 1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#c9b48c'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { ctx.fillStyle = (x / 16) % 2 ? '#2a2a2a' : '#e8e2d2'; ctx.fillRect(x, h * 0.88, 16, h * 0.12); }
    ctx.fillStyle = '#7a1a18'; ctx.fillRect(0, h * 0.55, w, h * 0.12);
    ctx.fillStyle = '#d7d2c6'; ctx.fillRect(0, h * 0.5, w, h * 0.06);
    for (let x = 30; x < w; x += 56) { ctx.fillStyle = '#9a9ea2'; ctx.fillRect(x, h * 0.7, 4, h * 0.2); ctx.fillStyle = '#b3161b'; ctx.beginPath(); ctx.ellipse(x + 2, h * 0.7, 14, 6, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#e8e0c8'; for (let x = 60; x < w; x += 170) ctx.fillRect(x, h * 0.12, 60, h * 0.22);
    ctx.fillStyle = '#5a3a2a'; for (let x = 10; x < w; x += 170) { ctx.beginPath(); ctx.arc(x + 120, h * 0.28, 9, 0, TAU); ctx.fill(); }
  }, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#d8c8a0'); gr.addColorStop(0.5, '#7a6a50'); gr.addColorStop(1, '#2a2218');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }, 1.2);
  b.add(interior, B(L - 0.3, winY1 - winY0, 0.02, 0, (winY0 + winY1) / 2, zf - 0.25));
  b.add(M.glass(), B(L - 0.2, winY1 - winY0, 0.012, 0, (winY0 + winY1) / 2, zf - 0.02));
  for (let x = -L / 2 + 0.1; x <= L / 2; x += 1.0) b.add(steel, B(0.05, winY1 - winY0, 0.05, x, (winY0 + winY1) / 2, zf));
  // barrel roof
  const roof = new THREE.CylinderGeometry(1, 1, L + 0.3, 32, 1, false, 0, PI).rotateZ(PI / 2).scale(1, crown - eaveY, D / 2 + 0.15);
  b.add(solid('#b9bcbc', 0.4, 0.7), place(roof, 0, eaveY, 0));
  b.add(steel, B(L + 0.35, 0.08, D + 0.4, 0, eaveY, 0));
  // vestibule
  const vx = L * 0.18;
  b.add(steel, B(1.9, eaveY - 0.12, 1.0, vx, (eaveY - 0.12) / 2 + 0.06, zf + 0.5));
  b.add(red, B(2.0, 0.14, 1.1, vx, eaveY - 0.05, zf + 0.55));
  b.add(interior, B(1.2, 2.0, 0.02, vx, 1.25, zf + 1.0));
  b.add(M.glass(), B(1.2, 2.0, 0.012, vx, 1.25, zf + 1.015));
  b.add(steel, B(0.04, 2.0, 0.03, vx, 1.25, zf + 1.03));
  for (let i = 0; i < 2; i++) b.add(conc, B(2.0, 0.17, 0.4, vx, 0.085 + i * 0.17, zf + 1.6 - i * 0.35), 1);
  // rooftop neon
  const nb = new THREE.Group();
  nb.position.set(-L * 0.18, crown, 0);
  b.add(dark, B(3.6, 0.08, 0.1, -L * 0.18, crown + 0.1, 0));
  for (const dx of [-1.4, 1.4]) b.add(M.iron(), cylY(0.03, 0.5, -L * 0.18 + dx, crown + 0.25, 0, 6));
  b.build(g);
  g.add(nb);
  const dinerN = neonMat('DINER', { color: '#ff2a3a', border: true }).clone();
  const dn = new THREE.Mesh(new THREE.PlaneGeometry(1.0 * dinerN.userData.aspect, 1.0), dinerN);
  dn.position.set(0, 0.75, 0.06);
  nb.add(dn);
  const openN = neonMat('OPEN 24 HRS', { color: '#38e8ff', border: false }).clone();
  const on = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * openN.userData.aspect, 0.42), openN);
  on.position.set(L * 0.36, winY1 + 0.48, zf + 0.06);
  g.add(on);
  blob(g, L + 1.5, D + 2, 0, 0.3, 0.5);
  tuftsAlong(g, 16, seed + 1, -L / 2 - 0.5, L / 2 + 0.5, zf + 0.4, 0.3);
  const lights = [
    { pos: V(-L / 4, 1.9, zf + 0.8), color: '#ffd9a0', intensity: 10, distance: 7 },
    { pos: V(L / 4, 1.9, zf + 0.8), color: '#ffd9a0', intensity: 10, distance: 7 },
    { pos: V(-L * 0.18, crown + 0.9, 0.9), color: '#ff2a3a', intensity: 14, distance: 9 },
  ];
  g.userData.lights = lights;
  g.userData.colliders = [
    { type: 'ledge', x0: -L / 2 + 0.6, x1: L / 2 - 0.6, y: crown },
    { type: 'ledge', x0: vx - 1.0, x1: vx + 1.0, y: eaveY + 0.02 },
  ];
  const c0 = dinerN.color.clone();
  g.userData.update = (dt, t) => {
    uTime.value = t;
    const f = Math.sin(t * 1.3) > 0.95 ? 0.3 + 0.7 * (Math.sin(t * 70) > 0 ? 1 : 0) : 1;
    dinerN.color.copy(c0).multiplyScalar(f);
    lights[2].intensity = 14 * f;
  };
  return g;
}
