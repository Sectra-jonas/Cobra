// Level 3 "FACTORY" props: a hellish steel foundry (the film's finale, where Cobretti puts the
// Night Slasher on a moving hook and into the furnace). Everything is procedural: static parts
// are merged per material (Batch), repeats are instanced, molten metal is a MeshStandardMaterial
// patched with an animated noise field so it still receives scene lighting/fog/tonemapping.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, solid, glow, grating, worldUV } from '../core/materials.js';
import * as TX from '../core/textures.js';

// ================================================================== helper kit

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const PI = Math.PI, TAU = Math.PI * 2;

// Applies a TRS transform to a geometry in place (Euler XYZ).
function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m4);
}

// Cylindrical UVs around a vertical axis (cx, cz); u is arc length at reference radius r0.
function cylUV(geo, mpt = 2, cx = 0, cz = 0, r0 = 1) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (Math.atan2(p.getX(i) - cx, p.getZ(i) - cz) * r0) / mpt;
    uv[i * 2 + 1] = p.getY(i) / mpt;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
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

// Collects geometries per material and merges them into one mesh per material.
class Batch {
  constructor() { this.parts = new Map(); }
  add(material, geo, mpt = 0) {
    if (mpt) worldUV(geo, mpt);
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
// Cylinder between two points.
function cylBetween(a, b, r0, r1 = r0, seg = 12, open = false) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  _m4.compose(_p.copy(a).lerp(b, 0.5), _q, _s.set(1, 1, 1));
  return g.applyMatrix4(_m4);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cylX = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z, 0, 0, PI / 2);
const cylY = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z);
const cylZ = (r, len, x, y, z, seg = 12) => place(new THREE.CylinderGeometry(r, r, len, seg), x, y, z, PI / 2);

// I-beam along 'x' | 'y' | 'z', centred at (x,y,z). Web faces the camera for x/y beams.
function ibeam(b, m, axis, len, x, y, z, h = 0.36, w = 0.2, tf = 0.025, tw = 0.014, mpt = 1.5) {
  const parts = [B(len, tf, w, 0, h / 2 - tf / 2, 0), B(len, tf, w, 0, -h / 2 + tf / 2, 0), B(len, h - tf * 2, tw, 0, 0, 0)];
  for (const g of parts) {
    if (axis === 'y') place(g, 0, 0, 0, 0, 0, PI / 2);
    else if (axis === 'z') place(g, 0, 0, 0, 0, PI / 2, 0);
    place(g, x, y, z);
    b.add(m, g, mpt);
  }
}

// Domed rivet heads. `n` is the facing axis: 'z','x','-x','y','-z'.
let RIVET = null;
function rivet(b, m, x, y, z, n = 'z', r = 0.028) {
  if (!RIVET) RIVET = new THREE.SphereGeometry(1, 6, 3, 0, TAU, 0, PI / 2).toNonIndexed();
  const g = RIVET.clone();
  const rot = { z: [PI / 2, 0, 0], '-z': [-PI / 2, 0, 0], x: [0, 0, -PI / 2], '-x': [0, 0, PI / 2], y: [0, 0, 0] }[n];
  b.add(m, place(g, x, y, z, rot[0], rot[1], rot[2], r, r * 0.8, r));
}
function rivetLine(b, m, a, c, count, n = 'z', r = 0.028) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    rivet(b, m, a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t, n, r);
  }
}
let BOLT = null;
function bolt(b, m, x, y, z, n = 'z', r = 0.03, h = 0.035) {
  if (!BOLT) BOLT = new THREE.CylinderGeometry(1, 1, 1, 6).toNonIndexed();
  const g = BOLT.clone();
  const rot = { z: [PI / 2, 0, 0], x: [0, 0, PI / 2], y: [0, 0, 0] }[n] || [PI / 2, 0, 0];
  b.add(m, place(g, x, y, z, rot[0], rot[1], rot[2], r, h, r));
}

// Safety railing along x: posts, top rail, mid rail, toe board.
function railing(b, x0, x1, y, z, { h = 1.07, spacing = 1.6, m = mat('safetyYellow'), toe = true, endPosts = true } = {}) {
  const len = x1 - x0, n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    if (!endPosts && (i === 0 || i === n)) continue;
    b.add(m, B(0.05, h, 0.05, x0 + (len * i) / n, y + h / 2, z), 1);
  }
  b.add(m, cylX(0.026, len + 0.05, (x0 + x1) / 2, y + h, z, 10), 1);
  b.add(m, cylX(0.02, len, (x0 + x1) / 2, y + h * 0.52, z, 8), 1);
  if (toe) b.add(m, B(len, 0.1, 0.012, (x0 + x1) / 2, y + 0.05, z), 1);
}

const cacheM = new Map();
const once = (key, fn) => (cacheM.has(key) ? cacheM.get(key) : (cacheM.set(key, fn()), cacheM.get(key)));

// ============================================================ shared materials

// Global foundry clock shared by all animated materials (each prop's update() sets it).
const uTime = { value: 0 };

const MOLTEN_GLSL = /* glsl */ `
float moltenField(vec3 P, float t) {
#if MOLTEN_MODE == 0
  vec2 p = P.xz * 0.16;
  vec2 w = vec2(texture2D(uNoise, p * 0.7 + t * 0.006).g, texture2D(uNoise, p * 0.7 + 0.37 - t * 0.005).r) - 0.5;
  vec2 q = p + w * 0.35 + vec2(t * 0.012, t * 0.004);
  float n = texture2D(uNoise, q).r;
  float n2 = texture2D(uNoise, q * 2.7 + vec2(-t * 0.02, t * 0.01)).g;
  float cell = abs(n - 0.5) * 2.0;
  float crack = (1.0 - smoothstep(0.015, 0.09 + 0.05 * n2, cell)) * (0.75 + 0.25 * n2);
  float pools = smoothstep(0.64, 0.8, n2 + 0.08 * sin(t * 0.8 + n * 9.0)) * 0.85;
  float glowc = (1.0 - smoothstep(0.0, 0.35, cell)) * 0.35;
  float bub = smoothstep(0.9, 0.99, texture2D(uNoise, P.xz * 0.8 + vec2(0.0, t * 0.04)).b) * (0.6 + 0.4 * sin(t * 5.0 + n * 20.0));
  return clamp(max(max(max(crack, pools), bub), glowc), 0.0, 1.0);
#elif MOLTEN_MODE == 1
  vec2 p = vec2((P.x + P.z) * 1.2, P.y * 0.3 + t * 1.6);
  float n = texture2D(uNoise, p).r;
  float n2 = texture2D(uNoise, p * vec2(1.0, 2.0) + 0.5).g;
  return clamp(0.62 + (n - 0.5) * 1.3 + (n2 - 0.5) * 0.7, 0.25, 1.0);
#else
  vec2 p = vec2(P.x * 0.2, P.y * 0.14 - t * 0.32);
  float n = texture2D(uNoise, p).r;
  float n2 = texture2D(uNoise, p * 2.3 + vec2(0.31, -t * 0.25)).g;
  float f = n * 0.8 + n2 * 0.6;
  float tongue = smoothstep(0.35, 0.8, texture2D(uNoise, vec2(P.x * 0.35, P.y * 0.1 - t * 0.5)).r);
  return clamp(-0.32 + f * 1.05 - P.y * 0.14 + tongue * 0.25 + 0.05 * sin(t * 13.0 + n * 8.0), 0.0, 1.0);
#endif
}
vec3 moltenColor(float m) {
  vec3 c = mix(vec3(0.4, 0.03, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.55, m));
  c = mix(c, vec3(1.0, 0.7, 0.32), smoothstep(0.65, 1.0, m));
  return c * (0.06 + m * m * 0.95);
}
`;

// Molten metal. mode 0 = pool surface (crust plates over cracks, xz), 1 = falling stream (y), 2 =
// furnace mouth flames (xy). Pattern is in object space so moving props carry it along.
function moltenMat(mode = 0, glowK = 4) {
  return once(`molten${mode}_${glowK}`, () => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, emissive: '#ffffff' });
    m.defines = { MOLTEN_MODE: mode };
    m.userData.noShadow = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.uniforms.uNoise = { value: TX.noiseTexture(256, 121, 4, 5) };
      sh.uniforms.uGlow = { value: glowK };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMP = transformed;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vMP;\nuniform float uTime;\nuniform float uGlow;\nuniform sampler2D uNoise;\n${MOLTEN_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat mf = moltenField(vMP, uTime);\ndiffuseColor.rgb = mix(vec3(0.05, 0.042, 0.038), vec3(0.3, 0.09, 0.02), mf);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.9, 0.35, mf);')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = moltenColor(mf) * uGlow;');
    };
    m.customProgramCacheKey = () => `molten${mode}`;
    return m;
  });
}

// Additive soft glow card (heat bloom around hot things). Not cached: callers may flicker it.
function glowCard(color, k = 1.5) {
  return new THREE.MeshBasicMaterial({
    map: TX.radial(128, 0, 2.0), color: new THREE.Color(color).multiplyScalar(k),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
}
// Dark soot / grime decal (radial, noisy).
function sootMat(opacity = 0.75) {
  return once(`soot${opacity}`, () => new THREE.MeshBasicMaterial({
    map: sootTex(), color: '#000000', transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
}
function sootTex() {
  return TX.painted('factorySoot', 256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x / w) * 2 - 1, dy = (y / h) * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = TX.fbm((x / w) * 5, (y / h) * 5, 5, 5, 17);
      const streak = TX.fbm((x / w) * 24, (y / h) * 2, 24, 3, 23);
      const a = Math.max(0, Math.min(1, (1 - d) * 1.5)) * (0.45 + n * 0.6 + streak * 0.25);
      const j = (y * w + x) * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      img.data[j + 3] = Math.min(255, a * a * 255);
    }
    ctx.putImageData(img, 0, 0);
  });
}

// Brick that glows from heat (furnace mouth reveal / pool lining).
function hotBrick() {
  return once('hotBrick', () => {
    const src = mat('fireBrick');
    const m = src.clone();
    m.emissive = new THREE.Color('#ff4a10');
    m.emissiveMap = src.map;
    m.emissiveIntensity = 1.6;
    return m;
  });
}

// Grime + scratches over a painted canvas.
function weatherCanvas(ctx, w, h, seed = 1, amount = 0.5) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const R = TX.rng(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = TX.fbm((x / w) * 6, (y / w) * 6, 64, 4, seed);
    const st = TX.fbm((x / w) * 40, (y / h) * 3, 40, 3, seed + 5) * (y / h);
    const rust = TX.fbm((x / w) * 14, (y / w) * 14, 64, 3, seed + 9) > 0.72 ? 1 : 0;
    const k = 1 - amount * Math.max(0, n * 1.5 - 0.45) - amount * st * 0.6;
    const j = (y * w + x) * 4;
    if (rust && R() < 0.85) { d[j] = d[j] * 0.35 + 95 * 0.65; d[j + 1] = d[j + 1] * 0.35 + 52 * 0.65; d[j + 2] = d[j + 2] * 0.35 + 30 * 0.65; }
    d[j] *= k; d[j + 1] *= k; d[j + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(220,220,210,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40 * amount; i++) {
    const x = R() * w, y = R() * h, a = R() * TAU, l = 10 + R() * 50;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
}

// Painted sign/label materials (canvas). kind -> drawn once and cached.
const SIGNS = {
  danger: [512, 340, (c, w, h) => {
    c.fillStyle = '#ece6d6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h * 0.42);
    c.fillStyle = '#c4161c'; c.beginPath(); c.ellipse(w / 2, h * 0.21, w * 0.36, h * 0.15, 0, 0, TAU); c.fill();
    c.strokeStyle = '#ece6d6'; c.lineWidth = 6; c.stroke();
    c.fillStyle = '#fff'; c.font = '900 76px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('DANGER', w / 2, h * 0.22);
    c.fillStyle = '#111'; c.font = '900 64px Impact, "Arial Black", sans-serif';
    c.fillText('MOLTEN', w / 2, h * 0.58); c.fillText('METAL', w / 2, h * 0.82);
    c.strokeStyle = '#111'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
  }],
  hardhat: [512, 340, (c, w, h) => {
    c.fillStyle = '#ece6d6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1d4f9c'; c.fillRect(0, 0, w, h * 0.3);
    c.fillStyle = '#fff'; c.font = 'italic 900 64px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('NOTICE', w / 2, h * 0.155);
    c.fillStyle = '#1d4f9c'; c.beginPath(); c.arc(w * 0.2, h * 0.65, h * 0.25, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w * 0.2, h * 0.7, h * 0.15, PI, 0); c.fill(); c.fillRect(w * 0.2 - h * 0.2, h * 0.69, h * 0.4, h * 0.045);
    c.fillStyle = '#111'; c.font = '900 50px Impact, "Arial Black", sans-serif'; c.textAlign = 'left';
    c.fillText('HARD HATS', w * 0.4, h * 0.5); c.fillText('REQUIRED', w * 0.4, h * 0.67);
    c.font = '700 26px Arial, sans-serif'; c.fillText('IN THIS AREA', w * 0.4, h * 0.83);
    c.strokeStyle = '#1d4f9c'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
  }],
  board: [640, 400, (c, w, h) => {
    c.fillStyle = '#1f5a34'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8e2cf'; c.lineWidth = 8; c.strokeRect(12, 12, w - 24, h - 24);
    c.fillStyle = '#e8e2cf'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 54px Impact, "Arial Black", sans-serif'; c.fillText('SAFETY FIRST', w / 2, 62);
    c.font = '700 28px Arial, sans-serif'; c.fillText('THIS PLANT HAS WORKED', w / 2, 118);
    c.fillStyle = '#0d0d0d'; c.fillRect(w / 2 - 150, 142, 300, 110);
    c.fillStyle = '#f2efe4';
    c.font = '900 92px "Courier New", monospace';
    ['0', '0', '3'].forEach((d, i) => { c.fillRect(w / 2 - 138 + i * 96, 150, 84, 94); });
    c.fillStyle = '#121212'; ['0', '0', '3'].forEach((d, i) => c.fillText(d, w / 2 - 96 + i * 96, 200));
    c.fillStyle = '#e8e2cf'; c.font = '700 28px Arial, sans-serif';
    c.fillText('DAYS WITHOUT A LOST-TIME ACCIDENT', w / 2, 284);
    c.font = '700 24px Arial, sans-serif';
    c.fillText('SHIFT  C      FOREMAN  J. KOWALSKI      BEST  212', w / 2, 336);
  }],
  mill: [1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(214,206,186,0.85)'; c.font = '900 190px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MILL  No. 4', w / 2, h / 2 + 8);
    const img = c.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const n = TX.fbm((x / w) * 16, (y / h) * 4, 64, 4, 77);
      img.data[j + 3] *= Math.max(0, Math.min(1, n * 2.4 - 0.55));
      if ((x % 120) < 7 && img.data[j + 3] > 0) img.data[j + 3] = 0; // stencil bridges
    }
    c.putImageData(img, 0, 0);
  }],
  oxygen: [512, 256, (c, w, h) => {
    c.fillStyle = '#1e6b3a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f1eee2'; c.font = '900 120px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('OXYGEN', w / 2, h * 0.42);
    c.font = '700 34px Arial, sans-serif'; c.fillText('NO OIL  -  NO OPEN FLAME', w / 2, h * 0.8);
  }],
  arrow: [256, 64, (c, w, h) => {
    c.fillStyle = '#d7a514'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#111';
    for (let i = 0; i < 3; i++) { const x = 30 + i * 80; c.beginPath(); c.moveTo(x, 12); c.lineTo(x + 40, h / 2); c.lineTo(x, h - 12); c.lineTo(x + 14, h / 2); c.fill(); }
  }],
  column: [256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(235,230,215,0.9)'; c.font = '900 90px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('C-12', w / 2, h / 2 + 4);
  }],
  load: [512, 160, (c, w, h) => {
    c.fillStyle = '#e8e3d2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#111'; c.font = '900 92px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SWL 60 T', w / 2, h / 2 + 4);
  }],
  control: [512, 128, (c, w, h) => {
    c.fillStyle = '#20252b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e3d2'; c.font = '900 68px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('POURING CONTROL', w / 2, h / 2 + 4, w - 30);
  }],
  crate: [512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(25,22,20,0.85)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 92px Impact, "Arial Black", sans-serif'; c.fillText('BETHLEM', w / 2, h * 0.3);
    c.font = '900 64px Impact, "Arial Black", sans-serif'; c.fillText('STEEL CO.', w / 2, h * 0.47);
    c.font = '700 44px "Courier New", monospace'; c.fillText('ROLLER BRG', w / 2, h * 0.66); c.fillText('No. 4-1186', w / 2, h * 0.76);
    c.lineWidth = 7; c.strokeStyle = 'rgba(25,22,20,0.85)';
    c.beginPath(); c.moveTo(w * 0.42, h * 0.92); c.lineTo(w / 2, h * 0.84); c.lineTo(w * 0.58, h * 0.92); c.stroke();
  }],
};
function signMat(kind, { weathered = 0.55, emissive = 0, transparent = false } = {}) {
  return once(`sign_${kind}_${weathered}_${emissive}`, () => {
    const [w, h, draw] = SIGNS[kind];
    const tex = TX.painted(`fsign_${kind}_${weathered}`, w, h, (c, W, H) => { draw(c, W, H); if (weathered) weatherCanvas(c, W, H, kind.length * 13 + 5, weathered); });
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, metalness: 0.15, transparent, alphaTest: transparent ? 0.05 : 0, depthWrite: !transparent });
    if (emissive) { m.emissive = new THREE.Color('#ffffff'); m.emissiveMap = tex; m.emissiveIntensity = emissive; }
    if (transparent) { m.polygonOffset = true; m.polygonOffsetFactor = -2; }
    m.userData.aspect = w / h;
    return m;
  });
}

