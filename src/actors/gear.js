// Hand-held gear: weapons and props attached to rig hands. Each model is oriented
// for the right hand joint: grip at origin, barrel/blade pointing along +z (forward
// when the arm is raised horizontally the hand's -y points forward, so models are
// built along -y and rotated in `forHand`).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mats = {};
function m(key, make) { return mats[key] || (mats[key] = make()); }
const blued = () => m('blued', () => new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.3, metalness: 0.9 }));
const steel = () => m('steel', () => new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.18, metalness: 1 }));
const darkSteel = () => m('dsteel', () => new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.35, metalness: 0.9 }));
const grip = () => m('grip', () => new THREE.MeshStandardMaterial({ color: '#3b2516', roughness: 0.5 }));
const ivory = () => m('ivory', () => new THREE.MeshStandardMaterial({ color: '#e7dcc4', roughness: 0.35 }));
const polymer = () => m('poly', () => new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.65 }));
const laserRed = () => m('laser', () => new THREE.MeshStandardMaterial({ color: '#200000', emissive: '#ff1010', emissiveIntensity: 6 }));
const wood = () => m('wood', () => new THREE.MeshStandardMaterial({ color: '#5b3a22', roughness: 0.7 }));
const olive = () => m('olive', () => new THREE.MeshStandardMaterial({ color: '#3e4a2c', roughness: 0.6, metalness: 0.3 }));

function bx(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); }
function cyl(r0, r1, h, x = 0, y = 0, z = 0, axis = 'z', seg = 12) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
function meshOf(parts) {
  const g = new THREE.Group();
  for (const [geos, mat] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

// Side-profile extrusion: pts are [forward, up] pairs (model z, model y), extruded symmetric in x.
function prof(pts, width, bevel = 0.0012) {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> model +z, extrusion -> model x
  return g.toNonIndexed();
}
// Orients a support anchor: fingers point along `fingers`, thumb along `thumb` (model space).
function orientAnchor(o, fingers, thumb) {
  const y = new THREE.Vector3(...fingers).normalize().negate();
  const z = new THREE.Vector3(...thumb);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return o;
}
function tube(points, r, seg = 16) {
  const c = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(c, seg, r, 5, false).toNonIndexed();
}
const gold = () => m('gold', () => new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.25, metalness: 1 }));
const bore = () => m('bore', () => new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.9 }));

// Wraps a model built along +z (muzzle forward, +y up, origin = centre of the grip where the
// fist closes) so it sits in the right hand's grip pose.
// A number instead of a hold point keeps the legacy placement (knives, tubes): offset along the arm.
function forHand(model, hold = [0.03, -0.085, 0.0]) {
  const wrap = new THREE.Group();
  model.rotation.x = Math.PI / 2; // +z -> -y (along the arm), +y -> +z (up when the arm is extended)
  if (typeof hold === 'number') model.position.set(0, -0.075 - hold, 0.012);
  else model.position.set(hold[0], hold[1], hold[2]);
  wrap.add(model);
  return wrap;
}

/** Cobretti's custom Colt .45 Gold Cup: polished slide, ivory grips with a gold cobra inlay.
 * Anchors: userData.muzzle, userData.support (where the off hand cups the grip). */
