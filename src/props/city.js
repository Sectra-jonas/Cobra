// City street props for the rain-soaked 1986 LA night levels: street furniture, fire
// escapes, storefronts with real tube neon, building facades and rooftop clutter.
// Conventions: docs/ENGINE_CONVENTIONS.md (origin at ground centre, +z faces the camera,
// facades at z = -1.2). Static parts are merged per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, solid, grating, hazard, worldUV, windowMat, chainLinkMat } from '../core/materials.js';
import * as TX from '../core/textures.js';

const PI = Math.PI, HP = PI / 2, TAU = PI * 2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const v2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
const _o = new THREE.Object3D();
const _up = new THREE.Vector3(0, 1, 0);

// ================================================================ geometry kit

// Applies a TRS transform to a geometry in place.
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

// Zero-length normals (poles, collapsed bevel corners) become NaN in the shader's normalize().
function fixNormals(g) {
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i)) < 1e-6) n.setXYZ(i, 0, 1, 0);
  return g;
}

function clean(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  fixNormals(g);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

// Collects transformed geometries per material and merges each set into one mesh.
class Kit {
  constructor() { this.b = new Map(); }

  add(material, geo, uv = 0, shadow = true) {
    if (uv) worldUV(geo, uv);
    const key = material.uuid + (shadow ? '+' : '-');
    let e = this.b.get(key);
    if (!e) this.b.set(key, (e = { material, shadow, geos: [] }));
    e.geos.push(geo);
    return geo;
  }

  box(material, w, h, d, x, y, z, o = {}) {
    return this.add(material, xf(new THREE.BoxGeometry(w, h, d), x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), o.uv ?? 0, o.shadow ?? true);
  }

  cyl(material, rt, rb, h, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 12, 1, o.open ?? false);
    return this.add(material, xf(g, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), o.uv ?? 0, o.shadow ?? true);
  }

  // Square bar (w x d section) or round rod (radius w, o.round) from point a to point b.
  bar(material, a, b, w, d = w, o = {}) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = o.round ? new THREE.CylinderGeometry(w, w, len, o.seg ?? 6, 1, !o.capped) : new THREE.BoxGeometry(w, len, d);
    _o.position.copy(a).addScaledVector(dir, 0.5);
    _o.quaternion.setFromUnitVectors(_up, dir.normalize());
    _o.scale.set(1, 1, 1);
    _o.updateMatrix();
    g.applyMatrix4(_o.matrix);
    return this.add(material, g, o.uv ?? 0, o.shadow ?? true);
  }

  flush(group) {
    for (const e of this.b.values()) {
      let geos = e.geos.map(clean);
      if (geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      const m = new THREE.Mesh(geo, e.material);
      m.castShadow = e.shadow;
      m.receiveShadow = true;
      group.add(m);
    }
    this.b.clear();
    return group;
  }
}

// Remaps a geometry's 0..1 UVs into the atlas rectangle [u0,u1] x [v0,v1].
function uvRect(geo, u0, v0, u1, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function triGeo(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3));
  g.computeVertexNormals();
  return g;
}

// Merges a sub-prop's static meshes into `kit`, re-parents its named / animated nodes into
// `group` and forwards its gameplay data, shifted to (x, y, z).
function compose(group, kit, child, x = 0, y = 0, z = 0, o = {}) {
  child.position.set(x, y, z);
  if (o.ry) child.rotation.y = o.ry;
  child.updateMatrixWorld(true);
  const keep = [];
  const visit = (node) => {
    for (const c of node.children) {
      if (c.name || c.userData.dynamic || c.isInstancedMesh || c.isLight || (c.isMesh && Array.isArray(c.material))) { keep.push(c); continue; }
      if (c.isMesh) kit.add(c.material, c.geometry.clone().applyMatrix4(c.matrixWorld), 0, c.castShadow);
      visit(c);
    }
  };
  visit(child);
  group.updateMatrixWorld(true);
  for (const c of keep) group.attach(c);
  const ud = child.userData, gd = group.userData;
  if (o.colliders !== false) {
    for (const c of ud.colliders || []) {
      (gd.colliders ||= []).push(c.type === 'ledge'
        ? { ...c, x0: c.x0 + x, x1: c.x1 + x, y: c.y + y }
        : { ...c, x0: c.x0 + x, x1: c.x1 + x, y0: c.y0 + y, y1: c.y1 + y });
    }
    for (const l of ud.ladders || []) (gd.ladders ||= []).push({ ...l, x: l.x + x, y0: l.y0 + y, y1: l.y1 + y, z: l.z === undefined ? undefined : l.z + z });
  }
  if (o.lights !== false) for (const L of ud.lights || []) (gd.lights ||= []).push({ ...L, pos: L.pos.clone().applyMatrix4(child.matrixWorld) });
  for (const e of ud.emitters || []) (gd.emitters ||= []).push({ ...e, pos: e.pos.clone().applyMatrix4(child.matrixWorld) });
  if (ud.update) (gd._updates ||= []).push(ud.update);
}

// Flushes the kit and folds composed update callbacks (+ an own one) into userData.update.
function finalize(g, k, update = null) {
  k.flush(g);
  const ups = g.userData._updates || [];
  delete g.userData._updates;
  if (update) ups.push(update);
  if (ups.length === 1) g.userData.update = ups[0];
  else if (ups.length) g.userData.update = (dt, t) => { for (const u of ups) u(dt, t); };
  return g;
}

function addMesh(parent, geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(fixNormals(geo), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ================================================================ materials

const MC = new Map();
function cmat(key, make) {
  let m = MC.get(key);
  if (!m) MC.set(key, (m = make()));
  return m;
}

// Canvas-painted material (texture cached by key). p.glow > 0 makes the art emissive.
function paintMat(key, w, h, draw, p = {}) {
  return cmat(`paint:${key}:${JSON.stringify(p)}`, () => {
    const map = TX.painted(key, w, h, draw);
    const { glow: gl = 0, repeat = false, ...rest } = p;
    if (repeat) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; }
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0, ...rest });
    if (gl) { m.emissiveMap = map; m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = gl; }
    return m;
  });
}

const DECAL = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

function emissiveMat(color, intensity, base = '#000000', rough = 0.35) {
  return cmat(`em${color}${intensity}${base}${rough}`, () => new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: rough }));
}

// Soft additive light cone / beam: brightest at the narrow end (uv.y = 1), fades at grazing angles.
function beamMat(color, opacity = 0.1, unique = false) {
  const make = () => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying float vF;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vF = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vUv; varying float vF;
      void main() {
        // clamp: MSAA can extrapolate varyings past the edge, and pow(<0) is NaN
        float a = pow(clamp(vUv.y, 0.0, 1.0), 1.8) * vF * vF * opacity;
        gl_FragColor = vec4(color * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  return unique ? make() : cmat(`beam${color}${opacity}`, make);
}

// Vertical grime / rust streak decal (alpha).
function streakMat(kind = 'dark') {
  return paintMat(`streak-${kind}`, 128, 256, (c, w, h) => {
    const R = TX.rng(kind.length * 31 + 7);
    const col = kind === 'rust' ? '96,44,16' : '8,8,10';
    for (let i = 0; i < 46; i++) {
      const x = R() * w, len = h * (0.25 + R() * 0.75), wd = 2 + R() * 9;
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(${col},${0.1 + R() * 0.25})`);
      g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g;
      c.fillRect(x, 0, wd, len);
    }
  }, { ...DECAL, roughness: 0.55 });
}

// Canvas helpers ----------------------------------------------------------------

function grimeCanvas(c, w, h, R, amount = 0.5) {
  for (let i = 0; i < 60 * amount; i++) {
    const x = R() * w, y = R() * h, r = (0.05 + R() * 0.25) * Math.min(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,16,12,${0.12 * amount + R() * 0.15 * amount})`);
    g.addColorStop(1, 'rgba(20,16,12,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 30 * amount; i++) {
    c.fillStyle = `rgba(15,12,10,${0.08 + R() * 0.15})`;
    c.fillRect(R() * w, R() * h * 0.5, 1 + R() * 3, h * (0.2 + R() * 0.6));
  }
}

function fitFont(c, text, maxW, px, family = 'Impact, "Arial Black", sans-serif', weight = '900') {
  let size = px;
  c.font = `${weight} ${size}px ${family}`;
  while (c.measureText(text).width > maxW && size > 6) { size *= 0.92; c.font = `${weight} ${size}px ${family}`; }
  return size;
}

// Torn paper poster art. type: fight|band|missing|rent|bail|lotto|movie|rally
function drawPoster(c, x, y, w, h, type, R) {
  const bgs = { fight: '#e8d9b0', band: '#151515', missing: '#efece4', rent: '#f2e64a', bail: '#1d3fa0', lotto: '#e23a2a', movie: '#0c0c18', rally: '#d7d2c6' };
  c.save();
  c.beginPath();
  c.moveTo(x, y + R() * 6);
  for (let i = 1; i <= 8; i++) c.lineTo(x + (w * i) / 8, y + R() * 7);
  for (let i = 1; i <= 8; i++) c.lineTo(x + w - R() * 6, y + (h * i) / 8);
  for (let i = 7; i >= 0; i--) c.lineTo(x + (w * i) / 8, y + h - R() * 9);
  c.closePath();
  c.clip();
  c.fillStyle = bgs[type] || '#ddd';
  c.fillRect(x, y, w, h);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cx = x + w / 2;
  const T = (txt, yy, px, col, fam, wt) => { c.fillStyle = col; fitFont(c, txt, w * 0.88, px, fam, wt); c.fillText(txt, cx, y + yy * h); };
  if (type === 'fight') {
    T('FIGHT', 0.14, h * 0.16, '#b01818');
    T('NIGHT', 0.29, h * 0.16, '#111');
    c.fillStyle = '#2a2a2a';
    c.beginPath(); c.arc(cx - w * 0.18, y + h * 0.55, w * 0.14, 0, TAU); c.arc(cx + w * 0.18, y + h * 0.55, w * 0.14, 0, TAU); c.fill();
    T('OLYMPIC AUDITORIUM', 0.78, h * 0.06, '#111', 'Arial', '700');
    T('SAT 8PM', 0.88, h * 0.08, '#b01818');
  } else if (type === 'band') {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#ff2a6d'); g.addColorStop(1, '#2a0a3a');
    c.fillStyle = g; c.fillRect(x, y + h * 0.35, w, h * 0.4);
    T('THE', 0.1, h * 0.07, '#fff');
    T('SLASHERS', 0.22, h * 0.15, '#2af5ff');
    T('LIVE AT THE ROXY', 0.84, h * 0.06, '#fff', 'Arial', '700');
  } else if (type === 'missing') {
    T('MISSING', 0.12, h * 0.13, '#111');
    c.fillStyle = '#888'; c.fillRect(cx - w * 0.25, y + h * 0.24, w * 0.5, h * 0.36);
    c.fillStyle = '#555'; c.beginPath(); c.arc(cx, y + h * 0.38, w * 0.12, 0, TAU); c.fill();
    c.fillRect(cx - w * 0.2, y + h * 0.5, w * 0.4, h * 0.1);
    for (let i = 0; i < 5; i++) { c.fillStyle = '#444'; c.fillRect(x + w * 0.12, y + h * (0.67 + i * 0.05), w * (0.5 + R() * 0.26), 3); }
  } else if (type === 'rent') {
    T('ROOM', 0.2, h * 0.18, '#111');
    T('4 RENT', 0.4, h * 0.16, '#111');
    T('CHEAP!', 0.6, h * 0.1, '#c01818');
    for (let i = 0; i < 7; i++) { c.fillStyle = '#333'; c.fillRect(x + (w * i) / 7 + 2, y + h * 0.78, 2, h * 0.22); }
  } else if (type === 'bail') {
    T('BAIL', 0.25, h * 0.2, '#ffd23a');
    T('BONDS', 0.45, h * 0.16, '#fff');
    T('24 HRS', 0.65, h * 0.1, '#ffd23a');
    T('555-0199', 0.82, h * 0.09, '#fff', 'Arial', '700');
  } else if (type === 'lotto') {
    T('LOTTO', 0.3, h * 0.22, '#ffe14a');
    T('$5 MILLION', 0.58, h * 0.1, '#fff');
    T('PLAY HERE', 0.8, h * 0.08, '#fff', 'Arial', '700');
  } else if (type === 'movie') {
    const g = c.createLinearGradient(x, y + h * 0.3, x, y + h * 0.75);
    g.addColorStop(0, '#ff5a1a'); g.addColorStop(1, '#3a0820');
    c.fillStyle = g; c.fillRect(x, y + h * 0.3, w, h * 0.45);
    c.fillStyle = '#000';
    c.beginPath(); c.moveTo(cx - w * 0.3, y + h * 0.75); c.lineTo(cx - w * 0.08, y + h * 0.36); c.lineTo(cx + w * 0.08, y + h * 0.36); c.lineTo(cx + w * 0.3, y + h * 0.75); c.fill();
    T('NIGHT', 0.1, h * 0.12, '#fff');
    T('CRAWLERS', 0.22, h * 0.1, '#ff3a3a');
    T('NOW PLAYING', 0.86, h * 0.06, '#fff', 'Arial', '700');
  } else {
    T('NO NEW', 0.25, h * 0.13, '#1a1a1a');
    T('WORLD!', 0.45, h * 0.14, '#b01818');
    T('TAKE BACK THE STREETS', 0.7, h * 0.05, '#1a1a1a', 'Arial', '700');
  }
  grimeCanvas(c, w, h, R, 0.4);
  c.restore();
}

// ================================================================ tube neon

// Single-stroke neon font on a 4 x 6 grid. 'w=..;' overrides the advance width.
const NEON_FONT = {
  A: '0,0 0,4 2,6 4,4 4,0|0,2.6 4,2.6',
  B: '0,0 0,6 3,6 4,5 4,4 3,3.1 0,3.1|3,3.1 4,2.1 4,1 3,0 0,0',
  C: '4,4.9 3,6 1,6 0,4.9 0,1.1 1,0 3,0 4,1.1',
  D: '0,0 0,6 2.4,6 4,4.4 4,1.6 2.4,0 0,0',
  E: '4,6 0,6 0,0 4,0|0,3.1 3,3.1',
  F: '4,6 0,6 0,0|0,3.1 3,3.1',
  G: '4,4.9 3,6 1,6 0,4.9 0,1.1 1,0 3,0 4,1.1 4,2.8 2.2,2.8',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: 'w=1;0.5,0 0.5,6',
  J: '4,6 4,1.1 3,0 1,0 0,1.1',
  K: '0,0 0,6|4,6 0,2.4|1.3,3.4 4,0',
  L: 'w=3.6;0,6 0,0 3.6,0',
  M: 'w=4.8;0,0 0,6 2.4,2.4 4.8,6 4.8,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 0,1.1 0,4.9 1,6 3,6 4,4.9 4,1.1 3,0 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 0,1.1 0,4.9 1,6 3,6 4,4.9 4,1.1 3,0 1,0|2.6,1.4 4.2,-0.4',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
  S: '4,4.9 3,6 1,6 0,4.9 0,4.1 1,3.1 3,2.9 4,1.9 4,1.1 3,0 1,0 0,1.1',
  T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,1.1 1,0 3,0 4,1.1 4,6',
  V: '0,6 2,0 4,6',
  W: 'w=5;0,6 1.2,0 2.5,4 3.8,0 5,6',
  X: '0,0 4,6|0,6 4,0',
  Y: '0,6 2,3|4,6 2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  0: '1,0 0,1.1 0,4.9 1,6 3,6 4,4.9 4,1.1 3,0 1,0',
  1: 'w=2.4;0,4.6 1.6,6 1.6,0',
  2: '0,4.9 1,6 3,6 4,4.9 4,3.9 0,0 4,0',
  3: '0,4.9 1,6 3,6 4,4.9 4,4 3,3.1 1.6,3.1|3,3.1 4,2.1 4,1.1 3,0 1,0 0,1.1',
  4: '3.2,0 3.2,6 0,1.8 4,1.8',
  5: '4,6 0.3,6 0,3.4 3,3.6 4,2.5 4,1.1 3,0 1,0 0,1.1',
  6: '3.8,5.4 2.8,6 1,6 0,4.9 0,1.1 1,0 3,0 4,1.1 4,2.4 3,3.4 1,3.4 0,2.4',
  7: '0,6 4,6 1.4,0',
  8: '1,3.1 0,4.1 0,5 1,6 3,6 4,5 4,4.1 3,3.1 1,3.1 0,2.1 0,1 1,0 3,0 4,1 4,2.1 3,3.1',
  9: '4,3.6 3,2.6 1,2.6 0,3.6 0,4.9 1,6 3,6 4,4.9 4,1.1 3,0 1,0 0.2,0.6',
  ' ': 'w=2.2;',
  '-': 'w=3;0.3,3 2.7,3',
  '.': 'w=0.8;0.4,0 0.4,0.5',
  '!': 'w=0.8;0.4,6 0.4,1.8|0.4,0.5 0.4,0',
  "'": 'w=0.8;0.4,6 0.4,4.6',
  '&': '4,0 0.6,4.4 0.6,5.3 1.5,6 2.5,6 3.2,5.3 3.2,4.6 0,2.2 0,1 1,0 2.6,0 4,2',
  $: '4,4.9 3,6 1,6 0,4.9 0,4.1 1,3.1 3,2.9 4,1.9 4,1.1 3,0 1,0 0,1.1|2,-0.7 2,6.7',
  '/': 'w=3;0,0 3,6',
  '•': 'w=1.2;0.6,2.7 0.6,3.3',
  '*': '2,1 2,5|0.3,2 3.7,4|0.3,4 3.7,2',
  '#': '1.2,0 1.6,6|2.8,0 3.2,6|0,2 4,2|0,4 4,4',
};
const glyphCache = new Map();
function glyph(ch) {
  let g = glyphCache.get(ch);
  if (g) return g;
  let def = NEON_FONT[ch] ?? NEON_FONT[ch.toUpperCase()];
  let w = 4;
  let strokes = [];
  if (def !== undefined) {
    const m = def.match(/^w=([\d.]+);(.*)$/);
    if (m) { w = parseFloat(m[1]); def = m[2]; }
    if (def) strokes = def.split('|').map((s) => s.trim().split(/\s+/).map((p) => { const [x, y] = p.split(',').map(Number); return v2(x, y); }));
  } else w = 3;
  glyphCache.set(ch, (g = { w, strokes }));
  return g;
}

// Polylines (meters) for a line of text, glyph height h, baseline y = 0, centred on x = 0.
// Each line carries .ci = character index.
function neonTextLines(text, h, track = 1.35) {
  const s = h / 6, lines = [];
  let x = 0, ci = 0;
  for (const ch of text) {
    const g = glyph(ch);
    for (const st of g.strokes) {
      const l = st.map((p) => v2(x + p.x * s, p.y * s));
      l.ci = ci;
      lines.push(l);
    }
    x += (g.w + track) * s;
    ci++;
  }
  const width = Math.max(0, x - track * s);
  for (const l of lines) for (const p of l) p.x -= width / 2;
  return { lines, width };
}

function circlePts(cx, cy, r, n = 16, a0 = 0, a1 = TAU) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push(v2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
  return out;
}
const P = (s) => s.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return v2(x, y); });

// Neon pictograms in a unit box (0..1), scaled by `size`, centred on (cx, cy).
function neonIcon(kind, size, cx = 0, cy = 0) {
  let L = [];
  if (kind === 'slice') {
    L = [P('0.5,0 0.08,0.8 0.92,0.8 0.5,0'), circlePts(0.5, 0.85, 0.46, 12, 0.45, PI - 0.45), circlePts(0.42, 0.55, 0.07, 8), circlePts(0.6, 0.38, 0.06, 8), circlePts(0.48, 0.22, 0.05, 8)];
  } else if (kind === 'burger') {
    L = [[...circlePts(0.5, 0.62, 0.44, 12, 0, PI), v2(0.06, 0.62)], P('0.04,0.48 0.16,0.42 0.28,0.48 0.4,0.42 0.52,0.48 0.64,0.42 0.76,0.48 0.88,0.42 0.96,0.48'), P('0.06,0.34 0.94,0.34'), P('0.08,0.22 0.08,0.06 0.92,0.06 0.92,0.22 0.08,0.22')];
  } else if (kind === 'balls') {
    L = [P('0.1,0.98 0.9,0.98'), P('0.25,0.98 0.25,0.7'), P('0.75,0.98 0.75,0.7'), P('0.5,0.98 0.5,0.36'), circlePts(0.25, 0.56, 0.14, 12), circlePts(0.75, 0.56, 0.14, 12), circlePts(0.5, 0.18, 0.15, 12)];
  } else if (kind === 'joystick') {
    L = [P('0.1,0.05 0.9,0.05 0.9,0.25 0.1,0.25 0.1,0.05'), P('0.5,0.25 0.55,0.62'), circlePts(0.57, 0.76, 0.15, 12), circlePts(0.25, 0.15, 0.05, 6), P('0.08,0.95 0.18,0.72'), P('0.86,0.92 0.96,0.66')];
  } else if (kind === 'cup') {
    L = [P('0.12,0.62 0.18,0.18 0.62,0.18 0.68,0.62 0.12,0.62'), circlePts(0.74, 0.42, 0.12, 10, -HP, HP), P('0.02,0.1 0.8,0.1'), P('0.3,0.7 0.36,0.8 0.3,0.9 0.36,1'), P('0.48,0.7 0.54,0.8 0.48,0.9 0.54,1')];
  } else if (kind === 'martini') {
    L = [P('0.1,0.95 0.9,0.95 0.5,0.45 0.1,0.95'), P('0.5,0.45 0.5,0.08'), P('0.25,0.05 0.75,0.05'), circlePts(0.62, 0.78, 0.07, 8), P('0.62,0.78 0.85,1.05')];
  } else if (kind === 'bottle') {
    L = [P('0.42,1 0.58,1 0.58,0.78 0.72,0.62 0.72,0.05 0.28,0.05 0.28,0.62 0.42,0.78 0.42,1'), P('0.32,0.4 0.68,0.4 0.68,0.22 0.32,0.22 0.32,0.4')];
  } else if (kind === 'cart') {
    L = [P('0,0.95 0.16,0.95 0.3,0.35 0.86,0.35 0.96,0.8 0.2,0.8'), P('0.26,0.55 0.92,0.55'), circlePts(0.36, 0.16, 0.08, 8), circlePts(0.8, 0.16, 0.08, 8)];
  } else if (kind === 'arrow') {
    L = [P('0.05,0.95 0.75,0.95 0.75,0.35'), P('0.55,0.5 0.75,0.25 0.95,0.5')];
  } else if (kind === 'star') {
    const s = [];
    for (let i = 0; i <= 10; i++) { const a = HP + (i * TAU) / 10, r = i % 2 ? 0.2 : 0.48; s.push(v2(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r)); }
    L = [s];
  }
  return L.map((l) => l.map((p) => v2(cx + (p.x - 0.5) * size, cy + (p.y - 0.5) * size)));
}

// Replaces sharp corners with tight quadratic bends like hand-bent glass.
function bendCorners(pts, r) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  const a = v2(), b = v2();
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    a.subVectors(pts[i - 1], p);
    b.subVectors(pts[i + 1], p);
    const la = a.length(), lb = b.length();
    a.normalize(); b.normalize();
    if (a.dot(b) < -0.985 || la < 1e-5 || lb < 1e-5) { out.push(p); continue; }
    const c = Math.min(r, la * 0.45, lb * 0.45);
    const p1 = p.clone().addScaledVector(a, c), p2 = p.clone().addScaledVector(b, c);
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      out.push(v2(u * u * p1.x + 2 * u * t * p.x + t * t * p2.x, u * u * p1.y + 2 * u * t * p.y + t * t * p2.y));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Swept circular tube along a 2D polyline lying in the plane z.
function tubeGeo(pts, z, r, seg = 6) {
  const n = pts.length, pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * TAU, c = Math.cos(th), s = Math.sin(th);
      const ox = -ty * c, oy = tx * c, oz = s;
      pos.push(pts[i].x + ox * r, pts[i].y + oy * r, z + oz * r);
      nor.push(ox, oy, oz);
      uv.push(i / (n - 1), k / seg);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * (seg + 1) + k, b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Bright warm colours bloom much harder than pink/blue, so tube intensity follows luminance.
function neonLevel(color) {
  const c = new THREE.Color(color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return 4.2 * THREE.MathUtils.clamp(0.22 / Math.max(lum, 0.01), 0.55, 1);
}
function neonTubeMat(color, unique = false) {
  const make = () => new THREE.MeshStandardMaterial({ color: '#202020', emissive: color, emissiveIntensity: neonLevel(color), roughness: 0.25 });
  return unique ? make() : cmat(`neontube${color}`, make);
}

/**
 * Real 3D tube-neon sign: hand-bent glass tubes (single-stroke font) on stand-offs over a
 * dark backing board, with an additive glow halo spilling onto the board/wall.
 * Origin: bottom centre of the board's back face — mount flush on a wall (board is 5 cm thick).
 * @param {object} opts
 * @param {string} [opts.text='OPEN'] main text (A–Z, 0–9, & $ - . ! ' / • * #)
 * @param {string} [opts.color='#ff2a6d'] tube colour
 * @param {number} [opts.height=0.5] cap height of the main text (m)
 * @param {string} [opts.sub] smaller second line below; [opts.subColor]
 * @param {string} [opts.icon] slice|burger|balls|joystick|cup|martini|bottle|cart|arrow|star (left of text)
 * @param {string} [opts.iconColor]
 * @param {boolean} [opts.vertical=false] stack letters vertically (hotel blade sign)
 * @param {boolean} [opts.border=false] neon border tube around everything
 * @param {boolean} [opts.board=true] dark backing board
 * @param {boolean} [opts.flicker=false] failing-transformer flicker (update)
 * @param {number[]} [opts.broken] character indices of the main text whose tubes are dead
 * userData: lights[1] (animated via ref when flickering), update (flicker), size {w,h}.
 */
export function makeNeonSign(opts = {}) {
  const text = opts.text ?? 'OPEN', color = opts.color ?? '#ff2a6d', h = opts.height ?? 0.5;
  const sub = opts.sub ?? '', subColor = opts.subColor ?? color, iconColor = opts.iconColor ?? color;
  const broken = new Set(opts.broken || []);
  const r = opts.tube ?? Math.max(0.011, h * 0.038);
  const strokes = []; // { pts, color, dead }
  if (opts.vertical) {
    const chars = [...text];
    chars.forEach((ch, i) => {
      const { lines } = neonTextLines(ch, h);
      for (const l of lines) strokes.push({ pts: l.map((p) => v2(p.x, p.y + (chars.length - 1 - i) * h * 1.3)), color, dead: broken.has(i) });
    });
  } else {
    const main = neonTextLines(text, h);
    const subL = sub ? neonTextLines(sub, h * 0.5, 1.6) : null;
    const baseY = subL ? h * 0.5 + h * 0.34 : 0;
    const iconSize = opts.icon ? h * (subL ? 1.75 : 1.45) : 0;
    const textW = Math.max(main.width, subL ? subL.width : 0);
    const shift = iconSize ? (iconSize + h * 0.35) / 2 : 0;
    for (const l of main.lines) strokes.push({ pts: l.map((p) => v2(p.x + shift, p.y + baseY)), color, dead: broken.has(l.ci) });
    if (subL) for (const l of subL.lines) strokes.push({ pts: l.map((p) => v2(p.x + shift, p.y)), color: subColor, dead: false });
    if (opts.icon) {
      const top = baseY + h;
      for (const l of neonIcon(opts.icon, iconSize, shift - textW / 2 - h * 0.35 - iconSize / 2, top / 2)) strokes.push({ pts: l, color: iconColor, dead: false });
    }
  }
  // bounds -> board, re-centre so the board's bottom centre is the origin
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const pad = h * 0.32 + r * 2;
  const bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2;
  const cxo = (x0 + x1) / 2, cyo = y0 - pad;
  for (const s of strokes) s.pts = bendCorners(s.pts.map((p) => v2(p.x - cxo, p.y - cyo)), h * 0.07);
  if (opts.border) {
    const m = r * 3, rr = Math.min(bw, bh) * 0.12;
    const bx0 = -bw / 2 + m, bx1 = bw / 2 - m, by0 = m, by1 = bh - m;
    const rect = [v2(bx0 + rr, by0), v2(bx1, by0), v2(bx1, by1), v2(bx0, by1), v2(bx0, by0), v2(bx0 + rr * 1.2, by0)];
    strokes.push({ pts: bendCorners(rect, rr), color: opts.borderColor ?? color, dead: false });
  }
  const g = new THREE.Group(), k = new Kit();
  const boardD = opts.board === false ? 0 : 0.05, tz = boardD + 0.045 + r;
  if (opts.board !== false) {
    k.box(solid('#121216', 0.55, 0.45), bw, bh, boardD, 0, bh / 2, boardD / 2);
    const trim = solid('#3b3e44', 0.35, 0.85);
    k.box(trim, bw + 0.03, 0.025, boardD + 0.01, 0, bh, boardD / 2);
    k.box(trim, bw + 0.03, 0.025, boardD + 0.01, 0, 0, boardD / 2);
    k.box(trim, 0.025, bh, boardD + 0.01, -bw / 2, bh / 2, boardD / 2);
    k.box(trim, 0.025, bh, boardD + 0.01, bw / 2, bh / 2, boardD / 2);
  }
  // tubes grouped per colour; electrodes + stand-offs
  const flicker = !!opts.flicker;
  const tubeMats = new Map();
  const dead = cmat('neondead', () => new THREE.MeshStandardMaterial({ color: '#4a4c55', roughness: 0.15, metalness: 0.1 }));
  const dark = solid('#0c0c0e', 0.5, 0.3);
  const clear = solid('#8d9399', 0.3, 0.6);
  const seg = r > 0.02 ? 8 : 6;
  for (const s of strokes) {
    const m = s.dead ? dead : (tubeMats.get(s.color) || tubeMats.set(s.color, neonTubeMat(s.color, flicker)).get(s.color));
    k.add(m, tubeGeo(s.pts, tz, r, seg), 0, false);
    for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) k.cyl(dark, r * 1.25, r * 1.25, tz - boardD, p.x, p.y, (tz + boardD) / 2, { rx: HP, seg: 6, shadow: false });
    const mid = s.pts[Math.floor(s.pts.length / 2)];
    k.cyl(clear, r * 0.45, r * 0.45, tz - boardD, mid.x, mid.y, (tz + boardD) / 2, { rx: HP, seg: 5, shadow: false });
  }
  // glow halo
  const margin = h * 0.9;
  const HW = bw + margin * 2, HH = bh + margin * 2;
  const cw = 512, chh = Math.max(64, Math.min(512, Math.round((512 * HH) / HW)));
  const sx = cw / HW, sy = chh / HH;
  const lit = strokes.filter((s) => !s.dead);
  const haloKey = `halo|${text}|${sub}|${opts.icon}|${opts.vertical}|${opts.border}|${color}|${subColor}|${iconColor}|${h}|${[...broken]}`;
  const haloTex = TX.painted(haloKey, cw, chh, (c) => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalCompositeOperation = 'lighter';
    const path = (s) => {
      c.beginPath();
      s.pts.forEach((p, i) => { const X = (p.x + HW / 2) * sx, Y = chh - (p.y + margin) * sy; if (i) c.lineTo(X, Y); else c.moveTo(X, Y); });
    };
    for (const [lw, a, blur] of [[r * 2 * sx * 8, 0.12, 36], [r * 2 * sx * 3.5, 0.22, 16], [r * 2 * sx * 1.5, 0.32, 4]]) {
      for (const s of lit) {
        c.strokeStyle = s.color;
        c.shadowColor = s.color;
        c.shadowBlur = blur;
        c.globalAlpha = a;
        c.lineWidth = Math.max(1, lw);
        path(s);
        c.stroke();
      }
    }
  });
  const haloMat = flicker ? null : cmat(`halomat${haloKey}`, () => new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
  const hm = haloMat || new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 });
  hm.opacity = 0.75 * Math.sqrt(neonLevel(color) / 4.2);
  const haloBase = hm.opacity;
  k.add(hm, xf(new THREE.PlaneGeometry(HW, HH), 0, bh / 2, boardD + 0.004), 0, false);
  finalize(g, k);
  const lf = neonLevel(color) / 4.2;
  const light = { pos: v3(0, bh / 2, 1.6), color, intensity: Math.min(26, 6 + bw * 3.5) * lf * (opts.lightScale ?? 1), distance: 5.5 + Math.min(5, bw * 0.8), ref: {} };
  g.userData.lights = [light];
  g.userData.size = { w: bw, h: bh };
  if (flicker) {
    const ph = (opts.seed ?? text.length) * 1.37;
    const mats = [...tubeMats.values()];
    for (const m of mats) m.userData.base = m.emissiveIntensity;
    g.userData.update = (dt, t) => {
      const n = Math.sin(t * 9.7 + ph) * Math.sin(t * 3.1 + ph * 2) + Math.sin(t * 31 + ph) * 0.3;
      const f = n > 0.78 ? 0.06 : n > 0.7 ? 0.45 : 1;
      for (const m of mats) m.emissiveIntensity = m.userData.base * f;
      hm.opacity = haloBase * f;
      if (light.ref.src) light.ref.src.intensity = light.intensity * f;
    };
  }
  return g;
}

// ================================================================ street lamp

/**
 * LA "cobra-head" street light: tapered galvanised pole on a bolted base, curved mast arm,
 * cobra-head luminaire with a glowing sodium drop lens, photocell, faint volumetric cone,
 * parking sign and stapled flyers. ~7.7 m tall; the arm reaches +x (opts.dir = -1 for -x).
 * @param {object} opts
 * @param {boolean} [opts.flicker=false] dying lamp: lens, cone and light flicker (update)
 * @param {number} [opts.height=7.4] pole height; [opts.arm=2.3] arm reach; [opts.dir=1]
 * @param {boolean} [opts.cone=true] volumetric light cone; [opts.sign=true] parking sign
 * userData: lights[1] sodium (~120, distance 18), update when flickering. No colliders.
 */
export function makeStreetLamp(opts = {}) {
  const H = opts.height ?? 7.4, arm = opts.arm ?? 2.3, dir = opts.dir ?? 1, flicker = !!opts.flicker;
  const g = new THREE.Group(), k = new Kit();
  const steel = mat('galvanized'), conc = mat('concrete'), dark = solid('#1c1e21', 0.5, 0.7);
  // footing, base cover, flange, anchor bolts
  k.cyl(conc, 0.34, 0.38, 0.14, 0, 0.07, 0, { seg: 18, uv: 1 });
  k.cyl(steel, 0.235, 0.235, 0.05, 0, 0.165, 0, { seg: 16 });
  k.cyl(steel, 0.15, 0.21, 0.46, 0, 0.42, 0, { seg: 16, uv: 1 });
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + i * HP;
    k.cyl(dark, 0.022, 0.022, 0.06, Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2, { seg: 6 });
  }
  // pole + hand hole
  k.cyl(steel, 0.065, 0.12, H - 0.62, 0, 0.62 + (H - 0.62) / 2, 0, { seg: 14, uv: 1.5 });
  k.box(steel, 0.1, 0.24, 0.03, 0, 1.05, 0.112);
  k.cyl(dark, 0.012, 0.012, 0.02, 0, 1.13, 0.13, { rx: HP, seg: 6 });
  k.box(solid('#c9c2a8', 0.6), 0.07, 0.1, 0.006, 0, 2.05, 0.104); // pole id tag
  // mast arm
  const curve = new THREE.CubicBezierCurve3(v3(0, H - 0.75, 0), v3(0, H - 0.05, 0), v3(0.4 * dir, H + 0.24, 0), v3(arm * dir, H + 0.27, 0));
  k.add(steel, new THREE.TubeGeometry(curve, 24, 0.048, 8, false), 1.5);
  k.cyl(steel, 0.075, 0.075, 0.18, 0, H - 0.72, 0, { seg: 12 }); // arm clamp
  // cobra head
  const cx = (arm + 0.36) * dir, cy = H + 0.24;
  const head = solid('#7b8186', 0.38, 0.75);
  k.add(head, xf(new THREE.SphereGeometry(1, 28, 8, 0, TAU, 0, HP), cx, cy, 0, 0, 0, -0.05 * dir, 0.52, 0.17, 0.23));
  k.add(head, xf(new THREE.CylinderGeometry(1, 1, 0.05, 28), cx, cy - 0.02, 0, 0, 0, -0.05 * dir, 0.53, 1, 0.235));
  k.cyl(head, 0.055, 0.05, 0.16, (arm + 0.02) * dir, H + 0.27, 0, { rz: HP, seg: 10 }); // slip fitter
  k.cyl(dark, 0.035, 0.035, 0.06, cx - 0.18 * dir, cy + 0.19, 0, { seg: 10 });
  k.add(solid('#d9d4c4', 0.3), xf(new THREE.SphereGeometry(0.036, 10, 5, 0, TAU, 0, HP), cx - 0.18 * dir, cy + 0.22, 0));
  const lensMat = flicker
    ? new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ff9440', emissiveIntensity: 2.2, roughness: 0.3 })
    : cmat('lampLens', () => new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ff9440', emissiveIntensity: 2.2, roughness: 0.3 }));
  k.add(lensMat, xf(new THREE.SphereGeometry(1, 24, 6, 0, TAU, HP, HP), cx + 0.03 * dir, cy - 0.04, 0, 0, 0, -0.05 * dir, 0.43, 0.12, 0.19), 0, false);
  // parking sign + flyers
  if (opts.sign !== false) {
    const sign = paintMat('noParking', 128, 192, (c, w, h) => {
      c.fillStyle = '#ece8dc'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#b3141b'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#b3141b'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.beginPath(); c.arc(w / 2, 52, 30, 0, TAU); c.lineWidth = 7; c.stroke();
      c.font = '900 34px Arial'; c.fillText('P', w / 2, 54);
      c.beginPath(); c.moveTo(w / 2 - 21, 31); c.lineTo(w / 2 + 21, 73); c.stroke();
      c.font = '700 20px Arial'; c.fillText('2 AM - 6 AM', w / 2, 112);
      c.font = '700 15px Arial'; c.fillText('STREET', w / 2, 140); c.fillText('CLEANING', w / 2, 160);
      grimeCanvas(c, w, h, TX.rng(4), 0.35);
    }, { roughness: 0.45, metalness: 0.3 });
    k.add(sign, xf(new THREE.PlaneGeometry(0.3, 0.45), 0, 2.75, 0.115));
    k.box(dark, 0.3, 0.45, 0.01, 0, 2.75, 0.105);
    for (const yy of [2.6, 2.9]) k.cyl(dark, 0.108, 0.108, 0.025, 0, yy, 0, { seg: 14 });
    const flyer = paintMat('lampFlyers', 256, 160, (c, w, h) => {
      const R = TX.rng(77);
      drawPoster(c, 4, 4, 120, 152, 'missing', R);
      drawPoster(c, 132, 4, 120, 152, 'rent', R);
    }, { side: THREE.DoubleSide, roughness: 0.8 });
    k.add(flyer, uvRect(xf(new THREE.PlaneGeometry(0.17, 0.22), 0.01, 1.62, 0.122, 0, 0.12, 0.03), 0, 0, 0.5, 1));
    k.add(flyer, uvRect(xf(new THREE.PlaneGeometry(0.15, 0.2), -0.02, 1.36, 0.124, 0, -0.1, -0.06), 0.5, 0, 1, 1));
  }
  // volumetric cone
  let coneMat = null;
  if (opts.cone !== false) {
    coneMat = beamMat('#ff9a48', 0.085, flicker);
    const ch = cy - 0.12;
    k.add(coneMat, xf(new THREE.CylinderGeometry(0.2, 2.6, ch, 32, 1, true), cx, ch / 2, 0.15), 0, false);
  }
  finalize(g, k);
  const light = { pos: v3(cx, cy - 0.45, 0.25), color: '#ff9a48', intensity: 120, distance: 18, ref: {} };
  g.userData.lights = [light];
  // The wet-street planar reflection renders from a mirrored camera below the ground; there the
  // lens is dimmed and the cone hidden, otherwise they mirror into hot white ovals on the road.
  let f = 1;
  for (const m of g.children) {
    if (m.material === lensMat) m.onBeforeRender = (r, s, cam) => { lensMat.emissiveIntensity = 2.2 * f * (cam.position.y < 0 ? 0.18 : 1); };
    if (coneMat && m.material === coneMat) m.onBeforeRender = (r, s, cam) => { coneMat.uniforms.opacity.value = cam.position.y < 0 ? 0 : 0.085 * f; };
  }
  if (flicker) {
    g.userData.update = (dt, t) => {
      const n = Math.sin(t * 13.3) * Math.sin(t * 4.7 + 1.3) + Math.sin(t * 37.1) * 0.35;
      const dying = Math.sin(t * 0.7) > 0.55;
      f = n > (dying ? 0.2 : 0.62) ? 0.05 : n > 0.5 ? 0.55 : 1;
      if (light.ref.src) light.ref.src.intensity = light.intensity * f;
    };
  }
  return g;
}

// ================================================================ fire escape

// Splits rectangle [x0,x1,z0,z1] minus axis-aligned holes into rectangles.
function rectsMinusHoles(outer, holes) {
  const X = new Set([outer[0], outer[1]]);
  for (const h of holes) { X.add(THREE.MathUtils.clamp(h[0], outer[0], outer[1])); X.add(THREE.MathUtils.clamp(h[1], outer[0], outer[1])); }
  const xs = [...X].sort((a, b) => a - b), out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-4) continue;
    const xm = (a + b) / 2;
    const zs = holes.filter((h) => h[0] < xm && h[1] > xm).map((h) => [h[2], h[3]]).sort((p, q) => p[0] - q[0]);
    let z = outer[2];
    for (const [z0, z1] of zs) { if (z0 > z + 1e-4) out.push([a, b, z, z0]); z = Math.max(z, z1); }
    if (z < outer[3] - 1e-4) out.push([a, b, z, outer[3]]);
  }
  return out;
}

