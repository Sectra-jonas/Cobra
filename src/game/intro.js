// Opening cinematic + title-screen camera, staged in-engine on the Level 1 street.
//  0–9.5s   typewriter crime statistics over black (homage to the film's opening)
//  9.5–15.5 the '50 Mercury rolls in through the rain and pulls in to the kerb, Cobretti at the wheel
//  15.5–19.5 driver door swings open, boots hit the wet pavement, he climbs out, steps clear of
//            the door and swings it shut behind him
//  19.5–23.6 low-angle hero shot, lightning, match glow, the laser-sighted SMG comes up
//  23.6–24.5 the red dot finds the lens… BANG
//  24.5–30   COBRA logo slam on black, tagline types out
//  30+       title: slow dolly along the neon street, logo on top, menu
import * as THREE from 'three';
import { Poses, emptyPose, copyPose } from '../actors/rig.js';
import { makeLogo, animateLogo } from './logo.js';
import { sound } from '../core/sound.js';
import { input } from '../core/input.js';

const LINES = [
  'LOS ANGELES, 1986.',
  'EVERY 11 SECONDS, A BURGLARY.',
  'EVERY 65 SECONDS, AN ARMED ROBBERY.',
  'EVERY 25 SECONDS, A VIOLENT CRIME.',
  'EVERY 24 MINUTES, A MURDER.',
  '',
  'THE NIGHT SLASHER HAS KILLED 16 PEOPLE.',
  'THE COPS NEED SOMEONE WHO DOESN\'T PLAY BY THE RULES.',
];

const CSS = `
.intro-text { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 8; }
.intro-text .box { font-family: var(--font-type); color: #e8e4da; font-size: clamp(15px, 2.1vw, 26px); letter-spacing: .08em; line-height: 1.75; text-shadow: 0 0 10px rgba(255,255,255,.18); max-width: min(92vw, 900px); padding-inline: 16px; }
.intro-text .box .ln { min-height: 1.75em; white-space: pre-wrap; }
.intro-text .box .ln.red { color: #ff4a4a; text-shadow: 0 0 14px rgba(255,40,40,.5); }
.intro-text .caret { display: inline-block; width: .55em; height: 1em; background: #e8e4da; vertical-align: -0.12em; margin-left: 2px; animation: cblink .8s steps(2) infinite; }
@keyframes cblink { 50% { opacity: 0; } }
.tagline { position: absolute; left: 0; right: 0; top: 66%; text-align: center; font-family: var(--font-display); font-size: clamp(22px, 3.4vw, 46px); letter-spacing: .32em; color: #f3f1ea; opacity: 0; transition: opacity .6s, top 1.2s cubic-bezier(.6,0,.2,1), font-size 1.2s; text-shadow: 0 0 18px rgba(255,60,90,.55); pointer-events: none; z-index: 8; padding-inline: 16px; }
.tagline.on { opacity: 1; }
.tagline b { color: #ff3b4a; font-weight: 600; }
.tagline.title { top: 39%; font-size: clamp(14px, 1.7vw, 22px); letter-spacing: .45em; }
.laserdot { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px; border-radius: 50%; background: radial-gradient(circle, #fff 0 18%, #ff2a1a 30%, rgba(255,0,0,.35) 60%, transparent 72%); box-shadow: 0 0 40px 12px rgba(255,20,10,.55); opacity: 0; transform: scale(.4); transition: opacity .15s; pointer-events: none; z-index: 9; }
.skiphint { position: absolute; right: max(18px, env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom)); font-family: var(--font-mono); font-size: 13px; letter-spacing: .3em; color: rgba(255,255,255,.35); z-index: 9; pointer-events: none; }
`;

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => (a === b ? (x >= a ? 1 : 0) : ease(clamp01((x - a) / (b - a))));

// Keyframe track: keys [[t, v0, v1, ...], ...] -> values at time s. Cubic Hermite through the keys;
// tangents are flat at the ends, on holds (equal neighbouring values) and at local extrema, so
// planted feet stay planted and arcs peak where they should.
function slope(keys, i, j) {
  if (i === 0 || i === keys.length - 1) return 0;
  const a = keys[i - 1][j], b = keys[i][j], c = keys[i + 1][j];
  if (a === b || b === c || (b - a) * (c - b) < 0) return 0;
  return (c - a) / (keys[i + 1][0] - keys[i - 1][0]);
}
function track(keys, s, out = []) {
  const n = keys.length, m = keys[0].length;
  if (s <= keys[0][0] || s >= keys[n - 1][0]) {
    const k = s <= keys[0][0] ? keys[0] : keys[n - 1];
    for (let j = 1; j < m; j++) out[j - 1] = k[j];
    return out;
  }
  let i = 0;
  while (s > keys[i + 1][0]) i++;
  const k0 = keys[i], k1 = keys[i + 1], h = k1[0] - k0[0], u = (s - k0[0]) / h, u2 = u * u, u3 = u2 * u;
  for (let j = 1; j < m; j++) {
    const m0 = slope(keys, i, j) * h, m1 = slope(keys, i + 1, j) * h;
    out[j - 1] = (2 * u3 - 3 * u2 + 1) * k0[j] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * k1[j] + (u3 - u2) * m1;
  }
  return out;
}

// Hand orientation from where the fingers point and where the palm faces (world directions).
// Rig convention: hand -y = fingers, +z = thumb; the right palm faces +x, the left palm -x.
const _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hm = new THREE.Matrix4();
function handQuat(fingers, palm, side, out = new THREE.Quaternion()) {
  _hy.copy(fingers).normalize().negate();
  _hx.copy(palm).multiplyScalar(side === 'R' ? 1 : -1);
  _hx.addScaledVector(_hy, -_hx.dot(_hy)).normalize();
  _hz.crossVectors(_hx, _hy);
  return out.setFromRotationMatrix(_hm.makeBasis(_hx, _hy, _hz));
}

