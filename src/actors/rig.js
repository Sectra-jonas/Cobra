// Procedural humanoid: continuous skinned body (anatomy.js), sculpted head with a painted
// face atlas (head.js), strand-clump hair, eyewear and headwear (hair.js), lofted garments
// with seams and hems, and a layered procedural animation system: pose keys blended with
// motion-preserving smoothing, analytic leg/arm IK inside the pose library, run-time aim
// stabilisation and support-hand IK, springs for hit reactions and landings, and secondary
// motion bones for coat tails, skirts and long hair.
//
// Local space: character faces +z, its left side is +x. The root is yawed so the
// character faces ±x in the world while turned ~20° toward the camera.
import * as THREE from 'three';
import * as TX from '../core/textures.js';
import { rimUniforms, charMat, physMat } from './charmat.js';
import { Body, SkinBuilder, piece, capGeo, handGeo, mirrorX, footwearGeo, tubeGeo, gridGeo, packWeights, mergeAll, plain, clamp, lerp, sstep, gauss, vn } from './anatomy.js';
import { HeadShape, paintFace, earGeo, eyesGeo, eyeTexture, hairlineFn } from './head.js';
import { buildHair, buildBeard, hairTextures, aviatorGeo, roundGlassesGeo, capGeo as baseballCapGeo, helmetGeo, bandanaGeo, hoodGeo, scarfGeo, maskGeo } from './hair.js';

export { rimUniforms };

// ------------------------------------------------------------------- textures

const texCache = new Map();
function cachedTex(key, make) { if (!texCache.has(key)) texCache.set(key, make()); return texCache.get(key); }

function canvasTex(w, h, data, srgb, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Garment detail sets: grey albedo (multiplied by the material colour) + normal map, painted
// in garment UV space (u = around the body part, 0.5 = front; v = metres along the part).
function garmentTex(kind) {
  return cachedTex('g' + kind, () => {
    const W = kind === 'denim' ? 512 : 256, H = W;
    const px = 512 / W; // features are authored for 512 px
    const col = new Uint8ClampedArray(W * H * 4), hgt = new Float32Array(W * H);
    const vMeters = 1.0;
    for (let r = 0; r < H; r++) {
      const v = (1 - (r + 0.5) / H) * vMeters;
      for (let q = 0; q < W; q++) {
        const u = (q + 0.5) / W;
        let g = 0.78, h = 0;
        const n = vn(u * 8, v * 8, 3, 8) * 0.6 + vn(u * 16, v * 16, 4, 16) * 0.3 + vn(u * 32, v * 32, 5, 32) * 0.1;
        if (kind === 'denim') {
          const tw = Math.sin((q + r * 0.4) * Math.PI * 0.5) * 0.5 + 0.5; // fine twill diagonal
          g = 0.74 + tw * 0.04 + (vn(q / 2, r / 16, 9, W / 2) - 0.5) * 0.16;
          h = tw * 0.12;
          // fades: lighter on thigh fronts and knees, darker creases
          const fade = gauss(u - 0.5, 0.13) * (gauss(v - 0.25, 0.14) * 0.9 + gauss(v - 0.45, 0.05) * 0.6);
          g += fade * 0.28 * n;
          // seams: outer (u 0.75) & inner (u 0.25) double stitch
          for (const su of [0.25, 0.75]) {
            const d = Math.abs(u - su) * W;
            if (d < 4) { h -= (1 - d / 4) * 0.8; g -= 0.06; }
            if (Math.abs(d - 6) < 1.1 && (r % 6) < 3) { g += 0.25; h += 0.3; }
          }
          // whiskers near the crotch front & honeycombs behind the knee
          const wk = gauss(v - 0.12, 0.06) * gauss(u - 0.5, 0.14);
          h += wk * Math.sin(v * 160 + Math.abs(u - 0.5) * 60) * 0.6;
          g += wk * Math.max(0, Math.sin(v * 160 + Math.abs(u - 0.5) * 60)) * 0.12;
          const hk = gauss(v - 0.46, 0.06) * gauss(Math.abs(u - 0.5) - 0.5, 0.12);
          h += hk * Math.sin(v * 120 + u * 20) * 0.8;
          // stacking folds at the ankle
          h += gauss(v - 0.88, 0.07) * Math.sin(v * 110 + Math.sin(u * 12) * 2) * 0.7;
        } else if (kind === 'knit') {
          const rib = Math.sin(q * px * Math.PI * 0.5) * 0.5 + 0.5;
          g = 0.8 + (n - 0.5) * 0.12;
          h = rib * 0.15 + (vn(q / 2, r / 2, 4, W / 2) - 0.5) * 0.3;
          for (const su of [0.0, 0.25, 0.75]) { const d = Math.min(Math.abs(u - su), Math.abs(u - su - 1)) * W; if (d < 2.5) h -= (1 - d / 2.5) * 0.5; }
          h += Math.sin(v * 38 + u * 14 + n * 3) * 0.08 * gauss(v - 0.4, 0.2);
        } else if (kind === 'leather') {
          const cell = vn(q / 2, r / 2, 21, W / 2);
          g = 0.82 + (n - 0.5) * 0.3 + (cell - 0.5) * 0.06;
          h = cell * 0.12 + (vn(q / 8, r / 8, 33, W / 8) - 0.5) * 0.15;
          // creases and panel seams
          h += Math.sin(v * 30 + u * 10 + n * 4) * 0.18 * gauss(v - 0.35, 0.25);
          for (const su of [0.25, 0.75, 0.0]) { const d = Math.min(Math.abs(u - su), Math.abs(u - su - 1), Math.abs(u - su + 1)) * W; if (d < 3) { h -= (1 - d / 3) * 0.9; g -= 0.05; } }
        } else { // cloth
          const wx = Math.sin(q * px * Math.PI * 0.6), wy = Math.sin(r * px * Math.PI * 0.6);
          g = 0.8 + (n - 0.5) * 0.18;
          h = (wx * 0.5 + 0.5) * 0.25 + (wy * 0.5 + 0.5) * 0.2 + (n - 0.5) * 0.5;
          h += Math.sin(v * 40 + u * 30 + n * 6) * 0.3 * gauss(v - 0.5, 0.25);
        }
        const j = (r * W + q) * 4;
        const c = clamp(g, 0, 1) * 255;
        col[j] = c; col[j + 1] = c; col[j + 2] = c; col[j + 3] = 255;
        hgt[r * W + q] = h;
      }
    }
    return { map: canvasTex(W, H, col, true), normalMap: canvasTex(W, H, TX.heightToNormal(hgt, W, H, kind === 'denim' ? 1.4 : 1.1), false) };
  });
}

function skinNormal() {
  return cachedTex('skinN', () => {
    const n = 256, h = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = vn(x / 8, y / 8, 51, 32) * 0.6 + vn(x / 4, y / 4, 52, 64) * 0.3 + vn(x / 2, y / 2, 53, 128) * 0.3;
    const t = canvasTex(n, n, TX.heightToNormal(h, n, n, 1.2), false);
    return t;
  });
}

function blobTexture() {
  return cachedTex('blob', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  });
}

// ------------------------------------------------------------------- poses

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'hdL', 'shR', 'elR', 'hdR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];
const EXTRA = ['openL', 'gripL', 'openR', 'gripR', 'coat', 'coatL', 'coatR', 'hair'];
const POSE_KEYS = [
  'hipsY', 'hipsX', 'hipsY_r', 'hipsZ', 'spineX', 'spineY', 'spineZ', 'chestX', 'chestY', 'neckX', 'headX', 'headY',
  'shLX', 'shLY', 'shLZ', 'elLX', 'hdLX', 'hdLZ', 'shRX', 'shRY', 'shRZ', 'elRX', 'hdRX', 'hdRZ',
  'thLX', 'thLZ', 'knLX', 'ftLX', 'thRX', 'thRZ', 'knRX', 'ftRX', 'fallX', 'fallY',
  // additions: pelvis translation, chest roll, neck yaw, IK / aim / hand-grip weights
  'hipsPX', 'hipsPZ', 'chestZ', 'neckY', 'aimR', 'aimPitch', 'ikL', 'ikR', 'gripL', 'gripR',
];
// max follow speed of the motion-preserving blend (units per second)
const FOLLOW = {};
for (const k of POSE_KEYS) FOLLOW[k] = 14;
for (const k of ['thLX', 'thRX', 'knLX', 'knRX', 'ftLX', 'ftRX']) FOLLOW[k] = 22;
for (const k of ['hipsY', 'hipsPX', 'hipsPZ', 'fallY']) FOLLOW[k] = 1.6;
for (const k of ['aimR', 'ikL', 'ikR', 'gripL', 'gripR', 'aimPitch']) FOLLOW[k] = 0;

