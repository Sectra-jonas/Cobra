// CPU-simulated, GPU-drawn particles (THREE.Points with a sprite atlas) plus
// instanced mesh debris (shell casings, glass, chunks) with bouncy physics.
import * as THREE from 'three';
import * as TX from './textures.js';

// Sprite atlas (2x2): 0 soft glow, 1 smoke puff, 2 spark streak, 3 ring
function makeAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  // 0: soft radial
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  // 1: smoke puff (noise-shaped)
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = TX.fbm(x / S * 4, y / S * 4, 4, 5, 202);
      const a = Math.max(0, Math.min(1, (1 - d) * 1.5 - 0.15)) * Math.max(0, Math.min(1, n * 1.9 - 0.3));
      const j = (y * S + x) * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      img.data[j + 3] = a * 255;
    }
  }
  g.putImageData(img, S, 0);
  // 2: spark streak (horizontal)
  gr = g.createLinearGradient(0, 0, S, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.7, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0.2)');
  g.fillStyle = gr;
  g.save();
  g.beginPath();
  g.ellipse(S / 2, S + S / 2, S / 2, S / 14, 0, 0, Math.PI * 2);
  g.clip();
  g.fillRect(0, S, S, S);
  g.restore();
  // 3: ring
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 6;
  g.shadowColor = 'white';
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(S + S / 2, S + S / 2, S * 0.38, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  return t;
}

const VERT = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aSprite;
  attribute float aRot;
  attribute float aStretch;
  uniform float uScale;
  varying vec4 vColor;
  varying float vSprite;
  varying float vRot;
  varying float vStretch;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vSprite = aSprite;
    vRot = aRot;
    vStretch = aStretch;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z) * (1.0 + aStretch);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying vec4 vColor;
  varying float vSprite;
  varying float vRot;
  varying float vStretch;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    p.y *= (1.0 + vStretch);
    p += 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
    float idx = floor(vSprite + 0.5);
    vec2 cell = vec2(mod(idx, 2.0), floor(idx / 2.0));
    vec2 uv = (cell + vec2(p.x, 1.0 - p.y)) * 0.5;
    uv.y = 1.0 - uv.y;
    vec4 tex = texture2D(uAtlas, uv);
    gl_FragColor = vec4(vColor.rgb, vColor.a * tex.a);
    #include <fog_fragment>
  }