export function makePistol() {
  const slide = prof([[-0.078, 0.043], [0.132, 0.043], [0.132, 0.066], [0.124, 0.072], [-0.071, 0.072], [-0.078, 0.066]], 0.024, 0.0018);
  // rear slide serrations as shallow ribs
  const ribs = [];
  for (let i = 0; i < 6; i++) ribs.push(bx(0.0255, 0.022, 0.0016, 0, 0.057, -0.07 + i * 0.0045));
  const frame = prof([[-0.064, 0.026], [0.095, 0.03], [0.095, 0.044], [-0.064, 0.044]], 0.022, 0.001);
  const gripG = prof([[0.014, 0.03], [-0.003, -0.054], [-0.038, -0.058], [-0.056, 0.026], [-0.074, 0.04], [-0.066, 0.045], [-0.052, 0.034]], 0.031, 0.003);
  const guard = tube([[0.012, 0.03, 0], [0.018, 0.012, 0], [0.04, 0.008, 0], [0.056, 0.02, 0], [0.058, 0.031, 0]].map(([z, y, x]) => [x, y, z]), 0.0028, 12);
  const trig = bx(0.006, 0.016, 0.006, 0, 0.022, 0.03);
  const hammer = bx(0.008, 0.014, 0.01, 0, 0.074, -0.078);
  const sights = [bx(0.004, 0.006, 0.01, 0, 0.075, 0.122), bx(0.016, 0.006, 0.008, 0, 0.075, -0.064)];
  const bush = cyl(0.0095, 0.0095, 0.006, 0, 0.056, 0.134, 'z', 14);
  const muzzleBore = cyl(0.0048, 0.0048, 0.004, 0, 0.056, 0.1375, 'z', 10);
  const slideStop = cyl(0.003, 0.003, 0.004, 0.013, 0.036, 0.01, 'x', 8);
  // cobra inlay (coiled emblem) on both grip panels
  const inlay = [];
  for (const sd of [1, -1]) {
    const e = new THREE.TorusGeometry(0.0085, 0.0018, 4, 14, Math.PI * 1.6);
    e.rotateY(Math.PI / 2);
    e.translate(sd * 0.0165, -0.012, -0.024);
    inlay.push(e.toNonIndexed());
    const head = new THREE.SphereGeometry(0.003, 6, 4).scale(1, 1, 1.6);
    head.translate(sd * 0.0168, -0.002, -0.017);
    inlay.push(head.toNonIndexed());
  }
  const g = meshOf([
    [[slide, frame, bush, ...sights], steel()],
    [[...ribs, guard, trig, hammer, slideStop], darkSteel()],
    [[gripG], ivory()],
    [inlay, gold()],
    [[muzzleBore], bore()],
  ]);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.056, 0.142);
  const support = new THREE.Object3D(); // off hand cups the shooting fist from the left
  support.position.set(0.038, -0.038, -0.004);
  orientAnchor(support, [-0.55, -0.72, 0.2], [0.15, 0.35, 0.92]);
  g.add(muzzle, support);
  const w = forHand(g);
  w.userData.muzzle = muzzle;
  w.userData.support = support;
  return w;
}

/** Laser-sighted Jatimatic SMG (angled receiver, folding foregrip, under-barrel laser).
 * Anchors: userData.muzzle, userData.laser (emitter), userData.support (foregrip). */
export function makeSMG() {
  const receiver = prof([[-0.075, 0.028], [0.165, 0.028], [0.165, 0.07], [0.04, 0.074], [-0.06, 0.098], [-0.075, 0.094]], 0.04, 0.002);
  const topRib = prof([[-0.05, 0.096], [0.03, 0.078], [0.03, 0.083], [-0.05, 0.101]], 0.012, 0.0008);
  const gripG = prof([[0.012, 0.03], [-0.004, -0.058], [-0.036, -0.062], [-0.05, 0.03]], 0.03, 0.003);
  const mag = prof([[0.036, 0.03], [0.06, 0.03], [0.072, -0.12], [0.05, -0.122]], 0.024, 0.0015);
  const fore = prof([[0.118, 0.03], [0.142, 0.03], [0.146, -0.062], [0.124, -0.064]], 0.022, 0.003);
  const guard = tube([[0, 0.03, 0.012], [0, 0.012, 0.018], [0, 0.009, 0.034]], 0.0028, 8);
  const shroud = cyl(0.0135, 0.0135, 0.06, 0, 0.052, 0.19, 'z', 14);
  const vents = [];
  for (let i = 0; i < 4; i++) vents.push(cyl(0.0142, 0.0142, 0.004, 0, 0.052, 0.168 + i * 0.013, 'z', 14));
  const barrel = cyl(0.0075, 0.0075, 0.035, 0, 0.052, 0.235, 'z', 10);
  const laserBody = cyl(0.0125, 0.0125, 0.085, 0, 0.012, 0.172, 'z', 14);
  const laserMount = bx(0.012, 0.016, 0.04, 0, 0.022, 0.17);
  const handle = cyl(0.004, 0.004, 0.022, 0.026, 0.085, -0.03, 'x', 8);
  const lens = cyl(0.009, 0.009, 0.003, 0, 0.012, 0.2155, 'z', 12);
  const g = meshOf([
    [[receiver, mag, shroud, barrel], blued()],
    [[topRib, ...vents, laserMount, handle, guard], darkSteel()],
    [[gripG, fore], polymer()],
    [[laserBody], steel()],
    [[lens], laserRed()],
  ]);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.052, 0.255);
  const laser = new THREE.Object3D();
  laser.position.set(0, 0.012, 0.218);
  const support = new THREE.Object3D(); // off hand wraps the folding foregrip
  support.position.set(0.028, -0.042, 0.13);
  orientAnchor(support, [-0.85, -0.2, 0.45], [0.15, 0.95, 0.1]);
  g.add(muzzle, laser, support);
  const w = forHand(g);
  w.userData.muzzle = muzzle;
  w.userData.laser = laser;
  w.userData.support = support;
  return w;
}