// Steel ladder: flat rails + round rungs, rails extend `ext` above y1 (gooseneck hand-hold).
function ladderParts(k, material, x, z, y0, y1, ext = 0.9, w = 0.44) {
  for (const s of [-1, 1]) k.box(material, 0.05, y1 - y0 + ext, 0.014, x + (s * w) / 2, (y0 + y1 + ext) / 2, z);
  for (let y = y0 + 0.28; y < y1 - 0.05; y += 0.3) k.cyl(material, 0.011, 0.011, w, x, y, z, { rz: HP, seg: 6 });
}

/**
 * Black iron fire escape mounted on a facade (wall at z = -1.2, landings reach z = +0.9):
 * grated landings with picket railings, knee braces and wall anchors, zig-zag stairs along
 * the wall between landings (visual), hatch openings, a vertical ladder at the +x end
 * between every level (alternating two columns) incl. the drop ladder from the street.
 * @param {object} opts
 * @param {number} [opts.floors=3] number of landings; [opts.width=6]; [opts.floorHeight=3.2]
 * colliders: one ledge per landing { x0:-w/2, x1:w/2, y: floorHeight*i } (i = 1..floors).
 * ladders: { x: w/2-0.55 | w/2-1.3 (alternating), y0: fh*i, y1: fh*(i+1) } for i = 0..floors-1.
 * Ladder visuals sit at z = -0.3 (just behind the player plane).
 */
export function makeFireEscape(opts = {}) {
  const floors = opts.floors ?? 3, W = opts.width ?? 6, fh = opts.floorHeight ?? 3.2;
  const zW = -1.2, zF = 0.9, zL = -0.3;
  const g = new THREE.Group(), k = new Kit();
  const iron = mat('ironBlack'), grate = grating('#26282c');
  const ladX = (i) => (i % 2 === 0 ? W / 2 - 0.55 : W / 2 - 1.3);
  const run = Math.min(W - 1.4, fh / Math.tan(0.9));
  const scx = -0.45; // stair centre x
  const zs0 = -1.13, zs1 = -0.6; // stair strip
  const colliders = [], ladders = [];
  const IB = (w, h, d, x, y, z, o) => k.box(iron, w, h, d, x, y, z, { uv: 1, ...o });
  for (let i = 1; i <= floors; i++) {
    const y = fh * i;
    const holes = [];
    const lx = ladX(i - 1);
    holes.push([lx - 0.33, lx + 0.33, zL - 0.27, zL + 0.27]);
    const f = i - 1; // flight arriving from landing f
    if (f >= 1) {
      const d = f % 2 ? 1 : -1, xt = scx + (d * run) / 2;
      const hl = run * 0.62;
      holes.push(d > 0 ? [xt - hl, xt, zs0 - 0.05, zs1] : [xt, xt + hl, zs0 - 0.05, zs1]);
    }
    for (const [a, b, c, e] of rectsMinusHoles([-W / 2, W / 2, zW, zF], holes)) {
      k.add(grate, xf(new THREE.PlaneGeometry(b - a, e - c), (a + b) / 2, y, (c + e) / 2, -HP), 0.7);
    }
    // landing frame + joists
    IB(W + 0.04, 0.11, 0.05, 0, y - 0.055, zF - 0.025);
    IB(W, 0.08, 0.05, 0, y - 0.04, zW + 0.03);
    for (const s of [-1, 1]) IB(0.05, 0.11, zF - zW, (s * W) / 2, y - 0.055, (zF + zW) / 2);
    for (let x = -W / 2 + 0.75; x < W / 2 - 0.3; x += 0.75) IB(0.035, 0.06, zF - zW - 0.05, x, y - 0.035, (zF + zW) / 2);
    for (const h of holes) {
      IB(h[1] - h[0], 0.05, 0.03, (h[0] + h[1]) / 2, y - 0.025, h[2]);
      IB(h[1] - h[0], 0.05, 0.03, (h[0] + h[1]) / 2, y - 0.025, h[3]);
    }
    // hatch lid flipped open behind the ladder hole
    k.add(grate, xf(new THREE.PlaneGeometry(0.62, 0.5), lx, y + 0.27, zL - 0.31, 0, 0, 0), 0.7);
    IB(0.64, 0.025, 0.025, lx, y + 0.52, zL - 0.31);
    // knee braces + wall plates + bolts
    const nb = Math.max(2, Math.round(W / 1.6));
    for (let b = 0; b < nb; b++) {
      const x = -W / 2 + 0.3 + (b * (W - 0.6)) / (nb - 1);
      k.bar(iron, v3(x, y - 1.15, zW + 0.03), v3(x, y - 0.1, zF - 0.12), 0.05, 0.016);
      IB(0.16, 0.34, 0.02, x, y - 1.12, zW + 0.01);
      IB(0.16, 0.2, 0.02, x, y - 0.12, zW + 0.01);
      for (const dy of [-1.24, -1.0, -0.06]) k.cyl(iron, 0.018, 0.018, 0.03, x, y + dy, zW + 0.03, { rx: HP, seg: 6 });
    }
    // railings: posts, top/bottom rails, pickets
    const rTop = y + 0.98;
    for (const x of [-W / 2, W / 2]) {
      IB(0.045, 1.0, 0.045, x, y + 0.5, zF);
      IB(0.045, 1.0, 0.045, x, y + 0.5, zW + 0.06);
      IB(0.05, 0.035, zF - zW, x, rTop, (zF + zW) / 2);
      IB(0.035, 0.03, zF - zW, x, y + 0.12, (zF + zW) / 2);
      for (let z = zW + 0.16; z < zF - 0.05; z += 0.115) IB(0.014, 0.86, 0.014, x, y + 0.55, z);
    }
    const np = Math.round(W / 1.5);
    for (let p = 1; p < np; p++) IB(0.04, 1.0, 0.04, -W / 2 + (p * W) / np, y + 0.5, zF);
    IB(W + 0.05, 0.035, 0.055, 0, rTop, zF);
    IB(W, 0.03, 0.035, 0, y + 0.12, zF);
    for (let x = -W / 2 + 0.06; x < W / 2 - 0.03; x += 0.115) IB(0.014, 0.86, 0.014, x, y + 0.55, zF);
    // scroll brackets at the front corners
    for (const s of [-1, 1]) k.add(iron, xf(new THREE.TorusGeometry(0.09, 0.008, 4, 10, PI * 1.5), s * (W / 2 - 0.12), y + 0.2, zF, 0, 0, s > 0 ? 0 : HP), 1);
    // rust streaks on the wall under the landing
    k.add(streakMat('rust'), xf(new THREE.PlaneGeometry(W, 1.8), 0, y - 1.0, zW + 0.004), 0, false);
    colliders.push({ type: 'ledge', x0: -W / 2, x1: W / 2, y });
  }
  // zig-zag stairs between landings
  for (let f = 1; f < floors; f++) {
    const d = f % 2 ? 1 : -1, y0 = fh * f, y1 = fh * (f + 1);
    const xb = scx - (d * run) / 2, xt = scx + (d * run) / 2;
    const n = Math.round(fh / 0.22);
    for (const z of [zs0, zs1]) k.bar(iron, v3(xb, y0 + 0.04, z), v3(xt, y1 + 0.04, z), 0.016, 0.2);
    for (let j = 1; j < n; j++) {
      const t = j / n;
      k.add(grate, xf(new THREE.BoxGeometry(run / n + 0.04, 0.025, zs1 - zs0 - 0.03), xb + (xt - xb) * t, y0 + (y1 - y0) * t, (zs0 + zs1) / 2), 0.7);
    }
    k.bar(iron, v3(xb, y0 + 0.92, zs1 + 0.02), v3(xt, y1 + 0.92, zs1 + 0.02), 0.022, 0.022, { round: true });
    k.bar(iron, v3(xb, y0, zs1 + 0.02), v3(xb, y0 + 0.92, zs1 + 0.02), 0.03, 0.03);
    k.bar(iron, v3((xb + xt) / 2, (y0 + y1) / 2, zs1 + 0.02), v3((xb + xt) / 2, (y0 + y1) / 2 + 0.92, zs1 + 0.02), 0.025, 0.025);
  }
  // ladders (incl. drop ladder from the street) + guide brackets
  for (let i = 0; i < floors; i++) {
    const x = ladX(i), y0 = fh * i, y1 = fh * (i + 1);
    const yb = i === 0 ? 0.32 : y0;
    ladderParts(k, iron, x, zL, yb, y1, 0.95);
    if (i === 0) {
      for (const s of [-1, 1]) {
        IB(0.04, 0.04, 0.32, x + s * 0.3, y1 - 0.5, zL - 0.14);
        k.bar(iron, v3(x + s * 0.3, y1 - 0.5, zL - 0.3), v3(x + s * 0.3, y1 - 0.06, zW + 0.6), 0.03, 0.03);
      }
      IB(0.5, 0.12, 0.12, x, yb + 0.05, zL); // weighted bottom rung
    }
    ladders.push({ x, y0, y1, z: zL, w: 0.44 });
  }
  finalize(g, k);
  g.userData.colliders = colliders;
  g.userData.ladders = ladders;
  return g;
}

// ================================================================ awning

