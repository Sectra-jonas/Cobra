// Parametric head: a loft of anatomical cross-sections (cranium dome, face, U-shaped mandible
// closing under the chin) with sculpted features (brow, eye sockets, nose, lips, chin,
// cheekbones, jaw angle), ears, eyes with lids, and a
// painted face atlas (skin variation, stubble, lips, brows, eye make-up, scalp, wrinkles)
// generated per texel from the 3D surface position so features never smear.
//
// Head space: origin at the skull centre, +z = face, +x = character's left, eyes at EYE_Y.
// Atlas layout (v up): head [0.25, 1], neck strip [0.07, 0.24], ramps [0, 0.06]
// (lid ramp u 0-0.25, ear u 0.25-0.5, mouth u 0.5-0.75, plain skin u 0.75-1).
import * as THREE from 'three';
import * as TX from '../core/textures.js';
import { clamp, lerp, sstep, gauss, curve, gridGeo, tubeGeo, mergeAll, plain, smoothCoincident } from './anatomy.js';

export const EYE_Y = 0.012;
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/// Head cross-sections below the forehead (male base), rows:
// y, halfWidth, front z, back z, front taper (narrows the face/jaw towards the front), front exponent.
// Above y = 0.05 the cranium is an analytic dome. Below the mouth the back of each ring moves
// forward along the jaw line, so the lowest rings are the U-shaped mandible closing under the chin.
const HEAD = [
  [0.05, 0.0765, 0.0880, -0.1040, 0.10, 2.3],
  [0.03, 0.0775, 0.0925, -0.1060, 0.12, 2.3],
  [0.012, 0.0775, 0.0872, -0.1060, 0.16, 2.35],
  [-0.01, 0.0765, 0.0866, -0.1040, 0.20, 2.35],
  [-0.03, 0.0735, 0.0880, -0.0980, 0.26, 2.3],
  [-0.05, 0.0665, 0.0905, -0.0820, 0.32, 2.25],
  [-0.066, 0.0610, 0.0915, -0.0480, 0.36, 2.2],
  [-0.082, 0.0535, 0.0885, -0.0040, 0.36, 2.15],
  [-0.097, 0.0445, 0.0880, 0.0280, 0.28, 2.1],
  [-0.109, 0.0375, 0.0865, 0.0480, 0.2, 2.1],
  [-0.118, 0.0315, 0.0810, 0.0590, 0.12, 2.15],
  [-0.124, 0.0235, 0.0730, 0.0610, 0.08, 2.2],
  [-0.1275, 0.0125, 0.0660, 0.0590, 0.05, 2.2],
  [-0.1292, 0.0, 0.0615, 0.0605, 0.05, 2.2],
];
const Y_TOP = 0.127, Y_MID = 0.05, Y_BOT = -0.1292;
// Nose dorsum height above the face plane: [y, height, halfWidth]
const NOSE = [
  [0.028, 0.0, 0.007], [0.016, 0.003, 0.0072], [0.0, 0.0085, 0.0078], [-0.016, 0.0148, 0.0086],
  [-0.027, 0.0198, 0.0094], [-0.034, 0.0178, 0.011], [-0.04, 0.0105, 0.0138], [-0.046, 0.0025, 0.0118], [-0.052, 0.0, 0.01],
];

