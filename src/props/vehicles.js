// Procedural vehicles for 1986 Los Angeles: Cobretti's '50 Mercury lead sled, boxy 80s sedans,
// a black-and-white cruiser, a gang van, a chopper and the infamous runaway pram.
// Length runs along x with the nose toward +x; +z is the camera side. Bodies are lofted from
// superellipse cross-sections (smooth normals, real wheel arches); windows, trims and decals are
// thin overlays conformed to the same analytic surfaces so their edges stay crisp and curved.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, solid } from '../core/materials.js';
import * as TX from '../core/textures.js';

const PI = Math.PI;
const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Light entries are copied into the engine light pool, which hands the live source back via
// `ref.src`; animated intensities are written to both.
const setLightI = (L, v) => { L.intensity = v; if (L.ref?.src) L.ref.src.intensity = v; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ geometry helpers

function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
}

function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const s = attr.itemSize, arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

// Flips the winding if the summed vertex normals point away from `expect`.
function orient(g, expect) {
  const n = g.attributes.normal;
  let s = 0;
  for (let i = 0; i < n.count; i++) s += n.getX(i) * expect.x + n.getY(i) * expect.y + n.getZ(i) * expect.z;
  if (s < 0) { flipWinding(g); g.computeVertexNormals(); }
  return g;
}

// Zero-length normals (collapsed loft rings, degenerate triangles) become NaN in the shader's normalize().
function fixNormals(g) {
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) if (Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i)) < 1e-6) n.setXYZ(i, 0, 1, 0);
  return g;
}

function normalizeGeo(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  fixNormals(g);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

function mergeAll(list) {
  list.forEach(normalizeGeo);
  const mixed = list.some((g) => !g.index);
  return mergeGeometries(mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list, false);
}

function mesh(geo, material, { cast = true, receive = true, name } = {}) {
  const m = new THREE.Mesh(fixNormals(geo), material);
  m.castShadow = cast && !material.transparent;
  m.receiveShadow = receive;
  if (name) m.name = name;
  return m;
}

// Collects geometry per material and merges it into one mesh per material (draw-call budget).
class Kit {
  constructor() { this.m = new Map(); }
  add(material, geo, matrix = null) {
    const g = geo.index || geo.attributes.position ? geo.clone() : geo;
    if (matrix) { g.applyMatrix4(matrix); if (matrix.determinant() < 0) flipWinding(g); }
    if (!this.m.has(material)) this.m.set(material, []);
    this.m.get(material).push(g);
    return this;
  }
  box(material, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(material, new THREE.BoxGeometry(w, h, d), M(x, y, z, rx, ry, rz)); }
  rbox(material, w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(material, new RoundedBoxGeometry(w, h, d, 2, r), M(x, y, z, rx, ry, rz)); }
  cyl(material, rt, rb, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12) { return this.add(material, new THREE.CylinderGeometry(rt, rb, h, seg), M(x, y, z, rx, ry, rz)); }
  rod(material, a, b, r, seg = 8) { return this.add(material, rodGeo(a, b, r, seg)); }
  tube(material, pts, r, seg = 6, closed = false) { return this.add(material, tubeGeo(pts, r, seg, closed)); }
  into(parent, opts = {}) {
    for (const [material, list] of this.m) parent.add(mesh(mergeAll(list), material, opts));
    this.m.clear();
    return parent;
  }
}

function rodGeo(a, b, r, seg = 8, r2 = r) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), V(1, 1, 1)));
  return g;
}

// Radial segments scale down with radius: hairline trims are 4-sided, thick tubes up to 6.
function tubeGeo(pts, r, seg = 6, closed = false, density = 2) {
  const radial = Math.min(seg, r < 0.01 ? 4 : r < 0.02 ? 5 : 6);
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), Math.max(6, Math.round(pts.length * density)), r, radial, closed);
}

// Smooth cubic through sorted [x, y] keys (Catmull-Rom tangents), clamped outside the range.
function curve(keys) {
  const n = keys.length;
  if (n === 1) return () => keys[0][1];
  const tan = keys.map((k, i) => {
    const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, n - 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  });
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (x > keys[i + 1][0]) i++;
    const [x0, y0] = keys[i], [x1, y1] = keys[i + 1], h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tan[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * tan[i + 1];
  };
}

// Superellipse quadrant [z, y] from the side point (w, y0) to the pole (0, y0 +- h).
function quadrant(w, h, p, y0, up, n = 48) {
  const e = 2 / p, pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * PI / 2;
    pts.push([w * Math.pow(Math.cos(a), e), y0 + (up ? 1 : -1) * h * Math.pow(Math.sin(a), e)]);
  }
  return pts;
}

// k+1 points evenly spaced along a polyline; `bend` adds length per radian so corners get more rows.
function resample(pts, k, bend = 0.12) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) {
    let s = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (i > 1 && bend) {
      const a0 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
      const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      let da = Math.abs(a1 - a0);
      if (da > PI) da = 2 * PI - da;
      if (s > 1e-7) s += bend * da;
    }
    d.push(d[i - 1] + s);
  }
  const L = d[d.length - 1], out = [];
  let j = 1;
  for (let i = 0; i <= k; i++) {
    const t = (L * i) / k;
    while (j < d.length - 1 && d[j] < t) j++;
    const f = clamp((t - d[j - 1]) / Math.max(d[j] - d[j - 1], 1e-9), 0, 1);
    out.push([lerp(pts[j - 1][0], pts[j][0], f), lerp(pts[j - 1][1], pts[j][1], f)]);
  }
  return out;
}

function stations(x0, x1, step, extra = []) {
  const n = Math.max(2, Math.round((x1 - x0) / step)), xs = [];
  for (let i = 0; i <= n; i++) xs.push(x0 + ((x1 - x0) * i) / n);
  for (const e of extra) if (e > x0 && e < x1) xs.push(e);
  xs.sort((a, b) => a - b);
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-4);
}
const idxOf = (xs, v) => {
  let best = 0;
  xs.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(xs[best] - v)) best = i; });
  return best;
};

// Lofts rings (arrays of [z, y]) along x into a smooth-normal grid. `partOf(s, r)` routes faces
// into separately returned geometries (doors, two-tone paint) that keep the full-mesh normals.
function loft(xs, ringFn, { closed = true, partOf = null, uv = null } = {}) {
  const S = xs.length, rings = xs.map(ringFn), N = rings[0].length;
  const pos = new Float32Array(S * N * 3), uvs = new Float32Array(S * N * 2);
  for (let s = 0; s < S; s++) {
    for (let r = 0; r < N; r++) {
      const k = s * N + r, z = rings[s][r][0], y = rings[s][r][1];
      pos[k * 3] = xs[s]; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const t = uv ? uv(xs[s], y, z) : [xs[s], y];
      uvs[k * 2] = t[0]; uvs[k * 2 + 1] = t[1];
    }
  }
  const segs = closed ? N : N - 1, all = [], parts = new Map();
  for (let s = 0; s < S - 1; s++) {
    for (let r = 0; r < segs; r++) {
      const r1 = (r + 1) % N, a = s * N + r, b = s * N + r1, c = (s + 1) * N + r1, d = (s + 1) * N + r;
      all.push(a, d, c, a, c, b);
      const key = (partOf && partOf(s, r)) || 'main';
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(a, d, c, a, c, b);
    }
  }
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  full.setIndex(all);
  full.computeVertexNormals();
  const out = new Map();
  for (const [k, idx] of parts) out.set(k, subGeo(full, idx));
  return { full, parts: out, S, N, xs, uv };
}

function subGeo(src, list) {
  const P = src.attributes.position.array, Nn = src.attributes.normal.array, U = src.attributes.uv.array;
  const map = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (const v of list) {
    let k = map.get(v);
    if (k === undefined) {
      k = map.size; map.set(v, k);
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); nor.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]); uv.push(U[v * 2], U[v * 2 + 1]);
    }
    idx.push(k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Flat fan cap over the ring at station s, facing (dir, 0, 0).
function capGeo(L, s, dir) {
  const { full, N } = L, P = full.attributes.position.array, U = full.attributes.uv.array;
  let cy = 0, cz = 0, cu = 0, cv = 0;
  for (let r = 0; r < N; r++) { const v = s * N + r; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; cu += U[v * 2]; cv += U[v * 2 + 1]; }
  const cx = P[s * N * 3], pos = [], uv = [];
  for (let r = 0; r < N; r++) {
    const a = s * N + r, b = s * N + ((r + 1) % N);
    pos.push(cx, cy / N, cz / N, P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    uv.push(cu / N, cv / N, U[a * 2], U[a * 2 + 1], U[b * 2], U[b * 2 + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return orient(g, V(dir, 0, 0));
}

// Cuts a grid patch (stations sa..sb, ring rows ra..rb) out of a loft as a thick panel:
// `outer` keeps the body normals (seamless when closed), `inner` is the inside skin + rim.
function slab(L, sa, sb, ra, rb, depth, pivot) {
  const { full, N } = L, P = full.attributes.position.array, Nn = full.attributes.normal.array, U = full.attributes.uv.array;
  const cols = sb - sa + 1, rows = rb - ra + 1;
  const po = [], no = [], uo = [], pi = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const v = (sa + i) * N + ((ra + j) % N);
      const x = P[v * 3] - pivot.x, y = P[v * 3 + 1] - pivot.y, z = P[v * 3 + 2] - pivot.z;
      po.push(x, y, z); no.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]); uo.push(U[v * 2], U[v * 2 + 1]);
      pi.push(x - Nn[v * 3] * depth, y - Nn[v * 3 + 1] * depth, z - Nn[v * 3 + 2] * depth);
    }
  }
  const id = (i, j) => i * rows + j, io = [], ii = [];
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = id(i, j), b = id(i, j + 1), c = id(i + 1, j + 1), d = id(i + 1, j);
      io.push(a, d, c, a, c, b);
      ii.push(a, c, d, a, b, c);
    }
  }
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.Float32BufferAttribute(po, 3));
  outer.setAttribute('normal', new THREE.Float32BufferAttribute(no, 3));
  outer.setAttribute('uv', new THREE.Float32BufferAttribute(uo, 2));
  outer.setIndex(io);
  // inner skin + rims (double-sided material, so winding is irrelevant)
  const n = cols * rows, pos = pi.concat(po);
  const rim = (a, b) => ii.push(a, b, b + n, a, b + n, a + n);
  for (let i = 0; i < cols - 1; i++) { rim(id(i, 0), id(i + 1, 0)); rim(id(i, rows - 1), id(i + 1, rows - 1)); }
  for (let j = 0; j < rows - 1; j++) { rim(id(0, j), id(0, j + 1)); rim(id(cols - 1, j), id(cols - 1, j + 1)); }
  const inner = new THREE.BufferGeometry();
  inner.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  inner.setIndex(ii);
  inner.computeVertexNormals();
  // outline along the outer boundary (for panel gap lines)
  const edge = [];
  const at = (i, j, off) => { const k = id(i, j) * 3; return V(po[k] + no[k] * off, po[k + 1] + no[k + 1] * off, po[k + 2] + no[k + 2] * off); };
  return { outer, inner, at, cols, rows };
}

// Grid surface: u in [u0,u1] (nu cells), t in [0,1] (nv cells); fn(u, t) -> [x, y, z].
function patch(u0, u1, nu, nv, fn, expect) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const p = fn(lerp(u0, u1, i / nu), j / nv);
      pos.push(p[0], p[1], p[2]);
      uv.push(i / nu, j / nv);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + 1, d = a + nv + 1, c = d + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return expect ? orient(g, expect) : g;
}

// Sweeps a closed [u (outward), v (up)] profile along a horizontal path.
function sweep(path, profile, center, taper = null) {
  const n = path.length, m = profile.length, pos = [];
  const t = new THREE.Vector3(), out = new THREE.Vector3(), rel = new THREE.Vector3(), outs = [];
  for (let i = 0; i < n; i++) {
    t.subVectors(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]).normalize();
    out.crossVectors(t, Y).normalize();
    if (out.dot(rel.subVectors(path[i], center)) < 0) out.negate();
    outs.push(out.clone());
    const s = taper ? taper(i / (n - 1)) : 1;
    for (const [u, v] of profile) pos.push(path[i].x + out.x * u * s, path[i].y + v * s, path[i].z + out.z * u * s);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m, a = i * m + j, b = i * m + j1, c = (i + 1) * m + j1, d = (i + 1) * m + j;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mid = Math.floor(n / 2);
  let jm = 0;
  profile.forEach((p, j) => { if (p[0] > profile[jm][0]) jm = j; });
  const nn = g.attributes.normal, k = mid * m + jm;
  if (nn.getX(k) * outs[mid].x + nn.getZ(k) * outs[mid].z < 0) { flipWinding(g); g.computeVertexNormals(); }
  return g;
}

// ------------------------------------------------------------------ car body shape

