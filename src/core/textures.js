// Procedural texture factory. Every surface in the game is generated at load
// time from tileable noise, so the whole game ships without image assets.
import * as THREE from 'three';

// ---------------------------------------------------------------- utilities

export function rng(seed = 1) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Tileable value noise: lattice wraps at `period`.
export function vnoise(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, period, octaves = 5, seed = 0, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0, p = period, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, p, seed + i * 17);
    norm += amp;
    amp *= gain;
    f *= 2;
    p *= 2;
  }
  return sum / norm;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Builds RGB albedo, height and roughness buffers in one pass via a per-pixel
// callback, then derives a normal map from height.
function generate(size, fn, opts = {}) {
  const w = opts.w || size, h = opts.h || size;
  const albedo = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const rough = new Uint8ClampedArray(w * h * 4);
  const emis = opts.emissive ? new Uint8ClampedArray(w * h * 4) : null;
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, er: 0, eg: 0, eb: 0, metal: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.er = out.eg = out.eb = 0;
      out.metal = 0;
      fn(x, y, out);
      const i = y * w + x, j = i * 4;
      albedo[j] = out.r * 255;
      albedo[j + 1] = out.g * 255;
      albedo[j + 2] = out.b * 255;
      albedo[j + 3] = 255;
      height[i] = out.h;
      // three reads roughness from G and metalness from B
      rough[j] = 255;
      rough[j + 1] = clamp01(out.rough) * 255;
      rough[j + 2] = clamp01(out.metal) * 255;
      rough[j + 3] = 255;
      if (emis) {
        emis[j] = out.er * 255;
        emis[j + 1] = out.eg * 255;
        emis[j + 2] = out.eb * 255;
        emis[j + 3] = 255;
      }
    }
  }
  return { w, h, albedo, height, rough, emis };
}

function toTexture(data, w, h, srgb, repeat = true) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function heightToNormal(height, w, h, strength = 2) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = height[y * w + ((x - 1 + w) % w)];
      const xr = height[y * w + ((x + 1) % w)];
      const yu = height[((y - 1 + h) % h) * w + x];
      const yd = height[((y + 1) % h) * w + x];
      let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const j = (y * w + x) * 4;
      out[j] = (nx * 0.5 + 0.5) * 255;
      out[j + 1] = (ny * 0.5 + 0.5) * 255;
      out[j + 2] = (nz * 0.5 + 0.5) * 255;
      out[j + 3] = 255;
    }
  }
  return out;
}

function pack(g, normalStrength = 2) {
  const set = {
    map: toTexture(g.albedo, g.w, g.h, true),
    normalMap: toTexture(heightToNormal(g.height, g.w, g.h, normalStrength), g.w, g.h, false),
    roughnessMap: toTexture(g.rough, g.w, g.h, false),
  };
  set.metalnessMap = set.roughnessMap;
  if (g.emis) set.emissiveMap = toTexture(g.emis, g.w, g.h, true);
  return set;
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

const hex = (c) => {
  const col = new THREE.Color(c);
  return [col.r, col.g, col.b];
};

// ----------------------------------------------------------------- surfaces

export function brick({ color = '#7a3b2c', mortar = '#8d877c', size = 512, cols = 8, rows = 16, seed = 3, grime = 0.5, wet = 0 } = {}) {
  return cached(`brick${color}${mortar}${size}${cols}${rows}${seed}${grime}${wet}`, () => {
    const R = rng(seed);
    const bc = hex(color), mc = hex(mortar);
    const tints = [];
    for (let i = 0; i < cols * rows * 2; i++) tints.push([0.75 + R() * 0.4, R(), R()]);
    const bw = size / cols, bh = size / rows, mw = Math.max(2, size / 170);
    const g = generate(size, (x, y, o) => {
      const row = Math.floor(y / bh);
      const off = (row % 2) * bw * 0.5;
      const xx = (x + off) % size;
      const col = Math.floor(xx / bw);
      const lx = xx - col * bw, ly = y - row * bh;
      const edge = Math.min(lx, bw - lx, ly, bh - ly);
      const n = fbm(x / size * 8, y / size * 8, 8, 4, seed);
      const n2 = fbm(x / size * 32, y / size * 32, 32, 3, seed + 9);
      const isMortar = edge < mw + n2 * 1.5;
      const t = tints[(row * cols + col) % tints.length];
      const dirt = fbm(x / size * 3, y / size * 3, 3, 4, seed + 4);
      const streak = fbm(x / size * 24, y / size * 1.5, 24, 3, seed + 21) * (y / size);
      const g0 = 1 - grime * (dirt * 0.55 + streak * 0.5);
      if (isMortar) {
        const m = 0.8 + n2 * 0.3;
        o.r = mc[0] * m * g0; o.g = mc[1] * m * g0; o.b = mc[2] * m * g0;
        o.h = 0.1 + n2 * 0.1;
        o.rough = 0.95;
      } else {
        const k = t[0] * (0.82 + n2 * 0.3) * g0;
        const chip = n2 > 0.72 ? 0.8 : 1;
        o.r = bc[0] * k * chip; o.g = bc[1] * k * (0.95 + t[1] * 0.1) * chip; o.b = bc[2] * k * chip;
        o.h = 0.55 + Math.min(edge / 6, 1) * 0.35 + n2 * 0.15 - (chip < 1 ? 0.2 : 0);
        o.rough = 0.82 - wet * (1 - dirt) * 0.5;
      }
    });
    return pack(g, 3);
  });
}

export function concrete({ color = '#77757a', size = 512, seed = 7, stain = 0.6, seams = true, wet = 0 } = {}) {
  return cached(`concrete${color}${size}${seed}${stain}${seams}${wet}`, () => {
    const c = hex(color);
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 4, v * 4, 4, 5, seed);
      const fine = fbm(u * 64, v * 64, 64, 2, seed + 5);
      const st = fbm(u * 6, v * 1.2, 6, 4, seed + 11);
      const pits = fine > 0.78 ? 0.75 : 1;
      let k = (0.78 + n * 0.35) * pits * (1 - stain * Math.max(0, st - 0.45) * 1.2);
      let hgt = n * 0.4 + fine * 0.2 - (pits < 1 ? 0.3 : 0);
      if (seams) {
        const sx = Math.min(u % 0.5, 0.5 - (u % 0.5)) * size;
        const sy = Math.min(v % 0.5, 0.5 - (v % 0.5)) * size;
        if (sx < 1.5 || sy < 1.5) { k *= 0.6; hgt -= 0.4; }
      }
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
      o.h = hgt;
      o.rough = 0.88 - wet * (1 - st) * 0.55;
    });
    return pack(g, 2);
  });
}