function awningStripeMat(color, stripes) {
  return paintMat(`awning${color}${stripes}`, 256, 256, (c, w, h) => {
    const R = TX.rng(color.length * 13 + (stripes ? 1 : 0));
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
    if (stripes) { c.fillStyle = '#d9d1bc'; c.fillRect(w / 2, 0, w / 2, h); }
    for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(255,255,255,${0.03 + R() * 0.04})`; c.fillRect(0, R() * h, w, 1 + R() * 3); }
    grimeCanvas(c, w, h, R, 0.8);
  }, { side: THREE.DoubleSide, roughness: 0.5, repeat: true });
}

/**
 * Canvas shop awning (sloped, wet) on a tubular steel frame, with a scalloped valance and
 * side cheeks. Mounted on a facade at z = -1.2; the canvas passes height `y` at z = 0
 * (the gameplay plane) and reaches z = +0.55.
 * @param {object} opts
 * @param {number} [opts.width=5] @param {number} [opts.y=3.2] @param {string} [opts.color='#a0202a']
 * @param {boolean} [opts.stripes=true] @param {string} [opts.text] lettering on the valance
 * colliders: ledge { x0:-w/2, x1:w/2, y }. emitters: rain drips along the front edge.
 */
export function makeAwning(opts = {}) {
  const W = opts.width ?? 5, Y = opts.y ?? 3.2, color = opts.color ?? '#a0202a', stripes = opts.stripes ?? true;
  const zW = -1.2, zf = 0.55, yt = Y + 0.55, yf = Y - 0.25, vh = 0.32;
  const g = new THREE.Group(), k = new Kit();
  const cm = awningStripeMat(color, stripes);
  const sw = 0.62; // stripe pair width (m)
  const dz = zf - zW, dy = yf - yt, len = Math.hypot(dz, dy);
  const nY = dz / len, nZ = -dy / len;
  const top = new THREE.PlaneGeometry(W, len, Math.max(1, Math.round(W)), 1);
  xf(top, 0, (yt + yf) / 2, (zW + zf) / 2, Math.atan2(-nY, nZ));
  const tp = top.attributes.position, tu = top.attributes.uv;
  for (let i = 0; i < tu.count; i++) tu.setXY(i, (tp.getX(i) + W / 2) / sw, (tp.getY(i) - yf) / (yt - yf));
  k.add(cm, top);
  // scalloped valance
  const n = Math.max(2, Math.round(W / 0.34)), d = 0.07;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, -vh + d);
  for (let i = n - 1; i >= 0; i--) {
    const xa = -W / 2 + (W * (i + 1)) / n, xb = -W / 2 + (W * i) / n;
    sh.quadraticCurveTo((xa + xb) / 2, -vh - d * 0.9, xb, -vh + d);
  }
  sh.closePath();
  const val = new THREE.ShapeGeometry(sh, 6);
  const vp = val.attributes.position, vu = val.attributes.uv;
  for (let i = 0; i < vu.count; i++) vu.setXY(i, (vp.getX(i) + W / 2) / sw, (vp.getY(i) + vh) / vh);
  xf(val, 0, yf, zf);
  let vm = cm;
  if (opts.text) {
    vm = paintMat(`valance${color}${stripes}${opts.text}${W}`, 1024, 80, (c, w, h) => {
      const R = TX.rng(9);
      const per = w / (W / sw);
      for (let x = 0; x < w; x += per) { c.fillStyle = color; c.fillRect(x, 0, per / 2, h); c.fillStyle = stripes ? '#d9d1bc' : color; c.fillRect(x + per / 2, 0, per / 2, h); }
      c.fillStyle = color;
      fitFont(c, opts.text, w * 0.7, h * 0.55, 'Georgia, serif', '700');
      const tw = c.measureText(opts.text).width;
      c.fillRect(w / 2 - tw / 2 - 30, h * 0.12, tw + 60, h * 0.62);
      c.fillStyle = '#efe6cf'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(opts.text, w / 2, h * 0.44);
      grimeCanvas(c, w, h, R, 0.5);
    }, { side: THREE.DoubleSide, roughness: 0.5 });
    for (let i = 0; i < vu.count; i++) vu.setXY(i, (vp.getX(i) + W / 2) / W, (vp.getY(i) - yf + vh) / vh);
  }
  k.add(vm, val);
  // side cheeks
  for (const s of [-1, 1]) {
    const tri = triGeo(v3((s * W) / 2, yt, zW), v3((s * W) / 2, yf, zf), v3((s * W) / 2, yf - vh * 0.8, zf));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 0, 1, 0], 2));
    k.add(cm, tri);
  }
  // frame
  const fr = solid('#2a2c30', 0.45, 0.8);
  k.bar(fr, v3(-W / 2, yf - 0.025, zf - 0.03), v3(W / 2, yf - 0.025, zf - 0.03), 0.02, 0.02, { round: true });
  k.bar(fr, v3(-W / 2, yt + 0.02, zW + 0.04), v3(W / 2, yt + 0.02, zW + 0.04), 0.022, 0.022, { round: true });
  const na = Math.max(2, Math.round(W / 1.6) + 1);
  for (let i = 0; i < na; i++) {
    const x = -W / 2 + 0.03 + ((W - 0.06) * i) / (na - 1);
    k.bar(fr, v3(x, yt - 0.04, zW + 0.04), v3(x, yf - 0.04, zf - 0.04), 0.016, 0.016, { round: true });
    k.box(fr, 0.08, 0.14, 0.03, x, yt, zW + 0.015);
    if (i === 0 || i === na - 1) {
      k.bar(fr, v3(x, yf - 0.62, zW + 0.03), v3(x, yf - 0.04, zf - 0.06), 0.014, 0.014, { round: true });
      k.box(fr, 0.08, 0.12, 0.03, x, yf - 0.62, zW + 0.015);
    }
  }
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2, x1: W / 2, y: Y }];
  g.userData.emitters = [];
  for (let x = -W / 2 + 0.6; x < W / 2; x += 1.7) g.userData.emitters.push({ type: 'drip', pos: v3(x, yf - vh, zf), rate: 1.2 });
  return g;
}

// ================================================================ shared decals

// Spray-paint tag (one atlas cell).
function drawTag(c, x, y, w, h, word, R) {
  const cols = ['#ff2a6d', '#2af5ff', '#f5e642', '#e8e8e8', '#3dff8a', '#ff8a1a', '#b05aff', '#d8d8d8'];
  const col = cols[Math.floor(R() * cols.length)], out = R() < 0.6 ? '#0d0d0d' : '#f2f2f2';
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate((R() - 0.5) * 0.3);
  c.transform(1, 0, -0.22, 1, 0, 0);
  const px = fitFont(c, word, w * 0.82, h * 0.42, '"Segoe Script", "Brush Script MT", "Comic Sans MS", cursive', '700');
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.fillStyle = col;
  c.globalAlpha = 0.18;
  for (let i = 0; i < 160; i++) c.fillRect((R() - 0.5) * w * 0.8, (R() - 0.5) * px * 1.3, 1.6, 1.6);
  c.globalAlpha = 1;
  c.lineWidth = px * 0.18;
  c.strokeStyle = out;
  c.strokeText(word, 0, 0);
  c.fillText(word, 0, 0);
  for (let i = 0; i < 6; i++) {
    const dx = (R() - 0.5) * w * 0.6, len = px * (0.25 + R() * 0.7);
    c.fillRect(dx, px * 0.2, 2.5, len);
    c.beginPath(); c.arc(dx + 1.25, px * 0.2 + len, 2.4, 0, TAU); c.fill();
  }
  if (R() < 0.5) { c.fillStyle = out; c.font = `700 ${px * 0.3}px Arial`; c.fillText(['187', 'LA', '86', 'SQ', '13'][Math.floor(R() * 5)], w * 0.32, -px * 0.55); }
  c.restore();
}

const TAG_WORDS = ['KAOS', 'NWO', 'SL4SH', 'RAZR', 'NITE', 'VEX', 'X13', 'ZERO'];
function tagAtlasMat() {
  return paintMat('tagAtlas', 1024, 512, (c) => {
    const R = TX.rng(1986);
    TAG_WORDS.forEach((wd, i) => drawTag(c, (i % 4) * 256, Math.floor(i / 4) * 256, 256, 256, wd, R));
  }, { ...DECAL, roughness: 0.55 });
}
function tagDecal(k, i, w, h, x, y, z, rz = 0) {
  i = ((i % 8) + 8) % 8;
  const r = Math.floor(i / 4), cI = i % 4;
  k.add(tagAtlasMat(), uvRect(xf(new THREE.PlaneGeometry(w, h), x, y, z, 0, 0, rz), cI / 4, 1 - (r + 1) / 2, (cI + 1) / 4, 1 - r / 2), 0, false);
}

const POSTER_TYPES = ['fight', 'band', 'bail', 'movie', 'missing', 'rent', 'lotto', 'rally'];
function posterAtlasMat() {
  return paintMat('posterAtlas', 512, 384, (c) => {
    const R = TX.rng(4242);
    POSTER_TYPES.forEach((t, i) => drawPoster(c, (i % 4) * 128 + 3, Math.floor(i / 4) * 192 + 3, 122, 186, t, R));
  }, { transparent: true, alphaTest: 0.5, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
function posterDecal(k, i, w, x, y, z, rz = 0) {
  i = ((i % 8) + 8) % 8;
  const r = Math.floor(i / 4), cI = i % 4;
  k.add(posterAtlasMat(), uvRect(xf(new THREE.PlaneGeometry(w, w * 1.5), x, y, z, 0, 0, rz), cI / 4, 1 - (r + 1) / 2, (cI + 1) / 4, 1 - r / 2), 0, false);
}

// Rain beads and rivulets running down glass.
function rainGlassMat() {
  return paintMat('rainGlass', 256, 256, (c, w, h) => {
    const R = TX.rng(55);
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, r = 0.6 + R() * 1.8;
      c.fillStyle = `rgba(220,235,255,${0.12 + R() * 0.22})`;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    for (let i = 0; i < 14; i++) {
      let x = R() * w;
      c.strokeStyle = `rgba(220,235,255,${0.18 + R() * 0.2})`;
      c.lineWidth = 1 + R();
      c.beginPath(); c.moveTo(x, R() * h * 0.5);
      for (let y = 0; y < h; y += 8) { x += (R() - 0.5) * 3; c.lineTo(x, y); }
      c.stroke();
    }
  }, { ...DECAL, repeat: true, roughness: 0.1, metalness: 0.2 });
}

function glassMat() {
  return cmat('shopGlass', () => new THREE.MeshStandardMaterial({ color: '#7f9db0', roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.2, depthWrite: false }));
}

// ================================================================ storefront

const SHOP = {
  liquor: { name: 'LIQUOR', neon: '#ff2a6d', icon: 'bottle', iconColor: '#2af5ff', fascia: '#18202c', trim: '#b89a5a', pier: 'brickDark', bulk: 'tileMaroon', floor: 'tileWhite', bars: true, gate: true, win: [['BEER•WINE', '#2af5ff'], ['OPEN', '#ff2a6d']], posters: ['COLD BEER', 'LOTTO', 'ICE', 'CHECKS CASHED'], room: 'liquor', light: '#dff2ff' },
  pizza: { name: 'PIZZA', neon: '#ff9a1a', icon: 'slice', fascia: '#5c1712', trim: '#ede0c0', pier: 'brickRed', bulk: 'tileWhite', floor: 'tileChecker', stripes: true, win: [['OPEN', '#ff2a6d'], ['SLICES', '#ffb12a']], posters: ['SLICE 99¢', 'FREE DELIVERY', 'CALZONES', 'BEER ON TAP'], room: 'pizza', light: '#ffc27a' },
  burger: { name: 'BURGERS', neon: '#ffb62a', icon: 'burger', fascia: '#a63a14', trim: '#ffd24a', pier: 'stuccoWhite', bulk: 'tileTeal', floor: 'tileChecker', win: [['OPEN', '#ff2a6d'], ['SHAKES', '#2af5ff']], posters: ['DOUBLE CHEESE $1.99', 'CHILI FRIES', 'OPEN LATE', 'COMBO #3'], room: 'burger', light: '#ffd890' },
  pawn: { name: 'PAWN', neon: '#ffd02f', icon: 'balls', fascia: '#141a16', trim: '#c9a64a', pier: 'brickBrown', bulk: 'brickDark', floor: 'tileWhite', bars: true, gate: true, win: [['LOANS', '#2af5ff'], ['GOLD', '#ffd02f']], posters: ['WE BUY GOLD', 'GUITARS TV STEREO', 'CASH NOW', 'NO REFUNDS'], room: 'pawn', light: '#ffe0a0' },
  arcade: { name: 'ARCADE', neon: '#b05aff', icon: 'joystick', iconColor: '#2af5ff', fascia: '#100a20', trim: '#ff2a6d', pier: 'stuccoTeal', bulk: 'tileMaroon', floor: 'tileChecker', win: [['PLAY', '#2af5ff'], ['25¢', '#ff2a6d']], posters: ['HIGH SCORE', '25¢ PLAY', 'TOKENS', 'NEW GAMES'], room: 'arcade', light: '#a070ff' },
  supermarket: { name: 'SUPERMARKET', neon: '#ff3030', icon: 'cart', fascia: '#15261e', trim: '#d8d2c2', pier: 'stuccoWhite', bulk: 'brickRed', floor: 'tileWhite', win: [['OPEN 24 HRS', '#ff3030'], ['OPEN', '#2af5ff']], posters: ['SALE', 'EGGS 89¢', 'MILK $1.09', 'COUPONS'], room: 'market', light: '#eefaff', tube: 1.25 },
  diner: { name: 'DINER', neon: '#2af5ff', icon: 'cup', fascia: '#164650', trim: '#d8dde2', pier: 'stuccoWhite', bulk: 'tileChecker', floor: 'tileChecker', center: true, chrome: true, win: [['OPEN 24 HRS', '#ff2a6d'], ['COFFEE', '#2af5ff']], posters: ['PIE & COFFEE 75¢', 'BREAKFAST ALL DAY', 'MALTS', 'BLUE PLATE'], room: 'diner', light: '#ffe2b0' },
  hotel: { name: 'HOTEL', neon: '#ff2a6d', vertical: true, broken: [2], fascia: '#2a1a14', trim: '#c9a64a', pier: 'brickRed', bulk: 'brickDark', floor: 'tileMaroon', center: true, win: [['VACANCY', '#3dff8a']], posters: ['ROOMS $19', 'COLOR TV', 'WEEKLY RATES', 'NO PETS'], room: 'hotel', light: '#ffc890' },
};

// Re-themes a storefront when the level gives a different business name.
function shopProfile(kind, name) {
  const P = { ...SHOP[kind] };
  if (name === P.name) return P;
  const has = (re) => re.test(name);
  P.icon = null;
  if (has(/PIZZA/)) P.icon = 'slice';
  else if (has(/BURGER/)) P.icon = 'burger';
  else if (has(/PAWN/)) P.icon = 'balls';
  else if (has(/ARCADE|LAZER|GAME/)) P.icon = 'joystick';
  else if (has(/MARKET|GROCER/)) P.icon = 'cart';
  else if (has(/DINER|CAFE|COFFEE/)) P.icon = 'cup';
  else if (has(/BAR|COCKTAIL|LOUNGE/)) { P.icon = 'martini'; P.room = 'bar'; P.win = [['COCKTAILS', '#ff2a6d'], ['OPEN', '#2af5ff']]; P.posters = ['HAPPY HOUR', 'LIVE MUSIC', 'POOL', 'LADIES NITE']; }
  else if (has(/LIQUOR|WINE/)) P.icon = 'bottle';
  else if (has(/MOTEL/)) P.icon = 'arrow';
  else if (has(/VIDEO/)) { P.icon = 'star'; P.room = 'video'; P.win = [['VHS•BETA', '#2af5ff'], ['OPEN', '#ff2a6d']]; P.posters = ['NEW RELEASES', 'RENT 2 GET 1', 'VCR RENTALS', 'MEMBERS']; }
  else if (has(/CHECK|CASH/)) { P.room = 'checks'; P.win = [['CASH', '#3dff8a'], ['OPEN', '#ff2a6d']]; P.posters = ['MONEY ORDERS', 'FOOD STAMPS', 'PAYDAY LOANS', 'WIRE $$$']; }
  if (P.vertical) P.icon = null;
  return P;
}

// Back wall of a shop interior seen through the window (emissive art, ~6 m x 2.7 m).
function paintRoom(c, w, h, room, R) {
  const Y = (m) => h - (m / 2.7) * h;
  const X = (m) => (m / 6) * w;
  const rect = (col, x0, y0, x1, y1) => { c.fillStyle = col; c.fillRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)); };
  const lightBlob = (x, y, r, col) => {
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), X(r));
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  };
  const text = (t, x, y, px, col, font = 'Impact, "Arial Black", sans-serif') => { c.fillStyle = col; c.font = `900 ${px}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, X(x), Y(y)); };
  const pals = {
    liquor: ['#2a3a34', '#1a1c1e', '#3a4440'], bar: ['#2a1418', '#140a0c', '#3a2024'], video: ['#2a2440', '#14121c', '#3a3460'],
    pizza: ['#d8c8a0', '#5a2a1a', '#e8dcc0'], burger: ['#c84a2a', '#3a1a10', '#f0d8a0'], pawn: ['#5a4630', '#2a2016', '#6a5640'],
    arcade: ['#1a0c2a', '#0a0612', '#24103a'], market: ['#e4ece8', '#9aa4a0', '#f4fbf8'], diner: ['#c0a070', '#2a1a12', '#e0c890'],
    hotel: ['#5a3420', '#2a160c', '#6e4428'], checks: ['#b8c8c0', '#4a5450', '#d0e0d8'],
  };
  const [wall, floor, ceil] = pals[room] || pals.liquor;
  c.fillStyle = wall; c.fillRect(0, 0, w, h);
  rect(ceil, 0, 2.45, 6, 2.7);
  rect(floor, 0, 0, 6, 0.32);
  for (let x = 0.4; x < 6; x += 1.5) { rect('#fffbea', x, 2.52, x + 0.8, 2.56); lightBlob(x + 0.4, 2.5, 0.9, 'rgba(255,250,230,0.35)'); }
  const shelves = (x0, x1, y0, y1, rows, item) => {
    rect('#1a1410', x0 - 0.03, y0 - 0.05, x1 + 0.03, y1 + 0.05);
    for (let r = 0; r < rows; r++) {
      const yb = y0 + ((y1 - y0) * r) / rows;
      rect('#3a2c20', x0, yb, x1, yb + 0.03);
      let x = x0 + 0.02;
      while (x < x1 - 0.06) x += item(x, yb + 0.03, (y1 - y0) / rows - 0.06);
    }
  };
  const bottle = (x, yb, hh) => {
    const cols = ['#b8741a', '#2f6b2a', '#cfd8d0', '#8a1a1a', '#1a3a8a', '#6a3a10', '#e0c060'];
    const bw = 0.05 + R() * 0.03, bh = hh * (0.55 + R() * 0.4), col = cols[Math.floor(R() * cols.length)];
    rect(col, x, yb, x + bw, yb + bh * 0.65);
    rect(col, x + bw * 0.35, yb + bh * 0.65, x + bw * 0.65, yb + bh);
    rect('#f0ead8', x + bw * 0.1, yb + bh * 0.2, x + bw * 0.9, yb + bh * 0.42);
    rect('rgba(255,255,255,0.35)', x + bw * 0.15, yb + bh * 0.05, x + bw * 0.25, yb + bh * 0.6);
    return bw + 0.012;
  };
  const tape = (x, yb, hh) => {
    const cols = ['#e83a3a', '#2a6ae8', '#f5d22a', '#1a1a1a', '#e8e8e8', '#3ab84a', '#b84ae8', '#ff8a1a'];
    const bw = 0.07, bh = hh * 0.85;
    rect(cols[Math.floor(R() * cols.length)], x, yb, x + bw, yb + bh);
    rect('rgba(255,255,255,0.7)', x + 0.01, yb + bh * 0.62, x + bw - 0.01, yb + bh * 0.8);
    return bw + 0.01;
  };
  const box = (x, yb, hh) => {
    const cols = ['#e8b02a', '#d8321e', '#2a5ad8', '#f0f0e0', '#3aa83a', '#e86a1a', '#8a2ad8'];
    const bw = 0.12 + R() * 0.1, bh = hh * (0.6 + R() * 0.35), col = cols[Math.floor(R() * cols.length)];
    rect(col, x, yb, x + bw, yb + bh);
    rect('rgba(255,255,255,0.6)', x + bw * 0.2, yb + bh * 0.5, x + bw * 0.8, yb + bh * 0.7);
    return bw + 0.015;
  };
  const counter = (x0, x1, top, front, topCol = '#b8bec4') => { rect(front, x0, 0, x1, top); rect(topCol, x0 - 0.04, top, x1 + 0.04, top + 0.05); };
  if (room === 'liquor' || room === 'bar') {
    shelves(0.2, 3.6, 0.9, 2.3, 4, bottle);
    if (room === 'liquor') {
      for (let d = 0; d < 3; d++) {
        const x0 = 3.8 + d * 0.72;
        rect('#e8f6ff', x0, 0.3, x0 + 0.66, 2.3);
        for (let r = 0; r < 5; r++) for (let i = 0; i < 6; i++) rect(['#c81e1e', '#1e4ac8', '#e8c81e', '#1e8a3a', '#f0f0f0'][Math.floor(R() * 5)], x0 + 0.04 + i * 0.1, 0.45 + r * 0.36, x0 + 0.11 + i * 0.1, 0.62 + r * 0.36);
        rect('#3a3e44', x0 - 0.02, 0.3, x0, 2.3); rect('#8a9098', x0 + 0.56, 1.0, x0 + 0.58, 1.6);
      }
      lightBlob(4.8, 1.4, 1.6, 'rgba(220,240,255,0.35)');
      text('BEER', 4.9, 2.38, 26, '#ff3a3a');
      counter(0.0, 1.8, 1.0, '#3a2a20', '#6a5a4a');
      rect('#1a1a1a', 0.5, 1.05, 0.85, 1.3); rect('#3aff6a', 0.55, 1.2, 0.8, 1.27);
    } else {
      lightBlob(1.9, 1.6, 2.2, 'rgba(255,90,140,0.35)');
      shelves(3.9, 5.8, 1.1, 2.3, 3, bottle);
      counter(0.0, 6.0, 1.05, '#2a120c', '#6a3a24');
      for (let x = 0.4; x < 6; x += 0.7) { rect('#1a0c08', x, 0, x + 0.04, 0.75); rect('#8a1a1a', x - 0.12, 0.75, x + 0.16, 0.82); }
    }
  } else if (room === 'video') {
    shelves(0.1, 5.9, 0.6, 2.3, 5, tape);
    text('NEW RELEASES', 1.6, 2.4, 22, '#ffe14a');
    text('HORROR', 4.4, 2.4, 22, '#ff3a3a');
    lightBlob(3, 1.5, 3, 'rgba(160,140,255,0.25)');
  } else if (room === 'market') {
    for (let a = 0; a < 3; a++) shelves(0.15 + a * 2, 1.85 + a * 2, 0.45, 2.0, 4, box);
    for (let a = 0; a < 3; a++) { rect('#1a4ac8', 0.6 + a * 2, 2.15, 1.4 + a * 2, 2.38); text(`${a + 1} ${['BREAD', 'CEREAL', 'CANNED'][a]}`, 1.0 + a * 2, 2.265, 18, '#fff'); }
    counter(0.2, 2.2, 0.95, '#c8302a', '#2a2a2a');
    lightBlob(3, 2.2, 4, 'rgba(255,255,255,0.3)');
  } else if (room === 'pizza') {
    for (let y = 0.3; y < 2.45; y += 0.12) rect('rgba(120,90,60,0.25)', 0, y, 6, y + 0.008);
    rect('#141414', 1.6, 1.6, 4.0, 2.35); text('MENU', 2.8, 2.22, 30, '#ffb12a');
    for (let i = 0; i < 6; i++) { rect('#e8e8e8', 1.75, 1.72 + i * 0.07, 2.6 + R() * 0.6, 1.745 + i * 0.07); rect('#ffb12a', 3.6, 1.72 + i * 0.07, 3.85, 1.745 + i * 0.07); }
    c.fillStyle = '#6a2a1a'; c.beginPath(); c.arc(X(5.0), Y(1.2), X(0.65), PI, 0); c.fill();
    c.fillStyle = '#ff7a1a'; c.beginPath(); c.arc(X(5.0), Y(1.2), X(0.45), PI, 0); c.fill();
    lightBlob(5.0, 1.35, 1.1, 'rgba(255,140,40,0.75)');
    rect('#5a3020', 4.2, 0, 5.8, 1.2);
    counter(0.2, 4.0, 1.0, '#1d6b3a', '#c0c6cc');
    for (const px of [0.8, 2.0, 3.2]) { c.fillStyle = '#e8a040'; c.beginPath(); c.ellipse(X(px), Y(1.08), X(0.3), Y(0.98) - Y(1.08), 0, 0, TAU); c.fill(); }
    rect('#1d7a3a', 0, 2.38, 2, 2.44); rect('#efe6cf', 2, 2.38, 4, 2.44); rect('#c0281e', 4, 2.38, 6, 2.44);
  } else if (room === 'burger') {
    for (let x = 0; x < 6; x += 0.3) rect(Math.round(x / 0.3) % 2 ? '#f0e8d8' : '#c83a2a', x, 0.9, x + 0.3, 1.2);
    rect('#2a2a2a', 0.8, 1.7, 5.2, 2.35);
    for (let i = 0; i < 4; i++) {
      rect('#ffd24a', 0.9 + i * 1.07, 1.78, 1.87 + i * 1.07, 2.28);
      c.fillStyle = '#8a4a1a'; c.beginPath(); c.ellipse(X(1.38 + i * 1.07), Y(2.05), X(0.3), Y(1.95) - Y(2.05), 0, 0, TAU); c.fill();
      rect('#3aa83a', 1.1 + i * 1.07, 1.98, 1.66 + i * 1.07, 2.01);
    }
    counter(0.3, 5.7, 1.0, '#b8bec4', '#8a9096');
    text('ORDER HERE', 1.5, 1.45, 22, '#ffd24a');
    lightBlob(3, 2.0, 2.5, 'rgba(255,210,120,0.4)');
  } else if (room === 'pawn') {
    for (let i = 0; i < 5; i++) {
      const gx = 0.4 + i * 0.6, gy = 1.6 + (i % 2) * 0.25;
      c.fillStyle = ['#a8501a', '#1a1a1a', '#c82a2a', '#e8c88a', '#2a4a8a'][i];
      c.beginPath(); c.ellipse(X(gx), Y(gy - 0.2), X(0.17), Y(gy - 0.35) - Y(gy - 0.2), 0, 0, TAU); c.ellipse(X(gx), Y(gy + 0.05), X(0.13), Y(gy - 0.07) - Y(gy + 0.05), 0, 0, TAU); c.fill();
      rect('#3a2414', gx - 0.02, gy + 0.1, gx + 0.02, gy + 0.6);
    }
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) { const x0 = 3.5 + i * 0.75, y0 = 0.9 + r * 0.5; rect('#2a2a2a', x0, y0, x0 + 0.65, y0 + 0.44); rect(['#3a6aff', '#7a8a9a', '#2a3a6a'][Math.floor(R() * 3)], x0 + 0.06, y0 + 0.06, x0 + 0.5, y0 + 0.38); }
    text('NO REFUNDS', 1.5, 2.38, 22, '#ff3a3a');
    rect('#e8e0c0', 0.2, 0.3, 3.2, 0.95); rect('#fff2c0', 0.25, 0.85, 3.15, 0.92);
    lightBlob(1.7, 0.9, 1.6, 'rgba(255,240,200,0.5)');
  } else if (room === 'arcade') {
    for (let y = 0.9; y < 2.4; y += 0.35) rect(y % 0.7 > 0.3 ? '#ff2a6d' : '#2af5ff', 0, y, 6, y + 0.025);
    for (let i = 0; i < 7; i++) {
      const x0 = 0.15 + i * 0.84;
      rect('#0c0814', x0, 0.3, x0 + 0.66, 2.05);
      rect(['#ff2a6d', '#2af5ff', '#ffd02f', '#3dff8a', '#b05aff'][i % 5], x0 + 0.05, 1.85, x0 + 0.61, 2.0);
      rect('#05050a', x0 + 0.07, 1.2, x0 + 0.59, 1.7);
      for (let p = 0; p < 18; p++) rect(['#ff3a3a', '#3aff6a', '#ffe14a', '#3a8aff', '#ffffff'][Math.floor(R() * 5)], x0 + 0.1 + R() * 0.42, 1.25 + R() * 0.38, x0 + 0.14 + R() * 0.42, 1.28 + R() * 0.38);
      lightBlob(x0 + 0.33, 1.45, 0.5, 'rgba(120,160,255,0.35)');
    }
    for (let i = 0; i < 40; i++) rect(['#ff2a6d', '#2af5ff', '#ffd02f'][i % 3], R() * 6, R() * 0.3, R() * 6 + 0.05, R() * 0.3 + 0.02);
  } else if (room === 'diner') {
    rect('#c8ccd2', 0, 0.9, 6, 0.96);
    counter(0.0, 6.0, 1.0, '#b8202a', '#d8dde2');
    for (let x = 0.5; x < 6; x += 0.7) { rect('#c8ccd2', x - 0.02, 0, x + 0.02, 0.7); rect('#c8202a', x - 0.17, 0.7, x + 0.17, 0.78); }
    rect('#c8ccd2', 0.4, 1.3, 1.6, 1.9); rect('rgba(255,240,220,0.8)', 0.45, 1.35, 1.55, 1.85);
    for (let i = 0; i < 4; i++) { c.fillStyle = '#d8a050'; c.beginPath(); c.arc(X(0.62 + i * 0.27), Y(1.45), X(0.1), PI, 0); c.fill(); }
    for (let i = 0; i < 2; i++) { rect('#b8bec6', 2.2 + i * 0.5, 1.1, 2.55 + i * 0.5, 1.75); }
    rect('#1a1a1a', 3.5, 1.7, 5.6, 2.35); text('BREAKFAST • LUNCH • DINNER', 4.55, 2.22, 14, '#ffe2b0');
    for (let i = 0; i < 5; i++) rect('#f0e8d8', 3.65, 1.82 + i * 0.07, 4.6 + R() * 0.7, 1.845 + i * 0.07);
    for (let x = 1; x < 6; x += 1.6) { c.fillStyle = '#2a2a2a'; c.beginPath(); c.moveTo(X(x - 0.18), Y(2.2)); c.lineTo(X(x + 0.18), Y(2.2)); c.lineTo(X(x + 0.08), Y(2.35)); c.lineTo(X(x - 0.08), Y(2.35)); c.fill(); lightBlob(x, 2.15, 0.6, 'rgba(255,220,150,0.7)'); }
  } else if (room === 'hotel') {
    for (let x = 0; x < 6; x += 0.25) rect(Math.round(x / 0.25) % 2 ? '#6a4026' : '#5a3420', x, 0.3, x + 0.25, 2.45);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) { const x0 = 3.6 + i * 0.3, y0 = 1.3 + r * 0.24; rect('#2a160c', x0, y0, x0 + 0.26, y0 + 0.2); if (R() < 0.6) rect('#e8c86a', x0 + 0.11, y0 + 0.04, x0 + 0.14, y0 + 0.14); }
    counter(3.2, 5.9, 1.05, '#3a1e10', '#8a5a3a');
    rect('#e8c86a', 4.4, 1.12, 4.55, 1.18);
    c.fillStyle = '#1a3a1a';
    for (let i = 0; i < 9; i++) { const a = -HP + (R() - 0.5) * 2.4; c.beginPath(); c.ellipse(X(1.0 + Math.cos(a) * 0.3), Y(1.4 + Math.sin(-a) * 0.35), X(0.32), Y(1.0) - Y(1.06), a, 0, TAU); c.fill(); }
    rect('#5a2a10', 0.85, 0.3, 1.15, 0.9);
    rect('#c9a64a', 1.8, 1.4, 2.8, 2.1); rect('#3a5a6a', 1.86, 1.46, 2.74, 2.04);
    lightBlob(2.3, 1.4, 1.4, 'rgba(255,200,130,0.55)');
  } else if (room === 'checks') {
    counter(0.2, 5.8, 1.1, '#5a6a64', '#2a2e2c');
    rect('rgba(200,230,255,0.35)', 0.2, 1.15, 5.8, 2.2);
    for (let x = 0.2; x < 5.8; x += 0.15) rect('#2a2e2c', x, 1.15, x + 0.02, 2.2);
    text('MONEY ORDERS', 3, 2.33, 24, '#1a3a8a');
    lightBlob(3, 2.2, 3.5, 'rgba(230,255,240,0.35)');
  }
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.1)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

// Day-glo window cards for a shop (4 cells in a 512 x 512 atlas).
function windowCardMat(key, texts) {
  return paintMat(`cards-${key}`, 512, 512, (c) => {
    const R = TX.rng(texts.join('').length * 7 + 3);
    const bgs = ['#ffe14a', '#ff5a8a', '#7aff6a', '#ffffff', '#ff9a2a', '#6ae0ff'];
    texts.slice(0, 4).forEach((t, i) => {
      const x = (i % 2) * 256, y = Math.floor(i / 2) * 256;
      const bg = bgs[Math.floor(R() * bgs.length)];
      c.fillStyle = bg;
      c.beginPath();
      if (i % 2 === 0) {
        for (let s = 0; s < 24; s++) { const a = (s / 24) * TAU, r = s % 2 ? 100 : 124; c.lineTo(x + 128 + Math.cos(a) * r, y + 128 + Math.sin(a) * r); }
        c.fill();
      } else c.fillRect(x + 12, y + 30, 232, 196);
      c.fillStyle = bg === '#ffffff' ? '#c81e1e' : '#141414';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const words = t.split(' ');
      const half = Math.ceil(words.length / 2);
      const lines = words.length > 2 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : words.length === 2 && t.length > 9 ? words : [t];
      lines.forEach((ln, j) => { fitFont(c, ln, 190, 64 - lines.length * 8); c.fillText(ln, x + 128, y + 128 + (j - (lines.length - 1) / 2) * 56); });
    });
  }, { transparent: true, alphaTest: 0.4, glow: 0.22, roughness: 0.6 });
}

// Painted fascia band (trim lines, small lettering, grime) behind the sign.
function fasciaMat(P, name, W) {
  return paintMat(`fascia-${P.fascia}-${P.trim}-${name}-${Math.round(W)}-${!!P.stripes}`, 1024, 128, (c, w, h) => {
    const R = TX.rng(name.length * 17 + Math.round(W));
    c.fillStyle = P.fascia; c.fillRect(0, 0, w, h);
    c.fillStyle = P.trim; c.fillRect(0, 6, w, 5); c.fillRect(0, h - 11, w, 5);
    if (P.stripes) { const t = w / 3; [['#1d7a3a', 0], ['#efe6cf', t], ['#c0281e', 2 * t]].forEach(([col, x]) => { c.fillStyle = col; c.fillRect(x, h - 24, t, 10); }); }
    c.fillStyle = P.trim; c.textBaseline = 'middle';
    c.font = '700 18px Georgia, serif';
    c.textAlign = 'left'; c.fillText(`EST. ${1950 + Math.floor(R() * 30)}`, w * 0.075, h / 2);
    c.textAlign = 'right'; c.fillText(`NO. ${100 + Math.floor(R() * 8899)}`, w * 0.925, h / 2);
    for (let x = 30; x < w; x += 90) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(x, 20, 3, 0, TAU); c.arc(x, h - 20, 3, 0, TAU); c.fill(); }
    grimeCanvas(c, w, h, R, 0.7);
  }, { roughness: 0.55, metalness: 0.2 });
}

const hashStr = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 100000; };

/**
 * Ground-floor shop front (front face z = -1.2, room depth ~1 m behind it): piers, tiled
 * bulkheads, aluminium display windows with rain-beaded glass and a lit interior (painted
 * back wall + floor + 3D counters / arcade cabinets / shelving), recessed glass door with
 * transom, painted fascia carrying a 3D tube-neon sign + pictogram, window neons, day-glo
 * price cards, posters, tags, gooseneck lamp, CCTV camera, alarm bell; per kind: security
 * gate + bars (liquor, pawn), chrome bands (diner), vertical neon blade sign (hotel).
 * @param {object} opts
 * @param {number} [opts.width=8] @param {number} [opts.height=3.4] @param {number} [opts.depth=1]
 * @param {string} [opts.kind='liquor'] liquor|pizza|burger|pawn|arcade|supermarket|diner|hotel
 * @param {string} [opts.name] sign text (also re-themes: BAR, VIDEO, MOTEL, CHECKS CASHED…)
 * @param {string} [opts.neon] neon colour; [opts.flicker] flickering main sign; [opts.seed]
 * userData.lights: main neon, window neons, interior spill. No colliders.
 */
