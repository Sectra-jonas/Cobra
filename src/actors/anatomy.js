// Procedural anatomy for the character rig. Bodies are continuous skinned surfaces
// (torso, limbs and neck are analytic lofts with muscle shaping) so shoulders, elbows,
// hips and knees deform without seams. Garments are lofted from the very same surface
// functions with an offset ("inflate") and a looseness that hides muscle definition, so
// cloth and skin always deform identically. Hands and footwear are rigid sub-meshes
// that are merged into the same skinned meshes (100% weighted to one bone).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (d, s) => Math.exp(-(d * d) / (s * s));
// signed angular difference wrapped to [-pi, pi]
export const adiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Fast tileable value noise from a 256x256 lattice table (x, y in lattice cells, wraps at 256).
let NT = null;
export function vn(x, y, off = 0, p = 256) {
  if (!NT) {
    NT = new Float32Array(256 * 256);
    let h = 9137;
    for (let i = 0; i < NT.length; i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) + 3266489917 | 0; NT[i] = ((h >>> 8) & 0xffff) / 65535; }
  }
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const xm = ((xi % p) + p) % p, ym = ((yi % p) + p) % p;
  const x0 = (xm + off) & 255, y0 = (ym + off * 7) & 255, x1 = (((xm + 1) % p) + off) & 255, y1 = ((((ym + 1) % p)) + off * 7) & 255;
  const a = NT[y0 * 256 + x0], b = NT[y0 * 256 + x1], c = NT[y1 * 256 + x0], d = NT[y1 * 256 + x1];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Smooth (Catmull-Rom / Hermite) interpolation through rows [x, v1, v2, ...] with ascending x.
export function curve(rowsIn) {
  const rows = [...rowsIn].sort((a, b) => a[0] - b[0]);
  const n = rows.length, m = rows[0].length - 1;
  const out = new Array(m).fill(0);
  return (x) => {
    if (x <= rows[0][0]) { for (let k = 0; k < m; k++) out[k] = rows[0][k + 1]; return out; }
    if (x >= rows[n - 1][0]) { for (let k = 0; k < m; k++) out[k] = rows[n - 1][k + 1]; return out; }
    let i = 0;
    while (i < n - 2 && x > rows[i + 1][0]) i++;
    const r0 = rows[Math.max(0, i - 1)], r1 = rows[i], r2 = rows[i + 1], r3 = rows[Math.min(n - 1, i + 2)];
    const h = r2[0] - r1[0];
    const t = (x - r1[0]) / h, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    for (let k = 1; k <= m; k++) {
      const m1 = (r2[k] - r0[k]) / ((r2[0] - r0[0]) || 1) * h;
      const m2 = (r3[k] - r1[k]) / ((r3[0] - r1[0]) || 1) * h;
      out[k - 1] = h00 * r1[k] + h10 * m1 + h01 * r2[k] + h11 * m2;
    }
    return out;
  };
}

// ------------------------------------------------------------------ geometry utils

// Normalised weight list from [boneIndex, weight, ...] pairs (top 4 kept).
export function packWeights(pairs, si, sw, k) {
  const list = [];
  for (let i = 0; i < pairs.length; i += 2) {
    if (pairs[i + 1] <= 1e-4) continue;
    const e = list.find((q) => q[0] === pairs[i]);
    if (e) e[1] += pairs[i + 1]; else list.push([pairs[i], pairs[i + 1]]);
  }
  list.sort((a, b) => b[1] - a[1]);
  let tot = 0;
  for (let i = 0; i < Math.min(4, list.length); i++) tot += list[i][1];
  for (let i = 0; i < 4; i++) {
    const e = list[i];
    si[k * 4 + i] = e ? e[0] : 0;
    sw[k * 4 + i] = e ? e[1] / (tot || 1) : 0;
  }
}