/** Throwing knife held blade-forward. */
export function makeKnife() {
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.012); blade.lineTo(0.16, -0.004); blade.quadraticCurveTo(0.2, 0.0, 0.17, 0.014); blade.lineTo(0, 0.014); blade.closePath();
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  bg.rotateY(-Math.PI / 2);
  bg.translate(0.002, 0.0, 0.02);
  const g = meshOf([
    [[bg.toNonIndexed()], steel()],
    [[cyl(0.014, 0.012, 0.1, 0, 0, -0.04)], polymer()],
    [[bx(0.06, 0.012, 0.012, 0, 0, 0.015)], darkSteel()],
  ]);
  return forHand(g, 0.0);
}

/** The Night Slasher's spiked hunting knife with knuckle-spike guard. */
export function makeSlasherKnife() {
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.02); blade.lineTo(0.26, -0.012); blade.quadraticCurveTo(0.33, 0.0, 0.28, 0.03); blade.lineTo(0.12, 0.024);
  for (let i = 0; i < 5; i++) { blade.lineTo(0.11 - i * 0.022, 0.034); blade.lineTo(0.1 - i * 0.022, 0.024); }
  blade.lineTo(0, 0.024); blade.closePath();
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  bg.rotateY(-Math.PI / 2);
  bg.translate(0.003, 0, 0.03);
  const spikes = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(0.006, 0.03, 5);
    c.rotateX(Math.PI / 2);
    c.translate(0, -0.03 - i * 0.012, -0.0 + 0.022);
    spikes.push(c.toNonIndexed());
  }
  const g = meshOf([
    [[bg.toNonIndexed()], steel()],
    [[cyl(0.016, 0.014, 0.11, 0, 0, -0.04)], grip()],
    [[bx(0.012, 0.075, 0.012, 0, -0.03, 0.02), bx(0.012, 0.012, 0.07, 0, -0.068, -0.015), ...spikes], darkSteel()],
  ]);
  return forHand(g, 0.0);
}

/** Bazooka tube (rests on right shoulder; attach to hand). */
export function makeBazooka() {
  const g = meshOf([
    [[cyl(0.055, 0.055, 1.2, 0, 0, 0.1, 'z', 16)], olive()],
    [[cyl(0.07, 0.065, 0.18, 0, 0, 0.66, 'z', 16), cyl(0.07, 0.06, 0.12, 0, 0, -0.5, 'z', 16), bx(0.03, 0.12, 0.05, 0, -0.08, 0.15), bx(0.03, 0.1, 0.04, 0, -0.07, -0.05)], darkSteel()],
  ]);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, 0.72);
  const support = new THREE.Object3D();
  support.name = 'support';
  support.position.set(0.03, -0.11, 0.15);
  orientAnchor(support, [-0.85, -0.25, 0.4], [0.1, 0.95, 0.2]);
  const grip = new THREE.Object3D();
  grip.name = 'grip';
  grip.position.set(-0.03, -0.11, -0.05);
  orientAnchor(grip, [0.85, -0.25, 0.4], [-0.1, 0.95, 0.2]);
  g.add(muzzle, support, grip);
  g.userData.support = support;
  g.userData.grip = grip;
  g.userData.muzzle = muzzle;
  const w = forHand(g, 0.0);
  w.userData.muzzle = muzzle;
  return w;
}

/** Cult axe (the New World gang's ritual axes). */
export function makeAxe() {
  const head = new THREE.Shape();
  head.moveTo(0, -0.04); head.lineTo(0.06, -0.05); head.quadraticCurveTo(0.16, -0.1, 0.17, 0.0); head.quadraticCurveTo(0.16, 0.1, 0.06, 0.05); head.lineTo(0, 0.04); head.closePath();
  const hg = new THREE.ExtrudeGeometry(head, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  hg.translate(0, 0, -0.006);
  hg.rotateZ(Math.PI / 2);
  hg.rotateY(Math.PI / 2);
  hg.translate(0, 0.0, 0.52);
  const g = meshOf([
    [[cyl(0.016, 0.019, 0.7, 0, 0, 0.22)], wood()],
    [[hg.toNonIndexed()], m('axeSteel', () => new THREE.MeshStandardMaterial({ color: '#7d8389', roughness: 0.42, metalness: 0.85 }))],
  ]);
  // hammer grip: haft runs out of the fist along the hand's +z
  const w = new THREE.Group();
  g.position.set(0, -0.08, -0.02);
  const support = new THREE.Object3D();
  support.position.set(0.03, 0, 0.22);
  orientAnchor(support, [-0.9, 0, 0.3], [0, 0, 1]);
  g.add(support);
  w.add(g);
  w.userData.support = support;
  return w;
}

/** Small round grenade/bomb ("B" bombs of the C64 version). */
export function makeBomb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), blued());
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), darkSteel());
  cap.position.y = 0.12;
  const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffb030', emissiveIntensity: 8 }));
  fuse.position.y = 0.16;
  g.add(body, cap, fuse);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.fuse = fuse;
  return g;
}