export class HeadShape {
  constructor(o = {}) {
    this.o = {
      female: false, jaw: 1, chin: 1, nose: 1, brow: 1, cheek: 1, lips: 1, gaunt: 0, width: 1, age: 0,
      cleft: 0, eyes: true, ...o,
    };
    this.prof = curve(HEAD);
    this.noseP = curve(NOSE);
    // row parameter t: [0, T_CAP] = crown cap by angle, [T_CAP, 1] = y from Y_MID to Y_BOT, denser on the face
    this.T_CAP = 0.24;
    const N = 400, cum = [0];
    const dens = (y) => 1 + 1.6 * gauss(y + 0.03, 0.055) + 1.2 * gauss(y - Y_BOT, 0.006);
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + dens(Y_MID + (Y_BOT - Y_MID) * (i - 0.5) / N));
    this._cum = cum.map((c) => c / cum[N]);
  }

  thetaOf(s) { const q = 2 * s - 1; return Math.PI * (0.42 * q + 0.58 * q * q * q); }

  // row param -> [y, cap factor]
  yOf(t) {
    if (t <= this.T_CAP) {
      const al = (t / this.T_CAP) * Math.PI / 2; // 0 at the crown pole
      return Y_MID + (Y_TOP - Y_MID) * Math.cos(al);
    }
    const tt = (t - this.T_CAP) / (1 - this.T_CAP);
    const c = this._cum, N = c.length - 1;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < tt) lo = m; else hi = m; }
    const f = (tt - c[lo]) / ((c[hi] - c[lo]) || 1);
    return Y_MID + (Y_BOT - Y_MID) * (lo + f) / N;
  }

  // cross-section parameters at height y (with character variation): [W, zFront, zBack, taper, exp]
  section(y) {
    const P = this.o, F = P.female;
    let W, zf, zb, taper, ef;
    if (y > Y_MID) {
      const u = clamp((y - Y_MID) / (Y_TOP - Y_MID), 0, 1);
      const f = Math.sqrt(Math.max(0, 1 - u * u));
      W = 0.0765 * Math.pow(f, 0.85); zf = 0.088 * Math.pow(f, F ? 1.1 : 1.25); zb = -0.104 * Math.pow(f, 0.8);
      const zc = -0.012 * u * u;
      zf += zc * (1 - f); zb += zc * (1 - f);
      taper = 0.1 * f; ef = 2.3;
    } else {
      [W, zf, zb, taper, ef] = this.prof(F ? this.fy(y) : y);
      const jawZone = sstep(-0.035, -0.085, y);
      W *= lerp(1, (F ? 0.93 : 1) * P.jaw, jawZone);
      taper += (F ? 0.02 : 0) * jawZone;
      zf *= lerp(1, F ? 0.985 : 1, sstep(-0.09, -0.11, y));
    }
    const k = (F ? 0.97 : 1) * P.width;
    return [W * k, zf * (F ? 0.97 : 1), zb * (F ? 0.97 : 1), taper, ef];
  }

  // female lower face is ~6% shorter: remap heights below the mouth onto the base profile
  fy(y) { return y < 0 ? y / 0.92 : y; }

  // loft surface at azimuth th (0 = front) and height y, before features
  base(th, y, o) {
    const [W, zf, zb, taper, ef] = this.section(y);
    const zc = (zf + zb) / 2, Fd = zf - zc, Bd = zc - zb;
    const s = Math.sin(th), c = Math.cos(th);
    const e = c >= 0 ? ef : 2.05;
    o[0] = W * spow(s, 2 / e) * (1 - taper * Math.pow(Math.max(0, c), 1.6));
    o[1] = y;
    o[2] = zc + (c >= 0 ? Fd : Bd) * spow(c, 2 / e);
    return o;
  }

  // full surface: loft + sculpted features
  surf(th, y, o = [0, 0, 0]) {
    this.base(th, y, o);
    const P = this.o, F = P.female;
    let x = o[0], z = o[2];
    const X = x, Y = F ? this.fy(y) : y, ax = Math.abs(x);
    const front = sstep(0.025, 0.06, z);
    let dz = 0, dx = 0;
    if (front > 0) {
      // forehead fullness & brow ridge
      dz += 0.002 * gauss(Y - 0.065, 0.025) * gauss(X, 0.05);
      dz += (F ? 0.0025 : 0.0062) * P.brow * gauss(Y - 0.034, 0.0075) * gauss(ax - 0.028, 0.02);
      dz += 0.0018 * P.brow * gauss(Y - 0.03, 0.008) * gauss(X, 0.012);
      // eye sockets, under-eye, nasion
      const sock = P.eyes ? (F ? 0.0105 : 0.012) : 0.0065;
      if (F) { // fuller cheeks, softer features
        const ch = gauss(ax - 0.037, 0.016) * gauss(Y + 0.02, 0.016);
        dz += 0.0045 * ch; dx += Math.sign(X) * 0.002 * ch;
      }
      dz -= sock * gauss(Y - EYE_Y + 0.001, 0.0095) * gauss(ax - 0.0315, 0.0135);
      dz -= 0.003 * gauss(Y - (EYE_Y - 0.012), 0.008) * gauss(ax - 0.03, 0.012);
      dz -= 0.002 * gauss(Y - 0.019, 0.006) * gauss(X, 0.01);
      // nose
      if (Y < 0.03 && Y > -0.056) {
        const nz = this.noseP(Y);
        const nk = P.nose * (F ? 0.8 : 1);
        dz += nz[0] * nk * Math.exp(-(X * X) / (nz[1] * nz[1] * nk * nk));
        dz += 0.0028 * nk * gauss(Math.hypot(X, Y + 0.03), 0.0066);
        const alae = gauss(ax - 0.0138 * nk, 0.0052) * gauss(Y + 0.0395, 0.0055);
        dz += 0.0075 * nk * alae; dx += Math.sign(X) * 0.002 * alae;
        dz -= 0.003 * gauss(ax - 0.0085, 0.003) * gauss(Y + 0.0445, 0.0026);
        dz -= 0.0035 * gauss(ax - 0.021 * nk, 0.004) * gauss(Y + 0.038, 0.009);
      }
      // mouth region
      if (Y < -0.04 && Y > -0.095) {
        const L = P.lips * (F ? 1.12 : 1);
        dz += 0.0013 * gauss(ax - 0.0048, 0.0028) * gauss(Y + 0.052, 0.006);
        dz += 0.005 * L * gauss(X, 0.019) * gauss(Y + 0.0598, 0.0045);
        dz += 0.0052 * L * gauss(X, 0.016) * gauss(Y + 0.0718, 0.005);
        dz -= 0.002 * gauss(Y + 0.0655, 0.0017) * gauss(X, 0.022);
        dz -= 0.004 * gauss(ax - 0.026, 0.0055) * gauss(Y + 0.066, 0.008);
        dz -= 0.003 * gauss(Y + 0.084, 0.0055) * gauss(X, 0.019);
      }
      // chin
      dz += (F ? 0.0065 : 0.0085) * P.chin * gauss(Y + 0.103, 0.013) * gauss(X, F ? 0.019 : 0.022);
      dz -= 0.0012 * P.cleft * gauss(X, 0.0022) * gauss(Y + 0.104, 0.008);
      // cheeks, nasolabial fold
      dz -= (0.0015 + P.gaunt * 0.005) * gauss(ax - 0.045, 0.014) * gauss(Y + 0.046, 0.018);
      const nlx = lerp(0.021, 0.034, clamp((-0.038 - Y) / 0.034, 0, 1));
      dz -= (0.0014 + P.age * 0.002) * gauss(ax - nlx, 0.0035) * sstep(-0.034, -0.042, Y) * sstep(-0.078, -0.068, Y);
      dz += 0.0012 * gauss(ax - nlx - 0.006, 0.006) * sstep(-0.034, -0.045, Y) * sstep(-0.08, -0.068, Y);
    }
    // cheekbones (zygomatic arch), jaw angle, temples
    const cbk = gauss(ax - 0.056, 0.016) * gauss(Y + 0.004, 0.015) * P.cheek * sstep(-0.01, 0.04, z);
    dz += 0.004 * cbk; dx += Math.sign(X) * 0.004 * cbk;
    if (!F) dx += Math.sign(X) * 0.004 * P.jaw * gauss(Y + 0.078, 0.016) * gauss(z + 0.004, 0.025);
    dx -= Math.sign(X) * 0.0028 * gauss(Y - 0.042, 0.02) * gauss(z - 0.045, 0.025);
    if (z < 0) z -= 0.005 * gauss(Y - 0.0, 0.035) * gauss(X, 0.05); // occipital bun
    o[0] = x + dx;
    o[2] = z + dz * front + dz * (1 - front) * sstep(0.0, 0.025, z) * 0.0;
    return o;
  }

  // grid (s,t) -> point
  at(s, t, o) { return this.surf(this.thetaOf(s), this.yOf(t), o); }

  // surface point in the direction (th = azimuth, ph = polar angle from +y)
  point(th, ph, o = [0, 0, 0]) {
    const cp = Math.cos(ph);
    let y = clamp(cp * 0.11, Y_BOT, Y_TOP), a = th;
    for (let it = 0; it < 6; it++) {
      this.surf(a, y, o);
      const r = Math.hypot(o[0], o[1], o[2]) || 1;
      y = clamp(y + (cp - o[1] / r) * r * 0.9, Y_BOT, Y_TOP);
      const th2 = Math.atan2(o[0], o[2]);
      let d = th - th2;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a += d * 0.9;
    }
    return this.surf(a, y, o);
  }

  /** Head mesh: returns geometry (head space) with UVs in the atlas head region. */
  geometry(nu = 72, nv = 56) {
    return gridGeo(nu, nv, (i, j, o) => {
      const s = i / nu, t = j / nv;
      this.at(s, t, o.p);
      o.uv = [s, 0.25 + 0.75 * (1 - t)];
      o.w = [0, 1];
    });
  }

  // sampled position lookup for painting (s, t in [0,1])
  sampler(n = 160) {
    const P = new Float32Array((n + 1) * (n + 1) * 3), o = [0, 0, 0];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      this.at(i / n, j / n, o);
      const k = (j * (n + 1) + i) * 3;
      P[k] = o[0]; P[k + 1] = o[1]; P[k + 2] = o[2];
    }
    return (s, t, out) => {
      const fx = s * n, fy = t * n;
      const i = Math.min(n - 1, fx | 0), j = Math.min(n - 1, fy | 0);
      const u = fx - i, v = fy - j;
      const k00 = (j * (n + 1) + i) * 3, k10 = k00 + 3, k01 = k00 + (n + 1) * 3, k11 = k01 + 3;
      for (let q = 0; q < 3; q++) out[q] = (P[k00 + q] * (1 - u) + P[k10 + q] * u) * (1 - v) + (P[k01 + q] * (1 - u) + P[k11 + q] * u) * v;
      return out;
    };
  }

  // radial distance of the surface in the direction of p (for hair collision)
  radiusToward(x, y, z) {
    const r = Math.hypot(x, y, z) || 1;
    const q = this.point(Math.atan2(x, z), Math.acos(clamp(y / r, -1, 1)), [0, 0, 0]);
    return Math.hypot(q[0], q[1], q[2]);
  }
}