// Analytic body: lower body = superellipse sections lofted along x (exponent p above the
// widest line ym, q below), clipped by wheel arches; cabin = trapezoid side + squircle roof.
class CarShape {
  constructor(s) {
    Object.assign(this, { p: 5, q: 2.2, KL: 10, KU: 18, crown: null, arches: [] }, s);
  }
  sec(x) {
    const yt = this.yt(x), yb = this.yb(x), w = this.w(x);
    const ym = clamp(this.ym(x), yb + 0.3 * (yt - yb), yt - 0.3 * (yt - yb));
    return { yt, yb, w, ym };
  }
  archY(x) {
    let a = -Infinity;
    for (const A of this.arches) {
      const dx = x - A.x;
      if (Math.abs(dx) < A.r) a = Math.max(a, A.y + Math.sqrt(A.r * A.r - dx * dx));
    }
    return a;
  }
  archStations() {
    const out = [];
    for (const A of this.arches) {
      for (const s of [-1, 1]) {
        out.push(A.x + s * (A.r + 0.0008));
        for (const d of [0.001, 0.008, 0.03, 0.08, 0.17]) out.push(A.x + s * (A.r - d));
      }
    }
    return out;
  }
  crownAt(x, az, y, ym, yt) {
    return this.crown && y > ym ? this.crown(x, az) * Math.min(1, ((y - ym) / Math.max(yt - ym, 1e-4)) * 1.5) : 0;
  }
  ring(x) {
    const { yt, yb, w, ym } = this.sec(x);
    const lo = resample(quadrant(w, ym - yb, this.q, ym, false).reverse(), this.KL);
    const up = resample(quadrant(w, yt - ym, this.p, ym, true), this.KU);
    const right = lo.concat(up.slice(1));
    const a = this.archY(x);
    for (const pt of right) {
      pt[1] += this.crownAt(x, pt[0], pt[1], ym, yt);
      if (pt[1] < a) pt[1] = a;
    }
    const T = right.length - 1, ring = right.slice();
    for (let j = T - 1; j >= 1; j--) ring.push([-right[j][0], right[j][1]]);
    return ring;
  }
  // Half-width of the lower body at height y (no crown).
  sideZ(x, y) {
    const { yt, yb, w, ym } = this.sec(x);
    if (y >= ym) { const f = clamp((y - ym) / (yt - ym), 0, 1); return w * Math.pow(1 - Math.pow(f, this.p), 1 / this.p); }
    const f = clamp((ym - y) / (ym - yb), 0, 1);
    return w * Math.pow(1 - Math.pow(f, this.q), 1 / this.q);
  }
  topY(x, z) {
    const { yt, w, ym } = this.sec(x), az = Math.min(Math.abs(z) / w, 1);
    const y = ym + (yt - ym) * Math.pow(1 - Math.pow(az, this.p), 1 / this.p);
    return y + this.crownAt(x, Math.abs(z), y, ym, yt);
  }
  botY(x, z) {
    const { yb, w, ym } = this.sec(x), az = Math.min(Math.abs(z) / w, 1);
    return Math.max(ym - (ym - yb) * Math.pow(1 - Math.pow(az, this.q), 1 / this.q), this.archY(x));
  }
  inside(x, y, z) {
    if (x < this.x0 || x > this.x1 || Math.abs(z) >= this.w(x)) return false;
    return y < this.topY(x, z) && y > this.botY(x, z);
  }
  // Body surface x at the nose (dir > 0) or tail (dir < 0) for a given (y, z).
  endX(y, z, dir) {
    let a = dir > 0 ? this.x1 - (this.endIn ?? 0.7) : this.x0 + (this.endIn ?? 0.7), b = dir > 0 ? this.x1 : this.x0;
    if (!this.inside(a, y, z)) return a;
    for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (this.inside(m, y, z)) a = m; else b = m; }
    return a;
  }
  // ---- cabin
  cab(x) {
    const c = this.cabin, base = this.yt(x) - c.sink, roof = Math.max(c.roof(x), base + 1e-4), H = roof - base;
    return { base, roof, H, ys: base + c.sf * H, wb: c.wb(x), wr: c.wr(x) };
  }
  cabRing(x) {
    const C = this.cab(x), c = this.cabin, right = [];
    for (let i = 0; i <= c.Ks; i++) { const t = i / c.Ks; right.push([lerp(C.wb, C.wr, t), lerp(C.base, C.ys, t)]); }
    const q = resample(quadrant(C.wr, C.roof - C.ys, c.p, C.ys, true), c.Kq);
    const r = right.concat(q.slice(1)), T = r.length - 1, ring = r.slice();
    for (let j = T - 1; j >= 0; j--) ring.push([-r[j][0], r[j][1]]);
    return ring;
  }
  cabSideZ(x, y) {
    const C = this.cab(x);
    if (y <= C.ys) return lerp(C.wb, C.wr, clamp((y - C.base) / Math.max(C.ys - C.base, 1e-5), 0, 1));
    const f = clamp((y - C.ys) / Math.max(C.roof - C.ys, 1e-5), 0, 1);
    return C.wr * Math.pow(1 - Math.pow(f, this.cabin.p), 1 / this.cabin.p);
  }
  cabTopY(x, z) {
    const C = this.cab(x), az = Math.min(Math.abs(z) / C.wr, 1);
    return C.ys + (C.roof - C.ys) * Math.pow(1 - Math.pow(az, this.cabin.p), 1 / this.cabin.p);
  }
}

// Coarse inward-facing copy of the body (+ cabin) for the view through open doors.
function innerShell(S, withCabin) {
  const C = Object.assign(Object.create(CarShape.prototype), S, { KL: 4, KU: 7, crown: null });
  const geos = [loft(stations(S.x0 + 0.08, S.x1 - 0.08, 0.2), (x) => C.ring(x).map(([z, y]) => [z * 0.95, y - 0.01])).parts.get('main')];
  if (withCabin) {
    C.cabin = { ...S.cabin, Ks: 2, Kq: 5 };
    geos.push(loft(stations(S.cabin.x0, S.cabin.x1, 0.12), (x) => C.cabRing(x).map(([z, y]) => [z * 0.95, y - 0.015]), { closed: false }).parts.get('main'));
  }
  return mergeAll(geos);
}

const avgOf = (f, a, b) => { let s = 0; for (let i = 0; i <= 10; i++) s += f(lerp(a, b, i / 10)); return +(s / 11).toFixed(3); };

// ------------------------------------------------------------------ materials

const mcache = new Map();
function cachedMat(key, fn) {
  if (!mcache.has(key)) mcache.set(key, fn());
  return mcache.get(key);
}
function paintMat(color, { rough = 0.32, metal = 0.5, coat = 1, coatRough = 0.05, map = null, key = '' } = {}) {
  return cachedMat(`paint${color}${rough}${metal}${coat}${coatRough}${key}`, () => new THREE.MeshPhysicalMaterial({
    color, roughness: rough, metalness: metal, clearcoat: coat, clearcoatRoughness: coatRough, map,
  }));
}
const glassMat = () => cachedMat('glass', () => new THREE.MeshPhysicalMaterial({
  color: '#04070b', roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.4,
  polygonOffset: true, polygonOffsetFactor: -1,
}));
const interiorShell = () => cachedMat('interiorShell', () => new THREE.MeshStandardMaterial({ color: '#08080a', roughness: 0.95, side: THREE.BackSide }));
const doorInnerMat = (c = '#1a0c0e') => cachedMat(`doorInner${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide }));
const gapMat = () => solid('#020203', 0.9, 0);
const blackTrim = () => solid('#0b0b0c', 0.45, 0.3);
const rubberMat = () => cachedMat('tire', () => new THREE.MeshStandardMaterial({ color: '#121213', roughness: 0.78, metalness: 0 }));
const decalMat = (key, w, h, draw, extra = {}) => cachedMat(`decal${key}`, () => new THREE.MeshStandardMaterial({
  map: TX.painted(key, w, h, draw), transparent: true, roughness: 0.4, metalness: 0.1,
  polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, ...extra,
}));

// Additive, view-dependent cone for headlight / spotlight beams in the rain.
function beamMat(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `varying float vV; varying vec3 vN; varying vec3 vView;
      void main() { vV = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vV; varying vec3 vN; varying vec3 vView;
      void main() { float edge = pow(abs(dot(normalize(vN), normalize(vView))), 2.5);
        float a = pow(clamp(vV, 0.0, 1.0), 2.4) * edge * uStrength; gl_FragColor = vec4(uColor * a, 1.0); }`, // clamp: MSAA edge extrapolation would make pow() NaN
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function beamGeo(len = 6.5, radius = 1.2, tilt = 0.06) {
  const g = new THREE.ConeGeometry(radius, len, 24, 1, true);
  g.translate(0, -len / 2, 0);
  g.rotateZ(PI / 2 - tilt);
  return g;
}

function plateMat(text, style = 'ca70') {
  return cachedMat(`plate${style}${text}`, () => {
    const tex = TX.painted(`plate_${style}_${text}`, 256, 128, (ctx, w, h) => {
      const old = style === 'ca70';
      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = old ? '#12204a' : '#ebe9e1';
      ctx.beginPath(); ctx.roundRect(4, 4, w - 8, h - 8, 10); ctx.fill();
      ctx.strokeStyle = old ? '#d9b23a' : '#27306e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(10, 10, w - 20, h - 20, 7); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = old ? '#e4bf40' : '#b8262b';
      ctx.font = old ? 'bold 16px Arial, sans-serif' : 'italic bold 22px Georgia, serif';
      ctx.fillText(old ? 'CALIFORNIA' : 'California', w / 2, 25);
      ctx.font = 'bold 64px "Arial Narrow", "Helvetica Condensed", Arial, sans-serif';
      const sc = Math.min(1, 216 / ctx.measureText(text).width);
      ctx.save(); ctx.translate(w / 2, 76); ctx.scale(sc, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillText(text, 2, 3);
      ctx.fillStyle = old ? '#f2ca46' : '#1f2b78'; ctx.fillText(text, 0, 0);
      ctx.restore();
      ctx.fillStyle = '#6a6a6a';
      for (const bx of [44, w - 44]) { ctx.beginPath(); ctx.arc(bx, 25, 5, 0, PI * 2); ctx.fill(); }
      const R = TX.rng(text.length * 31 + 7);
      for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(30,22,12,${R() * 0.25})`; ctx.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2); }
      const gr = ctx.createLinearGradient(0, h, 0, h * 0.5);
      gr.addColorStop(0, 'rgba(25,18,10,0.45)'); gr.addColorStop(1, 'rgba(25,18,10,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35 });
  });
}

// ------------------------------------------------------------------ wheels

const wheelCache = new Map();
function lathe(pts, seg = 40) {
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg);
  g.rotateX(PI / 2);
  return g;
}
function wheelParts(spec) {
  const key = JSON.stringify(spec);
  if (wheelCache.has(key)) return wheelCache.get(key);
  const { r, w, rim, style } = spec, hw = w / 2;
  const tire = lathe([[rim - 0.004, -hw * 0.88], [rim + 0.03, -hw], [r - 0.045, -hw * 1.03], [r - 0.012, -hw * 0.84], [r, -hw * 0.45],
    [r, hw * 0.45], [r - 0.012, hw * 0.84], [r - 0.045, hw * 1.03], [rim + 0.03, hw], [rim - 0.004, hw * 0.88]], 36);
  // tread grooves as thin dark rings on the crown
  const rimG = lathe([[rim + 0.006, hw * 0.86], [rim - 0.008, hw * 0.74], [rim - 0.03, hw * 0.56], [rim * 0.72, hw * 0.48],
    [rim * 0.45, hw * 0.56], [0.0, hw * 0.56]], 30);
  let cap;
  if (style === 'merc') {
    cap = lathe([[0.18, hw * 0.5], [0.176, hw * 0.64], [0.158, hw * 0.78], [0.115, hw * 0.9], [0.055, hw * 0.97], [0.0, hw * 0.985]], 30);
  } else if (style === 'sedan') {
    cap = lathe([[rim + 0.008, hw * 0.88], [rim - 0.004, hw * 0.98], [rim - 0.03, hw * 0.94], [rim - 0.05, hw * 1.0], [rim * 0.62, hw * 0.98],
      [rim * 0.55, hw * 0.9], [rim * 0.5, hw * 0.98], [0.06, hw * 1.04], [0.035, hw * 1.1], [0.0, hw * 1.11]], 30);
  } else {
    cap = lathe([[0.105, hw * 0.55], [0.1, hw * 0.68], [0.08, hw * 0.78], [0.04, hw * 0.83], [0.0, hw * 0.84]], 24);
  }
  const out = { tire, rim: rimG, cap };
  wheelCache.set(key, out);
  return out;
}
function makeWheel(name, x, y, z, spec, rimMat) {
  const parts = wheelParts(spec);
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  const hub = new THREE.Group();
  if (z < 0) hub.rotation.y = PI;
  g.add(hub);
  hub.add(mesh(parts.tire, rubberMat()), mesh(parts.rim, rimMat), mesh(parts.cap, mat('chrome')));
  if (spec.style === 'steel') {
    // trim ring + lug nuts
    const K = new Kit();
    K.add(mat('chrome'), new THREE.TorusGeometry(spec.rim - 0.004, 0.009, 6, 40), M(0, 0, spec.w * 0.43));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; K.cyl(mat('chrome'), 0.012, 0.012, 0.03, Math.cos(a) * 0.075, Math.sin(a) * 0.075, spec.w * 0.29, PI / 2, 0, 0, 6); }
    K.into(hub);
  }
  return g;
}

// Spoked wheel (motorcycle / pram); group centered at the hub, axle along z.
function spokedWheel(name, { r, tire, width, rimR, hubR = 0.04, hubW = 0.1, spokes = 36, spokeR = 0.003, tireMat, rimMat, spokeMat, hubMat }) {
  const g = new THREE.Group();
  g.name = name;
  const K = new Kit();
  const hw = width / 2, tr = r - tire;
  K.add(tireMat, lathe([[tr, -hw * 0.6], [tr + tire * 0.35, -hw], [r - tire * 0.25, -hw * 0.95], [r, -hw * 0.4], [r, hw * 0.4], [r - tire * 0.25, hw * 0.95], [tr + tire * 0.35, hw], [tr, hw * 0.6]], 40));
  K.add(rimMat, new THREE.TorusGeometry(rimR, Math.max(0.008, (tr - rimR) * 0.9 + 0.006), 6, 36));
  K.cyl(hubMat, hubR, hubR, hubW, 0, 0, 0, PI / 2, 0, 0, 16);
  K.cyl(hubMat, hubR * 1.6, hubR * 1.6, 0.008, 0, 0, hubW / 2 - 0.004, PI / 2, 0, 0, 16);
  K.cyl(hubMat, hubR * 1.6, hubR * 1.6, 0.008, 0, 0, -hubW / 2 + 0.004, PI / 2, 0, 0, 16);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * PI * 2, side = i % 2 ? 1 : -1, lace = (i % 4 < 2 ? 1 : -1) * 0.22;
    const h = V(Math.cos(a) * hubR * 1.5, Math.sin(a) * hubR * 1.5, side * (hubW / 2 - 0.004));
    const e = V(Math.cos(a + lace) * (rimR - 0.004), Math.sin(a + lace) * (rimR - 0.004), side * 0.004);
    K.add(spokeMat, rodGeo(h, e, spokeR, 4));
  }
  return K.into(g);
}

// ------------------------------------------------------------------ 1950 Mercury lead sled