export function makeStorefront(opts = {}) {
  const kind = SHOP[opts.kind] ? opts.kind : 'liquor';
  const name = String(opts.name ?? SHOP[kind].name).toUpperCase();
  const P = shopProfile(kind, name);
  const W = opts.width ?? 8, H = opts.height ?? 3.4, D = opts.depth ?? 1.0;
  const seed = opts.seed ?? hashStr(name + kind + W);
  const R = TX.rng(seed);
  const neon = opts.neon ?? P.neon;
  const Z = -1.2;
  const g = new THREE.Group(), k = new Kit();
  const pil = THREE.MathUtils.clamp(W * 0.045, 0.32, 0.5);
  const bulkH = 0.5, fasciaH = Math.min(0.9, H * 0.27), fy0 = H - fasciaH, winTop = fy0 - 0.12;
  const doorW = 1.0, doorH = Math.min(2.25, winTop - 0.25);
  const doorX = P.center ? 0 : (R() < 0.5 ? -1 : 1) * (W / 2 - pil - 0.45 - doorW / 2);
  const iw0 = -W / 2 + pil, iw1 = W / 2 - pil;
  const spans = [[iw0, doorX - doorW / 2 - 0.1], [doorX + doorW / 2 + 0.1, iw1]].filter(([a, b]) => b - a > 0.45);
  const pierM = mat(P.pier), bulkM = mat(P.bulk);
  const alu = solid('#2c2824', 0.32, 0.85), chrome = mat('chrome'), dark = solid('#141416', 0.6, 0.4);
  const steel = mat('steelGrey');
  const glass = glassMat(), rain = rainGlassMat();
  const lights = [];

  // --- interior room
  const room = paintMat(`room-${P.room}`, 1024, 460, (c, w, h) => paintRoom(c, w, h, P.room, TX.rng(hashStr(P.room))), { glow: 0.42, repeat: true, roughness: 0.9 });
  const back = new THREE.PlaneGeometry(iw1 - iw0, 2.7);
  xf(back, 0, 1.35, Z - D + 0.04);
  const bp = back.attributes.position, bu = back.attributes.uv;
  for (let i = 0; i < bu.count; i++) bu.setXY(i, bp.getX(i) / 6 + (seed % 7) * 0.13, bp.getY(i) / 2.7);
  k.add(room, back, 0, false);
  const floorM = cmat(`shopFloor${P.floor}${P.light}`, () => {
    const base = mat(P.floor);
    return new THREE.MeshStandardMaterial({ map: base.map, normalMap: base.normalMap, emissiveMap: base.map, emissive: new THREE.Color(P.light), emissiveIntensity: 0.1, roughness: 0.35 });
  });
  k.add(floorM, xf(new THREE.PlaneGeometry(iw1 - iw0, D - 0.1), 0, 0.015, Z - D / 2 - 0.02, -HP), 0.9);
  const wallM = cmat(`shopWall${P.light}`, () => new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color(P.light).multiplyScalar(0.18), roughness: 0.9 }));
  k.add(wallM, xf(new THREE.PlaneGeometry(D, 2.7), iw0 + 0.01, 1.35, Z - D / 2, 0, HP), 0, false);
  k.add(wallM, xf(new THREE.PlaneGeometry(D, 2.7), iw1 - 0.01, 1.35, Z - D / 2, 0, -HP), 0, false);
  k.add(dark, xf(new THREE.PlaneGeometry(iw1 - iw0, D), 0, winTop + 0.02, Z - D / 2, HP), 0, false);
  const fix = emissiveMat(P.light, 1.6, '#ffffff', 0.5);
  for (let x = iw0 + 0.8; x < iw1 - 0.4; x += 1.8) k.box(fix, 1.0, 0.03, 0.12, x, winTop - 0.02, Z - D * 0.55, { shadow: false });
  // 3D interior furniture for parallax
  const ir = Z - D + 0.3;
  if (P.room === 'arcade') {
    const screen = paintMat('arcadeScreens', 256, 64, (c, w, h) => {
      const RR = TX.rng(5);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = '#05060c'; c.fillRect(i * 64, 0, 64, h);
        for (let p = 0; p < 30; p++) { c.fillStyle = ['#ff3a3a', '#3aff6a', '#ffe14a', '#3a8aff', '#fff'][Math.floor(RR() * 5)]; c.fillRect(i * 64 + 4 + RR() * 54, 4 + RR() * 54, 3, 3); }
      }
    }, { glow: 2.2 });
    for (let x = iw0 + 0.6; x < iw1 - 0.4; x += 1.15) {
      if (Math.abs(x - doorX) < 0.7) continue;
      k.box(solid('#16101e', 0.6), 0.62, 1.75, 0.55, x, 0.875, ir);
      const si = Math.floor(R() * 4);
      k.add(screen, uvRect(xf(new THREE.PlaneGeometry(0.48, 0.4), x, 1.35, ir + 0.28, -0.25), si / 4, 0, (si + 1) / 4, 1), 0, false);
      k.box(emissiveMat(['#ff2a6d', '#2af5ff', '#ffd02f', '#3dff8a'][si], 2.5), 0.56, 0.16, 0.05, x, 1.66, ir + 0.27, { shadow: false });
    }
  } else if (P.room === 'market') {
    const shelf = paintMat('marketShelfFront', 512, 128, (c, w, h) => paintRoom(c, w, h, 'market', TX.rng(8)), { glow: 0.35, repeat: true });
    for (const s of spans) {
      const gw = s[1] - s[0] - 0.4;
      if (gw < 0.6) continue;
      k.add(shelf, xf(new THREE.BoxGeometry(gw, 1.45, 0.3), (s[0] + s[1]) / 2, 0.725, ir + 0.05));
    }
  } else if (P.room !== 'video') {
    const ctr = cmat(`counter${P.room}`, () => new THREE.MeshStandardMaterial({ color: P.room === 'diner' ? '#a8202a' : P.room === 'pizza' ? '#1d6b3a' : '#3a2a20', roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(P.light), emissiveIntensity: 0.08 }));
    const cx0 = spans.length ? spans[0][0] + 0.3 : iw0 + 0.3, cx1 = spans.length ? spans[0][1] - 0.2 : iw1 - 0.3;
    if (cx1 - cx0 > 0.6) {
      k.box(ctr, cx1 - cx0, 1.0, 0.4, (cx0 + cx1) / 2, 0.5, ir + 0.1);
      k.box(P.room === 'pawn' ? emissiveMat('#fff2c0', 0.45, '#888888') : chrome, cx1 - cx0 + 0.06, 0.05, 0.46, (cx0 + cx1) / 2, 1.02, ir + 0.1);
      if (P.room === 'diner' || P.room === 'bar') for (let x = cx0 + 0.3; x < cx1 - 0.1; x += 0.6) { k.cyl(chrome, 0.03, 0.05, 0.7, x, 0.35, ir + 0.5, { seg: 8 }); k.cyl(solid('#b01a22', 0.35), 0.17, 0.17, 0.08, x, 0.74, ir + 0.5, { seg: 14 }); }
      k.box(solid('#222222', 0.4, 0.6), 0.32, 0.22, 0.28, cx0 + 0.35, 1.15, ir + 0.1);
    }
  }

  // --- piers, bulkheads, glazing, header, fascia
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - pil / 2);
    k.box(pierM, pil, H, D + 0.14, x, H / 2, Z - D / 2 + 0.07, { uv: 1.4 });
    k.box(mat('concreteDark'), pil + 0.05, 0.32, D + 0.18, x, 0.16, Z - D / 2 + 0.07, { uv: 1 });
  }
  for (const [a, b] of spans) {
    const sw = b - a, cx = (a + b) / 2;
    k.box(bulkM, sw, bulkH, 0.22, cx, bulkH / 2, Z - 0.09, { uv: 0.8 });
    k.box(alu, sw, 0.045, 0.26, cx, bulkH + 0.02, Z - 0.1);
    const gh = winTop - bulkH;
    k.add(glass, xf(new THREE.PlaneGeometry(sw, gh), cx, bulkH + gh / 2, Z - 0.08), 0, false);
    const rg = xf(new THREE.PlaneGeometry(sw, gh), cx, bulkH + gh / 2, Z - 0.075);
    worldUV(rg, 1.1);
    k.add(rain, rg, 0, false);
    const np = Math.max(1, Math.ceil(sw / 1.7));
    for (let i = 0; i <= np; i++) k.box(alu, 0.055, gh, 0.1, a + (sw * i) / np, bulkH + gh / 2, Z - 0.08);
    k.box(alu, sw, 0.05, 0.1, cx, winTop - 0.48, Z - 0.08);
    if (P.bars) {
      for (let x = a + 0.08; x < b - 0.04; x += 0.13) k.cyl(steel, 0.011, 0.011, gh - 0.05, x, bulkH + gh / 2, Z + 0.05, { seg: 5 });
      for (const yy of [bulkH + 0.3, winTop - 0.3]) k.box(steel, sw - 0.06, 0.04, 0.012, cx, yy, Z + 0.06);
    }
    const cards = windowCardMat(P.room + kind, P.posters);
    const nc = Math.min(4, Math.max(1, Math.floor(sw / 1.1)));
    for (let i = 0; i < nc; i++) {
      const ci = Math.floor(R() * 4), sz = 0.42 + R() * 0.12;
      const xx = a + 0.35 + ((sw - 0.7) * (i + 0.5)) / nc;
      const yy = bulkH + 0.32 + (i % 2 ? gh - 0.95 : 0);
      k.add(cards, uvRect(xf(new THREE.PlaneGeometry(sz, sz), xx, yy, Z - 0.095, 0, 0, (R() - 0.5) * 0.12), (ci % 2) / 2, 1 - (Math.floor(ci / 2) + 1) / 2, (ci % 2 + 1) / 2, 1 - Math.floor(ci / 2) / 2), 0, false);
    }
  }
  k.box(alu, W - 2 * pil, fy0 - winTop, 0.16, 0, (winTop + fy0) / 2, Z - 0.05);
  k.box(solid(P.fascia, 0.55, 0.3), W, fasciaH, 0.24, 0, fy0 + fasciaH / 2, Z - 0.04);
  k.add(fasciaMat(P, name, W), xf(new THREE.PlaneGeometry(W, fasciaH), 0, fy0 + fasciaH / 2, Z + 0.081));
  k.box(solid('#3a3c40', 0.45, 0.8), W + 0.08, 0.05, 0.32, 0, H + 0.025, Z - 0.03);
  if (P.chrome) for (const yy of [fy0 + 0.06, H - 0.06]) k.cyl(chrome, 0.025, 0.025, W, 0, yy, Z + 0.1, { rz: HP, seg: 8 });

  // --- recessed door + transom
  const dz = Z - 0.45;
  for (const s of [-1, 1]) k.box(bulkM, 0.05, winTop, 0.45, doorX + s * (doorW / 2 + 0.05), winTop / 2, Z - 0.225, { uv: 0.8 });
  k.box(bulkM, doorW + 0.1, 0.02, 0.45, doorX, 0.01, Z - 0.225, { uv: 0.8 });
  k.box(mat('concrete'), doorW + 0.4, 0.06, 0.3, doorX, 0.03, Z + 0.15, { uv: 1 });
  k.add(glass, xf(new THREE.PlaneGeometry(doorW, winTop), doorX, winTop / 2, dz), 0, false);
  for (const s of [-1, 1]) k.box(alu, 0.08, doorH, 0.06, doorX + s * (doorW / 2 - 0.04), doorH / 2, dz);
  k.box(alu, doorW, 0.22, 0.06, doorX, 0.11, dz);
  k.box(alu, doorW + 0.06, 0.08, 0.08, doorX, doorH + 0.04, dz);
  k.box(alu, doorW, 0.06, 0.06, doorX, doorH - 0.03, dz);
  k.cyl(chrome, 0.018, 0.018, doorW - 0.25, doorX, 1.0, dz + 0.06, { rz: HP, seg: 8 });
  for (const s of [-1, 1]) k.box(chrome, 0.02, 0.02, 0.06, doorX + s * (doorW / 2 - 0.16), 1.0, dz + 0.03);
  const addr = 1100 + (seed % 800);
  const doorDecal = paintMat(`doorDecals${addr}`, 256, 128, (c) => {
    c.fillStyle = '#fff'; c.font = '700 22px Arial'; c.textAlign = 'center';
    c.fillText('PUSH', 64, 30);
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(150, 10, 96, 108);
    c.fillStyle = '#111'; c.font = '700 13px Arial';
    ['HOURS', 'MON-SAT 7-2', 'SUN 9-12', 'NO SHIRT', 'NO SHOES', 'NO SERVICE'].forEach((t, i) => c.fillText(t, 198, 28 + i * 16));
    c.fillStyle = '#e8c86a'; c.font = '900 40px Georgia'; c.fillText(String(addr), 64, 90);
  }, { ...DECAL, roughness: 0.4 });
  k.add(doorDecal, uvRect(xf(new THREE.PlaneGeometry(0.36, 0.18), doorX, 1.18, dz + 0.005), 0, 0.5, 0.5, 1), 0, false);
  k.add(doorDecal, uvRect(xf(new THREE.PlaneGeometry(0.3, 0.34), doorX + 0.15, 1.55, dz + 0.005), 0.58, 0.05, 0.97, 0.95), 0, false);
  k.add(doorDecal, uvRect(xf(new THREE.PlaneGeometry(0.5, 0.25), doorX, (doorH + winTop) / 2 + 0.03, dz + 0.005), 0, 0, 0.5, 0.5), 0, false);

  // --- security gate housing + guides
  if (P.gate) {
    k.cyl(steel, 0.15, 0.15, iw1 - iw0, 0, fy0 + 0.02, Z + 0.2, { rz: HP, seg: 14, uv: 1 });
    for (const [a, b] of spans) for (const x of [a + 0.03, b - 0.03]) k.box(steel, 0.05, fy0 - 0.1, 0.07, x, (fy0 - 0.1) / 2, Z + 0.05);
  }
  // --- pier posters, tags, camera, alarm bell
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - pil / 2);
    if (R() < 0.8) posterDecal(k, Math.floor(R() * 8), pil * 0.78, x, 1.55 + R() * 0.3, Z + 0.075, (R() - 0.5) * 0.08);
    if (R() < 0.45) posterDecal(k, Math.floor(R() * 8), pil * 0.7, x + (R() - 0.5) * 0.05, 1.0 + R() * 0.2, Z + 0.077, (R() - 0.5) * 0.1);
    if (R() < 0.6) tagDecal(k, Math.floor(R() * 8), pil * 1.6, pil * 1.6, x, 0.55 + R() * 0.3, Z + 0.079);
  }
  if (spans.length && R() < 0.7) tagDecal(k, Math.floor(R() * 8), 0.9, 0.9, (spans[0][0] + spans[0][1]) / 2 + (R() - 0.5), 0.26, Z + 0.025);
  const bx = Math.sign(doorX || 1) * (W / 2 - pil / 2);
  k.cyl(solid('#b01818', 0.4, 0.3), Math.min(0.15, pil * 0.42), Math.min(0.15, pil * 0.42), 0.08, bx, 2.95, Z + 0.18, { rx: HP, seg: 18 });
  k.cyl(solid('#7a1010', 0.4), 0.05, 0.05, 0.1, bx, 2.95, Z + 0.21, { rx: HP, seg: 8 });
  const cmx = -Math.sign(doorX || 1) * (W / 2 - pil / 2);
  k.box(solid('#c8c4b8', 0.4, 0.3), 0.12, 0.1, 0.24, cmx, 2.85, Z + 0.24);
  k.cyl(dark, 0.035, 0.035, 0.04, cmx, 2.85, Z + 0.37, { rx: HP, seg: 10 });
  k.box(dark, 0.03, 0.15, 0.03, cmx, 2.73, Z + 0.16);

  // --- gooseneck lamp over the door
  const lampY = fy0 + 0.2;
  const neck = new THREE.CubicBezierCurve3(v3(doorX, lampY, Z + 0.09), v3(doorX, lampY + 0.25, Z + 0.25), v3(doorX, lampY + 0.2, Z + 0.55), v3(doorX, lampY - 0.05, Z + 0.62));
  k.add(dark, new THREE.TubeGeometry(neck, 12, 0.016, 6, false));
  k.add(solid('#1d3a2a', 0.45, 0.6), xf(new THREE.ConeGeometry(0.17, 0.13, 16, 1, true), doorX, lampY - 0.1, Z + 0.62));
  k.add(emissiveMat('#ffcf8a', 4, '#ffffff'), xf(new THREE.SphereGeometry(0.045, 10, 6), doorX, lampY - 0.15, Z + 0.62), 0, false);
  lights.push({ pos: v3(0, 1.8, Z - 0.15), color: P.light, intensity: 4 + (iw1 - iw0) * 0.5, distance: 6 });
  g.userData.lights = lights;

  // --- main neon on the fascia (or painted name + vertical blade for hotels)
  if (P.vertical) {
    const lettering = paintMat(`hotelLetters-${name}-${P.trim}`, 512, 96, (c, w, h) => {
      c.fillStyle = P.trim; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitFont(c, name, w * 0.9, h * 0.8, 'Georgia, serif', '700');
      c.shadowColor = '#000'; c.shadowOffsetX = 3; c.shadowOffsetY = 3;
      c.fillText(name, w / 2, h / 2);
    }, { ...DECAL, roughness: 0.4, metalness: 0.6 });
    const lw = Math.min(W * 0.5, name.length * 0.5);
    k.add(lettering, xf(new THREE.PlaneGeometry(lw, lw * 0.19), 0, fy0 + fasciaH / 2, Z + 0.083), 0, false);
    const blade = makeNeonSign({ text: name, color: neon, height: 0.42, vertical: true, broken: opts.broken ?? P.broken, border: true, flicker: opts.flicker ?? true, seed });
    compose(g, k, blade, W / 2 - pil - 0.55, H + 0.15, Z + 0.06);
    if (P.icon) compose(g, k, makeNeonSign({ text: '', icon: P.icon, color: neon, height: 0.5, board: false }), -W / 2 + pil + 0.8, fy0 + 0.05, Z + 0.08);
  } else {
    const per = neonTextLines(name, 1).width + (P.icon ? 1.8 : 0);
    const hN = Math.min(fasciaH * 0.58, (W - 2 * pil - 0.8) / Math.max(per, 1));
    const sign = makeNeonSign({ text: name, color: neon, height: hN, icon: P.icon, iconColor: P.iconColor ?? neon, board: false, flicker: opts.flicker, tube: P.tube ? hN * 0.038 * P.tube : undefined, seed });
    compose(g, k, sign, 0, fy0 + (fasciaH - sign.userData.size.h) / 2, Z + 0.08);
  }
  // --- window neons
  spans.forEach(([a, b], i) => {
    const wn = P.win[i % P.win.length];
    if (!wn || b - a < 0.9) return;
    const s = makeNeonSign({ text: wn[0], color: wn[1], height: Math.min(0.2, (b - a - 0.4) / (neonTextLines(wn[0], 1).width + 0.3)), board: false, flicker: R() < 0.25, seed: seed + i, lightScale: 0.25 });
    compose(g, k, s, (a + b) / 2, winTop - 0.95, Z - 0.3);
  });
  return finalize(g, k);
}

// ================================================================ rooftop bits

function louverMat() {
  return paintMat('louvers', 128, 128, (c, w, h) => {
    c.fillStyle = '#8f8c82'; c.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) {
      const g = c.createLinearGradient(0, y, 0, y + 8);
      g.addColorStop(0, '#d0ccc0'); g.addColorStop(0.6, '#6a675f'); g.addColorStop(1, '#2a2926');
      c.fillStyle = g; c.fillRect(4, y, w - 8, 7);
    }
    grimeCanvas(c, w, h, TX.rng(12), 0.6);
  }, { roughness: 0.6, metalness: 0.4, repeat: true });
}

function fanGrilleMat() {
  return paintMat('fanGrille', 128, 128, (c, w, h) => {
    c.strokeStyle = '#1e1f21'; c.lineWidth = 3;
    for (let r = 10; r < 62; r += 8) { c.beginPath(); c.arc(64, 64, r, 0, TAU); c.stroke(); }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); c.stroke(); }
  }, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 });
}

/**
 * Rooftop AC condenser: louvred cabinet on steel rails, top fan grille with spinning blades
 * (child `fan`, update), refrigerant lines, disconnect box. ~1.2 x 1.05 x 0.9 m.
 * colliders: ledge on the lid (y = 1.0). opts.seed varies paint/size.
 */
export function makeAcUnit(opts = {}) {
  const R = TX.rng(opts.seed ?? 3);
  const w = 1.1 + R() * 0.2, h = 0.85, d = 0.8;
  const g = new THREE.Group(), k = new Kit();
  const body = solid(['#b8b6ac', '#a8aca6', '#c2bba8'][Math.floor(R() * 3)], 0.5, 0.45);
  const steel = mat('ironBlack'), dark = solid('#1b1c1e', 0.6, 0.5);
  for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) k.box(steel, w + 0.2, 0.1, 0.08, 0, 0.05, z, { uv: 1 });
  const y0 = 0.1;
  k.box(body, w, h, d, 0, y0 + h / 2, 0);
  k.box(dark, w + 0.02, 0.04, d + 0.02, 0, y0 + h, 0);
  k.add(louverMat(), xf(new THREE.PlaneGeometry(w - 0.12, h - 0.18), 0, y0 + h / 2 - 0.02, d / 2 + 0.003));
  k.add(louverMat(), xf(new THREE.PlaneGeometry(d - 0.12, h - 0.18), w / 2 + 0.003, y0 + h / 2 - 0.02, 0, 0, HP));
  k.add(streakMat('rust'), xf(new THREE.PlaneGeometry(w, h * 0.8), 0, y0 + h * 0.55, d / 2 + 0.006), 0, false);
  const top = y0 + h + 0.02;
  k.add(solid('#2a2b2d', 0.5, 0.6), xf(new THREE.TorusGeometry(0.34, 0.025, 6, 28), 0, top, 0, HP));
  k.add(fanGrilleMat(), xf(new THREE.CircleGeometry(0.34, 28), 0, top + 0.01, 0, -HP), 0, false);
  k.add(dark, xf(new THREE.CircleGeometry(0.33, 20), 0, top - 0.08, 0, -HP), 0, false);
  // refrigerant lines + disconnect box
  const cu = solid('#b06a3a', 0.35, 0.9);
  for (const dz of [-0.08, 0.06]) {
    const cv = new THREE.CatmullRomCurve3([v3(-w / 2, 0.35, dz), v3(-w / 2 - 0.2, 0.33, dz), v3(-w / 2 - 0.28, 0.15, dz), v3(-w / 2 - 0.3, 0.02, dz + 0.2)]);
    k.add(dz < 0 ? cu : dark, new THREE.TubeGeometry(cv, 10, dz < 0 ? 0.018 : 0.025, 6));
  }
  k.box(solid('#7a7e80', 0.4, 0.7), 0.04, 0.9, 0.04, -w / 2 - 0.45, 0.45, -0.25);
  k.box(solid('#8a8e90', 0.45, 0.6), 0.22, 0.3, 0.12, -w / 2 - 0.45, 0.85, -0.18);
  k.add(hazard(), xf(new THREE.PlaneGeometry(0.16, 0.05), -w / 2 - 0.45, 0.93, -0.119), 0, false);
  const fan = new THREE.Group();
  fan.name = 'fan';
  fan.position.set(0, top - 0.04, 0);
  const blades = [new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10)];
  for (let i = 0; i < 3; i++) blades.push(xf(new THREE.BoxGeometry(0.3, 0.01, 0.1), 0.16, 0, 0, 0.35, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY((i / 3) * TAU)).toNonIndexed());
  blades[0] = blades[0].toNonIndexed();
  addMesh(fan, mergeGeometries(blades.map(clean)), solid('#3a3c3e', 0.5, 0.6), 0, 0, 0, false);
  g.add(fan);
  const spd = 7 + R() * 5;
  finalize(g, k, (dt) => { fan.rotation.y += dt * spd; });
  g.userData.colliders = [{ type: 'ledge', x0: -w / 2, x1: w / 2, y: y0 + h }];
  return g;
}

/**
 * Roof ventilator: spinning "whirlybird" turbine (child `turbine`, update) on a duct, or
 * (opts.kind = 'hood') a mushroom exhaust hood. ~0.5 x 1.0 m. No colliders.
 */
export function makeRoofVent(opts = {}) {
  const R = TX.rng(opts.seed ?? 5);
  const kind = opts.kind ?? (R() < 0.6 ? 'turbine' : 'hood');
  const g = new THREE.Group(), k = new Kit();
  const galv = mat('galvanized');
  k.box(galv, 0.5, 0.36, 0.5, 0, 0.18, 0, { uv: 1 });
  k.box(solid('#2a2b2d', 0.6, 0.5), 0.56, 0.05, 0.56, 0, 0.025, 0);
  k.cyl(galv, 0.15, 0.17, 0.3, 0, 0.5, 0, { seg: 16, uv: 1 });
  if (kind === 'turbine') {
    const t = new THREE.Group();
    t.name = 'turbine';
    t.position.y = 0.82;
    const vane = solid('#a9afb3', 0.32, 0.9);
    const n = 18, parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      parts.push(xf(new THREE.BoxGeometry(0.075, 0.34, 0.012), Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0, -a + 0.5, 0.25));
    }
    parts.push(xf(new THREE.SphereGeometry(0.21, 16, 6, 0, TAU, 0, HP), 0, 0.15, 0), xf(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16), 0, -0.17, 0));
    addMesh(t, mergeGeometries(parts.map((p) => clean(p).toNonIndexed())), vane, 0, 0, 0, true);
    g.add(t);
    const spd = 2 + R() * 3;
    return finalize(g, k, (dt) => { t.rotation.y += dt * spd; });
  }
  k.cyl(galv, 0.15, 0.15, 0.25, 0, 0.75, 0, { seg: 16 });
  k.add(galv, xf(new THREE.SphereGeometry(0.34, 18, 6, 0, TAU, 0, HP * 0.7), 0, 0.82, 0));
  k.cyl(solid('#1a1b1c', 0.7), 0.3, 0.3, 0.06, 0, 0.86, 0, { seg: 18, open: true });
  return finalize(g, k);
}

/**
 * 1980s rooftop TV antenna: guyed mast on a tripod with VHF/UHF yagi arrays and a blinking
 * red warning lamp (update). ~4.5–6 m tall. No colliders.
 */