export function emptyPose() {
  const p = {};
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

// ------------------------------------------------------------------- rig

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

const HEROES = new Set(['cobra', 'ingrid', 'slasher']);

export class Rig {
  /**
   * spec: { height, female, build:{shoulders,chest,arms,legs,belly,head,hips}, skin, hair, hairStyle, hairLength,
   *         face:{jaw,chin,nose,brow,cheek,lips,gaunt,age,cleft}, eyes, lips, makeup, top, topSleeves:'short'|'long'|'none',
   *         neckline, pants, pantsFit, shoes, footwear, gloves, jacket, jacketShine, jacketLong, vest, dress, dressLength,
   *         tights, heels, sunglasses, glasses, match, holster, hood, scarf, bandana, mask, cap, helmet, beard, stubble,
   *         belt, watch, necklace, chains, seed, detail }
   */
  constructor(spec = {}) {
    this.spec = spec;
    const H = spec.height || 1.85;
    const S = H / 1.85;
    this.scale = S;
    const b = { shoulders: 1, chest: 1, arms: 1, legs: 1, belly: 1, head: 1, hips: 1, ...(spec.build || {}) };
    const female = !!spec.female;
    const hero = spec.detail !== undefined ? spec.detail > 0.7 : HEROES.has(spec.kind);
    const detail = hero ? 1 : 0.6;
    this.mats = [];
    const M = (c, r, m, e, kind) => { const x = charMat(c, r, m, e, kind); this.mats.push(x); return x; };
    const tm = {};
    let tl = performance.now();
    const lap = (k) => { const n = performance.now(); tm[k] = (tm[k] || 0) + n - tl; tl = n; };
    this.timings = tm;

    // ---- skeleton
    this.root = new THREE.Group();
    this.root.name = 'rig';
    this.body = new THREE.Group(); // fall pivot
    this.root.add(this.body);
    const J = {};
    const mk = (name, parent, x, y, z) => {
      const o = new THREE.Bone();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      J[name] = o;
      return o;
    };
    const legLen0 = 0.45 * b.legs;
    const ankleH = 0.085;
    const hipY = (2 * legLen0 + 0.03 + ankleH) * S;
    this.hipH = hipY;
    const upLen0 = 0.295 * (female ? 0.95 : 1), foreLen0 = 0.265 * (female ? 0.95 : 1);
    mk('hips', this.body, 0, hipY, 0);
    mk('spine', J.hips, 0, 0.075 * S, 0);
    mk('chest', J.spine, 0, 0.2 * S, 0);
    mk('neck', J.chest, 0, (female ? 0.275 : 0.295) * S, -0.015 * S);
    mk('head', J.neck, 0, 0.105 * S, 0.005 * S);
    const shX = (female ? 0.172 : 0.2) * S * b.shoulders;
    const shY = (female ? 0.19 : 0.215) * S;
    mk('shL', J.chest, shX, shY, -0.012 * S);
    mk('elL', J.shL, 0, -upLen0 * S, 0);
    mk('hdL', J.elL, 0, -foreLen0 * S, 0);
    mk('shR', J.chest, -shX, shY, -0.012 * S);
    mk('elR', J.shR, 0, -upLen0 * S, 0);
    mk('hdR', J.elR, 0, -foreLen0 * S, 0);
    const hipX = (female ? 0.098 : 0.094) * S * b.hips;
    mk('thL', J.hips, hipX, -0.03 * S, 0);
    mk('knL', J.thL, 0, -legLen0 * S, 0);
    mk('ftL', J.knL, 0, -legLen0 * S, 0);
    mk('thR', J.hips, -hipX, -0.03 * S, 0);
    mk('knR', J.thR, 0, -legLen0 * S, 0);
    mk('ftR', J.knR, 0, -legLen0 * S, 0);
    this.j = {};
    for (const n of JOINTS) this.j[n] = J[n];
    // internal bones: hand shape switches, coat/skirt panels, hair
    mk('openL', J.hdL, 0, 0, 0); mk('gripL', J.hdL, 0, 0, 0);
    mk('openR', J.hdR, 0, 0, 0); mk('gripR', J.hdR, 0, 0, 0);
    mk('coat', J.hips, 0, 0.04 * S, -0.02 * S);
    mk('coatL', J.hips, 0.07 * S, 0.04 * S, 0.04 * S);
    mk('coatR', J.hips, -0.07 * S, 0.04 * S, 0.04 * S);
    mk('hair', J.head, 0, 0.05 * S, -0.02 * S);
    this.xb = J;
    this.rest = {};
    this.root.updateMatrixWorld(true);
    for (const n of [...JOINTS, ...EXTRA]) this.rest[n] = J[n].matrixWorld.clone();
    this.restPos = {};
    for (const n of JOINTS) this.restPos[n] = J[n].position.clone();
    const boneNames = [...JOINTS, ...EXTRA];
    const SB = new SkinBuilder(boneNames);
    const bi = {};
    boneNames.forEach((n, i) => { bi[n] = i; });
    this._bi = bi;

    const dims = {
      S, female, build: b, hipY, legLen0, upLen0, foreLen0, bi,
      shL: [shX, hipY + (0.275) * S + shY, -0.012 * S], shR: [-shX, hipY + 0.275 * S + shY, -0.012 * S],
      thL: [hipX, hipY - 0.03 * S, 0], thR: [-hipX, hipY - 0.03 * S, 0],
      neckBase: hipY + (female ? 0.55 : 0.575) * S, muscle: spec.muscle, bust: spec.bust, neckK: spec.neck,
    };
    const body = new Body(dims);
    this.bodyShape = body;
    const L = legLen0, A1 = upLen0, A2 = foreLen0;

    // ---- materials
    const cloth = garmentTex('cloth');
    const C = (c, r, extra = {}, kind = 'cloth') => {
      const t = garmentTex(kind);
      return M(c, r, 0, { map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), ...extra });
    };
    const mats = {};
    mats.skin = M(spec.skin || '#c58c6a', 0.5, 0, { normalMap: skinNormal(), normalScale: new THREE.Vector2(0.25, 0.25) }, 'skin');
    this.skinMat = mats.skin;
    mats.top = C(spec.top || spec.dress || '#141416', 0.86, {}, 'knit');
    mats.pants = spec.pantsFit === 'denim' ? C(spec.pants || '#1d2a44', 0.82, {}, 'denim') : C(spec.pants || '#1d2a44', 0.8, {}, spec.pantsFit === 'track' ? 'knit' : 'cloth');
    mats.shoe = M(spec.footwear === 'sneaker' ? '#bdbdb8' : (spec.shoes || '#0d0d0e'), spec.footwear === 'sneaker' ? 0.7 : 0.3, 0.05, { normalMap: garmentTex('leather').normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    mats.sole = M(spec.footwear === 'sneaker' ? '#c9c6bd' : '#0a0908', 0.75, 0);
    mats.accent = M(spec.footwear === 'sneaker' ? '#1f6b3a' : '#1a1410', 0.6, 0);
    mats.glove = spec.gloves ? M(spec.gloves, 0.34, 0.05, { normalMap: garmentTex('leather').normalMap, normalScale: new THREE.Vector2(0.35, 0.35) }) : mats.skin;
    if (spec.jacket) {
      mats.jacket = spec.jacketShine
        ? M(spec.jacket, 0.36, 0.0, { map: garmentTex('leather').map, normalMap: garmentTex('leather').normalMap, normalScale: new THREE.Vector2(0.55, 0.55), side: spec.jacketLong ? THREE.DoubleSide : THREE.FrontSide })
        : C(spec.jacket, 0.78, { side: spec.jacketLong ? THREE.DoubleSide : THREE.FrontSide }, 'cloth');
    }
    if (spec.dress) mats.dress = C(spec.dress, 0.62, { side: THREE.DoubleSide }, 'cloth');
    if (spec.tights) mats.tights = M(spec.tights, 0.45, 0, { normalMap: cloth.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) });
    mats.metal = M('#c9ccd2', 0.22, 1);
    mats.gold = M('#d9b56a', 0.25, 1);
    mats.strap = M('#4a2a17', 0.48, 0, { normalMap: garmentTex('leather').normalMap, normalScale: new THREE.Vector2(0.5, 0.5) });
    if (spec.belt) mats.belt = M(spec.belt, 0.42, 0.05, { normalMap: garmentTex('leather').normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });

    lap('setup');
    // ---- head
    const fp = spec.face || {};
    const shape = new HeadShape({ female, jaw: spec.jaw || fp.jaw || 1, chin: fp.chin || 1, nose: fp.nose || 1, brow: fp.brow || 1, cheek: fp.cheek || 1, lips: fp.lips || 1, gaunt: fp.gaunt || 0, age: fp.age || 0, cleft: fp.cleft || 0, eyes: !spec.sunglasses, width: fp.width || 1 });
    this.headShape = shape;
    const hS = S * (b.head || 1);
    const headM = new THREE.Matrix4().multiplyMatrices(this.rest.head, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.045 * S, 0.008 * S), new THREE.Quaternion(), new THREE.Vector3(hS, hS, hS)));
    this.headLocal = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.045 * S, 0.008 * S), new THREE.Quaternion(), new THREE.Vector3(hS, hS, hS));
    const style = spec.hood ? 'none' : (spec.hairStyle || 'short');
    let hair = null;
    if (style !== 'bald' && style !== 'none') hair = buildHair(shape, style, { female, hero, length: spec.hairLength, seed: spec.seed || 1 });
    const scalp = style === 'bald' ? 'bald' : hair ? hair.scalp : 'none';
    lap('hair');
    const face = paintFace(shape, {
      key: `${spec.kind || 'x'}${spec.seed || 0}`, size: hero ? (spec.kind === 'cobra' ? 768 : 512) : 256,
      skin: spec.skin, hair: spec.hair, brows: spec.brows, lips: spec.lips, stubble: spec.stubble || spec.beard, female,
      age: fp.age || 0, makeup: spec.makeup, eyeshadow: spec.eyeshadow, blush: spec.makeup, sunglasses: spec.sunglasses,
      hairline: hair ? hair.hairline : hairlineFn('default'), scalp, seed: spec.seed || 1,
    });
    lap('paint');
    mats.face = M('#ffffff', 1, 0, { map: face.map, normalMap: face.normalMap, roughnessMap: face.roughnessMap, normalScale: new THREE.Vector2(0.6, 0.6) }, 'skin');
    const nu = hero ? 56 : 40, nv = hero ? 44 : 30;
    SB.rigid('face', shape.geometry(nu, nv), 'head', headM);
    for (const sd of [1, -1]) SB.rigid('face', earGeo(shape, sd, { female, detail }), 'head', headM);
    if (!spec.sunglasses && !spec.mask) {
      const e = eyesGeo(shape, { female, detail });
      mats.eye = physMat({ map: eyeTexture(spec.eyes || '#3b2a1e'), roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 });
      this.mats.push(mats.eye);
      SB.rigid('eye', e.eyes, 'head', headM);
      SB.rigid('face', e.lids, 'head', headM);
    }
    // neck (face material: stubble continues under the jaw)
    SB.add('face', piece(body, { part: 'neck', a0: 0, a1: 0.17, nu: hero ? 24 : 16, nv: 8, vOf: (a) => 0.07 + 0.17 * clamp(a / 0.17, 0, 1) }));

    lap('head');
    // ---- hair & beard
    if (hair) {
      const ht = hairTextures();
      mats.hair = M(spec.hair || '#1b1410', 0.55, 0, { map: ht.map, normalMap: ht.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), alphaTest: 0.42, side: THREE.DoubleSide }, 'hair');
      const g = hair.geo.applyMatrix4(headM);
      this._skinHang(g, hair.hang, style === 'long' || style === 'big');
      SB.add('hair', g);
    }
    if (spec.beard) {
      const bd = buildBeard(shape, { hero, seed: (spec.seed || 1) + 3 });
      if (!mats.hair) {
        const ht = hairTextures();
        mats.hair = M(spec.hair || '#1b1410', 0.55, 0, { map: ht.map, normalMap: ht.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), alphaTest: 0.42, side: THREE.DoubleSide }, 'hair');
      }
      const g = bd.geo.applyMatrix4(headM);
      this._skinHang(g, bd.hang, false);
      SB.add('hair', g);
    }

    lap('hairskin');
    // ---- outfit
    this._outfit(SB, body, mats, spec, { S, L, A1, A2, female, hero, detail, b, M, C });
    lap('outfit');

    // ---- headwear (skinned to head; drapes blend to neck/chest)
    const headwear = (key, geo, color, rough = 0.85, metal = 0, extra = {}) => {
      if (!mats[key]) mats[key] = M(color, rough, metal, extra);
      const g = plain(geo).applyMatrix4(headM);
      const p = g.attributes.position;
      const hang = new Float32Array(p.count);
      const tmp = new THREE.Vector3();
      const inv = headM.clone().invert();
      for (let i = 0; i < p.count; i++) { tmp.fromBufferAttribute(p, i).applyMatrix4(inv); hang[i] = sstep(-0.1, -0.24, tmp.y); }
      this._skinHang(g, hang, false);
      SB.add(key, g);
    };
    if (spec.cap) headwear('cap', baseballCapGeo(shape), spec.cap, 0.75, 0, { normalMap: cloth.normalMap });
    if (spec.helmet) headwear('helmet', helmetGeo(shape), spec.helmet, 0.45, 0.35, { normalMap: cloth.normalMap, normalScale: new THREE.Vector2(0.2, 0.2) });
    if (spec.bandana) headwear('bandana', bandanaGeo(shape), spec.bandana, 0.8, 0, { normalMap: cloth.normalMap, side: THREE.DoubleSide });
    if (spec.hood) headwear('hood', hoodGeo(shape), spec.hood, 0.92, 0, { map: cloth.map, normalMap: cloth.normalMap, side: THREE.DoubleSide });
    if (spec.scarf) headwear('scarf', scarfGeo(shape), spec.scarf, 0.85, 0, { map: cloth.map, normalMap: cloth.normalMap, side: THREE.DoubleSide });
    if (spec.mask) headwear('mask', maskGeo(shape), spec.mask, 0.9, 0, { map: cloth.map, normalMap: cloth.normalMap });

    // ---- build skinned meshes
    const bones = boneNames.map((n) => J[n]);
    this.skeleton = new THREE.Skeleton(bones);
    lap('headwear');
    this.meshes = SB.build(mats, this.skeleton, this.body);
    this.tris = SB.tris();
    lap('build');

    // ---- eyewear (rigid group on the head; exposed as rig.sunglasses)
    if (spec.sunglasses) {
      const av = aviatorGeo(shape, { detail });
      const lensM = physMat({ color: '#3a3026', metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4, iridescence: 0.35, iridescenceIOR: 1.6 });
      const frameM = M('#d6bd85', 0.18, 1);
      this.mats.push(lensM);
      const g = new THREE.Group();
      g.applyMatrix4(this.headLocal);
      J.head.add(g);
      const lens = new THREE.Mesh(av.lens, lensM);
      const frame = new THREE.Mesh(av.frame, frameM);
      frame.castShadow = true;
      g.add(lens, frame);
      this.sunglasses = g;
    }
    if (spec.glasses) {
      const rg = roundGlassesGeo(shape, { detail });
      const frameM = M('#9a8c6a', 0.25, 1);
      const lensM = physMat({ color: spec.glassesTint || '#c8d4dc', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.38 });
      this.mats.push(lensM);
      const g = new THREE.Group();
      g.applyMatrix4(this.headLocal);
      J.head.add(g);
      g.add(new THREE.Mesh(rg.lens, lensM), new THREE.Mesh(rg.frame, frameM));
      this.glasses = g;
    }
    if (spec.match) { // Cobretti's matchstick, parked in the corner of his mouth
      const mg = new THREE.Group();
      mg.applyMatrix4(this.headLocal);
      J.head.add(mg);
      const inner = new THREE.Group();
      inner.position.set(0.013, -0.0662, 0.0905);
      inner.rotation.set(0.12, 0.42, -0.2);
      mg.add(inner);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0019, 0.058, 6).rotateX(Math.PI / 2), M('#dcc497', 0.75));
      stick.position.z = 0.022;
      inner.add(stick);
      const tipM = new THREE.MeshStandardMaterial({ color: '#8a1410', emissive: '#ff3010', emissiveIntensity: 0.3, roughness: 0.55 });
      tipM.userData.hit = { value: 0 };
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 10, 8).scale(1, 1, 1.35), tipM);
      tip.position.z = 0.0515;
      inner.add(tip);
      this.mats.push(tipM);
      this.matchTip = tip;
    }

    lap('eyewear');
    // contact shadow blob (cheap grounding under characters)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * S, 0.7 * S), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: '#000000', opacity: 0.55 }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.012;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);

    // anim state
    this.pose = emptyPose();
    this.prevTarget = emptyPose();
    this.primed = false;
    this.springs = { spineX: [0, 0], headX: [0, 0], spineY: [0, 0], chestX: [0, 0] };
    this.land = [0, 0];
    this.dyn = { coat: [0, 0, 0, 0], coatL: [0, 0, 0, 0], coatR: [0, 0, 0, 0], hair: [0, 0, 0, 0] };
    this.lastPos = null;
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.facing = 1;
    this.yaw = Math.PI / 2 - 0.35;
    this.hitFlash = 0;
    this.items = {};
    // cinematic hand contacts: { pos: world Vector3 (palm centre), quat: world Quaternion, w: 0..1 }
    this.handIK = { L: null, R: null };
    this.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  }

  // weights for head-attached geometry that hangs down (hair, hoods): head -> neck/chest (+ hair bone)
  _skinHang(geo, hang, dynamic) {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const I = this._bi;
    for (let i = 0; i < n; i++) {
      const h = hang ? hang[i] || 0 : 0;
      const hb = dynamic ? sstep(0.0, 0.6, h) * 0.6 : 0;
      packWeights([I.head, (1 - h) * (1 - hb), I.hair, (1 - h) * hb, I.neck, h * 0.35, I.chest, h * 0.65], si, sw, i);
    }
    if (!geo.index) {
      const ix = new Uint32Array(n);
      for (let i = 0; i < n; i++) ix[i] = i;
      geo.setIndex(new THREE.BufferAttribute(ix, 1));
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    return geo;
  }

  _outfit(SB, body, mats, spec, o) {
    const { S, L, A1, A2, female, hero, detail } = o;
    const R = this.rest;
    const q = hero ? 1 : 0.65;
    const NU = (n) => Math.max(8, Math.round(n * q));
    const add = (key, geo) => { if (geo) SB.add(key, geo); };
    const dress = !!spec.dress;
    const jacket = !!spec.jacket;
    const coat = jacket && spec.jacketLong;
    const vest = !!spec.vest;
    const sleeves = spec.topSleeves || (dress ? 'none' : 'short');
    const tight = female ? 0.0 : 0.15;
    const neckTop = (th) => (female ? 0.574 : 0.603) - 0.013 * Math.cos(th); // crew neck hugs the neck
    const torsoTop = 0.6;
    const AD = -body.armDome(), LD = -body.legDome();

    // --- skin where exposed
    const armSkinFrom = (jacket && !vest) ? null : sleeves === 'none' ? AD : sleeves === 'short' ? 0.1 : null;
    const handKey = spec.gloves ? 'glove' : 'skin';
    if (armSkinFrom !== null) {
      for (const sd of [1, -1]) add('skin', piece(body, { part: 'arm', side: sd, a0: armSkinFrom, a1: A1 + A2 + 0.03, nu: NU(16), nv: NU(22), spacing: null }));
    } else {
      // forearm tips under the cuffs so wrists never show gaps
      for (const sd of [1, -1]) add('skin', piece(body, { part: 'arm', side: sd, a0: A1 + A2 - 0.06, a1: A1 + A2 + 0.03, nu: NU(12), nv: 3 }));
    }
    // upper chest / shoulders skin under low necklines and sleeveless tops
    if ((dress && !spec.top) || spec.neckline === 'scoop') { // kept slightly inside so it never pokes through the bodice
      add('skin', piece(body, { part: 'torso', a0: 0.4, a1: torsoTop, inf: -0.0025, nu: NU(32), nv: NU(14), spacing: (t) => 1 - Math.pow(1 - t, 1.4) }));
    }
    // hands: relaxed + grip variants (switched at run time via bone scale)
    for (const [sd, side] of [[1, 'L'], [-1, 'R']]) {
      for (const pose of ['relaxed', 'grip']) {
        let g = handGeo({ S, female, pose, glove: !!spec.gloves, detail });
        if (sd < 0) g = mirrorX(g);
        SB.rigid(handKey, g, (pose === 'grip' ? 'grip' : 'open') + side, R['hd' + side]);
      }
    }
    // legs (bare or tights) where the lower body is a dress
    if (dress) { // legs start under the skirt so thighs never poke through it
      const legKey = spec.tights ? 'tights' : 'skin';
      const a0 = Math.max(0.17, (spec.dressLength || 0.44) - 0.12);
      for (const sd of [1, -1]) add(legKey, piece(body, { part: 'leg', side: sd, a0, a1: 2 * L + 0.035, nu: NU(16), nv: NU(18) }));
    }

    // --- footwear
    const fw = spec.footwear || (spec.heels ? 'pump' : 'boot');
    for (const side of ['L', 'R']) {
      for (const [key, g] of footwearGeo({ type: fw, S, ground: 0.085, female, detail })) SB.rigid(key === 'skin' ? (spec.tights ? 'tights' : 'skin') : key, g, 'ft' + side, R['ft' + side]);
    }

    // --- trousers
    if (!dress) {
      const looseP = spec.pantsFit === 'track' ? 0.6 : 0.35;
      const waist = 0.088;
      add('pants', piece(body, { part: 'torso', a0: -0.118, a1: waist, inf: 0.007, loose: 0.3, nu: NU(36), nv: NU(10), hem: 0.003 }));
      add('pants', capGeo((t) => body.torso(t * Math.PI * 2 - Math.PI, -0.118, 0.007, 0.3), NU(36), () => [0, this.hipH - 0.122 * S, -0.004 * S], (p) => body.torsoW(-0.118, p[0])));
      for (const sd of [1, -1]) {
        add('pants', piece(body, {
          part: 'leg', side: sd, a0: LD, a1: 2 * L + 0.04, inf: 0.0085, loose: looseP, nu: NU(16), nv: NU(20), hem: 0.003,
          flare: (t) => 0.012 * sstep(0.72, 1, t) + 0.004 * gauss(t - 0.5, 0.06),
        }));
      }
      // waistband
      add('pants', piece(body, { part: 'torso', a0: waist - 0.022, a1: waist, inf: 0.0105, loose: 0.5, nu: NU(36), nv: 2, hem: 0.003, hem0: 0.002 }));
    }
    if (spec.belt) {
      add('belt', piece(body, { part: 'torso', a0: 0.054, a1: 0.088, inf: 0.0135, loose: 0.6, nu: NU(40), nv: 2, hem: 0.003, hem0: 0.003 }));
      const p = body.torso(0, 0.071, 0.016, 0.6);
      const frame = [];
      for (const [w, h, x, y] of [[0.052, 0.007, 0, 0.0165], [0.052, 0.007, 0, -0.0165], [0.007, 0.04, 0.0225, 0], [0.007, 0.04, -0.0225, 0], [0.004, 0.026, 0.004, 0]]) {
        const bx = new THREE.BoxGeometry(w * S, h * S, 0.006 * S);
        bx.translate(p[0] + x * S, p[1] + y * S, p[2] + 0.002 * S);
        frame.push(plain(bx));
      }
      SB.add('metal', this._rigidBone(mergeAll(frame), 'hips'));
    }

    // --- shirt / top
    const topCovers = !dress || spec.top;
    if (topCovers && !(jacket && !vest && !spec.top)) {
      const tucked = !!spec.belt || spec.tuck;
      const a0 = tucked ? 0.0 : (spec.pants ? -0.05 : 0.0);
      const neckFn = spec.neckline === 'v' ? (th) => neckTop(th) - 0.07 * gauss(th, 0.3) : neckTop;
      const under = jacket && !vest;
      add('top', piece(body, { part: 'torso', a0, a1: neckFn, inf: 0.0045, loose: tight + (spec.top && jacket ? 0.4 : 0), nu: NU(under ? 20 : 40), nv: NU(under ? 14 : 24), hem: 0.003, hem0: tucked ? 0 : 0.003, spacing: (t) => 1 - Math.pow(1 - t, 1.35), th0: under ? -1.4 : -Math.PI, th1: under ? 1.4 : Math.PI }));
      // ribbed crew collar band
      add('top', piece(body, { part: 'torso', a0: (th) => neckFn(th) - 0.016, a1: neckFn, inf: 0.0068, loose: tight, nu: NU(40), nv: 2, hem: 0.0035, hem0: 0.002 }));
      if (sleeves !== 'none' && !under) {
        const a1 = sleeves === 'long' ? A1 + A2 - 0.01 : 0.135;
        for (const sd of [1, -1]) {
          add('top', piece(body, {
            part: 'arm', side: sd, a0: AD, a1, inf: 0.0055, loose: sleeves === 'long' ? 0.6 : 0.45, nu: NU(16), nv: NU(sleeves === 'long' ? 22 : 9), hem: 0.003,
            flare: (t) => (sleeves === 'long' ? 0.002 : 0.006) * sstep(0.5, 1, t),
          }));
        }
      }
    }

    // --- dress: fitted bodice + flared skirt (skirt panels follow thighs)
    if (dress) {
      if (spec.buttons) { // coat-dress front: a column of buttons
        const bm = [];
        for (let i = 0; i < 6; i++) {
          const p = body.torso(0, 0.48 - i * 0.075, spec.top ? 0.011 : 0.008, 0.3);
          const g = new THREE.CylinderGeometry(0.008 * S, 0.008 * S, 0.004 * S, 10).rotateX(Math.PI / 2);
          g.translate(p[0], p[1], p[2]);
          bm.push(plain(g));
        }
        SB.add('accent', this._rigidBone(mergeAll(bm.slice(0, 3)), 'chest'));
        SB.add('accent', this._rigidBone(mergeAll(bm.slice(3)), 'spine'));
      }
    }
    if (dress && !spec.top) {
      const neck = (th) => lerp(0.44, 0.47, sstep(0.0, 1.2, Math.abs(th))) - 0.01 * gauss(th, 0.25);
      add('dress', piece(body, { part: 'torso', a0: -0.05, a1: neck, inf: 0.0035, loose: 0.05, nu: NU(40), nv: NU(18), hem: 0.002 }));
      // shoulder straps
      for (const sd of [1, -1]) add('dress', this._strap(body, [[sd * 0.42, 0.435], [sd * 0.8, 0.5], [sd * 1.45, 0.533], [sd * 2.15, 0.505], [sd * 2.5, 0.45]], 0.011 * S, 0.0035));
    }
    if (dress) {
      const len = spec.dressLength || 0.44;
      add('dress', this._skirt(body, { y0: 0.02, len, flare: 0.08, inf: spec.top ? 0.01 : 0.008, nu: NU(40), nv: NU(10), thigh: 0.7, open: 0 }));
    }

    // --- jacket / vest / long coat
    if (jacket) {
      const gap = (yr) => (coat ? 0.16 : 0.12) + 0.32 * sstep(0.3, 0.56, yr) + (coat ? 0.0 : 0.0);
      const a0 = coat ? 0.02 : -0.03;
      const nuJ = NU(40);
      add('jacket', piece(body, {
        part: 'torso', a0, a1: (th) => 0.598 - 0.012 * Math.cos(th), inf: coat ? 0.02 : 0.016, loose: 0.75, nu: nuJ, nv: NU(22), hem: 0.004, hem0: 0.004,
        spacing: (t) => 1 - Math.pow(1 - t, 1.3), flare: (t) => 0.014 * (1 - sstep(0.0, 0.3, t)), // clears the seat of the trousers
        warp: (p, th, a) => { // open front: pull the two halves apart into lapels
          const g = gap(a);
          const d = Math.abs(th);
          if (d < g) { const k = (g - d) / g; p[0] += Math.sign(th || 1) * k * 0.05 * S * (0.5 + a); p[2] -= k * 0.012 * S; }
        },
      }));
      // lapels: flaps lying on the chest along the opening
      for (const sd of [1, -1]) add('jacket', this._lapel(body, sd, coat ? 0.022 : 0.018, coat));
      // collar
      add('jacket', coat ? this._collar(body, 0.045, 0.022, 0.035) : this._collar(body, vest ? 0.026 : 0.045, 0.018));
      // zip / edge trim line on leather jackets
      if (spec.jacketShine && !coat) {
        for (const sd of [1, -1]) {
          const pts = [];
          for (let i = 0; i <= 12; i++) { const yr = lerp(a0 + 0.01, 0.4, i / 12); const th = sd * (gap(yr) + 0.02); const p = body.torso(th, yr, 0.019, 0.75); pts.push(new THREE.Vector3(p[0] + sd * 0.004 * S, p[1], p[2])); }
          add('metal', this._skinFixed(tubeGeo(pts, pts.map(() => 0.0025 * S), 4, false, false, 1), (p) => body.torsoW((p.y - this.hipH) / S, p.x)));
        }
      }
      if (!vest) {
        for (const sd of [1, -1]) {
          add('jacket', piece(body, {
            part: 'arm', side: sd, a0: AD, a1: A1 + A2 - 0.012, inf: coat ? 0.016 : 0.012, loose: 0.6, nu: NU(16), nv: NU(22), hem: 0.004,
            flare: (t) => 0.005 * sstep(0.85, 1, t) + 0.003 * gauss(t - 0.5, 0.08),
          }));
          // cuff band
          add('jacket', piece(body, { part: 'arm', side: sd, a0: A1 + A2 - 0.05, a1: A1 + A2 - 0.012, inf: coat ? 0.019 : 0.015, loose: 0.6, nu: NU(16), nv: 2, hem: 0.003, hem0: 0.002 }));
        }
      }
      if (coat) {
        add('jacket', this._skirt(body, { y0: 0.05, len: spec.coatLength || 0.72, flare: 0.1, inf: 0.024, nu: NU(40), nv: NU(16), thigh: 0.45, open: 0.2, coat: true }));
      }
    }

    // --- accessories on the body
    if (spec.holster) this._holster(body, SB, mats);
    if (spec.watch) {
      const g = new THREE.CylinderGeometry(0.0315 * S, 0.0315 * S, 0.016 * S, 16, 1, true);
      g.scale(0.8, 1, 1.0);
      const face = new THREE.CylinderGeometry(0.014 * S, 0.014 * S, 0.006 * S, 14);
      face.rotateZ(Math.PI / 2);
      face.translate(0.026 * S, 0, 0);
      const m = new THREE.Matrix4().makeTranslation(0, -A2 * S + 0.03 * S, 0);
      SB.rigid('metal', mergeAll([plain(g), plain(face)]), 'elL', R.elL.clone().multiply(m));
    }
    if (spec.necklace) {
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const th = -Math.PI + (i / 32) * Math.PI * 2;
        const p = body.torso(th, (female ? 0.556 : 0.58) - 0.035 * Math.max(0, Math.cos(th)) ** 2, 0.004, 0);
        pts.push(new THREE.Vector3(p[0], p[1], p[2]));
      }
      add('gold', this._skinFixed(tubeGeo(pts, pts.map(() => 0.0016 * S), 4, false, false, 1), (v) => body.torsoW((v.y - this.hipH) / S, v.x)));
    }
    if (spec.chains) {
      const pts = [];
      for (let i = 0; i <= 36; i++) {
        const th = -Math.PI + (i / 36) * Math.PI * 2;
        const yr = 0.52 - 0.13 * Math.max(0, Math.cos(th)) ** 1.5;
        const p = body.torso(th, yr, vest ? 0.024 : 0.012, 0.6);
        pts.push(new THREE.Vector3(p[0], p[1], p[2]));
      }
      add('metal', this._skinFixed(tubeGeo(pts, pts.map(() => 0.0045 * S), 5, false, false, 1), () => [this._bi.chest, 1]));
    }
  }

  _rigidBone(geo, bone) {
    const g = plain(geo);
    const n = g.attributes.position.count;
    if (!g.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this._bi[bone]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    return g;
  }

  _skinFixed(geo, wfn) {
    const g = plain(geo);
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(g.attributes.position, i); packWeights(wfn(v), si, sw, i); }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    return g;
  }

  // flat strap following the torso surface through [theta, yr] waypoints
  _strap(body, way, width, inf) {
    const n = 30;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * (way.length - 1);
      const k = Math.min(way.length - 2, Math.floor(f)), t = f - k;
      pts.push([lerp(way[k][0], way[k + 1][0], t), lerp(way[k][1], way[k + 1][1], t)]);
    }
    const P = (th, yr) => new THREE.Vector3(...body.torso(th, yr, inf, 0.3));
    return gridGeo(n, 1, (i, j, o) => {
      const [th, yr] = pts[i];
      const p = P(th, yr);
      // surface normal from the parametric derivatives, strap tangent along the path
      const nrm = new THREE.Vector3().crossVectors(P(th + 0.01, yr).sub(P(th - 0.01, yr)), P(th, yr + 0.01).sub(P(th, yr - 0.01))).normalize();
      if (nrm.dot(new THREE.Vector3(p.x, 0, p.z)) < 0 && nrm.y < 0.9) nrm.negate();
      const nb = pts[Math.min(n, i + 1)], pb = pts[Math.max(0, i - 1)];
      const tan = P(nb[0], nb[1]).sub(P(pb[0], pb[1])).normalize();
      const wd = new THREE.Vector3().crossVectors(tan, nrm).normalize();
      const s2 = (j - 0.5) * width;
      o.p = [p.x + wd.x * s2, p.y + wd.y * s2, p.z + wd.z * s2];
      o.uv = [j, i / n];
      o.w = body.torsoW(yr, p.x);
    });
  }

  _lapel(body, sd, inf, coat) {
    const S = this.scale;
    return gridGeo(8, 3, (i, j, o) => {
      const yr = lerp(coat ? 0.3 : 0.33, 0.56, i / 8);
      const gap = (coat ? 0.16 : 0.12) + 0.32 * sstep(0.3, 0.56, yr);
      const w = lerp(0.02, coat ? 0.4 : 0.32, sstep(0.32, 0.5, yr)) * (1 - sstep(0.52, 0.565, yr) * 0.6);
      const th = sd * (gap + w * (j / 3));
      const p = body.torso(th, yr, inf + 0.004 + 0.003 * (1 - j / 3), 0.75);
      p[0] += sd * 0.004 * S * (1 - j / 3);
      o.p = p; o.uv = [j / 3, yr]; o.w = body.torsoW(yr, p[0]);
    }, { outDir: [0, 0, 1] });
  }

  // Collar: rises from the neckline, then (fold > 0) turns down and outward over itself.
  _collar(body, h, inf, fold = 0) {
    const S = this.scale;
    const n = 32, m = fold > 0 ? 6 : 3;
    return gridGeo(n, m, (i, j, o) => {
      const th = lerp(-Math.PI * 0.82, Math.PI * 0.82, i / n);
      const front = gauss(th, 1.2);
      const base = body.torso(th, 0.595 - 0.014 * Math.cos(th), inf, 0.6);
      const rx = base[0], rz = base[2] + 0.01 * S;
      const rl = Math.hypot(rx, rz) || 1;
      let out, up;
      const t = j / m;
      if (fold > 0) { // stand (t < 0.5) then fall: roll over outward and down
        const a = t * Math.PI;
        up = Math.sin(a) * h * (1 - 0.45 * front);
        out = (0.004 + (1 - Math.cos(a)) * 0.5 * fold) * (1 - front * 0.3);
      } else {
        up = h * t * (1 - 0.45 * front);
        out = (0.004 + 0.012 * t * t) * (1 - front * 0.4);
      }
      o.p = [base[0] + (rx / rl) * out * S, base[1] + up * S, base[2] + (rz / rl) * out * S];
      o.uv = [i / n, t];
      o.w = [this._bi.chest, 1 - Math.min(1, up / h) * 0.3, this._bi.neck, Math.min(1, up / h) * 0.3];
    });
  }

  // flared skirt / coat tail panels from the waist; thigh-weighted so legs push them, plus
  // dynamic panel bones for lag
  _skirt(body, { y0, len, flare, inf, nu, nv, thigh, open = 0, coat = false }) {
    const S = this.scale, I = this._bi;
    const th0 = -Math.PI + 0.0001, th1 = Math.PI - 0.0001;
    return gridGeo(nu, nv, (i, j, o) => {
      const t = j / nv;
      const a = t * len;
      // open front: shift the angular range away from the centre front
      const g = open * sstep(0.0, 0.25, t);
      let th = lerp(th0, th1, i / nu);
      th = Math.sign(th) * lerp(Math.abs(th), Math.PI, 0) ;
      const absTh = Math.abs(th);
      const thg = Math.sign(th || 1) * (g + (absTh / Math.PI) * (Math.PI - g));
      const p = body.torso(thg, y0, inf, 0.85);
      const cx = 0, cz = -0.004 * S;
      let rx = p[0] - cx, rz = p[2] - cz;
      const k = 1 + (flare / 0.16) * Math.pow(t, 1.3) + 0.1 * Math.sqrt(t) + 0.06 * t; // full over the hips
      rx *= k; rz *= k * 1.05;
      // gentle folds
      const fold = 1 + 0.035 * Math.sin(thg * 9 + t * 2) * t;
      o.p = [cx + rx * fold, p[1] - a * S, cz + rz * fold];
      o.uv = [(thg + Math.PI) / (Math.PI * 2), y0 - a];
      const side = Math.sin(thg);
      const frontness = Math.cos(thg);
      const wT = thigh * sstep(0.05, 0.75, t);
      const wL = wT * clamp(0.5 + side * 1.2, 0, 1) * (coat ? clamp(0.3 + frontness, 0, 1) : 1);
      const wR = wT * clamp(0.5 - side * 1.2, 0, 1) * (coat ? clamp(0.3 + frontness, 0, 1) : 1);
      const wKn = coat ? 0.15 * sstep(0.6, 1, t) : 0;
      const dynB = (coat ? 0.65 : 0.4) * sstep(0.0, 0.6, t);
      const panel = coat ? (frontness > 0.2 ? (side > 0 ? I.coatL : I.coatR) : I.coat) : I.coat;
      const rest = Math.max(0, 1 - wL - wR - wKn);
      o.w = [I.hips, rest * (1 - dynB), panel, rest * dynB, I.thL, wL, I.thR, wR, side > 0 ? I.knL : I.knR, wKn];
    }, { outDir: null });
  }

  _holster(body, SB, mats) {
    const S = this.scale;
    // harness loops over each shoulder, crossing at the back, pouch under the left arm
    for (const sd of [1, -1]) {
      const way = [[sd * 2.95, 0.36], [sd * 2.3, 0.47], [sd * 1.75, 0.535], [sd * 1.0, 0.545], [sd * 0.6, 0.49], [sd * 0.75, 0.4], [sd * 1.45, 0.34], [sd * 2.3, 0.33], [sd * 2.95, 0.36]];
      SB.add('strap', this._strap(body, way, 0.02 * S, 0.0105));
    }
    // back ring
    const ring = new THREE.TorusGeometry(0.014 * S, 0.0028 * S, 5, 14);
    const p = body.torso(Math.PI, 0.37, 0.013, 0.3);
    ring.translate(p[0], p[1], p[2]);
    SB.add('metal', this._rigidBone(ring, 'chest'));
    // pouch with the Colt's grip (left armpit)
    const hp = body.torso(1.7, 0.33, 0.035, 0.3);
    const pouch = new THREE.SphereGeometry(1, 10, 8);
    pouch.scale(0.022 * S, 0.075 * S, 0.042 * S);
    pouch.rotateZ(-0.15);
    pouch.rotateX(0.75);
    pouch.translate(hp[0], hp[1], hp[2]);
    SB.add('strap', this._rigidBone(pouch, 'chest'));
    const gripG = new THREE.BoxGeometry(0.02 * S, 0.06 * S, 0.026 * S);
    gripG.rotateX(-0.6);
    gripG.translate(hp[0] + 0.002 * S, hp[1] + 0.03 * S, hp[2] + 0.045 * S);
    SB.add('accent', this._rigidBone(gripG, 'chest'));
    void mats;
  }

  // ------------------------------------------------------------------ public API

  attach(name, object, joint = 'hdR') {
    if (this.items[name]) this.items[name].removeFromParent();
    this.items[name] = object;
    if (object) {
      object.userData.joint = joint;
      this.j[joint].add(object);
    }
  }

  show(name, visible) { if (this.items[name]) this.items[name].visible = visible; }

  setFacing(dir) { this.facing = dir >= 0 ? 1 : -1; }

  // Cinematic foot placement: write leg angles into pose `o` so the ankles land on world-space
  // targets, given where the root will stand (rootPos, yaw). feet: { L: [ankle Vector3, pitch], R }.
  // Uses the pose's pelvis offsets (hipsY / hipsPX / hipsPZ / hipsX); hip yaw and roll should be 0.
  footIK(o, rootPos, yaw, feet) {
    const S = this.scale;
    const legU = this.j.knL.position.length();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const sd of ['L', 'R']) {
      const f = feet[sd];
      if (!f) continue;
      const th = this.restPos['th' + sd];
      const lx = (o.hipsPX || 0) * S + th.x, ly = this.hipH + (o.hipsY || 0) * S + th.y, lz = (o.hipsPZ || 0) * S + th.z;
      const dx = f[0].x - (rootPos.x + lx * c + lz * s), dy = f[0].y - (rootPos.y + ly), dz = f[0].z - (rootPos.z - lx * s + lz * c);
      const rx = dx * c - dz * s, rz = dx * s + dz * c;
      legIK(o, sd, rz / legU, dy / legU, f[1] || 0, (sd === 'L' ? rx : -rx) / legU);
    }
    return o;
  }

  impulse(key, amount) {
    if (this.springs[key]) this.springs[key][1] += amount;
    if (key === 'spineX' && amount > 0) this.land[1] += amount * 0.06; // landings: knees absorb
  }

  flash(t = 0.12) { this.hitFlash = t; }

  setOpacity(a) {
    for (const m of this.mats) {
      if (m.userData.glassOpacity === undefined) m.userData.glassOpacity = m.transparent ? m.opacity : null;
      const glass = m.userData.glassOpacity !== null;
      const tr = a < 1 || glass;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } // OPAQUE define changes
      m.opacity = glass ? m.userData.glassOpacity * a : a;
      m.depthWrite = a >= 1 && !glass;
    }
    this.blob.material.opacity = 0.55 * a;
  }

  /**
   * target: pose object (see POSE_KEYS). rate: blend speed. yawOverride: absolute yaw (e.g. climbing).
   * Blending follows continuous target motion exactly (so cycles keep their snap and foot
   * plants) and only smooths discontinuities with the given rate.
   */
  update(dt, target, rate = 14, yawOverride = null) {
    const k = 1 - Math.exp(-rate * dt);
    const p = this.pose, prev = this.prevTarget;
    for (const key of POSE_KEYS) {
      const tv = target[key] || 0;
      if (this.primed) {
        let d = tv - prev[key];
        const lim = FOLLOW[key] * dt;
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
        p[key] += d;
      }
      p[key] += (tv - p[key]) * k;
      prev[key] = tv;
    }
    this.primed = true;
    // springs (hit reactions)
    const sdt = Math.min(dt, 1 / 30);
    for (const key in this.springs) {
      const s = this.springs[key];
      s[1] += (-s[0] * 220 - s[1] * 18) * sdt;
      s[0] += s[1] * sdt;
    }
    const ld = this.land;
    ld[1] += (-ld[0] * 160 - ld[1] * 16) * sdt;
    ld[0] += ld[1] * sdt;
    const sp = this.springs;
    const J = this.j;
    const S = this.scale;
    const desiredYaw = yawOverride !== null ? yawOverride : this.facing > 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35;
    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-16 * dt));
    this.root.rotation.y = this.yaw;

    const drop = Math.max(0, ld[0]);
    J.hips.position.set(p.hipsPX * S, this.hipH + (p.hipsY - drop) * S, p.hipsPZ * S);
    J.hips.rotation.set(p.hipsX, p.hipsY_r, p.hipsZ);
    J.spine.rotation.set(p.spineX + sp.spineX[0], p.spineY + sp.spineY[0], p.spineZ);
    J.chest.rotation.set(p.chestX + sp.chestX[0] + drop * 0.6, p.chestY, p.chestZ);
    J.neck.rotation.set(p.neckX, p.neckY, 0);
    J.head.rotation.set(p.headX + sp.headX[0], p.headY, 0);
    J.shL.rotation.set(p.shLX, p.shLY, p.shLZ);
    J.elL.rotation.set(Math.min(0, p.elLX), 0, 0);
    J.hdL.rotation.set(p.hdLX, 0, p.hdLZ);
    J.shR.rotation.set(p.shRX, p.shRY, p.shRZ);
    J.elR.rotation.set(Math.min(0, p.elRX), 0, 0);
    J.hdR.rotation.set(p.hdRX, 0, p.hdRZ);
    let tLX = p.thLX, tRX = p.thRX, kLX = p.knLX, kRX = p.knRX, fLX = p.ftLX, fRX = p.ftRX;
    if (drop > 0.0005) { // keep feet planted while the pelvis dips: re-solve knee bend
      const comp = (th, kn, ft) => {
        const d = 2 * Math.cos(Math.max(0, kn) / 2);
        const d2 = Math.max(0.6, d - drop / 0.45);
        const kn2 = 2 * Math.acos(clamp(d2 / 2, -1, 1));
        const dk = kn2 - Math.max(0, kn);
        return [th - dk / 2, kn + dk, ft - dk / 2];
      };
      [tLX, kLX, fLX] = comp(tLX, kLX, fLX);
      [tRX, kRX, fRX] = comp(tRX, kRX, fRX);
    }
    J.thL.rotation.set(tLX, 0, p.thLZ);
    J.knL.rotation.set(Math.max(0, kLX), 0, 0);
    J.ftL.rotation.set(fLX, 0, 0);
    J.thR.rotation.set(tRX, 0, p.thRZ);
    J.knR.rotation.set(Math.max(0, kRX), 0, 0);
    J.ftR.rotation.set(fRX, 0, 0);
    // shoulders shrug up when arms rise
    for (const sd of ['L', 'R']) {
      const raise = clamp((-p['sh' + sd + 'X'] - 1.3) / 1.4, 0, 1) + clamp(Math.abs(p['sh' + sd + 'Z']) - 0.8, 0, 1) * 0.5;
      J['sh' + sd].position.y = this.restPos['sh' + sd].y + 0.028 * S * raise;
      J['sh' + sd].position.z = this.restPos['sh' + sd].z + 0.012 * S * clamp(-p['sh' + sd + 'X'] / 1.5, -0.5, 1);
    }
    this.body.rotation.set(p.fallX, 0, 0);
    this.body.position.y = Math.abs(Math.sin(p.fallX)) * 0.13 * S;
    this.body.position.z = p.fallY;

    // run-time IK passes need world matrices
    const hk = this.handIK;
    const needIK = p.aimR > 0.01 || p.ikL > 0.01 || p.ikR > 0.01 || (hk.L && hk.L.w > 0.01) || (hk.R && hk.R.w > 0.01);
    if (needIK) {
      this.root.updateMatrixWorld(true);
      if (p.aimR > 0.01) this._aim(clamp(p.aimR, 0, 1), p.aimPitch, yawOverride !== null);
      const sup = this._supportTargets();
      if (p.ikR > 0.01 && sup.grip) this._anchorIK('R', sup.grip, clamp(p.ikR, 0, 1));
      if (p.ikL > 0.01 && sup.support) this._anchorIK('L', sup.support, clamp(p.ikL, 0, 1));
      for (const sd of ['L', 'R']) if (hk[sd] && hk[sd].w > 0.01) this._armIK(sd, hk[sd].pos, hk[sd].quat, clamp(hk[sd].w, 0, 1));
    }

    // hand shapes: grip when holding a visible item or asked by the pose
    const held = { L: p.gripL > 0.5, R: p.gripR > 0.5 };
    for (const n in this.items) {
      const it = this.items[n];
      if (!it || !it.visible) continue;
      const jn = it.userData.joint;
      if (jn === 'hdL') held.L = true;
      if (jn === 'hdR') held.R = true;
    }
    if (p.ikL > 0.5) held.L = true;
    if (p.ikR > 0.5) held.R = true;
    if (hk.L && hk.L.w > 0.5 && hk.L.grip !== false) held.L = true;
    if (hk.R && hk.R.w > 0.5 && hk.R.grip !== false) held.R = true;
    for (const sd of ['L', 'R']) {
      const g = held[sd] ? 1 : 0.0001;
      this.xb['grip' + sd].scale.setScalar(g);
      this.xb['open' + sd].scale.setScalar(g === 1 ? 0.0001 : 1);
    }

    this._dynamics(dt, p);

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    const hf = this.hitFlash > 0 ? Math.min(1, this.hitFlash * 8) * 0.85 : 0;
    for (const m of this.mats) if (m.userData.hit) m.userData.hit.value = hf;
  }

  // support anchors from held items (weapon foregrip / grip). An anchor's -y axis is the
  // direction the fingers point, +z the thumb; its origin is where the palm centre goes.
  _supportTargets() {
    const out = { support: null, grip: null };
    for (const n in this.items) {
      const it = this.items[n];
      if (!it || !it.visible) continue;
      if (!out.support && it.userData.support) out.support = it.userData.support;
      if (!out.grip && it.userData.grip) out.grip = it.userData.grip;
    }
    return out;
  }

  // Aim IK: put the shooting hand in front of the chest and point the held weapon (hand -y
  // axis) exactly along the facing direction (or the root's forward when scripted), upright.
  _aim(w, pitch, scripted) {
    const J = this.j, S = this.scale;
    let fx, fz;
    if (scripted) { const f = _v2.set(0, 0, 1).transformDirection(this.root.matrixWorld); fx = f.x; fz = f.z; } else { fx = this.facing; fz = 0; }
    const hl = Math.hypot(fx, fz) || 1;
    fx /= hl; fz /= hl;
    const D = new THREE.Vector3(fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch));
    const R = new THREE.Vector3(-fz, 0, fx).negate(); // character's right when facing D
    const smg = this.items.smg && this.items.smg.visible;
    // tuned so muzzles line up with the gameplay bullet spawn (player.gunY / muzzle offsets)
    const reach = (smg ? 0.5 : 0.56) * S, drop = (smg ? 0.15 : 0.13) * S, side = (smg ? 0.06 : 0.02) * S;
    const c = J.chest.localToWorld(_v1.set(0, (this.spec.female ? 0.19 : 0.21) * S, 0.04 * S));
    const kick = Math.max(0, pitch) * 0.12 * S;
    const palm = c.addScaledVector(new THREE.Vector3(fx, 0, fz), reach - kick).addScaledVector(R, side).add(_v2.set(0, -drop, 0));
    // hand basis: fingers' axis (-y) along D, thumb (+z) up
    const y = D.clone().negate();
    const z = _v3.set(0, 1, 0).addScaledVector(y, -y.y).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    _m2.makeBasis(x, y, z);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m2);
    // the grip sits ~2 cm above the palm centre line of the fist
    this._armIK('R', palm, q, w, 0.06);
  }

  // Two-bone IK so the palm centre lands on `pos` (world) with hand orientation `quat`,
  // elbow down & out. back = palm-to-wrist distance along the hand's +y axis.
  _armIK(side, pos, quat, w, back = 0.072) {
    const J = this.j;
    const sh = J['sh' + side], el = J['el' + side], hd = J['hd' + side];
    const sd = side === 'L' ? 1 : -1;
    const S = this.scale;
    const target = _v4.copy(pos).add(_v3.set(0, back * S, 0).applyQuaternion(quat));
    _m1.copy(sh.parent.matrixWorld).invert();
    const L1 = el.position.length(), L2 = hd.position.length();
    const T = _v1.copy(target).applyMatrix4(_m1);
    const P0 = sh.position;
    const toT = _v2.subVectors(T, P0);
    let d = toT.length();
    d = clamp(d, Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
    const dh = toT.normalize();
    const pole = _v3.set(sd * 0.55, -1, -0.45).normalize();
    const pp = pole.clone().addScaledVector(dh, -pole.dot(dh)).normalize();
    const a1 = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const u = dh.clone().multiplyScalar(Math.cos(a1)).addScaledVector(pp, Math.sin(a1)).normalize();
    const zAxis = pp.clone().addScaledVector(u, -pp.dot(u)).negate().normalize();
    const yAxis = u.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    _m2.makeBasis(xAxis, yAxis, zAxis);
    _q1.setFromRotationMatrix(_m2);
    sh.quaternion.slerp(_q1, w);
    const cosE = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    const bend = Math.PI - Math.acos(cosE);
    el.rotation.x = lerp(el.rotation.x, -bend, w);
    sh.updateMatrixWorld(true);
    // hand orientation
    el.getWorldQuaternion(_q2).invert();
    _q1.copy(quat).premultiply(_q2);
    hd.quaternion.slerp(_q1, w);
    hd.updateMatrixWorld(true);
  }

  _anchorIK(side, anchor, w) {
    anchor.updateWorldMatrix(true, false);
    this._armIK(side, anchor.getWorldPosition(new THREE.Vector3()), anchor.getWorldQuaternion(new THREE.Quaternion()), w);
  }

  // Secondary motion: coat panels, skirts and long hair lag behind body motion.
  _dynamics(dt, p) {
    if (dt <= 0) return;
    const pos = this.root.position;
    if (!this.lastPos || this.lastPos.distanceToSquared(pos) > 2.25) { // first frame or teleport (pool reuse)
      this.lastPos = pos.clone();
      this.vel.set(0, 0, 0); this.acc.set(0, 0, 0);
    }
    const vx = (pos.x - this.lastPos.x) / dt, vy = (pos.y - this.lastPos.y) / dt;
    this.lastPos.copy(pos);
    const a = 1 - Math.exp(-12 * dt);
    const ax = (vx - this.vel.x) / dt, ay = (vy - this.vel.y) / dt;
    this.vel.x += (vx - this.vel.x) * a; this.vel.y += (vy - this.vel.y) * a;
    this.acc.x += (clamp(ax, -60, 60) - this.acc.x) * a; this.acc.y += (clamp(ay, -60, 60) - this.acc.y) * a;
    // local forward speed (character faces facing*x)
    const fwdV = this.vel.x * Math.sin(this.yaw), fwdA = this.acc.x * Math.sin(this.yaw);
    const upV = this.vel.y;
    const swing = (p.thLX + p.thRX) * 0.5;
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = Math.min(dt, 0.1) / steps;
    const sim = (key, tx, tz, K, D) => {
      const s = this.dyn[key];
      for (let i = 0; i < steps; i++) {
        s[1] += ((tx - s[0]) * K - s[1] * D) * h; s[0] += s[1] * h;
        s[3] += ((tz - s[2]) * K - s[3] * D) * h; s[2] += s[3] * h;
      }
      return s;
    };
    const fall = -p.fallX * 0.35;
    const c = sim('coat', clamp(fwdV * 0.09 + fwdA * 0.012 - upV * 0.03, -0.2, 1.1) + fall - swing * 0.15, 0, 90, 9);
    this.xb.coat.rotation.set(c[0], 0, c[2]);
    const cl = sim('coatL', clamp(fwdV * 0.06 + fwdA * 0.01, -0.3, 0.8) + Math.min(0, p.thLX) * 0.25 + fall, clamp(-fwdV * 0.03, -0.2, 0.2), 110, 10);
    this.xb.coatL.rotation.set(cl[0], 0, cl[2]);
    const cr = sim('coatR', clamp(fwdV * 0.06 + fwdA * 0.01, -0.3, 0.8) + Math.min(0, p.thRX) * 0.25 + fall, clamp(fwdV * 0.03, -0.2, 0.2), 110, 10);
    this.xb.coatR.rotation.set(cr[0], 0, cr[2]);
    const hr = sim('hair', clamp(fwdV * 0.05 + fwdA * 0.01 - upV * 0.03, -0.3, 0.6) - (p.headX + p.neckX + p.spineX) * 0.3, 0, 70, 7);
    this.xb.hair.rotation.set(hr[0], 0, hr[2]);
  }
}