export function asphalt({ size = 1024, seed = 13 } = {}) {
  return cached(`asphalt${size}${seed}`, () => {
    const R = rng(seed);
    // crack polylines
    const crackMask = new Float32Array(size * size);
    for (let k = 0; k < 26; k++) {
      let x = R() * size, y = R() * size, a = R() * Math.PI * 2;
      const len = 40 + R() * 220;
      for (let s = 0; s < len; s++) {
        a += (R() - 0.5) * 0.6;
        x += Math.cos(a); y += Math.sin(a);
        const xi = ((Math.floor(x) % size) + size) % size, yi = ((Math.floor(y) % size) + size) % size;
        crackMask[yi * size + xi] = 1;
        if (R() < 0.3) crackMask[yi * size + ((xi + 1) % size)] = 0.6;
      }
    }
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 6, v * 6, 6, 5, seed);
      const agg = hash2(x, y, seed);
      const big = fbm(u * 2, v * 2, 2, 4, seed + 3);
      const patch = big > 0.62 ? 0.82 : 1;
      let k = 0.11 + n * 0.07 + (agg > 0.93 ? 0.09 : 0) + (agg < 0.05 ? -0.03 : 0);
      k *= patch;
      const crack = crackMask[y * size + x];
      if (crack) k *= 0.4;
      o.r = k; o.g = k * 1.01; o.b = k * 1.05;
      o.h = n * 0.3 + agg * 0.25 - crack * 0.6;
      o.rough = 0.62 + n * 0.3;
    });
    return pack(g, 2.5);
  });
}

// Puddle mask: white = standing water (mirror-like), black = rough asphalt.
export function puddleMask({ size = 512, seed = 31, coverage = 0.5 } = {}) {
  return cached(`puddle${size}${seed}${coverage}`, () => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x / size * 5, y / size * 5, 5, 5, seed);
        const t = clamp01((n - (1 - coverage) * 0.75 - 0.15) * 7);
        const j = (y * size + x) * 4;
        data[j] = data[j + 1] = data[j + 2] = t * 255;
        data[j + 3] = 255;
      }
    }
    return toTexture(data, size, size, false);
  });
}

export function metalPlate({ color = '#5b5f64', size = 512, seed = 17, rust = 0.3, diamond = true } = {}) {
  return cached(`metal${color}${size}${seed}${rust}${diamond}`, () => {
    const c = hex(color);
    const rc = hex('#6b3418');
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 6, v * 6, 6, 5, seed);
      const scratch = fbm(u * 80, v * 3, 80, 2, seed + 4);
      const r = clamp01((fbm(u * 3, v * 3, 3, 5, seed + 9) - (1 - rust) * 0.7 - 0.2) * 4);
      let hgt = n * 0.1;
      if (diamond) {
        const gx = (u * 16) % 1, gy = (v * 16) % 1;
        const ox = Math.floor(v * 16) % 2 ? 0.5 : 0;
        const dx = Math.abs(((gx + ox) % 1) - 0.5), dy = Math.abs(gy - 0.5);
        if (dx * 0.6 + dy * 1.3 < 0.18 && Math.abs(dx - dy * 0.4) < 0.12) hgt += 0.6;
      }
      const k = 0.75 + n * 0.3 + scratch * 0.1;
      o.r = (c[0] * (1 - r) + rc[0] * r) * k;
      o.g = (c[1] * (1 - r) + rc[1] * r) * k;
      o.b = (c[2] * (1 - r) + rc[2] * r) * k;
      o.h = hgt + r * 0.15;
      o.rough = 0.35 + n * 0.25 + r * 0.5;
      o.metal = 1 - r * 0.9;
    });
    return pack(g, 3);
  });
}

// Open metal grating (fire escapes, catwalks). Alpha in map's alpha channel.
export function grating({ size = 256, seed = 23, color = '#2b2d30' } = {}) {
  return cached(`grating${size}${seed}${color}`, () => {
    const c = hex(color);
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const cell = size / 8, bar = Math.max(2, size / 64);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const lx = x % cell, ly = y % (cell * 0.5);
        const solid = lx < bar || ly < bar * 0.8;
        const n = fbm(x / size * 4, y / size * 4, 4, 3, seed);
        const j = (y * size + x) * 4;
        const k = 0.7 + n * 0.5;
        img.data[j] = c[0] * 255 * k; img.data[j + 1] = c[1] * 255 * k; img.data[j + 2] = c[2] * 255 * k;
        img.data[j + 3] = solid ? 255 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return { map: t };
  });
}

export function wood({ color = '#7b5434', size = 512, seed = 41, planks = 6, weathered = 0.5, vertical = true } = {}) {
  return cached(`wood${color}${size}${seed}${planks}${weathered}${vertical}`, () => {
    const c = hex(color);
    const R = rng(seed);
    const tint = Array.from({ length: planks }, () => 0.75 + R() * 0.4);
    const g = generate(size, (x0, y0, o) => {
      const x = vertical ? x0 : y0, y = vertical ? y0 : x0;
      const pw = size / planks;
      const p = Math.floor(x / pw);
      const lx = x - p * pw;
      const grain = fbm(x / size * 40, y / size * 2.5, 40, 4, seed + p * 3);
      const ring = Math.sin((grain * 12 + lx * 0.05) * Math.PI) * 0.5 + 0.5;
      const gap = lx < 2.5 || lx > pw - 1.5;
      const weather = fbm(x / size * 5, y / size * 5, 5, 4, seed + 7);
      const k = tint[p] * (0.7 + ring * 0.25 + grain * 0.2) * (1 - weathered * weather * 0.5);
      const grey = weathered * weather * 0.6;
      o.r = gap ? 0.04 : c[0] * k * (1 - grey) + 0.42 * k * grey;
      o.g = gap ? 0.03 : c[1] * k * (1 - grey) + 0.40 * k * grey;
      o.b = gap ? 0.02 : c[2] * k * (1 - grey) + 0.36 * k * grey;
      o.h = gap ? 0 : 0.5 + grain * 0.3 + ring * 0.1;
      o.rough = 0.75 + weather * 0.2;
    }, {});
    return pack(g, 2.5);
  });
}