`;

class PointPool {
  constructor(capacity, blending, atlas) {
    this.cap = capacity;
    this.count = 0;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 4);
    this.c1 = new Float32Array(capacity * 4);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.sprite = new Float32Array(capacity);
    this.stretch = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSprite = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aStretch = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aSprite', this.aSprite);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aStretch', this.aStretch);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: atlas }, uScale: { value: 600 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.mat.uniforms.uAtlas.value = atlas;
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 5 : 4;
  }

  spawn(o) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = Math.floor(Math.random() * this.cap);
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = o.x; this.p[i3 + 1] = o.y; this.p[i3 + 2] = o.z || 0;
    this.v[i3] = o.vx || 0; this.v[i3 + 1] = o.vy || 0; this.v[i3 + 2] = o.vz || 0;
    this.life[i] = 0;
    this.maxLife[i] = o.life || 1;
    this.size0[i] = o.size ?? 0.3;
    this.size1[i] = o.size1 ?? this.size0[i];
    const a = o.color || [1, 1, 1, 1], b = o.color1 || a;
    this.c0.set([a[0], a[1], a[2], a[3] ?? 1], i4);
    this.c1.set([b[0], b[1], b[2], b[3] ?? 0], i4);
    this.grav[i] = o.gravity || 0;
    this.drag[i] = o.drag || 0;
    this.spin[i] = o.spin || 0;
    this.rot[i] = o.rot ?? Math.random() * 6.28;
    this.sprite[i] = o.sprite || 0;
    this.stretch[i] = o.stretch || 0;
    this.floor[i] = o.floor ?? -1e9;
  }

  update(dt) {
    const n = this.count;
    const P = this.aPos.array, SZ = this.aSize.array, C = this.aColor.array, SP = this.aSprite.array, R = this.aRot.array, ST = this.aStretch.array;
    let w = 0;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) continue;
      const i3 = i * 3, i4 = i * 4;
      const t = this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= d; this.v[i3 + 1] = this.v[i3 + 1] * d - this.grav[i] * dt; this.v[i3 + 2] *= d;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      if (this.p[i3 + 1] < this.floor[i]) { this.p[i3 + 1] = this.floor[i]; this.v[i3 + 1] *= -0.35; this.v[i3] *= 0.6; }
      this.rot[i] += this.spin[i] * dt;
      // compact into slot w
      if (w !== i) this.copy(i, w);
      const w3 = w * 3, w4 = w * 4;
      P[w3] = this.p[w3]; P[w3 + 1] = this.p[w3 + 1]; P[w3 + 2] = this.p[w3 + 2];
      SZ[w] = this.size0[w] + (this.size1[w] - this.size0[w]) * t;
      for (let k = 0; k < 4; k++) C[w4 + k] = this.c0[w4 + k] + (this.c1[w4 + k] - this.c0[w4 + k]) * t;
      SP[w] = this.sprite[w];
      if (this.stretch[w] > 0) {
        R[w] = -Math.atan2(this.v[w3 + 1], this.v[w3]);
        ST[w] = this.stretch[w] * Math.min(1, Math.hypot(this.v[w3], this.v[w3 + 1]) / 10);
      } else {
        R[w] = this.rot[w];
        ST[w] = 0;
      }
      w++;
    }
    this.count = w;
    this.points.geometry.setDrawRange(0, w);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = this.aSprite.needsUpdate = this.aRot.needsUpdate = this.aStretch.needsUpdate = true;
  }

  copy(i, w) {
    const i3 = i * 3, w3 = w * 3, i4 = i * 4, w4 = w * 4;
    for (let k = 0; k < 3; k++) { this.p[w3 + k] = this.p[i3 + k]; this.v[w3 + k] = this.v[i3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[w4 + k] = this.c0[i4 + k]; this.c1[w4 + k] = this.c1[i4 + k]; }
    this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i];
    this.size0[w] = this.size0[i]; this.size1[w] = this.size1[i];
    this.grav[w] = this.grav[i]; this.drag[w] = this.drag[i]; this.spin[w] = this.spin[i]; this.rot[w] = this.rot[i];
    this.sprite[w] = this.sprite[i]; this.stretch[w] = this.stretch[i]; this.floor[w] = this.floor[i];
  }

  clear() { this.count = 0; this.points.geometry.setDrawRange(0, 0); }
}

// Instanced debris with simple physics against a floor-height callback.
class Debris {
  constructor(scene, geometry, material, cap = 200) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.items = [];
    this.cap = cap;
    this.dummy = new THREE.Object3D();
  }
  spawn(o) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ x: o.x, y: o.y, z: o.z || 0, vx: o.vx, vy: o.vy, vz: o.vz || 0, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, sr: o.spin ?? 15, life: o.life || 4, t: 0, scale: o.scale || 1, bounce: o.bounce ?? 0.35, onBounce: o.onBounce, bounced: 0 });
  }
  update(dt, floorAt) {
    const d = this.dummy;
    let n = 0;
    for (const it of this.items) {
      it.t += dt;
      if (it.t > it.life) continue;
      it.vy -= 30 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      const fy = floorAt ? floorAt(it.x, it.y + 0.3) : 0;
      if (it.y < fy && it.vy < 0) {
        it.y = fy;
        it.vy *= -it.bounce; it.vx *= 0.6; it.vz *= 0.6; it.sr *= 0.5;
        if (it.onBounce && it.bounced < 2 && Math.abs(it.vy) > 1) it.onBounce(it);
        it.bounced++;
      }
      it.rx += it.sr * dt; it.rz += it.sr * 0.7 * dt;
      const fade = it.t > it.life - 0.5 ? Math.max(0.01, (it.life - it.t) / 0.5) : 1;
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(it.rx, it.ry, it.rz);
      d.scale.setScalar(it.scale * fade);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.items = this.items.filter((it) => it.t <= it.life);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
}

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.scene = scene;
    const atlas = makeAtlas();
    this.add = new PointPool(3000, THREE.AdditiveBlending, atlas);
    this.alpha = new PointPool(1600, THREE.NormalBlending, atlas);
    scene.add(this.add.points, this.alpha.points);
    const brass = new THREE.MeshStandardMaterial({ color: '#d9a640', metalness: 1, roughness: 0.25 });
    this.shells = new Debris(scene, new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6), brass, 120);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#9fc4d8', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    this.glass = new Debris(scene, new THREE.PlaneGeometry(0.12, 0.08), glass, 150);
    const chunk = new THREE.MeshStandardMaterial({ color: '#5a514a', roughness: 0.9 });
    this.chunks = new Debris(scene, new THREE.DodecahedronGeometry(0.07, 0), chunk, 150);
    this.floorAt = null;
    this.onShellBounce = null;
  }

  setScale(px) { this.add.mat.uniforms.uScale.value = px; this.alpha.mat.uniforms.uScale.value = px; }

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
    this.shells.update(dt, this.floorAt);
    this.glass.update(dt, this.floorAt);
    this.chunks.update(dt, this.floorAt);
  }

  clear() {
    this.add.clear(); this.alpha.clear();
    this.shells.clear(); this.glass.clear(); this.chunks.clear();
  }

  // ---------------------------------------------------------- effects
  muzzle(x, y, z, dir, big = false) {
    const s = big ? 1.4 : 1;
    this.add.spawn({ x: x + dir * 0.05, y, z, size: 0.9 * s, size1: 0.2, life: 0.06, color: [6, 4, 2, 1], color1: [2, 0.6, 0.1, 0], sprite: 0 });
    for (let i = 0; i < 6; i++) this.add.spawn({ x, y, z, vx: dir * rand(8, 20), vy: rand(-3, 3), size: 0.18 * s, size1: 0.02, life: rand(0.05, 0.12), color: [5, 3.2, 1.2, 1], color1: [2, 0.4, 0, 0], sprite: 2, stretch: 3 });
    this.alpha.spawn({ x: x + dir * 0.2, y, z, vx: dir * 1.5, vy: 0.6, size: 0.35, size1: 1.1, life: 0.7, color: [0.55, 0.55, 0.58, 0.35], color1: [0.4, 0.4, 0.45, 0], sprite: 1, spin: rand(-1, 1) });
  }

  shell(x, y, z, dir) {
    this.shells.spawn({ x, y, z: z + 0.05, vx: -dir * rand(1.5, 3), vy: rand(3, 5), vz: rand(-0.5, 1), spin: 25, life: 3, onBounce: this.onShellBounce });
  }

  sparks(x, y, z, n = 12, dirX = 0, color = [5, 3, 1.2]) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(3, 11);
      this.add.spawn({ x, y, z, vx: Math.cos(a) * sp + dirX * 5, vy: Math.sin(a) * sp + 2, vz: rand(-2, 2), gravity: 18, drag: 1.5, size: rand(0.06, 0.13), size1: 0.01, life: rand(0.25, 0.7), color: [...color, 1], color1: [color[0] * 0.6, color[1] * 0.2, 0, 0], sprite: 2, stretch: 2.5, floor: 0 });
    }
    this.add.spawn({ x, y, z, size: 0.8, size1: 0.1, life: 0.08, color: [4, 3, 2, 1], color1: [1, 0.5, 0.2, 0] });
  }

  blood(x, y, z, dirX = 1, n = 14) {
    for (let i = 0; i < n; i++) {
      this.alpha.spawn({ x, y, z, vx: dirX * rand(1, 6) + rand(-1, 1), vy: rand(-1, 4), vz: rand(-1, 1), gravity: 14, drag: 0.8, size: rand(0.05, 0.14), size1: 0.03, life: rand(0.35, 0.8), color: [0.35, 0.02, 0.02, 0.95], color1: [0.2, 0.0, 0.0, 0], sprite: 0, floor: 0 });
    }
    this.alpha.spawn({ x, y, z, vx: dirX * 1.5, size: 0.3, size1: 0.8, life: 0.4, color: [0.4, 0.03, 0.03, 0.4], color1: [0.2, 0, 0, 0], sprite: 1 });
  }

  dust(x, y, z, n = 6, color = [0.6, 0.58, 0.55]) {
    for (let i = 0; i < n; i++) {
      this.alpha.spawn({ x: x + rand(-0.3, 0.3), y: y + 0.05, z: z + rand(-0.2, 0.2), vx: rand(-1.5, 1.5), vy: rand(0.2, 1), size: rand(0.2, 0.35), size1: rand(0.6, 1.0), life: rand(0.5, 0.9), color: [...color, 0.35], color1: [...color, 0], sprite: 1, drag: 2, spin: rand(-1, 1) });
    }
  }

  splash(x, y, z, n = 8) {
    for (let i = 0; i < n; i++) {
      this.add.spawn({ x, y: y + 0.02, z, vx: rand(-1.5, 1.5), vy: rand(1.5, 3.5), vz: rand(-1, 1), gravity: 14, size: 0.04, size1: 0.02, life: rand(0.2, 0.4), color: [0.5, 0.6, 0.75, 0.6], color1: [0.4, 0.5, 0.6, 0], sprite: 0, floor: y });
    }
  }

  explosion(x, y, z, scale = 1) {
    this.add.spawn({ x, y, z: z + 0.3, size: 5 * scale, size1: 1, life: 0.18, color: [8, 6, 3.5, 1], color1: [3, 1, 0.2, 0] });
    for (let i = 0; i < 26 * scale; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(2, 7) * scale;
      this.add.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2, vz: rand(-2, 2), drag: 2.5, gravity: -1, size: rand(0.8, 1.6) * scale, size1: rand(0.2, 0.6), life: rand(0.35, 0.8), color: [6, 2.6, 0.7, 1], color1: [1.2, 0.2, 0.05, 0], sprite: 1, spin: rand(-3, 3) });
    }
    for (let i = 0; i < 30 * scale; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(6, 18);
      this.add.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 4, vz: rand(-4, 4), gravity: 20, drag: 0.8, size: rand(0.08, 0.16), size1: 0.02, life: rand(0.5, 1.2), color: [6, 3.5, 1.2, 1], color1: [2, 0.4, 0, 0], sprite: 2, stretch: 2, floor: 0 });
    }
    for (let i = 0; i < 14 * scale; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(1, 4) * scale;
      this.alpha.spawn({ x: x + rand(-0.5, 0.5), y: y + rand(0, 0.8), z, vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp + 1.5, vz: rand(-1, 1), drag: 1.2, gravity: -0.6, size: rand(1, 2) * scale, size1: rand(3, 4.5) * scale, life: rand(1.6, 3), color: [0.12, 0.1, 0.1, 0.75], color1: [0.25, 0.24, 0.24, 0], sprite: 1, spin: rand(-0.6, 0.6) });
    }
    this.add.spawn({ x, y, z, size: 1, size1: 9 * scale, life: 0.35, color: [3, 2, 1.5, 0.8], color1: [1, 0.5, 0.2, 0], sprite: 3 });
    for (let i = 0; i < 10 * scale; i++) this.chunks.spawn({ x, y: y + 0.3, z, vx: rand(-7, 7), vy: rand(4, 11), vz: rand(-2, 2), life: rand(2, 4), scale: rand(0.6, 1.6) });
  }

  smoke(x, y, z, o = {}) {
    this.alpha.spawn({ x: x + rand(-0.1, 0.1), y, z, vx: (o.vx || 0) + rand(-0.2, 0.2), vy: o.vy ?? rand(0.6, 1.3), vz: rand(-0.1, 0.1), drag: 0.5, size: o.size ?? rand(0.5, 0.9), size1: o.size1 ?? rand(2, 3.5), life: o.life ?? rand(2.5, 4), color: o.color || [0.55, 0.57, 0.62, 0.22], color1: o.color1 || [0.6, 0.62, 0.68, 0], sprite: 1, spin: rand(-0.4, 0.4) });
  }

  steam(x, y, z) {
    this.smoke(x, y, z, { vy: rand(1.2, 2.2), size: 0.4, size1: rand(2.2, 3.2), life: rand(1.8, 2.8), color: [0.75, 0.78, 0.85, 0.16], color1: [0.8, 0.82, 0.9, 0] });
  }

  embers(x, y, z, n = 1, spread = 1) {
    for (let i = 0; i < n; i++) {
      this.add.spawn({ x: x + rand(-spread, spread), y: y + rand(0, 0.5), z: z + rand(-0.5, 0.5), vx: rand(-0.6, 0.6), vy: rand(1, 3.2), vz: rand(-0.3, 0.3), drag: 0.6, gravity: -0.3, size: rand(0.03, 0.07), size1: 0.0, life: rand(1.5, 3.5), color: [5, 1.6, 0.3, 1], color1: [2, 0.2, 0, 0], sprite: 0 });
    }
  }

  glow(x, y, z, color = [3, 3, 3], size = 1, life = 0.15) {
    this.add.spawn({ x, y, z, size, size1: size * 0.3, life, color: [...color, 1], color1: [...color, 0] });
  }

  ring(x, y, z, color = [2, 2, 2], size = 3, life = 0.4) {
    this.add.spawn({ x, y, z, size: 0.2, size1: size, life, color: [...color, 1], color1: [...color, 0], sprite: 3 });
  }

  sparkle(x, y, z, color = [3, 2.4, 1]) {
    this.add.spawn({ x: x + rand(-0.4, 0.4), y: y + rand(-0.2, 0.5), z: z + 0.2, vy: rand(0.3, 0.8), size: rand(0.08, 0.18), size1: 0, life: rand(0.5, 1), color: [...color, 1], color1: [...color, 0], sprite: 0 });
  }

  glassBurst(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) this.glass.spawn({ x, y, z, vx: rand(-4, 4), vy: rand(1, 6), vz: rand(-1, 3), life: rand(1.5, 3), scale: rand(0.4, 1.2), bounce: 0.25 });
  }
}