const MERC = new CarShape({
  x0: -2.70, x1: 2.70, p: 4.6, q: 2.2, KL: 7, KU: 15, endIn: 0.5,
  yt: curve([[-2.70, 0.57], [-2.63, 0.71], [-2.48, 0.81], [-2.2, 0.872], [-1.85, 0.903], [-1.3, 0.92], [-0.6, 0.93], [0.2, 0.94],
    [0.62, 0.946], [1.1, 0.935], [1.6, 0.91], [2.05, 0.872], [2.35, 0.83], [2.55, 0.785], [2.65, 0.735], [2.70, 0.65]]),
  yb: curve([[-2.70, 0.45], [-2.55, 0.37], [-2.3, 0.31], [-1.95, 0.275], [-1.0, 0.245], [0.8, 0.245], [1.1, 0.25], [2.0, 0.28],
    [2.3, 0.34], [2.5, 0.40], [2.70, 0.43]]),
  w: curve([[-2.70, 0.50], [-2.64, 0.70], [-2.5, 0.84], [-2.25, 0.925], [-1.9, 0.962], [-1.5, 0.975], [-1.0, 0.962], [-0.2, 0.952],
    [0.6, 0.955], [1.2, 0.968], [1.6, 0.975], [2.0, 0.958], [2.3, 0.915], [2.5, 0.85], [2.63, 0.76], [2.70, 0.62]]),
  ym: curve([[-2.7, 0.53], [0, 0.565], [2.7, 0.56]]),
  crown: (() => {
    const ff = curve([[0.9, 0], [1.5, 0.025], [2.0, 0.05], [2.35, 0.08], [2.6, 0.1], [2.72, 0.09]]);
    const fr = curve([[-2.72, 0.035], [-2.4, 0.055], [-1.9, 0.05], [-1.4, 0.028], [-0.9, 0]]);
    return (x, az) => ff(x) * Math.exp(-(((az - 0.6) / 0.21) ** 2)) + fr(x) * Math.exp(-(((az - 0.74) / 0.2) ** 2));
  })(),
  arches: [{ x: 1.66, y: 0.36, r: 0.47 }],
  cabin: {
    sink: 0.06, sf: 0.55, p: 3.2, Ks: 4, Kq: 12, x0: -1.88, x1: 0.68,
    roof: curve([[-1.88, 0.80], [-1.74, 0.95], [-1.5, 1.085], [-1.2, 1.205], [-0.9, 1.29], [-0.55, 1.33], [-0.2, 1.336],
      [0.05, 1.30], [0.22, 1.235], [0.40, 1.125], [0.55, 1.01], [0.68, 0.86]]),
    wb: curve([[-1.88, 0.74], [-1.4, 0.81], [-0.5, 0.83], [0.3, 0.825], [0.68, 0.78]]),
    wr: curve([[-1.88, 0.56], [-1.3, 0.62], [-0.5, 0.655], [0.2, 0.65], [0.68, 0.62]]),
  },
});

/**
 * Cobretti's custom 1950 Mercury coupe ("lead sled"): chopped roof, frenched headlights, fender
 * skirts, toothy chrome grille, black steel wheels with chrome baby-moon caps, A-pillar spotlights,
 * AWSOM 50 plates front and rear. 5.9 m long incl. bumpers (body 5.4 m), 1.95 m wide, roof 1.34 m
 * (antenna tip 1.78 m). Nose toward +x. ~39k triangles, ~40 draw calls.
 *
 * opts: { color = '#16181c', headlights = true, beams = false (additive volumetric headlight cones,
 *   6.5 m long - leave off where bounding boxes matter) }
 * Named children:
 *  - `doorR` (+z, passenger side) / `doorL` (-z, driver side): pivot at the front hinge; open with
 *    `rotation.y = +a` (doorR) / `-a` (doorL), or `userData.setDoor(t, side?)` (t 0..1; side 'L' /
 *    'R', both when omitted). Placed with rotY = PI the driver door faces the camera.
 *  - `wheelFL`, `wheelFR`, `wheelRL`, `wheelRR` (L = -z): roll with `rotation.z = -distance / 0.36`.
 *  - `headlights` (lenses + additive beams), `taillights`.
 * userData: setLights(on) toggles headlight/taillight emissive, beams and the matching
 *   `lights` entries' intensity; colliders = one-way ledges on roof, hood and trunk.
 */