export function corrugated({ color = '#8a8f94', size = 512, seed = 51, rust = 0.4, ribs = 24 } = {}) {
  return cached(`corr${color}${size}${seed}${rust}${ribs}`, () => {
    const c = hex(color);
    const rc = hex('#7a3a16');
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const rib = Math.sin(u * ribs * Math.PI * 2) * 0.5 + 0.5;
      const streak = fbm(u * 30, v * 2, 30, 4, seed);
      const r = clamp01((fbm(u * 4, v * 4, 4, 5, seed + 3) * 0.6 + streak * 0.6 * v - (1 - rust) * 0.8) * 3);
      const k = 0.6 + rib * 0.4;
      o.r = (c[0] * (1 - r) + rc[0] * r) * k;
      o.g = (c[1] * (1 - r) + rc[1] * r) * k;
      o.b = (c[2] * (1 - r) + rc[2] * r) * k;
      o.h = rib;
      o.rough = 0.4 + r * 0.5;
      o.metal = 0.8 - r * 0.7;
    });
    return pack(g, 4);
  });
}

export function stucco({ color = '#b9a68a', size = 512, seed = 61, stain = 0.5 } = {}) {
  return cached(`stucco${color}${size}${seed}${stain}`, () => {
    const c = hex(color);
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 48, v * 48, 48, 3, seed);
      const big = fbm(u * 3, v * 3, 3, 5, seed + 2);
      const drip = fbm(u * 20, v * 1.5, 20, 3, seed + 5) * v;
      const k = (0.85 + n * 0.2) * (1 - stain * (big * 0.4 + drip * 0.5));
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
      o.h = n;
      o.rough = 0.92;
    });
    return pack(g, 1.5);
  });
}

// Hay / straw surface for bales.
export function hay({ size = 256, seed = 71 } = {}) {
  return cached(`hay${size}${seed}`, () => {
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const s = fbm(u * 64, v * 6, 64, 4, seed);
      const s2 = fbm(u * 6, v * 64, 6, 3, seed + 3);
      const k = 0.55 + s * 0.5 + s2 * 0.15;
      o.r = 0.86 * k; o.g = 0.68 * k; o.b = 0.32 * k;
      o.h = s;
      o.rough = 0.95;
    });
    return pack(g, 3);
  });
}

export function grass({ size = 512, seed = 81, dry = 0.3 } = {}) {
  return cached(`grass${size}${seed}${dry}`, () => {
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 8, v * 8, 8, 5, seed);
      const blade = fbm(u * 128, v * 128, 128, 2, seed + 4);
      const d = clamp01(fbm(u * 3, v * 3, 3, 4, seed + 8) * 1.4 - 0.5 + dry);
      const k = 0.55 + n * 0.4 + blade * 0.25;
      o.r = (0.22 * (1 - d) + 0.55 * d) * k;
      o.g = (0.36 * (1 - d) + 0.45 * d) * k;
      o.b = (0.10 * (1 - d) + 0.22 * d) * k;
      o.h = blade + n * 0.3;
      o.rough = 0.9;
    });
    return pack(g, 2);
  });
}

export function dirt({ size = 512, seed = 91, color = '#6d5236' } = {}) {
  return cached(`dirt${size}${seed}${color}`, () => {
    const c = hex(color);
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 6, v * 6, 6, 5, seed);
      const peb = hash2(x, y, seed);
      const rut = Math.abs(Math.sin(v * Math.PI * 4 + n * 2));
      const k = 0.65 + n * 0.45 + (peb > 0.96 ? 0.25 : 0) - rut * 0.1;
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k;
      o.h = n * 0.6 + (peb > 0.96 ? 0.3 : 0);
      o.rough = 0.95;
    });
    return pack(g, 2.5);
  });
}

// ------------------------------------------------------------ facades