// Round dial gauge face.
function gaugeMat() {
  return once('gauge', () => {
    const tex = TX.painted('fgauge', 128, 128, (c, w, h) => {
      c.fillStyle = '#16171a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e9e4d4'; c.beginPath(); c.arc(64, 64, 58, 0, TAU); c.fill();
      c.strokeStyle = '#c4161c'; c.lineWidth = 9; c.beginPath(); c.arc(64, 64, 46, -0.2, 0.75); c.stroke();
      c.strokeStyle = '#222'; c.lineWidth = 3;
      for (let i = 0; i <= 10; i++) { const a = PI * 0.75 + (i / 10) * PI * 1.5; c.beginPath(); c.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); c.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); c.stroke(); }
      c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.cos(0.35) * 44, 64 + Math.sin(0.35) * 44); c.stroke();
      c.fillStyle = '#111'; c.beginPath(); c.arc(64, 64, 6, 0, TAU); c.fill();
      c.font = '700 13px Arial'; c.textAlign = 'center'; c.fillText('PSI x10', 64, 96);
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.0 });
  });
}

// Dial gauge with steel bezel, facing +z, centre at (x,y,z) (bezel back at z).
function gauge(b, g, x, y, z, r = 0.16) {
  b.add(mat('ironBlack'), place(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.07, 20), x, y, z + 0.035, PI / 2), 1);
  b.add(mat('chrome'), place(new THREE.TorusGeometry(r * 1.04, r * 0.09, 6, 20), x, y, z + 0.075), 1);
  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 20), gaugeMat());
  face.position.set(x, y, z + 0.072);
  g.add(face);
}

// Blinking indicator lamps share these (blink() toggles intensity).
const LAMPS = {
  red: () => once('lampRed', () => new THREE.MeshStandardMaterial({ color: '#200', emissive: '#ff2010', emissiveIntensity: 5 })),
  green: () => once('lampGreen', () => new THREE.MeshStandardMaterial({ color: '#020', emissive: '#30ff50', emissiveIntensity: 4 })),
  amber: () => once('lampAmber', () => new THREE.MeshStandardMaterial({ color: '#210', emissive: '#ffa020', emissiveIntensity: 5 })),
};
function blinkLamps(t) {
  if (cacheM.has('lampRed')) cacheM.get('lampRed').emissiveIntensity = Math.sin(t * 5.5) > 0 ? 6 : 0.3;
  if (cacheM.has('lampAmber')) cacheM.get('lampAmber').emissiveIntensity = Math.sin(t * 3.1 + 1) > -0.3 ? 5 : 0.4;
}

// Caged steel ladder in local coords: rails at x±w/2, wall standoff toward -z. Returns ladder entry.
function steelLadder(b, x, z, y0, y1, { cage = true, ext = 1.05, w = 0.48, m = mat('steelPainted') } = {}) {
  const top = y1 + ext;
  for (const sx of [-1, 1]) {
    b.add(m, B(0.05, top - y0, 0.075, x + (sx * w) / 2, (y0 + top) / 2, z), 1);
    // goose-neck handrail extension curving over toward the wall
    b.add(m, place(new THREE.TorusGeometry(0.2, 0.025, 6, 10, PI / 2), x + (sx * w) / 2, top, z - 0.2, 0, PI / 2, 0), 1);
  }
  for (let y = y0 + 0.3; y < y1 + 0.05; y += 0.3) b.add(m, cylX(0.021, w, x, y, z, 8), 1);
  for (let y = y0 + 1.2; y < top; y += 1.8) {
    for (const sx of [-1, 1]) b.add(m, B(0.04, 0.05, 0.22, x + (sx * w) / 2, y, z - 0.14), 1);
  }
  if (cage && top - y0 > 2.6) {
    const cy0 = y0 + 2.3, hr = 0.38;
    for (let y = cy0; y <= top + 0.01; y += 0.85) {
      b.add(m, place(new THREE.TorusGeometry(hr, 0.018, 4, 18, PI), x, y, z + 0.02, PI / 2, 0, 0), 1);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * PI;
      b.add(m, cylY(0.012, top - cy0, x + Math.cos(a) * hr, (cy0 + top) / 2, z + 0.02 + Math.sin(a) * hr, 5), 1);
    }
  }
  return { x, y0, y1 };
}

// ======================================================================= props

/**
 * Blast furnace front: heat-stained firebrick hearth with an arched, blazing tap mouth (animated
 * flames + molten floor spilling over the sill), riveted steel shell stack with bands, bustle
 * pipe and tuyeres, smoke hood, buckstays/tie rods, instrument panel with gauges, water pipes,
 * top charging deck with railings and a caged ladder on the right.
 * Size: width x height (default 10 x 12 m), depth 5 m (z -2.5..2.5).
 * @param {{width?:number,height?:number,ladder?:boolean}} opts
 * userData: colliders = deck wings (ledge at y = deck height, left/right of the stack);
 * ladders = right caged ladder (0 -> deck); lights = mouth (flickers) + spill;
 * emitters = embers/sparks at the mouth, smoke at hood and stack top; update(dt,t) animates.
 * Named children: `mouthGlow` (additive glow card).
 */
export function makeFurnace({ width = 10, height = 12, ladder = true } = {}) {
  const W = width, H = height, D = 5, zf = D / 2;
  const g = new THREE.Group();
  g.name = 'furnace';
  const b = new Batch();
  const brick = mat('fireBrick'), steel = mat('rivetSteelDark'), iron = mat('ironBlack'), pipe = mat('rustMetal');
  const deckY = Math.min(6.4, Math.round(H * 0.53 * 10) / 10); // deck top (walkable)
  const bt = deckY - 0.14; // brick top
  const sz = (H - deckY) / 5.6; // vertical scale of the stack above the deck

  // ---- hearth: deep front slab with arched mouth (shape with hole) + back mass
  const mw = Math.min(3.6, W * 0.36), sill = 0.9, spring = 3.0, rise = 0.7, zIn = 0.4;
  const R = ((mw / 2) ** 2 + rise ** 2) / (2 * rise), cy = spring + rise - R;
  const a0 = Math.atan2(spring - cy, mw / 2);
  const hole = [new THREE.Vector2(-mw / 2, sill), new THREE.Vector2(mw / 2, sill)];
  for (let i = 0; i <= 16; i++) {
    const a = a0 + ((PI - 2 * a0) * i) / 16;
    hole.push(new THREE.Vector2(Math.cos(a) * R, cy + Math.sin(a) * R));
  }
  const outer = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(W / 2, bt), new THREE.Vector2(-W / 2, bt)]);
  outer.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x * 1.02, sill - 0.02 + (p.y - sill) * 1.012))));
  b.add(brick, place(new THREE.ExtrudeGeometry(outer, { depth: zf - zIn, bevelEnabled: false, curveSegments: 1 }), 0, 0, zIn), 2.2);
  b.add(brick, B(W, bt, zIn + zf, 0, bt / 2, (zIn - zf) / 2), 2.2);
  b.add(hotBrick(), revealStrip(hole, zIn, zf), 1.6);
  // voussoirs around the arch + steel skewbacks
  for (let i = 0; i < 15; i++) {
    const a = a0 + ((PI - 2 * a0) * (i + 0.5)) / 15;
    const rr = R + 0.24, key = i === 7;
    b.add(brick, B(key ? 0.34 : 0.27, key ? 0.64 : 0.48, 0.14, Math.cos(a) * rr, cy + Math.sin(a) * rr, zf + 0.05, 0, 0, a - PI / 2), 1.2);
  }
  for (const sx of [-1, 1]) {
    b.add(iron, B(0.5, 0.42, 0.16, sx * (mw / 2 + 0.2), spring - 0.05, zf + 0.06), 1);
    b.add(brick, B(0.3, sill, 0.16, sx * (mw / 2 + 0.15), sill / 2, zf + 0.06), 1.2);
  }
  // molten floor inside, spilling over the sill lip into a floor channel
  b.add(iron, B(mw + 0.6, 0.18, 0.5, 0, sill - 0.09, zf + 0.05), 1);
  g.add(new THREE.Mesh(B(mw, 0.06, zf - zIn + 0.2, 0, sill + 0.01, (zIn + zf + 0.2) / 2), moltenMat(0, 2.2)));
  g.add(new THREE.Mesh(spillGeo(0.9, sill + 0.05, zf + 0.3), moltenMat(1, 2.2)));
  g.add(new THREE.Mesh(B(1.6, 0.05, 0.9, 0, 0.03, zf + 0.75), moltenMat(0, 2.2)));
  b.add(iron, B(1.9, 0.14, 0.12, 0, 0.07, zf + 1.26), 1);
  for (const sx of [-1, 1]) b.add(iron, B(0.12, 0.14, 1.1, sx * 0.89, 0.07, zf + 0.75), 1);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(mw + 0.4, spring + rise - sill + 0.4), moltenMat(2, 2.2));
  back.position.set(0, (sill + spring + rise) / 2, zIn + 0.02);
  g.add(back);

  // ---- buckstays (vertical I-beams) + riveted tie bands
  const bxs = [-W / 2 + 0.25, -(mw / 2 + 0.75), mw / 2 + 0.75, W / 2 - 0.25];
  for (const x of bxs) ibeam(b, iron, 'y', bt, x, bt / 2, zf + 0.12, 0.34, 0.24);
  for (const y of [4.75, bt - 0.25]) {
    b.add(steel, B(W, 0.32, 0.08, 0, y, zf + 0.29), 2);
    const n = Math.round(W * 4);
    rivetLine(b, steel, V(-W / 2 + 0.1, y + 0.1, zf + 0.33), V(W / 2 - 0.1, y + 0.1, zf + 0.33), n, 'z', 0.022);
    rivetLine(b, steel, V(-W / 2 + 0.1, y - 0.1, zf + 0.33), V(W / 2 - 0.1, y - 0.1, zf + 0.33), n, 'z', 0.022);
    for (const x of bxs) bolt(b, iron, x, y, zf + 0.35, 'z', 0.06, 0.06);
  }
  b.add(steel, B(W + 0.1, 0.3, 0.1, 0, 0.15, zf + 0.05), 2);

  // ---- smoke hood over the mouth
  const hw = mw + 1.6, hy = 5.55;
  const hp = 1.1;
  const hoodShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(hp, -0.75), new THREE.Vector2(hp, -1.05), new THREE.Vector2(0, -1.05)]);
  b.add(steel, place(new THREE.ExtrudeGeometry(hoodShape, { depth: hw, bevelEnabled: false }), hw / 2, hy - 0.2, zf + 0.33, 0, -PI / 2, 0), 1.6);
  for (const y of [hy - 1.17, hy - 1.03]) rivetLine(b, iron, V(-hw / 2 + 0.1, y, zf + 0.34 + hp), V(hw / 2 - 0.1, y, zf + 0.34 + hp), Math.round(hw * 4), 'z', 0.025);
  for (const sx of [-1, 1]) b.add(iron, cylBetween(V(sx * (hw / 2 - 0.2), hy - 0.9, zf + 0.3 + hp), V(sx * (hw / 2 - 0.2), hy + 0.4, zf + 0.3), 0.03, 0.03, 6), 1);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(mw * 1.75, (spring + rise) * 1.25), glowCard('#ff3a08', 0.22));
  halo.position.set(0, (sill + spring + rise) / 2 + 0.2, zf + 0.02);
  g.add(halo);
  const soot = new THREE.Mesh(new THREE.PlaneGeometry(mw * 1.9, 2.6), sootMat(0.8));
  soot.position.set(0, spring + rise + 0.45, zf + 0.01);
  g.add(soot);

  // ---- top deck (diamond plate) with hazard edge and wing railings (gap at the ladder)
  const sx0 = 3.55, lx = W / 2 - 0.95;
  b.add(mat('factoryFloor'), B(W + 0.3, 0.14, D + 0.3, 0, deckY - 0.07, 0), 1.5);
  b.add(hazard2(), stripeUV(B(W + 0.3, 0.14, 0.02, 0, deckY - 0.07, zf + 0.16), 0.14));
  railing(b, -W / 2 - 0.1, -sx0, deckY, zf + 0.08, { spacing: 1.0 });
  if (ladder) {
    if (lx - 0.4 - sx0 > 0.3) railing(b, sx0, lx - 0.4, deckY, zf + 0.08, { spacing: 1.0 });
    railing(b, lx + 0.4, W / 2 + 0.1, deckY, zf + 0.08, { spacing: 1.0 });
  } else railing(b, sx0, W / 2 + 0.1, deckY, zf + 0.08, { spacing: 1.0 });

  // ---- stack: riveted shell (lathe) with bands, bustle pipe + tuyeres, uptakes, hot-blast main
  const scz = -0.75;
  const prof = [[2.55, 0], [2.55, 0.45], [2.95, 1.1], [2.95, 1.35], [2.45, 3.6], [2.45, 3.8], [1.5, 4.4], [1.5, 4.6], [1.3, 4.65]]
    .map(([r, y]) => new THREE.Vector2(r, deckY + y * sz));
  const shell = place(new THREE.LatheGeometry(prof, 48), 0, 0, scz);
  b.add(steel, cylUV(shell, 2.5, 0, scz, 2.6));
  for (const [r, y] of [[2.6, 0.22], [2.99, 1.22], [2.85, 1.95], [2.68, 2.7], [2.52, 3.4], [2.5, 3.85]]) {
    b.add(iron, place(new THREE.TorusGeometry(r, 0.07, 6, 48), 0, deckY + y * sz, scz, PI / 2, 0, 0), 1);
  }
  const by = deckY + 0.8 * sz, br = 3.2;
  b.add(pipe, place(new THREE.TorusGeometry(br, 0.3, 10, 48), 0, by, scz, PI / 2, 0, 0), 1.5);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + 0.11, ca = Math.cos(a), sa = Math.sin(a);
    if (sa < -0.4) continue;
    const p0 = V(ca * br, by - 0.2, scz + sa * br), p1 = V(ca * (br + 0.02), deckY + 0.35, scz + sa * (br + 0.02)), p2 = V(ca * 2.5, deckY + 0.35, scz + sa * 2.5);
    b.add(iron, cylBetween(p0, p1, 0.085, 0.085, 8), 1);
    b.add(iron, cylBetween(p1, p2, 0.075, 0.075, 8), 1);
    b.add(iron, place(new THREE.SphereGeometry(0.12, 8, 6), p1.x, p1.y, p1.z), 1);
    b.add(glow('#ffb347', 6), place(new THREE.CircleGeometry(0.045, 10), p1.x + ca * 0.12, p1.y, p1.z + sa * 0.12, 0, Math.atan2(ca, sa), 0));
  }
  const topY = deckY + 4.6 * sz;
  for (const sx of [-1, 1]) {
    b.add(pipe, cylBetween(V(sx * 0.8, topY - 0.3, scz + 0.2), V(sx * 1.15, H - 0.2, scz + 0.2), 0.34, 0.3, 16), 1.5);
    b.add(iron, place(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 16), sx * 1.15, H - 0.1, scz + 0.2), 1);
    b.add(iron, place(new THREE.TorusGeometry(0.33, 0.05, 6, 16), sx * 0.98, (topY + H) / 2, scz + 0.2, PI / 2, 0, 0), 1);
  }
  b.add(pipe, cylX(0.55, W + 0.4, 0, deckY + 2.1 * sz, -2.0, 20), 1.5);
  for (const sx of [-1, 1]) b.add(iron, place(new THREE.TorusGeometry(0.58, 0.06, 6, 20), sx * (W / 2 - 0.4), deckY + 2.1 * sz, -2.0, 0, PI / 2, 0), 1);

  // ---- instrument panel (gauges + lamps) on the left, water pipes + valve wheel on the right
  const px = -W / 2 + 1.55;
  b.add(mat('steelPainted'), B(1.5, 1.25, 0.22, px, 1.75, zf + 0.12), 1);
  b.add(iron, B(1.6, 0.08, 0.3, px, 2.42, zf + 0.15), 1);
  gauge(b, g, px - 0.42, 1.95, zf + 0.23, 0.17);
  gauge(b, g, px + 0.05, 1.95, zf + 0.23, 0.17);
  gauge(b, g, px + 0.48, 1.95, zf + 0.23, 0.12);
  [LAMPS.green, LAMPS.red, LAMPS.green, LAMPS.amber].forEach((lm, i) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6), lm());
    l.position.set(px - 0.45 + i * 0.3, 1.38, zf + 0.25);
    g.add(l);
  });
  b.add(iron, cylY(0.04, bt - 2.45, px + 0.6, (bt + 2.45) / 2, zf + 0.18, 8), 1);
  b.add(iron, cylY(0.03, bt - 2.45, px + 0.5, (bt + 2.45) / 2, zf + 0.18, 8), 1);
  const wx = mw / 2 + 1.12, wpipe = solid('#30475a', 0.45, 0.6);
  b.add(wpipe, cylY(0.11, bt - 0.3, wx, bt / 2, zf + 0.3, 14), 1);
  b.add(wpipe, cylY(0.08, bt - 0.3, wx + 0.36, bt / 2, zf + 0.26, 12), 1);
  for (const y of [1.0, 3.3, 5.6]) b.add(iron, place(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14), wx, y, zf + 0.3), 1);
  b.add(solid('#8e1b12', 0.55, 0.3), place(new THREE.TorusGeometry(0.17, 0.028, 6, 16), wx + 0.36, 2.2, zf + 0.6), 1);
  b.add(iron, B(0.18, 0.22, 0.24, wx + 0.36, 2.2, zf + 0.4), 1);
  b.add(iron, cylZ(0.025, 0.3, wx + 0.36, 2.2, zf + 0.5, 6), 1);
  const dz = signMat('danger');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3 / dz.userData.aspect), dz);
  sign.position.set(-(mw / 2 + 1.6), 3.45, zf + 0.03);
  g.add(sign);

  // ---- heat glow card in front of the mouth
  const mouthGlow = new THREE.Mesh(new THREE.PlaneGeometry(mw * 2.2, (spring + rise) * 1.5), glowCard('#ff4a10', 0.16));
  mouthGlow.position.set(0, (sill + spring + rise) / 2, zf + 0.7);
  mouthGlow.name = 'mouthGlow';
  g.add(mouthGlow);

  const ladders = [];
  if (ladder) ladders.push(steelLadder(b, lx, zf + 0.45, 0, deckY, { m: mat('safetyYellow') }));
  b.build(g);

  const lights = [
    { pos: V(0, 2.2, zf + 2.6), color: '#ff6a1c', intensity: 60, distance: 16 },
    { pos: V(0, 0.5, zf + 1.6), color: '#ff7a2a', intensity: 18, distance: 7 },
  ];
  const baseI = lights.map((l) => l.intensity);
  g.userData = {
    colliders: [{ type: 'ledge', x0: -W / 2 - 0.15, x1: -sx0, y: deckY }, { type: 'ledge', x0: sx0, x1: W / 2 + 0.15, y: deckY }],
    ladders,
    lights,
    emitters: [
      { type: 'embers', pos: V(0, sill + 0.6, zf + 0.4), rate: 30 },
      { type: 'sparks', pos: V(0, sill, zf + 0.5), rate: 12 },
      { type: 'smoke', pos: V(0, 4.2, zf + 1.2), rate: 6 },
      { type: 'smoke', pos: V(-1.15, H, scz + 0.2), rate: 3 },
      { type: 'smoke', pos: V(1.15, H, scz + 0.2), rate: 3 },
    ],
    update(dt, t) {
      uTime.value = t;
      blinkLamps(t);
      const f = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 23.7 + 1.3);
      lights[0].intensity = baseI[0] * f;
      lights[1].intensity = baseI[1] * (0.9 + 0.1 * Math.sin(t * 7.1));
      mouthGlow.material.opacity = 0.8 + 0.2 * f;
    },
  };
  return g;
}