/** Frag grenade for the player. */
export function makeGrenade() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), olive());
  body.scale.y = 1.25;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.02), darkSteel());
  lever.position.set(0.04, 0.05, 0);
  g.add(body, lever);
  return g;
}

/** Thrown knife projectile (blade along +x). */
export function makeThrownKnife() {
  const k = makeKnife();
  const inner = k.children[0];
  inner.rotation.set(0, Math.PI / 2, 0);
  inner.position.set(0, 0, 0);
  return k;
}

/** Rocket projectile (nose along +x). */
export function makeRocket() {
  const g = meshOf([
    [[cyl(0.04, 0.04, 0.35, 0, 0, 0, 'x'), new THREE.ConeGeometry(0.04, 0.12, 10).rotateZ(-Math.PI / 2).translate(0.235, 0, 0).toNonIndexed()], olive()],
    [[bx(0.08, 0.12, 0.01, -0.15, 0, 0), bx(0.08, 0.01, 0.12, -0.15, 0, 0)], darkSteel()],
  ]);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 8).rotateZ(Math.PI / 2).translate(-0.33, 0, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.5), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

/** Handbag for the pram lady. */
export function makeHandbag() {
  const g = meshOf([
    [[bx(0.22, 0.16, 0.08, 0, -0.18, 0)], new THREE.MeshStandardMaterial({ color: '#5a2a3a', roughness: 0.4 })],
    [[new THREE.TorusGeometry(0.07, 0.008, 6, 14, Math.PI).translate(0, -0.1, 0).toNonIndexed()], darkSteel()],
  ]);
  return g;
}

/** The 4-in-1 hero burger: sesame bun, cheese, lettuce, tomato, patty. */
export function makeBurger(scale = 1) {
  const g = new THREE.Group();
  const bun = m('bun', () => new THREE.MeshPhysicalMaterial({ color: '#c97a2a', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color('#ffcf8a') }));
  const bunB = m('bunB', () => new THREE.MeshStandardMaterial({ color: '#d9a05a', roughness: 0.6 }));
  const patty = m('patty', () => new THREE.MeshStandardMaterial({ color: '#4a2412', roughness: 0.85 }));
  const cheese = m('cheese', () => new THREE.MeshPhysicalMaterial({ color: '#ffb318', roughness: 0.35, clearcoat: 0.4 }));
  const lettuce = m('lettuce', () => new THREE.MeshStandardMaterial({ color: '#3f9a2c', roughness: 0.5, side: THREE.DoubleSide }));
  const tomato = m('tomato', () => new THREE.MeshPhysicalMaterial({ color: '#c8231b', roughness: 0.25, clearcoat: 0.8 }));
  const seed = m('seed', () => new THREE.MeshStandardMaterial({ color: '#f3e3b8', roughness: 0.6 }));
  const top = new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  top.scale(1, 0.62, 1);
  const add = (geo, mat, y) => { const me = new THREE.Mesh(geo, mat); me.position.y = y; me.castShadow = true; g.add(me); return me; };
  add(new THREE.CylinderGeometry(0.29, 0.27, 0.09, 28), bunB, 0.045);
  add(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 28), patty, 0.13);
  const ch = new THREE.BoxGeometry(0.5, 0.015, 0.5);
  const chm = add(ch, cheese, 0.178);
  chm.rotation.y = 0.4;
  const tg = new THREE.CylinderGeometry(0.27, 0.27, 0.03, 24);
  add(tg, tomato, 0.2);
  const lg = new THREE.CylinderGeometry(0.34, 0.32, 0.025, 24, 1, true);
  const lp = lg.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const a = Math.atan2(lp.getZ(i), lp.getX(i));
    lp.setY(i, lp.getY(i) + Math.sin(a * 9) * 0.015);
  }
  lg.computeVertexNormals();
  add(lg, lettuce, 0.225);
  add(top, bun, 0.235);
  const seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 5, 4).scale(1, 0.5, 1.8), seed, 26);
  const dm = new THREE.Object3D();
  for (let i = 0; i < 26; i++) {
    const a = i * 2.4, r = 0.05 + (i % 7) * 0.035;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = 0.235 + Math.sqrt(Math.max(0, 0.09 - x * x - z * z)) * 0.62;
    dm.position.set(x, y + 0.003, z);
    dm.rotation.set(0, a, 0);
    dm.updateMatrix();
    seeds.setMatrixAt(i, dm.matrix);
  }
  g.add(seeds);
  g.scale.setScalar(scale);
  return g;
}