export function makeAntenna(opts = {}) {
  const R = TX.rng(opts.seed ?? 9);
  const H = opts.height ?? 4.5 + R() * 1.5;
  const g = new THREE.Group(), k = new Kit();
  const alu = solid('#9aa0a4', 0.35, 0.9), dark = solid('#202124', 0.6, 0.5);
  k.cyl(alu, 0.025, 0.035, H, 0, H / 2, 0, { seg: 8 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.3;
    k.bar(alu, v3(0, 1.2, 0), v3(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7), 0.015, 0.015, { round: true });
    k.bar(dark, v3(0, H * 0.82, 0), v3(Math.cos(a + 0.6) * 2.4, 0, Math.sin(a + 0.6) * 2.4), 0.004, 0.004, { round: true, seg: 3 });
  }
  const yagi = (y, len, n, sz, rot) => {
    const dx = Math.cos(rot), dz = Math.sin(rot);
    k.bar(alu, v3(-dx * len * 0.3, y, -dz * len * 0.3), v3(dx * len * 0.7, y, dz * len * 0.7), 0.012, 0.012, { round: true });
    for (let i = 0; i < n; i++) {
      const t = -0.3 + (i / (n - 1)) * 1.0, el = sz * (1 - i / (n * 1.6));
      const cx = dx * len * t, cz = dz * len * t;
      k.bar(alu, v3(cx + dz * el / 2, y, cz - dx * el / 2), v3(cx - dz * el / 2, y, cz + dx * el / 2), 0.006, 0.006, { round: true, seg: 4 });
    }
  };
  const rot = (R() - 0.5) * 0.8;
  yagi(H - 0.35, 1.8, 9, 1.4, rot);
  yagi(H - 1.1, 1.1, 7, 0.7, rot + 0.15);
  k.box(dark, 0.08, 0.12, 0.05, 0, H - 0.6, 0.04);
  const lamp = new THREE.MeshStandardMaterial({ color: '#300000', emissive: '#ff1a10', emissiveIntensity: 5, roughness: 0.4 });
  const bulb = addMesh(g, new THREE.SphereGeometry(0.045, 10, 6), lamp, 0, H + 0.05, 0, false);
  bulb.name = 'beacon';
  const ph = R() * 3;
  return finalize(g, k, (dt, t) => { lamp.emissiveIntensity = (t + ph) % 1.6 < 0.35 ? 6 : 0.15; });
}

// ================================================================ building

const BUILDING_WALLS = { brick: ['brickRed', 'brickDark', 'brickBrown', 'brickYellow'], stucco: ['stuccoBeige', 'stuccoPink', 'stuccoTeal', 'stuccoWhite'], panel: ['concrete', 'concreteDark'] };

/**
 * Mid-rise facade block (front at z = -1.2, ~10 m deep): extruded wall with real recessed
 * windows (shared lit/dark window atlas, frames, sills, lintels/keystones, grime streaks,
 * window AC units, boarded windows), style trim (brick quoins, stucco pilasters, precast
 * panel bands), belt course, dentilled cornice, downspout, sagging cables, tar roof with
 * parapets and rooftop clutter (AC units, vents, antenna, optional water tank, stair hut).
 * Ground floor (0..3.4 m): 'recess' (default) leaves a 1.3 m deep shopfront bay between
 * end piers so a level-placed makeStorefront({ width: width - 1 }) slots in; without one
 * it shows closed roll-down shutters. 'wall' = windows + entrance door; or pass
 * opts.storefront = kind to compose the shop here.
 * @param {object} opts
 * @param {number} [opts.width=10] @param {number} [opts.height=16] @param {number} [opts.floors=height/3.2]
 * @param {string} [opts.style='brick'] brick|stucco|panel @param {number} [opts.seed=1]
 * @param {string} [opts.ground='recess'] recess|wall @param {string} [opts.storefront] shop kind
 * @param {string} [opts.shopName] @param {string} [opts.neon] @param {number} [opts.lit=0.4] lit window ratio
 * @param {boolean} [opts.roof=true] rooftop clutter @param {boolean} [opts.waterTower]
 * @param {object} [opts.fireEscape] { x, floors, width } composes a fire escape (keeps its colliders/ladders)
 * colliders: rooftop ledge { x0:-w/2, x1:w/2, y: height } (top of the cornice cap).
 */
export function makeBuilding(opts = {}) {
  const W = opts.width ?? 10, H = opts.height ?? 16;
  const style = BUILDING_WALLS[opts.style] ? opts.style : 'brick';
  const floors = Math.max(1, opts.floors ?? Math.round(H / 3.2));
  const seed = opts.seed ?? 1;
  const R = TX.rng(seed * 7919 + 17);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const Z = -1.2, D = opts.depth ?? 10, slab = 0.32, fh = H / floors;
  const shopH = 3.4;
  const ground = opts.storefront ? 'shop' : opts.ground === 'wall' ? 'wall' : 'recess';
  const wallM = mat(opts.wall ?? pick(BUILDING_WALLS[style]));
  const mpt = style === 'brick' ? 1.4 : 2.5;
  const stone = style === 'stucco' ? mat('stuccoWhite') : style === 'panel' ? mat('concreteDark') : mat('concrete');
  const frameM = solid(pick(['#d8d2c4', '#1e2a22', '#2a1c16', '#14161a', '#5a1e18']), 0.5, 0.2);
  const g = new THREE.Group(), k = new Kit();
  const bays = opts.bays ?? Math.max(1, Math.round((W - 1.2) / 2.6));
  const edge = 0.6, bayW = (W - 2 * edge) / bays;
  const winW = THREE.MathUtils.clamp(bayW * 0.52, 0.8, 1.35), winH = Math.min(1.75, fh * 0.55);
  const yBase = ground === 'wall' ? 0 : shopH;
  const topY = H - 0.55;
  const lit = opts.lit ?? 0.4;
  const wm = windowMat(), atlas = wm.userData.atlas;
  const litCells = [], darkCells = [];
  atlas.cells.forEach((c, i) => (c.lit ? litCells : darkCells).push(i));

  // --- facade slab with window holes
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, yBase); shape.lineTo(W / 2, yBase); shape.lineTo(W / 2, topY); shape.lineTo(-W / 2, topY); shape.closePath();
  const wins = [];
  for (let f = 0; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      const cx = -W / 2 + edge + bayW * (b + 0.5);
      let x0 = cx - winW / 2, x1 = cx + winW / 2, y0 = f * fh + Math.min(0.85, fh * 0.27), y1 = y0 + winH, door = false;
      if (f === 0) {
        if (ground !== 'wall') continue;
        if (b === Math.floor(bays / 2)) { door = true; x0 = cx - 0.65; x1 = cx + 0.65; y0 = 0.02; y1 = 2.5; } else { y0 = 0.95; y1 = 2.35; }
      }
      if (y1 > topY - 0.25 || (!door && y0 < yBase + 0.35)) continue;
      const hole = new THREE.Path();
      hole.moveTo(x0, y0); hole.lineTo(x0, y1); hole.lineTo(x1, y1); hole.lineTo(x1, y0); hole.closePath();
      shape.holes.push(hole);
      wins.push({ x0, x1, y0, y1, cx, f, door });
    }
  }
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: slab, bevelEnabled: false, curveSegments: 1 });
  slabGeo.translate(0, 0, Z - slab);
  k.add(wallM, slabGeo, mpt);

  // --- windows
  const acBody = solid('#bdb8aa', 0.5, 0.4);
  for (const w of wins) {
    const ww = w.x1 - w.x0, wh = w.y1 - w.y0, gz = Z - 0.2;
    if (w.door) {
      k.box(solid('#3a2418', 0.5, 0.2), ww - 0.1, wh - 0.05, 0.06, w.cx, w.y0 + wh / 2, Z - 0.25);
      k.box(mat('concrete'), ww + 0.4, 0.08, 0.5, w.cx, 0.04, Z + 0.05, { uv: 1 });
      k.box(stone, ww + 0.5, 0.3, 0.14, w.cx, w.y1 + 0.15, Z + 0.04, { uv: 1 });
      k.add(emissiveMat('#ffd9a0', 3, '#ffffff'), xf(new THREE.SphereGeometry(0.06, 10, 6), w.cx, w.y1 + 0.42, Z + 0.1), 0, false);
      continue;
    }
    const boarded = w.f <= 2 && R() < 0.06;
    if (boarded) {
      k.box(mat('plywood'), ww + 0.1, wh + 0.1, 0.03, w.cx, w.y0 + wh / 2, Z + 0.015, { uv: 1.2 });
      if (R() < 0.7) tagDecal(k, Math.floor(R() * 8), ww * 0.9, ww * 0.9, w.cx, w.y0 + wh / 2, Z + 0.032);
    } else {
      const cell = R() < lit ? pick(litCells) : pick(darkCells);
      const cu = cell % atlas.cols, cr = Math.floor(cell / atlas.cols);
      k.add(wm, uvRect(xf(new THREE.PlaneGeometry(ww, wh), w.cx, w.y0 + wh / 2, gz), cu / atlas.cols, 1 - (cr + 1) / atlas.rows, (cu + 1) / atlas.cols, 1 - cr / atlas.rows), 0, false);
      k.box(frameM, ww, 0.05, 0.08, w.cx, w.y1 - 0.025, gz + 0.03);
      k.box(frameM, ww, 0.05, 0.08, w.cx, w.y0 + 0.025, gz + 0.03);
      k.box(frameM, 0.05, wh, 0.08, w.x0 + 0.025, w.y0 + wh / 2, gz + 0.03);
      k.box(frameM, 0.05, wh, 0.08, w.x1 - 0.025, w.y0 + wh / 2, gz + 0.03);
    }
    k.box(stone, ww + 0.2, 0.07, 0.24, w.cx, w.y0 - 0.035, Z + 0.04, { uv: 1 });
    if (style === 'brick') {
      k.box(stone, ww + 0.24, 0.2, 0.08, w.cx, w.y1 + 0.1, Z + 0.025, { uv: 1 });
      k.box(stone, 0.16, 0.27, 0.1, w.cx, w.y1 + 0.12, Z + 0.035, { uv: 1 });
    } else if (style === 'stucco') {
      k.box(stone, ww + 0.16, 0.08, 0.06, w.cx, w.y1 + 0.06, Z + 0.02, { uv: 1 });
    }
    k.add(streakMat('dark'), xf(new THREE.PlaneGeometry(ww + 0.1, 1.3), w.cx, w.y0 - 0.72, Z + 0.004), 0, false);
    if (!boarded && w.f >= 1 && R() < 0.13) {
      const ax = w.cx + (R() - 0.5) * Math.max(0, ww - 0.7);
      k.box(acBody, 0.62, 0.4, 0.5, ax, w.y0 + 0.24, Z + 0.03);
      k.add(louverMat(), xf(new THREE.PlaneGeometry(0.52, 0.3), ax, w.y0 + 0.24, Z + 0.281));
      k.box(solid('#2a2a2a', 0.6, 0.4), 0.04, 0.3, 0.04, ax - 0.25, w.y0 - 0.12, Z + 0.15, { rx: -0.6 });
    }
  }

  // --- style trim
  if (style === 'brick') {
    for (const s of [-1, 1]) for (let y = yBase, i = 0; y < topY - 0.28; y += 0.31, i++) {
      const bw = i % 2 ? 0.32 : 0.48;
      k.box(stone, bw, 0.26, 0.05, s * (W / 2 - bw / 2), y + 0.145, Z + 0.02, { uv: 1 });
    }
  } else if (style === 'stucco') {
    for (const s of [-1, 1]) k.box(stone, 0.42, topY - yBase, 0.08, s * (W / 2 - 0.21), (topY + yBase) / 2, Z + 0.035, { uv: 2 });
    for (let i = 0; i < 3; i++) k.box(stone, W - 0.9, 0.045, 0.04, 0, topY - 0.12 - i * 0.1, Z + 0.02);
  } else {
    for (let f = 1; f < floors; f++) k.box(stone, W, 0.26, 0.07, 0, f * fh + 0.13, Z + 0.035, { uv: 2 });
    for (let b = 0; b <= bays; b++) k.box(stone, 0.14, topY - yBase, 0.12, -W / 2 + edge + bayW * b, (topY + yBase) / 2, Z + 0.06, { uv: 2 });
  }

  // --- ground floor
  if (ground !== 'wall') {
    k.box(stone, W + 0.1, 0.22, 0.2, 0, shopH + 0.11, Z + 0.06, { uv: 1 });
    for (const s of [-1, 1]) {
      k.box(wallM, 0.5, shopH, 1.3, s * (W / 2 - 0.25), shopH / 2, Z - 0.65, { uv: mpt });
      k.box(mat('concreteDark'), 0.54, 0.35, 1.32, s * (W / 2 - 0.25), 0.175, Z - 0.65, { uv: 1 });
    }
    k.box(stone, W - 1, 0.14, 1.3, 0, shopH - 0.07, Z - 0.65, { uv: 1 });
    k.box(wallM, W - 1, shopH, 0.2, 0, shopH / 2, Z - 1.4, { uv: mpt });
    if (ground === 'recess') {
      const sh = new THREE.BoxGeometry(W - 1.4, 2.75, 0.05);
      xf(sh, 0, 1.375, Z - 1.27);
      worldUV(sh, 2.4, null, true);
      k.add(mat('shutterGrey'), sh);
      k.box(mat('steelGrey'), W - 1.2, 0.35, 0.3, 0, 2.95, Z - 1.18, { uv: 1 });
      for (let i = 0; i < Math.max(1, Math.floor(W / 5)); i++) tagDecal(k, Math.floor(R() * 8), 1.4, 1.4, -W / 2 + 1.5 + R() * (W - 3), 0.8 + R() * 1.2, Z - 1.24);
      posterDecal(k, Math.floor(R() * 8), 0.4, -W / 2 + 0.25, 1.7, Z + 0.005);
    } else {
      compose(g, k, makeStorefront({ kind: opts.storefront, name: opts.shopName, neon: opts.neon, width: W - 1, height: shopH, seed }), 0, 0, 0);
    }
  }

  // --- cornice
  k.box(stone, W, 0.28, 0.14, 0, topY + 0.14, Z + 0.05, { uv: 1 });
  if (style !== 'panel') {
    for (let x = -W / 2 + 0.14; x < W / 2 - 0.1; x += 0.24) k.box(stone, 0.1, 0.1, 0.1, x, topY + 0.33, Z + 0.1);
    for (let b = 0; b <= bays; b++) k.box(stone, 0.12, 0.3, 0.32, THREE.MathUtils.clamp(-W / 2 + edge + bayW * b, -W / 2 + 0.1, W / 2 - 0.1), topY + 0.22, Z + 0.17);
  }
  k.box(stone, W + 0.3, 0.16, 0.62, 0, H - 0.13, Z + 0.15, { uv: 1 });
  k.box(mat('concreteDark'), W + 0.36, 0.05, 0.68, 0, H - 0.025, Z + 0.15, { uv: 1 });

  // --- block, roof, parapets
  const zb0 = Z - slab, bd = D - slab;
  if (ground === 'wall') k.box(wallM, W, H - 0.3, bd, 0, (H - 0.3) / 2, zb0 - bd / 2, { uv: mpt });
  else {
    k.box(wallM, W, H - 0.3 - shopH, bd, 0, (H - 0.3 + shopH) / 2, zb0 - bd / 2, { uv: mpt });
    k.box(wallM, W, shopH, D - 1.5, 0, shopH / 2, Z - 1.5 - (D - 1.5) / 2, { uv: mpt });
  }
  k.box(mat('roofTar'), W - 0.1, 0.1, bd - 0.1, 0, H - 0.25, zb0 - bd / 2, { uv: 2 });
  for (const s of [-1, 1]) k.box(wallM, 0.25, 0.55, bd, s * (W / 2 - 0.125), H - 0.025, zb0 - bd / 2, { uv: mpt });
  k.box(wallM, W, 0.55, 0.25, 0, H - 0.025, Z - D + 0.125, { uv: mpt });
  for (const s of [-1, 1]) k.box(mat('concreteDark'), 0.3, 0.05, bd, s * (W / 2 - 0.125), H + 0.25, zb0 - bd / 2, { uv: 1 });

  // --- downspout + cables
  const galv = mat('galvanized'), dark = solid('#151515', 0.7, 0.2);
  const dsx = (R() < 0.5 ? -1 : 1) * (W / 2 - 0.32);
  k.cyl(galv, 0.055, 0.055, topY - 0.45, dsx, (topY + 0.15) / 2 + 0.05, Z + 0.09, { seg: 10, uv: 1 });
  k.box(galv, 0.24, 0.26, 0.22, dsx, topY - 0.18, Z + 0.1, { uv: 1 });
  k.cyl(galv, 0.055, 0.075, 0.32, dsx, 0.2, Z + 0.22, { rx: HP, seg: 10 });
  for (let y = 1.4; y < topY - 0.5; y += 2.4) k.box(dark, 0.15, 0.03, 0.15, dsx, y, Z + 0.07);
  k.add(streakMat('dark'), xf(new THREE.PlaneGeometry(0.5, Math.min(4, topY)), dsx, topY - Math.min(4, topY) / 2 - 0.2, Z + 0.005), 0, false);
  const cab = (ya, yb, sag, z) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(v3(-W / 2 - 0.05 + W * t + 0.1 * (0.5 - t), ya + (yb - ya) * t - sag * 4 * t * (1 - t), z)); }
    k.add(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.012, 4));
  };
  const cy = Math.min(topY - 1, yBase + fh * (0.85 + R() * 0.5));
  cab(cy, cy + (R() - 0.5) * 0.6, 0.3 + R() * 0.3, Z + 0.12);
  if (W > 8) cab(cy - 0.2, cy + 0.2, 0.55, Z + 0.15);
  for (const s of [-1, 1]) k.box(dark, 0.06, 0.12, 0.12, s * (W / 2 - 0.05), cy, Z + 0.08);

  // --- rooftop clutter (visual only: colliders are not forwarded)
  const deckY = H - 0.2;
  if (opts.roof !== false) {
    const slots = [];
    for (let x = -W / 2 + 1.3; x < W / 2 - 1.2; x += 1.7) slots.push(x);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    const take = () => slots.pop() ?? (R() - 0.5) * (W - 2.4);
    const zr = () => Z - 1.6 - R() * Math.max(0.5, D - 4);
    const nAc = 1 + Math.floor(R() * 2);
    for (let i = 0; i < nAc; i++) compose(g, k, makeAcUnit({ seed: seed * 3 + i }), take(), deckY, zr(), { colliders: false });
    const nV = 1 + Math.floor(R() * 2);
    for (let i = 0; i < nV; i++) compose(g, k, makeRoofVent({ seed: seed * 5 + i }), take(), deckY, zr(), { colliders: false });
    if (R() < 0.55) compose(g, k, makeAntenna({ seed: seed * 7 }), take(), deckY, Z - 2.5 - R() * 3, { colliders: false });
    if (opts.waterTower ?? (W >= 9 && R() < 0.3)) compose(g, k, makeWaterTower({ seed }), (R() - 0.5) * (W - 5), deckY, -2.6 - R() * 2, { colliders: false });
    else if (R() < 0.45) {
      const hx = (R() < 0.5 ? -1 : 1) * (W / 2 - 1.6);
      k.box(wallM, 2.2, 2.3, 2.2, hx, deckY + 1.15, Z - D + 2.0, { uv: mpt });
      k.box(mat('concreteDark'), 2.4, 0.08, 2.4, hx, deckY + 2.34, Z - D + 2.0, { uv: 1 });
      k.box(mat('steelGrey'), 0.9, 2.0, 0.05, hx, deckY + 1.0, Z - D + 3.11, { uv: 1 });
      k.add(emissiveMat('#ffd9a0', 2.5, '#ffffff'), xf(new THREE.SphereGeometry(0.05, 8, 5), hx, deckY + 2.12, Z - D + 3.15), 0, false);
    }
  }
  g.userData.colliders = [];
  if (opts.fireEscape) {
    const fe = opts.fireEscape === true ? {} : opts.fireEscape;
    compose(g, k, makeFireEscape({ floors: fe.floors ?? Math.max(1, Math.min(floors - 1, Math.floor((H - 1) / (fe.floorHeight ?? 3.2)))), width: fe.width ?? 6, floorHeight: fe.floorHeight ?? 3.2 }), fe.x ?? W / 4, 0, 0);
  }
  g.userData.colliders.push({ type: 'ledge', x0: -W / 2, x1: W / 2, y: H });
  g.userData.emitters = [...(g.userData.emitters || []), { type: 'drip', pos: v3(dsx, 0.15, Z + 0.38), rate: 2 }];
  return finalize(g, k);
}

// ================================================================ water tower

/**
 * Rooftop wooden water tank on a braced steel stand: tapered stave tank with steel hoops and
 * lugs, conical tar roof with finial, tank ladder, riser + overflow pipes, stencilled warning,
 * and a plank service deck that is cantilevered forward over the gameplay plane (z -4.3..+0.35)
 * with a pipe railing. Tank centre sits back at z = -2.4 so the legs stand on the roof.
 * @param {object} opts [opts.radius=1.55] [opts.tankHeight=3] [opts.legHeight=3.4] [opts.seed]
 * colliders: ledge on the deck { x0:-2.1, x1:2.1, y: legHeight }.
 * ladders: { x: 1.55, y0: 0, y1: legHeight } (through a deck hatch, z = -0.3).
 */