// Window facade for building fronts. Emissive map holds lit windows.
// Returns texture set covering `floors` x `bays` windows; uv 0..1 spans the whole facade.
export function facade({
  wall = '#4a4f57', kind = 'brick', floors = 6, bays = 4, seed = 5,
  litRatio = 0.35, warm = 0.7, w = 512, h = 1024, frame = '#1c1d20', glass = '#0d1420',
  storefront = false,
} = {}) {
  return cached(`facade${wall}${kind}${floors}${bays}${seed}${litRatio}${warm}${w}${h}${storefront}`, () => {
    const R = rng(seed);
    const wc = hex(wall), fc = hex(frame), gc = hex(glass);
    const lit = [];
    for (let i = 0; i < floors * bays; i++) {
      const on = R() < litRatio;
      const col = R() < warm ? [1.0, 0.72 + R() * 0.15, 0.38 + R() * 0.2] : [0.55, 0.75 + R() * 0.1, 1.0];
      const blinds = R() < 0.35;
      const silhouette = on && R() < 0.15;
      lit.push({ on, col, blinds, k: 0.5 + R() * 0.5, curtain: R() < 0.3, silhouette, sx: R() });
    }
    const fh = h / floors, bw = w / bays;
    const g = generate(0, (x, y, o) => {
      const u = x / w, v = y / h;
      const fl = Math.floor(y / fh), bay = Math.floor(x / bw);
      const lx = (x - bay * bw) / bw, ly = (y - fl * fh) / fh;
      // wall base
      let n, br;
      if (kind === 'brick') {
        const bh = h / (floors * 9), bwk = bw / 3.2;
        const row = Math.floor(y / bh);
        const xx = x + (row % 2) * bwk * 0.5;
        const ex = Math.min(xx % bwk, bwk - (xx % bwk)), ey = Math.min(y % bh, bh - (y % bh));
        const mortar = ex < 1.2 || ey < 1.2;
        n = fbm(u * 10, v * 20, 10, 3, seed);
        br = mortar ? 0.55 : 0.85 + hash2(Math.floor(xx / bwk), row, seed) * 0.25;
        o.h = mortar ? 0.1 : 0.6;
      } else if (kind === 'panel') {
        n = fbm(u * 12, v * 24, 12, 3, seed);
        const seam = (x % (bw / 2)) < 1.5 || (y % (fh / 2)) < 1.5;
        br = seam ? 0.6 : 0.9 + n * 0.15;
        o.h = seam ? 0 : 0.5;
      } else {
        n = fbm(u * 24, v * 48, 24, 3, seed);
        br = 0.88 + n * 0.2;
        o.h = n * 0.3;
      }
      const grime = fbm(u * 3, v * 6, 3, 4, seed + 3) * 0.35 + fbm(u * 20, v * 2, 20, 3, seed + 7) * v * 0.25;
      o.r = wc[0] * br * (1 - grime); o.g = wc[1] * br * (1 - grime); o.b = wc[2] * br * (1 - grime);
      o.rough = 0.9;
      const ground = storefront && fl === floors - 1;
      // window rect inside bay
      const wx0 = ground ? 0.08 : 0.22, wx1 = ground ? 0.92 : 0.78, wy0 = ground ? 0.12 : 0.18, wy1 = ground ? 0.88 : 0.78;
      if (lx > wx0 - 0.04 && lx < wx1 + 0.04 && ly > wy0 - 0.04 && ly < wy1 + 0.06) {
        const inGlass = lx > wx0 && lx < wx1 && ly > wy0 && ly < wy1;
        if (!inGlass) {
          // frame + sill
          const sill = ly > wy1;
          o.r = fc[0] * (sill ? 1.4 : 1); o.g = fc[1] * (sill ? 1.4 : 1); o.b = fc[2] * (sill ? 1.4 : 1);
          o.h = 0.9; o.rough = 0.6;
        } else {
          const L = lit[(fl * bays + bay) % lit.length];
          const gx = (lx - wx0) / (wx1 - wx0), gy = (ly - wy0) / (wy1 - wy0);
          const mullion = Math.abs(gx - 0.5) < 0.025 || Math.abs(gy - 0.45) < 0.025;
          if (mullion) {
            o.r = fc[0]; o.g = fc[1]; o.b = fc[2]; o.h = 0.8; o.rough = 0.6;
          } else {
            const refl = 0.25 + (1 - gy) * 0.35 + fbm(u * 2, v * 2, 2, 2, seed + 13) * 0.2;
            o.r = gc[0] * refl; o.g = gc[1] * refl; o.b = gc[2] * refl;
            o.h = 0.2; o.rough = 0.08; o.metal = 0.0;
            if (L.on) {
              let e = L.k * (0.6 + 0.4 * (1 - gy));
              if (L.blinds && (gy * 14) % 1 < 0.35) e *= 0.25;
              if (L.curtain && (gx < 0.18 || gx > 0.82)) e *= 0.35;
              if (L.silhouette) {
                const dx = gx - (0.3 + L.sx * 0.4), dy = gy - 0.55;
                if ((dx * dx) / 0.012 + (dy * dy) / 0.12 < 1 || (dx * dx + (gy - 0.25) ** 2) < 0.006) e *= 0.08;
              }
              o.er = L.col[0] * e; o.eg = L.col[1] * e; o.eb = L.col[2] * e;
              o.r = o.r * 0.3 + L.col[0] * e * 0.4; o.g = o.g * 0.3 + L.col[1] * e * 0.4; o.b = o.b * 0.3 + L.col[2] * e * 0.4;
            }
          }
        }
      }
    }, { w, h, emissive: true });
    return pack(g, 2);
  });
}

// ------------------------------------------------------------- neon signs

// Neon sign rendered to a canvas: returns {texture, aspect}. Bright tube core over a soft
// halo; intended as emissive map on a transparent plane (bloom does the rest).
export function neonSign(text, { color = '#ff2a6d', font = '700 120px "Teko", "Arial Narrow", sans-serif', script = false, border = true, sub = '' } = {}) {
  return cached(`neon${text}${color}${font}${border}${sub}`, () => {
    const pad = 40;
    const measure = makeCanvas(8, 8).getContext('2d');
    measure.font = font;
    const tw = measure.measureText(text).width;
    const subFont = font.replace(/\d+px/, (m) => `${Math.round(parseInt(m) * 0.38)}px`);
    measure.font = subFont;
    const sw = sub ? measure.measureText(sub).width : 0;
    const fontPx = parseInt(font.match(/(\d+)px/)[1]);
    const W = Math.ceil(Math.max(tw, sw) + pad * 2 + (border ? 40 : 0));
    const H = Math.ceil(fontPx * (sub ? 1.55 : 1.15) + pad * 2);
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const draw = (blur, width, style, alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.font = font;
      const ty = sub ? H * 0.42 : H / 2;
      ctx.strokeText(text, W / 2, ty);
      if (sub) {
        ctx.font = subFont;
        ctx.strokeText(sub, W / 2, H * 0.8);
      }
      if (border) {
        const r = 22;
        ctx.beginPath();
        ctx.roundRect(14, 14, W - 28, H - 28, r);
        ctx.stroke();
      }
      ctx.restore();
    };
    draw(30, 10, color, 0.55);
    draw(12, 6, color, 0.9);
    draw(0, 2.4, '#ffffff', 0.95);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { texture: t, aspect: W / H, canvas: c };
  });
}