// Tunnel walls behind a hole outline (convex polygon), normals facing inward.
function revealStrip(pts, z0, z1) {
  const pos = [], nor = [];
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    let nx = -(c.y - a.y), ny = c.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const mx = (a.x + c.x) / 2 - cx, my = (a.y + c.y) / 2 - cy;
    if (nx * mx + ny * my > 0) { nx = -nx; ny = -ny; }
    const quad = [[a.x, a.y, z0], [c.x, c.y, z0], [c.x, c.y, z1], [a.x, a.y, z0], [c.x, c.y, z1], [a.x, a.y, z1]];
    // wind so the face points along (nx, ny)
    const flip = (c.x - a.x) * ny - (c.y - a.y) * nx;
    const order = flip > 0 ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
    for (const k of order) { pos.push(...quad[k]); nor.push(nx, ny, 0); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

// Curved tongue of metal pouring over the sill lip down to the floor channel.
function spillGeo(w, y0, z0) {
  const curve = new THREE.CubicBezierCurve3(V(0, y0, z0 - 0.3), V(0, y0 + 0.02, z0), V(0, y0 - 0.2, z0 + 0.12), V(0, 0.05, z0 + 0.25));
  return flattenTube(curve, w);
}
function flattenTube(curve, w) {
  // ribbon of width w following the curve, slightly thick
  const n = 14, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    const th = 0.02 + 0.03 * (i / n);
    const ww = w * (1 - 0.35 * (i / n));
    pos.push(-ww / 2, p.y + th, p.z, ww / 2, p.y + th, p.z, ww / 2, p.y - th, p.z, -ww / 2, p.y - th, p.z);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, c = a + 4;
    idx.push(a, c, a + 1, a + 1, c, c + 1); // top
    idx.push(a + 3, a + 2, c + 3, a + 2, c + 2, c + 3); // bottom
    idx.push(a, a + 3, c, a + 3, c + 3, c); // left
    idx.push(a + 1, c + 1, a + 2, a + 2, c + 1, c + 2); // right
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Tileable, weathered hazard stripes (4:1, four stripes per tile) - the shared one doesn't tile.
function hazard2() {
  return once('hazard2', () => {
    const tex = TX.painted('fhazard2', 256, 64, (c, w, h) => {
      c.fillStyle = '#d4a017'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#141414';
      for (let x = -2 * h; x < w + h; x += 64) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0); c.fill(); }
      weatherCanvas(c, w, h, 41, 0.45);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.2 });
  });
}

// Hazard stripe texture is 4:1: world UVs with v spanning `h` metres and u stretched to match.
function stripeUV(geo, h) {
  worldUV(geo, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.25);
  return geo;
}

// C-channel along x (web outward on side `side` = +1 front / -1 back), top at y.
function channelX(b, m, len, x, yTop, z, side = 1, h = 0.2, fl = 0.075, t = 0.012) {
  b.add(m, B(len, h, t, x, yTop - h / 2, z), 1.5);
  b.add(m, B(len, t, fl, x, yTop - t / 2, z - (side * fl) / 2), 1.5);
  b.add(m, B(len, t, fl, x, yTop - h + t / 2, z - (side * fl) / 2), 1.5);
}

/**
 * Steel catwalk with open grating floor, C-channel stringers (hazard-striped front edge), cross
 * members, knee brackets to a back wall plate, and safety railings (top/mid rail, toe board).
 * Deck top at `y` (default 3.2 = tier); spans x -length/2..length/2, z -depth/2..depth/2.
 * @param {{length?:number,railing?:boolean,backRail?:boolean,y?:number,depth?:number,brackets?:boolean}} opts
 * userData.colliders: one ledge { x0:-L/2, x1:L/2, y }.
 */
export function makeCatwalk({ length = 10, railing: rail = true, backRail = true, y = 3.2, depth = 1.2, brackets = true } = {}) {
  const L = length, d = depth;
  const g = new THREE.Group();
  g.name = 'catwalk';
  const b = new Batch();
  const st = mat('steelPainted'), yel = mat('safetyYellow');
  // grating floor (alpha-tested) + perimeter flat bar
  b.add(grating('#3a3d40'), B(L, 0.03, d, 0, y - 0.015, 0), 0.5);
  channelX(b, st, L, 0, y, d / 2 + 0.006, 1);
  channelX(b, st, L, 0, y, -d / 2 - 0.006, -1);
  b.add(hazard2(), stripeUV(B(L, 0.2, 0.004, 0, y - 0.1, d / 2 + 0.014), 0.2));
  for (const sx of [-1, 1]) b.add(st, B(0.012, 0.2, d, (sx * L) / 2, y - 0.1, 0), 1);
  const nb = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i <= nb; i++) {
    const x = -L / 2 + 0.05 + ((L - 0.1) * i) / nb;
    b.add(st, B(0.05, 0.05, d, x, y - 0.06, 0), 1);
  }
  // bolts along the front stringer
  for (let x = -L / 2 + 0.3; x < L / 2; x += 0.6) bolt(b, mat('ironBlack'), x, y - 0.05, d / 2 + 0.02, 'z', 0.018, 0.012);
  if (brackets) {
    const nk = Math.max(1, Math.round(L / 3));
    for (let i = 0; i <= nk; i++) {
      const x = -L / 2 + 0.3 + ((L - 0.6) * i) / nk;
      b.add(st, B(0.16, 0.8, 0.02, x, y - 0.55, -d / 2 - 0.09), 1);
      b.add(st, cylBetween(V(x, y - 0.9, -d / 2 - 0.08), V(x, y - 0.21, d / 2 - 0.1), 0.028, 0.028, 6), 1);
      b.add(st, B(0.06, 0.06, d, x, y - 0.23, 0), 1);
      for (const yy of [y - 0.3, y - 0.8]) bolt(b, mat('ironBlack'), x, yy, -d / 2 - 0.07, 'z', 0.022, 0.02);
    }
  }
  if (rail) {
    railing(b, -L / 2, L / 2, y, d / 2 - 0.03, { m: yel, spacing: 1.5 });
    if (backRail) railing(b, -L / 2, L / 2, y, -d / 2 + 0.03, { m: yel, spacing: 1.5 });
  }
  b.build(g);
  g.userData = { colliders: [{ type: 'ledge', x0: -L / 2, x1: L / 2, y }] };
  return g;
}

/**
 * Catwalk support bent: H-column with anchor-bolted base plate, hazard-striped base, header beam
 * with knee braces and a cap channel (along z) the catwalk stringers sit on (top at `height`).
 * @param {{height?:number,depth?:number}} opts  (no colliders)
 */
export function makeCatwalkSupport({ height = 3.2, depth = 1.2 } = {}) {
  const g = new THREE.Group();
  g.name = 'catwalkSupport';
  const b = new Batch();
  const st = mat('steelPainted'), iron = mat('ironBlack');
  const top = height - 0.2; // stringer bottoms
  ibeam(b, st, 'y', top - 0.16, 0, (top - 0.16) / 2, 0, 0.24, 0.24, 0.02, 0.014);
  b.add(iron, B(0.55, 0.04, 0.55, 0, 0.02, 0), 1);
  for (const [bx, bz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) bolt(b, iron, bx, 0.06, bz, 'y', 0.03, 0.05);
  b.add(hazard2(), stripeUV(B(0.27, 1.2, 0.27, 0, 0.64, 0), 0.25));
  // header (along x) + knee braces + cap channel along z
  ibeam(b, st, 'x', 1.6, 0, top - 0.08, 0, 0.16, 0.12, 0.014, 0.01);
  for (const sx of [-1, 1]) b.add(st, cylBetween(V(sx * 0.1, top - 0.9, 0), V(sx * 0.7, top - 0.14, 0), 0.035, 0.035, 6), 1);
  b.add(st, B(0.16, 0.06, depth + 0.1, 0, top + 0.03, 0), 1);
  b.add(iron, B(0.3, 0.3, 0.02, 0, top - 0.25, 0.13), 1);
  for (const [bx, by] of [[-0.1, -0.15], [0.1, -0.15], [-0.1, -0.35], [0.1, -0.35]]) bolt(b, iron, bx, top + by, 0.145, 'z', 0.02, 0.02);
  b.build(g);
  g.userData = {};
  return g;
}

/**
 * Caged industrial steel ladder (safety yellow) with standoff brackets, rungs every 0.3 m,
 * safety cage from 2.3 m up and goose-neck handrail extensions 1.05 m above the top.
 * Rails at z = 0, wall side toward -z.
 * @param {{height?:number,cage?:boolean}} opts
 * userData.ladders: [{ x:0, y0:0, y1:height }].
 */
export function makeLadderSteel({ height = 3.2, cage = true } = {}) {
  const g = new THREE.Group();
  g.name = 'ladderSteel';
  const b = new Batch();
  const L = steelLadder(b, 0, 0, 0, height, { cage, m: mat('safetyYellow') });
  for (const sx of [-1, 1]) b.add(mat('ironBlack'), B(0.14, 0.02, 0.16, sx * 0.24, 0.01, -0.02), 1);
  b.build(g);
  g.userData = { ladders: [L] };
  return g;
}

/**
 * Belt conveyor: scrolling rubber belt (cleats) over head/tail drums, side channels with
 * direction-arrow decals, idlers, H-legs with braces, drive motor + gearbox + chain guard at the
 * head (+x) end. Belt top at `height`. Optional red-hot slabs riding the belt (visual only).
 * @param {{length?:number,width?:number,height?:number,speed?:number,cargo?:number}} opts
 * userData.speed: belt surface speed in m/s along +x (negative = toward -x) - move riders by it.
 * userData.colliders: ledge on the belt top. Named children: `drumHead`, `drumTail`.
 */
export function makeConveyor({ length = 12, width = 1.3, height = 1.1, speed = 1.2, cargo = 0 } = {}) {
  const L = length, w = width, H = height, r = 0.2;
  const g = new THREE.Group();
  g.name = 'conveyor';
  const b = new Batch();
  const st = mat('steelPainted'), iron = mat('ironBlack'), yel = mat('safetyYellow');
  // per-conveyor belt material (textures cloned so each belt scrolls on its own; GPU image shared)
  const src = mat('beltRubber');
  const beltM = src.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap']) { beltM[k] = src[k].clone(); beltM[k].needsUpdate = true; }
  const mpt = 1.0;
  b.add(beltM, B(L, 0.03, w, 0, H - 0.015, 0), mpt);
  b.add(beltM, B(L, 0.03, w, 0, H - 2 * r - 0.015, 0), mpt);
  for (const sx of [-1, 1]) {
    const wrap = new THREE.CylinderGeometry(r + 0.015, r + 0.015, w, 16, 1, true, sx > 0 ? 0 : PI, PI);
    b.add(beltM, place(wrap, (sx * L) / 2, H - r, 0, PI / 2, 0, 0), mpt);
  }
  const drums = [];
  for (const sx of [-1, 1]) {
    const dm = new THREE.Mesh(place(new THREE.CylinderGeometry(r, r, w + 0.16, 16), 0, 0, 0, PI / 2, 0, 0), iron);
    dm.position.set((sx * L) / 2, H - r, 0);
    dm.name = sx > 0 ? 'drumHead' : 'drumTail';
    dm.castShadow = true;
    g.add(dm);
    drums.push(dm);
    b.add(iron, place(new THREE.CylinderGeometry(0.06, 0.06, w + 0.5, 10), (sx * L) / 2, H - r, 0, PI / 2, 0, 0), 1);
    for (const sz of [-1, 1]) b.add(st, B(0.34, 0.22, 0.12, (sx * L) / 2, H - r, sz * (w / 2 + 0.2)), 1);
  }
  // side channels (top flush with belt), arrow decals on the front one
  for (const sz of [-1, 1]) channelX(b, st, L, 0, H - 0.02, sz * (w / 2 + 0.07), sz, 0.26);
  const arrowM = signMat('arrow', { weathered: 0.4 });
  for (let x = -L / 2 + 1.5; x < L / 2 - 1; x += 3) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), arrowM);
    a.position.set(x, H - 0.15, w / 2 + 0.085);
    if (speed < 0) a.rotation.z = PI;
    g.add(a);
  }
  // idlers (top, troughing hidden) + return rollers
  for (let x = -L / 2 + 0.8; x < L / 2 - 0.4; x += 1.0) b.add(iron, place(new THREE.CylinderGeometry(0.06, 0.06, w + 0.1, 10), x, H - 0.1, 0, PI / 2, 0, 0), 1);
  for (let x = -L / 2 + 1.5; x < L / 2 - 1; x += 2.5) b.add(iron, place(new THREE.CylinderGeometry(0.06, 0.06, w + 0.1, 10), x, H - 2 * r - 0.1, 0, PI / 2, 0, 0), 1);
  // legs every ~3 m
  const nl = Math.max(1, Math.round(L / 3));
  for (let i = 0; i <= nl; i++) {
    const x = -L / 2 + 0.4 + ((L - 0.8) * i) / nl;
    for (const sz of [-1, 1]) {
      b.add(st, B(0.1, H - 0.28, 0.1, x, (H - 0.28) / 2, sz * (w / 2 + 0.1)), 1);
      b.add(iron, B(0.22, 0.02, 0.22, x, 0.01, sz * (w / 2 + 0.1)), 1);
    }
    b.add(st, B(0.06, 0.06, w + 0.2, x, 0.25, 0), 1);
    if (i < nl) {
      const x2 = -L / 2 + 0.4 + ((L - 0.8) * (i + 1)) / nl;
      b.add(st, cylBetween(V(x, 0.3, w / 2 + 0.12), V(x2, H - 0.35, w / 2 + 0.12), 0.025, 0.025, 6), 1);
    }
  }
  // drive at the head end: motor + gearbox + chain guard
  const hx = (L / 2) * Math.sign(speed || 1);
  const dz = w / 2 + 0.45;
  b.add(solid('#2f4b5c', 0.45, 0.5), cylX(0.2, 0.55, hx - Math.sign(hx) * 0.55, H - 0.45, dz + 0.1, 16), 1);
  for (let i = 0; i < 8; i++) b.add(solid('#2f4b5c', 0.45, 0.5), cylX(0.215, 0.02, hx - Math.sign(hx) * (0.35 + i * 0.05), H - 0.45, dz + 0.1, 16), 1);
  b.add(yel, B(0.45, 0.5, 0.4, hx - Math.sign(hx) * 0.05, H - 0.42, dz + 0.05), 1);
  b.add(yel, B(0.2, 0.75, 0.16, hx, H - 0.35, w / 2 + 0.3), 1);
  b.add(st, B(0.9, 0.06, 0.6, hx - Math.sign(hx) * 0.3, H - 0.7, dz + 0.05), 1);
  b.add(st, B(0.08, H - 0.73, 0.08, hx - Math.sign(hx) * 0.7, (H - 0.73) / 2, dz + 0.3), 1);
  const warn = signMat('danger');
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36 / warn.userData.aspect), warn);
  sg.position.set(hx - Math.sign(hx) * 0.05, H - 0.42, dz + 0.252);
  g.add(sg);
  b.build(g);

  // optional red-hot slabs riding on the belt
  const slabs = [];
  if (cargo > 0) {
    const sm = hotSteelMat(0);
    for (let i = 0; i < cargo; i++) {
      const s = new THREE.Mesh(B(1.1, 0.22, 0.7, 0, 0.11, 0), sm);
      s.position.set(-L / 2 + ((i + 0.5) * L) / cargo, H, 0);
      g.add(s);
      slabs.push(s);
    }
  }
  const texs = ['map', 'normalMap', 'roughnessMap'].map((k) => beltM[k]);
  g.userData = {
    speed,
    colliders: [{ type: 'ledge', x0: -L / 2 - 0.1, x1: L / 2 + 0.1, y: H }],
    lights: cargo > 0 ? [{ pos: V(0, H + 0.8, 0.8), color: '#ff5a14', intensity: 25, distance: 8 }] : [],
    update(dt, t) {
      uTime.value = t;
      const du = (speed * dt) / mpt;
      for (const tx of texs) tx.offset.x = (tx.offset.x - du) % 1;
      for (const dm of drums) dm.rotation.z -= (speed * dt) / r;
      for (const s of slabs) {
        s.position.x += speed * dt;
        if (s.position.x > L / 2 - 0.5) s.position.x -= L - 1;
        if (s.position.x < -L / 2 + 0.5) s.position.x += L - 1;
      }
    },
  };
  return g;
}