export function makeWaterTower(opts = {}) {
  const R0 = opts.radius ?? 1.55, tankH = opts.tankHeight ?? 3.0, legH = opts.legHeight ?? 3.4;
  const zc = -2.4, DW = 2.1, zFront = 0.35, zBack = zc - R0 - 0.35;
  const g = new THREE.Group(), k = new Kit();
  const steel = mat('ironBlack'), galv = mat('galvanized');
  const lx = R0 * 0.72;
  const legs = [[-lx, zc - lx], [lx, zc - lx], [-lx, zc + lx], [lx, zc + lx]];
  for (const [x, z] of legs) {
    k.box(steel, 0.17, legH, 0.17, x, legH / 2, z, { uv: 1 });
    k.box(steel, 0.34, 0.03, 0.34, x, 0.015, z);
  }
  for (const [a, b] of [[legs[0], legs[1]], [legs[2], legs[3]], [legs[0], legs[2]], [legs[1], legs[3]]]) {
    k.bar(steel, v3(a[0], 0.35, a[1]), v3(b[0], legH - 0.3, b[1]), 0.016, 0.016, { round: true });
    k.bar(steel, v3(a[0], legH - 0.3, a[1]), v3(b[0], 0.35, b[1]), 0.016, 0.016, { round: true });
    k.bar(steel, v3(a[0], 0.3, a[1]), v3(b[0], 0.3, b[1]), 0.07, 0.07);
  }
  // deck: beams, outriggers, knee braces, planks with ladder hatch, railing
  for (const z of [zc - lx, zc + lx]) k.box(steel, DW * 2, 0.2, 0.12, 0, legH - 0.16, z, { uv: 1 });
  for (const x of [-lx, lx]) {
    k.box(steel, 0.12, 0.2, zFront - zBack, x, legH - 0.16, (zFront + zBack) / 2, { uv: 1 });
    k.bar(steel, v3(x, legH - 1.2, zc + lx), v3(x, legH - 0.25, zFront - 0.1), 0.08, 0.08);
  }
  k.box(steel, DW * 2, 0.16, 0.1, 0, legH - 0.14, zFront - 0.05, { uv: 1 });
  const lad = 1.55;
  for (const [a, b, c, e] of rectsMinusHoles([-DW, DW, zBack, zFront], [[lad - 0.32, lad + 0.32, -0.6, -0.02]])) {
    k.add(mat('woodPlankFloor'), xf(new THREE.BoxGeometry(b - a, 0.06, e - c), (a + b) / 2, legH - 0.03, (c + e) / 2), 1.2);
  }
  const rail = (a, b) => k.bar(galv, a, b, 0.022, 0.022, { round: true, seg: 8 });
  for (const x of [-DW + 0.05, 0, DW - 0.05]) rail(v3(x, legH, zFront - 0.04), v3(x, legH + 1.0, zFront - 0.04));
  for (const y of [legH + 1.0, legH + 0.52]) {
    rail(v3(-DW, y, zFront - 0.04), v3(DW, y, zFront - 0.04));
    for (const s of [-1, 1]) rail(v3(s * (DW - 0.05), y, zFront - 0.04), v3(s * (DW - 0.05), y, zc));
  }
  for (const s of [-1, 1]) rail(v3(s * (DW - 0.05), legH, zc), v3(s * (DW - 0.05), legH + 1.0, zc));
  ladderParts(k, steel, lad, -0.3, 0, legH, 0.95);
  // tank on dunnage timbers
  for (let i = -2; i <= 2; i++) k.box(mat('woodDark'), R0 * 2, 0.2, 0.16, 0, legH + 0.1, zc + i * R0 * 0.38, { uv: 1 });
  const ty0 = legH + 0.2;
  const tank = new THREE.CylinderGeometry(R0 * 0.97, R0, tankH, 40, 1, true);
  const tu = tank.attributes.uv;
  for (let i = 0; i < tu.count; i++) tu.setXY(i, tu.getX(i) * ((TAU * R0) / 1.1), tu.getY(i) * (tankH / 1.6));
  k.add(mat('woodWeathered'), xf(tank, 0, ty0 + tankH / 2, zc));
  const hoopM = solid('#2a2624', 0.45, 0.8);
  for (const t of [0.05, 0.14, 0.24, 0.36, 0.5, 0.66, 0.84]) {
    const y = ty0 + tankH * t, r = R0 * (1 - 0.03 * t) + 0.012;
    k.add(hoopM, xf(new THREE.TorusGeometry(r, 0.016, 4, 44), 0, y, zc, HP));
    k.box(hoopM, 0.1, 0.05, 0.05, (t * 7 % 2 > 1 ? 0.35 : -0.35), y, zc + r + 0.02);
  }
  const stencil = paintMat('tankStencil', 512, 128, (c, w, h) => {
    c.fillStyle = 'rgba(235,230,215,0.75)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 64px Impact, "Arial Black", sans-serif';
    c.fillText('NO TRESPASSING', w / 2, h / 2);
    c.globalCompositeOperation = 'destination-out';
    const RR = TX.rng(31);
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${RR()})`; c.fillRect(RR() * w, RR() * h, 2 + RR() * 6, 2 + RR() * 4); }
  }, { ...DECAL, roughness: 0.8 });
  k.add(stencil, xf(new THREE.CylinderGeometry(R0 * 0.99 + 0.004, R0 * 0.99 + 0.004, 0.5, 14, 1, true, -0.62, 1.24), 0, ty0 + tankH * 0.58, zc), 0, false);
  const roofM = mat('roofTar');
  k.add(roofM, xf(new THREE.ConeGeometry(R0 + 0.16, 1.0, 40, 1, true), 0, ty0 + tankH + 0.5, zc), 2);
  k.add(hoopM, xf(new THREE.TorusGeometry(R0 * 0.97 + 0.03, 0.03, 4, 44), 0, ty0 + tankH, zc, HP));
  k.cyl(galv, 0.02, 0.02, 0.4, 0, ty0 + tankH + 1.1, zc, { seg: 6 });
  k.add(galv, xf(new THREE.SphereGeometry(0.07, 10, 6), 0, ty0 + tankH + 1.32, zc));
  k.box(mat('woodDark'), 0.5, 0.06, 0.45, 0.45, ty0 + tankH + 0.52, zc + R0 * 0.55, { rx: 0.45, uv: 1 });
  ladderParts(k, steel, 0.55, zc + R0 + 0.12, legH + 0.05, ty0 + tankH + 0.1, 0.55, 0.4);
  k.cyl(galv, 0.1, 0.1, legH + 0.2, 0, (legH + 0.2) / 2, zc, { seg: 12, uv: 1 });
  const of = new THREE.CatmullRomCurve3([v3(-R0 * 0.7, ty0 + tankH * 0.9, zc + R0 * 0.72), v3(-R0 * 0.78, ty0 + tankH * 0.9, zc + R0 * 0.8), v3(-R0 * 0.82, ty0, zc + R0 * 0.85), v3(-R0 * 0.82, 0.05, zc + R0 * 0.85)]);
  k.add(galv, new THREE.TubeGeometry(of, 20, 0.04, 6));
  k.add(streakMat('dark'), xf(new THREE.CylinderGeometry(R0 + 0.003, R0 + 0.003, tankH * 0.7, 20, 1, true, -1.1, 2.2), 0, ty0 + tankH * 0.62, zc), 0, false);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -DW, x1: DW, y: legH }];
  g.userData.ladders = [{ x: lad, y0: 0, y1: legH, z: -0.3, w: 0.44 }];
  g.userData.emitters = [{ type: 'drip', pos: v3(-R0 * 0.82, 0.1, zc + R0 * 0.85), rate: 1.5 }];
  return g;
}

// ================================================================ billboard

function paintBillboard(c, w, h, art, text, R) {
  const outlineText = (t, x, y, px, fill, stroke, depth = 0, font = 'Impact, "Arial Black", sans-serif', italic = true) => {
    c.save();
    c.font = `${italic ? 'italic ' : ''}900 ${px}px ${font}`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    for (let d = depth; d > 0; d--) { c.fillStyle = stroke; c.fillText(t, x + d, y + d); }
    c.lineWidth = px * 0.12; c.strokeStyle = stroke; c.strokeText(t, x, y);
    c.fillStyle = fill; c.fillText(t, x, y);
    c.restore();
  };
  if (art === 'cola') {
    const cx = w * 0.27, cy = h * 0.6;
    const bg = c.createRadialGradient(cx, cy, 10, cx, cy, w * 0.85);
    bg.addColorStop(0, '#ffd23a'); bg.addColorStop(0.3, '#ff5a1a'); bg.addColorStop(1, '#7a0812');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 28; i += 2) {
      const a0 = (i / 28) * TAU, a1 = ((i + 1) / 28) * TAU;
      c.fillStyle = 'rgba(255,230,120,0.13)';
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * w, cy + Math.sin(a0) * w); c.lineTo(cx + Math.cos(a1) * w, cy + Math.sin(a1) * w); c.fill();
    }
    for (let i = 0; i < 26; i++) {
      const fx = (i / 26) * w, fh = h * (0.18 + R() * 0.22);
      const fg = c.createLinearGradient(0, h, 0, h - fh);
      fg.addColorStop(0, '#ffe25a'); fg.addColorStop(0.5, '#ff7a1a'); fg.addColorStop(1, 'rgba(200,20,10,0)');
      c.fillStyle = fg;
      c.beginPath(); c.moveTo(fx - 30, h); c.quadraticCurveTo(fx - 18, h - fh * 0.5, fx + (R() - 0.5) * 20, h - fh); c.quadraticCurveTo(fx + 20, h - fh * 0.4, fx + 34, h); c.fill();
    }
    c.save();
    c.translate(cx, cy); c.rotate(-0.22);
    const bh = h * 0.78, bw = bh * 0.26;
    const bottle = () => {
      c.beginPath();
      c.moveTo(-bw * 0.18, -bh * 0.5); c.lineTo(bw * 0.18, -bh * 0.5);
      c.bezierCurveTo(bw * 0.2, -bh * 0.25, bw * 0.55, -bh * 0.2, bw * 0.5, 0);
      c.bezierCurveTo(bw * 0.42, bh * 0.15, bw * 0.55, bh * 0.3, bw * 0.5, bh * 0.5);
      c.lineTo(-bw * 0.5, bh * 0.5);
      c.bezierCurveTo(-bw * 0.55, bh * 0.3, -bw * 0.42, bh * 0.15, -bw * 0.5, 0);
      c.bezierCurveTo(-bw * 0.55, -bh * 0.2, -bw * 0.2, -bh * 0.25, -bw * 0.18, -bh * 0.5);
      c.closePath();
    };
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 20; c.shadowOffsetX = 12;
    const bg2 = c.createLinearGradient(-bw / 2, 0, bw / 2, 0);
    bg2.addColorStop(0, '#1a0804'); bg2.addColorStop(0.35, '#5a1e0c'); bg2.addColorStop(0.5, '#8a3a1a'); bg2.addColorStop(1, '#1a0804');
    c.fillStyle = bg2; bottle(); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#f2ead8'; c.fillRect(-bw * 0.52, -bh * 0.02, bw * 1.04, bh * 0.2);
    c.fillStyle = '#c81414'; c.font = `italic 900 ${bw * 0.28}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Blaze', 0, bh * 0.08);
    c.fillStyle = '#c8c8c8'; c.fillRect(-bw * 0.2, -bh * 0.53, bw * 0.4, bh * 0.05);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(-bw * 0.32, -bh * 0.3, bw * 0.08, bh * 0.7);
    for (let i = 0; i < 26; i++) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse((R() - 0.5) * bw * 0.8, (R() - 0.2) * bh * 0.7, 2 + R() * 3, 3 + R() * 5, 0, 0, TAU); c.fill(); }
    c.restore();
    outlineText(text || 'TASTE THE HEAT', w * 0.68, h * 0.36, Math.min(h * 0.24, (w * 0.6) / Math.max(6, (text || 'TASTE THE HEAT').length * 0.52)), '#ffe14a', '#5a0408', 8);
    outlineText('BLAZE COLA', w * 0.68, h * 0.62, h * 0.13, '#ffffff', '#7a0812', 4, 'Georgia, serif');
    c.fillStyle = '#ffffff'; c.font = '700 22px Arial'; c.textAlign = 'center'; c.fillText('ICE COLD • 25¢ AT FINER STORES', w * 0.68, h * 0.78);
  } else if (art === 'cop') {
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#05051a'); bg.addColorStop(0.55, '#3a0a4a'); bg.addColorStop(0.8, '#ff3a6a'); bg.addColorStop(1, '#ff9a4a');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(180,220,255,0.08)'; c.beginPath(); c.moveTo(w * (0.5 + i * 0.15), h); c.lineTo(w * (0.3 + i * 0.25), 0); c.lineTo(w * (0.38 + i * 0.25), 0); c.fill(); }
    c.fillStyle = '#05040a';
    let x = 0;
    while (x < w) { const bw2 = 30 + R() * 70, bh2 = h * (0.12 + R() * 0.3); c.fillRect(x, h - bh2, bw2, bh2); for (let j = 0; j < 8; j++) if (R() < 0.5) { c.fillStyle = '#ffd27a'; c.fillRect(x + 4 + R() * (bw2 - 10), h - bh2 + 6 + R() * (bh2 - 12), 4, 5); c.fillStyle = '#05040a'; } x += bw2 + 4; }
    c.save();
    c.translate(w * 0.2, h);
    c.fillStyle = '#0a0a12';
    c.beginPath(); c.moveTo(-w * 0.16, 0); c.quadraticCurveTo(-w * 0.15, -h * 0.42, 0, -h * 0.46); c.quadraticCurveTo(w * 0.15, -h * 0.42, w * 0.16, 0); c.fill();
    c.beginPath(); c.ellipse(0, -h * 0.62, h * 0.12, h * 0.15, 0, 0, TAU); c.fill();
    c.fillStyle = '#ff9ad0'; c.fillRect(-h * 0.1, -h * 0.66, h * 0.2, h * 0.035);
    c.fillStyle = '#ffffff'; c.fillRect(h * 0.02, -h * 0.66, h * 0.04, h * 0.012);
    c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(-w * 0.06, -h * 0.3, h * 0.03, 0, TAU); c.fill();
    c.restore();
    const tg = c.createLinearGradient(0, h * 0.18, 0, h * 0.5);
    tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.5, '#8ab0e8'); tg.addColorStop(0.52, '#1a2a6a'); tg.addColorStop(1, '#c8e0ff');
    outlineText(text || 'NIGHT BEAT', w * 0.64, h * 0.34, Math.min(h * 0.26, (w * 0.58) / Math.max(5, (text || 'NIGHT BEAT').length * 0.55)), tg, '#05051a', 6);
    outlineText('TUESDAYS 9PM • CHANNEL 7', w * 0.64, h * 0.6, h * 0.075, '#ffd24a', '#05051a', 2, 'Arial Black, Arial, sans-serif', false);
    outlineText('THE STREETS NEVER SLEEP', w * 0.64, h * 0.72, h * 0.05, '#ffffff', '#05051a', 0, 'Arial', false);
  } else {
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a0018'); bg.addColorStop(0.55, '#2a0638'); bg.addColorStop(0.62, '#000000');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const hy = h * 0.6;
    const sg = c.createLinearGradient(0, hy - h * 0.35, 0, hy);
    sg.addColorStop(0, '#ffe14a'); sg.addColorStop(1, '#ff2a8a');
    c.save(); c.beginPath(); c.arc(w * 0.5, hy, h * 0.33, PI, 0); c.clip();
    c.fillStyle = sg; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2a0638';
    for (let i = 0; i < 6; i++) c.fillRect(0, hy - h * 0.05 - i * h * 0.045, w, 3 + i * 1.5);
    c.restore();
    c.strokeStyle = '#ff2ad0'; c.lineWidth = 2;
    for (let i = -14; i <= 14; i++) { c.beginPath(); c.moveTo(w / 2 + i * 8, hy); c.lineTo(w / 2 + i * 90, h); c.stroke(); }
    for (let j = 0; j < 9; j++) { const y = hy + (h - hy) * Math.pow(j / 8, 1.8); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.lineWidth = 3;
    for (const [col, a] of [['#ff2a2a', -0.25], ['#3aff6a', 0.18], ['#2af5ff', -0.08]]) {
      c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 14;
      c.beginPath(); c.moveTo(0, h * (0.2 + R() * 0.5)); c.lineTo(w, h * (0.2 + R() * 0.5) + a * w * 0.2); c.stroke();
    }
    c.shadowBlur = 0;
    c.strokeStyle = '#2af5ff'; c.lineWidth = 5; c.shadowColor = '#2af5ff'; c.shadowBlur = 20;
    c.beginPath(); c.moveTo(w * 0.12, h * 0.55); c.lineTo(w * 0.2, h * 0.15); c.lineTo(w * 0.28, h * 0.55); c.closePath(); c.stroke();
    c.shadowBlur = 0;
    const t = text || 'LAZER TAG';
    c.save();
    c.font = `italic 900 ${Math.min(h * 0.26, (w * 0.6) / Math.max(5, t.length * 0.55))}px Impact, "Arial Black", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = '#ff2a8a'; c.shadowColor = '#ff2a8a'; c.shadowBlur = 24;
    c.strokeText(t, w * 0.6, h * 0.3);
    c.shadowBlur = 0; c.fillStyle = '#ffffff'; c.fillText(t, w * 0.6, h * 0.3);
    c.restore();
    outlineText('THE FUTURE IS NOW', w * 0.6, h * 0.5, h * 0.07, '#2af5ff', '#0a0018', 0, 'Arial Black, Arial, sans-serif', false);
    outlineText('OPEN TIL MIDNITE', w * 0.85, h * 0.9, h * 0.06, '#ffe14a', '#0a0018', 0, 'Arial Black, Arial, sans-serif', false);
  }
  // paper seams, torn sheets, grime
  for (let i = 1; i < 8; i++) { c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect((w * i) / 8 + (R() - 0.5) * 4, 0, 2, h); }
  for (let i = 0; i < 3; i++) {
    const tx = R() < 0.5 ? R() * w * 0.12 : w * (0.86 + R() * 0.1), ty = h * (0.05 + R() * 0.75), tw = 24 + R() * 40, th = 20 + R() * 36;
    c.fillStyle = 'rgba(220,210,190,0.85)';
    c.beginPath(); c.moveTo(tx, ty);
    for (let s = 0; s <= 8; s++) c.lineTo(tx + (tw * s) / 8, ty + R() * 10);
    for (let s = 0; s <= 8; s++) c.lineTo(tx + tw - R() * 10, ty + (th * s) / 8);
    c.lineTo(tx, ty + th); c.closePath(); c.fill();
  }
  for (let i = 0; i < 70; i++) {
    const x = R() * w, len = h * (0.1 + R() * 0.5);
    const gg = c.createLinearGradient(0, 0, 0, len);
    gg.addColorStop(0, `rgba(10,8,6,${0.1 + R() * 0.25})`); gg.addColorStop(1, 'rgba(10,8,6,0)');
    c.fillStyle = gg; c.fillRect(x, 0, 2 + R() * 8, len);
  }
}

/**
 * Rooftop billboard: painted 80s ad (fake brands only) on a framed panel, steel I-beam posts
 * with kickers back onto the roof, grated catwalk across the front with railing, ladder at
 * the left end through a hatch, and gooseneck flood lamps throwing soft beams up the art.
 * @param {object} opts
 * @param {string} [opts.art] cola | cop | lazer (default by seed) @param {string} [opts.text] headline
 * @param {number} [opts.width=9] @param {number} [opts.panelHeight=3.6] @param {number} [opts.catwalkY=2.4]
 * colliders: catwalk ledge { x0:-w/2, x1:w/2, y: catwalkY }. ladders: { x: -w/2+0.5, y0: 0, y1: catwalkY }.
 * lights: one warm flood per lamp. Panel face at z = -0.75, catwalk z -0.73..+0.47.
 */
export function makeBillboard(opts = {}) {
  const W = opts.width ?? 9, PH = opts.panelHeight ?? 3.6, cy = opts.catwalkY ?? 2.4;
  const R = TX.rng(opts.seed ?? 3);
  const art = opts.art ?? ['cola', 'cop', 'lazer'][Math.floor(R() * 3)];
  const pz = -0.75, pb = cy + 0.45, zf = 0.47;
  const g = new THREE.Group(), k = new Kit();
  const steel = mat('steelPainted'), iron = mat('ironBlack'), grate = grating('#2a2c30');
  const posts = W > 7 ? [-W / 2 + 1, 0, W / 2 - 1] : [-W / 2 + 0.8, W / 2 - 0.8];
  const zp = pz - 0.38, top = pb + PH - 0.1;
  for (const x of posts) {
    for (const dz of [-0.1, 0.1]) k.box(steel, 0.22, top, 0.025, x, top / 2, zp + dz, { uv: 1 });
    k.box(steel, 0.025, top, 0.2, x, top / 2, zp, { uv: 1 });
    k.box(steel, 0.4, 0.03, 0.4, x, 0.015, zp);
    k.bar(steel, v3(x, cy + 1.1, zp - 0.1), v3(x, 0.06, zp - 3.0), 0.12, 0.12, { uv: 1 });
    k.box(steel, 0.3, 0.03, 0.3, x, 0.015, zp - 3.0);
    k.bar(iron, v3(x, cy - 0.75, zp + 0.1), v3(x, cy - 0.05, zf - 0.08), 0.06, 0.02);
  }
  for (const yy of [pb + 0.35, pb + PH / 2, pb + PH - 0.35]) k.box(steel, W - 0.2, 0.12, 0.08, 0, yy, pz - 0.13, { uv: 1 });
  // panel + art + frame + apron
  k.box(steel, W, PH, 0.06, 0, pb + PH / 2, pz - 0.03, { uv: 1 });
  const artM = cmat(`billboard-${art}-${opts.text ?? ''}`, () => {
    const t = TX.painted(`billboard-${art}-${opts.text ?? ''}`, 1024, 410, (c, w, h) => paintBillboard(c, w, h, art, opts.text, TX.rng(art.length * 97 + (opts.text ?? '').length)));
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.1, roughness: 0.8 });
  });
  k.add(artM, xf(new THREE.PlaneGeometry(W - 0.16, PH - 0.16), 0, pb + PH / 2, pz + 0.002), 0, false);
  const frame = solid(R() < 0.5 ? '#e8e2d2' : '#1d3a2a', 0.5, 0.3);
  k.box(frame, W + 0.08, 0.12, 0.12, 0, pb + PH, pz);
  k.box(frame, W + 0.08, 0.12, 0.12, 0, pb, pz);
  for (const s of [-1, 1]) k.box(frame, 0.12, PH, 0.12, s * (W / 2), pb + PH / 2, pz);
  const plate = paintMat('billboardPlate', 256, 32, (c, w, h) => { c.fillStyle = '#e8e2d2'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d3a2a'; c.font = '900 20px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('METRO OUTDOOR', w / 2, h / 2); }, { roughness: 0.6 });
  k.add(plate, xf(new THREE.PlaneGeometry(1.1, 0.14), 0, pb - 0.13, pz + 0.065), 0, false);
  // catwalk
  const lad = -W / 2 + 0.5;
  for (const [a, b, c2, e] of rectsMinusHoles([-W / 2, W / 2, pz + 0.02, zf], [[lad - 0.32, lad + 0.32, -0.58, -0.02]])) {
    k.add(grate, xf(new THREE.PlaneGeometry(b - a, e - c2), (a + b) / 2, cy, (c2 + e) / 2, -HP), 0.7);
  }
  k.box(iron, W, 0.1, 0.05, 0, cy - 0.05, zf - 0.025, { uv: 1 });
  k.box(iron, W, 0.1, 0.05, 0, cy - 0.05, pz + 0.04, { uv: 1 });
  for (const s of [-1, 1]) k.box(iron, 0.05, 0.1, zf - pz, s * W / 2, cy - 0.05, (zf + pz) / 2);
  const np = Math.max(2, Math.round(W / 1.5));
  for (let i = 0; i <= np; i++) k.box(iron, 0.045, 1.0, 0.045, -W / 2 + (W * i) / np, cy + 0.5, zf);
  k.bar(iron, v3(-W / 2, cy + 1.0, zf), v3(W / 2, cy + 1.0, zf), 0.022, 0.022, { round: true, seg: 8 });
  k.bar(iron, v3(-W / 2, cy + 0.5, zf), v3(W / 2, cy + 0.5, zf), 0.016, 0.016, { round: true, seg: 6 });
  for (const s of [-1, 1]) k.bar(iron, v3(s * W / 2, cy + 1.0, zf), v3(s * W / 2, cy + 1.0, pz + 0.05), 0.02, 0.02, { round: true, seg: 6 });
  ladderParts(k, iron, lad, -0.3, 0, cy, 0.95);
  // flood lamps
  const lights = [];
  const nl = Math.max(2, Math.round(W / 3));
  const lampM = emissiveMat('#fff1d0', 3, '#ffffff');
  const housing = solid('#2a2c2e', 0.45, 0.7);
  const beam = beamMat('#ffe6b8', 0.045);
  for (let i = 0; i < nl; i++) {
    const x = -W / 2 + (W * (i + 0.5)) / nl;
    const lp = v3(x, cy + 1.3, zf + 0.5);
    k.bar(iron, v3(x, cy + 1.0, zf), lp, 0.018, 0.018, { round: true });
    const tgt = v3(x, pb + PH * 0.55, pz);
    const dir = tgt.clone().sub(lp).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    const hg = new THREE.CylinderGeometry(0.16, 0.11, 0.24, 14);
    hg.applyQuaternion(q); hg.translate(lp.x, lp.y, lp.z);
    k.add(housing, hg);
    const lens = new THREE.CircleGeometry(0.14, 14);
    lens.rotateX(-HP); lens.translate(0, 0.121, 0); lens.applyQuaternion(q); lens.translate(lp.x, lp.y, lp.z);
    k.add(lampM, lens, 0, false);
    const len = lp.distanceTo(tgt) + 0.4;
    const bg = new THREE.CylinderGeometry(1.5, 0.13, len, 20, 1, true);
    bg.translate(0, len / 2, 0); bg.applyQuaternion(q); bg.translate(lp.x, lp.y, lp.z);
    const bu = bg.attributes.uv;
    for (let j = 0; j < bu.count; j++) bu.setY(j, 1 - bu.getY(j));
    k.add(beam, bg, 0, false);
    lights.push({ pos: v3(x, cy + 1.6, zf + 1.4), color: '#ffe6b8', intensity: 9, distance: 7 });
  }
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2, x1: W / 2, y: cy }];
  g.userData.ladders = [{ x: lad, y0: 0, y1: cy, z: -0.3, w: 0.44 }];
  g.userData.lights = lights;
  return g;
}

// ================================================================ street furniture

// Stencilled label / sticker sheet (8 cells, 4 x 2) for small props.
const LABELS = ['CITY SANITATION', 'NO PARKING', 'DANGER', 'FRAGILE', 'THIS SIDE UP', 'HANDLE WITH CARE', 'FLAMMABLE', 'KEEP OUT'];
function labelAtlasMat() {
  return paintMat('labelAtlas', 1024, 256, (c) => {
    const R = TX.rng(77);
    LABELS.forEach((t, i) => {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
      c.save();
      c.translate(x + 128, y + 64);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (t === 'DANGER' || t === 'FLAMMABLE' || t === 'KEEP OUT') {
        c.fillStyle = t === 'FLAMMABLE' ? '#d82a1a' : '#f2efe6'; c.fillRect(-118, -54, 236, 108);
        c.fillStyle = t === 'FLAMMABLE' ? '#f2efe6' : '#c81e1e';
        if (t === 'DANGER') { c.beginPath(); c.ellipse(0, -26, 80, 22, 0, 0, TAU); c.fill(); c.fillStyle = '#fff'; }
        c.font = '900 34px Arial Black, Arial'; c.fillText(t, 0, -26);
        c.fillStyle = '#111'; c.font = '700 22px Arial';
        c.fillText(t === 'DANGER' ? 'HIGH VOLTAGE' : t === 'FLAMMABLE' ? '' : 'NO TRESPASSING', 0, 22);
      } else {
        c.fillStyle = 'rgba(240,236,224,0.9)';
        c.font = `900 ${t.length > 12 ? 26 : 38}px "Courier New", monospace`;
        c.fillText(t, 0, t === 'THIS SIDE UP' ? 10 : 0);
        if (t === 'THIS SIDE UP') { c.fillRect(-4, -50, 8, 26); c.beginPath(); c.moveTo(-16, -34); c.lineTo(0, -56); c.lineTo(16, -34); c.fill(); }
        c.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(0,0,0,${R()})`; c.fillRect(-120 + R() * 240, -50 + R() * 100, 2 + R() * 5, 2 + R() * 3); }
      }
      c.restore();
    });
  }, { ...DECAL, roughness: 0.6 });
}
function labelDecal(k, i, w, x, y, z, ry = 0, rz = 0) {
  const r = Math.floor(i / 4), cI = i % 4;
  k.add(labelAtlasMat(), uvRect(xf(new THREE.PlaneGeometry(w, w / 2), x, y, z, 0, ry, rz), cI / 4, 1 - (r + 1) / 2, (cI + 1) / 4, 1 - r / 2), 0, false);
}

function trashBag(k, x, y, z, s = 1, R = Math.random) {
  const bag = cmat('trashBag', () => new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.28, metalness: 0.1 }));
  const geo = new THREE.SphereGeometry(0.32 * s, 12, 9);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i), f = 1 + 0.08 * Math.sin(p.getX(i) * 19 + p.getZ(i) * 13) + (yy > 0.2 * s ? -0.15 : 0);
    p.setXYZ(i, p.getX(i) * f, yy < -0.15 * s ? -0.15 * s : yy * 0.85, p.getZ(i) * f);
  }
  geo.computeVertexNormals();
  k.add(bag, xf(geo, x, y + 0.13 * s, z, 0, R() * TAU, 0));
  k.add(bag, xf(new THREE.ConeGeometry(0.06 * s, 0.14 * s, 6), x, y + 0.36 * s, z));
}

/**
 * Steel front-load dumpster (sloped front, forklift pockets, casters) with two plastic lids
 * (one propped open on a bulging trash bag), stencils, tag, rust and bags on the ground.
 * ~1.9 x 1.3 x 1.25 m. colliders: ledge on the lids { x0:-0.95, x1:0.95, y: 1.27 }.
 */
export function makeDumpster(opts = {}) {
  const R = TX.rng(opts.seed ?? 21);
  const L = 1.9, H = 1.18, D = 1.15, y0 = 0.12;
  const g = new THREE.Group(), k = new Kit();
  const paint = mat(opts.color === 'blue' ? 'steelBlue' : R() < 0.6 ? 'steelGreen' : 'steelBlue');
  const dark = solid('#121314', 0.6, 0.5);
  const sh = new THREE.Shape();
  sh.moveTo(-D / 2, y0); sh.lineTo(D / 2 - 0.28, y0); sh.lineTo(D / 2, H); sh.lineTo(-D / 2, H); sh.closePath();
  const body = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 1 });
  body.rotateY(-HP);
  body.translate(L / 2, 0, 0);
  k.add(paint, body, 1);
  const slope = Math.atan2(0.28, H - y0);
  for (const x of [-0.55, 0, 0.55]) k.box(paint, 0.08, H - y0 + 0.02, 0.05, x, (H + y0) / 2, D / 2 - 0.14 + 0.03, { rx: -slope, uv: 1 });
  k.box(paint, L + 0.08, 0.07, 0.08, 0, H - 0.02, D / 2 + 0.01, { uv: 1 });
  for (const s of [-1, 1]) {
    k.box(dark, 0.08, 0.16, D * 0.85, s * (L / 2 + 0.06), 0.62, -0.05);
    k.box(dark, 0.09, 0.05, D * 0.85, s * (L / 2 + 0.06), 0.62, -0.05);
  }
  for (const [x, z] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.25], [0.75, 0.25]]) {
    k.box(dark, 0.08, 0.06, 0.08, x, y0 - 0.02, z);
    k.cyl(solid('#2a2a2a', 0.8), 0.055, 0.055, 0.04, x, 0.055, z + 0.03, { rz: HP, seg: 10 });
  }
  // lids: one shut, one propped open on a bag
  const lid = solid('#18191b', 0.4, 0.05);
  const lw = L / 2 - 0.03;
  k.box(lid, lw, 0.06, D + 0.12, -L / 4, H + 0.05, 0, { rx: 0.06 });
  k.box(lid, lw, 0.06, D + 0.12, L / 4, H + 0.05 + 0.3, -0.12, { rx: 0.48 });
  trashBag(k, L / 4, H - 0.25, 0.1, 0.95, R);
  for (const x of [-L / 4, L / 4]) k.box(dark, 0.18, 0.03, 0.05, x, H + 0.08, D / 2 + 0.06);
  labelDecal(k, 0, 0.8, -0.45, 0.78, D / 2 - 0.14 + 0.06, 0, 0);
  labelDecal(k, 1, 0.6, 0.45, 0.5, D / 2 - 0.2 + 0.06, 0, 0);
  k.add(streakMat('rust'), xf(new THREE.PlaneGeometry(L - 0.1, 0.9), 0, 0.7, D / 2 - 0.14 + 0.065, -slope), 0, false);
  tagDecal(k, Math.floor(R() * 8), 0.9, 0.9, 0.2, 0.62, D / 2 - 0.14 + 0.07, -0.05);
  if (opts.bags !== false) {
    trashBag(k, L / 2 + 0.35, 0, 0.25, 0.9, R);
    trashBag(k, L / 2 + 0.55, 0, -0.2, 0.75, R);
    k.box(solid('#7a5a3a', 0.9), 0.5, 0.36, 0.4, -L / 2 - 0.35, 0.18, 0.2, { ry: 0.4 });
  }
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -L / 2, x1: L / 2, y: H + 0.09 }];
  return g;
}

/**
 * Ribbed galvanised trash can with dented lid (opts.lid: 'on' | 'off'), handles and a bit of
 * overflow. ~0.6 x 0.9 m. colliders: ledge on the lid { x0:-0.3, x1:0.3, y: 0.92 }.
 */
export function makeTrashCan(opts = {}) {
  const R = TX.rng(opts.seed ?? 4);
  const g = new THREE.Group(), k = new Kit();
  const galv = mat('galvanized');
  const prof = [v2(0.001, 0.02), v2(0.24, 0.02), v2(0.25, 0.05)];
  for (let i = 0; i <= 16; i++) { const y = 0.06 + i * 0.048; prof.push(v2(0.25 + (i / 16) * 0.035 + (i % 4 === 2 ? 0.012 : 0), y)); }
  prof.push(v2(0.29, 0.86), v2(0.3, 0.87));
  const can = new THREE.LatheGeometry(prof, 22);
  k.add(galv, can, 0.8);
  for (const s of [-1, 1]) k.add(galv, xf(new THREE.TorusGeometry(0.06, 0.01, 4, 10, PI), s * 0.3, 0.7, 0, 0, s * HP, 0));
  if (opts.lid !== 'off' && R() < 0.85) {
    const lp = [v2(0.001, 0.07), v2(0.12, 0.065), v2(0.25, 0.035), v2(0.305, 0.01), v2(0.31, -0.02)];
    const lidG = new THREE.LatheGeometry(lp, 22);
    k.add(galv, xf(lidG, 0.02, 0.88, 0.01, (R() - 0.5) * 0.1, 0, (R() - 0.5) * 0.12), 0.8);
    k.add(galv, xf(new THREE.TorusGeometry(0.06, 0.01, 4, 10, PI), 0.02, 0.96, 0.01));
  } else {
    trashBag(k, 0, 0.62, 0, 0.75, R);
    k.box(solid('#c8b48a', 0.9), 0.22, 0.03, 0.3, 0.05, 0.9, 0.05, { rz: 0.4 });
  }
  k.add(streakMat('dark'), xf(new THREE.CylinderGeometry(0.29, 0.255, 0.8, 16, 1, true, -1.2, 2.4), 0, 0.46, 0), 0, false);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -0.3, x1: 0.3, y: 0.92 }];
  return g;
}

/**
 * Wet-barrel fire hydrant (chipped yellow paint): flanged base with bolts, barrel, bonnet with
 * pentagon nut, two chained side nozzles and a pumper outlet facing the street. ~0.8 m. No colliders.
 */
export function makeFireHydrant(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const paint = solid(opts.color ?? '#d6a915', 0.42, 0.25), cap = solid('#c9c4b6', 0.4, 0.55), dark = solid('#2a2622', 0.5, 0.6);
  const prof = [v2(0.001, 0), v2(0.2, 0), v2(0.2, 0.05), v2(0.15, 0.07), v2(0.13, 0.1), v2(0.125, 0.55), v2(0.15, 0.57), v2(0.15, 0.6), v2(0.13, 0.62), v2(0.1, 0.7), v2(0.05, 0.74), v2(0.001, 0.75)];
  k.add(paint, new THREE.LatheGeometry(prof, 20));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.cyl(dark, 0.014, 0.014, 0.04, Math.cos(a) * 0.17, 0.065, Math.sin(a) * 0.17, { seg: 6 }); }
  k.cyl(dark, 0.04, 0.045, 0.06, 0, 0.78, 0, { seg: 5 });
  for (const s of [-1, 1]) {
    k.cyl(paint, 0.055, 0.06, 0.1, s * 0.16, 0.42, 0, { rz: HP, seg: 12 });
    k.cyl(cap, 0.062, 0.062, 0.05, s * 0.23, 0.42, 0, { rz: HP, seg: 12 });
    k.cyl(dark, 0.025, 0.025, 0.03, s * 0.265, 0.42, 0, { rz: HP, seg: 5 });
    k.add(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3(s * 0.23, 0.38, 0.05), v3(s * 0.2, 0.3, 0.1), v3(s * 0.13, 0.34, 0.12)]), 8, 0.005, 3));
  }
  k.cyl(paint, 0.08, 0.085, 0.1, 0, 0.36, 0.15, { rx: HP, seg: 14 });
  k.cyl(cap, 0.09, 0.09, 0.06, 0, 0.36, 0.22, { rx: HP, seg: 14 });
  k.cyl(dark, 0.03, 0.03, 0.04, 0, 0.36, 0.26, { rx: HP, seg: 5 });
  k.add(streakMat('rust'), xf(new THREE.CylinderGeometry(0.128, 0.128, 0.4, 14, 1, true, -1, 2), 0, 0.3, 0), 0, false);
  return finalize(g, k);
}

/**
 * Enclosed 80s phone booth: aluminium frame, glass walls with scratched tags, folding door,
 * lit TELEPHONE header on three sides, ceiling tube, payphone with coiled cord, chained
 * phone book. ~0.95 x 2.35 x 0.95 m. lights: interior fluorescent.
 * colliders: ledge on the roof { x0:-0.48, x1:0.48, y: 2.36 }.
 */
export function makePhoneBooth(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const S = 0.95, H = 2.3;
  const alu = solid('#a8adb2', 0.3, 0.9), dark = solid('#16171a', 0.5, 0.5), chrome = mat('chrome');
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(alu, 0.06, H, 0.06, (x * S) / 2, H / 2, (z * S) / 2);
  k.box(alu, S + 0.06, 0.08, S + 0.06, 0, 0.04, 0);
  k.box(alu, S + 0.1, 0.06, S + 0.1, 0, H + 0.03, 0);
  const header = paintMat('phoneHeader', 512, 64, (c, w, h) => {
    c.fillStyle = '#1a3f9a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.font = '900 40px Arial Black, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TELEPHONE', w / 2, h / 2 + 2);
  }, { glow: 1.6, roughness: 0.4 });
  k.box(dark, S + 0.04, 0.28, S + 0.04, 0, H - 0.14, 0);
  for (const [x, z, ry] of [[0, S / 2 + 0.025, 0], [S / 2 + 0.025, 0, HP], [-S / 2 - 0.025, 0, -HP]]) k.add(header, xf(new THREE.PlaneGeometry(S - 0.06, 0.22), x, H - 0.14, z, 0, ry), 0, false);
  const glass = glassMat();
  for (const [x, z, ry] of [[0, -S / 2, 0], [S / 2, 0, HP], [-S / 2, 0, HP]]) {
    k.add(glass, xf(new THREE.PlaneGeometry(S - 0.06, H - 0.5), x, (H - 0.32) / 2 + 0.06, z, 0, ry), 0, false);
    k.box(alu, (S - 0.06), 0.04, 0.03, x, 1.0, z, { ry });
  }
  // folding door (two leaves, half open)
  for (const s of [-1, 1]) {
    const lx = s * 0.22;
    k.add(glass, xf(new THREE.PlaneGeometry(0.42, H - 0.5), lx, (H - 0.32) / 2 + 0.06, S / 2 + 0.08, 0, s * 0.5), 0, false);
    k.box(alu, 0.03, H - 0.45, 0.03, s * 0.42, (H - 0.32) / 2 + 0.06, S / 2 + 0.02);
  }
  tagDecal(k, 3, 0.5, 0.5, 0.48, 1.3, 0.0, HP);
  const sc = paintMat('glassScratch', 128, 128, (c, w, h) => { const R = TX.rng(8); c.strokeStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 30; i++) { c.lineWidth = 1; c.beginPath(); c.moveTo(R() * w, R() * h); c.lineTo(R() * w, R() * h); c.stroke(); } }, { ...DECAL });
  k.add(sc, xf(new THREE.PlaneGeometry(0.8, 0.8), -S / 2 - 0.004, 1.3, 0, 0, -HP), 0, false);
  // payphone
  k.box(chrome, 0.26, 0.5, 0.14, 0, 1.45, -S / 2 + 0.1);
  k.box(dark, 0.12, 0.14, 0.01, 0, 1.38, -S / 2 + 0.172);
  k.box(dark, 0.07, 0.22, 0.07, -0.18, 1.5, -S / 2 + 0.13);
  k.add(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3(-0.18, 1.39, -S / 2 + 0.14), v3(-0.15, 1.2, -S / 2 + 0.2), v3(-0.1, 1.15, -S / 2 + 0.17), v3(-0.06, 1.25, -S / 2 + 0.17)]), 16, 0.008, 4));
  k.box(solid('#e8d24a', 0.6), 0.3, 0.06, 0.24, 0, 0.95, -S / 2 + 0.14);
  k.box(solid('#c8b030', 0.8), 0.28, 0.04, 0.22, 0, 0.995, -S / 2 + 0.14);
  const tube = emissiveMat('#e8f6ff', 3.2, '#ffffff');
  k.box(tube, S - 0.2, 0.03, 0.05, 0, H - 0.31, 0, { shadow: false });
  finalize(g, k);
  g.userData.lights = [{ pos: v3(0, H - 0.35, 0), color: '#dff2ff', intensity: 4, distance: 4.5 }];
  g.userData.colliders = [{ type: 'ledge', x0: -S / 2, x1: S / 2, y: H + 0.06 }];
  return g;
}

const PAPERS = [['THE CITY HERALD', '#1d4fa8', 'NIGHT SLASHER STRIKES AGAIN'], ['NITE NEWS', '#c81e1e', 'COP ON THE EDGE'], ['L.A. EXAMINER-PRESS', '#e8d22a', 'TERROR IN THE STREETS'], ['THE DAILY STAR', '#f2f0e8', 'SUPERMARKET SIEGE!']];

/**
 * Coin-op newspaper vending boxes (opts.count, default 2) on a chain: coloured steel boxes with
 * windows showing front pages (fake mastheads, Cobra-era headlines), coin mechs, handles.
 * Each ~0.45 x 1.05 x 0.42 m. No colliders.
 */