// Painted billboard / poster with arbitrary drawing callback.
export function painted(key, w, h, draw) {
  return cached(`painted${key}`, () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

// Soft radial sprite for particles/glows.
export function radial(size = 128, inner = 0.0, falloff = 2.2) {
  return cached(`radial${size}${inner}${falloff}`, () => {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = d < inner ? 1 : Math.pow(clamp01(1 - (d - inner) / (1 - inner)), falloff);
        const j = (y * size + x) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
        img.data[j + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    return t;
  });
}

// Puffy smoke sprite (noise-shaped alpha) for steam/smoke particles.
export function smokeSprite(size = 128, seed = 101) {
  return cached(`smoke${size}${seed}`, () => {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
        const d = Math.sqrt(dx * dx + dy * dy);
        const n = fbm(x / size * 4, y / size * 4, 4, 5, seed);
        const a = clamp01((1 - d) * 1.6 - 0.2) * clamp01(n * 1.8 - 0.25);
        const j = (y * size + x) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
        img.data[j + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  });
}

// Rain-ripple normal atlas is animated in shader; this returns a tiling noise normal
// used for ground micro-detail and water disturbance.
export function noiseNormal(size = 256, seed = 111, scale = 8, strength = 3) {
  return cached(`nn${size}${seed}${scale}${strength}`, () => {
    const hgt = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hgt[y * size + x] = fbm(x / size * scale, y / size * scale, scale, 4, seed);
    const t = toTexture(heightToNormal(hgt, size, size, strength), size, size, false);
    return t;
  });
}

// Tileable monochrome fbm texture (for shaders: clouds, smoke, heat haze).
export function noiseTexture(size = 256, seed = 121, scale = 4, octaves = 5) {
  return cached(`noise${size}${seed}${scale}${octaves}`, () => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const j = (y * size + x) * 4;
        data[j] = fbm(x / size * scale, y / size * scale, scale, octaves, seed) * 255;
        data[j + 1] = fbm(x / size * scale, y / size * scale, scale, octaves, seed + 50) * 255;
        data[j + 2] = vnoise(x / size * scale * 8, y / size * scale * 8, scale * 8, seed + 99) * 255;
        data[j + 3] = 255;
      }
    }
    return toTexture(data, size, size, false);
  });
}

// ------------------------------------------------------- factory (appended)

// Riveted steel plating: square panels with seam grooves, domed rivet rows inset along
// every seam, rust weeping from rivets, soot blotches and optional heat-temper tint.
export function rivetPlate({ color = '#4e5358', size = 512, seed = 201, rust = 0.3, panels = 2, soot = 0.3, heat = 0, pitch = 24 } = {}) {
  return cached(`rivet${color}${size}${seed}${rust}${panels}${soot}${heat}${pitch}`, () => {
    const c = hex(color), rc = hex('#6e3415'), sc = hex('#141110');
    const temper = [hex('#a47c3c'), hex('#5c3a70'), hex('#2d4f86')];
    const pw = size / panels, step = size / pitch, inset = step * 0.55, rr = step * 0.24;
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 6, v * 6, 6, 5, seed);
      const fine = fbm(u * 64, v * 64, 64, 2, seed + 3);
      const px = x % pw, py = y % pw;
      const tint = 0.86 + hash2(Math.floor(x / pw), Math.floor(y / pw), seed) * 0.22;
      const ex = Math.min(px, pw - px), ey = Math.min(py, pw - py);
      let hgt = 0.4 + n * 0.08 + fine * 0.05;
      const seam = Math.min(ex, ey) < 1.6;
      if (seam) hgt = 0.05;
      const ly = (y % step) - step / 2, lx = (x % step) - step / 2;
      const d = Math.min(Math.hypot(ex - inset, ly), Math.hypot(ey - inset, lx));
      const riv = d < rr ? Math.sqrt(1 - (d / rr) ** 2) : 0;
      hgt += riv * 0.55;
      let r = clamp01((fbm(u * 3, v * 3, 3, 5, seed + 9) - (1 - rust) * 0.7 - 0.2) * 4);
      const weep = Math.exp(-Math.abs(ex - inset) / 2.5) * clamp01(fbm(u * 40, v * 3, 40, 3, seed + 5) * 1.8 - 0.75);
      r = clamp01(r + weep * rust * 1.4 + (d < rr * 1.7 ? rust * 0.35 : 0));
      const s = soot * clamp01(fbm(u * 4, v * 4, 4, 4, seed + 13) * 1.7 - 0.45);
      const k = (0.72 + n * 0.32 + fine * 0.08) * tint * (seam ? 0.55 : 1) * (riv > 0 ? 0.9 + riv * 0.25 : 1);
      let cr = c[0], cg = c[1], cb = c[2];
      if (heat > 0) {
        const hm = heat * clamp01(fbm(u * 2.5, v * 2.5, 2.5, 4, seed + 21) * 2.2 - 0.7);
        const ti = fbm(u * 5, v * 5, 5, 3, seed + 23) * 2.99;
        const tc = temper[Math.floor(ti)];
        cr += (tc[0] - cr) * hm; cg += (tc[1] - cg) * hm; cb += (tc[2] - cb) * hm;
      }
      o.r = ((cr * (1 - r) + rc[0] * r) * (1 - s) + sc[0] * s) * k;
      o.g = ((cg * (1 - r) + rc[1] * r) * (1 - s) + sc[1] * s) * k;
      o.b = ((cb * (1 - r) + rc[2] * r) * (1 - s) + sc[2] * s) * k;
      o.h = hgt + r * 0.1;
      o.rough = 0.42 + n * 0.2 + r * 0.45 + s * 0.3;
      o.metal = clamp01(1 - r * 0.9 - s * 0.6);
    });
    return pack(g, 3);
  });
}

// Conveyor belt rubber: u runs along the belt, raised chevron cleats every size/cleats px,
// worn edges and scale dust.
export function beltRubber({ size = 256, seed = 211, cleats = 2 } = {}) {
  return cached(`belt${size}${seed}${cleats}`, () => {
    const cp = size / cleats;
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const n = fbm(u * 8, v * 8, 8, 4, seed);
      const fine = hash2(x, y, seed);
      const ay = Math.abs(y - size / 2);
      const chev = (x + ay * 0.7) % cp;
      const cleat = chev < cp * 0.12 && ay < size * 0.4;
      const edge = Math.min(y, size - y) < size * 0.05;
      const dust = clamp01(fbm(u * 4, v * 4, 4, 4, seed + 7) * 1.7 - 0.7) + (edge ? 0.25 : 0);
      const k = 0.06 + n * 0.04 + fine * 0.02 + (cleat ? 0.03 : 0);
      o.r = k + dust * 0.14; o.g = k * 0.97 + dust * 0.1; o.b = k * 0.94 + dust * 0.08;
      o.h = cleat ? 0.85 - (chev / cp) * 0.6 : 0.2 + n * 0.1 + fine * 0.05;
      o.rough = cleat ? 0.6 : 0.85;
    });
    return pack(g, 3);
  });
}