// Glowing hot steel (ingots/slabs). level 0 = yellow-hot, 1 = orange, 2 = dull red.
function hotSteelMat(level = 0) {
  return once(`hotSteel${level}`, () => {
    const tex = TX.painted('fhotsteel', 128, 128, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const n = TX.fbm((x / w) * 4, (y / h) * 4, 4, 4, 301);
        const fl = TX.fbm((x / w) * 24, (y / h) * 24, 24, 2, 303);
        const scale = fl > 0.72 ? 0.7 : fl > 0.69 ? 0.88 : 1;
        const k = Math.max(0, Math.min(1, (0.68 + n * 0.3) * scale));
        const j = (y * w + x) * 4;
        img.data[j] = 255 * k; img.data[j + 1] = 255 * k * k; img.data[j + 2] = 255 * k * k * k; img.data[j + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const col = ['#ffb347', '#ff6a1a', '#c2260a'][level];
    const m = new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.7, metalness: 0.3, emissive: col, emissiveMap: tex, emissiveIntensity: [2.4, 1.8, 1.2][level] });
    m.userData.noShadow = false;
    return m;
  });
}

/**
 * Molten-metal trough/pit: concrete casing with steel edge angles, hazard-striped front rim,
 * glowing refractory lining and an animated crust surface (shader). Rim walls are platforms.
 * Size: width x depth (default 6 x 3 m), rim height 0.9 m, metal surface at 0.62 m.
 * @param {{width?:number,depth?:number}} opts
 * userData.hazard = { x0, x1, y } - instant death when inside x0..x1 with feet below y.
 * userData.colliders: solid end walls (left/right rims). lights: orange glow along the pool.
 * emitters: embers/smoke over the surface. update(dt,t) animates the surface.
 */
export function makeMoltenPool({ width = 6, depth = 3 } = {}) {
  const W = width, d = depth, rh = 0.9, t = 0.4, sy = 0.62;
  const g = new THREE.Group();
  g.name = 'moltenPool';
  const b = new Batch();
  const conc = mat('factoryConcrete'), iron = mat('ironBlack');
  b.add(conc, B(W, rh, t, 0, rh / 2, d / 2 - t / 2), 1.5);
  b.add(conc, B(W, rh + 0.25, t, 0, (rh + 0.25) / 2, -d / 2 + t / 2), 1.5);
  for (const sx of [-1, 1]) b.add(conc, B(t, rh, d - 2 * t, sx * (W / 2 - t / 2), rh / 2, 0), 1.5);
  b.add(conc, B(W - 2 * t, sy - 0.2, d - 2 * t, 0, (sy - 0.2) / 2, 0), 1.5);
  // glowing lining (inner faces)
  const hot = hotBrick();
  b.add(hot, B(W - 2 * t, rh - sy + 0.05, 0.02, 0, (rh + sy) / 2, d / 2 - t - 0.01), 0.8);
  b.add(hot, B(W - 2 * t, rh + 0.25 - sy + 0.05, 0.02, 0, (rh + 0.25 + sy) / 2, -d / 2 + t + 0.01), 0.8);
  for (const sx of [-1, 1]) b.add(hot, B(0.02, rh - sy + 0.05, d - 2 * t, sx * (W / 2 - t - 0.01), (rh + sy) / 2, 0), 0.8);
  // steel edge angles + hazard band on the front face
  b.add(iron, B(W + 0.04, 0.06, t + 0.04, 0, rh - 0.03, d / 2 - t / 2), 1);
  b.add(iron, B(W + 0.04, 0.06, t + 0.04, 0, rh + 0.22, -d / 2 + t / 2), 1);
  for (const sx of [-1, 1]) b.add(iron, B(t + 0.04, 0.06, d - 2 * t, sx * (W / 2 - t / 2), rh - 0.03, 0), 1);
  b.add(hazard2(), stripeUV(B(W, 0.22, 0.01, 0, rh - 0.17, d / 2 + 0.005), 0.22));
  for (let x = -W / 2 + 0.25; x < W / 2; x += 0.5) bolt(b, iron, x, rh - 0.03, d / 2 + 0.02, 'z', 0.02, 0.02);
  b.add(iron, B(W + 0.1, 0.08, 0.06, 0, 0.04, d / 2 + 0.03), 1);
  const ds = signMat('danger');
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7 / ds.userData.aspect), ds);
  sg.position.set(-W / 2 + 0.9, 0.38, d / 2 + 0.006);
  g.add(sg);
  // soot / heat stains on the front face
  const soot = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 0.9), sootMat(0.5));
  soot.position.set(0, rh - 0.4, d / 2 + 0.003);
  g.add(soot);
  // the metal
  const surf = new THREE.Mesh(B(W - 2 * t, 0.04, d - 2 * t, 0, sy - 0.02, 0), moltenMat(0, 1.8));
  surf.name = 'surface';
  g.add(surf);
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.1, 2.6), glowCard('#ff4a10', 0.1));
  haze.position.set(0, sy + 0.8, 0);
  g.add(haze);
  b.build(g);
  const n = Math.max(1, Math.round(W / 4));
  const lights = [];
  for (let i = 0; i < n; i++) lights.push({ pos: V(-W / 2 + (W * (i + 0.5)) / n, sy + 1.2, 0.6), color: '#ff5c18', intensity: 28, distance: 10 });
  const base = lights.map((l) => l.intensity);
  const emitters = [];
  for (let i = 0; i < n; i++) {
    emitters.push({ type: 'embers', pos: V(-W / 2 + (W * (i + 0.5)) / n, sy + 0.1, 0), rate: 10 });
    emitters.push({ type: 'smoke', pos: V(-W / 2 + (W * (i + 0.5)) / n, sy + 0.3, -0.3), rate: 2 });
  }
  g.userData = {
    hazard: { x0: -W / 2 + t, x1: W / 2 - t, y: sy + 0.1 },
    colliders: [
      { type: 'solid', x0: -W / 2, x1: -W / 2 + t, y0: 0, y1: rh },
      { type: 'solid', x0: W / 2 - t, x1: W / 2, y0: 0, y1: rh },
    ],
    lights,
    emitters,
    update(dt, tt) {
      uTime.value = tt;
      for (let i = 0; i < lights.length; i++) lights[i].intensity = base[i] * (0.85 + 0.15 * Math.sin(tt * 2.3 + i * 1.7) * Math.sin(tt * 5.1 + i));
      haze.material.opacity = 0.85 + 0.15 * Math.sin(tt * 1.7);
    },
  };
  return g;
}

// ---------------------------------------------------------------- chains & hooks

// Merged heavy chain hanging from y=0 down to y=-len (links alternate 90 deg).
function chainGeo(len, scale = 1) {
  return once(`chain${len.toFixed(2)}_${scale}`, () => {
    const R = 0.075 * scale, tr = 0.022 * scale, pitch = 0.2 * scale;
    const link = new THREE.TorusGeometry(R, tr, 6, 12);
    link.scale(1, 1.6, 1);
    const n = Math.max(1, Math.round(len / pitch));
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(normGeo(place(link.clone(), 0, -0.12 * scale - i * pitch, 0, 0, i % 2 ? PI / 2 : 0, 0)));
    return mergeGeometries(parts, false);
  });
}

// Forged crane hook (yellow, worn) in the xy plane; shank eye at y=0, bowl below.
function hookGeo() {
  return once('hookGeo', () => {
    const C = [0.12, -0.62], ri = 0.15;
    const key = [[160, 0.28], [270, 0.37], [330, 0.32], [380, 0.235]];
    const ro = (a) => {
      for (let i = 0; i < key.length - 1; i++) if (a <= key[i + 1][0]) {
        const t = (a - key[i][0]) / (key[i + 1][0] - key[i][0]);
        return key[i][1] + (key[i + 1][1] - key[i][1]) * t;
      }
      return key[key.length - 1][1];
    };
    const P = (a, r) => new THREE.Vector2(C[0] + Math.cos((a * PI) / 180) * r, C[1] + Math.sin((a * PI) / 180) * r);
    const pts = [new THREE.Vector2(-0.075, -0.05), new THREE.Vector2(-0.08, -0.32)];
    for (let a = 165; a <= 380; a += 9) pts.push(P(a, ro(a)));
    pts.push(P(388, (ro(380) + ri) / 2 + 0.01));
    for (let a = 380; a >= 150; a -= 9) pts.push(P(a, ri));
    pts.push(new THREE.Vector2(0.08, -0.32), new THREE.Vector2(0.075, -0.05));
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -0.06);
    const eye = place(new THREE.TorusGeometry(0.075, 0.03, 8, 16), 0, -0.02, 0);
    const parts = [normGeo(geo), normGeo(eye)];
    const m = mergeGeometries(parts, false);
    m.computeBoundingSphere();
    return m;
  });
}
function hookMat() {
  return once('hookMat', () => {
    const src = mat('safetyYellow');
    const m = src.clone();
    m.metalness = 0.5;
    return m;
  });
}

// Builds hook assembly: shackle + hook, scaled. Returns Group with hook origin at the shackle top.
function hookAssembly(scale = 1.7) {
  const h = new THREE.Group();
  h.name = 'hook';
  const shackle = new THREE.Mesh(place(new THREE.TorusGeometry(0.09, 0.025, 6, 14), 0, -0.1, 0, 0, PI / 2, 0), mat('ironBlack'));
  shackle.scale.setScalar(scale);
  const body = new THREE.Mesh(hookGeo(), hookMat());
  body.position.y = -0.2 * scale;
  body.scale.setScalar(scale);
  shackle.castShadow = body.castShadow = true;
  h.add(shackle, body);
  return h;
}

/**
 * Hanging heavy chain with a big forged cargo hook (the film's finale hook), gently swinging.
 * Chain hangs from (0, top) down `length` metres; origin at ground below the pivot.
 * @param {{length?:number,top?:number,swing?:number,seed?:number}} opts
 * Named children: `pivot` (rotates), `chain`, `hook` (the hook assembly; query its world
 * position for gameplay). userData.hook = the hook Object3D. No colliders.
 */
export function makeChainHook({ length = 6, top = 10, swing = 0.05, seed = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'chainHook';
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  pivot.position.y = top;
  g.add(pivot);
  const chain = new THREE.Mesh(chainGeo(length, 1.3), mat('ironBlack'));
  chain.name = 'chain';
  chain.castShadow = true;
  pivot.add(chain);
  const hook = hookAssembly(1.7);
  hook.position.y = -length;
  pivot.add(hook);
  // ceiling eye plate
  const plate = new THREE.Mesh(B(0.4, 0.06, 0.3, 0, 0.03, 0), mat('steelPainted'));
  pivot.add(plate);
  const ph = seed * 1.37;
  g.userData = {
    hook,
    update(dt, t) {
      pivot.rotation.z = Math.sin(t * 0.9 + ph) * swing;
      pivot.rotation.x = Math.sin(t * 0.63 + ph * 2) * swing * 0.4;
    },
  };
  return g;
}

/**
 * Overhead hook conveyor: an oval I-beam monorail (front run at z=0, return run at z=-1.6)
 * hung from ceiling rods, with trolleys carrying chains + big hooks that travel continuously
 * (front run moves +x for positive speed). Drive housing at the right end.
 * @param {{length?:number,count?:number,y?:number,chain?:number,speed?:number}} opts
 *   y = rail bottom height (default 9.2), chain = chain length (default 3.2).
 * userData.hooks: array of hook Object3D (call getWorldPosition); each hook.userData.front is
 * true while on the front (gameplay) run. userData.speed. update(dt,t) moves them.
 */
export function makeHookConveyor({ length = 20, count = 6, y = 9.2, chain = 3.2, speed = 1.5 } = {}) {
  const L = length, rz = -0.8, rr = 0.8; // loop centre line z, end radius
  const g = new THREE.Group();
  g.name = 'hookConveyor';
  const b = new Batch();
  const st = mat('steelPainted'), iron = mat('ironBlack'), yel = mat('safetyYellow');
  // rail: straight runs + segmented end turns (I-section)
  for (const z of [rz + rr, rz - rr]) ibeam(b, st, 'x', L, 0, y + 0.18, z, 0.36, 0.16);
  for (const sx of [-1, 1]) {
    const nseg = 10;
    for (let i = 0; i < nseg; i++) {
      const a = -PI / 2 + (PI * (i + 0.5)) / nseg;
      const cx = (sx * L) / 2 + sx * Math.cos(a) * rr, cz = rz + Math.sin(a) * rr;
      const segLen = (PI * rr) / nseg + 0.02;
      const parts = [B(segLen, 0.025, 0.16, 0, 0.165, 0), B(segLen, 0.025, 0.16, 0, -0.165, 0), B(segLen, 0.31, 0.014, 0, 0, 0)];
      for (const p of parts) b.add(st, place(p, cx, y + 0.18, cz, 0, sx > 0 ? -a - PI / 2 : a - PI / 2, 0), 1.5);
    }
  }
  // hangers to ceiling (+3 m) and cross ties
  const ceil = y + 3;
  for (let x = -L / 2 + 1; x <= L / 2 - 0.9; x += 3) {
    for (const z of [rz + rr, rz - rr]) b.add(iron, cylY(0.025, ceil - y - 0.36, x, (ceil + y + 0.36) / 2, z, 6), 1);
    b.add(st, B(0.1, 0.1, 2 * rr + 0.3, x, y + 0.42, rz), 1);
    b.add(iron, B(0.3, 0.04, 0.3, x, ceil, rz + rr), 1);
  }
  // drive housing at +x end
  b.add(yel, B(1.4, 0.9, 2.3, L / 2 + 0.2, y + 0.9, rz), 1.5);
  b.add(solid('#2f4b5c', 0.45, 0.5), cylZ(0.25, 0.7, L / 2 + 0.2, y + 1.6, rz + 0.6, 16), 1);
  const ls = signMat('load', { weathered: 0.4 });
  const lsm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9 / ls.userData.aspect), ls);
  lsm.position.set(L / 2 + 0.2, y + 0.95, rz + 1.155);
  g.add(lsm);
  b.build(g);

  // carriers
  const loop = 2 * L + TAU * rr;
  const carriers = [], hooks = [];
  const chainM = mat('ironBlack');
  const cg = chainGeo(chain, 1.2);
  for (let i = 0; i < count; i++) {
    const c = new THREE.Group();
    const tb = new Batch();
    tb.add(yel, B(0.5, 0.24, 0.12, 0, y + 0.02, 0.12), 1);
    tb.add(yel, B(0.5, 0.24, 0.12, 0, y + 0.02, -0.12), 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tb.add(iron, place(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), sx * 0.15, y + 0.06, sz * 0.05, PI / 2), 1);
    tb.add(iron, B(0.08, 0.25, 0.08, 0, y - 0.18, 0), 1);
    tb.build(c);
    const ch = new THREE.Mesh(cg, chainM);
    ch.position.y = y - 0.3;
    ch.castShadow = true;
    const swingG = new THREE.Group();
    swingG.position.y = y - 0.3;
    ch.position.y = 0;
    swingG.add(ch);
    const hk = hookAssembly(1.5);
    hk.position.y = -chain;
    swingG.add(hk);
    c.add(swingG);
    c.userData.swing = swingG;
    g.add(c);
    carriers.push(c);
    hooks.push(hk);
  }
  const place2 = (s, c, i, t) => {
    s = ((s % loop) + loop) % loop;
    let x, z, ang, front = false;
    if (s < L) { x = -L / 2 + s; z = rz + rr; ang = 0; front = true; }
    else if (s < L + PI * rr) { const a = (s - L) / rr; x = L / 2 + Math.sin(a) * rr; z = rz + Math.cos(a) * rr; ang = -a; }
    else if (s < 2 * L + PI * rr) { x = L / 2 - (s - L - PI * rr); z = rz - rr; ang = PI; }
    else { const a = (s - 2 * L - PI * rr) / rr; x = -L / 2 - Math.sin(a) * rr; z = rz - Math.cos(a) * rr; ang = PI - a; }
    c.position.set(x, 0, z);
    c.rotation.y = ang;
    c.userData.swing.rotation.x = Math.sin(t * 1.1 + i * 1.9) * 0.03;
    c.userData.swing.rotation.z = Math.sin(t * 0.8 + i * 2.3) * 0.05 - (speed > 0 ? 0.03 : -0.03);
    hooks[i].userData.front = front;
  };
  let s0 = 0;
  for (let i = 0; i < count; i++) place2(s0 + (i * loop) / count, carriers[i], i, 0);
  g.userData = {
    hooks,
    speed,
    update(dt, t) {
      s0 += speed * dt;
      for (let i = 0; i < count; i++) place2(s0 + (i * loop) / count, carriers[i], i, t);
    },
  };
  return g;
}