export function makeNewspaperBox(opts = {}) {
  const R = TX.rng(opts.seed ?? 6);
  const n = opts.count ?? 2;
  const g = new THREE.Group(), k = new Kit();
  const front = paintMat('paperFronts', 512, 256, (c) => {
    PAPERS.forEach(([name, col, head], i) => {
      const x = (i % 2) * 256, y = Math.floor(i / 2) * 128;
      c.fillStyle = '#ece6d6'; c.fillRect(x + 4, y + 4, 248, 120);
      c.fillStyle = '#111'; c.textAlign = 'center';
      c.font = '700 20px Georgia, serif'; c.fillText(name, x + 128, y + 26);
      c.fillRect(x + 12, y + 32, 232, 2);
      c.font = '900 22px Impact, Arial Black'; fitFont(c, head, 228, 24); c.fillText(head, x + 128, y + 56);
      c.fillStyle = '#555'; c.fillRect(x + 14, y + 66, 100, 52);
      for (let l = 0; l < 6; l++) { c.fillStyle = '#888'; c.fillRect(x + 124, y + 70 + l * 8, 118, 3); }
    });
  }, { glow: 0.12, roughness: 0.5 });
  const dark = solid('#151618', 0.5, 0.5), chrome = mat('chrome');
  for (let i = 0; i < n; i++) {
    const p = PAPERS[(i + Math.floor(R() * 4)) % 4];
    const x = (i - (n - 1) / 2) * 0.5, rot = (R() - 0.5) * 0.08;
    const body = solid(p[1], 0.4, 0.35);
    k.add(body, xf(new THREE.BoxGeometry(0.44, 0.62, 0.4), x, 0.55 + 0.31, 0, 0, rot));
    k.add(body, xf(new THREE.BoxGeometry(0.44, 0.08, 0.44), x, 1.21, 0, 0, rot));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(dark, 0.03, 0.55, 0.03, x + sx * 0.19, 0.275, sz * 0.17);
    k.box(dark, 0.4, 0.03, 0.36, x, 0.1, 0);
    const pi = PAPERS.indexOf(p);
    k.add(front, uvRect(xf(new THREE.PlaneGeometry(0.36, 0.22), x, 0.95, 0.205, 0, rot), (pi % 2) / 2, 1 - (Math.floor(pi / 2) + 1) / 2, (pi % 2 + 1) / 2, 1 - Math.floor(pi / 2) / 2), 0, false);
    k.add(glassMat(), xf(new THREE.PlaneGeometry(0.38, 0.26), x, 0.95, 0.21, 0, rot), 0, false);
    k.box(chrome, 0.12, 0.17, 0.06, x + 0.12, 1.12, 0.21, { ry: rot });
    k.box(chrome, 0.16, 0.025, 0.04, x - 0.06, 0.78, 0.22, { ry: rot });
    labelDecal(k, (2 + i) % 8, 0.2, x - 0.1, 0.7, 0.203);
  }
  if (n > 1) k.add(solid('#8a8e92', 0.4, 0.9), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3(-(n - 1) * 0.25, 0.5, 0.21), v3(0, 0.38, 0.24), v3((n - 1) * 0.25, 0.5, 0.21)]), 12, 0.008, 4));
  return finalize(g, k);
}

/**
 * Blue street collection mailbox: arched top, chute handle, legs, MAIL lettering and pickup
 * sticker. ~0.55 x 1.25 x 0.5 m. colliders: ledge on top { x0:-0.28, x1:0.28, y: 1.25 }.
 */
export function makeMailbox() {
  const g = new THREE.Group(), k = new Kit();
  const blue = mat('steelBlue'), dark = solid('#121418', 0.5, 0.5);
  const W = 0.55, D = 0.5;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2, 0.32); sh.lineTo(W / 2, 0.32); sh.lineTo(W / 2, 1.0); sh.absarc(0, 1.0, W / 2, 0, PI, false); sh.lineTo(-W / 2, 0.32);
  const body = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 14 });
  body.translate(0, 0, -D / 2);
  k.add(blue, body, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(dark, 0.05, 0.34, 0.05, sx * 0.22, 0.17, sz * 0.19);
  k.box(blue, 0.42, 0.14, 0.06, 0, 1.02, D / 2 + 0.03, { rx: -0.35 });
  k.box(mat('chrome'), 0.2, 0.025, 0.03, 0, 1.06, D / 2 + 0.07);
  const lbl = paintMat('mailLabel', 256, 192, (c, w, h) => {
    c.fillStyle = '#f0f0f0'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 64px Arial Black, Arial'; c.fillText('MAIL', w / 2, 52);
    c.fillStyle = '#f4f2ea'; c.fillRect(48, 104, 160, 76);
    c.fillStyle = '#222'; c.font = '700 16px Arial';
    ['LAST PICKUP', 'MON-FRI 5 PM', 'SAT 1 PM'].forEach((t, i) => c.fillText(t, w / 2, 122 + i * 20));
  }, { ...DECAL, roughness: 0.5 });
  k.add(lbl, xf(new THREE.PlaneGeometry(0.42, 0.315), 0, 0.68, D / 2 + 0.014), 0, false);
  tagDecal(k, 6, 0.3, 0.3, 0.15, 0.45, D / 2 + 0.016);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2, x1: W / 2, y: 1.0 + W / 2 }];
  return g;
}

/**
 * Single-head mechanical parking meter with dome window and red VIOLATION flag. ~1.45 m. No colliders.
 */
export function makeParkingMeter() {
  const g = new THREE.Group(), k = new Kit();
  const grey = solid('#5a5e62', 0.45, 0.8), dark = solid('#1a1b1d', 0.5, 0.5);
  k.cyl(mat('concrete'), 0.1, 0.12, 0.05, 0, 0.025, 0, { seg: 10 });
  k.cyl(grey, 0.03, 0.035, 1.08, 0, 0.56, 0, { seg: 8 });
  k.box(grey, 0.22, 0.26, 0.15, 0, 1.2, 0);
  k.add(grey, xf(new THREE.CylinderGeometry(0.11, 0.11, 0.15, 16, 1, false, 0, PI), 0, 1.33, 0, HP, 0, HP));
  k.add(glassMat(), xf(new THREE.CircleGeometry(0.085, 16, 0, PI), 0, 1.3, 0.077), 0, false);
  k.add(solid('#e8e2d2', 0.5), xf(new THREE.CircleGeometry(0.08, 16, 0, PI), 0, 1.3, 0.074));
  k.box(emissiveMat('#ff2a1a', 1.2, '#c01810'), 0.06, 0.035, 0.01, 0.02, 1.35, 0.076);
  k.box(dark, 0.05, 0.01, 0.01, 0, 1.18, 0.078);
  k.cyl(mat('chrome'), 0.025, 0.025, 0.04, 0.07, 1.12, 0.09, { rx: HP, seg: 8 });
  k.box(solid('#e8d24a', 0.5), 0.12, 0.05, 0.002, 0, 1.12, 0.077);
  return finalize(g, k);
}

/**
 * LA bus-stop bench with a painted ad backrest ("BAIL BONDS 24 HRS"): concrete ends, wooden
 * slats. ~2.2 x 1.05 x 0.7 m. colliders: ledge at the seat { x0:-1.1, x1:1.1, y: 0.46 }.
 */
export function makeBench(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const conc = mat('concrete'), wood = mat('woodWeathered');
  const L = 2.2;
  for (const s of [-1, 1]) {
    k.box(conc, 0.14, 0.42, 0.55, s * (L / 2 - 0.12), 0.21, 0.05, { uv: 1 });
    k.box(conc, 0.14, 0.62, 0.14, s * (L / 2 - 0.12), 0.72, -0.2, { uv: 1 });
  }
  for (let i = 0; i < 4; i++) k.box(wood, L, 0.04, 0.12, 0, 0.44, -0.14 + i * 0.14, { uv: 1 });
  const ad = paintMat(`benchAd${opts.ad ?? 0}`, 512, 128, (c, w, h) => {
    const R = TX.rng(13);
    c.fillStyle = '#f2d22a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c81e1e'; c.fillRect(0, 0, w * 0.32, h);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 44px Impact, Arial Black'; c.fillText('BAIL', w * 0.16, h * 0.36); c.fillText('BONDS', w * 0.16, h * 0.72);
    c.fillStyle = '#111'; c.font = '900 40px Impact, Arial Black'; c.fillText('24 HRS • 555-0199', w * 0.66, h * 0.36);
    c.font = '700 22px Arial'; c.fillText('"WE GET YOU OUT"  — FAST & FRIENDLY', w * 0.66, h * 0.74);
    grimeCanvas(c, w, h, R, 0.7);
  }, { roughness: 0.6 });
  k.box(wood, L, 0.5, 0.05, 0, 0.82, -0.2, { uv: 1 });
  k.add(ad, xf(new THREE.PlaneGeometry(L - 0.06, 0.46), 0, 0.82, -0.174), 0, false);
  tagDecal(k, 2, 0.4, 0.4, 0.7, 0.9, -0.17);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -L / 2, x1: L / 2, y: 0.46 }];
  return g;
}

/**
 * Pole-mounted traffic signal facing the street: 3-lamp head with visors and backplate,
 * pedestrian WALK / DON'T WALK head, push button, street-name blade. Animated cycle
 * (green 5 s, amber 1.6 s, red 5 s) via update; lights[0] follows the active lamp (via ref).
 * ~4.6 m tall. No colliders. opts.street = blade text, opts.phase = cycle offset (s).
 */