// ---- Cobretti climbs out of the Mercury (driver door). All positions are car-local (nose +x,
// driver side -z, ground y = 0); s = seconds from the start of the door shot, < 0 = driving.
// Hips: [s, x, y, z, yaw]; yaw is car-local (PI/2 = facing the nose, PI = facing out of the door).
// 'ST' marks the standing hip height (rig.hipH - 0.012), filled in per rig.
const ST = -1;
const EXIT_HIPS = [
  [0.00, -0.21, 0.42, -0.38, Math.PI / 2],
  [0.45, -0.21, 0.42, -0.38, Math.PI / 2],
  [0.80, -0.20, 0.435, -0.52, Math.PI / 2 + 1.0],
  [1.10, -0.21, 0.46, -0.64, Math.PI + 0.1],
  [1.30, -0.22, 0.48, -0.70, Math.PI + 0.1],
  [1.62, -0.24, 0.63, -0.95, Math.PI + 0.1],
  [1.88, -0.25, 0.86, -1.17, Math.PI + 0.1],
  [2.15, -0.25, ST, -1.27, Math.PI + 0.1],
  [2.22, -0.25, ST, -1.27, Math.PI + 0.1],
  [2.50, -0.45, ST, -1.56, Math.PI - 0.05],
  [2.75, -0.62, ST, -1.85, Math.PI - 0.15],
  [3.10, -0.62, ST, -1.85, Math.PI - 0.15],
  [3.65, -0.64, ST, -1.86, Math.PI + 0.3],
  [4.00, -0.64, ST, -1.86, Math.PI + 0.3],
];
// Torso: [s, hipsX, spineX, chestX, neckX, headX, headY, spineY]
const EXIT_TORSO = [
  [0.00, -0.48, 0.05, 0.10, 0.06, 0.18, 0.0, 0.0],
  [0.12, -0.48, 0.05, 0.10, 0.06, 0.18, 0.0, 0.0],
  [0.32, -0.44, 0.06, 0.10, 0.06, 0.18, 0.55, 0.0],
  [0.60, -0.22, 0.12, 0.12, 0.05, 0.18, 0.45, 0.15],
  [1.00, 0.05, 0.25, 0.12, 0.0, 0.28, 0.0, 0.0],
  [1.30, 0.25, 0.35, 0.15, 0.0, 0.18, 0.0, 0.0],
  [1.62, 0.40, 0.40, 0.15, -0.10, 0.0, 0.0, 0.0],
  [1.88, 0.25, 0.20, 0.08, -0.10, -0.05, 0.0, 0.0],
  [2.15, 0.0, 0.02, 0.0, -0.03, -0.05, 0.0, 0.0],
  [2.40, 0.0, 0.02, -0.02, -0.03, -0.05, -0.25, 0.0],
  [2.75, 0.0, 0.03, 0.0, -0.03, -0.04, 0.2, -0.18],
  [3.10, 0.0, 0.03, 0.0, -0.03, -0.04, 0.0, 0.0],
  [3.45, 0.0, 0.02, -0.02, -0.03, -0.06, 0.4, 0.0],
  [4.00, 0.0, 0.02, -0.02, -0.03, -0.04, 0.1, 0.0],
];
// Free-arm pose (where hand contacts are faded out): [s, shLX, shLZ, elLX, shRX, shRZ, elRX]
const EXIT_ARMS = [
  [0.00, -0.75, 0.15, -0.6, -0.75, -0.15, -0.6],
  [1.00, -0.55, 0.22, -0.8, -0.55, -0.22, -0.8],
  [2.20, 0.05, 0.13, -0.25, 0.06, -0.14, -0.3],
  [2.95, 0.10, 0.13, -0.25, 0.25, -0.30, -0.25],
  [3.40, 0.05, 0.13, -0.22, 0.06, -0.14, -0.28],
];
// Ankles: [s, x, y, z, pitch] (y = 0.085 is planted; pitch > 0 toes down)
const ANK = 0.086;
const EXIT_FOOT_L = [
  [0.00, 0.62, 0.36, -0.52, 0.3],
  [0.50, 0.62, 0.36, -0.52, 0.3],
  [0.68, 0.38, 0.55, -0.82, 0.25],
  [0.84, 0.06, 0.52, -1.12, 0.15],
  [1.00, -0.40, ANK, -1.30, 0],
  [2.20, -0.40, ANK, -1.30, 0],
  [2.33, -0.60, 0.22, -1.58, -0.15],
  [2.45, -0.78, ANK, -1.84, 0],
];
const EXIT_FOOT_R = [
  [0.00, 0.62, 0.36, -0.24, 0.3],
  [0.85, 0.62, 0.36, -0.24, 0.3],
  [1.02, 0.35, 0.56, -0.74, 0.25],
  [1.16, 0.10, 0.50, -1.08, 0.15],
  [1.32, -0.10, ANK, -1.32, 0],
  [2.40, -0.10, ANK, -1.32, 0],
  [2.55, -0.30, 0.24, -1.62, -0.15],
  [2.68, -0.50, ANK, -1.92, 0],
];
// Door swing (radians open): shoved open, swings out on its own with a little bounce, later
// swung shut from outside — the last key is past closed so it slams at full speed.
const EXIT_DOOR = [
  [0.30, 0.0], [0.55, 0.42], [0.80, 0.93], [0.92, 0.985], [1.10, 0.95],
  [2.70, 0.95], [2.86, 0.55], [3.00, 0.0], [3.06, -0.12],
];
// Hand contacts: anchor name, fade in a..b, fade out c..d, grip = closed fist.
const EXIT_HANDS = {
  L: [
    { anchor: 'wheelL', a: -9, b: -9, c: 0.10, d: 0.26 },
    { anchor: 'armrest', a: 0.10, b: 0.26, c: 0.46, d: 0.62, grip: false },
    { anchor: 'quarter', a: 1.00, b: 1.18, c: 1.72, d: 1.92, grip: false },
  ],
  R: [
    { anchor: 'wheelR', a: -9, b: -9, c: 0.72, d: 0.95 },
    { anchor: 'seat', a: 0.72, b: 0.95, c: 1.12, d: 1.36, grip: false },
    { anchor: 'doorTop', a: 1.12, b: 1.36, c: 2.24, d: 2.44 },
    { anchor: 'doorCorner', a: 2.52, b: 2.68, c: 2.84, d: 2.98 },
  ],
};
// Anchors: [x, y, z] position, fingers direction, palm normal; door: true = rides on the door.
const WHEEL = { c: [0.06, 0.80, -0.38], tilt: 0.5, r: 0.19 };
const ANCHORS = (() => {
  const up = [Math.sin(WHEEL.tilt), Math.cos(WHEEL.tilt), 0], nrm = [-Math.cos(WHEEL.tilt), Math.sin(WHEEL.tilt), 0];
  const rim = (deg) => {
    const b = (deg * Math.PI) / 180, c = WHEEL.c;
    return [c[0] + WHEEL.r * Math.sin(b) * up[0] + nrm[0] * 0.03, c[1] + WHEEL.r * Math.sin(b) * up[1] + nrm[1] * 0.03, c[2] + WHEEL.r * Math.cos(b)];
  };
  const grip = { fingers: [0.55, -0.83, 0], palm: [-nrm[0], -nrm[1], 0] };
  return {
    wheelL: { pos: rim(150), ...grip },
    wheelR: { pos: rim(30), ...grip },
    armrest: { pos: [-0.40, 0.70, -0.86], fingers: [0.6, 0.8, 0], palm: [0, 0, -1], door: true },
    seat: { pos: [0.05, 0.40, -0.66], fingers: [0, -0.2, -1], palm: [0, -1, 0] },
    quarter: { pos: [-0.74, 0.96, -0.92], fingers: [0, -0.4, -0.9], palm: [0, -1, 0.2] },
    doorTop: { pos: [0.05, 1.27, -0.86], fingers: [0, -0.5, -0.87], palm: [0, -0.87, 0.5], door: true },
    doorCorner: { pos: [-0.50, 1.25, -0.87], fingers: [0, -0.6, -0.8], palm: [0, -0.8, 0.6], door: true },
  };
})();
// Camera: [s, px, py, pz, lx, ly, lz, fov], car-local. Low behind the rear wheel on the boots,
// craning up as he rises; the door's chrome frame reads against the lit shop windows as it swings shut.
const EXIT_CAM = [
  [0.00, -2.70, 0.24, -3.05, -0.20, 0.42, -1.20, 31],
  [1.05, -2.55, 0.22, -2.95, -0.25, 0.38, -1.25, 31],
  [1.45, -2.65, 0.32, -3.05, -0.25, 0.62, -1.25, 31],
  [2.25, -2.95, 0.85, -3.55, -0.35, 1.12, -1.40, 33],
  [3.00, -3.20, 1.00, -3.70, -0.45, 1.20, -1.55, 34],
  [4.00, -2.95, 1.08, -3.50, -0.55, 1.30, -1.70, 30],
];