/**
 * Giant refractory-lined steel ladle hanging from a crane hook block by its bail, tilted on its
 * trunnions and pouring a stream of molten steel (animated) down to the floor with a splash glow.
 * Origin at ground below the ladle; trunnions at `hangY`, cables run up to hangY+6.
 * @param {{tilt?:number,hangY?:number,pourTo?:number}} opts
 * userData.hazard = { x0, x1, y } around the falling stream (death if inside with feet below y).
 * lights: lip + splash; emitters: sparks at the splash, smoke at the lip. Named children:
 * `body` (tilting ladle), `stream`.
 */
export function makeLadle({ tilt = 0.55, hangY = 7, pourTo = 0 } = {}) {
  const g = new THREE.Group();
  g.name = 'ladle';
  const b = new Batch();
  const steel = mat('ladleSteel'), iron = mat('ironBlack');
  // body (tilting) built around trunnion pivot at (0, hangY, 0)
  const body = new THREE.Group();
  body.name = 'body';
  body.position.set(0, hangY, 0);
  g.add(body);
  const bb = new Batch();
  const prof = [[0.01, -1.9], [1.15, -1.9], [1.22, -1.82], [1.5, 0.55], [1.72, 0.6], [1.74, 0.82], [1.52, 0.82], [1.42, 0.7]].map(([r, y]) => new THREE.Vector2(r, y));
  bb.add(steel, cylUV(new THREE.LatheGeometry(prof, 40), 1.6, 0, 0, 1.4));
  for (const [r, y] of [[1.27, -1.4], [1.38, -0.5], [1.48, 0.35]]) bb.add(iron, place(new THREE.TorusGeometry(r, 0.06, 6, 40), 0, y, 0, PI / 2, 0, 0), 1);
  // trunnion bosses + pins (axis z)
  for (const sz of [-1, 1]) {
    bb.add(iron, cylZ(0.32, 0.18, 0, 0, sz * 1.48, 16), 1);
    bb.add(steel, B(0.5, 0.9, 0.08, 0, -0.2, sz * 1.42), 1);
  }
  // pouring spout lip on +x
  bb.add(steel, place(new THREE.CylinderGeometry(0.42, 0.3, 0.5, 12, 1, true, -PI / 2, PI), 1.62, 0.72, 0, 0, 0, PI / 2 - 0.3), 1);
  // refractory lining rim (dark) + molten surface inside
  bb.add(mat('fireBrick'), place(new THREE.TorusGeometry(1.45, 0.08, 6, 40), 0, 0.72, 0, PI / 2, 0, 0), 0.6);
  bb.build(body);
  body.rotation.z = -tilt;
  const surf = new THREE.Mesh(new THREE.CircleGeometry(1.36, 40), moltenMat(0, 3.2));
  g.add(surf);
  // keep the liquid horizontal at the lip height
  const lipLocal = V(1.72, 0.74, 0);
  const lip = lipLocal.clone().applyAxisAngle(V(0, 0, 1), -tilt).add(body.position);
  {
    // axis point at lip height
    const axis = V(-Math.sin(-tilt), Math.cos(-tilt), 0);
    const s = (lip.y - hangY) / axis.y;
    const c = V(0, hangY, 0).addScaledVector(axis, s);
    surf.rotation.set(-PI / 2, 0, 0);
    surf.position.copy(c);
    surf.scale.set(Math.min(1.15, 1 / Math.cos(tilt)) * 0.97, 0.95, 1);
  }
  // bail: two legs from the trunnions up to a crosshead
  const bailTop = hangY + 2.7;
  for (const sz of [-1, 1]) {
    b.add(steel, B(0.42, bailTop - hangY + 0.3, 0.12, 0, (hangY + bailTop) / 2 - 0.05, sz * 1.92), 1.2);
    b.add(iron, cylZ(0.13, 0.55, 0, hangY, sz * 1.68, 16), 1);
    b.add(iron, cylZ(0.24, 0.08, 0, hangY, sz * 2.0, 16), 1);
    rivetLine(b, iron, V(-0.15, hangY + 0.4, sz * 1.99), V(-0.15, bailTop - 0.2, sz * 1.99), 8, sz > 0 ? 'z' : '-z', 0.025);
    rivetLine(b, iron, V(0.15, hangY + 0.4, sz * 1.99), V(0.15, bailTop - 0.2, sz * 1.99), 8, sz > 0 ? 'z' : '-z', 0.025);
  }
  b.add(steel, B(0.5, 0.5, 4.06, 0, bailTop, 0), 1.2);
  // crane hook block + ropes
  const hb = hookAssembly(2.2);
  hb.position.set(-0.26, bailTop + 1.8, 0);
  g.add(hb);
  const blockY = bailTop + 2.25;
  b.add(mat('safetyYellow'), B(0.9, 0.9, 0.5, 0, blockY, 0), 1);
  for (const sz of [-1, 1]) b.add(iron, cylZ(0.42, 0.06, 0, blockY + 0.2, sz * 0.27, 20), 1);
  b.add(hazard2(), stripeUV(B(0.92, 0.25, 0.52, 0, blockY - 0.3, 0), 0.25));
  const ropeTop = hangY + 6.5;
  for (const sx of [-0.3, -0.1, 0.1, 0.3]) b.add(iron, cylY(0.022, ropeTop - blockY - 0.45, sx, (ropeTop + blockY + 0.45) / 2, 0, 6), 1);
  // pour stream: parabola from the lip to the floor
  const v0 = 1.1, gr = 9.81;
  const pts = [];
  const T = Math.sqrt((2 * (lip.y - pourTo)) / gr);
  for (let i = 0; i <= 24; i++) {
    const tt = (T * i) / 24;
    pts.push(V(lip.x + 0.05 + v0 * tt, lip.y - 0.5 * gr * tt * tt, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const stream = new THREE.Mesh(taperTube(curve, 0.17, 0.08, 48), moltenMat(1, 3.5));
  stream.name = 'stream';
  g.add(stream);
  const end = pts[pts.length - 1];
  const splash = new THREE.Mesh(place(new THREE.CylinderGeometry(0.15, 0.55, 0.25, 16, 1, true), end.x, pourTo + 0.12, 0), moltenMat(1, 3));
  g.add(splash);
  const puddle = new THREE.Mesh(place(new THREE.CircleGeometry(0.9, 24), end.x, pourTo + 0.02, 0, -PI / 2), moltenMat(0, 3));
  g.add(puddle);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), glowCard('#ff6a1a', 0.35));
  sg.position.set(end.x, pourTo + 0.6, 0.3);
  g.add(sg);
  const lg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), glowCard('#ff7a2a', 0.3));
  lg.position.set(lip.x + 0.2, lip.y, 0.4);
  g.add(lg);
  b.build(g);
  const lights = [
    { pos: V(lip.x + 0.3, lip.y + 0.2, 1.2), color: '#ff7a2a', intensity: 40, distance: 10 },
    { pos: V(end.x, pourTo + 0.9, 1.2), color: '#ff6a1a', intensity: 70, distance: 12 },
  ];
  const base = lights.map((l) => l.intensity);
  g.userData = {
    hazard: { x0: Math.min(lip.x, end.x) - 0.3, x1: Math.max(lip.x, end.x) + 0.6, y: lip.y },
    lights,
    emitters: [
      { type: 'sparks', pos: V(end.x, pourTo + 0.2, 0), rate: 40 },
      { type: 'smoke', pos: V(end.x, pourTo + 0.5, -0.2), rate: 6 },
      { type: 'smoke', pos: V(lip.x, lip.y + 0.3, 0), rate: 3 },
      { type: 'embers', pos: V(lip.x, lip.y, 0), rate: 10 },
    ],
    update(dt, t) {
      uTime.value = t;
      lights[1].intensity = base[1] * (0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 7.3));
      sg.material.opacity = 0.85 + 0.15 * Math.sin(t * 13.1);
    },
  };
  return g;
}

// Tube along a curve with radius tapering r0 -> r1 (wobbling slightly).
function taperTube(curve, r0, r1, seg = 40, radial = 10) {
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * Math.sqrt(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const wob = 1 + 0.12 * Math.sin(t * 40 + j);
      pos.setXYZ(k, c.x + nor.getX(k) * r * wob, c.y + nor.getY(k) * r * wob, c.z + nor.getZ(k) * r * wob);
    }
  }
  geo.computeVertexNormals();
  return geo;
}


// ------------------------------------------------------------------ utilities 2

// Pipe ID band label ("STEAM ->") painted per text/colour.
function pipeLabelMat(text, bg) {
  return once(`plabel${text}${bg}`, () => {
    const tex = TX.painted(`fplabel${text}${bg}`, 256, 64, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      c.fillStyle = bg === '#d4a017' ? '#111' : '#f2eee2';
      c.font = '900 40px Impact, "Arial Black", sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(text, 14, h / 2 + 2);
      const tw = c.measureText(text).width + 30;
      c.beginPath(); c.moveTo(tw, 18); c.lineTo(tw + 50, 18); c.lineTo(tw + 50, 8); c.lineTo(tw + 76, h / 2); c.lineTo(tw + 50, h - 8); c.lineTo(tw + 50, h - 18); c.lineTo(tw, h - 18); c.fill();
      weatherCanvas(c, w, h, text.length * 7, 0.45);
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
  });
}

// Pipe flange pair with bolt ring, pipe axis along x.
function flangeX(b, m, bm, x, y, z, r) {
  b.add(m, cylX(r + 0.07, 0.05, x - 0.03, y, z, 18), 1);
  b.add(m, cylX(r + 0.07, 0.05, x + 0.03, y, z, 18), 1);
  const n = r > 0.2 ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.add(bm, cylX(0.018, 0.16, x, y + Math.cos(a) * (r + 0.045), z + Math.sin(a) * (r + 0.045), 6), 1);
  }
}

// Handwheel valve on a pipe along x (wheel faces +z).
function valveX(b, body, wheel, x, y, z, r) {
  b.add(body, place(new THREE.SphereGeometry(r * 1.35, 14, 10), x, y, z), 1);
  b.add(body, cylX(r + 0.08, 0.06, x - r * 1.3, y, z, 16), 1);
  b.add(body, cylX(r + 0.08, 0.06, x + r * 1.3, y, z, 16), 1);
  b.add(body, cylZ(r * 0.5, r * 1.6 + 0.2, x, y, z + r * 0.8 + 0.1, 10), 1);
  const wz = z + r * 1.6 + 0.3, wr = Math.max(0.16, r * 1.1);
  b.add(wheel, place(new THREE.TorusGeometry(wr, 0.025, 6, 20), x, y, wz), 1);
  for (let i = 0; i < 3; i++) b.add(wheel, place(new THREE.BoxGeometry(wr * 2, 0.025, 0.02), x, y, wz, 0, 0, (i * PI) / 3), 1);
}

/**
 * Wall-mounted industrial pipe run: a stack of colour-coded pipes (insulated steam main with
 * cladding bands, water, gas, oxygen...) on strut stanchions with cantilever arms and U-bolts,
 * flanges with bolt rings, hand-wheel valves, ID band labels with flow arrows, an elbow dropping
 * to the floor at the left end and one rising out of frame at the right end.
 * Lowest pipe centre at `y`; stanchions at z = -0.75.
 * @param {{length?:number,count?:number,y?:number,walkable?:boolean,seed?:number}} opts
 * userData.colliders: ledge along the crown of the top pipe (if walkable). emitters: steam leaks.
 */