// ------------------------------------------------------- rural (appended)

// Asphalt roof shingles: staggered 3-tab rows with keyways, granule speckle, per-tab tint,
// a raised butt edge casting a thin shadow on the row below, and moss/bleaching blotches.
export function shingles({ color = '#4a4541', size = 512, seed = 301, rows = 16, tabs = 6, moss = 0.25 } = {}) {
  return cached(`shingles${color}${size}${seed}${rows}${tabs}${moss}`, () => {
    const c = hex(color), mc = hex('#4d5a2e');
    const rh = size / rows, tw = size / tabs;
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const row = Math.floor(y / rh), ly = (y - row * rh) / rh;
      const xx = (x + (row % 2) * tw * 0.5 + (row % 3) * tw * 0.17) % size;
      const tab = Math.floor(xx / tw), lx = xx - tab * tw;
      const tint = 0.78 + hash2(tab, row, seed) * 0.4;
      const gran = hash2(x, y, seed + 3);
      const n = fbm(u * 6, v * 6, 6, 4, seed + 5);
      const keyway = ly > 0.45 && (lx < 2.2 || Math.abs(lx - tw * 0.5) < 1.1);
      const shadow = ly < 0.14 ? 0.45 + ly * 3.5 : 1;
      const bleach = clamp01(fbm(u * 3, v * 3, 3, 4, seed + 9) * 1.8 - 0.8);
      const m = moss * clamp01(fbm(u * 5, v * 5, 5, 4, seed + 11) * 2 - 1.0) * (0.5 + ly * 0.5);
      let k = tint * (0.8 + gran * 0.35 + n * 0.15) * shadow * (1 + bleach * 0.35);
      if (keyway) k *= 0.35;
      o.r = (c[0] * (1 - m) + mc[0] * m) * k;
      o.g = (c[1] * (1 - m) + mc[1] * m) * k;
      o.b = (c[2] * (1 - m) + mc[2] * m) * k;
      o.h = keyway ? 0.05 : 0.25 + ly * 0.55 + gran * 0.12;
      o.rough = 0.9 - gran * 0.1;
    });
    return pack(g, 3);
  });
}

// Tree bark: vertical fissured ridges (u around the trunk, v along it), lichen speckles.
export function bark({ color = '#5e5145', size = 256, seed = 313, fissure = 1, lichen = 0.3 } = {}) {
  return cached(`bark${color}${size}${seed}${fissure}${lichen}`, () => {
    const c = hex(color), lc = hex('#8c9568');
    const g = generate(size, (x, y, o) => {
      const u = x / size, v = y / size;
      const w = fbm(u * 4, v * 2, 4, 3, seed + 7) * 0.6;
      const r = fbm(u * 12 + w, v * 1.5, 12, 4, seed);
      const ridge = Math.abs(r - 0.5) * 2;
      const fiss = clamp01((0.32 - ridge) * 6 * fissure);
      const fine = fbm(u * 48, v * 16, 48, 2, seed + 3);
      const l = lichen * clamp01(fbm(u * 8, v * 8, 8, 4, seed + 11) * 2.4 - 1.35) * (1 - fiss);
      const k = (0.7 + ridge * 0.45 + fine * 0.2) * (1 - fiss * 0.75);
      o.r = (c[0] * (1 - l) + lc[0] * l) * k;
      o.g = (c[1] * (1 - l) + lc[1] * l) * k;
      o.b = (c[2] * (1 - l) + lc[2] * l) * k;
      o.h = ridge * 0.7 + fine * 0.2 - fiss * 0.5;
      o.rough = 0.92;
    });
    return pack(g, 3.5);
  });
}

// Leaf cluster card (RGBA, alpha-tested foliage). A spray of pointed leaves on twigs radiating
// from the centre, darker toward the bottom/core for self-shadowing. `hue` 0.2..0.35, `dry` 0..1.
export function leafCard({ size = 256, seed = 321, leaves = 70, hue = 0.27, dry = 0.15, shape = 'oak' } = {}) {
  return cached(`leaf${size}${seed}${leaves}${hue}${dry}${shape}`, () => {
    const R = rng(seed);
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const C = size / 2;
    ctx.lineCap = 'round';
    // twigs
    ctx.strokeStyle = 'rgba(62,48,34,1)';
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2, l = size * (0.25 + R() * 0.2);
      ctx.lineWidth = size * 0.012;
      ctx.beginPath(); ctx.moveTo(C, C); ctx.quadraticCurveTo(C + Math.cos(a + 0.3) * l * 0.5, C + Math.sin(a + 0.3) * l * 0.5, C + Math.cos(a) * l, C + Math.sin(a) * l); ctx.stroke();
    }
    const list = [];
    for (let i = 0; i < leaves; i++) {
      const rr = Math.sqrt(R()) * size * 0.4, a = R() * Math.PI * 2;
      list.push({ x: C + Math.cos(a) * rr, y: C + Math.sin(a) * rr, a: a + (R() - 0.5) * 1.4, r: rr / (size * 0.4), k: R() });
    }
    list.sort((p, q) => p.y - q.y);
    for (const L of list) {
      const len = size * (shape === 'poplar' ? 0.07 : 0.09) * (0.75 + L.k * 0.5), wid = len * (shape === 'poplar' ? 0.62 : 0.42);
      const shade = 0.55 + 0.45 * (1 - L.y / size) * 0.7 + L.r * 0.25;
      const h = (hue + (R() - 0.5) * 0.05 - dry * 0.12 * R()) * 360;
      const s = 38 + R() * 22 - dry * 10, li = (18 + R() * 16 + dry * 8) * shade;
      ctx.save();
      ctx.translate(L.x, L.y); ctx.rotate(L.a);
      ctx.fillStyle = `hsl(${h},${s}%,${li}%)`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
      ctx.quadraticCurveTo(len * 0.45, wid, 0, 0);
      ctx.fill();
      ctx.strokeStyle = `hsla(${h},${s}%,${li * 1.35}%,0.8)`;
      ctx.lineWidth = Math.max(1, size / 256);
      ctx.beginPath(); ctx.moveTo(len * 0.05, 0); ctx.lineTo(len * 0.85, 0); ctx.stroke();
      // sun-catching upper edge
      ctx.strokeStyle = `hsla(${h - 8},${s + 10}%,${Math.min(70, li * 1.8)}%,0.55)`;
      ctx.beginPath(); ctx.moveTo(len * 0.1, -wid * 0.35); ctx.quadraticCurveTo(len * 0.45, -wid * 0.95, len * 0.92, -wid * 0.08); ctx.stroke();
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { map: t };
  });
}

