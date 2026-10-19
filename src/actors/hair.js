// Hair, beards, eyewear and headwear for the parametric head (head space, see head.js).
// Hair = an opaque scalp shell (fills gaps, follows the hairline) + layered strand clumps:
// tapered, slightly folded ribbons grown along a per-style flow field, constrained to
// float a style-dependent distance above the scalp, falling under gravity and colliding
// with neck and shoulders. Ribbons use an alpha-tested strand texture so tips split into
// strands; shading is Kajiya-Kay along the ribbon's UV v axis (charmat.js 'hair').
import * as THREE from 'three';
import * as TX from '../core/textures.js';
import { clamp, lerp, sstep, gauss, gridGeo, tubeGeo, mergeAll, plain, smoothCoincident } from './anatomy.js';
import { EYE_Y, hairlineFn } from './head.js';

// ------------------------------------------------------------------- textures

let hairTex = null;
/** Shared strand texture: map (grey strands, alpha = strand coverage) + strand normal map. */
export function hairTextures() {
  if (hairTex) return hairTex;
  const W = 256, H = 256;
  const col = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  const rnd = TX.rng(4242);
  const strands = [];
  for (let i = 0; i < 46; i++) {
    strands.push({ u: rnd(), w: 1.5 + rnd() * 3.2, b: 0.55 + rnd() * 0.45, end: 0.62 + rnd() * 0.38, wav: rnd() * 6, amp: 1 + rnd() * 2.5 });
  }
  for (let r = 0; r < H; r++) {
    const v = 1 - (r + 0.5) / H; // 0 root .. 1 tip
    for (let q = 0; q < W; q++) {
      let a = 0, br = 0, hh = 0;
      for (const s of strands) {
        if (v > s.end) continue;
        const cx = s.u * W + Math.sin(v * 9 + s.wav) * s.amp;
        let dx = Math.abs(q - cx); dx = Math.min(dx, W - dx);
        const w = s.w * (1 - 0.7 * sstep(s.end - 0.25, s.end, v));
        if (dx < w) {
          const k = 1 - dx / w;
          a = Math.max(a, sstep(0, 0.35, k));
          br = Math.max(br, s.b * (0.7 + 0.3 * k));
          hh = Math.max(hh, Math.sqrt(k));
        }
      }
      // dense opaque core near the root and towards the ribbon centre
      const u = (q + 0.5) / W;
      const core = sstep(0.42, 0.18, v) * sstep(0.04, 0.16, Math.min(u, 1 - u) + 0.08);
      a = Math.max(a, core);
      if (br === 0) br = 0.5;
      const ao = lerp(0.55, 1, sstep(0.0, 0.3, v));
      const n = TX.vnoise(q / 3, r / 40, W / 3, 7) * 0.25;
      const j = (r * W + q) * 4;
      const g = clamp((br * 0.85 + n) * ao, 0, 1) * 255;
      col[j] = g; col[j + 1] = g; col[j + 2] = g; col[j + 3] = clamp(a, 0, 1) * 255;
      hgt[r * W + q] = hh * 0.8 + n;
    }
  }
  const mk = (data, srgb) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  };
  hairTex = { map: mk(col, true), normalMap: mk(TX.heightToNormal(hgt, W, H, 2.2), false) };
  return hairTex;
}

// ------------------------------------------------------------------- strands

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Tangent projection of a direction at point p (radial normal from the head centre).
function tangential(d, p) {
  const n = p.clone().normalize();
  return d.clone().addScaledVector(n, -d.dot(n));
}