export function makeMercury50(opts = {}) {
  const S = MERC, g = new THREE.Group();
  g.name = 'mercury50';
  const paint = paintMat(opts.color || '#16181c', { rough: 0.38, metal: 0.18, coatRough: 0.03 });
  const chrome = mat('chrome'), black = solid('#050506', 0.85, 0);
  const D0 = -0.66, D1 = 0.60;

  // ---- lower body loft, doors cut out of the grid
  const xs = stations(S.x0, S.x1, 0.062, [...S.archStations(), D0, D1]);
  const sD0 = idxOf(xs, D0), sD1 = idxOf(xs, D1), T = S.KL + S.KU;
  const ring0 = S.ring(0);
  let iDb = 1;
  while (ring0[iDb][1] < 0.30) iDb++;
  let iDt = S.KL;
  while (ring0[iDt][0] > 0.86) iDt++;
  const body = loft(xs, (x) => S.ring(x), {
    partOf: (s, r) => {
      if (s < sD0 || s >= sD1) return null;
      if (r >= iDb && r < iDt) return 'doorR';
      if (r >= 2 * T - iDt && r < 2 * T - iDb) return 'doorL';
      return null;
    },
  });
  g.add(mesh(body.parts.get('main'), paint, { name: 'body' }));
  g.add(mesh(mergeAll([capGeo(body, 0, -1), capGeo(body, body.S - 1, 1)]), paint));

  // ---- cabin (chopped greenhouse)
  const cxs = stations(S.cabin.x0, S.cabin.x1, 0.04, [D0, D1]);
  const cab = loft(cxs, (x) => S.cabRing(x), { closed: false });
  g.add(mesh(cab.parts.get('main'), paint, { name: 'cabin' }));
  g.add(mesh(innerShell(S, true), interiorShell(), { cast: false }));

  const K = new Kit(); // static chrome / black / misc merged per material
  const glass = glassMat();

  // ---- side windows (door glass + quarter glass) with chrome reveal trim
  const xA = 0.50, xC = -1.30;
  const yLo = (x) => S.yt(x) + 0.03;
  const yHi = (x) => Math.max(yLo(x), Math.min(S.cabin.roof(x) - 0.07, yLo(x) + (xA - x) * 1.45, yLo(x) + Math.sqrt(Math.max(0, x - xC)) * 0.6));
  const winZ = (x, y, side, off) => side * (S.cabSideZ(x, y) + off);
  const sideWin = (x0, x1, side) => patch(x0, x1, 16, 4, (x, t) => { const y = lerp(yLo(x), yHi(x), t); return [x, y, winZ(x, y, side, 0.006)]; }, V(0, 0, side));
  const winLoop = (x0, x1, side, n = 12) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n); pts.push(V(x, yLo(x), winZ(x, yLo(x), side, 0.01))); }
    for (let i = n; i >= 0; i--) { const x = lerp(x0, x1, i / n); const y = yHi(x) + 0.004; pts.push(V(x, y, winZ(x, y, side, 0.01))); }
    return pts;
  };
  const quarter = [], doorGlass = {};
  for (const side of [1, -1]) {
    quarter.push(sideWin(xC, D0 - 0.012, side));
    K.tube(chrome, winLoop(xC, D0 - 0.012, side), 0.0085, 6, true);
    doorGlass[side] = { glass: sideWin(D0 + 0.012, xA, side), trim: tubeGeo(winLoop(D0 + 0.012, xA, side), 0.0085, 6, true) };
  }
  // windshield (split, with center bar) and small rear window
  const xw0 = 0.07, xw1 = 0.615, xr0 = -1.68, xr1 = -1.15;
  const sq = (u, e) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), e)), 1 / e);
  const wsE = (x) => S.cabin.wr(x) * 0.84 * sq((x - xw0) / (xw1 - xw0), 7);
  const rwE = (x) => 0.36 * sq((x - xr0) / (xr1 - xr0), 3.2);
  const topWin = [];
  for (const side of [1, -1]) {
    topWin.push(patch(xw0, xw1, 12, 6, (x, t) => { const z = side * lerp(0.015, wsE(x), t); return [x, S.cabTopY(x, z) + 0.006, z]; }, Y));
    const loop = [];
    for (let i = 0; i <= 12; i++) { const x = lerp(xw0, xw1, i / 12), z = side * 0.015; loop.push(V(x, S.cabTopY(x, z) + 0.01, z)); }
    for (let i = 12; i >= 0; i--) { const x = lerp(xw0, xw1, i / 12), z = side * (wsE(x) + 0.004); loop.push(V(x, S.cabTopY(x, z) + 0.01, z)); }
    K.tube(chrome, loop, 0.0075, 6, true);
  }
  topWin.push(patch(xr0, xr1, 10, 8, (x, t) => { const z = lerp(-rwE(x), rwE(x), t); return [x, S.cabTopY(x, z) + 0.006, z]; }, Y));
  {
    const loop = [];
    for (let i = 0; i <= 14; i++) { const x = lerp(xr0, xr1, i / 14), z = rwE(x) + 0.004; loop.push(V(x, S.cabTopY(x, z) + 0.01, z)); }
    for (let i = 14; i >= 0; i--) { const x = lerp(xr0, xr1, i / 14), z = -rwE(x) - 0.004; loop.push(V(x, S.cabTopY(x, z) + 0.01, z)); }
    K.tube(chrome, loop, 0.0075, 6, true);
  }
  g.add(mesh(mergeAll([...quarter, ...topWin]), glass, { cast: false }));
  const cbar = [];
  for (let i = 0; i <= 12; i++) { const x = lerp(xw0 - 0.01, xw1, i / 12); cbar.push(V(x, S.cabTopY(x, 0) + 0.012, 0)); }
  K.tube(chrome, cbar, 0.011, 6);

  // ---- doors
  const doors = {};
  const spearY = (x) => 0.615 + 0.025 * (x / 2.4);
  const spear = (x0, x1, side, n = 20) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), y = spearY(x); pts.push(V(x, y, side * (S.sideZ(x, y) + 0.006))); }
    return tubeGeo(pts, 0.0105, 6, false, 2);
  };
  for (const side of [1, -1]) {
    const name = side > 0 ? 'doorR' : 'doorL';
    const ra = side > 0 ? iDb : 2 * T - iDt, rb = side > 0 ? iDt : 2 * T - iDb;
    const pv = V(xs[sD1], 0.6, side * S.sideZ(xs[sD1], 0.6));
    const dg = new THREE.Group();
    dg.name = name;
    dg.position.copy(pv);
    const sl = slab(body, sD0, sD1, ra, rb, 0.055, pv);
    dg.add(mesh(sl.outer, paint), mesh(sl.inner, doorInnerMat(), { cast: false }));
    const DK = new Kit(), back = M(-pv.x, -pv.y, -pv.z);
    // panel gap lines around the door skin
    const lines = [[], [], [], []];
    for (let i = 0; i < sl.cols; i++) { lines[0].push(sl.at(i, 0, 0.002)); lines[1].push(sl.at(i, sl.rows - 1, 0.002)); }
    for (let j = 0; j < sl.rows; j++) { lines[2].push(sl.at(0, j, 0.002)); lines[3].push(sl.at(sl.cols - 1, j, 0.002)); }
    for (const l of lines) DK.add(gapMat(), tubeGeo(l, 0.0045, 4, false, 1));
    DK.add(glass, doorGlass[side].glass, back);
    DK.add(chrome, doorGlass[side].trim, back);
    DK.add(chrome, spear(D0 + 0.006, D1 - 0.006, side), back);
    DK.into(dg);
    doors[name] = dg;
    g.add(dg);
  }
  // body side chrome: spear front/rear, rocker strip, skirt trim and skirt seam
  for (const side of [1, -1]) {
    K.add(chrome, spear(-2.32, D0 - 0.006, side, 18));
    K.add(chrome, spear(D1 + 0.006, 1.14, side, 8));
    const rock = [];
    for (let i = 0; i <= 16; i++) { const x = lerp(-0.9, 1.14, i / 16), y = 0.292; rock.push(V(x, y, side * (S.sideZ(x, y) + 0.005))); }
    K.tube(chrome, rock, 0.009, 6);
    const seam = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * PI, x = -1.42 + Math.cos(a) * 0.54, y = S.yb(x) + 0.02 + Math.sin(a) * 0.47;
      seam.push(V(x, y, side * (S.sideZ(x, y) + 0.003)));
    }
    K.tube(gapMat(), seam, 0.0045, 4);
    const sk = [];
    for (let i = 0; i <= 10; i++) { const x = lerp(-1.9, -0.94, i / 10), y = 0.33; sk.push(V(x, y, side * (S.sideZ(x, y) + 0.005))); }
    K.tube(chrome, sk, 0.008, 6);
    // front wheel-well liner
    K.add(black, new THREE.CircleGeometry(0.47, 24, 0, PI), M(1.66, 0.36, side * 0.52, 0, side > 0 ? 0 : PI, 0));
  }
  // hood and trunk seams
  const topLine = (pts) => K.tube(gapMat(), pts.map(([x, z]) => V(x, S.topY(x, z) + 0.003, z)), 0.004, 4);
  const across = (x, hz) => Array.from({ length: 9 }, (_, i) => [x, lerp(-hz, hz, i / 8)]);
  const along = (x0, x1, z) => Array.from({ length: 9 }, (_, i) => [lerp(x0, x1, i / 8), z]);
  topLine(across(0.74, 0.69));
  topLine(along(0.74, 2.42, 0.69)); topLine(along(0.74, 2.42, -0.69));
  topLine(across(-1.97, 0.66));
  topLine(along(-2.5, -1.97, 0.66)); topLine(along(-2.5, -1.97, -0.66));

  // ---- nose: grille cavity, chrome teeth, surround, bumpers, bullets
  const gY = 0.535, gHY = 0.10, gHZ = 0.47;
  const gy = (z, t) => { const hy = gHY * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z) / gHZ, 4)), 0.25); return gY - hy + 2 * hy * t; };
  K.add(black, patch(-gHZ, gHZ, 24, 6, (z, t) => { const y = gy(z, t); return [S.endX(y, z, 1) + 0.004, y, z]; }, V(1, 0, 0)));
  const sur = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * PI * 2, c = Math.cos(a), s = Math.sin(a);
    const z = gHZ * Math.sign(c) * Math.pow(Math.abs(c), 0.5) * 1.02, y = gY + gHY * Math.sign(s) * Math.pow(Math.abs(s), 0.5) * 1.06;
    sur.push(V(S.endX(y, z * 0.995, 1) + 0.012, y, z));
  }
  K.tube(chrome, sur, 0.017, 8, true);
  for (let i = 0; i < 9; i++) {
    const z = -0.40 + i * 0.1, y = gY - 0.015, x = S.endX(y, z, 1);
    K.add(chrome, new THREE.CapsuleGeometry(0.033, 0.085, 2, 7), M(x + 0.028, y, z, 0, 0, -0.18, 1, 1, 1));
  }
  const bar = [];
  for (let i = 0; i <= 12; i++) { const z = lerp(-0.44, 0.44, i / 12), y = gY + 0.072; bar.push(V(S.endX(y, z, 1) + 0.03, y, z)); }
  K.tube(chrome, bar, 0.016, 8);
  // bumpers: swept 50s profile around a superellipse plan
  const bprof = [[-0.05, -0.085], [0.0, -0.096], [0.045, -0.082], [0.07, -0.045], [0.08, 0.0], [0.072, 0.045], [0.048, 0.076], [0.0, 0.088], [-0.05, 0.078]];
  const bumper = (dir) => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const z = lerp(-0.97, 0.97, i / 30), ex = 0.78 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z) / 0.985, 3.2)), 1 / 3.2);
      pts.push(V(dir * (2.02 + ex), 0.40, z));
    }
    return sweep(pts, bprof, V(dir * 1.6, 0.4, 0), (t) => 0.62 + 0.38 * Math.min(1, Math.min(t, 1 - t) * 9));
  };
  K.add(chrome, bumper(1)); K.add(chrome, bumper(-1));
  const bullet = lathe([[0.0, 0.0], [0.06, 0.0], [0.064, 0.04], [0.055, 0.09], [0.035, 0.13], [0.0, 0.155]].map(([a, b]) => [a, b]), 20);
  bullet.rotateX(-PI / 2); // back to a y-axis lathe; aimed at +x by the rz below
  for (const side of [1, -1]) {
    const bz = side * 0.36;
    K.add(chrome, bullet, M(2.84, 0.44, bz, 0, 0, -PI / 2));
    K.rod(chrome, V(2.80, 0.46, bz), V(2.70, 0.64, bz), 0.022, 10);
  }
  // rear exhaust tips
  for (const side of [1, -1]) K.cyl(chrome, 0.038, 0.038, 0.16, -2.74, 0.27, side * 0.46, 0, 0, PI / 2, 14);
  // A-pillar spotlights (classic custom touch)
  for (const side of [1, -1]) {
    const x = 0.50, y = S.yt(x) + 0.1, z = side * (S.cabin.wb(x) + 0.075);
    K.cyl(chrome, 0.055, 0.045, 0.15, x + 0.02, y, z, 0, 0, PI / 2, 18);
    K.add(chrome, new THREE.SphereGeometry(0.05, 10, 8), M(x - 0.05, y, z, 0, 0, 0, 1, 1, 1));
    K.add(solid('#d9e2ea', 0.05, 0.2), new THREE.CircleGeometry(0.047, 18), M(x + 0.096, y, z, 0, PI / 2, 0));
    K.rod(chrome, V(x - 0.02, y - 0.03, z), V(x - 0.05, y - 0.09, side * (S.cabin.wb(x) + 0.01)), 0.012, 8);
  }
  // antenna
  K.rod(chrome, V(-2.0, S.topY(-2.0, 0.84) - 0.01, 0.84), V(-2.22, 1.78, 0.84), 0.004, 4);
  K.add(chrome, new THREE.SphereGeometry(0.012, 8, 6), M(-2.22, 1.78, 0.84));

  // ---- plates
  const plate = plateMat('AWSOM 50', 'ca70');
  K.add(plate, new THREE.PlaneGeometry(0.31, 0.155), M(2.886, 0.40, 0, 0, PI / 2, 0));
  const rpx = S.endX(0.60, 0, -1);
  K.add(plate, new THREE.PlaneGeometry(0.31, 0.155), M(rpx - 0.012, 0.60, 0, 0, -PI / 2, 0));
  K.add(chrome, new THREE.BoxGeometry(0.012, 0.175, 0.335), M(rpx - 0.004, 0.60, 0));

  // ---- interior (visible with a door open)
  const seat = solid('#3a0d12', 0.55, 0), dash = paintMat('#1a1c21', { rough: 0.4, metal: 0.4, coat: 0.5 });
  // low-slung bench (the chopped roof leaves little headroom: hip point ~0.45 m), floor pan
  K.box(solid('#0d0d0e', 0.9, 0), 2.4, 0.025, 1.0, -0.55, 0.263, 0);
  K.box(seat, 0.5, 0.12, 1.5, -0.12, 0.32, 0);
  K.box(seat, 0.13, 0.5, 1.5, -0.45, 0.62, 0, 0, 0, 0.3);
  K.box(seat, 0.5, 0.16, 1.2, -1.05, 0.4, 0);
  K.box(seat, 0.13, 0.4, 1.15, -1.3, 0.66, 0, 0, 0, 0.22);
  K.box(dash, 0.26, 0.14, 1.3, 0.42, 0.8, 0);
  // big thin-rimmed wheel, top tilted toward the windshield, two low spokes, column into the dash
  {
    const wc = V(0.06, 0.80, -0.38), tilt = 0.5, wr = 0.19;
    const up = V(Math.sin(tilt), Math.cos(tilt), 0), fwd = V(Math.cos(tilt), -Math.sin(tilt), 0);
    K.add(chrome, new THREE.TorusGeometry(wr, 0.013, 6, 28).rotateY(-PI / 2).rotateZ(-tilt), M(wc.x, wc.y, wc.z));
    for (const a of [-2.4, -0.74]) K.rod(blackTrim(), wc, wc.clone().addScaledVector(up, Math.sin(a) * wr).add(V(0, 0, Math.cos(a) * wr)), 0.009, 6);
    K.rod(chrome, wc.clone().addScaledVector(fwd, -0.01), wc.clone().addScaledVector(fwd, 0.03), 0.045, 14);
    K.rod(blackTrim(), wc, wc.clone().addScaledVector(fwd, 0.36), 0.02, 8);
  }

  // ---- wheels
  const rimM = paintMat('#0b0b0d', { rough: 0.28, metal: 0.4 });
  const wspec = { r: 0.36, w: 0.215, rim: 0.215, style: 'merc' };
  for (const [n, x, z] of [['wheelFL', 1.66, -0.725], ['wheelFR', 1.66, 0.725], ['wheelRL', -1.42, -0.72], ['wheelRR', -1.42, 0.72]]) {
    g.add(makeWheel(n, x, 0.36, z, wspec, rimM));
  }

  // ---- lights
  const headMat = new THREE.MeshStandardMaterial({ color: '#cfd5da', roughness: 0.06, metalness: 0.3, emissive: '#ffe6bb', emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#4a0005', roughness: 0.15, metalness: 0.1, emissive: '#ff1626', emissiveIntensity: 0.4 });
  const head = new THREE.Group(); head.name = 'headlights';
  const tail = new THREE.Group(); tail.name = 'taillights';
  const HK = new Kit(), TK = new Kit(), beams = [], bmat = beamMat('#ffe2b0', 0.16);
  const lights = [];
  for (const side of [1, -1]) {
    const y = 0.738, z = side * 0.565, x = S.endX(y, z, 1);
    HK.add(headMat, new THREE.SphereGeometry(0.084, 18, 10), M(x - 0.004, y, z, 0, -side * 0.22, 0, 0.42, 1, 1));
    K.add(paint, new THREE.TorusGeometry(0.093, 0.022, 8, 24), M(x - 0.018, y, z, 0, PI / 2 - side * 0.22, 0));
    K.add(chrome, new THREE.TorusGeometry(0.086, 0.0055, 4, 24), M(x + 0.008, y, z, 0, PI / 2 - side * 0.22, 0));
    if (opts.beams) {
      const bm = new THREE.Mesh(beamGeo(), bmat);
      bm.position.set(x + 0.03, y, z);
      bm.rotation.y = -side * 0.05;
      bm.renderOrder = 5;
      beams.push(bm);
      head.add(bm);
    }
    lights.push({ pos: V(x + 1.5, y - 0.1, z), color: '#ffe6bb', ref: {}, intensity: 0, distance: 9, on: 7 });
    const ty = 0.70, tz = side * 0.69, tx = S.endX(ty, tz, -1);
    TK.add(tailMat, new THREE.CapsuleGeometry(0.034, 0.15, 4, 10), M(tx - 0.006, ty, tz, 0, 0, 0, 0.55, 1, 1));
    K.add(chrome, new THREE.CapsuleGeometry(0.043, 0.16, 4, 10), M(tx + 0.006, ty, tz, 0, 0, 0, 0.45, 1, 1));
  }
  lights.push({ pos: V(-3.0, 0.70, 0), color: '#ff1a2a', ref: {}, intensity: 0, distance: 3.5, on: 2.5 });
  HK.into(head, { cast: false });
  TK.into(tail, { cast: false });
  g.add(head, tail);
  K.into(g);

  const setLights = (on) => {
    headMat.emissiveIntensity = on ? 4 : 0;
    tailMat.emissiveIntensity = on ? 3 : 0.35;
    for (const b of beams) b.visible = on;
    for (const L of lights) setLightI(L, on ? L.on : 0);
  };
  setLights(opts.headlights ?? true);

  const roofY = S.cabin.roof(-0.4);
  g.userData = {
    colliders: [
      { type: 'ledge', x0: -0.95, x1: 0.0, y: +roofY.toFixed(3) },
      { type: 'ledge', x0: 0.85, x1: 2.4, y: avgOf((x) => S.topY(x, 0), 0.85, 2.4) },
      { type: 'ledge', x0: -2.5, x1: -1.9, y: avgOf((x) => S.topY(x, 0), -2.5, -1.9) },
    ],
    lights,
    setLights,
    doors,
    // t 0..1 of the 1.15 rad swing; side 'L' / 'R' moves one door only
    setDoor: (t, side) => {
      if (side !== 'L') doors.doorR.rotation.y = t * 1.15;
      if (side !== 'R') doors.doorL.rotation.y = -t * 1.15;
    },
  };
  return g;
}

// ------------------------------------------------------------------ 80s sedan / police cruiser

const SEDAN = new CarShape({
  x0: -2.70, x1: 2.70, p: 7, q: 5, KL: 8, KU: 16,
  yt: curve([[-2.70, 0.85], [-2.65, 0.94], [-2.55, 0.982], [-2.2, 0.995], [-1.6, 0.99], [-1.0, 0.975], [0.0, 0.965], [1.0, 0.955],
    [2.0, 0.94], [2.5, 0.925], [2.64, 0.9], [2.70, 0.82]]),
  yb: curve([[-2.70, 0.42], [-2.5, 0.36], [-2.2, 0.32], [2.2, 0.32], [2.5, 0.36], [2.70, 0.42]]),
  w: curve([[-2.70, 0.905], [-2.64, 0.945], [-2.5, 0.96], [2.5, 0.96], [2.64, 0.945], [2.70, 0.905]]),
  ym: curve([[0, 0.66]]),
  arches: [{ x: 1.55, y: 0.345, r: 0.43 }, { x: -1.42, y: 0.345, r: 0.43 }],
  cabin: {
    sink: 0.05, sf: 0.62, p: 5, Ks: 4, Kq: 10, x0: -1.64, x1: 0.97,
    roof: curve([[-1.64, 0.93], [-1.52, 1.18], [-1.40, 1.37], [-1.22, 1.42], [-0.5, 1.43], [0.1, 1.42], [0.32, 1.38], [0.64, 1.19], [0.97, 0.93]]),
    wb: curve([[-1.64, 0.86], [0, 0.875], [0.97, 0.86]]),
    wr: curve([[-1.64, 0.71], [0, 0.735], [0.97, 0.72]]),
  },
});

const SEDAN_PAINTS = ['#5e1a1c', '#3b2a1f', '#bfae8a', '#1d2a48', '#29382c', '#d6d2c6', '#6f8091', '#4a1828', '#8a6a33', '#2c2f33', '#6a2f1c'];

function sedanPlate(R) {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const c = () => L[Math.floor(R() * L.length)];
  return `${1 + Math.floor(R() * 8)}${c()}${c()}${c()}${100 + Math.floor(R() * 900)}`;
}

function buildSedan(opts, police) {
  const S = SEDAN, g = new THREE.Group();
  const R = TX.rng((opts.seed ?? 7) * 7919 + 13);
  const color = opts.color || SEDAN_PAINTS[Math.floor(R() * SEDAN_PAINTS.length)];
  const paint = police ? paintMat('#0b0c0f', { rough: 0.3, metal: 0.4, coatRough: 0.05 }) : paintMat(color, { rough: 0.4, metal: 0.35, coat: 0.6, coatRough: 0.12 });
  const white = paintMat('#e6e6e1', { rough: 0.35, metal: 0.05, coat: 0.8, coatRough: 0.08 });
  const chrome = mat('chrome'), black = solid('#060607', 0.85, 0), trim = blackTrim();
  const DX = [0.88, -0.26, -1.20];

  const xs = stations(S.x0, S.x1, 0.05, [...S.archStations(), ...DX]);
  const s0 = idxOf(xs, -1.20), s1 = idxOf(xs, 0.88), T = S.KL + S.KU;
  const ring0 = S.ring(0);
  let rLo = 1;
  while (ring0[rLo][1] < 0.37) rLo++;
  let rHi = S.KL;
  while (ring0[rHi][0] > 0.9) rHi++;
  const body = loft(xs, (x) => S.ring(x), {
    partOf: police ? (s, r) => (s >= s0 && s < s1 && ((r >= rLo && r < rHi) || (r >= 2 * T - rHi && r < 2 * T - rLo)) ? 'white' : null) : null,
  });
  g.add(mesh(body.parts.get('main'), paint, { name: 'body' }));
  if (body.parts.has('white')) g.add(mesh(body.parts.get('white'), white));
  g.add(mesh(mergeAll([capGeo(body, 0, -1), capGeo(body, body.S - 1, 1)]), paint));
  const cab = loft(stations(S.cabin.x0, S.cabin.x1, 0.035), (x) => S.cabRing(x), { closed: false });
  g.add(mesh(cab.parts.get('main'), police ? white : paint, { name: 'cabin' }));

  const K = new Kit(), glass = glassMat();
  // ---- glass: two side windows per side, windshield, formal rear glass
  const yLo = (x) => S.yt(x) + 0.028;
  const winA = 0.74, winB0 = -0.20, winB1 = -0.31, winC = -1.13;
  const yHiF = (x) => Math.max(yLo(x), Math.min(S.cabin.roof(x) - 0.055, yLo(x) + (winA - x) * 1.2));
  const yHiR = (x) => Math.max(yLo(x), S.cabin.roof(x) - 0.055);
  const glassGeos = [];
  for (const side of [1, -1]) {
    const zf = (x, y, off) => side * (S.cabSideZ(x, y) + off);
    for (const [x0, x1, hi] of [[winB0, winA, yHiF], [winC, winB1, yHiR]]) {
      glassGeos.push(patch(x0, x1, 20, 5, (x, t) => { const y = lerp(yLo(x), hi(x), t); return [x, y, zf(x, y, 0.006)]; }, V(0, 0, side)));
      const loop = [];
      for (let i = 0; i <= 12; i++) { const x = lerp(x0, x1, i / 12); loop.push(V(x, yLo(x), zf(x, yLo(x), 0.01))); }
      for (let i = 12; i >= 0; i--) { const x = lerp(x0, x1, i / 12), y = hi(x) + 0.004; loop.push(V(x, y, zf(x, y, 0.01))); }
      K.tube(police ? trim : chrome, loop, 0.008, 5, true);
    }
    // B-pillar blackout
    K.add(trim, patch(winB1 - 0.004, winB0 + 0.004, 3, 4, (x, t) => { const y = lerp(yLo(x), S.cabin.roof(x) - 0.03, t); return [x, y, zf(x, y, 0.004)]; }, V(0, 0, side)));
  }
  const sq = (u, e) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), e)), 1 / e);
  const xw0 = 0.30, xw1 = 0.93, xr0 = -1.60, xr1 = -1.36;
  glassGeos.push(patch(xw0, xw1, 16, 14, (x, t) => { const e = S.cabin.wr(x) * 0.9 * sq((x - xw0) / (xw1 - xw0), 8), z = lerp(-e, e, t); return [x, S.cabTopY(x, z) + 0.006, z]; }, Y));
  glassGeos.push(patch(xr0, xr1, 10, 14, (x, t) => { const e = S.cabin.wr(x) * 0.86 * sq((x - xr0) / (xr1 - xr0), 8), z = lerp(-e, e, t); return [x, S.cabTopY(x, z) + 0.006, z]; }, Y));
  g.add(mesh(mergeAll(glassGeos), glass, { cast: false }));
  // vinyl landau roof + opera lamps on some civilian sedans
  if (!police && R() < 0.5) {
    const vinyl = solid(R() < 0.5 ? '#16130f' : '#d8cfb8', 0.88, 0);
    K.add(vinyl, patch(-1.38, 0.30, 24, 16, (x, t) => { const e = S.cabin.wr(x) - 0.004, z = lerp(-e, e, t); return [x, S.cabTopY(x, z) + 0.004, z]; }, Y));
    for (const side of [1, -1]) {
      K.add(vinyl, patch(-1.40, winC - 0.02, 6, 6, (x, t) => { const y = lerp(yLo(x) + 0.01, S.cabin.roof(x) - 0.02, t); return [x, y, side * (S.cabSideZ(x, y) + 0.003)]; }, V(0, 0, side)));
      K.add(glow('#ffd9a0', 3), new THREE.BoxGeometry(0.07, 0.025, 0.01), M(-1.28, yLo(-1.28) + 0.17, side * (S.cabSideZ(-1.28, yLo(-1.28) + 0.17) + 0.008)));
    }
  }

  // ---- side detail: moldings, door gaps, handles, markers, mirrors
  const AF = S.arches[0], AR = S.arches[1];
  for (const side of [1, -1]) {
    const zs = side * (S.w(0) + 0.008);
    for (const [a, b] of [[AF.x + AF.r + 0.03, 2.6], [AR.x + AR.r + 0.03, AF.x - AF.r - 0.03], [-2.6, AR.x - AR.r - 0.03]]) {
      K.box(trim, b - a, 0.045, 0.016, (a + b) / 2, 0.6, zs);
      K.box(chrome, b - a, 0.008, 0.018, (a + b) / 2, 0.625, zs);
    }
    for (const x of DX) {
      const pts = [];
      for (let i = 0; i <= 8; i++) { const y = lerp(0.38, S.yt(x) - 0.005, i / 8); pts.push(V(x, y, side * (S.sideZ(x, y) + 0.002))); }
      K.tube(gapMat(), pts, 0.0045, 4);
    }
    const bl = [];
    for (let i = 0; i <= 10; i++) { const x = lerp(-1.2, 0.88, i / 10), y = 0.38; bl.push(V(x, y, side * (S.sideZ(x, y) + 0.002))); }
    K.tube(gapMat(), bl, 0.004, 4);
    for (const hx of [0.62, -0.5]) K.rbox(chrome, 0.17, 0.035, 0.03, 0.01, hx, 0.86, side * (S.w(0) - 0.002));
    K.box(glow('#ff9a1a', 1.6), 0.12, 0.05, 0.02, 2.5, 0.68, side * 0.952);
    K.box(glow('#ff1020', 1.4), 0.12, 0.05, 0.02, -2.52, 0.72, side * 0.952);
    const mz = side * 1.0;
    K.rbox(police ? trim : chrome, 0.08, 0.1, 0.15, 0.02, 0.86, 1.04, mz);
    K.rod(police ? trim : chrome, V(0.88, 1.0, side * 0.93), V(0.86, 1.03, mz), 0.012, 6);
  }
  // ---- front fascia
  const f = S.x1;
  K.box(black, 0.03, 0.2, 0.74, f + 0.006, 0.66, 0);
  for (let i = 0; i <= 14; i++) K.box(chrome, 0.012, 0.19, 0.012, f + 0.02, 0.66, -0.36 + i * (0.72 / 14));
  for (const y of [0.565, 0.755]) K.box(chrome, 0.03, 0.02, 0.8, f + 0.02, y, 0);
  for (const z of [-0.39, 0.39]) K.box(chrome, 0.03, 0.21, 0.02, f + 0.02, 0.66, z);
  const headMat = new THREE.MeshStandardMaterial({ color: '#cdd3d8', roughness: 0.06, metalness: 0.3, emissive: '#fff1d6', emissiveIntensity: 0 });
  const head = new THREE.Group(); head.name = 'headlights';
  const HK = new Kit();
  for (const side of [1, -1]) {
    for (const z of [0.52, 0.73]) {
      HK.box(headMat, 0.02, 0.115, 0.17, f + 0.012, 0.67, side * z);
      K.box(chrome, 0.018, 0.14, 0.2, f + 0.004, 0.67, side * z);
    }
    K.box(glow('#ff8f1a', 1.8), 0.02, 0.05, 0.2, f + 0.13, 0.385, side * 0.62);
  }
  HK.into(head, { cast: false });
  // bumpers (big 80s chrome with rubber strip and wraparound ends)
  for (const dir of [1, -1]) {
    const bx = dir * (S.x1 + 0.09);
    K.rbox(police ? trim : chrome, 0.16, 0.17, 1.96, 0.03, bx, 0.42, 0);
    K.box(trim, 0.02, 0.045, 1.9, bx + dir * 0.08, 0.43, 0);
    for (const side of [1, -1]) K.rbox(police ? trim : chrome, 0.42, 0.17, 0.08, 0.03, dir * (S.x1 - 0.1), 0.42, side * 0.955);
  }
  const plate = plateMat(police ? '1E 34571' : sedanPlate(R), 'ca82');
  K.add(plate, new THREE.PlaneGeometry(0.31, 0.155), M(f + 0.181, 0.42, 0, 0, PI / 2, 0));
  // ---- rear
  const tailMat = new THREE.MeshStandardMaterial({ color: '#3c0004', roughness: 0.15, metalness: 0.1, emissive: '#ff1424', emissiveIntensity: 1.6 });
  const tail = new THREE.Group(); tail.name = 'taillights';
  const TK = new Kit(), r0 = S.x0;
  for (const side of [1, -1]) {
    TK.box(tailMat, 0.02, 0.16, 0.56, r0 - 0.006, 0.78, side * 0.6);
    K.box(chrome, 0.016, 0.18, 0.58, r0 - 0.001, 0.78, side * 0.6);
    for (const dz of [-0.14, 0.0, 0.14]) K.box(chrome, 0.026, 0.16, 0.008, r0 - 0.008, 0.78, side * (0.6 + dz));
    K.box(glow('#fff4e0', 1.2), 0.02, 0.06, 0.12, r0 - 0.008, 0.66, side * 0.38);
  }
  TK.into(tail, { cast: false });
  K.add(plate, new THREE.PlaneGeometry(0.31, 0.155), M(r0 - 0.012, 0.64, 0, 0, -PI / 2, 0));
  K.cyl(chrome, 0.03, 0.03, 0.14, r0 - 0.05, 0.3, 0.55, 0, 0, PI / 2, 12);
  // hood ornament, antenna, hood/trunk seams
  K.add(chrome, new THREE.ConeGeometry(0.03, 0.07, 4), M(2.52, S.topY(2.52, 0) + 0.03, 0));
  K.rod(chrome, V(2.1, S.topY(2.1, 0.78), 0.78), V(2.08, 1.95, 0.78), 0.004, 4);
  const top = (pts) => K.tube(gapMat(), pts.map(([x, z]) => V(x, S.topY(x, z) + 0.003, z)), 0.004, 4);
  top(Array.from({ length: 11 }, (_, i) => [1.0, lerp(-0.84, 0.84, i / 10)]));
  top(Array.from({ length: 11 }, (_, i) => [-1.72, lerp(-0.84, 0.84, i / 10)]));
  for (const z of [0.84, -0.84]) { top(Array.from({ length: 9 }, (_, i) => [lerp(1.0, 2.62, i / 8), z])); top(Array.from({ length: 6 }, (_, i) => [lerp(-2.62, -1.72, i / 5), z])); }
  // wheel well liners
  for (const A of S.arches) for (const side of [1, -1]) K.add(black, new THREE.CircleGeometry(A.r, 24, 0, PI), M(A.x, A.y, side * 0.5, 0, side > 0 ? 0 : PI, 0));

  // ---- wheels
  const spec = police ? { r: 0.345, w: 0.21, rim: 0.205, style: 'steel' } : { r: 0.345, w: 0.205, rim: 0.205, style: 'sedan' };
  const rimM = police ? paintMat('#101114', { rough: 0.4, metal: 0.5, coat: 0.3 }) : solid('#2a2b2e', 0.4, 0.7);
  for (const [n, x, z] of [['wheelFL', AF.x, -0.76], ['wheelFR', AF.x, 0.76], ['wheelRL', AR.x, -0.75], ['wheelRR', AR.x, 0.75]]) g.add(makeWheel(n, x, 0.345, z, spec, rimM));

  const lights = [];
  for (const side of [1, -1]) lights.push({ pos: V(f + 1.5, 0.6, side * 0.62), color: '#fff1d6', ref: {}, intensity: 0, distance: 9, on: 7 });
  const setLights = (on) => {
    headMat.emissiveIntensity = on ? 4 : 0;
    tailMat.emissiveIntensity = on ? 2.6 : 0.4;
    for (const L of lights) setLightI(L, on ? L.on : 0);
  };
  g.add(head, tail);
  const roofY = S.cabin.roof(-0.5);
  g.userData = {
    colliders: [
      { type: 'ledge', x0: -1.15, x1: 0.15, y: +roofY.toFixed(3) },
      { type: 'ledge', x0: 1.0, x1: 2.62, y: avgOf((x) => S.topY(x, 0), 1.0, 2.62) },
      { type: 'ledge', x0: -2.62, x1: -1.72, y: avgOf((x) => S.topY(x, 0), -2.62, -1.72) },
    ],
    lights,
    setLights,
  };
  return { g, K, S, setLights, roofY, white, trim, lights };
}