// ------------------------------------------------------- city props (appended)

// One room behind a window at night, painted into the cell (x, y, w, h).
function paintWindowRoom(c, x, y, w, h, type, R) {
  const lin = (stops) => {
    const g = c.createLinearGradient(0, y, 0, y + h);
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  };
  const blob = (cx, cy, r, col) => {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  };
  const curtains = (col, open) => {
    for (const side of [0, 1]) {
      const cw = w * (0.5 - open);
      const x0 = side ? x + w - cw : x;
      c.fillStyle = col;
      c.beginPath();
      if (side) { c.moveTo(x + w, y); c.lineTo(x0, y); c.quadraticCurveTo(x0 + cw * 0.5, y + h * 0.55, x0 + cw * 0.3, y + h); c.lineTo(x + w, y + h); }
      else { c.moveTo(x, y); c.lineTo(x0 + cw, y); c.quadraticCurveTo(x0 + cw * 0.5, y + h * 0.55, x0 + cw * 0.7, y + h); c.lineTo(x, y + h); }
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.28)';
      for (let k = 1; k < 5; k++) c.fillRect(x0 + (cw * k) / 5, y, Math.max(1, cw * 0.06), h);
    }
  };
  if (type.startsWith('dark')) {
    c.fillStyle = lin([[0, '#1d2636'], [0.5, '#0d111a'], [1, '#050608']]);
    c.fillRect(x, y, w, h);
    blob(x + w * R(), y + h * (0.2 + R() * 0.3), w * 0.9, R() < 0.5 ? 'rgba(255,60,150,0.16)' : 'rgba(60,200,255,0.14)');
    if (type === 'darkCurtain') curtains(R() < 0.5 ? '#2a1414' : '#1a2018', 0.12 + R() * 0.2);
    if (type === 'darkBlinds') {
      c.fillStyle = 'rgba(120,120,110,0.18)';
      for (let yy = y + 4; yy < y + h * 0.75; yy += 7) c.fillRect(x, yy, w, 3);
    }
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.beginPath();
    c.moveTo(x + w * 0.2, y); c.lineTo(x + w * 0.55, y); c.lineTo(x + w * 0.05, y + h * 0.7); c.lineTo(x - w * 0.3, y + h * 0.7);
    c.fill();
    return;
  }
  const warmWalls = [['#4a2616', '#d8964e', '#2c170c'], ['#3c2a1a', '#c9a066', '#20140c'], ['#4a2e28', '#d88a6a', '#28140e']];
  let pal = warmWalls[Math.floor(R() * warmWalls.length)];
  if (type === 'cool') pal = ['#26343a', '#7f9ca2', '#141c20'];
  if (type === 'tv') pal = ['#06080f', '#101830', '#05060a'];
  if (type === 'neon') pal = ['#0e050c', '#3a1430', '#070306'];
  c.fillStyle = lin([[0, pal[0]], [0.45, pal[1]], [0.78, pal[1]], [1, pal[2]]]);
  c.fillRect(x, y, w, h);
  if (type === 'tv') blob(x + w * 0.3, y + h * 0.8, w * 0.9, 'rgba(90,140,255,0.85)');
  else if (type === 'neon') { blob(x + w * 1.05, y + h * 0.35, w * 0.8, 'rgba(255,70,170,0.65)'); blob(x + w * 0.9, y + h * 0.6, w * 0.4, 'rgba(120,220,255,0.25)'); }
  else blob(x + w * (0.25 + R() * 0.5), y + h * 0.5, w * 0.7, type === 'cool' ? 'rgba(220,250,255,0.4)' : 'rgba(255,230,170,0.75)');
  // ceiling shadow, picture frame, door, furniture silhouettes
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(x, y, w, h * 0.12);
  c.fillStyle = 'rgba(30,18,10,0.55)';
  if (R() < 0.6) c.fillRect(x + w * (0.15 + R() * 0.5), y + h * 0.3, w * 0.22, h * 0.13);
  if (R() < 0.4) { c.fillStyle = 'rgba(255,240,210,0.25)'; c.fillRect(x + w * 0.62, y + h * 0.18, w * 0.24, h * 0.62); }
  c.fillStyle = type === 'cool' ? '#3b4a50' : '#1c0f08';
  c.fillRect(x, y + h * 0.82, w, h * 0.18);
  if (R() < 0.7) { c.beginPath(); c.roundRect(x + w * 0.05, y + h * 0.7, w * 0.55, h * 0.16, 6); c.fill(); }
  if (type === 'warmLamp' || R() < 0.3) {
    const lx = x + w * (0.65 + R() * 0.2), ly = y + h * 0.55;
    c.fillStyle = '#1a0e08'; c.fillRect(lx - 1.5, ly, 3, h * 0.3);
    c.fillStyle = '#ffe7b0';
    c.beginPath(); c.moveTo(lx - 12, ly + 6); c.lineTo(lx + 12, ly + 6); c.lineTo(lx + 7, ly - 10); c.lineTo(lx - 7, ly - 10); c.fill();
    blob(lx, ly, w * 0.45, 'rgba(255,220,150,0.6)');
  }
  if (type === 'warmPlant') {
    c.fillStyle = '#0d0a05';
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (R() - 0.5) * 2.2, len = h * (0.18 + R() * 0.2);
      c.beginPath(); c.ellipse(x + w * 0.2 + Math.cos(a) * len * 0.5, y + h * 0.78 + Math.sin(a) * len * 0.5, len * 0.5, w * 0.05, a, 0, Math.PI * 2); c.fill();
    }
  }
  if (type === 'silhouette') {
    const sx = x + w * (0.35 + R() * 0.3);
    c.fillStyle = '#120804';
    c.beginPath(); c.arc(sx, y + h * 0.38, w * 0.09, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(sx - w * 0.2, y + h); c.quadraticCurveTo(sx - w * 0.2, y + h * 0.5, sx, y + h * 0.48); c.quadraticCurveTo(sx + w * 0.2, y + h * 0.5, sx + w * 0.2, y + h); c.fill();
  }
  if (type === 'warmCurtain') curtains(['rgba(150,40,30,0.92)', 'rgba(70,110,60,0.9)', 'rgba(200,160,100,0.9)'][Math.floor(R() * 3)], 0.18 + R() * 0.12);
  if (type === 'warmBlinds') {
    c.fillStyle = 'rgba(40,24,12,0.72)';
    const top = y + h * (0.45 + R() * 0.2);
    for (let yy = y; yy < top; yy += 6) c.fillRect(x, yy, w, 3.5);
    c.fillStyle = 'rgba(60,40,20,0.9)'; c.fillRect(x, top, w, 4);
  }
}