function ribbon(pts, w0, opts, P, UV, IDX, HANG, NRM) {
  const n = pts.length;
  const base = P.length / 3;
  const u0 = opts.u0 ?? 0, uw = opts.uw ?? 1;
  const fold = opts.fold ?? 0.3;
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const T = pts[Math.min(n - 1, k + 1)].clone().sub(pts[Math.max(0, k - 1)]).normalize();
    let N = p.clone().sub(opts.center || V()).normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    const Wd = new THREE.Vector3().crossVectors(T, N).normalize();
    const t = k / (n - 1);
    const w = w0 * (1 - (opts.taper ?? 0.6) * Math.pow(t, 1.4)) * (k === 0 ? 0.8 : 1);
    const c = p.clone().addScaledVector(N, w * fold);
    for (const [q, u] of [[p.clone().addScaledVector(Wd, -w / 2), 0], [c, 0.5], [p.clone().addScaledVector(Wd, w / 2), 1]]) {
      P.push(q.x, q.y, q.z);
      const nn = N.clone().addScaledVector(Wd, (u - 0.5) * 0.6).normalize();
      NRM.push(nn.x, nn.y, nn.z);
      UV.push(u0 + u * uw, lerp(0.02, 0.985, t));
      HANG.push(opts.hang ? opts.hang(q, t) : 0);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    const a = base + k * 3;
    IDX.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
}

function fib(i, n) {
  const y = 1 - (i + 0.5) / n * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963229728653;
  return V(Math.sin(a) * r, y, Math.cos(a) * r);
}

/**
 * Hair styles. Each returns { rootOk(p, th), init(p, n, rnd), flow(p, t, rnd, root), offset(t, root),
 * len(root, rnd), width, segs, count, lift, collide }.
 */
function styleDef(style, o) {
  const female = o.female;
  const neckCollide = (q) => {
    // neck cylinder and shoulders (head space; head centre ~ 0.17 m above the shoulders)
    if (q.y < -0.07) {
      const cz = -0.01, rx = 0.068, rz = 0.064;
      const dx = q.x / rx, dz = (q.z - cz) / rz;
      const d = Math.hypot(dx, dz);
      if (d < 1) { q.x /= d; q.z = cz + (q.z - cz) / d; }
    }
    // hair resting on the trapezius / shoulders slope
    const top = -0.17 - 0.3 * Math.max(0, Math.abs(q.x) - 0.06);
    if (q.y < top && Math.abs(q.z + 0.012) < 0.1 && Math.abs(q.x) < 0.24) q.y = top;
  };
  switch (style) {
    case 'swept': return { // Cobretti: thick, lifted off the forehead, swept straight back to the collar
      hairline: 'receding', count: o.hero ? 130 : 75, segs: o.hero ? 7 : 5, width: 0.032, lift: 0.002,
      rootOk: (p, yh) => p.y > yh + 0.002,
      init: (p) => V(Math.sign(p.x) * 0.1, p.z > 0.04 ? 1.5 : 0.35, -0.7),
      flow: (p, t) => {
        const back = sstep(0.02, -0.07, p.z);
        const side = sstep(0.035, 0.07, Math.abs(p.x)) * sstep(0.06, 0.02, p.y);
        return V(Math.sign(p.x) * 0.2 * side, -0.1 - 1.5 * back - 0.6 * side, -1 + back * 0.75);
      },
      offset: (t, r) => {
        const vol = 0.012 + 0.016 * sstep(-0.02, 0.07, r.z) * sstep(0.03, 0.1, r.y);
        return 0.004 + vol * Math.sin(Math.min(1, t * 2) * Math.PI * 0.5) * (1 - 0.45 * sstep(0.55, 1, t));
      },
      len: (r, rnd) => {
        const toCollar = Math.max(0.04, (r.y + 0.125) * 0.95 + Math.max(0, r.z) * 1.05);
        return (toCollar + 0.035) * (0.88 + rnd() * 0.22);
      },
      bend: 0.45, collide: (q) => { neckCollide(q); if (q.y < -0.125) q.y = -0.125 + (q.y + 0.125) * 0.25; },
      shell: 0.0045, taper: 0.5, hangY: -0.1,
    };
    case 'long': return {
      hairline: female ? 'female' : 'default', count: o.hero ? 125 : 90, segs: o.hero ? 8 : 7, width: 0.028, lift: 0.002,
      rootOk: (p, yh) => p.y > yh + 0.003,
      init: (p) => V(Math.sign(p.x || 1) * 1, 0.1, -0.2),
      flow: (p, t) => {
        const g = sstep(0.03, -0.02, p.y + (Math.abs(p.x) > 0.06 ? 0.05 : 0));
        return V(Math.sign(p.x || 1) * 0.6 * (1 - g), -0.4 - 2.2 * g, -0.25 - 0.3 * sstep(0, -0.05, p.z));
      },
      offset: (t) => 0.004 + 0.007 * Math.min(1, t * 3),
      len: (r, rnd) => (o.length || 0.3) * (0.75 + rnd() * 0.35) + Math.max(0, r.y) * 0.4,
      bend: 0.35, collide: neckCollide, shell: 0.004, taper: 0.5, hang: true, hangY: 0.0,
    };
    case 'big': return { // Ingrid: side-parted, teased volume, feathered back and flipped out at the jaw
      hairline: 'female', count: o.hero ? 145 : 90, segs: o.hero ? 8 : 6, width: 0.037, lift: 0.003,
      rootOk: (p, yh) => p.y > yh + 0.002,
      init: (p) => V(Math.sign(p.x - 0.018 || 1), 0.45, p.z > 0.05 ? 0.1 : -0.35),
      flow: (p, t) => {
        const side = Math.sign(p.x - 0.018 || 1);
        const g = sstep(0.07, -0.02, p.y);
        if (p.y < -0.09) return V(Math.sign(p.x || 1) * 0.15, -1.6, p.z < -0.02 ? -0.15 : 0.0); // ends fall
        return V(side * 0.9 * (1 - 0.5 * g), -0.15 - 1.7 * g, p.z > 0.05 ? -0.45 : -0.2);
      },
      offset: (t, r) => 0.01 + 0.034 * Math.sin(Math.min(1, t * 1.7) * Math.PI * 0.5) * (0.75 + 0.25 * sstep(0.0, 0.1, r.y)),
      len: (r, rnd) => (0.19 + Math.max(0, r.y) * 0.55) * (0.85 + rnd() * 0.3),
      bend: 0.4, collide: neckCollide, shell: 0.014, taper: 0.45, hang: true, hangY: -0.1,
    };
    case 'flattop': return {
      hairline: 'default', count: o.hero ? 220 : 130, segs: 3, width: 0.016, lift: 0.001,
      rootOk: (p, yh) => p.y > Math.max(yh, 0.055),
      init: () => V(0, 1, 0),
      flow: (p) => V(p.x * 2, 1, p.z * 1.2),
      offset: () => 0.002,
      len: (r) => Math.max(0.012, 0.162 - r.y),
      bend: 0.8, shell: 0.0025, taper: 0.1, flatTop: 0.158, hug: false,
    };
    case 'mohawk': return {
      hairline: 'default', count: o.hero ? 120 : 70, segs: 5, width: 0.022, lift: 0.001,
      rootOk: (p, yh) => p.y > yh && Math.abs(p.x) < 0.02,
      init: (p) => V(0, 1, -0.25 - Math.max(0, -p.z) * 6),
      flow: (p) => V(0, 1, -0.3 - Math.max(0, -p.z) * 5),
      offset: () => 0.002,
      len: (r, rnd) => (0.07 + 0.05 * sstep(-0.1, 0.06, r.z)) * (0.8 + rnd() * 0.35),
      bend: 0.9, shell: 0.0, taper: 0.85, strip: 0.021, hug: false,
    };
    case 'short':
    default: return {
      hairline: female ? 'female' : 'default', count: o.hero ? 160 : 80, segs: 4, width: 0.018, lift: 0.0015,
      rootOk: (p, yh) => p.y > yh + 0.002,
      init: (p) => V(0, 0.2, -1),
      flow: (p) => V(Math.sign(p.x) * 0.3, -0.6 - 0.8 * sstep(0.0, -0.06, p.z), -1),
      offset: (t) => 0.0035 + 0.004 * Math.sin(t * Math.PI),
      len: (r, rnd) => (0.035 + rnd() * 0.02) * (r.y < 0.0 ? 0.7 : 1),
      bend: 0.5, shell: 0.003, taper: 0.5,
    };
  }
}

/**
 * Builds hair for a style. Returns { geo, hang: Float32Array, hairline } in head space.
 * opts: { female, hero, length, seed }
 */
export function buildHair(shape, style, opts = {}) {
  const sd = styleDef(style, opts);
  const hl = hairlineFn(sd.hairline);
  const rnd = TX.rng(opts.seed || 1);
  const P = [], UV = [], IDX = [], HANG = [], NRM = [];
  const hangFn = (q, t) => sstep(-0.06, -0.22, q.y);
  const tmp = [0, 0, 0];
  // ---- scalp shell
  if (sd.shell > 0 || style === 'mohawk') {
    const nu = opts.hero ? 44 : 30, nv = opts.hero ? 18 : 12;
    const cols = [];
    for (let i = 0; i <= nu; i++) {
      const s = i / nu, th = shape.thetaOf(s);
      // walk down the column until the hairline
      let lo = 0, hi = 1;
      const yh = hl(th);
      for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; shape.at(s, m, tmp); if (tmp[1] > yh) lo = m; else hi = m; }
      cols.push(lo);
    }
    const g = gridGeo(nu, nv, (i, j, o) => {
      const s = i / nu, tEnd = cols[i];
      const t = tEnd * Math.pow(j / nv, 0.8);
      shape.at(s, t, tmp);
      const p = V(...tmp);
      const edge = sstep(tEnd, tEnd * 0.85, t);
      let off = (sd.shell || 0.0015) * lerp(0.25, 1, edge);
      if (style === 'mohawk') off = Math.abs(p.x) < sd.strip ? 0.004 : 0.0006;
      p.addScaledVector(p.clone().normalize(), off);
      o.p = [p.x, p.y, p.z];
      o.uv = [s * 9, 0.04 + 0.22 * (j / nv)];
      o.w = [0, 1];
    });
    const base = P.length / 3;
    const gp = g.attributes.position, gu = g.attributes.uv, gn = g.attributes.normal;
    for (let i = 0; i < gp.count; i++) { P.push(gp.getX(i), gp.getY(i), gp.getZ(i)); UV.push(gu.getX(i), gu.getY(i)); NRM.push(gn.getX(i), gn.getY(i), gn.getZ(i)); HANG.push(0); }
    for (const ix of g.index.array) IDX.push(ix + base);
  }
  // ---- clumps
  const n = sd.count;
  const total = n * 6;
  let made = 0;
  for (let i = 0; i < total && made < n; i++) {
    const d = fib(i, total);
    const th = Math.atan2(d.x, d.z), ph = Math.acos(d.y);
    shape.point(th, ph, tmp);
    const root = V(...tmp);
    if (!sd.rootOk(root, hl(th))) continue;
    if (rnd() > 0.92) continue;
    made++;
    const nrm = root.clone().normalize();
    const L = sd.len(root, rnd);
    const segs = sd.segs;
    const step = L / segs;
    const pts = [root.clone().addScaledVector(nrm, sd.lift)];
    let dir = tangential(sd.init(root, nrm, rnd), root).normalize();
    if (style === 'flattop' || style === 'mohawk') dir = sd.init(root).normalize();
    const jit = V((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
    for (let k = 1; k <= segs; k++) {
      const p = pts[k - 1];
      const t = k / segs;
      const f = sd.flow(p, t, rnd, root).add(jit).normalize();
      dir.lerp(f, sd.bend).normalize();
      const hug = sd.hug !== false && p.y > (sd.hangY ?? -0.2);
      if (hug) { // follow the head: strip most of the radial component
        const n = p.clone().normalize();
        dir.addScaledVector(n, -dir.dot(n) * 0.9).normalize();
      }
      const q = p.clone().addScaledVector(dir, step);
      const r = shape.radiusToward(q.x, q.y, q.z);
      const want = r + sd.offset(t, root);
      const len = q.length();
      if (hug) q.multiplyScalar(lerp(len, want, 0.9) / len); // hold the volume shell
      else if (len < want && q.y > -0.1) q.multiplyScalar(want / len);
      if (sd.collide) sd.collide(q);
      if (sd.flatTop && q.y > sd.flatTop) q.y = sd.flatTop + (rnd() - 0.5) * 0.002;
      dir.subVectors(q, p).normalize();
      pts.push(q);
    }
    const w = sd.width * (0.75 + rnd() * 0.5) * (style === 'flattop' ? 1 : lerp(0.75, 1.1, sstep(-0.05, 0.08, root.y)));
    ribbon(pts, w, { u0: rnd() * 0.5, uw: 0.5, fold: 0.28, taper: sd.taper, hang: sd.hang ? hangFn : null }, P, UV, IDX, HANG, NRM);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(NRM, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(IDX);
  return { geo: g, hang: new Float32Array(HANG), hairline: hl, scalp: style === 'mohawk' || style === 'flattop' ? 'shaved' : 'hair' };
}

/** Full beard: shell over the beard region + short clumps at the chin. Head space. */
export function buildBeard(shape, opts = {}) {
  const rnd = TX.rng(opts.seed || 5);
  const P = [], UV = [], IDX = [], HANG = [], NRM = [];
  const tmp = [0, 0, 0];
  const inBeard = (p) => {
    const ax = Math.abs(p[0]);
    if (p[2] < -0.005) return 0;
    const line = lerp(-0.026, -0.006, sstep(0.03, 0.065, ax));
    let m = sstep(line, line - 0.01, p[1]);
    if (ax < 0.024 && p[1] > -0.068 && p[1] < -0.056) m *= 0.0; // lips
    if (ax < 0.03 && p[1] > -0.056 && p[1] < -0.046) m = Math.max(m, 1); // moustache
    return m;
  };
  const nu = 48, nv = 26;
  const g = gridGeo(nu, nv, (i, j, o) => {
    const s = lerp(0.25, 0.75, i / nu), t = lerp(0.45, 1.0, j / nv);
    shape.at(s, t, tmp);
    const m = inBeard(tmp);
    const p = V(...tmp);
    const thick = 0.004 + 0.012 * sstep(-0.07, -0.12, p.y) * gauss(p.x, 0.05);
    p.addScaledVector(p.clone().normalize(), m * thick - (1 - m) * 0.004);
    o.p = [p.x, p.y, p.z]; o.uv = [s * 6, 0.05 + 0.2 * m]; o.w = [0, 1];
  });
  const gp = g.attributes.position, gu = g.attributes.uv, gn = g.attributes.normal;
  for (let i = 0; i < gp.count; i++) { P.push(gp.getX(i), gp.getY(i), gp.getZ(i)); UV.push(gu.getX(i), gu.getY(i)); NRM.push(gn.getX(i), gn.getY(i), gn.getZ(i)); HANG.push(0); }
  for (const ix of g.index.array) IDX.push(ix);
  for (let i = 0; i < (opts.hero ? 70 : 40); i++) {
    const x = (rnd() - 0.5) * 0.09, y = -0.1 - rnd() * 0.025;
    const th = Math.atan2(x, 0.06), ph = Math.acos(clamp(y / 0.12, -1, 1));
    shape.point(th, ph, tmp);
    if (!inBeard(tmp)) continue;
    const root = V(...tmp).addScaledVector(V(...tmp).normalize(), 0.006);
    const pts = [root];
    let dir = V(0, -1, 0.35).normalize();
    for (let k = 1; k <= 4; k++) {
      const q = pts[k - 1].clone().addScaledVector(dir, 0.016 + rnd() * 0.008);
      dir.lerp(V(0, -1, 0.1), 0.4).normalize();
      pts.push(q);
    }
    ribbon(pts, 0.016, { u0: rnd() * 0.5, uw: 0.5, fold: 0.3, taper: 0.6 }, P, UV, IDX, HANG, NRM);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(NRM, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  out.setIndex(IDX);
  return { geo: out, hang: new Float32Array(HANG) };
}

// ------------------------------------------------------------------- eyewear

/** Aviators: teardrop lenses, double bridge, nose pads, temples. Returns { lens, frame } (head space). */
export function aviatorGeo(shape, { detail = 1 } = {}) {
  const outline = [[-0.0235, 0.0145], [-0.008, 0.0168], [0.010, 0.0176], [0.0255, 0.0158], [0.0305, 0.006], [0.0287, -0.0075], [0.0215, -0.0187], [0.0095, -0.0257], [-0.003, -0.0266], [-0.014, -0.0216], [-0.0215, -0.012], [-0.0256, 0.001]];
  const curveOf = (sd) => new THREE.CatmullRomCurve3(outline.map(([u, v]) => V(u, v, 0)), true, 'centripetal');
  const cx = 0.0335, cy = EYE_Y - 0.0015, cz = 0.0975;
  const wrap = 0.26;
  const toHead = (sd, u, v, lift = 0) => {
    const bulge = 0.0032 * (1 - Math.min(1, (u * u + v * v) / (0.03 * 0.03)));
    const x = cx * sd + sd * u * Math.cos(wrap);
    const z = cz - u * Math.sin(wrap) + bulge + lift - Math.max(0, -v) * 0.08;
    return V(x, cy + v, z);
  };
  const lens = [], frame = [];
  const nOut = detail > 0.7 ? 34 : 24;
  for (const sd of [1, -1]) {
    const c = curveOf(sd);
    const pts = c.getSpacedPoints(nOut).slice(0, nOut);
    // lens: fan rings from the centre
    const rings = 3;
    const Pp = [], UVp = [], idx = [];
    Pp.push(...toHead(sd, 0.002, -0.004).toArray()); UVp.push(0.5, 0.5);
    for (let r = 1; r <= rings; r++) {
      const f = r / rings;
      for (let i = 0; i < nOut; i++) {
        const q = pts[i];
        const h = toHead(sd, lerp(0.002, q.x, f), lerp(-0.004, q.y, f));
        Pp.push(h.x, h.y, h.z);
        UVp.push(0.5 + q.x * 10 * f, 0.5 + q.y * 10 * f);
      }
    }
    for (let i = 0; i < nOut; i++) {
      const a = 1 + i, b = 1 + (i + 1) % nOut;
      idx.push(0, b, a);
    }
    for (let r = 1; r < rings; r++) for (let i = 0; i < nOut; i++) {
      const a = 1 + (r - 1) * nOut + i, b = 1 + (r - 1) * nOut + (i + 1) % nOut;
      const c2 = a + nOut, d = b + nOut;
      idx.push(a, b, c2, b, d, c2);
    }
    if (sd < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(UVp, 2));
    lg.setIndex(idx);
    lg.computeVertexNormals();
    lens.push(lg);
    // rim
    const rimPts = pts.map((q) => { const l = Math.hypot(q.x, q.y); return toHead(sd, q.x * (1 + 0.0008 / l), q.y * (1 + 0.0008 / l), 0.0002); });
    rimPts.push(rimPts[0].clone());
    frame.push(tubeGeo(rimPts, rimPts.map(() => 0.00105), detail > 0.7 ? 5 : 4, false, false, 1));
    // hinge block + temple arm
    const hinge = toHead(sd, 0.0295, 0.0098, -0.002);
    const hb = new THREE.BoxGeometry(0.004, 0.0035, 0.006);
    hb.translate(hinge.x + sd * 0.001, hinge.y, hinge.z - 0.002);
    frame.push(hb);
    const tpts = [hinge.clone().add(V(sd * 0.002, 0, -0.003))];
    for (const [z, dy] of [[0.07, 0.001], [0.045, 0.002], [0.015, 0.001], [-0.012, -0.002], [-0.026, -0.008], [-0.034, -0.018]]) {
      const y = cy + 0.0105 + dy;
      const xr = shape.radiusToward(0.08 * sd, y, z);
      const ang = Math.atan2(0.08, z);
      void ang;
      const x = sd * (Math.sqrt(Math.max(0, xr * xr - y * y - z * z)) + 0.0045);
      tpts.push(V(x, y, z));
    }
    frame.push(tubeGeo(tpts, tpts.map((_, i) => (i === 0 ? 0.0016 : 0.0011)), 5, false, true, 1));
    // nose pad on a short arm
    const padAt = V(sd * 0.0108, cy - 0.0075, 0.0885); // tucked behind the lens against the nose
    const pad = new THREE.SphereGeometry(1, 8, 6);
    pad.scale(0.0012, 0.0036, 0.0026);
    pad.rotateY(sd * 0.6);
    pad.translate(padAt.x, padAt.y, padAt.z);
    frame.push(pad);
    const inner = toHead(sd, -0.0225, -0.002);
    frame.push(tubeGeo([inner, V(sd * 0.0125, cy - 0.003, 0.0945), padAt.clone().add(V(sd * 0.002, 0.001, 0.002))], [0.0006, 0.0006, 0.0006], 4, false, false, 1));
  }
  // double bridge: straight top bar + lower keyhole arch
  const tl = toHead(1, -0.022, 0.0152, 0.0003), tr = toHead(-1, -0.022, 0.0152, 0.0003);
  frame.push(tubeGeo([tl, V(0, tl.y + 0.0008, tl.z + 0.0015), tr], [0.0011, 0.0011, 0.0011], 5, false, false, 1));
  const bl = toHead(1, -0.0252, 0.002, 0.0003), br = toHead(-1, -0.0252, 0.002, 0.0003);
  frame.push(tubeGeo([bl, V(0.006, bl.y + 0.004, bl.z + 0.0025), V(0, bl.y + 0.0055, bl.z + 0.003), V(-0.006, bl.y + 0.004, bl.z + 0.0025), br], [0.0012, 0.0012, 0.0012, 0.0012, 0.0012], 5, false, false, 1));
  return { lens: mergeAll(lens), frame: mergeAll(frame.map(plain)) };
}

/** Round wire-rimmed glasses. */
export function roundGlassesGeo(shape, { r = 0.0165, detail = 1 } = {}) {
  const lens = [], frame = [];
  const cy = EYE_Y + 0.001, cz = 0.0955;
  for (const sd of [1, -1]) {
    const cx = 0.032 * sd;
    const l = new THREE.CircleGeometry(r, 20);
    l.translate(cx, cy, cz);
    lens.push(l);
    const pts = [];
    for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; pts.push(V(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz)); }
    frame.push(tubeGeo(pts, pts.map(() => 0.0009), 4, false, false, 1));
    const tp = [V(cx + sd * r, cy + 0.004, cz - 0.001)];
    for (const [z, dy] of [[0.075, 0.003], [0.04, 0.004], [0.0, 0.003], [-0.022, -0.004], [-0.032, -0.016]]) {
      const y = cy + dy;
      const xr = shape.radiusToward(0.08 * sd, y, z);
      tp.push(V(sd * (Math.sqrt(Math.max(0, xr * xr - y * y - z * z)) + 0.004), y, z));
    }
    frame.push(tubeGeo(tp, tp.map(() => 0.0009), 4, false, true, 1));
  }
  frame.push(tubeGeo([V(0.032 - r, cy + 0.003, cz), V(0, cy + 0.007, cz + 0.004), V(-0.032 + r, cy + 0.003, cz)], [0.0009, 0.0009, 0.0009], 4, false, false, 1));
  return { lens: mergeAll(lens.map(plain)), frame: mergeAll(frame.map(plain)) };
}

// ------------------------------------------------------------------- headwear

// Shell over the head grid restricted by a mask; fn(s, t, p) -> offset or null
function headShell(shape, nu, nv, s0, s1, t0, t1, offFn, uvScale = 4) {
  const tmp = [0, 0, 0];
  return gridGeo(nu, nv, (i, j, o) => {
    const s = lerp(s0, s1, i / nu), t = lerp(t0, t1, j / nv);
    shape.at(s, t, tmp);
    const p = V(...tmp);
    const off = offFn(s, t, p);
    p.addScaledVector(p.clone().normalize(), off);
    o.p = [p.x, p.y, p.z]; o.uv = [s * uvScale, t * uvScale * 0.5]; o.w = [0, 1];
  });
}

function colT(shape, s, yLim) {
  const tmp = [0, 0, 0];
  let lo = 0, hi = 1;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; shape.at(s, m, tmp); if (tmp[1] > yLim) lo = m; else hi = m; }
  return lo;
}

/** Baseball cap: crown + curved brim. */
export function capGeo(shape) {
  const yl = (th) => lerp(0.052, 0.012, sstep(0.3, 2.6, Math.abs(th)));
  const nu = 40, nv = 12;
  const tmp = [0, 0, 0];
  const cols = [];
  for (let i = 0; i <= nu; i++) cols.push(colT(shape, i / nu, yl(shape.thetaOf(i / nu))));
  const crown = gridGeo(nu, nv, (i, j, o) => {
    const s = i / nu, t = cols[i] * (j / nv);
    shape.at(s, t, tmp);
    const p = V(...tmp);
    p.addScaledVector(p.clone().normalize(), 0.009 + 0.006 * Math.sin((j / nv) * Math.PI * 0.9));
    o.p = [p.x, p.y, p.z]; o.uv = [s * 6, j / nv]; o.w = [0, 1];
  });
  // brim: slab from the front edge outward
  const bu = 16, bv = 7;
  const brim = gridGeo(bu, bv, (i, j, o) => {
    const th = lerp(-0.95, 0.95, i / bu);
    const ph = Math.acos(0.33);
    shape.point(th, ph, tmp);
    const edge = V(...tmp);
    edge.addScaledVector(edge.clone().normalize(), 0.01);
    edge.y = yl(th) + 0.009;
    const fwd = V(Math.sin(th) * 0.4, -0.12 - 0.25 * Math.abs(Math.sin(th)), 1).normalize();
    // rows: 0..3 top surface outward, 4..7 bottom surface inward
    const half = bv / 2;
    const f = j <= half ? j / half : (bv - j) / half;
    const bottom = j > half ? -0.004 : 0;
    const p = edge.clone().addScaledVector(fwd, f * 0.072 * (1 - 0.35 * Math.abs(Math.sin(th)) ** 2));
    p.y += bottom - f * f * 0.006 * (1 - Math.abs(Math.sin(th)));
    o.p = [p.x, p.y, p.z]; o.uv = [i / bu, j / bv]; o.w = [0, 1];
  }, { outDir: [0, 1, 0] });
  const btn = new THREE.SphereGeometry(0.006, 8, 6);
  shape.at(0.5, 0.0, tmp);
  btn.translate(tmp[0], tmp[1] + 0.024, tmp[2]);
  return mergeAll([crown, brim, plain(btn)].map(plain));
}

/** M1 steel pot helmet with rim and chin strap. */
export function helmetGeo(shape) {
  const parts = [];
  const g = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.scale(0.106, 0.098, 0.12);
  g.translate(0, 0.028, -0.006);
  parts.push(g);
  const rim = new THREE.TorusGeometry(1, 0.06, 6, 40);
  rim.rotateX(Math.PI / 2);
  rim.scale(0.11, 0.08, 0.124);
  rim.translate(0, 0.028 - 0.098 * Math.cos(Math.PI * 0.56) * -1 * 0.98 - 0.005, -0.006);
  parts.push(rim);
  for (const sd of [1, -1]) {
    parts.push(tubeGeo([V(sd * 0.102, 0.005, 0.004), V(sd * 0.085, -0.07, 0.03), V(sd * 0.03, -0.122, 0.06), V(0, -0.128, 0.065)], [0.004, 0.004, 0.004, 0.004], 4, false, false, 1));
  }
  return mergeAll(parts.map(plain));
}

/** Bandana band around the forehead with knot and tails at the back. */
export function bandanaGeo(shape) {
  const nu = 44;
  const tmp = [0, 0, 0];
  const band = gridGeo(nu, 3, (i, j, o) => {
    const th = lerp(-Math.PI, Math.PI, i / nu);
    const front = Math.cos(th) * 0.5 + 0.5;
    const yc = lerp(0.045, 0.082, front);
    const y = yc + (j / 3 - 0.5) * lerp(0.03, 0.026, front);
    const ph = Math.acos(clamp(y / 0.118, -1, 1));
    shape.point(th, ph, tmp);
    const p = V(...tmp);
    p.addScaledVector(p.clone().normalize(), 0.0075 + 0.002 * Math.sin((j / 3) * Math.PI));
    o.p = [p.x, p.y, p.z]; o.uv = [i / nu * 4, j / 3]; o.w = [0, 1];
  });
  const parts = [band];
  const knot = new THREE.SphereGeometry(1, 10, 8);
  knot.scale(0.016, 0.013, 0.012);
  knot.translate(0, 0.045, -0.112);
  parts.push(knot);
  for (const sd of [1, -1]) {
    const pts = [V(sd * 0.006, 0.042, -0.115), V(sd * 0.018, 0.0, -0.12), V(sd * 0.026, -0.05, -0.115), V(sd * 0.03, -0.09, -0.108)];
    const t = tubeGeo(pts, [0.009, 0.011, 0.012, 0.006], 4, false, true, 1);
    t.scale(1, 1, 0.45);
    t.translate(0, 0, -0.063);
    parts.push(t);
  }
  return mergeAll(parts.map(plain));
}

/** Monk/cultist hood that drapes onto the shoulders; open at the face. */
export function hoodGeo(shape) {
  const nu = 40, nv = 22;
  const tmp = [0, 0, 0];
  const g = gridGeo(nu, nv, (i, j, o) => {
    const t = j / nv;
    // vertical param: crown -> shoulders
    const y = lerp(0.15, -0.26, t);
    const openK = sstep(0.085, 0.06, y) * (1 - sstep(-0.13, -0.2, y) * 0.35);
    const thE = lerp(0.0, 0.9, openK);
    const th = lerp(thE, Math.PI * 2 - thE, i / nu);
    let p;
    if (y > -0.09) {
      const ph = Math.acos(clamp(y / 0.15, -1, 1));
      shape.point(th, Math.min(ph, Math.PI * 0.82), tmp);
      p = V(...tmp);
      p.addScaledVector(p.clone().normalize(), 0.02 + 0.012 * sstep(0.0, 0.1, y));
      if (y > 0.1) { p.z -= (y - 0.1) * 0.5; p.y = Math.max(p.y, y + 0.02); }
    } else {
      const k = sstep(-0.09, -0.26, y);
      const rx = lerp(0.1, 0.19, k), rz = lerp(0.105, 0.14, k);
      p = V(Math.sin(th) * rx, y, Math.cos(th) * rz - 0.015);
    }
    o.p = [p.x, p.y, p.z]; o.uv = [i / nu * 3, t * 2]; o.w = [0, 1];
  });
  // rolled hem along the face opening
  const hem = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const y = lerp(-0.2, 0.072, Math.sin(t * Math.PI));
    const sd = t < 0.5 ? 1 : -1;
    const ph = Math.acos(clamp(y / 0.15, -1, 1));
    const yy = y > -0.09 ? y : y;
    shape.point(sd * 0.92, Math.min(ph, Math.PI * 0.82), tmp);
    const p = y > -0.09 ? V(...tmp).addScaledVector(V(...tmp).normalize(), 0.024) : V(sd * Math.sin(0.92) * lerp(0.1, 0.19, sstep(-0.09, -0.26, y)), yy, Math.cos(0.92) * lerp(0.105, 0.14, sstep(-0.09, -0.26, y)) - 0.015);
    if (Math.abs(t - 0.5) < 0.12) { shape.point(0, Math.acos(0.6), tmp); p.set(Math.sin((t - 0.5) * 8) * 0.06, 0.092, 0.08 + 0.02 * Math.cos((t - 0.5) * 8)); }
    hem.push(p);
  }
  void hem;
  return g;
}

/** Headscarf framing the face, knotted under the chin. */
export function scarfGeo(shape) {
  const nu = 40, nv = 20;
  const tmp = [0, 0, 0];
  const g = gridGeo(nu, nv, (i, j, o) => {
    const t = j / nv;
    const y = lerp(0.135, -0.14, t);
    const openK = sstep(0.08, 0.06, y) * sstep(-0.15, -0.125, y);
    const thE = lerp(0.0, 1.0, openK);
    const th = lerp(thE, Math.PI * 2 - thE, i / nu);
    const ph = Math.acos(clamp(y / 0.135, -1, 1));
    shape.point(th, Math.min(ph, Math.PI * 0.9), tmp);
    const p = V(...tmp);
    p.addScaledVector(p.clone().normalize(), 0.013 + 0.004 * sstep(0.0, 0.1, y));
    if (y < -0.1) { p.x *= 0.85; p.z = lerp(p.z, 0.03, sstep(-0.1, -0.14, y) * 0.5); }
    o.p = [p.x, p.y, p.z]; o.uv = [i / nu * 3, t * 2]; o.w = [0, 1];
  });
  const knot = new THREE.SphereGeometry(1, 10, 8);
  knot.scale(0.02, 0.016, 0.015);
  knot.translate(0, -0.138, 0.05);
  const flap = new THREE.ConeGeometry(0.05, 0.08, 4, 1);
  flap.scale(1.2, 1, 0.35);
  flap.rotateX(Math.PI);
  flap.translate(0, -0.13, -0.085);
  return mergeAll([g, plain(knot), plain(flap)].map(plain));
}

/** Cloth mask over the lower face. */
export function maskGeo(shape) {
  return headShell(shape, 36, 14, 0.29, 0.71, 0.52, 0.97, (s, t, p) => (p.z > -0.02 && p.y < 0.004 ? 0.006 : -0.004), 3);
}