export function makeTrafficLight(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const pole = mat('galvanized'), housing = solid('#c9a21a', 0.5, 0.3), dark = solid('#121315', 0.6, 0.3);
  k.cyl(mat('concrete'), 0.3, 0.34, 0.12, 0, 0.06, 0, { seg: 14 });
  k.cyl(pole, 0.09, 0.1, 0.4, 0, 0.32, 0, { seg: 12 });
  k.cyl(pole, 0.07, 0.085, 4.4, 0, 2.3, 0, { seg: 12, uv: 1 });
  const hy = 3.55, hz = 0.25;
  k.box(dark, 0.6, 1.25, 0.03, 0, hy, hz - 0.14);
  k.box(housing, 0.36, 1.08, 0.26, 0, hy, hz);
  k.box(pole, 0.12, 0.08, 0.3, 0, hy, hz - 0.15);
  const lampCols = ['#ff2a1a', '#ffb21a', '#2aff8a'];
  const lamps = lampCols.map((c) => new THREE.MeshStandardMaterial({ color: '#111', emissive: c, emissiveIntensity: 0.05, roughness: 0.3 }));
  lampCols.forEach((c, i) => {
    const y = hy + 0.34 - i * 0.34;
    g.add(Object.assign(new THREE.Mesh(xf(new THREE.CircleGeometry(0.12, 18), 0, y, hz + 0.132), lamps[i]), { castShadow: false }));
    k.add(dark, xf(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 16, 1, true, -HP, PI), 0, y + 0.01, hz + 0.24, -HP, 0, 0));
  });
  // pedestrian head
  const py = 2.45;
  k.box(dark, 0.32, 0.32, 0.2, 0.12, py, 0.18);
  const ped = paintMat('pedSignal', 128, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff6a1a'; c.font = '900 30px Arial Black'; c.textAlign = 'center';
    c.fillText("DON'T", w / 2, 60); c.fillText('WALK', w / 2, 96);
    c.fillStyle = '#e8f6ff'; c.fillText('WALK', w / 2, 200);
  }, { glow: 0.0001, roughness: 0.4 });
  const pedMat = new THREE.MeshStandardMaterial({ map: ped.map, emissiveMap: ped.map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 2, roughness: 0.4 });
  const pedTop = new THREE.Mesh(uvRect(xf(new THREE.PlaneGeometry(0.26, 0.13), 0.12, py + 0.07, 0.281), 0, 0.5, 1, 1), pedMat.clone());
  const pedBot = new THREE.Mesh(uvRect(xf(new THREE.PlaneGeometry(0.26, 0.13), 0.12, py - 0.08, 0.281), 0, 0, 1, 0.5), pedMat.clone());
  g.add(pedTop, pedBot);
  k.box(dark, 0.1, 0.16, 0.06, 0, 1.1, 0.1);
  k.cyl(solid('#c8c4b8', 0.4), 0.025, 0.025, 0.02, 0, 1.12, 0.135, { rx: HP, seg: 10 });
  // street blade
  const street = opts.street ?? 'SUNSET BL';
  const blade = paintMat(`blade${street}`, 512, 96, (c, w, h) => {
    c.fillStyle = '#1d5a3a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f0f0e8'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#f0f0e8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitFont(c, street, w - 60, 60, 'Arial, sans-serif', '700'); c.fillText(street, w / 2, h / 2 + 2);
  }, { roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  k.add(blade, xf(new THREE.PlaneGeometry(1.25, 0.24), 0.55, 4.3, 0.02), 0, false);
  k.box(dark, 0.1, 0.3, 0.1, 0, 4.3, 0);
  k.cyl(pole, 0.075, 0.075, 0.04, 0, 4.52, 0, { seg: 12 });
  finalize(g, k);
  const light = { pos: v3(0, hy, hz + 0.8), color: '#2aff8a', intensity: 7, distance: 6, ref: {} };
  g.userData.lights = [light];
  const cyc = [5, 1.6, 5], total = cyc[0] + cyc[1] + cyc[2], phase = opts.phase ?? 0;
  let last = -1;
  g.userData.update = (dt, t) => {
    const u = (t + phase) % total;
    const s = u < cyc[0] ? 2 : u < cyc[0] + cyc[1] ? 1 : 0;
    if (s === last) return;
    last = s;
    lamps.forEach((m, i) => { m.emissiveIntensity = i === s ? 4 : 0.05; });
    pedTop.material.emissiveIntensity = s === 0 ? 0.1 : 2.2;
    pedBot.material.emissiveIntensity = s === 0 ? 2.2 : 0.1;
    if (light.ref.src) light.ref.src.color.set(lampCols[s]);
  };
  g.userData.update(0, 0);
  return g;
}

/**
 * Cast-iron sewer manhole cover flush with the road, wet sheen, with a steam emitter.
 * Radius 0.36 m. emitters: [{ type: 'steam', pos, rate }]. No colliders.
 */
export function makeManhole(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const cover = paintMat('manhole', 256, 256, (c, w, h) => {
    const R = TX.rng(17);
    c.fillStyle = '#2b2b2d'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4a4a4c'; c.lineWidth = 6;
    for (const r of [120, 92, 40]) { c.beginPath(); c.arc(128, 128, r, 0, TAU); c.stroke(); }
    c.lineWidth = 5;
    for (let x = 52; x < 210; x += 22) { c.beginPath(); c.moveTo(x, 70); c.lineTo(x + 6, 186); c.stroke(); }
    c.fillStyle = '#2b2b2d'; c.beginPath(); c.arc(128, 128, 44, 0, TAU); c.fill();
    c.fillStyle = '#5a5a5c'; c.font = '900 30px Arial Black'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SEWER', 128, 128);
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(${R() < 0.5 ? '90,60,40' : '10,10,10'},${R() * 0.4})`; c.fillRect(R() * w, R() * h, 3, 3); }
  }, { roughness: 0.32, metalness: 0.6 });
  k.add(solid('#1e1e20', 0.5, 0.6), xf(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 28), 0, 0.006, 0));
  k.add(cover, xf(new THREE.CircleGeometry(0.36, 28), 0, 0.018, 0, -HP));
  finalize(g, k);
  g.userData.emitters = [{ type: 'steam', pos: v3(0, 0.05, 0), rate: opts.rate ?? 3 }];
  return g;
}

// ================================================================ crates, pallets, barrels

/**
 * Stack of heavy wooden shipping crates (1.2 m) with plank framing, corner irons and stencils.
 * opts.count 1..6 (default 3) picks a stacking layout; opts.seed varies wear.
 * colliders: one solid AABB per crate (e.g. count 4 => 3 wide + 1 on top-left; count 6 tops at 2.4 m
 * on the right half, 3.1 m at x -0.95..-0.25).
 */
export function makeCrates(opts = {}) {
  const R = TX.rng(opts.seed ?? 2);
  const n = THREE.MathUtils.clamp(opts.count ?? 3, 1, 6);
  const s = 1.2;
  const layouts = {
    1: [[0, 0, s]], 2: [[-0.6, 0, s], [0.6, 0, s]], 3: [[-0.6, 0, s], [0.6, 0, s], [0, 1, s]],
    4: [[-1.2, 0, s], [0, 0, s], [1.2, 0, s], [-0.6, 1, s]], 5: [[-1.2, 0, s], [0, 0, s], [1.2, 0, s], [-0.6, 1, s], [0.6, 1, s]],
    6: [[-1.2, 0, s], [0, 0, s], [1.2, 0, s], [-0.6, 1, s], [0.6, 1, s], [-0.6, 2, 0.7]],
  };
  const g = new THREE.Group(), k = new Kit();
  const wood = mat('crateWood'), frame = mat('woodDark'), iron = solid('#262626', 0.5, 0.7);
  const colliders = [];
  for (const [cx, row, sz] of layouts[n]) {
    const x = cx + (R() - 0.5) * 0.06, y = row * s + sz / 2, z = (R() - 0.5) * 0.1, ry = (R() - 0.5) * 0.08;
    k.add(wood, xf(new THREE.BoxGeometry(sz - 0.02, sz - 0.02, sz - 0.02), x, y, z, 0, ry), 1);
    const t = 0.1, f = sz / 2 + 0.008;
    for (const zz of [f, -f]) {
      for (const yy of [-1, 1]) k.add(frame, xf(new THREE.BoxGeometry(sz, t, 0.03), 0, yy * (sz / 2 - t / 2), zz).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(x, y, z), 1);
      for (const xx of [-1, 1]) k.add(frame, xf(new THREE.BoxGeometry(t, sz - 2 * t, 0.03), xx * (sz / 2 - t / 2), 0, zz).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(x, y, z), 1);
      k.add(frame, xf(new THREE.BoxGeometry(t, (sz - 2 * t) * 1.38, 0.025), 0, 0, zz, 0, 0, PI / 4).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(x, y, z), 1);
    }
    for (const xx of [-1, 1]) for (const yy of [-1, 1]) k.add(iron, xf(new THREE.BoxGeometry(0.14, 0.14, 0.035), xx * (sz / 2 - 0.06), yy * (sz / 2 - 0.06), f + 0.012).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(x, y, z));
    const li = [3, 4, 5, 6][Math.floor(R() * 4)];
    if (sz > 1) labelDecal(k, li, 0.5, x + Math.sin(ry) * (f + 0.02), y + 0.3, z + Math.cos(ry) * (f + 0.02), ry, (R() - 0.5) * 0.1);
    colliders.push({ type: 'solid', x0: x - sz / 2, x1: x + sz / 2, y0: row * s, y1: row * s + sz });
  }
  finalize(g, k);
  g.userData.colliders = colliders;
  return g;
}

/**
 * Stack of wooden shipping pallets (opts.count, default 5) with one leaning pallet.
 * ~1.3 x 0.75 x 1.0 m. colliders: ledge on top { x0:-0.6, x1:0.6, y: count*0.144 }.
 */
export function makePallets(opts = {}) {
  const R = TX.rng(opts.seed ?? 8);
  const n = opts.count ?? 5;
  const g = new THREE.Group(), k = new Kit();
  const wood = mat('woodGrey'), dark = mat('woodDark');
  const pallet = (x, y, z, ry, rz = 0, ox = 0) => {
    const m = new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), v3(1, 1, 1));
    const add = (mm, w, h, d, px, py, pz) => k.add(mm, new THREE.BoxGeometry(w, h, d).translate(px + ox, py, pz).applyMatrix4(m), 1);
    for (let i = 0; i < 7; i++) add(wood, 1.2, 0.022, 0.1, 0, 0.133, -0.45 + i * 0.15);
    for (let i = 0; i < 3; i++) add(wood, 1.2, 0.022, 0.1, 0, 0.011, -0.45 + i * 0.45);
    for (const px of [-0.55, 0, 0.55]) for (const pz of [-0.45, 0, 0.45]) add(dark, 0.1, 0.078, 0.1, px, 0.061, pz);
  };
  for (let i = 0; i < n; i++) pallet((R() - 0.5) * 0.08, i * 0.144, (R() - 0.5) * 0.08, (R() - 0.5) * 0.06);
  if (opts.leaning !== false) pallet(0.9, 0.0, -0.05, 0, -1.25, -0.6);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -0.6, x1: 0.6, y: n * 0.144 }];
  return g;
}

/**
 * 55-gallon steel oil drum (random paint, rolling hoops, bungs, labels, rust).
 * opts.fire = true: open-topped burning barrel with glowing coals, flicker light, embers + smoke.
 * ~0.6 x 0.9 m. colliders: solid { x0:-0.3, x1:0.3, y0:0, y1:0.9 }.
 */
export function makeBarrel(opts = {}) {
  const R = TX.rng(opts.seed ?? 12);
  const g = new THREE.Group(), k = new Kit();
  const r = 0.29, h = 0.89;
  const fire = !!opts.fire;
  const paint = fire ? mat('rustMetal') : [mat('steelBlue'), mat('rustMetal'), solid('#8a1a14', 0.45, 0.5), solid('#1a1c1e', 0.4, 0.6), mat('safetyYellow')][Math.floor(R() * 5)];
  k.add(paint, xf(new THREE.CylinderGeometry(r, r, h - 0.04, 24, 1, true), 0, h / 2, 0), 1);
  for (const y of [0.02, h * 0.33, h * 0.66, h - 0.02]) k.add(paint, xf(new THREE.TorusGeometry(r + 0.004, 0.012, 4, 28), 0, y, 0, HP));
  if (!fire) {
    k.add(paint, xf(new THREE.CircleGeometry(r, 24), 0, h - 0.025, 0, -HP), 1);
    k.cyl(solid('#3a3c3e', 0.4, 0.8), 0.03, 0.03, 0.02, r * 0.55, h - 0.015, 0.05, { seg: 8 });
    k.cyl(solid('#3a3c3e', 0.4, 0.8), 0.02, 0.02, 0.02, -r * 0.6, h - 0.015, -0.05, { seg: 8 });
    labelDecal(k, 6, 0.36, 0, 0.45, r + 0.004);
  } else {
    k.add(solid('#120c08', 0.9), xf(new THREE.CircleGeometry(r - 0.01, 20), 0, h - 0.18, 0, -HP));
    for (let i = 0; i < 4; i++) k.cyl(solid('#3a2416', 0.9), 0.03, 0.03, 0.5, (R() - 0.5) * 0.25, h - 0.1, (R() - 0.5) * 0.25, { rz: HP, ry: R() * PI, seg: 6 });
    for (let i = 0; i < 4; i++) k.cyl(solid('#000000', 1, 0), 0.025, 0.025, 0.02, Math.cos(i * HP) * r, 0.2, Math.sin(i * HP) * r, { rz: HP, ry: -i * HP, seg: 8 });
  }
  k.add(streakMat('rust'), xf(new THREE.CylinderGeometry(r + 0.003, r + 0.003, h * 0.8, 20, 1, true, -1.3, 2.6), 0, h * 0.55, 0), 0, false);
  finalize(g, k);
  g.userData.colliders = [{ type: 'solid', x0: -r, x1: r, y0: 0, y1: h }];
  if (fire) {
    const flame = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff6a1a', emissiveIntensity: 4, roughness: 1, transparent: true, opacity: 0.9, depthWrite: false });
    const fl = [];
    for (let i = 0; i < 3; i++) {
      const m = addMesh(g, new THREE.ConeGeometry(0.12 - i * 0.02, 0.45 + i * 0.1, 7, 1, true), flame, (i - 1) * 0.08, h + 0.1, (i % 2) * 0.05, false);
      fl.push(m);
    }
    const coals = addMesh(g, xf(new THREE.CircleGeometry(r - 0.02, 16), 0, 0, 0, -HP), emissiveMat('#ff4a10', 3), 0, h - 0.12, 0, false);
    coals.name = 'coals';
    const light = { pos: v3(0, h + 0.6, 0.2), color: '#ff7a2a', intensity: 22, distance: 8, ref: {} };
    g.userData.lights = [light];
    g.userData.emitters = [{ type: 'embers', pos: v3(0, h + 0.2, 0), rate: 6 }, { type: 'smoke', pos: v3(0, h + 0.6, 0), rate: 1.2 }];
    g.userData.update = (dt, t) => {
      const f = 0.75 + 0.25 * Math.sin(t * 17) * Math.sin(t * 7.3 + 1);
      fl.forEach((m, i) => { m.scale.set(1, 0.8 + 0.4 * Math.abs(Math.sin(t * (6 + i * 2.3) + i)), 1); m.rotation.y = t * (1 + i); });
      flame.emissiveIntensity = 3 + f * 2;
      if (light.ref.src) light.ref.src.intensity = light.intensity * f;
    };
  }
  return g;
}

// ================================================================ fences, utility, walls

/**
 * Galvanised chain-link fence (alpha mesh) with pipe posts, top rail, tension wire, barbed-wire
 * outriggers (opts.barbed, default true) and a NO TRESPASSING plate. Built along x, centred.
 * @param {object} opts [opts.width=6] [opts.height=3] [opts.barbed=true]. No colliders (see-through backdrop).
 */
export function makeChainLinkFence(opts = {}) {
  const W = opts.width ?? 6, H = opts.height ?? 3;
  const g = new THREE.Group(), k = new Kit();
  const galv = solid('#9aa1a6', 0.35, 0.9);
  const meshH = H - (opts.barbed === false ? 0 : 0.35);
  const n = Math.max(1, Math.round(W / 2.8));
  for (let i = 0; i <= n; i++) {
    const x = -W / 2 + (W * i) / n, end = i === 0 || i === n;
    k.cyl(galv, end ? 0.045 : 0.035, end ? 0.045 : 0.035, meshH + 0.05, x, (meshH + 0.05) / 2, 0, { seg: 10 });
    k.add(galv, xf(new THREE.SphereGeometry(end ? 0.05 : 0.04, 10, 5, 0, TAU, 0, HP), x, meshH + 0.05, 0));
    k.cyl(mat('concrete'), 0.12, 0.14, 0.08, x, 0.04, 0, { seg: 10 });
    if (opts.barbed !== false) k.bar(galv, v3(x, meshH, 0), v3(x, H, -0.3), 0.018, 0.018, { round: true });
  }
  k.bar(galv, v3(-W / 2, meshH - 0.04, 0.02), v3(W / 2, meshH - 0.04, 0.02), 0.024, 0.024, { round: true, seg: 8 });
  k.bar(galv, v3(-W / 2, 0.08, 0.01), v3(W / 2, 0.08, 0.01), 0.006, 0.006, { round: true, seg: 4 });
  const fence = xf(new THREE.PlaneGeometry(W, meshH - 0.05), 0, (meshH - 0.05) / 2 + 0.03, 0.005);
  worldUV(fence, 0.45);
  k.add(chainLinkMat(), fence, 0, true);
  if (opts.barbed !== false) {
    const wire = solid('#5a5e62', 0.5, 0.8);
    for (let j = 1; j <= 3; j++) {
      const t = j / 3.2, y = meshH + (H - meshH) * t, z = -0.3 * t;
      const pts = [];
      for (let i = 0; i <= W * 8; i++) { const x = -W / 2 + i / 8; pts.push(v3(x, y + Math.sin(i * 2.1) * 0.008, z + Math.cos(i * 2.1) * 0.008)); }
      k.add(wire, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.round(W * 16), 0.004, 3), 0, false);
    }
  }
  const sign = paintMat('fenceSign', 256, 160, (c, w, h) => {
    c.fillStyle = '#f2efe6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c81e1e'; c.fillRect(0, 0, w, 52);
    c.fillStyle = '#fff'; c.font = '900 40px Arial Black'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('DANGER', w / 2, 28);
    c.fillStyle = '#111'; c.font = '900 30px Arial Black'; c.fillText('NO', w / 2, 82); c.fillText('TRESPASSING', w / 2, 120);
    grimeCanvas(c, w, h, TX.rng(3), 0.6);
  }, { roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  k.add(sign, xf(new THREE.PlaneGeometry(0.6, 0.375), W * 0.15, 1.6, 0.03, 0, 0, 0.04), 0, false);
  return finalize(g, k);
}

/**
 * Utility power cabinet on a concrete pad: louvred steel doors, padlocked handle, warning
 * stickers, meter, conduits into the ground. opts.sparking: sparks emitter + flickering blue arc.
 * ~1.1 x 1.6 x 0.55 m. colliders: ledge on top { x0:-0.55, x1:0.55, y: 1.62 }.
 */
export function makePowerBox(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const W = 1.1, H = 1.5, D = 0.5;
  const body = mat('steelGreen'), dark = solid('#151617', 0.5, 0.6), galv = mat('galvanized');
  k.box(mat('concrete'), W + 0.3, 0.12, D + 0.3, 0, 0.06, 0, { uv: 1 });
  k.box(body, W, H, D, 0, 0.12 + H / 2, 0, { uv: 1 });
  k.box(body, W + 0.06, 0.05, D + 0.06, 0, 0.12 + H + 0.025, 0, { uv: 1 });
  k.box(dark, 0.006, H - 0.1, 0.01, 0, 0.12 + H / 2, D / 2 + 0.003);
  for (const s of [-1, 1]) {
    k.add(louverMat(), xf(new THREE.PlaneGeometry(0.34, 0.22), s * 0.27, 0.42, D / 2 + 0.004));
    k.add(louverMat(), xf(new THREE.PlaneGeometry(0.34, 0.22), s * 0.27, 1.38, D / 2 + 0.004));
    k.box(galv, 0.03, 0.14, 0.04, s * 0.07, 0.9, D / 2 + 0.02);
  }
  k.add(solid('#b8a032', 0.4, 0.8), xf(new THREE.TorusGeometry(0.025, 0.006, 4, 10, PI), 0.07, 0.86, D / 2 + 0.05));
  k.box(solid('#b8a032', 0.4, 0.8), 0.05, 0.05, 0.02, 0.07, 0.82, D / 2 + 0.05);
  labelDecal(k, 2, 0.4, -0.27, 1.05, D / 2 + 0.006);
  labelDecal(k, 7, 0.32, 0.27, 1.08, D / 2 + 0.006);
  k.box(solid('#c8c4b8', 0.4, 0.3), 0.22, 0.28, 0.12, W / 2 + 0.11, 1.0, 0.05);
  k.add(glassMat(), xf(new THREE.CircleGeometry(0.07, 14), W / 2 + 0.11, 1.02, 0.115), 0, false);
  for (const x of [-0.3, 0, 0.3]) k.cyl(galv, 0.04, 0.04, 0.3, x, 0.0, -D / 2 + 0.08, { seg: 8 });
  k.add(galv, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3(W / 2 + 0.1, 0.86, 0.05), v3(W / 2 + 0.12, 0.4, 0.05), v3(W / 2 + 0.14, 0.1, 0.1), v3(W / 2 + 0.2, -0.1, 0.15)]), 10, 0.025, 6));
  tagDecal(k, 0, 0.7, 0.7, 0.05, 0.62, D / 2 + 0.008);
  k.add(streakMat('rust'), xf(new THREE.PlaneGeometry(W, 1.0), 0, 1.05, D / 2 + 0.009), 0, false);
  finalize(g, k);
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2, x1: W / 2, y: 0.12 + H + 0.05 }];
  if (opts.sparking) {
    const arc = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#8ad8ff', emissiveIntensity: 0, roughness: 0.5 });
    addMesh(g, xf(new THREE.SphereGeometry(0.035, 8, 5), 0, 0.86, D / 2 + 0.03), arc, 0, 0, 0, false);
    const light = { pos: v3(0, 0.9, 0.8), color: '#8ad8ff', intensity: 10, distance: 5, ref: {} };
    g.userData.lights = [light];
    g.userData.emitters = [{ type: 'sparks', pos: v3(0, 0.86, D / 2 + 0.05), rate: 2.5 }];
    g.userData.update = (dt, t) => {
      const on = Math.sin(t * 23) * Math.sin(t * 3.7) > 0.6;
      arc.emissiveIntensity = on ? 8 : 0;
      if (light.ref.src) light.ref.src.intensity = on ? light.intensity : 0;
    };
  }
  return g;
}

// Graffiti art atlas: 2048 x 1024 — cobra piece (left half), ZOMBIE SQUAD (top right),
// two smaller pieces (bottom right).
function drawCobraPiece(c, x, y, s, R) {
  c.save();
  c.translate(x, y);
  c.lineJoin = 'round'; c.lineCap = 'round';
  // backdrop burst
  c.fillStyle = 'rgba(255,40,140,0.85)';
  c.beginPath();
  for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU, r = s * (i % 2 ? 0.36 : 0.48); c.lineTo(s / 2 + Math.cos(a) * r, s * 0.52 + Math.sin(a) * r); }
  c.closePath(); c.fill();
  c.lineWidth = s * 0.012; c.strokeStyle = '#111'; c.stroke();
  // body S-curve
  const body = () => {
    c.beginPath();
    c.moveTo(s * 0.18, s * 0.94);
    c.bezierCurveTo(s * 0.9, s * 0.98, s * 0.95, s * 0.66, s * 0.55, s * 0.62);
    c.bezierCurveTo(s * 0.2, s * 0.58, s * 0.25, s * 0.38, s * 0.5, s * 0.36);
  };
  c.strokeStyle = '#0c0c0c'; c.lineWidth = s * 0.14; body(); c.stroke();
  const bg = c.createLinearGradient(0, s, 0, s * 0.3);
  bg.addColorStop(0, '#1d8a2a'); bg.addColorStop(0.5, '#6ae03a'); bg.addColorStop(1, '#e8f24a');
  c.strokeStyle = bg; c.lineWidth = s * 0.105; body(); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = s * 0.018; body(); c.stroke();
  // scale bands
  c.strokeStyle = 'rgba(10,40,10,0.55)'; c.lineWidth = s * 0.012;
  for (let i = 0; i < 9; i++) { const t = i / 9; c.beginPath(); c.arc(s * (0.3 + t * 0.5), s * (0.9 - t * 0.2), s * 0.04, 0, PI); c.stroke(); }
  // hood
  const hood = () => {
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.4);
    c.bezierCurveTo(s * 0.18, s * 0.36, s * 0.22, s * 0.08, s * 0.5, s * 0.06);
    c.bezierCurveTo(s * 0.78, s * 0.08, s * 0.82, s * 0.36, s * 0.5, s * 0.4);
  };
  c.fillStyle = '#0c0c0c'; c.lineWidth = s * 0.03; c.strokeStyle = '#0c0c0c'; hood(); c.fill(); c.stroke();
  c.save(); c.scale(0.92, 0.92); c.translate(s * 0.043, s * 0.02);
  const hg = c.createRadialGradient(s * 0.5, s * 0.22, 0, s * 0.5, s * 0.22, s * 0.25);
  hg.addColorStop(0, '#f2f25a'); hg.addColorStop(1, '#3aa82a');
  c.fillStyle = hg; hood(); c.fill();
  c.restore();
  c.fillStyle = '#111';
  c.beginPath(); c.moveTo(s * 0.36, s * 0.2); c.lineTo(s * 0.5, s * 0.33); c.lineTo(s * 0.64, s * 0.2); c.lineTo(s * 0.6, s * 0.18); c.lineTo(s * 0.5, s * 0.27); c.lineTo(s * 0.4, s * 0.18); c.fill();
  for (const dx of [0.36, 0.64]) { c.beginPath(); c.arc(s * dx, s * 0.28, s * 0.022, 0, TAU); c.fill(); }
  // head, eyes, fangs, tongue
  c.fillStyle = '#0c0c0c'; c.beginPath(); c.ellipse(s * 0.5, s * 0.12, s * 0.1, s * 0.07, 0, 0, TAU); c.fill();
  c.fillStyle = '#2ae86a'; c.beginPath(); c.ellipse(s * 0.5, s * 0.115, s * 0.085, s * 0.055, 0, 0, TAU); c.fill();
  c.fillStyle = '#ff1a1a';
  for (const ex of [0.45, 0.55]) { c.beginPath(); c.ellipse(s * ex, s * 0.1, s * 0.022, s * 0.012, ex < 0.5 ? 0.4 : -0.4, 0, TAU); c.fill(); }
  c.fillStyle = '#fff';
  for (const fx of [0.47, 0.53]) { c.beginPath(); c.moveTo(s * (fx - 0.012), s * 0.16); c.lineTo(s * (fx + 0.012), s * 0.16); c.lineTo(s * fx, s * 0.21); c.fill(); }
  c.strokeStyle = '#e81a3a'; c.lineWidth = s * 0.01;
  c.beginPath(); c.moveTo(s * 0.5, s * 0.17); c.lineTo(s * 0.5, s * 0.25); c.lineTo(s * 0.47, s * 0.28); c.moveTo(s * 0.5, s * 0.25); c.lineTo(s * 0.53, s * 0.28); c.stroke();
  // highlights + drips + overspray
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(s * (0.25 + R() * 0.5), s * (0.1 + R() * 0.8), s * 0.006, 0, TAU); c.fill(); }
  for (let i = 0; i < 14; i++) { const dx = s * (0.2 + R() * 0.65), dy = s * (0.6 + R() * 0.35), len = s * (0.03 + R() * 0.08); c.fillStyle = R() < 0.5 ? '#6ae03a' : '#ff2a8a'; c.fillRect(dx, dy, s * 0.006, len); }
  c.restore();
}

function drawZombieSquad(c, x, y, w, h, R) {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(-0.06);
  c.transform(1, 0, -0.18, 1, 0, 0);
  const t1 = 'ZOMBIE', t2 = 'SQUAD';
  const px = h * 0.36;
  c.font = `900 ${px}px Impact, "Arial Black", sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const lines = [[t1, -h * 0.17], [t2, h * 0.2]];
  for (let d = 14; d > 0; d -= 2) for (const [t, ty] of lines) { c.fillStyle = '#2a0a3a'; c.fillText(t, d, ty + d); }
  for (const [t, ty] of lines) { c.lineWidth = px * 0.2; c.strokeStyle = '#0a0a0a'; c.strokeText(t, 0, ty); c.lineWidth = px * 0.1; c.strokeStyle = '#f2f2f2'; c.strokeText(t, 0, ty); }
  const fg = c.createLinearGradient(0, -h * 0.4, 0, h * 0.4);
  fg.addColorStop(0, '#2af5ff'); fg.addColorStop(0.5, '#b05aff'); fg.addColorStop(1, '#ff2a6d');
  c.fillStyle = fg;
  for (const [t, ty] of lines) c.fillText(t, 0, ty);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 20; i++) c.fillRect((R() - 0.5) * w * 0.8, -h * 0.3 + R() * h * 0.05, w * 0.02, 3);
  for (let i = 0; i < 16; i++) { const dx = (R() - 0.5) * w * 0.75; c.fillStyle = '#ff2a6d'; c.fillRect(dx, h * 0.3, 4, h * (0.05 + R() * 0.15)); }
  c.fillStyle = '#ffd23a'; c.font = `900 ${px * 0.28}px Arial Black, Arial`;
  c.fillText('CREW 86', w * 0.38, -h * 0.42);
  c.restore();
}

function graffitiAtlasMat() {
  return paintMat('graffitiAtlas', 2048, 1024, (c) => {
    const R = TX.rng(1986);
    drawCobraPiece(c, 30, 20, 980, R);
    drawZombieSquad(c, 1060, 40, 960, 440, R);
    drawTag(c, 1050, 520, 480, 480, 'NWO', R);
    drawTag(c, 1540, 520, 480, 480, 'KRUSH', R);
  }, { ...DECAL, roughness: 0.45 });
}

/**
 * Free-standing brick wall section covered in spray paint: a big stylised cobra piece, a
 * ZOMBIE SQUAD burner, extra tags, posters, concrete coping and pilasters every ~4 m.
 * @param {object} opts [opts.width=8] [opts.height=4] [opts.seed]
 * [opts.ledge=false] add a ledge collider on the coping (off by default: these walls are usually
 * set back as alley backdrops; enable when the wall stands in the gameplay plane).
 */
export function makeGraffitiWall(opts = {}) {
  const W = opts.width ?? 8, H = opts.height ?? 4;
  const R = TX.rng(opts.seed ?? 13);
  const g = new THREE.Group(), k = new Kit();
  const wall = mat(R() < 0.5 ? 'brickDark' : 'brickRed'), cap = mat('concrete');
  k.box(wall, W, H, 0.4, 0, H / 2, 0, { uv: 1.4 });
  k.box(cap, W + 0.1, 0.12, 0.5, 0, H + 0.06, 0, { uv: 1 });
  const np = Math.max(1, Math.round(W / 4));
  for (let i = 0; i <= np; i++) k.box(wall, 0.45, H + 0.05, 0.55, -W / 2 + (W * i) / np, (H + 0.05) / 2, 0, { uv: 1.4 });
  const gm = graffitiAtlasMat();
  const fz = 0.276;
  const piece = (u0, v0, u1, v1, w, h, x, y) => k.add(gm, uvRect(xf(new THREE.PlaneGeometry(w, h), x, y, fz), u0, v0, u1, v1), 0, false);
  const cs = Math.min(H * 0.92, 4.4, W * 0.45);
  const used = [];
  let x = -W / 2 + cs / 2 + 0.4;
  piece(0, 0, 0.5, 1, cs, cs, x, cs / 2 + 0.05);
  used.push([x - cs / 2, x + cs / 2]);
  x += cs / 2 + 0.3;
  const zw = Math.min(W - (x + W / 2) - 0.3, cs * 1.8, 5.2);
  if (zw > 1.5) {
    const zh = zw * (440 / 960);
    piece(0.515, 1 - 480 / 1024, 0.99, 1 - 40 / 1024, zw, zh, x + zw / 2, Math.min(H - zh / 2 - 0.15, zh / 2 + 0.6));
    x += zw + 0.3;
  }
  while (x < W / 2 - 0.9) {
    const sz = 1.2 + R() * 0.8;
    const left = R() < 0.5;
    if (R() < 0.5) piece(left ? 0.512 : 0.75, 0.02, left ? 0.748 : 0.988, 0.49, sz * 1.2, sz * 1.2, x + sz * 0.6, 0.4 + sz * 0.6 + R() * Math.max(0, H - sz * 1.6 - 0.6));
    else tagDecal(k, Math.floor(R() * 8), sz, sz, x + sz / 2, 0.5 + R() * Math.max(0.2, H - 1.6), fz + 0.002);
    x += sz + 0.4 + R();
  }
  for (let i = 0; i < Math.round(W / 3); i++) tagDecal(k, Math.floor(R() * 8), 0.8, 0.8, -W / 2 + R() * W, 0.35 + R() * 0.4, fz + 0.004);
  for (let i = 0; i < Math.round(W / 6); i++) posterDecal(k, Math.floor(R() * 8), 0.45, -W / 2 + 0.5 + R() * (W - 1), 1.4 + R() * 0.5, fz + 0.006, (R() - 0.5) * 0.1);
  k.add(streakMat('dark'), xf(new THREE.PlaneGeometry(W, Math.min(2.5, H)), 0, H - Math.min(2.5, H) / 2, fz + 0.008), 0, false);
  finalize(g, k);
  g.userData.colliders = opts.ledge ? [{ type: 'ledge', x0: -W / 2, x1: W / 2, y: H + 0.12 }] : [];
  return g;
}

// ================================================================ shelters, kiosks, scaffold

/**
 * Bus shelter: steel frame, flat roof with fascia, back glass with a backlit ad box, side glass
 * with route map, bench, BUS STOP pole sign and a fluorescent tube (lights).
 * ~3.4 x 2.55 x 1.5 m, open toward +z (z -1.25..+0.25). colliders: ledge on the roof { x0:-1.7, x1:1.7, y: 2.55 }.
 */
export function makeBusShelter(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const W = 3.2, H = 2.45, z0 = -1.15, z1 = 0.15;
  const frame = solid('#2a3a3a', 0.4, 0.75), alu = solid('#a8adb2', 0.3, 0.9);
  for (const x of [-W / 2, W / 2]) for (const z of [z0, z1]) k.box(frame, 0.08, H, 0.08, x, H / 2, z);
  k.box(frame, W + 0.4, 0.06, z1 - z0 + 0.45, 0, H + 0.03, (z0 + z1) / 2 + 0.05);
  k.box(alu, W + 0.42, 0.14, 0.04, 0, H, z1 + 0.28);
  k.box(alu, W + 0.42, 0.14, 0.04, 0, H, z0 - 0.17);
  const glass = glassMat();
  k.add(glass, xf(new THREE.PlaneGeometry(W - 1.4, H - 0.5), -0.68, H / 2 + 0.1, z0), 0, false);
  k.add(glass, xf(new THREE.PlaneGeometry(z1 - z0 - 0.1, H - 0.5), -W / 2, H / 2 + 0.1, (z0 + z1) / 2, 0, HP), 0, false);
  k.box(frame, 0.04, H - 0.4, 0.04, 0.0, H / 2, z0);
  // backlit ad box
  const ad = paintMat('shelterAd', 256, 384, (c, w, h) => {
    const g2 = c.createLinearGradient(0, 0, 0, h); g2.addColorStop(0, '#0a1a3a'); g2.addColorStop(1, '#ff3a6a');
    c.fillStyle = g2; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffe14a'; c.font = 'italic 900 54px Impact'; c.textAlign = 'center';
    c.fillText('KAOS', w / 2, 80); c.font = 'italic 900 40px Impact'; c.fillText('JEANS', w / 2, 125);
    c.fillStyle = '#05050a'; c.beginPath(); c.ellipse(w / 2, 250, 60, 110, 0, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.font = '700 18px Arial'; c.fillText('WEAR THE NIGHT', w / 2, h - 24);
  }, { glow: 0.6, roughness: 0.3 });
  k.box(solid('#1e1f22', 0.5, 0.6), 1.25, 1.8, 0.14, W / 2 - 0.68, 1.25, z0);
  k.add(ad, xf(new THREE.PlaneGeometry(1.1, 1.65), W / 2 - 0.68, 1.25, z0 + 0.075), 0, false);
  // bench + map + tube light
  k.box(alu, W - 0.4, 0.05, 0.36, 0, 0.47, z0 + 0.25);
  for (const x of [-1, 0, 1]) k.box(frame, 0.05, 0.45, 0.05, x, 0.23, z0 + 0.25);
  const map = paintMat('routeMap', 128, 128, (c, w, h) => {
    c.fillStyle = '#efece2'; c.fillRect(0, 0, w, h);
    c.lineWidth = 4;
    for (const [col, pts] of [['#c81e1e', [[10, 20], [60, 40], [110, 30]]], ['#1e4ac8', [[20, 110], [60, 70], [118, 90]]], ['#e8a01a', [[64, 4], [70, 60], [50, 124]]]]) { c.strokeStyle = col; c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.stroke(); }
  }, { roughness: 0.4 });
  k.add(map, xf(new THREE.PlaneGeometry(0.5, 0.5), -W / 2 + 0.006, 1.5, (z0 + z1) / 2, 0, HP), 0, false);
  k.box(emissiveMat('#e8f6ff', 3, '#ffffff'), W - 0.6, 0.03, 0.06, 0, H - 0.05, (z0 + z1) / 2, { shadow: false });
  // stop sign pole
  const sp = paintMat('busStopSign', 128, 192, (c, w, h) => {
    c.fillStyle = '#f2efe6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1e4ac8'; c.fillRect(0, 0, w, 70);
    c.fillStyle = '#fff'; c.font = '900 30px Arial Black'; c.textAlign = 'center'; c.fillText('BUS', w / 2, 32); c.fillText('STOP', w / 2, 62);
    c.fillStyle = '#111'; c.font = '900 28px Arial'; c.fillText('4 • 304', w / 2, 110);
    c.font = '700 16px Arial'; c.fillText('OWL SERVICE', w / 2, 150);
  }, { roughness: 0.4, side: THREE.DoubleSide });
  k.cyl(mat('galvanized'), 0.035, 0.035, 3.0, W / 2 + 0.55, 1.5, z1, { seg: 8 });
  k.add(sp, xf(new THREE.PlaneGeometry(0.4, 0.6), W / 2 + 0.55, 2.6, z1 + 0.04), 0, false);
  tagDecal(k, 5, 0.6, 0.6, -0.9, 1.1, z0 + 0.01);
  finalize(g, k);
  g.userData.lights = [{ pos: v3(0, H - 0.3, z1 + 0.3), color: '#dff2ff', intensity: 9, distance: 6 }, { pos: v3(W / 2 - 0.68, 1.3, z0 + 0.6), color: '#ff6a9a', intensity: 4, distance: 3.5 }];
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2 - 0.2, x1: W / 2 + 0.2, y: H + 0.06 }];
  return g;
}

/**
 * Street newsstand kiosk: green steel booth with a lit NEWS sign, sloped awning roof, magazine
 * racks on the front, newspaper stacks, hanging bulb (lights). ~2.6 x 2.6 x 1.4 m (z -1.3..+0.15).
 * colliders: ledge on the roof { x0:-1.3, x1:1.3, y: 2.55 }.
 */
export function makeNewsstand(opts = {}) {
  const g = new THREE.Group(), k = new Kit();
  const W = 2.4, H = 2.3, z0 = -1.3, z1 = 0.0;
  const body = mat('steelGreen'), dark = solid('#151617', 0.5, 0.5);
  k.box(body, W, 0.9, z1 - z0, 0, 0.45, (z0 + z1) / 2, { uv: 1 });
  k.box(body, W, H, 0.08, 0, H / 2, z0 + 0.04, { uv: 1 });
  for (const s of [-1, 1]) k.box(body, 0.08, H, z1 - z0, s * (W / 2 - 0.04), H / 2, (z0 + z1) / 2, { uv: 1 });
  k.box(body, W + 0.1, 0.08, z1 - z0 + 0.1, 0, H, (z0 + z1) / 2, { uv: 1 });
  const roof = new THREE.BoxGeometry(W + 0.5, 0.06, 0.9);
  xf(roof, 0, H + 0.12, z1 + 0.25, -0.22);
  k.add(solid('#1d5a3a', 0.45, 0.3), roof);
  const covers = paintMat('magCovers', 512, 256, (c, w, h) => {
    const R = TX.rng(41);
    const titles = ['TEEN BEAT', 'ROCK!', 'CAR KING', 'TV WEEK', 'GOSSIP', 'SPORT', 'ARCADE', 'STAR', 'GUNS & AMMO', 'MUSCLE', 'VOGUE-ISH', 'POP'];
    for (let i = 0; i < 16; i++) {
      const x = (i % 8) * 64, y = Math.floor(i / 8) * 128;
      c.fillStyle = `hsl(${R() * 360},70%,${45 + R() * 20}%)`; c.fillRect(x + 2, y + 2, 60, 124);
      c.fillStyle = '#111'; c.fillRect(x + 8, y + 40, 48, 60);
      c.fillStyle = '#fff'; c.font = '900 12px Arial Black'; c.textAlign = 'center'; c.fillText(titles[i % titles.length], x + 32, y + 22);
      c.fillStyle = `hsl(${R() * 360},40%,60%)`; c.beginPath(); c.ellipse(x + 32, y + 64, 14, 18, 0, 0, TAU); c.fill();
    }
  }, { roughness: 0.5, glow: 0.15 });
  for (let r = 0; r < 2; r++) {
    k.box(dark, W - 0.2, 0.03, 0.12, 0, 1.25 + r * 0.42, z0 + 0.14);
    k.add(covers, uvRect(xf(new THREE.PlaneGeometry(W - 0.25, 0.38), 0, 1.45 + r * 0.42, z0 + 0.1, -0.12), 0, 1 - (r + 1) / 2, 1, 1 - r / 2), 0, false);
  }
  k.add(covers, uvRect(xf(new THREE.PlaneGeometry(W - 0.2, 0.36), 0, 0.62, z1 + 0.005), 0, 0, 1, 0.5));
  const front = paintMat('paperFrontsWide', 512, 64, (c, w, h) => { const R = TX.rng(9); for (let i = 0; i < 8; i++) { c.fillStyle = '#e8e2d2'; c.fillRect(i * 64 + 2, 2, 60, 60); c.fillStyle = '#111'; c.fillRect(i * 64 + 6, 8, 52, 8); c.fillRect(i * 64 + 6, 24 + R() * 4, 24, 20); } }, { roughness: 0.7 });
  for (let i = 0; i < 4; i++) k.add(front, uvRect(xf(new THREE.BoxGeometry(0.42, 0.12 + (i % 2) * 0.05, 0.32), -0.85 + i * 0.56, 0.96 + (i % 2) * 0.025, z1 - 0.25), i / 4, 0, (i + 1) / 4, 1));
  const sign = paintMat('newsSign', 256, 64, (c, w, h) => { c.fillStyle = '#f2efe6'; c.fillRect(0, 0, w, h); c.fillStyle = '#c81e1e'; c.font = '900 48px Impact'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NEWS', w / 2, h / 2 + 2); }, { glow: 0.7, roughness: 0.4 });
  k.box(dark, 1.3, 0.38, 0.1, 0, H + 0.45, z0 + 0.25);
  k.add(sign, xf(new THREE.PlaneGeometry(1.2, 0.3), 0, H + 0.45, z0 + 0.305), 0, false);
  k.add(emissiveMat('#ffd9a0', 4, '#ffffff'), xf(new THREE.SphereGeometry(0.05, 10, 6), 0, H - 0.3, (z0 + z1) / 2), 0, false);
  k.bar(dark, v3(0, H - 0.04, (z0 + z1) / 2), v3(0, H - 0.25, (z0 + z1) / 2), 0.006, 0.006, { round: true });
  tagDecal(k, 7, 0.6, 0.6, W / 2 - 0.45, 0.35, z1 + 0.008);
  finalize(g, k);
  g.userData.lights = [{ pos: v3(0, H - 0.5, z1 + 0.6), color: '#ffd9a0', intensity: 8, distance: 5 }];
  g.userData.colliders = [{ type: 'ledge', x0: -W / 2 - 0.2, x1: W / 2 + 0.2, y: H + 0.2 }];
  return g;
}

/**
 * Tube-and-coupler construction scaffold in front of a facade: standards on sole boards,
 * ledgers, transoms, zig-zag braces, scaffold-board decks with toe boards and guard rails,
 * ladders through deck hatches alternating ends, a CONSTRUCTION banner and a caged work lamp.
 * Decks span z -1.0..+0.5 (inner standards at z = -1.05, outer at +0.55).
 * @param {object} opts [opts.width=10] [opts.levels=2] [opts.levelHeight=3.2]
 * colliders: ledge per deck { x0:-w/2, x1:w/2, y: levelHeight*i } (i = 1..levels).
 * ladders: { x: -w/2+0.8 (even i) | w/2-0.8 (odd i), y0: lh*i, y1: lh*(i+1) } for i = 0..levels-1.
 */
export function makeScaffold(opts = {}) {
  const W = opts.width ?? 10, levels = opts.levels ?? 2, lh = opts.levelHeight ?? 3.2;
  const R = TX.rng(opts.seed ?? 7);
  const g = new THREE.Group(), k = new Kit();
  const tube = solid('#9aa1a6', 0.38, 0.85), clamp = solid('#5a5e62', 0.45, 0.8);
  const plank = mat('woodWeathered'), yellow = solid('#d8a514', 0.5, 0.3);
  const zi = -1.05, zo = 0.55, topH = lh * levels + 1.05;
  const nb = Math.max(1, Math.round(W / 2.4));
  const xs = Array.from({ length: nb + 1 }, (_, i) => -W / 2 + 0.1 + ((W - 0.2) * i) / nb);
  const T = (a, b, r = 0.024) => k.bar(tube, a, b, r, r, { round: true, seg: 7 });
  const ladX = (i) => (i % 2 === 0 ? -W / 2 + 0.8 : W / 2 - 0.8);
  for (const x of xs) for (const z of [zi, zo]) {
    T(v3(x, 0.05, z), v3(x, topH, z));
    k.box(clamp, 0.15, 0.01, 0.15, x, 0.055, z);
    k.box(mat('woodDark'), 0.22, 0.04, 0.5, x, 0.02, z, { uv: 1 });
  }
  for (let l = 0; l <= levels * 2; l++) {
    const y = (l * lh) / 2 + (l === 0 ? 0.25 : 0);
    for (const z of [zi, zo]) T(v3(-W / 2, y, z), v3(W / 2, y, z));
    for (const x of xs) { T(v3(x, y - 0.06, zi - 0.1), v3(x, y - 0.06, zo + 0.1), 0.022); k.box(clamp, 0.07, 0.07, 0.07, x, y, zo); }
  }
  for (let b = 0; b < nb; b++) for (let l = 0; l < levels; l++) {
    const up = (b + l) % 2 === 0;
    T(v3(xs[b], l * lh + (up ? 0.1 : lh), zo + 0.04), v3(xs[b + 1], l * lh + (up ? lh : 0.1), zo + 0.04), 0.02);
  }
  const colliders = [], ladders = [];
  for (let l = 1; l <= levels; l++) {
    const y = l * lh;
    const hx = ladX(l - 1);
    const rects = rectsMinusHoles([-W / 2, W / 2, -1.0, 0.5], [[hx - 0.33, hx + 0.33, -0.6, -0.02]]);
    for (const [a, b, c2, e] of rects) {
      const nPl = Math.max(1, Math.round((e - c2) / 0.25));
      for (let p = 0; p < nPl; p++) {
        const pz0 = c2 + ((e - c2) * p) / nPl, pz1 = c2 + ((e - c2) * (p + 1)) / nPl;
        k.add(plank, xf(new THREE.BoxGeometry(b - a, 0.045, pz1 - pz0 - 0.012), (a + b) / 2, y - 0.0225 + (R() - 0.5) * 0.008, (pz0 + pz1) / 2, 0, 0, (R() - 0.5) * 0.004), 1.5);
      }
    }
    k.add(hazard(), uvRect(xf(new THREE.BoxGeometry(W, 0.15, 0.03), 0, y + 0.075, zo - 0.03), 0, 0, W / 1.2, 1));
    for (const yy of [y + 0.5, y + 1.0]) T(v3(-W / 2, yy, zo + 0.03), v3(W / 2, yy, zo + 0.03), 0.022);
    for (const s of [-1, 1]) T(v3(s * (W / 2 - 0.02), y + 1.0, zi), v3(s * (W / 2 - 0.02), y + 1.0, zo));
    colliders.push({ type: 'ledge', x0: -W / 2, x1: W / 2, y });
  }
  for (let i = 0; i < levels; i++) {
    const x = ladX(i);
    ladderParts(k, solid('#c8ccd0', 0.4, 0.8), x, -0.3, i * lh, (i + 1) * lh, 1.0, 0.42);
    ladders.push({ x, y0: i * lh, y1: (i + 1) * lh, z: -0.3, w: 0.42 });
  }
  const banner = paintMat('constructionBanner', 512, 128, (c, w, h) => {
    c.fillStyle = '#e8b81a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitFont(c, 'CONSTRUCTION — KEEP OUT', w - 30, 52);
    c.fillText('CONSTRUCTION — KEEP OUT', w / 2, h / 2 - 6);
    c.font = '700 18px Arial'; c.fillText('HARD HAT AREA • VIOLATORS WILL BE PROSECUTED', w / 2, h - 18);
    grimeCanvas(c, w, h, TX.rng(4), 0.6);
  }, { roughness: 0.8, side: THREE.DoubleSide });
  const bw = Math.min(5, W * 0.5);
  k.add(banner, xf(new THREE.PlaneGeometry(bw, bw / 4), (R() - 0.5) * (W - bw), lh * 0.5, zo + 0.06), 0, true);
  k.box(yellow, 0.5, 0.05, 0.05, ladX(0) + 0.6, 1.2, zo + 0.05);
  const lampX = (R() - 0.5) * (W - 2), lampY = lh * levels - 0.35;
  k.add(clamp, xf(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 8, 1, true), lampX, lampY, zo - 0.2), 0, true);
  k.add(emissiveMat('#ffe0a0', 5, '#ffffff'), xf(new THREE.SphereGeometry(0.06, 8, 6), lampX, lampY, zo - 0.2), 0, false);
  k.bar(clamp, v3(lampX, lampY + 0.09, zo - 0.2), v3(lampX, lampY + 0.32, zo - 0.2), 0.006, 0.006, { round: true });
  finalize(g, k);
  g.userData.colliders = colliders;
  g.userData.ladders = ladders;
  g.userData.lights = [{ pos: v3(lampX, lampY - 0.2, zo + 0.3), color: '#ffd9a0', intensity: 14, distance: 7 }];
  return g;
}

// @@CITY-END