// ------------------------------------------------------------ pose library

const LEG = 0.45; // metres per leg unit (thigh = shin = 1)
const TAU = Math.PI * 2;
const ease = (t) => t * t * (3 - 2 * t);
const frac = (x) => x - Math.floor(x);

// Ankle target (z forward, y up; leg units, relative to the hip socket), foot world pitch
// (positive = toes down) and lateral offset (+ = outward) -> thigh/knee/foot angles.
function legIK(o, side, z, y, pitch, x = 0) {
  const d = Math.min(1.997, Math.hypot(z, y, x));
  const kb = Math.acos(clamp(d * d / 2 - 1, -1, 1));
  const alpha = Math.atan2(z, -y);
  const thX = -(alpha + kb / 2) - (o.hipsX || 0);
  o['th' + side + 'X'] = thX;
  o['kn' + side + 'X'] = kb;
  o['ft' + side + 'X'] = pitch - (thX + (o.hipsX || 0) + kb);
  o['th' + side + 'Z'] = Math.asin(clamp(x / Math.max(d, 1e-3), -1, 1)) * (side === 'L' ? 1 : -1);
  return o;
}
// ground height for the ankle in leg units given the pose's pelvis drop
const groundY = (o) => -2 - (o.hipsY || 0) / LEG;

// Arm two-bone IK in the sagittal plane: wrist target (z fwd, y up) metres from the shoulder.
function armIK(o, side, z, y, L1 = 0.295, L2 = 0.265) {
  const d = clamp(Math.hypot(z, y), Math.abs(L1 - L2) + 0.01, (L1 + L2) * 0.998);
  const alpha = Math.atan2(z, -y);
  const a1 = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const cosE = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
  o['sh' + side + 'X'] = -(alpha - a1);
  o['el' + side + 'X'] = -(Math.PI - Math.acos(cosE));
  return o;
}