// Averages normals of vertices that share a position (wrap seams, poles, mirrored seams).
export function smoothCoincident(geo, eps = 1e-5) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const map = new Map();
  const q = 1 / eps;
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * q)},${Math.round(p.getY(i) * q)},${Math.round(p.getZ(i) * q)}`;
    let l = map.get(key);
    if (!l) map.set(key, (l = []));
    l.push(i);
  }
  const v = new THREE.Vector3();
  for (const l of map.values()) {
    if (l.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of l) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of l) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return geo;
}

/**
 * Builds an indexed (nu+1) x (nv+1) grid. fn(i, j, o) must set o.p = [x,y,z], o.uv = [u,v]
 * and o.w = [bone, weight, ...]. Rows are expected to be rings/strips; winding is chosen so
 * normals point away from each row's centroid (outward) unless opts.inward.
 */
export function gridGeo(nu, nv, fn, opts = {}) {
  const cnt = (nu + 1) * (nv + 1);
  const P = new Float32Array(cnt * 3), UV = new Float32Array(cnt * 2);
  const SI = new Uint16Array(cnt * 4), SW = new Float32Array(cnt * 4);
  const o = { p: [0, 0, 0], uv: [0, 0], w: [0, 1] };
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      fn(i, j, o);
      P[k * 3] = o.p[0]; P[k * 3 + 1] = o.p[1]; P[k * 3 + 2] = o.p[2];
      UV[k * 2] = o.uv[0]; UV[k * 2 + 1] = o.uv[1];
      packWeights(o.w, SI, SW, k);
    }
  }
  // orientation: outward from each row's centroid (rings), or along opts.outDir (flat pieces)
  const cx = new Float32Array(nv + 1), cy = new Float32Array(nv + 1), cz = new Float32Array(nv + 1);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) { const k = (j * (nu + 1) + i) * 3; cx[j] += P[k]; cy[j] += P[k + 1]; cz[j] += P[k + 2]; }
    cx[j] /= nu + 1; cy[j] /= nu + 1; cz[j] /= nu + 1;
  }
  const od = opts.outDir;
  let score = 0;
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[d * 3] - ax, uy = P[d * 3 + 1] - ay, uz = P[d * 3 + 2] - az;
      const vx = P[c * 3] - P[b * 3], vy = P[c * 3 + 1] - P[b * 3 + 1], vz = P[c * 3 + 2] - P[b * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (od) score += nx * od[0] + ny * od[1] + nz * od[2];
      else score += nx * (ax - (cx[j] + cx[j + 1]) / 2) + ny * (ay - (cy[j] + cy[j + 1]) / 2) + nz * (az - (cz[j] + cz[j + 1]) / 2);
    }
  }
  let flip = score < 0;
  if (opts.flip) flip = !flip;
  if (flip) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothCoincident(g);
  return g;
}

// Adds rigid skin attributes (single bone) to a geometry, indexing it if needed.
export function rigidSkin(geo, bone) {
  let g = geo;
  if (!g.index) {
    const n = g.attributes.position.count;
    const ix = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) ix[i] = i;
    g.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

// Normalises a geometry to position/normal/uv (+ index) so it can be merged.
export function plain(geo) {
  const g = geo.index ? geo : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function mergeAll(list) {
  const fixed = list.map((g) => {
    if (!g.index) {
      const n = g.attributes.position.count;
      const ix = new Uint32Array(n);
      for (let i = 0; i < n; i++) ix[i] = i;
      g.setIndex(new THREE.BufferAttribute(ix, 1));
    }
    return g;
  });
  return mergeGeometries(fixed, false);
}

/** Collects skinned parts per material key and emits one SkinnedMesh per material. */
export class SkinBuilder {
  constructor(boneNames) {
    this.names = boneNames;
    this.index = new Map(boneNames.map((n, i) => [n, i]));
    this.parts = new Map();
  }
  bi(name) { return this.index.get(name); }
  add(key, geo) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return geo;
  }
  // geo given in the bone's local space; matrix = bone rest matrix (root space)
  rigid(key, geo, bone, matrix) {
    const g = plain(geo);
    if (matrix) g.applyMatrix4(matrix);
    return this.add(key, rigidSkin(g, this.bi(bone)));
  }
  tris() {
    let t = 0;
    for (const l of this.parts.values()) for (const g of l) t += (g.index ? g.index.count : g.attributes.position.count) / 3;
    return t;
  }
  build(mats, skeleton, parent) {
    const out = {};
    for (const [key, list] of this.parts) {
      if (!mats[key]) continue;
      const geo = mergeAll(list);
      const mesh = new THREE.SkinnedMesh(geo, mats[key]);
      mesh.name = key;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      out[key] = mesh;
    }
    return out;
  }
}

// ------------------------------------------------------------------- body surfaces

// Torso cross-section profiles (metres at 1.85 m height), rows: yr (above hip joint), halfWidth, front, back, exponent.
const TORSO_M = [
  [-0.118, 0.076, 0.042, 0.050, 2.0],
  [-0.100, 0.122, 0.066, 0.080, 2.1],
  [-0.060, 0.158, 0.084, 0.100, 2.35],
  [-0.010, 0.166, 0.089, 0.100, 2.45],
  [0.040, 0.161, 0.093, 0.090, 2.5],
  [0.095, 0.150, 0.097, 0.082, 2.45],
  [0.160, 0.149, 0.099, 0.081, 2.45],
  [0.225, 0.154, 0.103, 0.085, 2.55],
  [0.290, 0.160, 0.108, 0.090, 2.65],
  [0.355, 0.164, 0.113, 0.095, 2.75],
  [0.415, 0.166, 0.112, 0.097, 2.75],
  [0.465, 0.169, 0.106, 0.097, 2.65],
  [0.505, 0.168, 0.094, 0.093, 2.5],
  [0.540, 0.150, 0.078, 0.084, 2.3],
  [0.565, 0.116, 0.066, 0.072, 2.15],
  [0.585, 0.086, 0.060, 0.063, 2.05],
  [0.605, 0.068, 0.056, 0.058, 2.0],
  [0.620, 0.062, 0.054, 0.055, 2.0],
];
const TORSO_F = [
  [-0.118, 0.080, 0.042, 0.054, 2.0],
  [-0.095, 0.134, 0.068, 0.090, 2.15],
  [-0.045, 0.170, 0.083, 0.110, 2.35],
  [0.010, 0.166, 0.085, 0.098, 2.4],
  [0.060, 0.146, 0.086, 0.083, 2.3],
  [0.120, 0.122, 0.082, 0.073, 2.2],
  [0.180, 0.126, 0.084, 0.075, 2.2],
  [0.240, 0.136, 0.088, 0.079, 2.3],
  [0.300, 0.142, 0.090, 0.083, 2.4],
  [0.360, 0.145, 0.091, 0.085, 2.4],
  [0.420, 0.147, 0.090, 0.086, 2.4],
  [0.462, 0.149, 0.085, 0.085, 2.35],
  [0.495, 0.146, 0.077, 0.081, 2.25],
  [0.525, 0.127, 0.065, 0.071, 2.15],
  [0.548, 0.095, 0.055, 0.060, 2.05],
  [0.567, 0.064, 0.049, 0.052, 2.0],
  [0.585, 0.054, 0.046, 0.048, 2.0],
];
const ARM_UP = [[0.0, 0.050, 0.052], [0.15, 0.050, 0.050], [0.35, 0.046, 0.047], [0.55, 0.043, 0.046], [0.8, 0.039, 0.040], [1.0, 0.036, 0.036]];
const ARM_LO = [[0.0, 0.036, 0.036], [0.15, 0.040, 0.040], [0.35, 0.037, 0.037], [0.65, 0.031, 0.031], [0.92, 0.0235, 0.029], [1.0, 0.023, 0.028], [1.12, 0.022, 0.027]];
const LEG_UP = [[0.0, 0.086, 0.088], [0.12, 0.083, 0.086], [0.35, 0.074, 0.077], [0.65, 0.062, 0.064], [0.88, 0.053, 0.055], [1.0, 0.050, 0.052]];
const LEG_LO = [[0.0, 0.050, 0.052], [0.1, 0.049, 0.050], [0.28, 0.050, 0.055], [0.5, 0.042, 0.045], [0.75, 0.034, 0.036], [0.95, 0.031, 0.034], [1.1, 0.031, 0.036]];
const NECK = [[0.0, 0.07, 0.066], [0.03, 0.062, 0.058], [0.07, 0.058, 0.056], [0.12, 0.057, 0.058], [0.17, 0.055, 0.056]];

function smoothedTable(rows, win) {
  const f = curve(rows);
  const y0 = rows[0][0], y1 = rows[rows.length - 1][0];
  const N = 48, out = [];
  for (let i = 0; i <= N; i++) {
    const y = y0 + (y1 - y0) * i / N;
    const acc = new Array(rows[0].length - 1).fill(0);
    let c = 0;
    for (let k = -4; k <= 4; k++) {
      const yy = clamp(y + win * k / 4, y0, y1);
      const v = f(yy);
      for (let q = 0; q < acc.length; q++) acc[q] += v[q];
      c++;
    }
    out.push([y, ...acc.map((v) => v / c)]);
  }
  return curve(out);
}

/**
 * Analytic body surfaces in root (rest pose) space. dims comes from the Rig.
 * Angles: th = 0 front (+z), positive towards the character's left (+x) for the torso,
 * towards the lateral side for limbs (mirrored per side).
 */
export class Body {
  constructor(d) {
    this.d = d;
    const b = d.build;
    this.f = d.female;
    const T = d.female ? TORSO_F : TORSO_M;
    this.tp = curve(T);
    this.tps = smoothedTable(T, 0.09);
    this.armUp = curve(ARM_UP); this.armLo = curve(ARM_LO);
    this.legUp = curve(LEG_UP); this.legLo = curve(LEG_LO);
    this.neckP = curve(NECK);
    this.mus = d.muscle ?? (d.female ? 0.4 : 1);
    this.b = b;
  }

  // per-height build scaling of the torso table
  _torsoScale(yr) {
    const b = this.b;
    const up = sstep(0.18, 0.4, yr), sh = sstep(0.4, 0.53, yr), low = 1 - sstep(-0.02, 0.14, yr);
    const W = lerp(1, b.chest, up) * lerp(1, b.shoulders, sh * 0.6) * lerp(1, b.hips, low);
    const F = lerp(1, b.chest, up) * (1 + (b.belly - 1) * 0.6 * gauss(yr - 0.13, 0.12));
    const B = lerp(1, b.chest, up * 0.8) * lerp(1, b.hips, low * 0.6);
    return [W * (1 + (b.belly - 1) * 0.35 * gauss(yr - 0.1, 0.12)), F, B];
  }

  torsoBumps(x, yr, z, ang) {
    const ax = Math.abs(x);
    const front = sstep(0.0, 0.05, z), back = sstep(0.0, -0.045, z);
    const m = this.mus, b = this.b;
    let d = 0;
    if (!this.f) {
      const py = yr - 0.372;
      d += 0.021 * m * b.chest * front * gauss(ax - 0.066, 0.05) * gauss(py, py < 0 ? 0.026 : 0.07);
      d -= 0.004 * m * front * gauss(ax, 0.013) * gauss(yr - 0.39, 0.08);
      d += 0.0025 * m * front * gauss(yr - 0.2, 0.07) * gauss(ax - 0.022, 0.02);
      d += 0.012 * m * gauss(yr - 0.36, 0.08) * gauss(Math.abs(ang) - 1.95, 0.45); // lats
      d += 0.005 * m * front * gauss(ax - 0.07, 0.03) * gauss(yr - 0.505, 0.012); // clavicle
    } else {
      const bust = this.d.bust ?? 1;
      const py = yr - 0.352;
      d += 0.043 * bust * front * gauss(ax - 0.062, 0.046) * gauss(py, py < 0 ? 0.034 : 0.062);
      d -= 0.004 * front * gauss(ax, 0.012) * gauss(yr - 0.35, 0.03);
    }
    // shoulder girdle: acromion / deltoid origin widening the torso at shoulder height
    d += (this.f ? 0.026 : 0.038) * this.b.shoulders * gauss(Math.abs(ang) - Math.PI / 2, 0.6) * gauss(yr - (this.f ? 0.475 : 0.5), yr > (this.f ? 0.475 : 0.5) ? 0.034 : 0.05);
    d += 0.009 * back * gauss(ax - 0.075, 0.035) * gauss(yr - 0.41, 0.06); // scapulae
    d -= 0.006 * back * gauss(ax, 0.014) * sstep(0.0, 0.1, yr) * sstep(0.56, 0.45, yr); // spine groove
    const gy = yr + 0.048;
    d += (this.f ? 0.034 : 0.026) * back * gauss(ax - 0.06, 0.055) * gauss(gy, gy < 0 ? 0.032 : 0.065); // glutes
    d += (b.belly - 1) * 0.12 * front * gauss(yr - 0.12, 0.1) * gauss(ax, 0.11);
    return d;
  }

  /** Torso point. inf = outward offset (m), loose 0..1 hides shaping & fills concavities. */
  torso(th, yr, inf = 0, loose = 0, o = [0, 0, 0]) {
    const r = this.tp(yr), rs = this.tps(yr);
    const sc = this._torsoScale(yr);
    let W = r[0], F = r[1], B = r[2];
    if (loose > 0) { W = Math.max(W, lerp(W, rs[0], loose)); F = Math.max(F, lerp(F, rs[1], loose)); B = Math.max(B, lerp(B, rs[2], loose)); }
    W *= sc[0]; F *= sc[1]; B *= sc[2];
    const n = lerp(r[3], 2.3, loose * 0.5);
    const s = Math.sin(th), c = Math.cos(th);
    const D = c >= 0 ? F : B;
    let x = W * spow(s, 2 / n), z = D * spow(c, 2 / n);
    let nx = Math.sign(x) * Math.pow(Math.abs(x / W), n - 1) / W, nz = Math.sign(z) * Math.pow(Math.abs(z / D), n - 1) / D;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const dd = this.torsoBumps(x, yr, z, th) * (1 - loose) + inf / this.d.S;
    x += nx * dd; z += nz * dd;
    const S = this.d.S;
    o[0] = x * S; o[1] = this.d.hipY + yr * S; o[2] = z * S;
    return o;
  }

  torsoW(yr, x) {
    const d = this.d, ax = Math.abs(x) / d.S;
    const wh = 1 - sstep(0.0, 0.13, yr), wc = sstep(0.17, 0.31, yr);
    const ws = Math.max(0, 1 - wh - wc);
    const wsh = sstep(0.11, 0.17, ax) * sstep(0.41, 0.51, yr) * 0.55;
    const wn = sstep(0.57, 0.625, yr) * 0.55;
    const wt = sstep(0.0, -0.1, yr) * sstep(0.02, 0.09, ax) * 0.5;
    const side = x >= 0 ? 'L' : 'R';
    const I = d.bi;
    return [I.hips, wh * (1 - wt), I['th' + side], wh * wt, I.spine, ws, I.chest, wc * (1 - wsh - wn), I['sh' + side], wc * wsh, I.neck, wc * wn];
  }

  // ---- arms: a = distance below the shoulder joint (S = 1 metres); a < 0 is the deltoid cap
  armRad(a) {
    const d = this.d, L1 = d.upLen0, L2 = d.foreLen0;
    const k = (this.f ? 0.82 : 1) * this.b.arms;
    const ka = a < L1 ? 1 : lerp(1, 0.9 + 0.1 * this.b.arms, 0.6);
    const r = a < L1 ? this.armUp(Math.max(0, a) / L1) : this.armLo((a - L1) / L2);
    return [r[0] * k * ka, r[1] * k * ka];
  }

  armDome() { const r = this.armRad(0); return (r[0] + r[1]) / 2; }
  legDome() { const r = this.legRad(0); return (r[0] + r[1]) / 2; }

  arm(side, th, a, inf = 0, loose = 0, o = [0, 0, 0]) {
    const d = this.d, S = d.S, L1 = d.upLen0, L2 = d.foreLen0;
    let rx, rz, cy = 0, sc = 1, nrx, nrz;
    let al = Math.PI / 2;
    if (a < 0) { // deltoid cap: rows spaced by polar angle, flattened so it sits under the trapezius line
      const [r0x, r0z] = this.armRad(0);
      const R = (r0x + r0z) / 2;
      al = (1 - clamp(-a / R, 0, 1)) * Math.PI / 2;
      sc = Math.sin(al);
      rx = r0x * sc; rz = r0z * sc; cy = R * Math.cos(al) * 0.62;
      nrx = r0x; nrz = r0z;
    } else {
      [rx, rz] = this.armRad(a);
      nrx = rx; nrz = rz;
    }
    const s = Math.sin(th), c = Math.cos(th);
    let lx = rx * s, lz = rz * c;
    let nx = s / nrx, nz = c / nrz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    let ny = 0;
    if (a < 0) { // dome: normal tilts up
      ny = Math.cos(al); const f = Math.sin(al); nx *= f; nz *= f;
    }
    const m = this.mus * this.b.arms * (1 - loose);
    let dd = 0;
    const aa = Math.max(0, a);
    dd += 0.006 * m * gauss(aa - 0.04, 0.05) * gauss(th - 1.2, 1.0);
    dd += 0.009 * m * gauss(a - L1 * 0.56, 0.05) * gauss(th + 0.15, 0.75);
    dd += 0.006 * m * gauss(a - L1 * 0.42, 0.06) * gauss(adiff(th, Math.PI), 0.8);
    dd += 0.006 * m * gauss(a - (L1 + 0.05), 0.05) * gauss(th - 0.9, 0.8);
    dd += 0.004 * gauss(a - L1, 0.015) * gauss(adiff(th, Math.PI), 0.5);
    dd -= 0.003 * gauss(a - L1, 0.02) * gauss(th, 0.6) * (1 - loose);
    dd += inf / S;
    lx += nx * dd; lz += nz * dd; const ly = ny * dd;
    const j = side > 0 ? d.shL : d.shR;
    o[0] = j[0] + side * lx * S;
    o[1] = j[1] + (cy + ly - Math.max(a, 0)) * S;
    o[2] = j[2] + lz * S;
    void L2;
    return o;
  }

  armW(side, a) {
    const d = this.d, I = d.bi, L1 = d.upLen0, L2 = d.foreLen0;
    const sd = side > 0 ? 'L' : 'R';
    const wc = 0.5 * sstep(0.03, -0.05, a);
    const we = sstep(L1 - 0.045, L1 + 0.04, a);
    const wh = sstep(L1 + L2 - 0.035, L1 + L2 + 0.01, a);
    return [I.chest, wc, I['sh' + sd], (1 - we) * (1 - wc), I['el' + sd], we - wh, I['hd' + sd], wh];
  }

  // ---- legs: a = distance below the hip socket; a < 0 is the upper thigh cap (inside pelvis)
  legRad(a) {
    const L = this.d.legLen0;
    const k = (this.f ? 0.93 : 1) * this.b.legs;
    const r = a < L ? this.legUp(Math.max(0, a) / L) : this.legLo((a - L) / L);
    const top = this.f ? 1 + 0.06 * gauss(a - 0.08, 0.12) : 1;
    return [r[0] * k * top, r[1] * k * top];
  }

  leg(side, th, a, inf = 0, loose = 0, o = [0, 0, 0]) {
    const d = this.d, S = d.S, L = d.legLen0;
    let rx, rz, cy = 0, sc = 1;
    if (a < 0) { // upper thigh cap hidden inside the pelvis
      const [r0x, r0z] = this.legRad(0);
      const R = (r0x + r0z) / 2;
      const al = (1 - clamp(-a / R, 0, 1)) * Math.PI / 2;
      sc = Math.sin(al);
      rx = r0x * sc; rz = r0z * sc; cy = R * Math.cos(al) * 0.6;
    } else [rx, rz] = this.legRad(a);
    if (rx < 1e-4) { rx = 1e-4; rz = 1e-4; }
    const s = Math.sin(th), c = Math.cos(th);
    let lx = rx * s, lz = rz * c;
    let nx = s / rx, nz = c / rz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const m = this.mus * this.b.legs * (1 - loose);
    let dd = 0;
    dd += 0.008 * m * gauss(a - L * 0.42, 0.1) * gauss(th - 0.15, 0.8);
    dd += 0.008 * m * gauss(a - L * 0.84, 0.045) * gauss(th + 0.75, 0.5);
    dd += 0.004 * m * gauss(a - L * 0.45, 0.1) * gauss(adiff(th, Math.PI), 0.8);
    dd += 0.006 * gauss(a - L, 0.022) * gauss(th, 0.45) * (1 - loose * 0.6);
    dd += 0.011 * m * gauss(a - (L + 0.11), 0.06) * gauss(adiff(th, Math.PI - 0.55), 0.55);
    dd += 0.013 * m * gauss(a - (L + 0.13), 0.06) * gauss(adiff(th, -(Math.PI - 0.55)), 0.55);
    dd -= 0.003 * gauss(a - (L + 0.25), 0.15) * gauss(th + 0.2, 0.4) * (1 - loose);
    dd += 0.004 * gauss(a - (2 * L - 0.02), 0.014) * (gauss(th - 1.57, 0.4) + gauss(th + 1.57, 0.4)) * (1 - loose);
    dd += inf / S;
    lx += nx * dd; lz += nz * dd;
    // the top of the thigh sits inside the pelvis: pull the section's centre inward and
    // narrow it so its outer contour flows into the hip instead of bulging out of it
    const top = 1 - sstep(-0.02, 0.17, a);
    lx = lx * (1 - 0.1 * top) - 0.026 * top * top;
    lz *= 1 - 0.06 * top;
    const j = side > 0 ? d.thL : d.thR;
    o[0] = j[0] + side * lx * S;
    o[1] = j[1] + (cy - Math.max(a, 0)) * S;
    o[2] = j[2] + lz * S;
    return o;
  }

  legW(side, a) {
    const d = this.d, I = d.bi, L = d.legLen0;
    const sd = side > 0 ? 'L' : 'R';
    const wh = 0.5 * sstep(0.06, -0.06, a);
    const wk = sstep(L - 0.05, L + 0.05, a);
    const wf = sstep(2 * L - 0.045, 2 * L + 0.01, a);
    return [I.hips, wh, I['th' + sd], (1 - wk) * (1 - wh), I['kn' + sd], wk - wf, I['ft' + sd], wf];
  }

  // ---- neck: a = height above the neck base (inside torso top)
  neck(th, a, inf = 0, o = [0, 0, 0]) {
    const d = this.d, S = d.S;
    const k = (this.f ? 0.82 : 1) * (d.neckK || 1);
    const r = this.neckP(a);
    const rx = r[0] * k * (a < 0.05 ? lerp(1.0, 1, 0) : 1), rz = r[1] * k;
    const s = Math.sin(th), c = Math.cos(th);
    let lx = rx * s, lz = rz * c;
    let nx = s / rx, nz = c / rz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    let dd = 0;
    // sternocleidomastoid ridges running from the sternum to behind the ears
    const tA = clamp(a / 0.15, 0, 1);
    const scm = lerp(0.3, 1.75, tA);
    dd += 0.005 * (this.f ? 0.4 : 1) * gauss(Math.abs(th) - scm, 0.32) * sstep(0.0, 0.04, a);
    if (!this.f) dd += 0.006 * gauss(a - 0.075, 0.016) * gauss(th, 0.28);
    dd += inf / S;
    lx += nx * dd; lz += nz * dd;
    const zc = lerp(-0.022, -0.004, tA);
    o[0] = lx * S;
    o[1] = d.neckBase + a * S;
    o[2] = (zc + lz) * S;
    return o;
  }

  neckW(a) {
    const I = this.d.bi;
    const wn = sstep(0.0, 0.06, a), wh = sstep(0.085, 0.15, a);
    return [I.chest, 1 - wn, I.neck, wn - wh, I.head, wh];
  }
}

// ------------------------------------------------------------------- loft pieces

/**
 * Lofts a body part (or a garment over it).
 * part: 'torso' | 'arm' | 'leg' | 'neck'; side for limbs.
 * a0/a1: number or fn(th) giving the range along the part; th0/th1: angular range (open
 * fronts). aSpacing: optional fn(t) -> t' to cluster rows. hem: lip thickness at a1 end
 * (and at a0 with hem0), flare: fn(t) -> extra inflate along the piece.
 */
export function piece(body, cfg) {
  const { part, side = 1, nu = 24, nv = 20, inf = 0, loose = 0 } = cfg;
  const th0 = cfg.th0 ?? -Math.PI, th1 = cfg.th1 ?? Math.PI;
  const A0 = typeof cfg.a0 === 'function' ? cfg.a0 : () => cfg.a0;
  const A1 = typeof cfg.a1 === 'function' ? cfg.a1 : () => cfg.a1;
  const spacing = cfg.spacing || ((t) => t);
  const hem = cfg.hem || 0, hem0 = cfg.hem0 || 0;
  const rows = [];
  // rows: [t (0..1 along), extra inflate, uv v-offset]
  if (hem0) { rows.push([0, -hem0, -0.004], [0, 0, -0.002]); }
  for (let j = 0; j <= nv; j++) rows.push([spacing(j / nv), 0, 0]);
  if (hem) { rows.push([1, -hem, 0.002], [1, -hem, 0.004]); }
  const p = [0, 0, 0];
  const uvS = cfg.uvScale || 1;
  const geo = gridGeo(nu, rows.length - 1, (i, j, o) => {
    const th = lerp(th0, th1, i / nu);
    const [t, dInf, dv] = rows[j];
    const last = j === rows.length - 1 && hem;
    const a0 = A0(th), a1 = A1(th);
    let a = lerp(a0, a1, t);
    if (last) a = a1 - Math.sign(a1 - a0) * Math.min(0.012, hem * 2.5);
    const fl = cfg.flare ? cfg.flare(t, th) : 0;
    const totInf = inf + fl + dInf;
    if (part === 'torso') { body.torso(th, a, totInf, loose, p); o.w = body.torsoW(a, p[0]); }
    else if (part === 'arm') { body.arm(side, th, a, totInf, loose, p); o.w = body.armW(side, a); }
    else if (part === 'leg') { body.leg(side, th, a, totInf, loose, p); o.w = body.legW(side, a); }
    else { body.neck(th, a, totInf, p); o.w = body.neckW(a); }
    if (cfg.weights) o.w = cfg.weights(th, a, p, o.w);
    if (cfg.warp) cfg.warp(p, th, a, t);
    o.p[0] = p[0]; o.p[1] = p[1]; o.p[2] = p[2];
    o.uv[0] = (th + Math.PI) / (Math.PI * 2);
    o.uv[1] = (cfg.vOf ? cfg.vOf(a) : a) / uvS + dv;
  });
  return geo;
}

// Close the end of a lofted tube with a fan (for torso bottoms etc.). pts: ring sampler.
export function capGeo(ringFn, n, centerFn, weights) {
  const P = [], UV = [], SI = [], SW = [], idx = [];
  const c = centerFn();
  const si = new Uint16Array(4), sw = new Float32Array(4);
  const pushV = (p, u, v) => {
    P.push(p[0], p[1], p[2]); UV.push(u, v);
    packWeights(weights(p), si, sw, 0);
    SI.push(...si); SW.push(...sw);
  };
  pushV(c, 0.5, 0.5);
  for (let i = 0; i <= n; i++) pushV(ringFn(i / n), 0.5, 0.5);
  for (let i = 0; i < n; i++) idx.push(0, i + 1, i + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------- tubes & hands

// Tube along a polyline with parallel-transport frames. radii per point, optional end caps.
export function tubeGeo(pts, radii, radial = 6, capStart = false, capEnd = true, uvLen = 1) {
  const n = pts.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const up = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  N.push(new THREE.Vector3().crossVectors(T[0], up).normalize());
  B.push(new THREE.Vector3().crossVectors(T[0], N[0]));
  for (let i = 1; i < n; i++) {
    const nn = N[i - 1].clone().sub(T[i].clone().multiplyScalar(N[i - 1].dot(T[i]))).normalize();
    N.push(nn);
    B.push(new THREE.Vector3().crossVectors(T[i], nn));
  }
  const P = [], UV = [], idx = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i) len += pts[i].distanceTo(pts[i - 1]);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const r = radii[i];
      const v = pts[i].clone().addScaledVector(N[i], Math.cos(a) * r).addScaledVector(B[i], Math.sin(a) * r);
      P.push(v.x, v.y, v.z);
      UV.push(k / radial, len / uvLen);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (i, dir) => {
    const base = P.length / 3;
    const r = radii[i];
    // rounded cap: two rings + pole
    const rings = [[0.72, 0.7], [0.0, 1.0]];
    let prev = i * (radial + 1);
    for (const [rf, hf] of rings) {
      const start = P.length / 3;
      const c = pts[i].clone().addScaledVector(T[i], dir * hf * r * 0.9);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const v = c.clone().addScaledVector(N[i], Math.cos(a) * r * rf).addScaledVector(B[i], Math.sin(a) * r * rf);
        P.push(v.x, v.y, v.z);
        UV.push(k / radial, (len + hf * r) / uvLen);
      }
      for (let k = 0; k < radial; k++) {
        const a = prev + k, b = a + 1, c2 = start + k, d = c2 + 1;
        if (dir > 0) idx.push(a, b, c2, b, d, c2); else idx.push(a, c2, b, b, c2, d);
      }
      prev = start;
    }
    void base;
  };
  if (capEnd) cap(n - 1, 1);
  if (capStart) cap(0, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothCoincident(g);
  return g;
}

// Rotates vector v about axis by angle (in place)
const _q = new THREE.Quaternion();
function rot(v, axis, ang) { return v.applyQuaternion(_q.setFromAxisAngle(axis, ang)); }

/**
 * Hand in the hand-joint frame for the LEFT hand (fingers along -y, palm facing -x,
 * thumb towards +z). pose: 'relaxed' | 'grip' | 'fist' | 'open' | 'point'. Right hand =
 * mirrored by the caller (mirrorX).
 */
export function handGeo({ S = 1, female = false, pose = 'relaxed', glove = false, detail = 1 } = {}) {
  const k = S * (female ? 0.88 : 1);
  const g0 = glove ? 0.0018 : 0;
  const parts = [];
  // palm: superellipse loft along -y
  const palmRows = [[0.012, 0.0165, 0.026], [0.0, 0.0175, 0.029], [-0.03, 0.0165, 0.037], [-0.065, 0.0145, 0.041], [-0.088, 0.0125, 0.0405], [-0.097, 0.009, 0.036]];
  const pr = curve(palmRows);
  const nu = detail > 0.7 ? 12 : 8, nv = detail > 0.7 ? 6 : 4;
  const palm = gridGeo(nu, nv, (i, j, o) => {
    const th = (i / nu) * Math.PI * 2 - Math.PI;
    const y = lerp(0.012, -0.097, j / nv);
    const r = pr(y);
    const n = 3.0;
    const s = Math.sin(th), c = Math.cos(th);
    let x = (r[0] + g0) * spow(s, 2 / n), z = (r[1] + g0) * spow(c, 2 / n);
    // thenar pad on the palm side near the thumb, knuckle ridge on the back
    x -= 0.006 * gauss(z - 0.022, 0.012) * gauss(y + 0.035, 0.022) * (x < 0 ? 1 : 0);
    x += 0.0025 * gauss(y + 0.088, 0.008) * (x > 0 ? 1 : 0);
    o.p = [x * k, y * k, z * k]; o.uv = [i / nu, j / nv]; o.w = [0, 1];
  });
  parts.push(palm);
  // close the palm end and wrist with caps
  const fingers = [
    { z: 0.027, len: 0.078, r: 0.0094 },
    { z: 0.0095, len: 0.086, r: 0.0097 },
    { z: -0.009, len: 0.081, r: 0.0091 },
    { z: -0.026, len: 0.065, r: 0.0081 },
  ];
  const curls = {
    relaxed: [[0.25, 0.35, 0.25], [0.3, 0.42, 0.3], [0.35, 0.45, 0.3], [0.42, 0.5, 0.32]],
    grip: [[1.05, 1.15, 0.55], [1.45, 1.55, 0.8], [1.5, 1.6, 0.8], [1.55, 1.6, 0.8]],
    fist: [[1.55, 1.75, 0.95], [1.6, 1.8, 1.0], [1.6, 1.8, 1.0], [1.6, 1.8, 1.0]],
    open: [[0.05, 0.08, 0.05], [0.05, 0.08, 0.05], [0.08, 0.1, 0.05], [0.12, 0.12, 0.06]],
    point: [[0.0, 0.05, 0.02], [1.6, 1.75, 0.9], [1.6, 1.75, 0.9], [1.6, 1.75, 0.9]],
  }[pose];
  const spread = pose === 'open' ? [0.12, 0.03, -0.05, -0.14] : [0.05, 0.0, -0.03, -0.07];
  const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);
  const radial = detail > 0.7 ? 6 : 4;
  fingers.forEach((f, fi) => {
    const segs = [0.44, 0.32, 0.24];
    const pts = [new THREE.Vector3(0.001, -0.088, f.z)];
    const dir = new THREE.Vector3(0, -1, 0);
    rot(dir, X, spread[fi]);
    let acc = 0;
    const radii = [f.r * 1.08];
    for (let s = 0; s < 3; s++) {
      acc -= curls[fi][s];
      const d = dir.clone();
      rot(d, Z, acc);
      const p0 = pts[pts.length - 1];
      const l = f.len * segs[s];
      pts.push(p0.clone().addScaledVector(d, l * 0.5));
      radii.push(f.r * (1 - 0.1 * s - 0.05));
      pts.push(p0.clone().addScaledVector(d, l));
      radii.push(f.r * (0.97 - 0.12 * s));
    }
    const P = pts.map((p) => p.clone().multiplyScalar(k));
    parts.push(tubeGeo(P, radii.map((r) => (r + g0) * k), radial, false, true, 0.1));
  });
  // thumb
  const tc = { relaxed: [0.25, 0.3, 0.25], grip: [0.55, 0.7, 0.5], fist: [0.9, 0.9, 0.6], open: [0.0, 0.05, 0.05], point: [0.7, 0.8, 0.5] }[pose];
  const tbase = new THREE.Vector3(-0.006, -0.018, 0.03);
  const tdir = new THREE.Vector3(-0.25, -0.62, 0.74).normalize();
  if (pose === 'grip' || pose === 'fist' || pose === 'point') tdir.set(-0.62, -0.58, 0.52).normalize();
  const tpts = [tbase.clone()];
  const tr = [0.0125, 0.0115, 0.0105, 0.0098, 0.009, 0.0082, 0.0075];
  const axis = new THREE.Vector3().crossVectors(tdir, new THREE.Vector3(-1, 0, 0.3)).normalize();
  const tl = [0.034, 0.03, 0.026];
  let tacc = 0;
  for (let s = 0; s < 3; s++) {
    tacc += tc[s];
    const d = tdir.clone();
    rot(d, axis, -tacc);
    const p0 = tpts[tpts.length - 1];
    tpts.push(p0.clone().addScaledVector(d, tl[s] * 0.5));
    tpts.push(p0.clone().addScaledVector(d, tl[s]));
  }
  parts.push(tubeGeo(tpts.map((p) => p.multiplyScalar(k)), tr.map((r) => (r + g0) * k), radial, false, true, 0.1));
  if (glove) {
    // flared leather cuff
    const cuff = new THREE.CylinderGeometry(0.0285 * k, 0.026 * k, 0.04 * k, 14, 1, true);
    cuff.scale(0.82, 1, 1.05);
    cuff.translate(0, 0.016 * k, 0);
    parts.push(cuff);
  }
  return mergeAll(parts.map(plain));
}

// Mirrors a geometry across x (for right-side parts), fixing the winding.
export function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  smoothCoincident(g);
  return g;
}

// ------------------------------------------------------------------- footwear

/**
 * Footwear in the foot-joint frame (ankle at origin, toes towards +z, ground at y = -ground).
 * type: 'boot' | 'sneaker' | 'shoe' | 'pump' | 'combat'. Returns { parts: [[key, geo]] }
 * where key is 'shoe' | 'sole' | 'skin' | 'accent'.
 */
export function footwearGeo({ type = 'boot', S = 1, ground = 0.085, female = false, detail = 1 } = {}) {
  const k = S * (female ? 0.9 : 1);
  const G = ground * S;
  const out = [];
  const nu = detail > 0.7 ? 13 : 9, nv = detail > 0.7 ? 13 : 8;
  const heelH = type === 'pump' ? 0.075 : type === 'boot' ? 0.026 : type === 'combat' ? 0.02 : type === 'shoe' ? 0.016 : 0.012;
  // foot pitch for heels: sole rises from the ball (z = 0.13) to the heel
  const pitchY = (z) => (type === 'pump' ? clamp((0.13 - z) / 0.19, 0, 1) * (heelH - 0.008) : 0);
  // upper: rows along z (heel -> toe): halfWidth, top height above sole
  const rows = type === 'pump'
    ? [[-0.06, 0.028, 0.03], [-0.035, 0.035, 0.036], [0.0, 0.036, 0.03], [0.06, 0.038, 0.022], [0.12, 0.04, 0.02], [0.17, 0.03, 0.014], [0.205, 0.008, 0.006]]
    : [[-0.068, 0.036, 0.075], [-0.045, 0.043, 0.085], [0.0, 0.046, 0.095], [0.05, 0.049, 0.07], [0.11, 0.051, 0.05], [0.155, 0.047, 0.042], [0.19, 0.034, 0.035], [0.205, 0.012, 0.02]];
  const up = curve(rows);
  const z0 = rows[0][0], z1 = rows[rows.length - 1][0];
  const soleT = type === 'pump' ? 0.006 : type === 'sneaker' ? 0.022 : type === 'combat' ? 0.02 : 0.014;
  const upper = gridGeo(nu, nv, (i, j, o) => {
    const th = (i / nu) * Math.PI; // 0 = left edge, pi = right edge over the top
    const z = lerp(z0, z1, j / nv);
    const [w, h] = up(z);
    const base = -G + soleT + pitchY(z);
    const s = Math.sin(th), c = Math.cos(th);
    const x = w * spow(c, 2 / 2.6) * (1 + 0.04 * Math.sin(th));
    const y = base + h * spow(s, 2 / 2.2);
    o.p = [x * k, y, z * k]; o.uv = [i / nu, j / nv]; o.w = [0, 1];
  });
  out.push(['shoe', upper]);
  // toe/heel closing caps of the upper are covered by the sole lip; close the heel back
  const heelCap = gridGeo(nu, 3, (i, j, o) => {
    const th = (i / nu) * Math.PI;
    const [w, h] = up(z0);
    const base = -G + soleT + pitchY(z0);
    const f = 1 - j / 3;
    const x = w * spow(Math.cos(th), 2 / 2.6) * f;
    const y = base + h * spow(Math.sin(th), 2 / 2.2) * f;
    o.p = [x * k, y, z0 * k - (1 - f) * 0.004]; o.uv = [i / nu, 0]; o.w = [0, 1];
  }, { outDir: [0, 0, -1] });
  out.push(['shoe', heelCap]);
  if (type !== 'pump') {
    // shaft rising above the ankle (hidden under trousers, visible on boots)
    // ankle collar: fits inside the trouser hem so it never pokes through when the knee bends
    const shaftH = type === 'boot' || type === 'combat' ? 0.07 : 0.03;
    const sh = new THREE.CylinderGeometry(0.037 * k, 0.044 * k, shaftH + 0.05, 14, 2, false);
    sh.translate(0, -G + soleT + 0.035 + (shaftH + 0.05) / 2, -0.01 * k);
    out.push(['shoe', sh]);
    if (type === 'combat' || type === 'sneaker') {
      // laces: small bars across the instep
      const lace = [];
      for (let i = 0; i < 5; i++) {
        const z = 0.02 + i * 0.022;
        const [w, h] = up(z);
        const b = new THREE.BoxGeometry(w * 1.1 * k, 0.004, 0.006);
        b.rotateX(-0.5);
        b.translate(0, -G + soleT + h * 0.96 + 0.002, z * k);
        lace.push(b);
      }
      out.push(['accent', mergeAll(lace.map(plain))]);
    }
  } else {
    // exposed foot top (skin) inside the pump
    const foot = gridGeo(10, 8, (i, j, o) => {
      const th = (i / 10) * Math.PI;
      const z = lerp(-0.05, 0.13, j / 8);
      const [w] = up(z);
      const base = -G + soleT + pitchY(z) + 0.012;
      const h = lerp(0.07, 0.024, sstep(-0.05, 0.12, z));
      o.p = [w * 0.92 * spow(Math.cos(th), 2 / 2.4) * k, base + h * spow(Math.sin(th), 2 / 2.2), z * k];
      o.uv = [0.5, 0.5]; o.w = [0, 1];
    });
    out.push(['skin', foot]);
    // stiletto
    const st = new THREE.CylinderGeometry(0.006 * k, 0.0035 * k, heelH, 8);
    st.translate(0, -G + heelH / 2, -0.045 * k);
    out.push(['sole', st]);
  }
  // sole: outline extruded slab with a slight lip
  const so = gridGeo(nu * 2, 3, (i, j, o) => {
    const a = (i / (nu * 2)) * Math.PI * 2;
    // walk the outline: parametric around the footprint
    const zc = (z0 + z1) / 2, zr = (z1 - z0) / 2 + 0.004;
    const z = zc + zr * spow(Math.cos(a), 2 / 2.4);
    const w = up(z)[0] + 0.0045;
    const x = w * spow(Math.sin(a), 2 / 3.0);
    const yb = -G + pitchY(z);
    const ys = [yb + 0.0015, yb, yb + soleT * 0.55, yb + soleT + 0.001][j];
    const shrink = j === 0 ? 0.92 : 1;
    o.p = [x * k * shrink, ys, (zc + (z - zc) * shrink) * k]; o.uv = [i / (nu * 2), j / 3]; o.w = [0, 1];
  });
  out.push(['sole', so]);
  const bottom = capGeo((t) => {
    const a = t * Math.PI * 2;
    const zc = (z0 + z1) / 2, zr = (z1 - z0) / 2 + 0.004;
    const z = zc + zr * spow(Math.cos(a), 2 / 2.4) * 0.92;
    const w = (up(z)[0] + 0.0045) * 0.92;
    return [w * spow(Math.sin(a), 2 / 3.0) * k, -G + pitchY(z) + 0.0015, z * k];
  }, nu * 2, () => [0, -G + 0.0015 + pitchY(0.07), 0.07 * k], () => [0, 1]);
  // fan winding faces down: flip
  const bi = bottom.index.array;
  for (let i = 0; i < bi.length; i += 3) { const t = bi[i + 1]; bi[i + 1] = bi[i + 2]; bi[i + 2] = t; }
  bottom.computeVertexNormals();
  out.push(['sole', bottom]);
  if (type !== 'pump' && heelH > 0.014) {
    const hb = new THREE.BoxGeometry(0.064 * k, heelH, 0.07 * k, 1, 1, 1);
    hb.translate(0, -G + heelH / 2 - 0.004, -0.03 * k);
    out.push(['sole', hb]);
  }
  return out;
}