/**
 * Boxy 1980s American full-size sedan (Caprice / Crown Vic era): flat sides, formal roof,
 * quad headlights, chrome bumpers, optional vinyl landau roof. 5.8 m long incl. bumpers, 1.92 m wide
 * (2.15 m at the mirrors), roof 1.43 m. ~33k triangles.
 *
 * opts: { seed = 7 (paint, plate, vinyl roof), color (override), headlights = false }
 * Named children: `wheelFL/FR/RL/RR` (L = -z, roll about z, r = 0.345), `headlights`, `taillights`.
 * userData: colliders = one-way ledges on roof (y ~1.43), hood (~0.95) and trunk (~0.99);
 *   lights (headlights, intensity 0 until setLights(true)); setLights(on).
 */
export function makeSedan80s(opts = {}) {
  const { g, K, setLights } = buildSedan(opts, false);
  g.name = 'sedan80s';
  K.into(g);
  setLights(opts.headlights ?? false);
  return g;
}

/**
 * Generic 1980s black-and-white police cruiser ("POLICE" only, no department names): black body,
 * white doors and roof, push bar, A-pillar spotlights, steel wheels, animated red/blue lightbar.
 * Same footprint as makeSedan80s (5.6 x 1.95 m; lightbar top ~1.62 m).
 *
 * opts: { seed, unit = '17', headlights = true, lightbar = true }
 * Named children: `lightbar` (with `rotorR`/`rotorB` spinning reflectors), wheels as sedan,
 *   `headlights`, `taillights`.
 * userData: update(dt, t) flashes red/blue (also writes userData.lights[0/1].intensity),
 *   lights = [red, blue, headL, headR]; setLights(on); setLightbar(on); colliders as sedan.
 */