function paintSash(c, x, y, w, h, col) {
  c.fillStyle = col;
  const f = Math.max(4, w * 0.05);
  c.fillRect(x, y, w, f); c.fillRect(x, y + h - f, w, f);
  c.fillRect(x, y, f, h); c.fillRect(x + w - f, y, f, h);
  c.fillRect(x, y + h * 0.48 - f * 0.6, w, f * 1.2);
}

// Night window atlas for 3D building windows: `cols` x `rows` cells, each a complete
// 1-over-1 sash window seen from the street (dark reflective glass, lamp-lit rooms,
// curtains, blinds, TV glow, silhouettes). Lit cells glow through `emissiveMap`.
// Returns { map, emissiveMap, cols, rows, cells: [{ lit, type }] } (uv cell i: column
// i % cols, row floor(i / cols) counted from the top of the texture).
export function windowAtlas({ seed = 211, cols = 4, rows = 4, cw = 128, ch = 192 } = {}) {
  return cached(`winatlas${seed}${cols}${rows}${cw}${ch}`, () => {
    const R = rng(seed);
    const W = cols * cw, H = rows * ch;
    const ca = makeCanvas(W, H), ce = makeCanvas(W, H);
    const a = ca.getContext('2d'), e = ce.getContext('2d');
    e.fillStyle = '#000';
    e.fillRect(0, 0, W, H);
    const types = ['dark', 'warm', 'darkCurtain', 'warmCurtain', 'tv', 'dark', 'warmBlinds', 'darkBlinds',
      'warmLamp', 'dark', 'cool', 'silhouette', 'darkCurtain', 'warmPlant', 'neon', 'warmCurtain'];
    const cells = [];
    for (let i = 0; i < cols * rows; i++) {
      const type = types[i % types.length];
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      const lit = !type.startsWith('dark');
      cells.push({ lit, type });
      a.save();
      a.beginPath(); a.rect(x, y, cw, ch); a.clip();
      paintWindowRoom(a, x, y, cw, ch, type, R);
      a.restore();
      if (lit) {
        e.drawImage(ca, x, y, cw, ch, x, y, cw, ch);
        a.fillStyle = 'rgba(0,0,0,0.6)';
        a.fillRect(x, y, cw, ch);
      }
      paintSash(a, x, y, cw, ch, '#2e2a26');
      paintSash(e, x, y, cw, ch, '#000');
    }
    const mk = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    return { map: mk(ca), emissiveMap: mk(ce), cols, rows, cells };
  });
}

// Galvanised chain-link mesh (RGBA, alpha = wire). Tile = `cells` diamonds across.
export function chainLink({ size = 128, color = '#a4abb2', cells = 4 } = {}) {
  return cached(`chainlink${size}${color}${cells}`, () => {
    const cv = makeCanvas(size, size);
    const c = cv.getContext('2d');
    const s = size / cells;
    const col = new THREE.Color(color);
    const css = (k, a) => `rgba(${(col.r * 255 * k) | 0},${(col.g * 255 * k) | 0},${(col.b * 255 * k) | 0},${a})`;
    c.lineCap = 'round';
    const pass = (lw, style, off) => {
      c.strokeStyle = style;
      c.lineWidth = lw;
      for (let i = -cells; i <= cells * 2; i++) {
        c.beginPath(); c.moveTo(i * s + off, 0); c.lineTo(i * s + size + off, size); c.stroke();
        c.beginPath(); c.moveTo(i * s + off, size); c.lineTo(i * s + size + off, 0); c.stroke();
      }
    };
    pass(size / 22, css(0.55, 1), 0);
    pass(size / 48, css(1.25, 0.9), -size / 160);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return { map: t };
  });
}

// Square ceramic tiles with grout; optional checkerboard with `color2`.
export function tiles({ color = '#d8d2c4', color2 = '', size = 256, count = 8, seed = 31, grout = '#4a4642', gloss = 0.22, dirt = 0.35 } = {}) {
  return cached(`tiles${color}${color2}${size}${count}${seed}${grout}${gloss}${dirt}`, () => {
    const c1 = hex(color), c2 = color2 ? hex(color2) : c1, gc = hex(grout);
    const ts = size / count, gw = Math.max(1.5, ts * 0.07);
    const g = generate(size, (x, y, o) => {
      const ix = Math.floor(x / ts), iy = Math.floor(y / ts);
      const lx = x - ix * ts, ly = y - iy * ts;
      const edge = Math.min(lx, ts - lx, ly, ts - ly);
      const n = fbm(x / size * 6, y / size * 6, 6, 4, seed);
      const d = 1 - dirt * Math.max(0, n - 0.4) * 1.4;
      if (edge < gw) {
        o.r = gc[0] * d; o.g = gc[1] * d; o.b = gc[2] * d;
        o.h = 0; o.rough = 0.9;
        return;
      }
      const cc = (ix + iy) % 2 ? c2 : c1;
      const t = (0.92 + hash2(ix, iy, seed) * 0.12) * d;
      o.r = cc[0] * t; o.g = cc[1] * t; o.b = cc[2] * t;
      o.h = 0.4 + Math.min(1, (edge - gw) / (ts * 0.12)) * 0.5;
      o.rough = gloss + (1 - d) * 0.5;
    });
    return pack(g, 2);
  });
}