// ------------------------------------------------------------------- hairlines

// Hairline height (head space y) as a function of azimuth; hair grows above it.
const HAIRLINE = {
  default: [[0, 0.088], [0.42, 0.083], [0.7, 0.07], [0.92, 0.035], [1.02, -0.02], [1.14, -0.028], [1.24, 0.032], [1.55, 0.04], [1.8, -0.01], [2.2, -0.062], [2.7, -0.08], [3.15, -0.084]],
  receding: [[0, 0.09], [0.36, 0.08], [0.55, 0.074], [0.75, 0.066], [0.92, 0.035], [1.02, -0.018], [1.14, -0.026], [1.24, 0.032], [1.55, 0.04], [1.8, -0.01], [2.2, -0.06], [2.7, -0.078], [3.15, -0.082]],
  female: [[0, 0.084], [0.45, 0.08], [0.75, 0.064], [0.95, 0.03], [1.05, 0.0], [1.15, -0.01], [1.24, 0.03], [1.55, 0.035], [1.8, -0.02], [2.2, -0.065], [2.7, -0.085], [3.15, -0.09]],
};
export function hairlineFn(kind = 'default') {
  const c = curve(HAIRLINE[kind] || HAIRLINE.default);
  return (th) => c(Math.abs(th))[0];
}