export function makePoliceCar(opts = {}) {
  const { g, K, S, setLights, roofY, trim, lights } = buildSedan(opts, true);
  g.name = 'policeCar';
  const chrome = mat('chrome');
  const unit = String(opts.unit ?? '17');
  // ---- door lettering and roof/trunk unit numbers
  const word = decalMat('police_word', 512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 104px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sc = Math.min(1, 480 / ctx.measureText('POLICE').width);
    ctx.save(); ctx.translate(w / 2, h / 2 + 4); ctx.scale(sc, 1);
    ctx.lineWidth = 10; ctx.strokeStyle = '#d8d8d4'; ctx.strokeText('POLICE', 0, 0);
    ctx.fillStyle = '#0c0d10'; ctx.fillText('POLICE', 0, 0);
    ctx.restore();
  });
  const num = decalMat(`police_unit${unit}`, 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 190px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0c0d10'; ctx.fillText(unit, w / 2, h / 2 + 10);
  });
  const numW = decalMat(`police_unitw${unit}`, 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 170px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e6e6e1'; ctx.fillText(unit, w / 2, h / 2 + 10);
  });
  for (const side of [1, -1]) {
    const z = side * (S.w(0) + 0.004);
    K.add(word, new THREE.PlaneGeometry(0.92, 0.23), M(0.18, 0.7, z, 0, side > 0 ? 0 : PI, 0));
    K.add(numW, new THREE.PlaneGeometry(0.28, 0.28), M(-2.15, 0.72, side * (S.w(-2.15) + 0.004), 0, side > 0 ? 0 : PI, 0));
  }
  K.add(num, new THREE.PlaneGeometry(0.7, 0.7), M(-0.95, S.cabTopY(-0.95, 0) + 0.006, 0, -PI / 2, 0, PI / 2));
  // ---- push bar, spotlights, antennas
  for (const side of [1, -1]) {
    K.rod(trim, V(2.86, 0.42, side * 0.36), V(2.98, 0.86, side * 0.34), 0.03, 10);
    const x = 0.80, y = S.yt(x) + 0.1, zz = side * (S.cabin.wb(x) + 0.08);
    K.cyl(chrome, 0.06, 0.05, 0.16, x, y, zz, 0, 0, PI / 2, 16);
    K.add(solid('#dfe6ec', 0.05, 0.2), new THREE.CircleGeometry(0.052, 16), M(x + 0.081, y, zz, 0, PI / 2, 0));
    K.rod(chrome, V(x - 0.04, y - 0.03, zz), V(x - 0.06, y - 0.1, side * (S.cabin.wb(x) + 0.01)), 0.012, 6);
  }
  K.rod(trim, V(2.98, 0.6, -0.36), V(2.98, 0.6, 0.36), 0.03, 10);
  K.rod(trim, V(2.98, 0.82, -0.34), V(2.98, 0.82, 0.34), 0.026, 10);
  for (const z of [-0.5, 0.3]) K.rod(trim, V(-2.3, S.topY(-2.3, z), z), V(-2.34, 1.9, z), 0.005, 4);
  K.into(g);

  // ---- lightbar
  const lb = new THREE.Group();
  lb.name = 'lightbar';
  lb.position.set(-0.4, roofY, 0);
  const LK = new Kit();
  LK.rbox(trim, 0.30, 0.07, 1.42, 0.02, 0, 0.05, 0);
  for (const z of [-0.62, 0.62]) LK.box(trim, 0.42, 0.02, 0.05, 0, 0.012, z);
  LK.rbox(chrome, 0.22, 0.09, 0.14, 0.02, 0, 0.13, 0);
  LK.add(glow('#eef4ff', 1.5), new THREE.BoxGeometry(0.01, 0.05, 0.1), M(0.111, 0.13, 0));
  LK.into(lb);
  const redM = new THREE.MeshStandardMaterial({ color: '#3a0306', emissive: '#ff1830', emissiveIntensity: 0.6, roughness: 0.15, transparent: true, opacity: 0.82 });
  const blueM = new THREE.MeshStandardMaterial({ color: '#03103a', emissive: '#1c4dff', emissiveIntensity: 0.6, roughness: 0.15, transparent: true, opacity: 0.82 });
  const rotRM = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff3040', emissiveIntensity: 6 });
  const rotBM = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#4a72ff', emissiveIntensity: 6 });
  const lensGeo = new RoundedBoxGeometry(0.25, 0.13, 0.56, 3, 0.05);
  const redLens = new THREE.Mesh(lensGeo, redM); redLens.position.set(0, 0.145, -0.38);
  const blueLens = new THREE.Mesh(lensGeo, blueM); blueLens.position.set(0, 0.145, 0.38);
  const rotGeo = new THREE.BoxGeometry(0.15, 0.08, 0.02);
  const rotorR = new THREE.Mesh(rotGeo, rotRM); rotorR.name = 'rotorR'; rotorR.position.set(0, 0.145, -0.38);
  const rotorB = new THREE.Mesh(rotGeo, rotBM); rotorB.name = 'rotorB'; rotorB.position.set(0, 0.145, 0.38);
  lb.add(rotorR, rotorB, redLens, blueLens);
  g.add(lb);
  const red = { pos: V(-0.4, roofY + 1.1, -0.6), color: '#ff1830', ref: {}, intensity: 0, distance: 14 };
  const blue = { pos: V(-0.4, roofY + 1.1, 0.6), color: '#2050ff', ref: {}, intensity: 0, distance: 14 };
  lights.unshift(red, blue);
  let barOn = opts.lightbar ?? true;
  const pulse = (ph) => (ph < 0.08 || (ph > 0.14 && ph < 0.22) ? 1 : 0);
  const update = (dt, t) => {
    if (!barOn) {
      redM.emissiveIntensity = blueM.emissiveIntensity = 0.15; rotRM.emissiveIntensity = rotBM.emissiveIntensity = 0;
      setLightI(red, 0); setLightI(blue, 0);
      return;
    }
    const ph = (t / 0.72) % 1, r = pulse(ph), b = pulse((ph + 0.5) % 1);
    rotorR.rotation.y = t * 15; rotorB.rotation.y = -t * 15 + 1.3;
    const sr = 0.5 + 0.5 * Math.cos(rotorR.rotation.y), sb = 0.5 + 0.5 * Math.cos(rotorB.rotation.y);
    redM.emissiveIntensity = 0.5 + r * 3.2 + sr * 0.8; blueM.emissiveIntensity = 0.5 + b * 3.2 + sb * 0.8;
    rotRM.emissiveIntensity = 2.5 + r * 3; rotBM.emissiveIntensity = 2.5 + b * 3;
    setLightI(red, 1.5 + r * 12 + sr * 3); setLightI(blue, 1.5 + b * 12 + sb * 3);
  };
  update(0, 0);
  setLights(opts.headlights ?? true);
  Object.assign(g.userData, { update, setLightbar: (on) => { barOn = on; } });
  return g;
}

// ------------------------------------------------------------------ gang van

const VAN = new CarShape({
  x0: -2.45, x1: 2.45, p: 9, q: 6, KL: 6, KU: 18,
  yt: curve([[-2.45, 1.93], [-2.41, 2.02], [-2.3, 2.055], [0.9, 2.06], [1.08, 2.035], [1.22, 1.95], [1.42, 1.72], [1.62, 1.46],
    [1.78, 1.27], [1.92, 1.17], [2.15, 1.12], [2.36, 1.07], [2.45, 0.98]]),
  yb: curve([[-2.45, 0.45], [-2.32, 0.39], [2.3, 0.39], [2.45, 0.45]]),
  w: curve([[-2.45, 0.94], [-2.38, 0.98], [2.32, 0.98], [2.45, 0.935]]),
  ym: curve([[0, 0.92]]),
  arches: [{ x: 1.62, y: 0.355, r: 0.42 }, { x: -1.5, y: 0.355, r: 0.42 }],
});
const VAN_PAINTS = [['#3b3d2c', 'olive'], ['#4a3427', 'brown'], ['#55514b', 'primer'], ['#4a1f24', 'maroon'], ['#2a3540', 'navy']];

// `mirror` draws the lettering flipped so the -z side (whose u still runs along +x) reads correctly.
function vanCanvas(key, base, seed, mirror = false) {
  return TX.painted(`van_${key}${mirror ? 'm' : ''}`, 1024, 512, (ctx, W, H) => {
    const R = TX.rng(seed);
    const X = (x) => ((x + 2.45) / 4.9) * W, Yp = (y) => (1 - y / 2.1) * H;
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    // mottled fade + primer patches
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${R() < 0.5 ? '255,255,240' : '0,0,0'},${0.03 + R() * 0.05})`;
      ctx.beginPath(); ctx.ellipse(R() * W, R() * H, 20 + R() * 90, 10 + R() * 40, R() * 3, 0, PI * 2); ctx.fill();
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(120,118,110,${0.6 + R() * 0.3})`;
      const x = X(-2.2 + R() * 4), y = Yp(0.6 + R() * 1.2);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) ctx.lineTo(x + (R() - 0.3) * 90, y + (R() - 0.5) * 50);
      ctx.fill();
    }
    // body crease / ribs
    for (const y of [0.98, 1.0, 1.62]) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X(-2.35), Yp(y), X(2.3) - X(-2.35), 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(X(-2.35), Yp(y) - 2, X(2.3) - X(-2.35), 1); }
    // graffiti: bubble throw-ups, tags, drips
    const spray = (text, x, y, size, fill, outline, rot = 0, bubble = true) => {
      ctx.save(); ctx.translate(X(x), Yp(y)); ctx.rotate(mirror ? -rot : rot);
      if (mirror) ctx.scale(-1, 1);
      ctx.font = `${bubble ? '900' : 'italic 700'} ${size}px "Arial Black", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      if (bubble) {
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
        ctx.lineWidth = size * 0.28; ctx.strokeStyle = '#0b0b0b'; ctx.strokeText(text, 0, 0);
        ctx.shadowBlur = 0;
        ctx.lineWidth = size * 0.12; ctx.strokeStyle = outline; ctx.strokeText(text, 0, 0);
        const gr = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        gr.addColorStop(0, fill[0]); gr.addColorStop(1, fill[1]);
        ctx.fillStyle = gr; ctx.fillText(text, 0, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc((R() - 0.5) * size * text.length * 0.6, -size * 0.18, size * 0.04, 0, PI * 2); ctx.fill(); }
      } else {
        ctx.shadowColor = outline; ctx.shadowBlur = 4;
        ctx.lineWidth = 3; ctx.strokeStyle = outline; ctx.strokeText(text, 0, 0);
        ctx.fillStyle = fill[0]; ctx.fillText(text, 0, 0);
      }
      ctx.restore();
      // drips
      ctx.strokeStyle = fill[1]; ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const dx = X(x) + (R() - 0.5) * size * text.length * 0.55, dy = Yp(y) + size * 0.35;
        ctx.lineWidth = 2 + R() * 3; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx, dy + 10 + R() * 40); ctx.stroke();
      }
    };
    spray('KAOS', -0.95, 1.36, 112, ['#ff3f8e', '#8a1650'], '#ffe23a', -0.05);
    spray('NITE', 0.42, 1.62, 62, ['#40e0ff', '#1a5a9a'], '#ffffff', 0.04);
    spray('HUNTERS', -0.75, 0.84, 52, ['#f2f2ee', '#9a9a96'], '#c01818', 0.02, false);
    spray('NWO', 0.3, 0.98, 60, ['#b8ff3a', '#4a8a10'], '#151515', -0.08);
    spray('SLASH 86', -1.7, 0.78, 34, ['#ffd23a', '#9a6a10'], '#000000', 0.06, false);
    spray('X13', 1.2, 0.85, 36, ['#ffffff', '#aaaaaa'], '#000000', -0.1, false);
    // crude crown + arrows
    ctx.strokeStyle = '#ffe23a'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.beginPath();
    const cx = X(-1.55), cy = Yp(1.78);
    ctx.moveTo(cx - 40, cy + 20); ctx.lineTo(cx - 40, cy - 10); ctx.lineTo(cx - 20, cy + 6); ctx.lineTo(cx, cy - 22); ctx.lineTo(cx + 20, cy + 6); ctx.lineTo(cx + 40, cy - 10); ctx.lineTo(cx + 40, cy + 20); ctx.closePath();
    ctx.stroke();
    // rust at sills / arches, road grime at the bottom
    for (let i = 0; i < 260; i++) {
      const x = X(-2.4 + R() * 4.8), y = Yp(0.4 + Math.pow(R(), 2.2) * 0.5), r = 2 + R() * 10;
      ctx.fillStyle = `rgba(${110 + R() * 50},${45 + R() * 25},${15 + R() * 10},${0.25 + R() * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, PI * 2); ctx.fill();
    }
    const gr = ctx.createLinearGradient(0, Yp(0.35), 0, Yp(1.0));
    gr.addColorStop(0, 'rgba(28,20,12,0.85)'); gr.addColorStop(1, 'rgba(28,20,12,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, Yp(1.0), W, Yp(0.35) - Yp(1.0));
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(200,200,190,${0.08 + R() * 0.12})`; ctx.lineWidth = 1;
      const x = R() * W, y = Yp(0.5 + R() * 1.4); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + R() * 80, y + (R() - 0.5) * 8); ctx.stroke();
    }
    // rain streaks from the roof
    for (let i = 0; i < 120; i++) {
      const x = R() * W; ctx.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.08})`; ctx.fillRect(x, Yp(2.0), 1 + R() * 2, 20 + R() * 120);
    }
    // plain margins: roof row and the caps at both ends
    ctx.fillStyle = base; ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, W, Yp(2.035)); ctx.fillRect(0, 0, 10, H); ctx.fillRect(W - 10, 0, 10, H);
    ctx.globalAlpha = 1;
  });
}

/**
 * Grimy 70s/80s panel van covered in gang graffiti, with a bubble porthole, roof rack and a
 * sliding cargo door on the camera side; graffiti reads correctly from both sides. 5.2 m long incl.
 * bumpers/ladder, 2.0 m wide, roof 2.06 m (rack 2.14 m). ~32k triangles.
 *
 * opts: { seed = 3 (paint colour + graffiti layout), headlights = false }
 * Named children: `door` (sliding door; slide with `userData.setDoor(t)`, t 0..1 opens 1.15 m
 *   toward -x after popping out 6 cm), `wheelFL/FR/RL/RR` (r 0.34), `headlights`, `taillights`.
 * userData: colliders = one-way ledges on roof (y ~2.06, x -2.35..1.0) and hood (y ~1.12);
 *   lights, setLights(on), setDoor(t).
 */