export function makePipes({ length = 10, count = 4, y = 2.6, walkable = true, seed = 3 } = {}) {
  const L = length;
  const g = new THREE.Group();
  g.name = 'pipes';
  const b = new Batch();
  const R = TX.rng(seed);
  const iron = mat('ironBlack'), st = mat('steelPainted');
  const specs = [
    { r: 0.16, m: solid('#2f5876', 0.45, 0.5), label: ['WATER', '#2f5876'] },
    { r: 0.21, m: solid('#7d2418', 0.5, 0.45), label: ['FUEL GAS', '#d4a017'] },
    { r: 0.11, m: solid('#2a6a3c', 0.45, 0.5), label: ['OXYGEN', '#2a6a3c'] },
    { r: 0.14, m: mat('rustMetal'), label: ['AIR', '#2f5876'] },
    { r: 0.3, m: mat('rustMetal'), insul: true, label: ['STEAM', '#7d2418'] },
  ];
  const list = Array.from({ length: count }, (_, i) => specs[i % 4]);
  if (count > 1) list[count - 1] = specs[4];
  // vertical stacking
  let yy = y;
  const zb = -0.75;
  const rows = list.map((s, i) => {
    if (i > 0) yy += list[i - 1].r + s.r + (list[i - 1].insul ? 0.07 : 0) + 0.16;
    return { ...s, y: yy, z: zb + 0.3 + s.r + (s.insul ? 0.07 : 0) };
  });
  const top = rows[rows.length - 1];
  const topY = top.y + top.r + (top.insul ? 0.07 : 0);
  const clad = solid('#a7abad', 0.35, 0.8);
  for (const [i, p] of rows.entries()) {
    const rr = p.r + (p.insul ? 0.07 : 0);
    b.add(p.m, cylX(p.r, L, 0, p.y, p.z, 20), 1.5);
    if (p.insul) {
      b.add(clad, cylX(rr, L - 1.2, 0.3, p.y, p.z, 24), 1);
      for (let x = -L / 2 + 1.0; x < L / 2 - 0.2; x += 0.9) b.add(iron, cylX(rr + 0.012, 0.04, x, p.y, p.z, 24), 1);
    }
    // flanges
    for (let x = -L / 2 + 1.6 + i * 0.7; x < L / 2 - 0.5; x += 3.6) if (!p.insul || x < -L / 2 + 1.2) flangeX(b, p.m, iron, x, p.y, p.z, p.r);
    // label band (front sticker)
    const lm = pipeLabelMat(p.label[0], p.label[1]);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.2, rr * 6), Math.min(0.3, rr * 1.5)), lm);
    lab.position.set(-L / 2 + 2.6 + i * 1.3, p.y, p.z + rr + 0.004);
    g.add(lab);
  }
  // valves on two pipes
  valveX(b, iron, solid('#8e1b12', 0.55, 0.3), L * 0.18, rows[0].y, rows[0].z, rows[0].r);
  if (rows.length > 2) valveX(b, iron, solid('#8e1b12', 0.55, 0.3), -L * 0.12, rows[1].y, rows[1].z, rows[1].r);
  // stanchions + arms + U-bolts
  const ns = Math.max(1, Math.round(L / 3));
  for (let k = 0; k <= ns; k++) {
    const x = -L / 2 + 0.5 + ((L - 1) * k) / ns;
    b.add(st, B(0.08, topY + 0.35, 0.08, x, (topY + 0.35) / 2, zb), 1);
    b.add(iron, B(0.25, 0.02, 0.25, x, 0.01, zb), 1);
    for (const p of rows) {
      const rr = p.r + (p.insul ? 0.07 : 0);
      b.add(st, B(0.07, 0.05, p.z - zb + rr, x, p.y - rr - 0.025, (zb + p.z + rr) / 2), 1);
      b.add(iron, place(new THREE.TorusGeometry(rr + 0.012, 0.012, 4, 12, PI), x, p.y, p.z, 0, PI / 2, 0), 1);
    }
  }
  // left end: lowest pipe elbows down to a floor flange; right end: top pipe rises out
  const p0 = rows[0];
  b.add(p0.m, place(new THREE.TorusGeometry(0.35, p0.r, 10, 12, PI / 2), -L / 2, p0.y - 0.35, p0.z, 0, 0, PI / 2), 1);
  b.add(p0.m, cylY(p0.r, p0.y - 0.35, -L / 2 - 0.35, (p0.y - 0.35) / 2, p0.z, 20), 1);
  b.add(iron, cylY(p0.r + 0.1, 0.06, -L / 2 - 0.35, 0.03, p0.z, 20), 1);
  const pt = rows[rows.length - 1];
  b.add(pt.m, place(new THREE.TorusGeometry(0.5, pt.r, 10, 12, PI / 2), L / 2, pt.y + 0.5, pt.z, 0, 0, -PI / 2), 1);
  b.add(pt.m, cylY(pt.r, 3, L / 2 + 0.5, pt.y + 0.5 + 1.5, pt.z, 20), 1);
  b.add(iron, cylY(pt.r + 0.08, 0.06, L / 2 + 0.5, pt.y + 1.3, pt.z, 20), 1);
  b.build(g);
  const emitters = [];
  for (const p of rows) {
    if (R() < 0.6) emitters.push({ type: 'steam', pos: V(-L / 2 + 1.6 + rows.indexOf(p) * 0.7, p.y + p.r, p.z + p.r), rate: 4 });
  }
  g.userData = {
    colliders: walkable ? [{ type: 'ledge', x0: -L / 2, x1: L / 2, y: topY }] : [],
    emitters,
  };
  return g;
}

/**
 * Vertical riveted storage tank (OXYGEN) on a concrete pad: painted label band, domed roof with a
 * grating top platform + railings, caged ladder, manway hatch, outlet piping with valve and gauge.
 * @param {{radius?:number,height?:number}} opts  height = shell height above the 0.3 m pad.
 * userData.colliders: ledge on the top platform (x -radius..radius). ladders: front-right ladder.
 */
export function makeTank({ radius = 1.8, height = 6 } = {}) {
  const r = radius, H = height, pad = 0.3;
  const g = new THREE.Group();
  g.name = 'tank';
  const b = new Batch();
  const steel = mat('rivetSteel'), iron = mat('ironBlack'), yel = mat('safetyYellow');
  b.add(mat('factoryConcrete'), place(new THREE.CylinderGeometry(r + 0.35, r + 0.45, pad, 28), 0, pad / 2, 0), 1.5);
  const shell = place(new THREE.CylinderGeometry(r, r, H, 40, 1, true), 0, pad + H / 2, 0);
  b.add(steel, cylUV(shell, 2, 0, 0, r));
  const dome = new THREE.LatheGeometry([[r, 0], [r * 0.92, 0.25], [r * 0.7, 0.45], [r * 0.35, 0.58], [0.01, 0.62]].map(([a, c]) => new THREE.Vector2(a, c)), 40);
  b.add(steel, cylUV(place(dome, 0, pad + H, 0), 2, 0, 0, r));
  for (const yy of [0.1, H * 0.33, H * 0.66, H - 0.05]) b.add(iron, place(new THREE.TorusGeometry(r + 0.02, 0.045, 6, 40), 0, pad + yy, 0, PI / 2, 0, 0), 1);
  // label band (curved)
  const lm = signMat('oxygen', { weathered: 0.5 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 1.0, 24, 1, true, -0.62, 1.24), lm);
  band.position.y = pad + H * 0.55;
  g.add(band);
  // manway
  b.add(iron, place(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 20), 0, pad + 1.0, r + 0.04, PI / 2), 1);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; bolt(b, iron, Math.cos(a) * 0.34, pad + 1.0 + Math.sin(a) * 0.34, r + 0.11, 'z', 0.025, 0.03); }
  // outlet pipe + valve + gauge (left)
  const oz = 0.6, ox = -Math.sqrt(r * r - oz * oz);
  b.add(mat('rustMetal'), cylX(0.12, 1.4, ox - 0.6, pad + 0.6, oz, 14), 1);
  valveX(b, iron, solid('#8e1b12', 0.55, 0.3), ox - 0.7, pad + 0.6, oz, 0.12);
  b.add(mat('rustMetal'), place(new THREE.TorusGeometry(0.3, 0.12, 8, 10, PI / 2), ox - 1.3, pad + 0.3, oz, 0, 0, PI / 2), 1);
  b.add(mat('rustMetal'), cylY(0.12, pad + 0.3, ox - 1.6, (pad + 0.3) / 2, oz, 14), 1);
  b.add(iron, cylY(0.03, 0.5, ox - 0.3, pad + 0.95, oz, 6), 1);
  gauge(b, g, ox - 0.3, pad + 1.3, oz + 0.04, 0.13);
  // top platform (grating) + railings
  const py = pad + H + 0.66;
  b.add(grating('#3a3d40'), B(2 * r + 0.2, 0.04, 1.4, 0, py - 0.02, 0.2), 0.5);
  b.add(mat('steelPainted'), B(2 * r + 0.2, 0.14, 0.06, 0, py - 0.07, 0.9), 1);
  b.add(mat('steelPainted'), B(2 * r + 0.2, 0.14, 0.06, 0, py - 0.07, -0.5), 1);
  for (const sx of [-1, 1]) b.add(mat('steelPainted'), B(0.1, 0.6, 0.1, sx * (r - 0.15), py - 0.37, 0.2), 1);
  const lx = r * 0.5;
  railing(b, -r - 0.1, lx - 0.38, py, 0.88, { m: yel, spacing: 1.2 });
  railing(b, lx + 0.38, r + 0.1, py, 0.88, { m: yel, spacing: 1.2 });
  railing(b, -r - 0.1, r + 0.1, py, -0.48, { m: yel, spacing: 1.2 });
  // ladder (front right) outside the shell
  const lz = Math.sqrt(r * r - lx * lx) + 0.32;
  b.add(grating('#3a3d40'), B(0.9, 0.04, lz - 0.85, lx, py - 0.02, (0.85 + lz) / 2 - 0.05), 0.5);
  b.add(mat('steelPainted'), B(0.06, 0.14, lz - 0.85, lx - 0.45, py - 0.07, (0.85 + lz) / 2 - 0.05), 1);
  b.add(mat('steelPainted'), B(0.06, 0.14, lz - 0.85, lx + 0.45, py - 0.07, (0.85 + lz) / 2 - 0.05), 1);
  const lad = steelLadder(b, lx, lz, 0, py, { m: yel });
  b.build(g);
  g.userData = {
    colliders: [{ type: 'ledge', x0: -r - 0.1, x1: r + 0.1, y: py }],
    ladders: [lad],
  };
  return g;
}