// Run/walk foot path: returns [z, h(above ground), pitch] for cycle position u.
const RUN_SWING = [[0, -1.25, 0.5, 0.95], [0.18, -1.05, 1.0, 1.1], [0.42, -0.25, 1.08, 0.5], [0.66, 0.55, 0.85, 0.0], [0.86, 0.85, 0.3, -0.3], [1.0, 0.75, 0.06, -0.25]];
const WALK_SWING = [[0, -0.8, 0.22, 0.75], [0.3, -0.45, 0.38, 0.45], [0.6, 0.15, 0.22, -0.05], [0.85, 0.65, 0.1, -0.3], [1.0, 0.75, 0.04, -0.25]];
function pathAt(tbl, s) {
  let i = 0;
  while (i < tbl.length - 2 && s > tbl[i + 1][0]) i++;
  const r0 = tbl[Math.max(0, i - 1)], r1 = tbl[i], r2 = tbl[i + 1], r3 = tbl[Math.min(tbl.length - 1, i + 2)];
  const t = (s - r1[0]) / (r2[0] - r1[0]);
  const out = [];
  for (let k = 1; k < 4; k++) {
    const m1 = (r2[k] - r0[k]) * 0.5, m2 = (r3[k] - r1[k]) * 0.5;
    const t2 = t * t, t3 = t2 * t;
    out.push((2 * t3 - 3 * t2 + 1) * r1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * r2[k] + (t3 - t2) * m2);
  }
  return out;
}
function footRun(u, beta, swingTbl, zT, zO, heelUp) {
  if (u < beta) {
    const s = u / beta;
    const z = lerp(zT, zO, s);
    const h = 0.05 * (1 - s) * (1 - s) + heelUp * Math.pow(sstep(0.45, 1, s), 1.5);
    const pitch = s < 0.25 ? lerp(-0.25, 0, s / 0.25) : s < 0.5 ? 0 : lerp(0, swingTbl[0][3], sstep(0.5, 1, s));
    return [z, h, pitch, 1];
  }
  const [z, h, pitch] = pathAt(swingTbl, (u - beta) / (1 - beta));
  return [z, h, pitch, 0];
}