// ------------------------------------------------------------------- face atlas

const hexRGB = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b].map((v) => Math.pow(v, 1 / 2.2)); }; // sRGB 0..1
function hash3(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const faceCache = new Map();

// Tileable value-noise table (fast bilinear lookups for per-texel painting).
let NT = null;
function noiseTab() {
  if (!NT) {
    NT = new Float32Array(256 * 256);
    const r = TX.rng(9137);
    for (let i = 0; i < NT.length; i++) NT[i] = r();
  }
  return NT;
}
// value noise, x/y in lattice cells (wraps every 256 cells)
function tn(x, y, off = 0) {
  const T = NT;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = (xi + off) & 255, y0 = (yi + off * 7) & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
  const a = T[y0 * 256 + x0], b = T[y0 * 256 + x1], c = T[y1 * 256 + x0], d = T[y1 * 256 + x1];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Paints the face atlas. f: { skin, hair, brows, lips, stubble, female, age, makeup,
 * eyeshadow, blush, sunglasses, hairline, scalp: 'hair'|'shaved'|'bald'|'none', size, seed, key }
 */
export function paintFace(shape, f) {
  const key = f.key ? `${f.key}:${f.size}` : null;
  if (key && faceCache.has(key)) return faceCache.get(key);
  noiseTab();
  const N = f.size || 512;
  const W = N, H = N;
  const col = new Uint8ClampedArray(W * H * 4);
  const rough = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  const skin = hexRGB(f.skin || '#c58c6a');
  const hairC = hexRGB(f.hair || '#1b1410');
  const browC = hexRGB(f.brows || f.hair || '#2a1d14');
  const lipC = f.lips ? hexRGB(f.lips) : [skin[0] * 0.82, skin[1] * 0.55, skin[2] * 0.55];
  const stubC = [hairC[0] * 0.4 + 0.12, hairC[1] * 0.4 + 0.13, hairC[2] * 0.4 + 0.17];
  const shadowC = f.eyeshadow ? hexRGB(f.eyeshadow) : null;
  const blushC = [0.86, 0.42, 0.42];
  const redC = [skin[0] * 1.06, skin[1] * 0.8, skin[2] * 0.78];
  const eyeC = [skin[0] * 0.78, skin[1] * 0.7, skin[2] * 0.76];
  const sample = shape.sampler(N >= 1024 ? 200 : 140);
  const hl = f.hairline;
  const seed = f.seed || 1;
  const p = [0, 0, 0];
  const sc = N / 512; // pixel scale for grain
  const mix3 = (a, b, t) => { if (t <= 0) return; a[0] += (b[0] - a[0]) * t; a[1] += (b[1] - a[1]) * t; a[2] += (b[2] - a[2]) * t; };
  const c = [0, 0, 0];
  const female = !!f.female;
  const stub = f.stubble ? 1 : 0;
  const age = f.age || 0;
  for (let r = 0; r < H; r++) {
    const v = 1 - (r + 0.5) / H;
    for (let q = 0; q < W; q++) {
      const u = (q + 0.5) / W;
      const i = r * W + q, j = i * 4;
      let h = 0, ro = 0.55;
      c[0] = skin[0]; c[1] = skin[1]; c[2] = skin[2];
      const n1 = tn(q / (6 * sc), r / (6 * sc), seed);
      const n2 = tn(q / (1.6 * sc), r / (1.6 * sc), seed + 3);
      const grain = hash3(q, r, seed);
      if (v >= 0.25) {
        const t = 1 - (v - 0.25) / 0.75;
        sample(u, t, p);
        const x = p[0], y = female && p[1] < 0 ? p[1] / 0.92 : p[1], z = p[2];
        const ax = Math.abs(x);
        const th = Math.atan2(x, z);
        const fr = sstep(0.02, 0.06, z);
        // tone variation
        const lf = tn(u * 16, t * 16, seed + 9) * 0.6 + tn(u * 40, t * 40, seed + 19) * 0.4 - 0.5;
        c[0] *= 1 + lf * 0.09; c[1] *= 1 + lf * 0.08; c[2] *= 1 + lf * 0.07;
        if (z > -0.01 && y > -0.135 && y < 0.07) {
          // redness: cheeks, nose tip, around the nostrils
          let red = (female ? 0.08 : 0.14) * gauss(Math.hypot(ax - 0.044, y + 0.016), 0.018) * fr;
          if (ax < 0.03 && y < -0.015 && y > -0.055) red += 0.22 * gauss(Math.hypot(x, y + 0.032), 0.011) + 0.14 * gauss(ax - 0.014, 0.006) * gauss(y + 0.04, 0.006);
          mix3(c, redC, Math.min(1, red));
          if (female && f.blush) mix3(c, blushC, 0.13 * gauss(Math.hypot(ax - 0.042, y + 0.018), 0.014) * fr);
          if (Math.abs(y - EYE_Y) < 0.035 && ax < 0.07) {
            // darker, cooler eye surrounds; lid crease
            mix3(c, eyeC, 0.35 * gauss(ax - 0.032, 0.016) * gauss(y - EYE_Y, 0.011) * fr);
            mix3(c, eyeC, 0.25 * gauss(ax - 0.033, 0.012) * gauss(y - (EYE_Y - 0.011), 0.005) * fr);
            if (shadowC) mix3(c, shadowC, 0.55 * gauss(ax - 0.034, 0.014) * gauss(y - (EYE_Y + 0.012), 0.007) * fr);
            // brows: directional hair strokes
            const arch = female ? 0.0065 : 0.0035;
            const by = 0.0345 + arch * Math.sin(clamp((ax - 0.012) / 0.046, 0, 1) * Math.PI * 0.85) - (female ? 0 : 0.01) * (ax - 0.03);
            if (Math.abs(y - by) < 0.008 && ax > 0.006 && ax < 0.064) {
              const thick = lerp(female ? 0.0042 : 0.0064, female ? 0.0018 : 0.0034, clamp((ax - 0.012) / 0.045, 0, 1));
              const span = sstep(0.009, 0.014, ax) * sstep(0.062, 0.054, ax);
              const bmask = span * sstep(thick, thick * 0.55, Math.abs(y - by)) * fr;
              if (bmask > 0.001) {
                const ang = lerp(1.0, 0.15, clamp((ax - 0.012) / 0.02, 0, 1));
                const su = ax * Math.cos(ang) + (y - by) * Math.sin(ang), sv = -ax * Math.sin(ang) + (y - by) * Math.cos(ang);
                const stroke = tn(su * 260, sv * 2600, seed + 11);
                const a = bmask * clamp(0.3 + stroke * 1.0, 0, 1);
                mix3(c, browC, a * 0.94);
                h += a * 0.4;
              }
            }
            // lash lines (read even at distance)
            if (!f.sunglasses) {
              const lx = ax - 0.0315;
              const e = Math.sqrt(Math.max(0, 1 - (lx / 0.0145) ** 2));
              const upper = EYE_Y + 0.0062 * e + 0.001;
              const lower = EYE_Y - 0.0052 * e;
              const inX = sstep(0.0155, 0.012, Math.abs(lx + 0.001));
              mix3(c, [0.04, 0.03, 0.03], clamp(inX * gauss(y - upper, female ? 0.0012 : 0.0008) * fr * (female ? 1.1 : 0.8), 0, 1));
              mix3(c, [skin[0] * 0.55, skin[1] * 0.45, skin[2] * 0.45], inX * gauss(y - lower, 0.0007) * fr * 0.4);
              if (female && f.makeup) mix3(c, [0.03, 0.02, 0.03], 0.9 * gauss(y - (upper + (lx - 0.012) * 0.25), 0.0009) * sstep(0.008, 0.013, lx) * sstep(0.022, 0.016, lx));
            }
          }
          let lipM = 0;
          if (y < -0.04 && y > -0.085 && ax < 0.04) {
            // lips: cupid's bow upper lip, fuller lower lip
            const bow = 0.0012 * gauss(ax - 0.0065, 0.004) - 0.0006 * gauss(x, 0.0025);
            const upTop = -0.0572 - 0.0045 * sstep(0.008, 0.026, ax) + bow;
            const loBot = -0.0752 + 0.006 * sstep(0.0, 0.022, ax) ** 2;
            const lipW = female ? 0.024 : 0.0235;
            const inLipX = sstep(lipW + 0.003, lipW - 0.002, ax);
            lipM = inLipX * sstep(loBot - 0.0012, loBot + 0.0012, y) * sstep(upTop + 0.0012, upTop - 0.0012, y) * fr;
            mix3(c, lipC, lipM * (female ? 0.92 : 0.5));
            mix3(c, [0.12, 0.05, 0.05], 0.85 * gauss(y + 0.0655 + 0.002 * sstep(0.012, 0.026, ax), 0.0011) * sstep(lipW + 0.004, lipW - 0.006, ax) * fr);
            ro = lerp(ro, female ? 0.25 : 0.4, lipM);
            h += lipM * 0.3 * (tn(x * 2600, y * 300, seed) - 0.5);
            // nostrils & mouth corners
            mix3(c, [0.3, 0.12, 0.1], clamp(1.1 * gauss(ax - 0.0085, 0.0026) * gauss(y + 0.0445, 0.002) * fr, 0, 0.8));
            mix3(c, [skin[0] * 0.6, skin[1] * 0.45, skin[2] * 0.45], 0.5 * gauss(ax - 0.026, 0.0035) * gauss(y + 0.0665, 0.004) * fr);
          }
          if (y < -0.03 && y > -0.085) {
            const nlx = lerp(0.021, 0.034, clamp((-0.038 - y) / 0.034, 0, 1));
            const fold = gauss(ax - nlx, 0.0025) * sstep(-0.034, -0.042, y) * sstep(-0.078, -0.068, y) * fr;
            mix3(c, [skin[0] * 0.75, skin[1] * 0.62, skin[2] * 0.6], fold * (0.25 + age * 0.4));
            h -= fold * (0.4 + age);
          }
          // stubble / beard shadow
          if (stub && y < 0.04) {
            const cheekLine = lerp(-0.03, -0.012, sstep(0.03, 0.062, ax)) - 0.012 * gauss(ax - 0.04, 0.012);
            let bm = sstep(cheekLine + 0.004, cheekLine - 0.008, y);
            bm = Math.max(bm, sstep(0.066, 0.072, ax) * sstep(0.035, 0.025, y) * sstep(-0.012, 0.004, z) * sstep(0.045, 0.025, z)); // sideburns
            const must = gauss(x, 0.024) * sstep(-0.049, -0.053, y) * sstep(-0.059, -0.056, y);
            bm = Math.max(bm * (1 - lipM), must * 0.95);
            if (bm > 0.001) {
              bm *= sstep(0.0, 0.25, tn(u * 80, t * 80, seed + 5) * 0.7 + tn(u * 200, t * 200, seed + 6) * 0.3 + 0.12);
              bm *= 1 - 0.5 * gauss(x, 0.006) * gauss(y + 0.08, 0.005);
              const dots = grain < 0.4 ? 1 : 0;
              mix3(c, stubC, bm * (0.2 + 0.26 * dots));
              h += bm * dots * 0.3;
              ro = lerp(ro, 0.66, bm);
            }
          }
          // age: forehead lines, crow's feet
          if (age > 0) {
            const fl = Math.sin((y - 0.05) * 900) * gauss(y - 0.062, 0.016) * gauss(x, 0.04);
            h += age * 0.35 * fl;
            mix3(c, [skin[0] * 0.8, skin[1] * 0.72, skin[2] * 0.7], age * 0.15 * Math.max(0, fl));
            h += age * 0.3 * Math.sin(Math.atan2(y - EYE_Y, ax - 0.05) * 9) * gauss(Math.hypot(ax - 0.05, y - EYE_Y), 0.008);
          }
          // under-jaw shadow
          if (y < -0.095) mix3(c, [skin[0] * 0.62, skin[1] * 0.5, skin[2] * 0.5], 0.35 * sstep(-0.1, -0.125, y) * sstep(0.08, 0.03, z));
        }
        if (age > 0) {
          if (tn(u * 160, t * 160, seed + 21) > 0.8) mix3(c, [skin[0] * 0.8, skin[1] * 0.66, skin[2] * 0.5], age * 0.4);
          mix3(c, [0.86, 0.8, 0.78], age * 0.12);
        }
        // scalp under the hair
        if (hl && f.scalp !== 'none' && f.scalp !== 'bald') {
          const yh = hl(th);
          if (y > yh - 0.012) {
            const edge = (tn(u * 120, t * 120, seed + 7) - 0.5) * 0.006;
            const hm = sstep(yh - 0.004 + edge, yh + 0.006 + edge, y);
            if (f.scalp === 'hair') {
              mix3(c, hairC, hm * 0.92);
              h += hm * (tn(u * 900, t * 90, seed + 13) - 0.5) * 0.8;
              ro = lerp(ro, 0.6, hm);
            } else {
              mix3(c, stubC, hm * (grain < 0.5 ? 0.62 : 0.4));
              h += hm * (grain < 0.5 ? 0.25 : 0);
            }
          }
        }
        if (f.scalp === 'bald') ro = lerp(ro, 0.34, sstep(0.04, 0.1, y));
        if (fr > 0) ro = lerp(ro, 0.42, 0.6 * gauss(x, 0.012) * gauss(y + 0.01, 0.03) * fr + 0.4 * gauss(y - 0.06, 0.02) * gauss(x, 0.03) * fr);
        h += (n2 - 0.5) * 0.12 + (n1 - 0.5) * 0.08;
      } else if (v >= 0.07) {
        // neck strip: u = angle (0.5 front), v -> height
        const a = (v - 0.07) / 0.17;
        const th = (u - 0.5) * Math.PI * 2;
        const frontN = gauss(th, 0.9);
        if (stub) {
          const bm = sstep(0.55, 0.85, a) * frontN * sstep(0.0, 0.25, tn(u * 60, a * 20, seed + 5) + 0.1);
          mix3(c, stubC, bm * (grain < 0.42 ? 0.55 : 0.38));
          h += bm * (grain < 0.42 ? 0.3 : 0);
        }
        mix3(c, [skin[0] * 0.75, skin[1] * 0.62, skin[2] * 0.6], 0.3 * sstep(0.75, 1.0, a) * frontN);
        if (age > 0) h += age * 0.3 * Math.sin(a * 60) * frontN;
        h += (n2 - 0.5) * 0.1;
      } else {
        // ramps
        const vv = v / 0.06;
        if (u < 0.25) { // lid ramp: top skin -> lash dark at bottom
          mix3(c, [skin[0] * 0.8, skin[1] * 0.7, skin[2] * 0.72], 0.4);
          mix3(c, [0.05, 0.035, 0.03], sstep(0.42, 0.1, vv) * (female ? 1 : 0.85));
          if (shadowC) mix3(c, shadowC, 0.5 * sstep(0.5, 1, vv));
        } else if (u < 0.5) { // ear: concha dark -> rim reddish
          mix3(c, redC, 0.3 * vv);
          mix3(c, [skin[0] * 0.7, skin[1] * 0.56, skin[2] * 0.54], 0.3 * (1 - sstep(0.0, 0.45, vv)));
        } else if (u < 0.75) {
          mix3(c, [0.25, 0.08, 0.08], 0.8);
        }
      }
      col[j] = clamp(c[0], 0, 1) * 255; col[j + 1] = clamp(c[1], 0, 1) * 255; col[j + 2] = clamp(c[2], 0, 1) * 255; col[j + 3] = 255;
      rough[j] = 255; rough[j + 1] = clamp(ro + (n1 - 0.5) * 0.08, 0, 1) * 255; rough[j + 2] = 0; rough[j + 3] = 255;
      hgt[i] = h;
    }
  }
  const mk = (data, srgb) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    const tx = new THREE.CanvasTexture(cv);
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    tx.wrapS = THREE.RepeatWrapping;
    tx.needsUpdate = true;
    return tx;
  };
  const res = {
    map: mk(col, true),
    normalMap: mk(TX.heightToNormal(hgt, W, H, 1.1 * sc), false),
    roughnessMap: mk(rough, false),
  };
  if (key) faceCache.set(key, res);
  return res;
}

// ------------------------------------------------------------------- ears & eyes

/** Ear in head space for side (+1 left / -1 right). UVs in the ear ramp. */
export function earGeo(shape, side, { S = 1, female = false, detail = 1 } = {}) {
  const k = female ? 0.9 : 1;
  const n = detail > 0.7 ? 16 : 10, m = 3;
  // ear outline in the ear plane (u = back, v = up), metres
  const H = 0.031 * k, Wd = 0.017 * k;
  const outline = (a) => { // a in [0, 2pi): 0 = front-top attachment going over the top and down the back
    const ang = a - Math.PI * 0.62;
    const u = Wd * Math.cos(ang) + 0.003, v = H * Math.sin(ang) * (Math.sin(ang) < 0 ? 0.95 : 1);
    return [u, v];
  };
  // base on the head surface
  const base = [0, 0, 0];
  const anchor = shape.point(side * 1.5, Math.PI / 2 + 0.03, [0, 0, 0]);
  const P = [], UV = [], idx = [];
  const tilt = 0.25, flare = 0.42;
  const place = (u, v, w) => {
    // rotate ear frame: tilt back, flare outwards from the head around the front attachment
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    let uu = u * ct + v * st, vv = -u * st + v * ct;
    const out = Math.max(0, uu + 0.004) * Math.sin(flare) + w;
    const back = Math.max(0, uu + 0.004) * Math.cos(flare) + Math.min(0, uu + 0.004);
    base[0] = anchor[0] + side * (out - 0.002);
    base[1] = anchor[1] + vv - 0.004;
    base[2] = anchor[2] - back - 0.006;
    return base;
  };
  for (let j = 0; j <= m; j++) {
    const r = j / m;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const [ou, ov] = outline(a);
      // concha depth: cup towards the head in the middle, rim raised
      const cup = -0.0028 * (1 - r * r) + 0.0024 * Math.pow(r, 4);
      const q = place(ou * lerp(0.15, 1, r), ov * lerp(0.2, 1, r), cup);
      P.push(q[0], q[1], q[2]);
      UV.push(0.25 + 0.25 * (i / n), 0.005 + 0.05 * r);
    }
  }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  // back face of the shell (so the ear has thickness when seen from behind)
  const backS = shell.clone();
  const bi = backS.index.array;
  for (let i = 0; i < bi.length; i += 3) { const t = bi[i + 1]; bi[i + 1] = bi[i + 2]; bi[i + 2] = t; }
  const bp = backS.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) - side * 0.0022);
  backS.computeVertexNormals();
  // helix rim tube
  const pts = [], radii = [];
  for (let i = 0; i <= 18; i++) {
    const a = 0.15 + (i / 18) * Math.PI * 1.75;
    const [ou, ov] = outline(a);
    const q = place(ou * 0.97, ov * 0.97, 0.0025);
    pts.push(new THREE.Vector3(q[0], q[1], q[2]));
    radii.push(i > 13 ? 0.0042 * k : 0.0026 * k);
  }
  const rim = tubeGeo(pts, radii, detail > 0.7 ? 5 : 4, true, true, 1);
  const ra = rim.attributes.uv;
  for (let i = 0; i < ra.count; i++) ra.setXY(i, 0.4, 0.05);
  const g = mergeAll([shell, backS, plain(rim)]);
  g.scale(S, S, S);
  return g;
}