export class Director {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.text = document.createElement('div');
    this.text.className = 'intro-text';
    this.text.innerHTML = '<div class="box"></div>';
    ui.appendChild(this.text);
    this.tag = document.createElement('div');
    this.tag.className = 'tagline';
    ui.appendChild(this.tag);
    this.dot = document.createElement('div');
    this.dot.className = 'laserdot';
    ui.appendChild(this.dot);
    this.hint = document.createElement('div');
    this.hint.className = 'skiphint';
    this.hint.textContent = 'ENTER — SKIP';
    ui.appendChild(this.hint);
    this.hint.hidden = true;
    this.pose = emptyPose();
    this.mode = 'off';
  }

  // Must be called after the city level is loaded.
  attach() {
    const g = this.game;
    this.logo = makeLogo({ height: 1, renderer: g.renderer.gl });
    this.logoHolder = new THREE.Group();
    this.logoHolder.add(this.logo);
    g.camRig.cam.add(this.logoHolder);
    g.scene.add(g.camRig.cam);
    this.logoHolder.position.set(0, 0.35, -7.5);
    this.logo.scale.setScalar(1.25);
    this.setLogoVisible(false);
    // black curtain behind the logo (hides the world during the slam)
    this.curtain = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    this.curtain.position.set(0, 0, -9);
    this.curtain.renderOrder = 100;
    this.logo.traverse((o) => {
      if (!o.isMesh) return;
      o.renderOrder = 101;
      for (const m of [].concat(o.material)) { m.transparent = true; m.depthTest = false; m.fog = false; }
    });
    this.curtain.visible = false;
    g.camRig.cam.add(this.curtain);
    // laser beam toward the lens
    // overlay layer 2: seen by the main camera only (never by the wet-street reflection pass)
    this.logoHolder.traverse((o) => o.layers.set(2));
    this.curtain.layers.set(2);
    g.camRig.cam.layers.enable(2);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.15), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    g.scene.add(this.beam);
    this.car = g.startCar || null;
    this.carHome = this.car ? this.car.position.clone() : V(0.5, 0, 2.6);
    this.carYaw = this.car ? this.car.rotation.y : Math.PI;
    this.carState = { pitch: 0, pv: 0, roll: 0, rv: 0, d: 0, braking: false };
    this.tailMats = [];
    this.car?.getObjectByName('taillights')?.traverse((o) => { if (o.isMesh && o.material.emissive) this.tailMats.push(o.material); });
  }

  // Render the intro's camera set-ups once while the loading screen is still up, so shader programs
  // (reflection and shadow variants included) compile and the street's textures upload now rather
  // than as a multi-second hitch at the first cut.
  warmup() {
    const g = this.game, car = this.car, cam = g.camRig.cam;
    if (!car) return;
    const save = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    for (const o of g.introDressing || []) o.visible = true;
    const h = this.carHome, A = EXIT_CAM[0], B = EXIT_CAM[EXIT_CAM.length - 1];
    const views = [
      [V(h.x - 7.5, 0.4, h.z + 7.2), V(h.x + 38, 0.75, h.z + 1.3), 34],
      [V(h.x - 5, 0.6, h.z + 7.2), V(h.x - 0.3, 0.75, h.z), 30],
      [this.carW(A[1], A[2], A[3]), this.carW(A[4], A[5], A[6]), A[7]],
      [this.carW(B[1], B[2], B[3]), this.carW(B[4], B[5], B[6]), B[7]],
      [V(h.x - 1, 0.6, h.z + 6.5), V(h.x + 0.6, 1.5, h.z + 2), 30],
    ];
    views.forEach(([p, l, fov], i) => {
      cam.position.copy(p);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.lookAt(l);
      cam.updateMatrixWorld();
      // the chrome logo and its curtain go up with the last view (first drawn at the slam otherwise)
      const logo = i === views.length - 1;
      this.setLogoVisible(logo);
      this.curtain.visible = logo;
      if (logo) animateLogo(this.logo, 0.3, 'slam');
      g.render(1 / 60);
    });
    this.setLogoVisible(false);
    this.curtain.visible = false;
    for (const o of g.introDressing || []) o.visible = false;
    cam.position.copy(save.pos);
    cam.quaternion.copy(save.quat);
    cam.fov = save.fov;
    cam.updateProjectionMatrix();
  }

  // Put the Mercury back on its spot, doors shut, suspension at rest.
  parkCar() {
    const car = this.car;
    if (!car) return;
    Object.assign(this.carState, { pitch: 0, pv: 0, roll: 0, rv: 0, d: 0, braking: false });
    this.placeCar(0);
    car.rotation.x = car.rotation.z = 0;
    car.userData.setDoor?.(0);
    for (const m of this.tailMats) m.emissiveIntensity = 3;
    car.updateMatrixWorld(true);
    for (const L of car.userData.lights || []) if (L.ref && L.ref.src) L.ref.src.pos.copy(L.pos).applyMatrix4(car.matrixWorld);
  }

  setLogoVisible(v) {
    for (const L of this.logo.userData.letters) L.mesh.visible = v;
    this.logo.userData.line.visible = v;
    this.logo.userData.line2.visible = v;
    this.logo.userData.key.intensity = 0;
    if (!v) this.logo.userData.sweep.intensity = 0;
  }

  // ---------------------------------------------------------------- intro
  startIntro() {
    const g = this.game;
    this.mode = 'intro';
    this.t = 0;
    this.typed = { line: 0, ch: 0, acc: 0 };
    this.text.querySelector('.box').innerHTML = '';
    this.text.hidden = false;
    this.hint.hidden = false;
    g.state = 'cinematic';
    g.renderer.fade = 1;
    g.renderer.letterbox = 1;
    g.renderer.scan = 0.4;
    g.hud.show(false);
    const P = g.player;
    P.scripted = true;
    P.scriptVisible = false;
    P.scriptPose = this.pose;
    P.scriptPos = V(1.0, 0, 3.75);
    P.scriptYaw = Math.PI / 2;
    P.weapon = 'headbutt';
    P.rig.show('smg', false);
    P.rig.handIK.L = P.rig.handIK.R = null;
    for (const o of g.introDressing || []) o.visible = true;
    this.flags = {};
    if (this.car) {
      this.parkCar();
      this.carState.d = 38;
      this.placeCar(38);
    }
    sound.playMusic('intro', { fade: 0.2 });
    sound.setAmbience('rain');
  }

  skip() {
    sound.sfx('uiSelect');
    this.toTitle(true);
  }

  // ---------------------------------------------------------------- title
  toTitle(instant = false) {
    const g = this.game;
    this.mode = 'title';
    this.titleT = 0;
    this.text.hidden = true;
    this.hint.hidden = true;
    this.dot.style.opacity = 0;
    this.beam.visible = false;
    g.state = 'cinematic';
    g.renderer.fade = 0;
    g.renderer.letterbox = 0;
    g.renderer.scan = 0;
    const P = g.player;
    P.scripted = true;
    P.scriptVisible = true;
    P.scriptLaser = false;
    P.weapon = 'headbutt';
    P.scriptPos = V(3.4, 0, 0.0);
    P.scriptYaw = null;
    P.scriptRate = undefined;
    P.rig.handIK.L = P.rig.handIK.R = null;
    P.rig.setFacing(1);
    this.parkCar();
    for (const o of g.introDressing || []) o.visible = false;
    this.setLogoVisible(true);
    animateLogo(this.logo, 10, 'hold');
    this.curtain.visible = true;
    this.curtainFade = instant ? 0.0 : 1;
    this.curtain.material.opacity = this.curtainFade;
    this.tag.innerHTML = 'CRIME IS A DISEASE. <b>HE\'S THE CURE.</b>';
    this.tag.classList.add('on', 'title');
    if (instant) sound.playMusic('title', { fade: 0.6 });
    else setTimeout(() => { if (this.mode === 'title') sound.playMusic('title', { fade: 2.5 }); }, 2500);
    if (this.onTitle) this.onTitle();
  }

  // Leave the title: blend to gameplay.
  startGame() {
    const g = this.game;
    this.mode = 'outro';
    this.outT = 0;
    this.tag.classList.remove('on');
    const P = g.player;
    P.scripted = false;
    P.scriptLaser = false;
    P.body.x = 3.4; P.body.y = 0;
    P.control = true;
    P.facing = 1;
    g.camRig.override = null;
    g.camRig.snap(3.4, 0);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    if (this.mode === 'intro') this.updateIntro(dt);
    else if (this.mode === 'title') this.updateTitle(dt);
    else if (this.mode === 'outro') this.updateOutro(dt);
  }

  updateIntro(dt) {
    const g = this.game;
    // follow the score's clock when audio runs, so the logo slam lands on the music hit (24.0 s);
    // after a hitch the picture catches up with the music instead of trailing it for good
    const mt = sound.ready ? sound.musicTime() : null;
    if (typeof mt === 'number' && mt > 0.05 && mt > this.t - 2 && mt < this.t + 20) this.t = Math.max(this.t, mt);
    else this.t += dt;
    const t = this.t;
    const P = g.player;
    const p = this.pose;
    if (input.pressed('skip') && t > 0.6) { this.skip(); return; }

    // --- typewriter (0 - 9.5)
    if (t < 9.6) {
      this.typewriter(dt);
      g.renderer.fade = 1;
      if (Math.floor(t / 1.15) !== this.flags.hb && t > 0.8) { this.flags.hb = Math.floor(t / 1.15); sound.sfx('heartbeat', { volume: 0.6 }); }
    } else if (!this.flags.textOff) {
      this.flags.textOff = true;
      this.text.style.transition = 'opacity .6s';
      this.text.style.opacity = 0;
      setTimeout(() => { this.text.hidden = true; this.text.style.opacity = 1; }, 700);
    }

    const car = this.car;
    const home = this.carHome;
    let camPos, camLook, fov = 30;

    if (t >= 9.5 && t < 23.0) {
      P.scriptVisible = true;
      if (car) this.carBody(dt);
    }

    // --- shot 2: the Mercury cruises in along the kerb lane and pulls in (9.5 - 15.5)
    if (t >= 9.5 && t < 15.5) {
      g.renderer.fade = 1 - clamp01((t - 9.6) / 1.2);
      const k = clamp01((t - 9.5) / 5.6);
      if (car) this.driveCar(t - 9.5);
      this.carExit(-1); // at the wheel
      if (!this.flags.engine) { this.flags.engine = true; sound.sfx('carPass', { volume: 0.9 }); }
      if (t > 13.6 && !this.flags.idle) { this.flags.idle = true; sound.sfx('engineIdle', { volume: 0.7 }); }
      const cx = car ? car.position.x : 0, cz = car ? car.position.z : home.z;
      camPos = V(home.x - 7.5 + k * 2.5, 0.38 + k * 0.25, home.z + 7.2);
      camLook = V(cx - 0.8, 0.75, cz);
      fov = 34 - k * 4;
    }
    // --- shot 3: driver door, boots on the wet pavement, he rises and swings it shut (15.5 - 19.5)
    else if (t >= 15.5 && t < 19.5) {
      const s = t - 15.5;
      g.renderer.fade = 0;
      if (car) {
        this.placeCar(0);
        const door = car.userData.doors?.doorL;
        if (door) door.rotation.y = -Math.max(0, track(EXIT_DOOR, s)[0]);
      }
      this.carExit(s);
      this.exitEvents(s);
      const c = track(EXIT_CAM, s);
      camPos = car ? this.carW(c[0], c[1], c[2]) : V(home.x, 1, home.z + 4);
      camLook = car ? this.carW(c[3], c[4], c[5]) : V(home.x, 1, home.z);
      fov = c[6];
    }
    // --- shot 4: hero (19.5 - 23.0)
    else if (t >= 19.5 && t < 23.0) {
      if (!this.flags.shot4) {
        this.flags.shot4 = true;
        P.rig.handIK.L = P.rig.handIK.R = null;
        P.scriptRate = undefined;
        if (car) { this.placeCar(0); car.userData.setDoor?.(0, 'L'); }
      }
      const k = (t - 19.5) / 3.5;
      const walk = clamp01((t - 19.6) / 1.6);
      for (const k2 in p) p[k2] = 0;
      const { pos: start, yaw: startYaw } = this.exitSpot();
      const walkYaw = startYaw;
      const dir = V(Math.sin(walkYaw), 0, Math.cos(walkYaw)).multiplyScalar(1.55);
      const pos = start.clone().addScaledVector(dir, walk);
      if (walk < 1) { Poses.walk(p, (t - 19.6) * 5.25, 1); }
      else {
        Poses.idle(p, t, 1);
        const raise = ease(clamp01((t - 21.6) / 0.5));
        const q = copyPose(emptyPose(), p);
        Poses.aimSMG(q, 0, 0);
        for (const kk in p) p[kk] = p[kk] + (q[kk] - p[kk]) * raise;
      }
      P.weapon = t > 21.4 ? 'smg' : 'headbutt';
      P.rig.show('smg', t > 21.4);
      P.rig.show('pistol', false);
      P.scriptPos = pos;
      camPos = V(pos.x - 1.6 + k * 0.9, 0.45 + k * 0.25, pos.z + 4.4 - k * 0.8);
      camLook = V(pos.x + 0.15, 1.5, pos.z);
      fov = 34 - k * 6;
      // square up to the lens before the laser comes on
      const toCam = Math.atan2(camPos.x - pos.x, camPos.z - pos.z);
      P.scriptYaw = t < 19.6 ? startYaw : walk < 1 ? walkYaw : THREE.MathUtils.lerp(walkYaw, toCam, ease(clamp01((t - 21.3) / 0.6)));
      if (t > 20.4 && !this.flags.light) { this.flags.light = true; if (g.lightning) g.lightning.next = 0; }
      if (t > 20.9 && !this.flags.match) {
        this.flags.match = true;
        sound.sfx('matchStrike', { volume: 0.7 });
        if (P.rig.matchTip) { P.rig.matchTip.material.emissiveIntensity = 8; setTimeout(() => { if (P.rig.matchTip) P.rig.matchTip.material.emissiveIntensity = 0.5; }, 900); }
      }
      if (t > 21.3 && !this.flags.cock) { this.flags.cock = true; sound.sfx('gunCock'); }
      if (t > 21.8 && !this.flags.laser) { this.flags.laser = true; sound.sfx('laserOn'); }
      this.aimBeam(t > 21.8, camPos);
    }
    // --- shot 5: red dot on the lens (23.6 - 24.5)
    else if (t >= 23.0 && t < 23.85) {
      const pos = P.scriptPos;
      for (const k2 in p) p[k2] = 0;
      Poses.idle(p, t, 1);
      Poses.aimSMG(p, 0, 0);
      const k = (t - 23.0) / 0.85;
      camPos = V(pos.x - 0.05, 1.45, pos.z + 3.2 - k * 0.9);
      camLook = V(pos.x - 0.05, 1.42, pos.z);
      fov = 26;
      this.aimBeam(true, camPos);
      this.dot.style.opacity = 1;
      this.dot.style.transform = `scale(${0.5 + k * 1.6})`;
      if (t > 23.72 && !this.flags.bang) {
        this.flags.bang = true;
        sound.sfx('pistol', { volume: 1 });
        sound.sfx('impactBoom', { volume: 0.8 });
        g.renderer.doFlash('#ffffff', 1, 2.5);
        g.camRig.shake(0.8);
      }
    }
    // --- shot 6: logo slam (24.5 - 30)
    else if (t >= 23.85) {
      this.dot.style.opacity = 0;
      this.beam.visible = false;
      P.scriptVisible = false;
      this.curtain.visible = true;
      this.curtain.material.opacity = 1;
      g.renderer.letterbox = Math.max(0, 1 - (t - 23.85) * 2);
      const lt = t - 24.0;
      if (lt > 0) {
        if (!this.flags.logo) {
          this.flags.logo = true;
          this.setLogoVisible(true);
          sound.sfx('impactBoom', { volume: 1 });
          g.camRig.shake(0.9);
          g.renderer.doFlash('#ff2a4a', 0.35, 3);
          g.renderer.shock(1);
        }
        animateLogo(this.logo, lt, 'slam');
        this.logoSparks(lt);
      }
      if (t > 26.2 && !this.flags.tag1) { this.flags.tag1 = true; this.typeTag('CRIME IS A DISEASE.', ''); }
      if (t > 27.6 && !this.flags.tag2) { this.flags.tag2 = true; this.typeTag('CRIME IS A DISEASE.', ' HE\'S THE CURE.'); }
      camPos = V(-3000, 400, 0);
      camLook = V(-3000, 400, -10);
      fov = 30;
      if (g.rain) g.rain.mesh.visible = false;
      if (t > 30.5) { if (g.rain) g.rain.mesh.visible = true; this.toTitle(false); return; }
    }

    if (camPos) {
      g.camRig.override = { pos: camPos, look: camLook, fov, blendTime: 0.0001 };
      g.camRig.blend = 1;
    }
  }

  // ---------------------------------------------------------------- the Mercury
  // Car-local -> world for the intro Mercury (position + heading; body pitch/roll ignored, so
  // planted feet don't ride the suspension).
  carW(x, y, z, out = new THREE.Vector3()) {
    const car = this.car, c = Math.cos(car.rotation.y), s = Math.sin(car.rotation.y);
    return out.set(car.position.x + x * c + z * s, y, car.position.z - x * s + z * c);
  }

  // d = metres still to go to the parking spot. The approach runs in the kerb lane 1.3 m out and
  // eases in over the last 9 m; heading follows the path, front wheels steer with its curvature.
  placeCar(d) {
    const car = this.car, home = this.carHome;
    const lane = (x) => 1.3 * sstep(0, 9, x);
    const head = (x) => Math.atan((lane(x + 0.02) - lane(x - 0.02)) / 0.04);
    car.position.set(home.x + d, home.y, home.z + lane(d));
    car.rotation.y = this.carYaw - head(d);
    const steer = Math.atan(3.08 * (head(d + 0.1) - head(Math.max(0, d - 0.1))) / 0.2);
    for (const n of ['wheelFL', 'wheelFR']) { const w = car.getObjectByName(n); if (w) w.rotation.y = steer; }
  }

  // Shot 2 (s from 0): cruise at ~30 km/h, then brake at 4 m/s² to a stop on the spot at s = 5.6.
  driveCar(s) {
    const car = this.car, cs = this.carState, g = this.game;
    const V0 = 8.35, A = 4, T0 = 3.51, TB = V0 / A;
    const tb = Math.max(0, Math.min(s - T0, TB));
    const run = V0 * Math.max(0, Math.min(s, T0)) + V0 * tb - 0.5 * A * tb * tb;
    const d = Math.max(0, 38 - run);
    const ds = Math.max(0, Math.min(1, cs.d - d));
    cs.d = d;
    cs.braking = s > T0 && s < T0 + TB;
    this.placeCar(d);
    this.rollWheels(car, ds);
    car.updateMatrixWorld(true);
    // headlight pool lights ride along; rear tyres throw spray
    for (const L of car.userData.lights || []) if (L.ref && L.ref.src) L.ref.src.pos.copy(L.pos).applyMatrix4(car.matrixWorld);
    const speed = s < T0 ? V0 : Math.max(0, V0 - A * tb);
    if (speed > 0.8 && Math.random() < speed / 9) {
      for (const z of [-0.72, 0.72]) { const w = car.localToWorld(V(-1.55, 0, z)); g.particles.splash(w.x, 0, w.z, 2); }
    }
  }

  // Suspension: nose dives under braking and rebounds at the stop; the door slam rocks the body.
  carBody(dt) {
    const car = this.car, cs = this.carState;
    const h = Math.min(dt, 1 / 30);
    cs.pv += (((cs.braking ? -0.011 : 0) - cs.pitch) * 80 - cs.pv * 6) * h;
    cs.pitch += cs.pv * h;
    cs.rv += (-cs.roll * 140 - cs.rv * 7) * h;
    cs.roll += cs.rv * h;
    car.rotation.z = cs.pitch;
    car.rotation.x = cs.roll;
    for (const m of this.tailMats) m.emissiveIntensity = cs.braking ? 7 : 3;
  }

  // Where shot 3 leaves him (ground under the hips) and which way he faces, in world space.
  exitSpot() {
    const k = EXIT_HIPS[EXIT_HIPS.length - 1];
    if (!this.car) return { pos: V(this.carHome.x + 0.6, 0, this.carHome.z + 1.8), yaw: -0.5 };
    const c = Math.cos(this.carYaw), s = Math.sin(this.carYaw), h = this.carHome;
    return { pos: V(h.x + k[1] * c + k[3] * s, 0, h.z - k[1] * s + k[3] * c), yaw: k[4] + this.carYaw };
  }

  // Pose Cobretti in / out of the car at exit time s (< 0 = driving): keyed hips, torso and arms,
  // world-planted ankles via leg IK, hands on wheel / door / bodywork via arm IK.
  carExit(s) {
    const P = this.game.player, rig = P.rig, car = this.car, p = this.pose;
    if (!car) return;
    if (!this.exitHipKeys || this.exitHipRig !== rig) {
      this.exitHipRig = rig;
      this.exitHipKeys = EXIT_HIPS.map((k) => k.map((v, j) => (j === 2 && v === ST ? rig.hipH - 0.012 : v)));
    }
    const hip = track(this.exitHipKeys, s), tor = track(EXIT_TORSO, s), arm = track(EXIT_ARMS, s);
    for (const k in p) p[k] = 0;
    [p.hipsX, p.spineX, p.chestX, p.neckX, p.headX, p.headY, p.spineY] = tor;
    [p.shLX, p.shLZ, p.elLX, p.shRX, p.shRZ, p.elRX] = arm;
    p.hdLX = 0.05; p.hdRX = 0.05;
    const yaw = hip[3] + car.rotation.y;
    const hw = this.carW(hip[0], hip[1], hip[2]);
    const root = V(hw.x, hw.y - rig.hipH, hw.z);
    const fl = track(EXIT_FOOT_L, s), fr = track(EXIT_FOOT_R, s);
    rig.footIK(p, root, yaw, { L: [this.carW(fl[0], fl[1], fl[2]), fl[3]], R: [this.carW(fr[0], fr[1], fr[2]), fr[3]] });
    P.scriptPose = p;
    P.scriptPos = root;
    P.scriptYaw = yaw;
    P.scriptRate = 40;
    rig.yaw = yaw;
    if (!this.flags.seatSnap) { // first frame: no blend-in from whatever pose the rig held
      this.flags.seatSnap = true;
      copyPose(rig.pose, p);
      copyPose(rig.prevTarget, p);
    }
    this.exitHands(s);
  }

  exitHands(s) {
    const rig = this.game.player.rig, car = this.car;
    car.updateMatrixWorld(true);
    const door = car.userData.doors?.doorL;
    const cq = car.getWorldQuaternion(new THREE.Quaternion());
    const dq = door ? door.getWorldQuaternion(new THREE.Quaternion()) : cq;
    for (const sd of ['L', 'R']) {
      let W = 0, grip = true, quat = null;
      const pos = new THREE.Vector3();
      for (const c of EXIT_HANDS[sd]) {
        const w = sstep(c.a, c.b, s) * (1 - sstep(c.c, c.d, s));
        if (w <= 0.001) continue;
        const A = ANCHORS[c.anchor];
        const onDoor = A.door && door;
        const ap = V(A.pos[0], A.pos[1], A.pos[2]);
        const wp = onDoor ? door.localToWorld(ap.sub(door.position)) : car.localToWorld(ap);
        const q = handQuat(V(...A.fingers).applyQuaternion(onDoor ? dq : cq), V(...A.palm).applyQuaternion(onDoor ? dq : cq), sd);
        pos.addScaledVector(wp, w);
        if (!quat) quat = q; else quat.slerp(q, w / (W + w));
        W += w;
        if (w > 0.5 && c.grip === false) grip = false;
      }
      rig.handIK[sd] = W > 0.001 ? { pos: pos.multiplyScalar(1 / W), quat, w: Math.min(1, W), grip } : null;
    }
  }

  // Sounds and splashes of the exit.
  exitEvents(s) {
    const g = this.game, f = this.flags, car = this.car;
    if (!car) return;
    const foot = (keys) => { const k = track(keys, s); return this.carW(k[0], 0, k[2]); };
    if (s > 0.3 && !f.unlatch) { f.unlatch = true; sound.sfx('carDoor', { volume: 0.4, pitch: 1.5 }); }
    const steps = [[1.0, EXIT_FOOT_L, 1, 14], [1.32, EXIT_FOOT_R, 0.75, 9], [2.45, EXIT_FOOT_L, 0.45, 4], [2.68, EXIT_FOOT_R, 0.45, 4]];
    steps.forEach(([at, keys, vol, n], i) => {
      if (s > at && !f['step' + i]) {
        f['step' + i] = true;
        const w = foot(keys);
        sound.sfx('step', { volume: vol });
        g.particles.splash(w.x, 0, w.z, n);
      }
    });
    if (s > 3.0 && !f.slam) {
      f.slam = true;
      sound.sfx('carDoor', { volume: 1, pitch: 0.92 });
      this.carState.rv += 0.2;
      g.camRig.shake(0.12);
      for (const x of [-0.5, -0.1, 0.3]) { const w = this.carW(x, 1.22, -0.9); g.particles.splash(w.x, w.y, w.z, 4); }
    }
  }

  rollWheels(car, dx) {
    for (const n of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) {
      const w = car.getObjectByName(n);
      if (w) w.rotation.z -= dx / 0.36;
    }
  }

  aimBeam(on, camPos) {
    const P = this.game.player;
    const smg = P.rig.items.smg;
    if (!on || !smg || !smg.userData.laser) { this.beam.visible = false; return; }
    P.rig.root.updateMatrixWorld(true);
    const from = smg.userData.laser.getWorldPosition(new THREE.Vector3());
    const to = camPos.clone().add(new THREE.Vector3(0, -0.05, -0.4));
    const d = to.clone().sub(from);
    this.beam.position.copy(from);
    this.beam.scale.set(1, 1, d.length());
    this.beam.lookAt(to);
    this.beam.visible = true;
    this.game.particles.glow(from.x, from.y, from.z, [6, 0.3, 0.2], 0.12, 0.05);
  }

  logoSparks(lt) {
    const g = this.game;
    if (lt > 0.6) return;
    const cam = g.camRig.cam;
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.3) * 1.5, -6.5).applyMatrix4(cam.matrixWorld);
      g.particles.sparks(v.x, v.y, v.z, 3, 0, [6, 2.5, 1.5]);
    }
  }

  typewriter(dt) {
    const box = this.text.querySelector('.box');
    const T = this.typed;
    if (T.line >= LINES.length) return;
    T.acc += dt;
    const speed = 0.026;
    if (!box.children[T.line]) {
      if (T.acc < (T.line === 0 ? 0.5 : LINES[T.line] === '' ? 0.3 : 0.16)) return;
      const d = document.createElement('div');
      d.className = 'ln' + (T.line >= 6 ? ' red' : '');
      box.appendChild(d);
      T.acc = 0;
    }
    const line = LINES[T.line];
    const el = box.children[T.line];
    while (T.acc > speed && T.ch < line.length) {
      T.acc -= speed;
      T.ch++;
      if (line[T.ch - 1] !== ' ') sound.sfx('typewriter', { volume: 0.35 });
    }
    el.innerHTML = line.slice(0, T.ch) + '<span class="caret"></span>';
    if (T.ch >= line.length && T.acc > 0.18) {
      el.textContent = line;
      T.line++;
      T.ch = 0;
      T.acc = 0;
    }
  }

  typeTag(a, b) {
    this.tag.classList.add('on');
    this.tag.classList.remove('title');
    this.tag.innerHTML = b ? `${a}<b>${b}</b>` : a;
    sound.sfx('typewriter', { volume: 0.6 });
  }

  updateTitle(dt) {
    const g = this.game;
    this.titleT += dt;
    const t = this.titleT;
    const P = g.player;
    const p = this.pose;
    for (const k in p) p[k] = 0;
    Poses.idle(p, t + 3);
    P.scriptPose = p;
    P.scriptYaw = Math.PI * 0.32;
    // curtain fades to reveal the street
    if (this.curtainFade > 0) { this.curtainFade = Math.max(0, this.curtainFade - dt * 0.5); this.curtain.material.opacity = this.curtainFade; }
    if (this.curtainFade <= 0) this.curtain.visible = false;
    // logo glides to the top third
    const k = ease(clamp01(t / 1.6));
    this.logoHolder.position.set(0, THREE.MathUtils.lerp(0.35, 1.25, k), -7.5);
    this.logo.scale.setScalar(THREE.MathUtils.lerp(1.25, 0.82, k));
    animateLogo(this.logo, t + 10, 'hold');
    // slow neon dolly
    const sx = -3 + Math.sin(t * 0.05) * 9 + 6;
    const camPos = V(sx, 2.3 + Math.sin(t * 0.13) * 0.3, 12.5);
    const camLook = V(sx + 1.2, 2.9, 0);
    g.camRig.override = { pos: camPos, look: camLook, fov: 32, blendTime: 0.0001 };
    g.camRig.blend = 1;
  }

  updateOutro(dt) {
    const g = this.game;
    this.outT += dt;
    // logo flies up and away
    const k = ease(clamp01(this.outT / 0.9));
    this.logoHolder.position.y = THREE.MathUtils.lerp(1.25, 6, k);
    animateLogo(this.logo, this.outT + 10, 'hold');
    if (this.outT > 1.0 && this.mode === 'outro') {
      this.setLogoVisible(false);
      this.curtain.visible = false;
      this.mode = 'off';
      if (this.onGameStart) this.onGameStart();
    }
  }
}