// Rotating beacon (amber by default). Returns { group, update, light } - light is a userData light.
function beacon(color = '#ffa020', scale = 1) {
  const grp = new THREE.Group();
  const b = new Batch();
  b.add(mat('ironBlack'), place(new THREE.CylinderGeometry(0.13, 0.15, 0.08, 16), 0, 0.04, 0), 1);
  b.add(mat('ironBlack'), place(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 16), 0, 0.09, 0), 1);
  b.build(grp);
  const domeM = once(`beaconDome${color}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.15, depthWrite: false }));
  const dome = new THREE.Mesh(new THREE.LatheGeometry([[0.12, 0], [0.12, 0.13], [0.09, 0.2], [0.01, 0.225]].map(([a, c]) => new THREE.Vector2(a, c)), 16), domeM);
  dome.position.y = 0.1;
  const spin = new THREE.Group();
  spin.position.y = 0.19;
  const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.11, 12, 1, true, 0, PI), mat('chrome'));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glow(color, 2.5));
  const beamM = once(`beaconBeam${color}`, () => {
    // cone UV: v = 1 at the apex (source) -> 0 at the open end; bright near the source
    const tex = TX.painted('fbeamcone', 16, 128, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
    return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  });
  for (const dir of [1, -1]) {
    const cone = new THREE.ConeGeometry(0.28, 1.7, 16, 1, true);
    // apex at the bulb, opening outward along +-x
    const beam = new THREE.Mesh(place(cone, dir * 0.86, 0, 0, 0, 0, dir * PI / 2), beamM);
    spin.add(beam);
  }
  spin.add(refl, bulb);
  grp.add(dome, spin);
  grp.scale.setScalar(scale);
  const light = { pos: V(0, 0.2 * scale, 0), color, intensity: 22, distance: 10 };
  let ang = Math.random() * TAU;
  return {
    group: grp,
    light,
    update(dt) {
      ang += dt * 7;
      spin.rotation.y = ang;
      // brightest when the reflector faces the camera (+z)
      light.intensity = 4 + 18 * Math.max(0, Math.cos(ang - PI / 2));
    },
  };
}

/**
 * Overhead bridge (gantry) crane: yellow box girder with stiffeners, hazard-striped ends and
 * "SWL 60 T" plate spanning between end trucks on I-beam runways (optional columns), an
 * underhung trolley hoist with wire ropes down to a hook block + hook, an operator cab with a lit
 * window, and rotating amber warning beacons. Girder top (walkable) at `y`.
 * @param {{span?:number,y?:number,columns?:boolean,hookY?:number,trolleyX?:number}} opts
 * userData.colliders: ledge along the girder top. lights: beacons (flashing) + cab.
 * Named children: `trolley`, `hook`.
 */
export function makeGantryCrane({ span = 16, y = 9.6, columns = true, hookY = 4.5, trolleyX = 3 } = {}) {
  const S = span, gh = 1.0, gd = 0.7;
  const g = new THREE.Group();
  g.name = 'gantryCrane';
  const b = new Batch();
  const yel = mat('safetyYellow'), iron = mat('ironBlack'), st = mat('steelPainted');
  const gy = y - gh / 2;
  for (const z of [0, -1.8]) {
    b.add(yel, B(S, gh - 0.06, gd - 0.1, 0, gy, z), 2);
    b.add(yel, B(S + 0.1, 0.03, gd, 0, y - 0.015, z), 2);
    b.add(yel, B(S + 0.1, 0.03, gd, 0, y - gh + 0.015, z), 2);
  }
  for (let x = -S / 2 + 0.6; x <= S / 2 - 0.5; x += 1.2) b.add(yel, B(0.03, gh - 0.1, 0.05, x, gy, gd / 2 - 0.02), 1);
  for (let x = -S / 2 + 0.3; x < S / 2; x += 0.4) { bolt(b, iron, x, y - 0.04, gd / 2 + 0.005, 'z', 0.014, 0.012); bolt(b, iron, x, y - gh + 0.04, gd / 2 + 0.005, 'z', 0.014, 0.012); }
  for (const sx of [-1, 1]) b.add(hazard2(), stripeUV(B(1.2, gh - 0.1, 0.01, sx * (S / 2 - 0.6), gy, gd / 2 + 0.012), 0.3));
  const sw = signMat('load', { weathered: 0.35 });
  const swm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6 / sw.userData.aspect), sw);
  swm.position.set(0, gy, gd / 2 + 0.02);
  g.add(swm);
  // end trucks + runway beams (+ columns)
  const ry = y - gh - 0.55; // runway rail top
  for (const sx of [-1, 1]) {
    const x = (sx * S) / 2;
    b.add(yel, B(0.9, 0.6, 3.2, x, y - gh - 0.05 + 0.3 - 0.3, -0.9), 1.5);
    b.add(hazard2(), stripeUV(B(0.92, 0.2, 0.01, x, y - gh - 0.25, 0.71), 0.2));
    for (const z of [0.3, -2.1]) b.add(iron, cylX(0.22, 0.3, x, ry + 0.22, z, 16), 1);
    ibeam(b, st, 'z', 6, x, ry - 0.33, -0.9, 0.6, 0.3, 0.03, 0.018);
    b.add(iron, B(0.1, 0.06, 6, x, ry - 0.0, -0.9), 1);
    if (columns) {
      ibeam(b, st, 'y', ry - 0.63, x, (ry - 0.63) / 2, 0.2, 0.5, 0.4, 0.03, 0.02);
      ibeam(b, st, 'y', ry - 0.63, x, (ry - 0.63) / 2, -2.0, 0.5, 0.4, 0.03, 0.02);
      b.add(hazard2(), stripeUV(B(0.52, 1.5, 0.42, x, 0.75, 0.2), 0.4));
      b.add(iron, B(0.8, 0.05, 0.7, x, 0.025, 0.2), 1);
      b.add(st, cylBetween(V(x, ry - 3.0, 0.2), V(x, ry - 0.7, -0.9), 0.05, 0.05, 6), 1);
    }
  }
  // underhung trolley hoist
  const trolley = new THREE.Group();
  trolley.name = 'trolley';
  trolley.position.x = trolleyX;
  const tb = new Batch();
  tb.add(st, B(1.8, 0.7, 1.2, 0, y - gh - 0.45, 0), 1);
  tb.add(solid('#2f4b5c', 0.45, 0.5), cylX(0.32, 1.4, 0, y - gh - 1.05, 0, 20), 1);
  for (let i = 0; i < 10; i++) tb.add(iron, cylX(0.335, 0.03, -0.6 + i * 0.13, y - gh - 1.05, 0, 20), 1);
  tb.add(yel, B(0.5, 0.5, 0.6, 0.95, y - gh - 1.0, 0), 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tb.add(iron, cylZ(0.12, 0.08, sx * 0.6, y - gh + 0.02, sz * 0.4, 12), 1);
  const hookTop = y - gh - 1.4;
  for (const sx of [-0.18, -0.06, 0.06, 0.18]) tb.add(iron, cylY(0.016, hookTop - hookY - 0.4, sx, (hookTop + hookY + 0.4) / 2, 0, 6), 1);
  tb.add(yel, B(0.75, 0.8, 0.45, 0, hookY + 0.4, 0), 1);
  tb.add(hazard2(), stripeUV(B(0.77, 0.25, 0.47, 0, hookY + 0.12, 0), 0.25));
  for (const sz of [-1, 1]) tb.add(iron, cylZ(0.3, 0.05, 0, hookY + 0.55, sz * 0.25, 18), 1);
  tb.build(trolley);
  const hook = hookAssembly(1.6);
  hook.position.y = hookY;
  trolley.add(hook);
  g.add(trolley);
  // operator cab
  const cx = -S / 2 + 2.2, cyy = y - gh - 1.3;
  b.add(st, B(2.2, 2.0, 1.9, cx, cyy, 0), 1.2);
  b.add(iron, B(2.3, 0.1, 2.0, cx, cyy + 1.03, 0), 1);
  b.add(st, B(0.15, 0.8, 0.15, cx - 0.8, y - gh - 0.2, 0), 1);
  b.add(st, B(0.15, 0.8, 0.15, cx + 0.8, y - gh - 0.2, 0), 1);
  const cabWin = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), cabWindowMat());
  cabWin.position.set(cx, cyy + 0.3, 0.955);
  g.add(cabWin);
  b.add(iron, B(1.9, 0.06, 0.06, cx, cyy + 0.82, 0.96), 1);
  b.add(iron, B(1.9, 0.06, 0.06, cx, cyy - 0.22, 0.96), 1);
  for (const dx of [-0.92, 0, 0.92]) b.add(iron, B(0.06, 1.06, 0.06, cx + dx, cyy + 0.3, 0.96), 1);
  b.build(g);
  // beacons hanging under the girder near both ends + on the trolley
  const beacons = [];
  for (const [bx, par, by] of [[-S / 2 + 4.2, g, y - gh], [S / 2 - 1.6, g, y - gh], [0, trolley, y - gh - 0.8]]) {
    const bc = beacon('#ffa020', 1.3);
    bc.group.rotation.x = PI;
    bc.group.position.set(bx, by, 0.25);
    par.add(bc.group);
    bc.light.pos = V(bx + (par === trolley ? trolleyX : 0), by - 0.3, 0.6);
    beacons.push(bc);
  }
  const lights = beacons.slice(0, 2).map((bc) => bc.light);
  lights.push({ pos: V(cx, cyy + 0.3, 1.6), color: '#ffd8a0', intensity: 10, distance: 6 });
  g.userData = {
    colliders: [{ type: 'ledge', x0: -S / 2 - 0.05, x1: S / 2 + 0.05, y }],
    lights,
    hook,
    update(dt, t) {
      blinkLamps(t);
      for (const bc of beacons) bc.update(dt);
    },
  };
  return g;
}

// Lit cab / booth window: warm interior with silhouettes behind dirty glass (emissive canvas).
function cabWindowMat() {
  return once('cabWin', () => {
    const tex = TX.painted('fcabwin', 256, 128, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffe6b0'); gr.addColorStop(0.6, '#d89a50'); gr.addColorStop(1, '#5a3418');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(20,14,10,0.9)';
      c.fillRect(0, h * 0.72, w, h * 0.28);
      c.beginPath(); c.arc(w * 0.35, h * 0.42, 14, 0, TAU); c.fill();
      c.fillRect(w * 0.35 - 22, h * 0.52, 44, 40);
      c.fillStyle = 'rgba(60,255,120,0.9)'; c.fillRect(w * 0.62, h * 0.45, 40, 26);
      for (let i = 0; i < 10; i++) { c.fillStyle = i % 3 ? '#ff3020' : '#40ff60'; c.fillRect(w * 0.1 + i * 20, h * 0.78, 6, 5); }
      weatherCanvas(c, w, h, 91, 0.6);
    });
    return new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.2 });
  });
}

/**
 * Pouring control booth: steel-clad cabin with a big lit window (interior: fluorescent tube,
 * console with blinking lamps, CRT glow, operator silhouette), "POURING CONTROL" sign, door with
 * wired-glass light, conduit, alarm bell, extinguisher and a flat roof with a hazard-striped lip.
 * @param {{width?:number,height?:number,depth?:number}} opts  roof top = height (default 3.2).
 * userData.colliders: ledge on the roof (x -w/2..w/2). lights: window spill (warm).
 */
export function makeControlBooth({ width = 4.2, height = 3.2, depth = 2.6 } = {}) {
  const W = width, H = height, D = depth;
  const g = new THREE.Group();
  g.name = 'controlBooth';
  const b = new Batch();
  const clad = mat('corrugated'), iron = mat('ironBlack'), st = mat('steelPainted');
  const wy0 = 1.05, wy1 = 2.25, wx0 = -W / 2 + 0.35, wx1 = W / 2 - 1.35;
  // walls: front with window hole + door
  const front = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(W / 2, H - 0.2), new THREE.Vector2(-W / 2, H - 0.2)]);
  front.holes.push(new THREE.Path([new THREE.Vector2(wx0, wy0), new THREE.Vector2(wx0, wy1), new THREE.Vector2(wx1, wy1), new THREE.Vector2(wx1, wy0)]));
  b.add(clad, place(new THREE.ExtrudeGeometry(front, { depth: 0.08, bevelEnabled: false }), 0, 0, D / 2 - 0.08), 1.2);
  b.add(clad, B(0.08, H - 0.2, D, -W / 2 + 0.04, (H - 0.2) / 2, 0), 1.2);
  b.add(clad, B(0.08, H - 0.2, D, W / 2 - 0.04, (H - 0.2) / 2, 0), 1.2);
  b.add(clad, B(W, H - 0.2, 0.08, 0, (H - 0.2) / 2, -D / 2 + 0.04), 1.2);
  // interior (dark) seen through the window
  const inner = solid('#1d1a17', 0.9, 0);
  b.add(inner, B(W - 0.2, 0.05, D - 0.2, 0, 0.03, 0), 1);
  b.add(inner, B(W - 0.2, H - 0.3, 0.02, 0, (H - 0.2) / 2, -D / 2 + 0.1), 1);
  b.add(solid('#3a3f44', 0.6, 0.3), B(wx1 - wx0 - 0.1, 0.9, 0.6, (wx0 + wx1) / 2, 0.45, D / 2 - 0.5), 1);
  const panel = new THREE.Mesh(place(new THREE.PlaneGeometry(wx1 - wx0 - 0.2, 0.42), 0, 0, 0, -0.9, 0, 0), consoleMat());
  panel.position.set((wx0 + wx1) / 2, 0.98, D / 2 - 0.45);
  g.add(panel);
  b.add(inner, B(0.4, 0.55, 0.3, wx0 + 0.6, 1.3, -D / 2 + 0.35), 1);
  const crt = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.24), glow('#3cff8a', 1.4));
  crt.position.set(wx0 + 0.6, 1.33, -D / 2 + 0.51);
  g.add(crt);
  const op = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), solid('#0e0c0b', 0.9, 0));
  op.position.set(wx1 - 0.7, 1.35, -0.2);
  g.add(op);
  const opHead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), solid('#0e0c0b', 0.9, 0));
  opHead.position.set(wx1 - 0.7, 1.9, -0.2);
  g.add(opHead);
  const tube = new THREE.Mesh(cylX(0.03, 1.2, (wx0 + wx1) / 2, H - 0.45, 0), glow('#e8f4ff', 5));
  g.add(tube);
  // window glass + frame
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), boothGlassMat());
  glass.position.set((wx0 + wx1) / 2, (wy0 + wy1) / 2, D / 2 - 0.04);
  g.add(glass);
  for (const yy of [wy0, wy1]) b.add(iron, B(wx1 - wx0 + 0.1, 0.06, 0.1, (wx0 + wx1) / 2, yy, D / 2), 1);
  for (const xx of [wx0, (wx0 + wx1) / 2, wx1]) b.add(iron, B(0.06, wy1 - wy0, 0.1, xx, (wy0 + wy1) / 2, D / 2), 1);
  b.add(iron, B(wx1 - wx0 + 0.25, 0.06, 0.2, (wx0 + wx1) / 2, wy0 - 0.06, D / 2 + 0.05), 1);
  // door
  const dx = W / 2 - 0.75;
  b.add(st, B(0.85, 2.05, 0.06, dx, 1.03, D / 2 + 0.01), 1);
  b.add(iron, B(0.95, 0.06, 0.08, dx, 2.09, D / 2 + 0.01), 1);
  const dwin = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.45), cabWindowMat());
  dwin.position.set(dx, 1.55, D / 2 + 0.045);
  g.add(dwin);
  b.add(mat('chrome'), cylX(0.02, 0.16, dx - 0.27, 1.0, D / 2 + 0.08, 8), 1);
  const hh = signMat('hardhat');
  const hhm = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55 / hh.userData.aspect), hh);
  hhm.position.set(dx, 2.45, D / 2 + 0.005);
  g.add(hhm);
  // sign above window, roof with lip, conduit, bell, extinguisher
  const cs = signMat('control', { weathered: 0.4 });
  const csm = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, (wx1 - wx0) / cs.userData.aspect), cs);
  csm.position.set((wx0 + wx1) / 2, wy1 + 0.38, D / 2 + 0.01);
  g.add(csm);
  b.add(st, B(W + 0.3, 0.2, D + 0.3, 0, H - 0.1, 0), 1.5);
  b.add(hazard2(), stripeUV(B(W + 0.3, 0.2, 0.01, 0, H - 0.1, D / 2 + 0.155), 0.2));
  b.add(iron, cylX(0.03, W, 0, H - 0.35, D / 2 + 0.06, 8), 1);
  b.add(iron, cylY(0.03, H - 0.4, -W / 2 + 0.15, (H - 0.4) / 2, D / 2 + 0.06, 8), 1);
  b.add(iron, B(0.25, 0.3, 0.12, -W / 2 + 0.15, 1.6, D / 2 + 0.08), 1);
  b.add(solid('#a01810', 0.4, 0.4), place(new THREE.SphereGeometry(0.14, 14, 8, 0, TAU, 0, PI / 2), W / 2 - 0.2, 2.6, D / 2 + 0.07, PI / 2, 0, 0), 1);
  b.add(solid('#a01810', 0.4, 0.2), cylY(0.09, 0.55, W / 2 + 0.15, 0.6, D / 2 - 0.3, 14), 1);
  b.add(iron, cylY(0.04, 0.1, W / 2 + 0.15, 0.93, D / 2 - 0.3, 8), 1);
  b.build(g);
  g.userData = {
    colliders: [{ type: 'ledge', x0: -W / 2 - 0.15, x1: W / 2 + 0.15, y: H }],
    lights: [{ pos: V((wx0 + wx1) / 2, 1.7, D / 2 + 1.2), color: '#ffdca8', intensity: 14, distance: 7 }],
    update(dt, t) { blinkLamps(t); },
  };
  return g;
}

function boothGlassMat() {
  return once('boothGlass', () => new THREE.MeshStandardMaterial({
    color: '#2a363e', transparent: true, opacity: 0.3, roughness: 0.12, metalness: 0.6, depthWrite: false,
  }));
}
function consoleMat() {
  return once('console', () => {
    const draw = (lit) => (c, w, h) => {
      c.fillStyle = lit ? '#000' : '#4a5258'; c.fillRect(0, 0, w, h);
      const R = TX.rng(5);
      for (let i = 0; i < 18; i++) {
        const x = 12 + (i % 9) * 27, y = 14 + Math.floor(i / 9) * 30;
        const col = ['#ff3020', '#40ff60', '#ffb020'][Math.floor(R() * 3)];
        c.fillStyle = lit ? (R() < 0.7 ? col : '#000') : col;
        c.beginPath(); c.arc(x, y, 6, 0, TAU); c.fill();
      }
      if (!lit) { c.fillStyle = '#ddd'; c.fillRect(150, 60, 70, 34); c.fillStyle = '#222'; c.fillRect(156, 66, 58, 22); }
    };
    const map = TX.painted('fconsole', 256, 100, draw(false));
    const em = TX.painted('fconsoleE', 256, 100, draw(true));
    return new THREE.MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: em, emissiveIntensity: 2.5, roughness: 0.5 });
  });
}

/**
 * Riveted steel H-column: flanges with rivet rows, stiffener plates, base plate with anchor
 * bolts on a grout pad, hazard-painted base, stencilled "C-12", and a haunch bracket at the top
 * carrying a short runway-beam stub. Web faces the camera.
 * @param {{height?:number}} opts  (no colliders)
 */
export function makeSteelColumn({ height = 10 } = {}) {
  const H = height, w = 0.5, d = 0.42;
  const g = new THREE.Group();
  g.name = 'steelColumn';
  const b = new Batch();
  const st = mat('rivetSteel'), iron = mat('ironBlack');
  ibeam(b, st, 'y', H - 0.15, 0, 0.15 + (H - 0.15) / 2, 0, w, d, 0.035, 0.022, 1.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) rivetLine(b, iron, V(sx * (w / 2 + 0.004), 1.6, sz * 0.13), V(sx * (w / 2 + 0.004), H - 0.4, sz * 0.13), Math.round(H * 3.3), sx > 0 ? 'x' : '-x', 0.022);
    rivetLine(b, iron, V(sx * (w / 2 - 0.09), 1.6, 0.014), V(sx * (w / 2 - 0.09), H - 0.4, 0.014), Math.round(H * 3.3), 'z', 0.02);
  }
  for (const yy of [H * 0.35, H * 0.7]) b.add(st, B(w - 0.06, 0.03, d - 0.02, 0, yy, 0), 1);
  b.add(mat('factoryConcrete'), B(0.9, 0.12, 0.8, 0, 0.06, 0), 1);
  b.add(iron, B(0.7, 0.04, 0.6, 0, 0.14, 0), 1);
  for (const [bx, bz] of [[-0.27, -0.22], [0.27, -0.22], [-0.27, 0.22], [0.27, 0.22]]) {
    bolt(b, iron, bx, 0.18, bz, 'y', 0.035, 0.05);
    b.add(iron, cylY(0.015, 0.09, bx, 0.22, bz, 6), 1);
  }
  b.add(hazard2(), stripeUV(B(w + 0.012, 1.4, d + 0.012, 0, 0.86, 0), 0.4));
  const cm = signMat('column', { weathered: 0.3, transparent: true });
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), cm);
  lab.position.set(0, 2.2, 0.012);
  g.add(lab);
  // haunch + beam stub along z at the top
  b.add(st, place(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.6, 0), new THREE.Vector2(0, -0.7)]), { depth: 0.03, bevelEnabled: false }), w / 2, H - 0.6, -0.015), 1);
  b.add(st, place(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.6, 0), new THREE.Vector2(0, -0.7)]), { depth: 0.03, bevelEnabled: false }), -w / 2, H - 0.6, -0.015), 1);
  b.add(st, B(w + 1.3, 0.04, d, 0, H - 0.58, 0), 1);
  ibeam(b, st, 'z', 1.6, 0, H - 0.3, -0.4, 0.5, 0.25, 0.03, 0.018);
  b.build(g);
  g.userData = {};
  return g;
}

/**
 * Stepped stack of wooden shipping crates (frames, diagonal braces, stencils, corner brackets)
 * with oil drums beside it - a platforming staircase. Deterministic per seed.
 * @param {{cols?:number,seed?:number,drums?:boolean}} opts
 * userData.colliders: one solid AABB per crate (tops are walkable).
 */
export function makeCrateStack({ cols = 3, seed = 1, drums = true } = {}) {
  const g = new THREE.Group();
  g.name = 'crateStack';
  const b = new Batch();
  const R = TX.rng(seed);
  const woodM = mat('woodWeathered'), frameM = mat('woodDark'), iron = mat('ironBlack');
  const stencil = signMat('crate', { weathered: 0.2, transparent: true });
  const colliders = [];
  const crate = (cx, y0, s, rot) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const add = (m, geo, mpt) => b.add(m, place(geo, 0, 0, 0, 0, rot, 0).translate(cx, y0, 0), mpt);
    add(woodM, B(s - 0.02, s - 0.02, s - 0.02, 0, s / 2, 0), 1.2);
    const fw = 0.1, ft = 0.035;
    for (const sy of [fw / 2, s - fw / 2]) {
      add(frameM, B(s, fw, ft, 0, sy, s / 2 - 0.005), 1);
      add(frameM, B(ft, fw, s, s / 2 - 0.005, sy, 0), 1);
      add(frameM, B(ft, fw, s, -s / 2 + 0.005, sy, 0), 1);
    }
    for (const sx of [-1, 1]) {
      add(frameM, B(fw, s, ft, sx * (s / 2 - fw / 2), s / 2, s / 2 - 0.005), 1);
      add(frameM, B(ft, s, fw, sx * (s / 2 - 0.005), s / 2, s / 2 - fw / 2), 1);
    }
    const dl = Math.hypot(s - 2 * fw, s - 2 * fw) - 0.02;
    add(frameM, place(B(dl, fw * 0.9, ft, 0, 0, 0), 0, s / 2, s / 2 - 0.01, 0, 0, (R() < 0.5 ? 1 : -1) * PI / 4), 1);
    for (const sx of [-1, 1]) for (const sy of [0.06, s - 0.06]) add(iron, B(0.09, 0.09, 0.02, sx * (s / 2 - 0.04), sy, s / 2 + 0.012), 1);
    if (R() < 0.75) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.62, s * 0.62), stencil);
      st.position.set(cx + (s / 2 + 0.02) * sn, y0 + s / 2, (s / 2 + 0.02) * c);
      st.rotation.y = rot;
      g.add(st);
    }
    colliders.push({ type: 'solid', x0: cx - s / 2, x1: cx + s / 2, y0, y1: y0 + s });
  };
  const s0 = 1.2, gap = 0.06;
  const w0 = cols * s0 + (cols - 1) * gap;
  for (let row = 0; row < cols; row++) {
    const n = cols - row;
    for (let i = 0; i < n; i++) {
      const s = row === cols - 1 && R() < 0.5 ? 0.9 : s0;
      const cx = -w0 / 2 + (row * (s0 + gap)) / 2 + i * (s0 + gap) + s0 / 2 + (R() - 0.5) * 0.06;
      crate(cx, row * s0, s, (R() - 0.5) * 0.08);
    }
  }
  if (drums) {
    const dm = [solid('#2a4f78', 0.55, 0.4), solid('#8e2a1a', 0.55, 0.4), mat('rustMetal')];
    for (let i = 0; i < 2; i++) {
      const x = w0 / 2 + 0.5 + i * 0.66, m = dm[Math.floor(R() * 3)];
      b.add(m, place(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 20), x, 0.44, 0.1 * i), 1);
      for (const yy of [0.02, 0.3, 0.58, 0.86]) b.add(iron, place(new THREE.TorusGeometry(0.302, 0.012, 4, 20), x, yy, 0.1 * i, PI / 2, 0, 0), 1);
      b.add(iron, cylY(0.04, 0.02, x + 0.15, 0.89, 0.1 * i, 8), 1);
      colliders.push({ type: 'solid', x0: x - 0.3, x1: x + 0.3, y0: 0, y1: 0.88 });
    }
  }
  b.build(g);
  g.userData = { colliders };
  return g;
}

// Tapered ingot (along x) with chamfered top: length l, base width w, height h.
function ingotGeo(l, w, h) {
  return once(`ingot${l}${w}${h}`, () => {
    const geo = new THREE.BoxGeometry(l, h, w, 1, 1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) { p.setZ(i, p.getZ(i) * 0.8); p.setX(i, p.getX(i) * 0.97); }
    }
    geo.computeVertexNormals();
    return geo;
  });
}

/**
 * Cross-stacked steel ingots: a cooled pile (dark mill scale / rust) and, if `hot`, a red-to-
 * yellow-hot pile with heat glow, light and shimmer. Layers alternate along x and z.
 * @param {{hot?:boolean,layers?:number,seed?:number}} opts
 * userData.colliders: solid per pile (hot pile flagged `hot: true`). lights/emitters for hot pile.
 */
export function makeIngots({ hot = true, layers = 4, seed = 2 } = {}) {
  const g = new THREE.Group();
  g.name = 'ingots';
  const b = new Batch();
  const R = TX.rng(seed);
  const il = 1.5, iw = 0.34, ih = 0.3;
  const colliders = [];
  const pile = (x0, mats, flag) => {
    for (let k = 0; k < layers; k++) {
      const alongX = k % 2 === 0;
      const y = ih / 2 + k * ih;
      for (let i = 0; i < 4; i++) {
        const off = -0.6 + i * 0.4 + (R() - 0.5) * 0.04;
        const m = mats[Math.min(mats.length - 1, Math.floor(R() * mats.length))];
        const geo = ingotGeo(il, iw, ih).clone();
        if (alongX) place(geo, x0 + (R() - 0.5) * 0.06, y, off);
        else place(geo, x0 + off, y, (R() - 0.5) * 0.06, 0, PI / 2, 0);
        b.add(m, geo, 0.8);
      }
    }
    colliders.push({ type: 'solid', x0: x0 - il / 2, x1: x0 + il / 2, y0: 0, y1: layers * ih, ...(flag ? { hot: true } : {}) });
  };
  pile(-1.0, [solid('#57524d', 0.7, 0.45), mat('rustMetal'), solid('#3f3d3b', 0.6, 0.55)], false);
  const lights = [], emitters = [];
  let card = null;
  if (hot) {
    pile(1.0, [hotSteelMat(0), hotSteelMat(1), hotSteelMat(1), hotSteelMat(2)], true);
    card = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), glowCard('#ff5a14', 0.28));
    card.position.set(1.0, layers * ih * 0.6, 0.9);
    g.add(card);
    lights.push({ pos: V(1.0, layers * ih + 0.6, 1.0), color: '#ff6a1c', intensity: 35, distance: 9 });
    emitters.push({ type: 'smoke', pos: V(1.0, layers * ih + 0.1, 0), rate: 2 });
  }
  b.build(g);
  const base = lights.map((l) => l.intensity);
  g.userData = {
    colliders, lights, emitters,
    update(dt, t) {
      if (!card) return;
      card.material.opacity = 0.85 + 0.15 * Math.sin(t * 1.3);
      lights[0].intensity = base[0] * (0.9 + 0.1 * Math.sin(t * 2.1));
    },
  };
  return g;
}

// Dirty industrial window pane grid (emissive = cold daylight behind; some panes broken/boarded).
function factoryWindowMat(seed = 1) {
  return once(`fwin${seed}`, () => {
    const W = 256, H = 320;
    const R = TX.rng(seed);
    const cols = 7, rows = 10;
    const state = Array.from({ length: cols * rows }, () => (R() < 0.08 ? 2 : R() < 0.08 ? 0 : 1)); // 0 boarded, 1 dirty glass, 2 broken
    const draw = (emis) => (c, w, h) => {
      c.fillStyle = emis ? '#000' : '#1b1d1f'; c.fillRect(0, 0, w, h);
      const pw = w / cols, ph = h / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const s = state[j * cols + i];
        const x = i * pw + 3, y = j * ph + 3;
        if (s === 0) { c.fillStyle = emis ? '#000' : '#4a3a2a'; c.fillRect(x, y, pw - 6, ph - 6); continue; }
        const v = 1 - j / rows * 0.35;
        if (emis) {
          const k = s === 2 ? 1 : 0.42 + R() * 0.2;
          c.fillStyle = `rgba(${Math.round(170 * k * v)},${Math.round(200 * k * v)},${Math.round(255 * k)},1)`;
        } else c.fillStyle = s === 2 ? '#0a0a0a' : '#3b4650';
        c.fillRect(x, y, pw - 6, ph - 6);
      }
      if (emis) {
        // grime: darken with noise, heavier toward the bottom
        const img = c.getImageData(0, 0, w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = TX.fbm((x / w) * 5, (y / h) * 6, 64, 4, seed * 7);
          const k = Math.max(0.15, 1 - n * 0.9 - (y / h) * 0.3);
          const j2 = (y * w + x) * 4;
          img.data[j2] *= k; img.data[j2 + 1] *= k; img.data[j2 + 2] *= k;
        }
        c.putImageData(img, 0, 0);
      }
    };
    const map = TX.painted(`fwinA${seed}`, W, H, draw(false));
    const em = TX.painted(`fwinE${seed}`, W, H, draw(true));
    return new THREE.MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: em, emissiveIntensity: 1.6, roughness: 0.35, metalness: 0.3 });
  });
}

// Additive light shaft quad from a window edge sloping down/forward to the floor.
function shaftMat() {
  return once('shaft', () => {
    const tex = TX.painted('fshaft', 128, 256, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h; // v = 0 at the window
        const edge = Math.sin(u * PI) ** 1.5;
        const fall = (1 - v) ** 1.6;
        const dust = 0.65 + 0.35 * TX.fbm(u * 6, v * 3, 6, 4, 55);
        const streak = 0.75 + 0.25 * Math.sin(u * 40 + TX.fbm(u * 4, v * 2, 4, 2, 57) * 6);
        const a = edge * fall * dust * streak;
        const j = (y * w + x) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
        img.data[j + 3] = Math.min(255, a * 255);
      }
      c.putImageData(img, 0, 0);
    });
    return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#9cc0ff').multiplyScalar(0.32), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  });
}
function shaftGeo(x0, x1, yTop, yBot, zTop, run, slant) {
  // quad: top edge (x0..x1 at yTop, zTop) -> bottom edge shifted by slant in x and run in z
  const geo = new THREE.BufferGeometry();
  const p = [x0, yTop, zTop, x1, yTop, zTop, x1 + slant, yBot, zTop + run, x0 + slant, yBot, zTop + run];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Foundry back wall: brick base with concrete plinth, corrugated steel cladding above, I-beam
 * columns per 6 m bay, girts, big dirty multi-pane steel windows (some broken/boarded) glowing
 * with cold daylight and casting additive blue light shafts down toward the floor, a roller
 * shutter door, conduit/pipes, sodium wall lamps, signage ("DANGER MOLTEN METAL", "HARD HATS
 * REQUIRED", safety days board, "MILL No. 4" stencil). Front face at z=0 (depth 0.45 behind).
 * @param {{width?:number,height?:number,seed?:number,shafts?:boolean}} opts  (no colliders)
 * userData.lights: cold window lights + sodium lamps.
 */
export function makeFactoryWall({ width = 24, height = 14, seed = 4, shafts = true } = {}) {
  const W = width, H = height;
  const g = new THREE.Group();
  g.name = 'factoryWall';
  const b = new Batch();
  const iron = mat('ironBlack'), st = mat('steelPainted');
  const R = TX.rng(seed);
  const by = Math.min(3.6, H * 0.3); // brick height
  b.add(mat('factoryConcrete'), B(W, 0.5, 0.5, 0, 0.25, -0.2), 1.5);
  b.add(mat('brickDark'), B(W, by - 0.5, 0.4, 0, 0.5 + (by - 0.5) / 2, -0.2), 2);
  b.add(mat('factoryConcrete'), B(W, 0.12, 0.48, 0, by, -0.18), 1.5);
  // corrugated cladding with window holes per bay
  const bays = Math.max(1, Math.round(W / 6)), bw = W / bays;
  const wy0 = by + 1.6, wy1 = Math.min(H - 1.8, wy0 + 5.4), ww = Math.min(4.4, bw - 1.4);
  const clad = new THREE.Shape([new THREE.Vector2(-W / 2, by), new THREE.Vector2(W / 2, by), new THREE.Vector2(W / 2, H), new THREE.Vector2(-W / 2, H)]);
  const winX = [];
  for (let i = 0; i < bays; i++) {
    const cx = -W / 2 + bw * (i + 0.5);
    winX.push(cx);
    clad.holes.push(new THREE.Path([new THREE.Vector2(cx - ww / 2, wy0), new THREE.Vector2(cx - ww / 2, wy1), new THREE.Vector2(cx + ww / 2, wy1), new THREE.Vector2(cx + ww / 2, wy0)]));
  }
  b.add(mat('corrugated'), place(new THREE.ExtrudeGeometry(clad, { depth: 0.06, bevelEnabled: false }), 0, 0, -0.16), 1.6);
  b.add(solid('#14110f', 0.95, 0), B(W, H - by, 0.02, 0, (H + by) / 2, -0.42), 1);
  // windows (pane plane + steel sash grid + sill)
  for (let i = 0; i < bays; i++) {
    const cx = winX[i];
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wy1 - wy0), factoryWindowMat(seed + i));
    pane.position.set(cx, (wy0 + wy1) / 2, -0.14);
    g.add(pane);
    for (let k = 0; k <= 7; k++) b.add(iron, B(0.05, wy1 - wy0, 0.06, cx - ww / 2 + (ww * k) / 7, (wy0 + wy1) / 2, -0.12), 1);
    for (let k = 0; k <= 10; k++) b.add(iron, B(ww, 0.04, 0.05, cx, wy0 + ((wy1 - wy0) * k) / 10, -0.12), 1);
    b.add(mat('factoryConcrete'), B(ww + 0.3, 0.1, 0.3, cx, wy0 - 0.05, -0.05), 1);
    b.add(st, B(ww + 0.2, 0.12, 0.12, cx, wy1 + 0.06, -0.08), 1);
    const sootW = new THREE.Mesh(new THREE.PlaneGeometry(ww + 1.2, 1.6), sootMat(0.5));
    sootW.position.set(cx, wy1 + 0.7, -0.095);
    g.add(sootW);
  }
  // columns + girts
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + bw * i;
    ibeam(b, mat('rivetSteelDark'), 'y', H, x, H / 2, 0.05, 0.45, 0.4, 0.03, 0.02, 1.5);
    b.add(hazard2(), stripeUV(B(0.47, 1.2, 0.42, x, 0.6, 0.05), 0.4));
  }
  for (const yy of [by + 0.1, wy0 - 0.25, wy1 + 0.3, H - 0.3]) b.add(iron, B(W, 0.2, 0.08, 0, yy, -0.07), 1);
  // roller shutter door in the second bay (or first)
  const dbay = bays > 1 ? 1 : 0, dcx = -W / 2 + bw * (dbay + 0.5), dw = Math.min(4, bw - 1.2), dh = by - 0.2;
  const shutter = B(dw, dh, 0.05, dcx, dh / 2, 0.02);
  b.add(mat('corrugated'), worldUV(shutter, 1.2, null, true));
  b.add(st, B(dw + 0.5, 0.5, 0.5, dcx, dh + 0.2, 0.1), 1);
  for (const sx of [-1, 1]) b.add(hazard2(), stripeUV(B(0.2, dh, 0.2, dcx + sx * (dw / 2 + 0.12), dh / 2, 0.06), 0.4));
  b.add(iron, B(dw, 0.12, 0.08, dcx, 0.06, 0.06), 1);
  // pipes along the wall + downpipes
  b.add(mat('rustMetal'), cylX(0.14, W, 0, by + 0.65, 0.22, 16), 1.5);
  b.add(solid('#2f5876', 0.45, 0.5), cylX(0.09, W, 0, by + 0.98, 0.2, 12), 1.5);
  for (let x = -W / 2 + 1.5; x < W / 2; x += 3) {
    b.add(iron, B(0.06, 0.5, 0.3, x, by + 0.8, 0.1), 1);
  }
  b.add(mat('rustMetal'), cylY(0.08, H - 0.4, W / 2 - 1.0, (H - 0.4) / 2 + 0.2, 0.18, 10), 1);
  // sodium wall lamps per bay
  const lights = [];
  for (let i = 0; i < bays; i++) {
    const x = winX[i] + (i === dbay ? 0 : bw * 0.3);
    const ly = i === dbay ? by + 0.15 + 0.35 : by - 0.4;
    b.add(iron, B(0.08, 0.08, 0.5, x, ly + 0.2, 0.25), 1);
    b.add(iron, place(new THREE.CylinderGeometry(0.08, 0.32, 0.22, 16, 1, true), x, ly, 0.5), 1);
    const bulb = new THREE.Mesh(place(new THREE.SphereGeometry(0.1, 10, 8), x, ly - 0.05, 0.5), glow('#ffb35c', 6));
    g.add(bulb);
    lights.push({ pos: V(x, ly - 0.3, 0.9), color: '#ffa850', intensity: 22, distance: 10 });
  }
  // signs
  const addSign = (kind, w, x, y, z = 0.02, opt = {}) => {
    const m = signMat(kind, opt);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, w / m.userData.aspect), m);
    s.position.set(x, y, z);
    g.add(s);
    return s;
  };
  const b0 = winX[0];
  addSign('danger', 1.4, b0 - bw * 0.25, 2.3, 0.01);
  addSign('hardhat', 1.2, dcx + dw / 2 + 0.95, 2.2, 0.01);
  if (bays > 2) addSign('board', 2.2, winX[2] - bw * 0.15, 2.0, 0.01);
  const millW = Math.min(9, W * 0.4, (H - wy1 - 0.9) * 4);
  if (millW > 2) addSign('mill', millW, winX[Math.floor(bays / 2)] + (bays % 2 ? 0 : -bw / 2), (wy1 + H) / 2 + 0.05, -0.095, { weathered: 0, transparent: true });
  const fb = new THREE.Mesh(B(0.3, 0.4, 0.12, b0 + bw * 0.35, 1.5, 0.06), solid('#a01810', 0.4, 0.3));
  g.add(fb);
  // grime along the brick base
  const grime = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), sootMat(0.45));
  grime.position.set(0, 0.8, 0.005);
  g.add(grime);
  // light shafts
  if (shafts) {
    for (let i = 0; i < bays; i++) {
      const cx = winX[i];
      for (let k = 0; k < 2; k++) {
        const x0 = cx - ww / 2 + 0.2 + k * ww * 0.45, x1 = x0 + ww * 0.42;
        const sh = new THREE.Mesh(shaftGeo(x0, x1, wy1 - 0.3 - k * 0.6, 0, -0.1, 3.5 + R() * 2.5, 2.2 + R() * 0.8), shaftMat());
        sh.renderOrder = 2;
        g.add(sh);
      }
      lights.push({ pos: V(cx + 2.5, 1.5, 3.5), color: '#8fb4ff', intensity: 14, distance: 12 });
    }
  }
  b.build(g);
  g.userData = { lights };
  return g;
}

/**
 * Rotating amber warning beacon on a wall bracket (optionally atop a pipe stand of height `pole`).
 * Additive beams sweep around; the light pulses as the reflector faces the camera.
 * @param {{pole?:number,color?:string}} opts
 * userData.lights: one beacon light (intensity animated in update). Named child: `beacon`.
 */
export function makeWarningLight({ pole = 0, color = '#ffa020' } = {}) {
  const g = new THREE.Group();
  g.name = 'warningLight';
  const b = new Batch();
  const iron = mat('ironBlack');
  let y = 0;
  if (pole > 0) {
    b.add(mat('steelPainted'), cylY(0.04, pole, 0, pole / 2, 0, 10), 1);
    b.add(iron, B(0.3, 0.03, 0.3, 0, 0.015, 0), 1);
    y = pole;
  } else {
    b.add(iron, B(0.24, 0.3, 0.02, 0, 0.15, -0.2), 1);
    b.add(iron, B(0.06, 0.06, 0.24, 0, 0.27, -0.08), 1);
    b.add(iron, B(0.2, 0.02, 0.2, 0, 0.3, 0), 1);
    y = 0.31;
  }
  b.build(g);
  const bc = beacon(color, 1.4);
  bc.group.position.y = y;
  bc.group.name = 'beacon';
  g.add(bc.group);
  bc.light.pos = V(0, y + 0.25, 0.3);
  g.userData = {
    lights: [bc.light],
    update(dt) { bc.update(dt); },
  };
  return g;
}