// Eye texture: iris at the +z pole, rows = angle from the pole.
const eyeTexCache = new Map();
export function eyeTexture(color = '#3b2a1e') {
  if (eyeTexCache.has(color)) return eyeTexCache.get(color);
  const W = 64, H = 64;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const ic = hexRGB(color);
  for (let r = 0; r < H; r++) {
    const ang = (r + 0.5) / H; // 0 at the pole (front)
    for (let q = 0; q < W; q++) {
      const j = (r * W + q) * 4;
      const streak = TX.vnoise(q / 2, ang * 12, 32, 5) * 0.5 + 0.5;
      let c;
      if (ang < 0.07) c = [0.02, 0.02, 0.02];
      else if (ang < 0.19) {
        const k = (ang - 0.07) / 0.12;
        c = ic.map((v) => v * (0.75 + 0.5 * streak) * (1 - 0.45 * k * k));
        if (k > 0.85) c = c.map((v) => v * 0.5);
      } else {
        const vein = TX.vnoise(q / 3, ang * 20, 22, 9) > 0.78 && ang > 0.4 ? 0.12 : 0;
        c = [0.93 - vein * 0.1, 0.9 - vein, 0.86 - vein].map((v) => v * (1 - 0.3 * sstep(0.35, 0.9, ang)));
      }
      img.data[j] = c[0] * 255; img.data[j + 1] = c[1] * 255; img.data[j + 2] = c[2] * 255; img.data[j + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  eyeTexCache.set(color, tx);
  return tx;
}

/** Eyeballs (+z pole = pupil) and lid tubes. Returns { eyes, lids } in head space. */
export function eyesGeo(shape, { female = false, detail = 1 } = {}) {
  const R = 0.0122;
  const eyes = [], lids = [];
  // almond opening (relative to the eye centre): lid heights along the eye width
  const upOpen = female ? 0.0036 : 0.0033, loOpen = -0.0039;
  const edge = (t, upper) => (upper ? upOpen : loOpen) * Math.sin(Math.PI * Math.pow(t, upper ? 0.85 : 1.15)) + (t - 0.5) * 0.0015 + (upper ? 0.0004 : -0.0003);
  for (const sd of [1, -1]) {
    const cx = 0.0315 * sd, cy = EYE_Y + 0.0005, cz = 0.0668;
    // visible cornea/sclera patch: only the almond between the lids (+ overlap under them),
    // so no eyeball ever pokes through the face around the opening
    const nu = detail > 0.7 ? 14 : 8, nv = detail > 0.7 ? 6 : 4;
    const g = gridGeo(nu, nv, (i, j, o) => {
      const t = i / nu;
      const x = lerp(-0.0152, 0.0155, t);
      const y0 = edge(t, false) - 0.0012, y1 = edge(t, true) + 0.0014;
      const y = lerp(y0, y1, j / nv);
      const zz = Math.sqrt(Math.max(0, R * R - x * x - y * y));
      o.p = [cx + sd * x, cy + y, cz + zz];
      const al = Math.acos(clamp(zz / R, -1, 1));
      o.uv = [Math.atan2(y, sd * x) / (Math.PI * 2) + 0.5, 1 - al / Math.PI];
      o.w = [0, 1];
    }, { outDir: [0, 0, 1] });
    eyes.push(g);
    // lids: tubes along the almond edges
    const lid = (upper) => {
      const pts = [], radii = [];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = lerp(-0.0145, 0.0148, t);
        const y = edge(t, upper);
        const zz = Math.sqrt(Math.max(0, (R + 0.0012) ** 2 - x * x - y * y));
        pts.push(new THREE.Vector3(cx + sd * x, cy + y + (upper ? 0.0016 : -0.0011), cz + zz - 0.0004));
        const taper = Math.sin(Math.PI * t) * 0.6 + 0.4;
        radii.push((upper ? 0.0027 : 0.0017) * taper);
      }
      const tg = tubeGeo(pts, radii, detail > 0.7 ? 6 : 4, true, true, 1);
      // uv into the lid ramp: lower half of the tube dark (lash line)
      const pa = tg.attributes.position, ua = tg.attributes.uv;
      for (let i = 0; i < pa.count; i++) {
        const dy = pa.getY(i) - (cy + (upper ? 0.004 : -0.004));
        ua.setXY(i, 0.12, upper ? clamp(0.03 + dy * 9, 0.001, 0.059) : clamp(0.03 - dy * 6 + 0.01, 0.02, 0.059));
      }
      return tg;
    };
    lids.push(lid(true), lid(false));
  }
  return { eyes: mergeAll(eyes.map(plain)), lids: mergeAll(lids.map(plain)) };
}