// Writes into `o` (a pose object) – all return the same object for chaining.
export const Poses = {
  idle(o, t, armed = 0) {
    const br = Math.sin(t * 1.55);
    // slow weight shifts between legs (contrapposto), held most of the time
    const ws = Math.tanh(Math.sin(t * 0.19 + 0.6) * 3.2);
    o.hipsY = -0.012 + br * 0.0025;
    o.hipsPX = 0.026 * ws;
    o.hipsZ = 0.045 * ws;
    o.hipsY_r = -0.06 * ws;
    o.spineX = 0.015; o.spineZ = -0.03 * ws; o.chestZ = -0.02 * ws;
    o.spineY = 0.04 * ws;
    o.chestX = br * 0.018 - 0.02;
    o.neckX = -0.03; o.neckY = 0.0;
    o.headX = -0.04 + Math.sin(t * 0.37) * 0.025;
    o.headY = Math.sin(t * 0.23) * 0.14 + Math.sin(t * 0.61) * 0.04;
    // legs: weight leg straight under the body, free leg relaxed forward & out
    const wL = (ws + 1) / 2, wR = 1 - wL;
    const yG = groundY(o);
    legIK(o, 'L', lerp(0.04, 0.16, wR), yG + 0.04 * wR, -0.05 * wR, 0.06 - o.hipsPX / LEG + 0.03 * wR);
    legIK(o, 'R', lerp(-0.03, 0.14, wL), yG + 0.04 * wL, -0.05 * wL, 0.07 + o.hipsPX / LEG + 0.03 * wL);
    o.shLX = 0.04 + br * 0.01; o.shLZ = 0.13; o.elLX = -0.22; o.hdLZ = -0.05; o.hdLX = 0.05;
    o.shRX = 0.06 + br * 0.01; o.shRZ = -0.13; o.elRX = -0.26; o.hdRX = 0.05;
    if (armed) { o.shRX = -0.12; o.shRZ = -0.1; o.elRX = -0.72; o.hdRX = -0.28; o.gripR = 1; }
    return o;
  },
  run(o, phase, amp = 1) {
    const a = clamp(amp, 0, 1);
    const u = frac(phase / TAU);
    const beta = 0.3;
    const bob = Math.cos(TAU * 2 * (u - beta / 2));
    o.hipsY = (-0.045 - 0.03 * bob) * a - 0.01 * (1 - a);
    const fL = footRun(u, beta, RUN_SWING, 0.75, -1.25, 0.5);
    const fR = footRun(frac(u + 0.5), beta, RUN_SWING, 0.75, -1.25, 0.5);
    const yG = groundY(o);
    o.hipsPX = 0.012 * a * (fR[1] - fL[1]);
    o.hipsZ = 0.035 * a * (fR[1] - fL[1]);
    o.hipsY_r = -0.09 * a * (fL[0] - fR[0]) / 2;
    o.hipsX = 0.04 * a;
    legIK(o, 'L', fL[0] * a, yG + fL[1] * a, fL[2] * a, 0.03);
    legIK(o, 'R', fR[0] * a, yG + fR[1] * a, fR[2] * a, 0.03);
    // torso: forward lean, counter-rotating shoulders, head stabilised
    o.spineX = 0.13 * a + 0.03 * a * bob;
    o.spineY = 0.12 * a * (fL[0] - fR[0]) / 2;
    o.chestY = 0.08 * a * (fL[0] - fR[0]) / 2;
    o.chestX = 0.03 * a;
    o.neckX = -0.1 * a;
    o.headX = -0.06 * a - 0.02 * a * bob;
    o.headY = -o.spineY * 0.6;
    // arms pump opposite to the legs, fists loose
    const armL = (fR[0] - fL[0]) / 2, armR = -armL;
    o.shLX = -0.72 * a * armL + 0.1 * a; o.shLZ = 0.1;
    o.shRX = -0.72 * a * armR + 0.1 * a; o.shRZ = -0.1;
    o.elLX = (-1.25 - 0.45 * Math.max(0, armL)) * a - 0.22 * (1 - a);
    o.elRX = (-1.25 - 0.45 * Math.max(0, armR)) * a - 0.22 * (1 - a);
    o.hdLX = 0.1 * a; o.hdRX = 0.1 * a;
    o.gripL = o.gripR = a > 0.4 ? 1 : 0;
    return o;
  },
  walk(o, phase, amp = 1) {
    const a = clamp(amp, 0, 1);
    const u = frac(phase / TAU);
    const beta = 0.6;
    const bob = Math.cos(TAU * 2 * (u - beta / 2));
    o.hipsY = (-0.012 + 0.012 * bob) * a - 0.01;
    const fL = footRun(u, beta, WALK_SWING, 0.75, -0.8, 0.3);
    const fR = footRun(frac(u + 0.5), beta, WALK_SWING, 0.75, -0.8, 0.3);
    const yG = groundY(o);
    o.hipsPX = 0.02 * a * Math.sin(TAU * u);
    o.hipsZ = 0.03 * a * Math.sin(TAU * u);
    o.hipsY_r = -0.08 * a * (fL[0] - fR[0]) / 2;
    legIK(o, 'L', fL[0] * a, yG + fL[1] * a, fL[2] * a, 0.04 - o.hipsPX / LEG);
    legIK(o, 'R', fR[0] * a, yG + fR[1] * a, fR[2] * a, 0.04 + o.hipsPX / LEG);
    o.spineX = 0.03; o.chestX = 0.01;
    o.spineY = 0.1 * a * (fL[0] - fR[0]) / 2;
    o.neckX = -0.02;
    o.headY = -o.spineY * 0.5;
    const armL = (fR[0] - fL[0]) / 2;
    o.shLX = -0.4 * a * armL; o.shLZ = 0.1; o.elLX = -0.25 - 0.25 * Math.max(0, armL) * a;
    o.shRX = 0.4 * a * armL; o.shRZ = -0.1; o.elRX = -0.25 - 0.25 * Math.max(0, -armL) * a;
    return o;
  },
  jump(o, vy) {
    const t = clamp(vy / 14, -1, 1);
    const up = Math.max(0, t), dn = Math.max(0, -t);
    const apex = 1 - Math.abs(t);
    o.hipsY = -0.02;
    o.spineX = 0.08 + 0.12 * apex - 0.06 * dn;
    o.chestX = 0.04 * apex;
    o.neckX = -0.06 - 0.06 * apex;
    o.headX = -0.04;
    // lead leg drives up, push leg trails; tuck at the apex; both extend for landing
    o.thLX = lerp(lerp(-1.2, -1.45, apex), -0.6, dn) - 0.15 * up; o.knLX = lerp(lerp(1.5, 1.9, apex), 0.55, dn);
    o.thRX = lerp(lerp(0.3, -0.9, apex), -0.2, dn); o.knRX = lerp(lerp(0.35, 1.8, apex), 0.4, dn);
    o.ftLX = lerp(0.45, 0.1, dn); o.ftRX = lerp(0.7 * up + 0.3, 0.15, dn);
    o.thLZ = 0.06; o.thRZ = -0.06;
    // arms: drive up on take-off, out for balance when falling
    o.shLX = lerp(lerp(0.4, -0.6, apex), -0.35, dn); o.shLZ = lerp(0.25, 0.95, dn); o.elLX = lerp(-1.1, -0.45, dn);
    o.shRX = lerp(lerp(-1.4, -0.8, apex), -0.25, dn); o.shRZ = lerp(-0.2, -0.95, dn); o.elRX = lerp(-1.0, -0.5, dn);
    o.gripL = o.gripR = up > 0.3 ? 1 : 0;
    return o;
  },
  crouch(o, t) {
    o.hipsY = -0.44;
    o.hipsX = 0.1;
    o.spineX = 0.36; o.spineY = 0; o.chestX = 0.1 + Math.sin(t * 2) * 0.012; o.chestY = 0;
    o.neckX = -0.38; o.headX = -0.14;
    const yG = groundY(o);
    legIK(o, 'L', 0.32, yG + 0.02, 0.0, 0.12);
    legIK(o, 'R', -0.42, yG + 0.3, 0.75, 0.1);
    o.shLX = -0.75; o.shLZ = 0.12; o.elLX = -0.9; o.hdLX = 0.2;
    o.shRX = -0.5; o.shRZ = -0.15; o.elRX = -1.05;
    return o;
  },
  climb(o, phase) {
    const u = frac(phase / TAU);
    o.hipsY = -0.03; o.spineX = 0.06; o.spineY = 0; o.chestY = 0; o.neckX = -0.22; o.headX = -0.12;
    const hand = (k) => { // hold (rung moves down relative to the body), then reach up
      if (k < 0.72) { const s = k / 0.72; return [0.27, lerp(0.42, 0.04, s)]; }
      const s = (k - 0.72) / 0.28;
      return [0.27 - 0.06 * Math.sin(s * Math.PI), lerp(0.04, 0.42, ease(s))];
    };
    const foot = (k) => {
      if (k < 0.72) { const s = k / 0.72; return [0.36, lerp(-1.0, -1.75, s)]; }
      const s = (k - 0.72) / 0.28;
      return [0.36 + 0.25 * Math.sin(s * Math.PI), lerp(-1.75, -1.0, ease(s))];
    };
    const hL = hand(u), hR = hand(frac(u + 0.5));
    armIK(o, 'L', hL[0], hL[1]); armIK(o, 'R', hR[0], hR[1]);
    o.shLZ = 0.22; o.shRZ = -0.22; o.hdLX = -0.3; o.hdRX = -0.3;
    o.gripL = hL[1] > 0.38 && u > 0.9 ? 0 : 1; o.gripR = 1;
    const fL = foot(frac(u + 0.5)), fR = foot(u);
    legIK(o, 'L', fL[0], fL[1], 0.1, 0.06); legIK(o, 'R', fR[0], fR[1], 0.1, 0.06);
    o.hipsPX = 0.02 * Math.sin(u * TAU);
    return o;
  },
  // upper-body overlays -------------------------------------------------
  aimPistol(o, facing, recoil = 0, low = false) {
    const lean = (o.spineX || 0) + (o.chestX || 0) + (o.hipsX || 0);
    o.spineY = 0.3 * facing - (o.hipsY_r || 0);
    o.chestY = 0.07 * facing;
    o.chestX = (o.chestX || 0) - 0.04 * recoil;
    o.shRX = -1.42 - lean + recoil * 0.25; o.shRY = 0.0; o.shRZ = 0.32; o.elRX = -0.32 - recoil * 0.25; o.hdRX = 0.05;
    o.shLX = -1.3 - lean; o.shLZ = -0.42; o.elLX = -0.8; o.hdLX = 0.1; o.hdLZ = -0.3;
    o.neckX = -0.04; o.headX = -0.02 - 0.03 * recoil; o.headY = -0.06 * facing;
    o.aimR = 1; o.ikL = 1; o.gripR = 1; o.gripL = 1;
    o.aimPitch = recoil * 0.32 + (low ? -0.05 : 0);
    return o;
  },
  aimSMG(o, facing, recoil = 0) {
    const lean = (o.spineX || 0) + (o.chestX || 0) + (o.hipsX || 0);
    o.spineY = 0.32 * facing - (o.hipsY_r || 0);
    o.chestY = 0.06 * facing;
    o.chestX = (o.chestX || 0) - 0.02 * recoil;
    o.shRX = -1.05 - lean + recoil * 0.1; o.shRZ = 0.3; o.elRX = -0.85; o.hdRX = 0.4;
    o.shLX = -1.25 - lean; o.shLZ = -0.3; o.elLX = -0.6; o.hdLX = 0.0; o.hdLZ = -0.6;
    o.neckX = 0.04; o.headX = 0.06;
    o.aimR = 1; o.ikL = 1; o.gripR = 1; o.gripL = 1;
    o.aimPitch = recoil * 0.12;
    return o;
  },
  throwArm(o, facing, k) { // k: 0 windup -> 1 follow-through
    const wind = k < 0.42;
    const rel = clamp((k - 0.42) / 0.16, 0, 1), fol = clamp((k - 0.58) / 0.42, 0, 1);
    const w = ease(clamp(k / 0.42, 0, 1));
    o.spineY = (wind ? lerp(0.1, -0.35, w) : lerp(-0.35, 0.5, ease(rel))) * facing;
    o.chestX = wind ? lerp(0, -0.16, w) : lerp(-0.16, 0.28, ease(rel)) - 0.08 * fol;
    if (wind) {
      o.shRX = lerp(-0.4, 0.35, w); o.shRZ = lerp(-0.2, -1.35, w); o.elRX = lerp(-0.6, -1.75, w); o.hdRX = lerp(0, 0.5, w);
      o.shLX = lerp(-0.5, -1.45, w); o.shLZ = lerp(0.2, 0.05, w); o.elLX = lerp(-0.6, -0.25, w);
    } else {
      o.shRX = lerp(lerp(0.35, -2.25, ease(rel)), -0.7, ease(fol)); o.shRZ = lerp(lerp(-1.35, -0.45, rel), 0.25, fol);
      o.elRX = lerp(lerp(-1.75, -0.25, ease(rel)), -0.5, fol); o.hdRX = lerp(0.5, -0.3, rel);
      o.shLX = lerp(-1.45, -0.3, ease(rel)); o.shLZ = 0.15; o.elLX = lerp(-0.25, -1.6, rel);
    }
    o.headY = -o.spineY * 0.7;
    o.gripL = 1;
    return o;
  },
  headbutt(o, k) { // 0..1
    o.gripL = o.gripR = 1;
    if (k < 0.38) { // coil back, chin up
      const t = ease(k / 0.38);
      o.spineX = lerp(0.04, -0.14, t); o.chestX = lerp(0, -0.2, t); o.neckX = lerp(0, -0.28, t); o.headX = lerp(0, -0.24, t);
      o.shLX = lerp(0, 0.4, t); o.shRX = lerp(0, 0.4, t); o.elLX = -1.3; o.elRX = -1.3; o.shLZ = 0.25; o.shRZ = -0.25;
    } else if (k < 0.52) { // snap
      const t = (k - 0.38) / 0.14;
      const s = 1 - (1 - t) * (1 - t) * (1 - t);
      o.spineX = lerp(-0.14, 0.28, s); o.chestX = lerp(-0.2, 0.2, s); o.neckX = lerp(-0.28, 0.3, s); o.headX = lerp(-0.24, 0.24, s);
      o.shLX = lerp(0.4, 0.75, s); o.shRX = lerp(0.4, 0.75, s); o.elLX = -1.6; o.elRX = -1.6;
      o.shLZ = 0.4; o.shRZ = -0.4;
    } else { // recover
      const t = ease((k - 0.52) / 0.48);
      o.spineX = lerp(0.28, 0.06, t); o.chestX = lerp(0.2, 0.0, t); o.neckX = lerp(0.3, 0, t); o.headX = lerp(0.24, 0, t);
      o.shLX = lerp(0.75, 0.05, t); o.shRX = lerp(0.75, 0.05, t); o.elLX = lerp(-1.6, -0.4, t); o.elRX = lerp(-1.6, -0.4, t);
      o.shLZ = lerp(0.4, 0.15, t); o.shRZ = lerp(-0.4, -0.15, t);
    }
    return o;
  },
  punch(o, k, facing) {
    o.gripL = o.gripR = 1;
    o.shLX = -0.95; o.shLZ = 0.05; o.elLX = -2.05; o.hdLX = 0.25; // guard
    if (k < 0.28) { // chamber
      const t = ease(k / 0.28);
      o.spineY = lerp(0.2, -0.22, t) * facing; o.chestX = lerp(0, 0.05, t);
      o.shRX = lerp(-0.6, -0.35, t); o.shRZ = -0.1; o.elRX = lerp(-1.6, -2.15, t);
    } else if (k < 0.46) { // strike: hips & shoulders drive the fist through
      const t = (k - 0.28) / 0.18;
      const s = 1 - (1 - t) * (1 - t);
      o.spineY = lerp(-0.22, 0.6, s) * facing; o.spineX = lerp(0.05, 0.22, s); o.chestX = lerp(0.05, 0.12, s);
      o.shRX = lerp(-0.35, -1.62, s); o.shRZ = lerp(-0.1, 0.32, s); o.elRX = lerp(-2.15, -0.04, s); o.hdRX = 0.05;
    } else { // retract
      const t = ease((k - 0.46) / 0.54);
      o.spineY = lerp(0.6, 0.25, t) * facing; o.spineX = lerp(0.22, 0.08, t); o.chestX = lerp(0.12, 0.02, t);
      o.shRX = lerp(-1.62, -0.7, t); o.shRZ = lerp(0.32, 0.0, t); o.elRX = lerp(-0.04, -1.8, t);
    }
    return o;
  },
  axeSwing(o, k, facing) {
    o.gripL = o.gripR = 1;
    o.ikL = 1; // off hand rides the haft
    o.spineY = 0.22 * facing;
    if (k < 0.45) { // wind up high behind the head, back arched
      const t = ease(k / 0.45);
      o.shRX = lerp(-0.6, -2.95, t); o.shLX = lerp(-0.6, -2.7, t); o.elRX = lerp(-0.6, -1.1, t); o.elLX = lerp(-0.7, -1.2, t);
      o.spineX = lerp(0.05, -0.18, t); o.chestX = lerp(0, -0.2, t); o.neckX = lerp(0, -0.15, t);
    } else if (k < 0.65) { // chop
      const t = (k - 0.45) / 0.2;
      const s = t * t * (2 - t);
      o.shRX = lerp(-2.95, -0.55, s); o.shLX = lerp(-2.7, -0.45, s); o.elRX = lerp(-1.1, -0.2, s); o.elLX = lerp(-1.2, -0.3, s);
      o.spineX = lerp(-0.18, 0.5, s); o.chestX = lerp(-0.2, 0.25, s); o.neckX = lerp(-0.15, 0.1, s);
      o.hdRX = lerp(0, -0.5, s);
    } else { // recover
      const t = ease((k - 0.65) / 0.35);
      o.shRX = lerp(-0.55, -0.7, t); o.shLX = lerp(-0.45, -0.6, t); o.elRX = lerp(-0.2, -0.9, t); o.elLX = lerp(-0.3, -1.0, t);
      o.spineX = lerp(0.5, 0.1, t); o.chestX = lerp(0.25, 0, t); o.hdRX = lerp(-0.5, 0, t);
    }
    o.shLZ = -0.28; o.shRZ = 0.22;
    return o;
  },
  shoulderTube(o, facing) { // bazooka on right shoulder
    o.spineY = 0.3 * facing - (o.hipsY_r || 0);
    o.shRX = -0.95; o.shRZ = -0.25; o.elRX = -1.7; o.hdRX = 0.3;
    o.shLX = -1.4; o.shLZ = -0.25; o.elLX = -0.45;
    o.neckX = 0.06; o.headX = 0.04; o.headY = 0.12 * facing;
    o.ikL = 1; o.ikR = 1; o.gripL = o.gripR = 1;
    return o;
  },
  push(o) { // pushing a pram
    o.spineX = 0.32; o.chestX = 0.05;
    o.shLX = -1.0; o.shRX = -1.0; o.shLZ = 0.08; o.shRZ = -0.08; o.elLX = -0.55; o.elRX = -0.55; o.hdLX = 0.45; o.hdRX = 0.45;
    o.gripL = o.gripR = 1;
    return o;
  },
  carry(o) { // grabber carrying someone over the shoulder
    o.shLX = -2.35; o.shLZ = 0.2; o.elLX = -1.75; o.shRX = -0.5; o.shRZ = -0.15; o.elRX = -0.8; o.spineX = 0.16; o.chestX = 0.05;
    o.gripL = 1;
    return o;
  },
  carried(o, t) { // limp over a shoulder, kicking and pounding
    o.fallX = 0;
    o.spineX = 1.15; o.chestX = 0.35; o.neckX = 0.25; o.headX = 0.1 + Math.sin(t * 7) * 0.1;
    o.shLX = -2.4 + Math.sin(t * 9) * 0.45; o.shRX = -2.2 + Math.sin(t * 8 + 1.3) * 0.45; o.elLX = -0.5 - Math.max(0, Math.sin(t * 9)) * 0.8; o.elRX = -0.6 - Math.max(0, Math.sin(t * 8 + 1.3)) * 0.8;
    o.shLZ = 0.2; o.shRZ = -0.2; o.gripL = o.gripR = 1;
    o.thLX = -0.25 + Math.sin(t * 10) * 0.45; o.knLX = 0.9 + Math.sin(t * 10) * 0.5; o.thRX = 0.05 - Math.sin(t * 10) * 0.4; o.knRX = 0.7 - Math.sin(t * 10) * 0.3;
    o.ftLX = 0.4; o.ftRX = 0.4;
    return o;
  },
  hurt(o, k) {
    const f = 1 - ease(clamp(k, 0, 1));
    o.spineX = (o.spineX || 0) - 0.28 * f; o.chestX = (o.chestX || 0) - 0.12 * f; o.neckX = -0.3 * f; o.headX = -0.25 * f;
    o.shLZ = 0.55 * f + (o.shLZ || 0) * (1 - f); o.shRZ = -0.55 * f + (o.shRZ || 0) * (1 - f);
    o.shLX = lerp(o.shLX || 0, -0.4, f); o.shRX = lerp(o.shRX || 0, -0.4, f); o.elLX = lerp(o.elLX || 0, -0.9, f); o.elRX = lerp(o.elRX || 0, -0.9, f);
    o.aimR = (o.aimR || 0) * (1 - f); o.ikL = (o.ikL || 0) * (1 - f);
    return o;
  },
  dead(o, k, dir = -1) { // k: 0..1 fall progress (dir -1 = backwards)
    const buck = ease(clamp(k / 0.3, 0, 1));
    const fall = clamp((k - 0.15) / 0.85, 0, 1);
    const e = fall * fall;
    o.fallX = dir * (Math.PI / 2) * e;
    o.fallY = 0;
    o.hipsY = -0.14 * buck * (1 - e);
    o.spineX = 0.12 * buck - 0.32 * e; o.chestX = -0.1 * e; o.neckX = (0.2 * buck - 0.35 * e) * -dir * -1; o.headX = 0.25 * e; o.headY = 0.5 * e;
    // knees buckle first, legs sprawl as the body lands
    o.thLX = lerp(-0.55 * buck, -0.35, e); o.knLX = lerp(1.0 * buck, 0.6, e); o.thLZ = 0.12 + 0.1 * e;
    o.thRX = lerp(-0.25 * buck, 0.1, e); o.knRX = lerp(0.7 * buck, 0.2, e); o.thRZ = -0.08 - 0.08 * e;
    o.ftLX = 0.3 * e; o.ftRX = 0.4 * e;
    // arms fly up/out, then splay
    o.shLX = lerp(-0.4 * buck, -0.9, e) - 0.6 * Math.sin(fall * Math.PI); o.shLZ = 0.4 + 0.9 * e; o.elLX = -0.5 + 0.2 * e;
    o.shRX = lerp(-0.3 * buck, -1.3, e) - 0.5 * Math.sin(fall * Math.PI); o.shRZ = -0.3 - 0.75 * e; o.elRX = -0.9 + 0.3 * e;
    return o;
  },
  cower(o, t) { // Ingrid waiting/afraid
    const tr = Math.sin(t * 23) * 0.012;
    o.hipsY = -0.06; o.spineX = 0.22; o.chestX = 0.12 + tr; o.neckX = 0.08; o.headX = 0.12; o.headY = Math.sin(t * 2.3) * 0.28;
    o.shLX = -1.05; o.shLZ = -0.25; o.elLX = -2.1; o.hdLX = 0.45;
    o.shRX = -1.0; o.shRZ = 0.28; o.elRX = -2.15; o.hdRX = 0.45;
    const yG = groundY(o);
    legIK(o, 'L', 0.05, yG, 0, -0.02); legIK(o, 'R', 0.12, yG + 0.05, 0.1, -0.03);
    o.thLZ -= 0.04; o.thRZ += 0.04;
    return o;
  },
  wave(o, t) {
    o.shRX = -2.5; o.shRZ = -0.35 + Math.sin(t * 9) * 0.32; o.elRX = -0.45 - Math.sin(t * 9 + 0.5) * 0.25; o.hdRX = -0.1;
    o.headY = -0.1; o.chestZ = 0.04;
    return o;
  },
  victory(o, t) {
    o.shRX = -2.95; o.shRZ = -0.1; o.elRX = -0.15; o.hdRX = 0; o.gripR = 1;
    o.chestX = -0.12; o.headX = -0.18; o.spineZ = 0.05 + Math.sin(t * 2) * 0.02;
    return o;
  },
  // extra: look along a direction (yaw/pitch, radians) using neck and head
  look(o, yaw, pitch = 0) {
    o.neckY = yaw * 0.4; o.headY = yaw * 0.6; o.neckX = pitch * 0.4; o.headX = pitch * 0.6;
    return o;
  },
};

// Copies upper-body keys from src into dst (for layering actions over locomotion).
const UPPER = ['spineY', 'chestX', 'chestY', 'chestZ', 'neckX', 'neckY', 'headX', 'headY', 'shLX', 'shLY', 'shLZ', 'elLX', 'hdLX', 'hdLZ', 'shRX', 'shRY', 'shRZ', 'elRX', 'hdRX', 'hdRZ', 'aimR', 'aimPitch', 'ikL', 'ikR', 'gripL', 'gripR'];
export function layerUpper(dst, src, w = 1) {
  for (const k of UPPER) dst[k] = (dst[k] || 0) + ((src[k] || 0) - (dst[k] || 0)) * w;
  return dst;
}
export function copyPose(dst, src) {
  for (const k of POSE_KEYS) dst[k] = src[k] || 0;
  return dst;
}
export function resetPose(o) {
  for (const k of POSE_KEYS) o[k] = 0;
  return o;
}