export function makeGangVan(opts = {}) {
  const S = VAN, g = new THREE.Group();
  g.name = 'gangVan';
  const seed = opts.seed ?? 3;
  const [base, pname] = VAN_PAINTS[seed % VAN_PAINTS.length];
  const tex = vanCanvas(`${pname}${seed}`, base, seed * 97 + 5);
  const paint = cachedMat(`vanpaint${pname}${seed}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.25 }));
  const texB = vanCanvas(`${pname}${seed}`, base, seed * 97 + 5, true);
  const paintB = cachedMat(`vanpaintB${pname}${seed}`, () => new THREE.MeshStandardMaterial({ map: texB, roughness: 0.62, metalness: 0.25 }));
  const chrome = mat('chrome'), black = solid('#060607', 0.85, 0), trim = blackTrim();
  const uv = (x, y) => [(x + 2.45) / 4.9, y / 2.1];
  const D0 = -0.36, D1 = 0.80;
  const xs = stations(S.x0, S.x1, 0.05, [...S.archStations(), D0, D1]);
  const sD0 = idxOf(xs, D0), sD1 = idxOf(xs, D1), T = S.KL + S.KU;
  const ring0 = S.ring(0);
  let rLo = 1;
  while (ring0[rLo][1] < 0.47) rLo++;
  let rHi = rLo;
  while (ring0[rHi + 1][1] < 1.9) rHi++;
  const body = loft(xs, (x) => S.ring(x), { uv, partOf: (s, r) => (r >= T ? 'neg' : s >= sD0 && s < sD1 && r >= rLo && r < rHi ? 'door' : null) });
  g.add(mesh(body.parts.get('main'), paint, { name: 'body' }));
  g.add(mesh(body.parts.get('neg'), paintB));
  g.add(mesh(innerShell(S, false), interiorShell(), { cast: false }));
  g.add(mesh(mergeAll([capGeo(body, 0, -1), capGeo(body, body.S - 1, 1)]), paint));
  const K = new Kit(), glass = glassMat();

  // ---- sliding door
  const pv = V(xs[sD0], 1.0, S.sideZ(xs[sD0], 1.0));
  const door = new THREE.Group();
  door.name = 'door';
  door.position.copy(pv);
  const sl = slab(body, sD0, sD1, rLo, rHi, 0.05, pv);
  door.add(mesh(sl.outer, paint), mesh(sl.inner, doorInnerMat('#14120f'), { cast: false }));
  const DK = new Kit();
  const lines = [[], [], [], []];
  for (let i = 0; i < sl.cols; i++) { lines[0].push(sl.at(i, 0, 0.002)); lines[1].push(sl.at(i, sl.rows - 1, 0.002)); }
  for (let j = 0; j < sl.rows; j++) { lines[2].push(sl.at(0, j, 0.002)); lines[3].push(sl.at(sl.cols - 1, j, 0.002)); }
  for (const l of lines) DK.add(gapMat(), tubeGeo(l, 0.006, 4, false, 2));
  DK.rbox(chrome, 0.05, 0.16, 0.035, 0.01, D1 - 0.12 - pv.x, 1.05 - pv.y, 0.015);
  DK.into(door);
  g.add(door);
  // slider track on the rear quarter + cab door gaps
  K.box(gapMat(), (D0 - 0.02) - (-2.0), 0.03, 0.02, (D0 - 0.02 + -2.0) / 2, 1.3, S.w(0) + 0.002);
  for (const side of [1, -1]) {
    for (const x of [0.88, 1.72]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) { const y = lerp(0.47, Math.min(S.yt(x) - 0.03, 1.95), i / 10); pts.push(V(x, y, side * (S.sideZ(x, y) + 0.002))); }
      K.tube(gapMat(), pts, 0.005, 4);
    }
    K.rbox(chrome, 0.15, 0.035, 0.03, 0.01, 1.05, 1.08, side * 0.99);
    if (side < 0) {
      for (const x of [D0, D1]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) { const y = lerp(0.47, 1.9, i / 10); pts.push(V(x, y, -(S.sideZ(x, y) + 0.002))); }
        K.tube(gapMat(), pts, 0.005, 4);
      }
    }
  }
  // ---- glass: windshield, cab side windows, rear door windows, bubble porthole
  const sq = (u, e) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), e)), 1 / e);
  const xw0 = 1.18, xw1 = 1.74;
  const gl = [patch(xw0, xw1, 14, 14, (x, t) => { const e = 0.86 * sq((x - xw0) / (xw1 - xw0), 8), z = lerp(-e, e, t); return [x, S.topY(x, z) + 0.006, z]; }, Y)];
  for (const side of [1, -1]) {
    const lo = 1.2, hiF = (x) => Math.min(1.93, lo + (1.66 - x) * 1.25);
    gl.push(patch(0.93, 1.6, 10, 5, (x, t) => { const y = lerp(lo, Math.max(lo, hiF(x)), t); return [x, y, side * (S.sideZ(x, y) + 0.006)]; }, V(0, 0, side)));
    const loop = [];
    for (let i = 0; i <= 10; i++) { const x = lerp(0.93, 1.6, i / 10); loop.push(V(x, lo, side * (S.sideZ(x, lo) + 0.01))); }
    for (let i = 10; i >= 0; i--) { const x = lerp(0.93, 1.6, i / 10), y = Math.max(lo, hiF(x)); loop.push(V(x, y, side * (S.sideZ(x, y) + 0.01))); }
    K.tube(trim, loop, 0.012, 5, true);
    // bubble window (porthole) on the rear quarter
    const bx = -1.98, by = 1.5, bz = side * (S.w(bx) + 0.004);
    K.add(chrome, new THREE.TorusGeometry(0.2, 0.025, 8, 32), M(bx, by, bz, 0, side > 0 ? 0 : PI, 0));
    g.add(mesh(new THREE.SphereGeometry(0.19, 24, 12, 0, PI * 2, 0, PI / 2).applyMatrix4(M(bx, by, bz, side * PI / 2, 0, 0, 1, 1, 0.45)), glass, { cast: false }));
  }
  for (const z of [-0.45, 0.45]) gl.push(new THREE.PlaneGeometry(0.62, 0.42).applyMatrix4(M(S.x0 - 0.004, 1.5, z, 0, -PI / 2, 0)));
  g.add(mesh(mergeAll(gl), glass, { cast: false }));
  K.box(gapMat(), 0.01, 1.45, 0.012, S.x0 - 0.004, 1.15, 0);
  K.rbox(chrome, 0.03, 0.04, 0.14, 0.01, S.x0 - 0.01, 1.1, 0.08);
  // ---- front: grille, round sealed beams, bumpers
  const f = S.x1;
  K.box(black, 0.03, 0.3, 1.0, f + 0.006, 0.78, 0);
  for (let i = 0; i < 6; i++) K.box(chrome, 0.018, 0.016, 0.98, f + 0.02, 0.66 + i * 0.048, 0);
  K.box(chrome, 0.02, 0.33, 0.03, f + 0.02, 0.78, 0.5); K.box(chrome, 0.02, 0.33, 0.03, f + 0.02, 0.78, -0.5);
  const headMat = new THREE.MeshStandardMaterial({ color: '#cfd5da', roughness: 0.06, metalness: 0.3, emissive: '#fff0cc', emissiveIntensity: 0 });
  const head = new THREE.Group(); head.name = 'headlights';
  const HK = new Kit();
  for (const side of [1, -1]) {
    HK.add(headMat, new THREE.SphereGeometry(0.09, 18, 10), M(f + 0.01, 0.8, side * 0.7, 0, 0, 0, 0.35, 1, 1));
    K.add(chrome, new THREE.TorusGeometry(0.095, 0.018, 8, 24), M(f + 0.014, 0.8, side * 0.7, 0, PI / 2, 0));
    K.box(glow('#ff9a1a', 1.6), 0.02, 0.06, 0.14, f + 0.012, 0.62, side * 0.72);
  }
  HK.into(head, { cast: false });
  for (const dir of [1, -1]) {
    K.rbox(dir > 0 ? chrome : trim, 0.14, 0.15, 2.0, 0.03, dir * (S.x1 + 0.07), 0.47, 0);
    for (const side of [1, -1]) K.rbox(black, 0.02, 0.3, 0.26, 0.008, dir > 0 ? 1.15 : -1.97, 0.3, side * 0.77);
  }
  K.add(plateMat(sedanPlate(TX.rng(seed + 3)), 'ca70'), new THREE.PlaneGeometry(0.31, 0.155), M(S.x0 - 0.15, 0.47, 0, 0, -PI / 2, 0));
  // ---- rear lights, mirrors, roof rack, ladder, exhaust
  const tailMat = new THREE.MeshStandardMaterial({ color: '#3c0004', roughness: 0.15, emissive: '#ff1424', emissiveIntensity: 1.4 });
  const tail = new THREE.Group(); tail.name = 'taillights';
  const TK = new Kit();
  for (const side of [1, -1]) {
    TK.box(tailMat, 0.02, 0.32, 0.12, S.x0 - 0.006, 0.86, side * 0.86);
    K.box(chrome, 0.012, 0.34, 0.14, S.x0 - 0.001, 0.86, side * 0.86);
    const mz = side * 1.12;
    K.rbox(trim, 0.05, 0.3, 0.16, 0.02, 1.64, 1.62, mz);
    K.rod(chrome, V(1.66, 1.48, side * 0.98), V(1.64, 1.5, mz), 0.01, 6);
    K.rod(chrome, V(1.66, 1.76, side * 0.98), V(1.64, 1.74, mz), 0.01, 6);
    K.rod(chrome, V(-2.3, 2.12, side * 0.86), V(0.85, 2.12, side * 0.86), 0.018, 8);
    for (const x of [-2.25, -1.2, -0.1, 0.8]) K.rod(chrome, V(x, 2.06, side * 0.86), V(x, 2.12, side * 0.86), 0.014, 6);
  }
  for (const x of [-2.0, -1.0, 0.0]) K.rod(chrome, V(x, 2.12, -0.86), V(x, 2.12, 0.86), 0.014, 6);
  TK.into(tail, { cast: false });
  for (let i = 0; i < 6; i++) K.rod(chrome, V(S.x0 - 0.05, 0.75 + i * 0.22, -0.62), V(S.x0 - 0.05, 0.75 + i * 0.22, -0.32), 0.012, 6);
  for (const z of [-0.62, -0.32]) K.rod(chrome, V(S.x0 - 0.05, 0.7, z), V(S.x0 - 0.05, 2.08, z), 0.014, 6);
  K.cyl(chrome, 0.03, 0.03, 0.18, S.x0 - 0.04, 0.3, 0.6, 0, 0, PI / 2, 12);
  for (const A of S.arches) for (const side of [1, -1]) K.add(black, new THREE.CircleGeometry(A.r, 24, 0, PI), M(A.x, A.y, side * 0.55, 0, side > 0 ? 0 : PI, 0));
  K.into(g);
  const spec = { r: 0.34, w: 0.21, rim: 0.2, style: 'steel' };
  const rimM = solid('#2d2a26', 0.5, 0.6);
  for (const [n, x, z] of [['wheelFL', 1.62, -0.77], ['wheelFR', 1.62, 0.77], ['wheelRL', -1.5, -0.77], ['wheelRR', -1.5, 0.77]]) g.add(makeWheel(n, x, 0.34, z, spec, rimM));
  g.add(head, tail);

  const lights = [];
  for (const side of [1, -1]) lights.push({ pos: V(f + 1.5, 0.7, side * 0.7), color: '#fff0cc', ref: {}, intensity: 0, distance: 9, on: 7 });
  const setLights = (on) => { headMat.emissiveIntensity = on ? 4 : 0; tailMat.emissiveIntensity = on ? 2.6 : 0.35; for (const L of lights) setLightI(L, on ? L.on : 0); };
  setLights(opts.headlights ?? false);
  g.userData = {
    colliders: [
      { type: 'ledge', x0: -2.35, x1: 1.0, y: 2.06 },
      { type: 'ledge', x0: 1.85, x1: 2.4, y: avgOf((x) => S.topY(x, 0), 1.85, 2.4) },
    ],
    lights,
    setLights,
    setDoor: (t) => {
      t = clamp(t, 0, 1);
      door.position.set(pv.x - 1.15 * clamp((t - 0.12) / 0.88, 0, 1), pv.y, pv.z + 0.06 * clamp(t / 0.12, 0, 1));
    },
  };
  return g;
}

// ------------------------------------------------------------------ chopper

/**
 * Chopper-style motorcycle for biker enemies: raked springer-length fork, ape hangers, peanut
 * tank, finned V-twin, drag pipes, king & queen seat with sissy bar. 2.57 m long, 0.84 m wide,
 * grips at ~1.45 m (mirror tops 1.7 m). ~10k triangles.
 *
 * opts: { color = '#5c0b10' (tank), headlight = true }
 * Named children: `wheelF` (r 0.34, at x 1.05) and `wheelR` (r 0.33, at x -0.78): roll about z;
 *   `seat` = Object3D anchor where the rider's pelvis sits, local position (-0.26, 0.76, 0),
 *   rider faces +x; `headlight` (emissive lens).
 * userData: lights = [headlight], setLights(on). No colliders.
 */
export function makeMotorcycle(opts = {}) {
  const g = new THREE.Group();
  g.name = 'motorcycle';
  const K = new Kit();
  const chrome = mat('chrome'), frame = paintMat('#0c0c0e', { rough: 0.3, metal: 0.6, coat: 0.8 });
  const tank = paintMat(opts.color || '#5c0b10', { rough: 0.22, metal: 0.7, coat: 1, coatRough: 0.03 });
  const leather = solid('#151111', 0.5, 0), dark = solid('#2b2c30', 0.45, 0.8), black = solid('#0a0a0b', 0.6, 0.3);
  const fwd = { x: 1.05, y: 0.34 }, rwd = { x: -0.78, y: 0.33 };
  // wheels
  const wF = spokedWheel('wheelF', { r: 0.34, tire: 0.065, width: 0.095, rimR: 0.27, hubR: 0.035, hubW: 0.1, spokes: 40, tireMat: rubberMat(), rimMat: chrome, spokeMat: chrome, hubMat: chrome });
  wF.position.set(fwd.x, fwd.y, 0);
  const wR = spokedWheel('wheelR', { r: 0.33, tire: 0.11, width: 0.18, rimR: 0.21, hubR: 0.045, hubW: 0.16, spokes: 40, tireMat: rubberMat(), rimMat: chrome, spokeMat: chrome, hubMat: chrome });
  wR.position.set(rwd.x, rwd.y, 0);
  g.add(wF, wR);
  // frame: backbone, double cradle, seat stays (hardtail)
  const head = V(0.52, 0.98, 0), rake = V(0.57, -0.69, 0).normalize();
  K.tube(frame, [V(0.5, 0.97, 0), V(0.22, 0.86, 0), V(-0.2, 0.74, 0), V(-0.44, 0.66, 0)], 0.024, 8);
  for (const s of [1, -1]) {
    K.tube(frame, [V(0.5, 0.92, 0), V(0.42, 0.58, s * 0.05), V(0.32, 0.24, s * 0.085), V(-0.3, 0.2, s * 0.09), V(-0.62, 0.27, s * 0.11), V(rwd.x, rwd.y, s * 0.12)], 0.02, 8);
    K.tube(frame, [V(-0.44, 0.66, s * 0.07), V(-0.62, 0.48, s * 0.1), V(rwd.x, rwd.y + 0.03, s * 0.12)], 0.017, 8);
  }
  K.rod(frame, head.clone().addScaledVector(rake, -0.07), head.clone().addScaledVector(rake, 0.1), 0.04, 14);
  // fork + triple trees
  const top = head.clone().addScaledVector(rake, -0.09), axle = V(fwd.x, fwd.y, 0);
  for (const s of [1, -1]) {
    const a = V(top.x, top.y, s * 0.075), b = V(axle.x, axle.y, s * 0.075);
    K.rod(chrome, a, a.clone().lerp(b, 0.7), 0.021, 12);
    K.rod(chrome, a.clone().lerp(b, 0.66), b, 0.028, 12);
  }
  for (const t of [-0.02, 0.17]) {
    const c = top.clone().addScaledVector(rake, t);
    K.box(chrome, 0.07, 0.03, 0.2, c.x, c.y, 0, 0, 0, Math.atan2(rake.y, rake.x) + PI / 2);
  }
  // ape-hanger bars, grips, mirrors
  for (const s of [1, -1]) {
    const bar = [V(top.x - 0.02, top.y + 0.02, s * 0.05), V(top.x - 0.01, top.y + 0.2, s * 0.13), V(top.x - 0.03, top.y + 0.4, s * 0.22),
      V(top.x - 0.1, top.y + 0.44, s * 0.3), V(top.x - 0.22, top.y + 0.41, s * 0.36)];
    K.tube(chrome, bar, 0.013, 8);
    K.rod(black, bar[4], bar[4].clone().add(V(-0.1, -0.02, s * 0.04)), 0.019, 10);
    K.rod(chrome, bar[3], bar[3].clone().add(V(-0.02, 0.16, s * 0.04)), 0.006, 6);
    K.add(chrome, new THREE.SphereGeometry(0.04, 12, 8), M(bar[3].x - 0.02, bar[3].y + 0.17, s * 0.34 + s * 0.04, 0, 0, 0, 0.35, 1, 1));
  }
  K.rod(chrome, V(top.x - 0.02, top.y + 0.18, -0.13), V(top.x - 0.02, top.y + 0.18, 0.13), 0.011, 6);
  // headlight bucket
  const hl = V(0.66, 0.9, 0);
  K.add(chrome, lathe([[0.0, -0.06], [0.06, -0.055], [0.085, -0.02], [0.088, 0.03], [0.083, 0.045]], 24), M(hl.x, hl.y, hl.z, 0, PI / 2, 0));
  const headMat = new THREE.MeshStandardMaterial({ color: '#d6dbe0', roughness: 0.05, metalness: 0.2, emissive: '#fff0c8', emissiveIntensity: 0 });
  const headL = mesh(new THREE.SphereGeometry(0.078, 18, 10).applyMatrix4(M(0, 0, 0, 0, 0, 0, 0.3, 1, 1)), headMat, { cast: false, name: 'headlight' });
  headL.position.set(hl.x + 0.045, hl.y, 0);
  g.add(headL);
  K.rod(chrome, V(hl.x - 0.06, hl.y, 0.0), V(0.62, 0.85, 0.075), 0.01, 6);
  // peanut tank
  K.add(tank, new THREE.SphereGeometry(1, 28, 16), M(0.17, 0.925, 0, 0, 0, -0.12, 0.3, 0.115, 0.125));
  K.cyl(chrome, 0.022, 0.022, 0.02, 0.2, 1.04, 0, 0, 0, 0, 12);
  // V-twin engine
  K.cyl(dark, 0.13, 0.13, 0.2, 0.0, 0.33, 0, PI / 2, 0, 0, 24);
  K.rbox(dark, 0.3, 0.17, 0.17, 0.03, -0.28, 0.34, 0);
  for (const [cx, rz] of [[0.09, -0.4], [-0.09, 0.4]]) {
    for (let i = 0; i < 9; i++) {
      const d = 0.1 + i * 0.026, x = cx - Math.sin(rz) * d, y = 0.42 + Math.cos(rz) * d;
      K.cyl(i % 2 ? dark : chrome, i % 2 ? 0.058 : 0.075, i % 2 ? 0.058 : 0.075, 0.016, x, y, 0, 0, 0, rz, 18);
    }
    const hx = cx - Math.sin(rz) * 0.36, hy = 0.42 + Math.cos(rz) * 0.36;
    K.rbox(chrome, 0.15, 0.06, 0.11, 0.02, hx, hy, 0, 0, 0, rz);
  }
  K.cyl(chrome, 0.1, 0.1, 0.05, 0.0, 0.6, 0.13, PI / 2, 0, 0, 24);
  K.add(chrome, new THREE.SphereGeometry(1, 20, 10), M(-0.16, 0.32, -0.12, 0, 0, 0, 0.26, 0.15, 0.04));
  // drag pipes on the camera side
  K.tube(chrome, [V(0.2, 0.62, 0.05), V(0.28, 0.48, 0.14), V(0.14, 0.3, 0.18), V(-0.4, 0.3, 0.18), V(-1.12, 0.33, 0.19)], 0.025, 10);
  K.tube(chrome, [V(-0.2, 0.66, 0.05), V(-0.24, 0.52, 0.15), V(-0.36, 0.42, 0.2), V(-0.7, 0.42, 0.21), V(-1.12, 0.44, 0.21)], 0.025, 10);
  // oil tank, battery, seat, sissy bar, fender, taillight, pegs
  K.cyl(black, 0.08, 0.08, 0.16, -0.48, 0.47, 0, PI / 2, 0, 0, 18);
  K.rbox(leather, 0.42, 0.075, 0.3, 0.035, -0.22, 0.71, 0, 0, 0, 0.05);
  K.rbox(leather, 0.28, 0.09, 0.26, 0.04, -0.56, 0.8, 0, 0, 0, 0.22);
  K.tube(chrome, [V(-0.66, 0.62, 0.11), V(-0.74, 1.0, 0.1), V(-0.79, 1.28, 0.07), V(-0.8, 1.33, 0), V(-0.79, 1.28, -0.07), V(-0.74, 1.0, -0.1), V(-0.66, 0.62, -0.11)], 0.012, 8);
  const fender = new THREE.CylinderGeometry(0.4, 0.4, 0.21, 28, 1, true, PI * 0.82, PI * 0.78);
  fender.rotateX(PI / 2);
  K.add(solid('#0b0b0d', 0.3, 0.5, { side: THREE.DoubleSide }), fender, M(rwd.x, rwd.y, 0));
  const tailMat = new THREE.MeshStandardMaterial({ color: '#3c0004', emissive: '#ff1424', emissiveIntensity: 2.2, roughness: 0.2 });
  K.add(tailMat, new THREE.BoxGeometry(0.03, 0.05, 0.08), M(-1.17, 0.5, 0));
  K.add(plateMat('BIKR 13', 'ca70'), new THREE.PlaneGeometry(0.18, 0.09), M(-1.0, 0.36, 0.17));
  for (const s of [1, -1]) {
    K.rod(chrome, V(0.38, 0.36, s * 0.1), V(0.42, 0.37, s * 0.26), 0.012, 6);
    K.rod(black, V(0.42, 0.37, s * 0.22), V(0.42, 0.37, s * 0.3), 0.02, 8);
  }
  K.into(g);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(-0.26, 0.76, 0);
  g.add(seat);
  const lights = [{ pos: V(1.9, 0.6, 0), color: '#fff0c8', ref: {}, intensity: 0, distance: 8, on: 5 }];
  const setLights = (on) => { headMat.emissiveIntensity = on ? 4 : 0; tailMat.emissiveIntensity = on ? 2.2 : 0.3; setLightI(lights[0], on ? lights[0].on : 0); };
  setLights(opts.headlight ?? true);
  g.userData = { lights, setLights };
  return g;
}

// ------------------------------------------------------------------ pram

/**
 * Old-fashioned coach-built baby pram (the original game's rolling hazard): lacquered boat body
 * on C-springs, folding leatherette hood with chrome bows, big spoked wheels, porcelain push bar.
 * 1.28 m long (incl. handle), 0.65 m wide, 1.1 m tall. Rolls toward +x; handle at -x. ~14k triangles.
 *
 * opts: { color = '#141a2b' (body lacquer), blanket = '#6b2333' }
 * Named children: `wheels` group with children `wheel0` (rear L), `wheel1` (rear R), `wheel2`
 *   (front L), `wheel3` (front R); each has userData.radius.
 * userData: rollBy(dx) spins every wheel for a horizontal move of dx metres. No colliders.
 */
export function makePram(opts = {}) {
  const g = new THREE.Group();
  g.name = 'pram';
  const lacquer = paintMat(opts.color || '#141a2b', { rough: 0.25, metal: 0.3, coat: 1, coatRough: 0.04 });
  const cream = solid('#d6cab0', 0.85, 0);
  const chrome = mat('chrome'), hoodM = solid('#0e0e10', 0.5, 0.05, { side: THREE.DoubleSide });
  const K = new Kit();
  // boat-shaped body: open U sections lofted along x
  const L = 0.43;
  const bw = (x) => 0.225 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / L, 3)), 1 / 3) + 0.012;
  const bb = (x) => 0.5 + 0.13 * Math.pow(Math.abs(x) / L, 2.2);
  const br = (x) => 0.84 + 0.05 * Math.pow(Math.abs(x) / L, 4);
  const uRing = (shrink, lift) => (x) => {
    const w = bw(x) * shrink, yb = bb(x) + lift, yr = br(x);
    const ym = yb + (yr - yb) * 0.45;
    const lo = resample(quadrant(w, ym - yb, 2.6, ym, false).reverse(), 8);
    const right = lo.concat([[w * 1.02, lerp(ym, yr, 0.5)], [w * 1.04, yr]]);
    const ring = [];
    for (let j = right.length - 1; j >= 1; j--) ring.push([-right[j][0], right[j][1]]);
    return ring.concat(right);
  };
  const pxs = stations(-L, L, 0.02);
  const outer = loft(pxs, uRing(1, 0), { closed: false });
  g.add(mesh(outer.parts.get('main'), lacquer, { name: 'body' }));
  const innerL = loft(pxs, uRing(0.92, 0.025), { closed: false });
  g.add(mesh(innerL.parts.get('main'), solid('#cfc2a6', 0.9, 0, { side: THREE.BackSide }), { cast: false }));
  const rim = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * PI * 2, x = Math.cos(a) * L * 0.995, z = Math.sin(a) >= 0 ? 1 : -1; rim.push(V(x, br(x) + 0.004, z * bw(x) * 1.0)); }
  K.tube(chrome, rim, 0.012, 6, true);
  for (const s of [1, -1]) {
    const stripe = [];
    for (let i = 0; i <= 24; i++) { const x = lerp(-L * 0.86, L * 0.86, i / 24), y = bb(x) + (br(x) - bb(x)) * 0.62; stripe.push(V(x, y, s * (bw(x) * 1.01 + 0.004))); }
    K.tube(cream, stripe, 0.0045, 4);
  }
  // blanket over the front half
  K.add(solid(opts.blanket || '#6b2333', 0.95, 0), patch(-0.02, L - 0.04, 12, 10, (x, t) => {
    const e = bw(x) * 0.98, z = lerp(-e, e, t);
    return [x, br(x) - 0.015 + 0.04 * Math.sin(t * PI) * Math.min(1, (L - x) * 6), z];
  }, Y));
  // folding hood with chrome bows
  const hc = V(-0.05, br(-0.05) - 0.01, 0), rx = 0.37, ry = 0.28, rz = bw(-0.05) + 0.014;
  const hood = new THREE.SphereGeometry(1, 24, 12, -PI / 2, PI, 0, PI / 2);
  g.add(mesh(hood.applyMatrix4(M(hc.x, hc.y, hc.z, 0, 0, 0, rx, ry, rz)), hoodM, { name: 'hood' }));
  for (const al of [0.12, 0.55, 0.95, 1.3]) {
    const R = 1 / Math.sqrt((Math.sin(al) / rx) ** 2 + (Math.cos(al) / ry) ** 2) + 0.006;
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = (i / 16) * PI; pts.push(V(hc.x - Math.sin(al) * R * Math.sin(t), hc.y + Math.cos(al) * R * Math.sin(t), (rz + 0.006) * Math.cos(t))); }
    K.tube(al < 0.2 ? chrome : hoodM, pts, al < 0.2 ? 0.009 : 0.006, 5);
  }
  for (const s of [1, -1]) {
    K.cyl(chrome, 0.022, 0.022, 0.012, hc.x, hc.y, s * (rz + 0.008), PI / 2, 0, 0, 12);
    K.rod(chrome, V(hc.x, hc.y, s * (rz + 0.01)), V(hc.x - 0.16, hc.y - 0.05, s * (rz + 0.01)), 0.006, 5);
  }
  // chassis, C-springs, axles
  const track = 0.3, rW = { x: -0.29, r: 0.3 }, fW = { x: 0.31, r: 0.24 };
  for (const s of [1, -1]) {
    K.tube(chrome, [V(rW.x - 0.08, rW.r + 0.06, s * 0.17), V(0, 0.36, s * 0.17), V(fW.x + 0.06, fW.r + 0.08, s * 0.17)], 0.011, 6);
    for (const d of [1, -1]) {
      const ex = d > 0 ? fW.x : rW.x, ey = d > 0 ? fW.r + 0.08 : rW.r + 0.06;
      K.tube(lacquer, [V(ex, ey, s * 0.17), V(ex + d * 0.12, ey + 0.02, s * 0.17), V(ex + d * 0.17, ey + 0.12, s * 0.16), V(ex + d * 0.13, ey + 0.22, s * 0.15), V(d * (L - 0.07), 0.62, s * 0.13)], 0.011, 6);
    }
  }
  for (const W of [rW, fW]) K.rod(chrome, V(W.x, W.r, -track - 0.02), V(W.x, W.r, track + 0.02), 0.009, 8);
  // push handle
  for (const s of [1, -1]) K.tube(chrome, [V(-0.33, 0.46, s * 0.17), V(-0.48, 0.66, s * 0.18), V(-0.62, 0.9, s * 0.2), V(-0.7, 1.07, s * 0.21)], 0.011, 6);
  K.rod(solid('#ece6d8', 0.2, 0), V(-0.705, 1.08, -0.25), V(-0.705, 1.08, 0.25), 0.02, 12);
  K.into(g);
  // wheels
  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  const tireM = solid('#d9d4c6', 0.7, 0), hubM = chrome;
  [[rW, -1], [rW, 1], [fW, -1], [fW, 1]].forEach(([W, s], i) => {
    const w = spokedWheel(`wheel${i}`, { r: W.r, tire: 0.022, width: 0.03, rimR: W.r - 0.026, hubR: 0.02, hubW: 0.05, spokes: 18, spokeR: 0.0035, tireMat: tireM, rimMat: chrome, spokeMat: chrome, hubMat: hubM });
    w.position.set(W.x, W.r, s * track);
    w.userData.radius = W.r;
    wheels.add(w);
  });
  g.add(wheels);
  g.userData = {
    rollBy: (dx) => { for (const w of wheels.children) w.rotation.z -= dx / w.userData.radius; },
  };
  return g;
}

function glow(color, intensity) {
  return cachedMat(`vglow${color}${intensity}`, () => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
}
