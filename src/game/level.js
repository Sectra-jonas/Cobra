// Level construction + runtime: places props (registering their colliders, ladders,
// light sources, emitters and animations), pickups, Ingrid spots, scripted
// encounters, ambient spawning and the exit.
import * as THREE from 'three';
import { mat, box } from '../core/materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const PROP_MODULES = ['../props/city.js', '../props/vehicles.js', '../props/rural.js', '../props/factory.js'];

export async function loadProps() {
  const all = {};
  await Promise.all(PROP_MODULES.map(async (p) => {
    try {
      const m = await import(p);
      Object.assign(all, m);
    } catch (e) {
      console.warn('[cobra] prop module unavailable', p, e.message);
    }
  }));
  return all;
}

// Nodes of a prop that its update() moves: named / userData.dynamic nodes (the convention for
// animated parts) plus any whose transform changes over a few sampled updates. null when the
// update cannot run standalone, in which case the whole prop stays dynamic.
function animatedNodes(root, update) {
  const nodes = [];
  root.traverse((n) => nodes.push(n));
  const before = nodes.map((n) => [n.position.clone(), n.quaternion.clone(), n.scale.clone()]);
  try {
    for (const t of [0.13, 0.71, 1.9, 3.7, 6.3, 11.1]) update(1 / 60, t);
  } catch (e) {
    return null;
  }
  const moving = new Set();
  nodes.forEach((n, i) => {
    const [p, q, s] = before[i];
    const moved = !n.position.equals(p) || !n.quaternion.equals(q) || !n.scale.equals(s);
    if (moved || (n !== root && (n.name || n.userData.dynamic))) moving.add(n);
    n.position.copy(p);
    n.quaternion.copy(q);
    n.scale.copy(s);
  });
  return moving;
}

let ladderMats = null;
export function makeLadderMesh(height, width = 0.55) {
  ladderMats ||= { rail: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.45, metalness: 0.85 }) };
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, height + 0.9, 0.05), ladderMats.rail);
    r.position.set(sx * width / 2, (height + 0.9) / 2, 0);
    r.castShadow = true;
    g.add(r);
  }
  const n = Math.floor(height / 0.32);
  const rung = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, width, 6).rotateZ(Math.PI / 2), ladderMats.rail, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) { d.position.set(0, 0.25 + i * 0.32, 0); d.updateMatrix(); rung.setMatrixAt(i, d.matrix); }
  rung.castShadow = true;
  g.add(rung);
  return g;
}

export class LevelBuilder {
  constructor(game, def, props) {
    this.game = game;
    this.def = def;
    this.props = props;
    this.scene = game.scene;
    this.world = game.world;
    this.updaters = [];
    this.emitters = [];
    this.burgers = [];
    this.pickups = [];
    this.ingridSpots = [];
    this.encounters = [];
    this.doors = [];
    this.checkpoints = [];
    this.missing = new Set();
    this.exitX = def.length - 10;
    this.hazardMeshes = [];
    this.lightLinks = [];
    // for the readability accents (accents.js): the object each ledge/solid came from, and
    // where each ladder's rails are drawn ({ z, w } or null when its visuals are not rails)
    this.walkSrc = new Map();
    this.ladderVis = new Map();
  }

  syncLights() {
    for (const k of this.lightLinks) {
      const I = k.L.intensity ?? 0;
      k.src.intensity = I * k.scale;
      k.src.on = I > 0.01;
      if (k.L.color !== undefined && k.L.color !== k.lastColor) { k.src.color.set(k.L.color); k.lastColor = k.L.color; }
    }
  }

  has(name) { return typeof this.props[name] === 'function'; }

  prop(name, opts = {}) {
    const f = this.props[name];
    if (f) {
      try { return f(opts); } catch (e) { console.error('[cobra] prop failed', name, e); }
    }
    this.missing.add(name);
    return null;
  }

  /** Places a prop group (or creates one by name) and registers its gameplay data. */
  place(objOrName, x, y = 0, z = 0, o = {}) {
    const obj = typeof objOrName === 'string' ? this.prop(objOrName, o.opts || {}) : objOrName;
    if (!obj) return null;
    obj.position.set(x, y, z);
    if (o.flip) obj.scale.x *= -1;
    if (o.scale) obj.scale.multiplyScalar(o.scale);
    if (o.rotY) obj.rotation.y = o.rotY;
    this.scene.add(obj);
    const ud = obj.userData || {};
    const fx = o.flip ? -1 : 1;
    const s = o.scale || 1;
    if (o.colliders !== false) {
      for (const c of ud.colliders || []) {
        const ax = x + c.x0 * fx * s, bx = x + c.x1 * fx * s;
        if (c.type === 'ledge') this.walkSrc.set(this.world.addLedge(Math.min(ax, bx), Math.max(ax, bx), y + c.y * s, { tag: o.tag }), obj);
        else if (c.type === 'solid') this.walkSrc.set(this.world.addSolid(Math.min(ax, bx), Math.max(ax, bx), y + c.y0 * s, y + c.y1 * s, { tag: o.tag }), obj);
      }
      for (const l of ud.ladders || []) {
        const lad = this.world.addLadder(x + l.x * fx * s, y + l.y0 * s, y + l.y1 * s);
        this.ladderVis.set(lad, l.z === undefined || l.stairs ? null : { z: z + l.z * s, w: (l.w ?? 0.44) * s });
      }
      if (ud.hazard) {
        const h = ud.hazard;
        this.world.addHazard(x + Math.min(h.x0 * fx, h.x1 * fx) * s, x + Math.max(h.x0 * fx, h.x1 * fx) * s, y + (h.y0 ?? -1) * s, y + (h.y1 ?? h.y ?? 0.3) * s, 'molten');
      }
      if (ud.speed && ud.colliders) {
        // conveyors: give their ledges a carry velocity
        for (const l of this.world.ledges.slice(-ud.colliders.length)) l.vx = ud.speed * fx;
      }
    }
    if (o.lights !== false) {
      for (const L of ud.lights || []) {
        const p = L.pos.clone();
        p.x *= fx * s; p.y *= s; p.z *= s;
        if (o.rotY) p.applyAxisAngle(UP, o.rotY);
        p.add(obj.position);
        const src = this.game.lights.addSource({ pos: p, color: L.color, intensity: (L.intensity ?? 30) * (o.lightScale ?? 1), distance: L.distance ?? 12, flicker: L.flicker, pulse: L.pulse, priority: L.priority });
        // animated props (police lightbars, beacons, blinking neon) write into their light entries
        // two conventions: props that hold a `ref` drive the pooled light themselves (ref.src);
        // others animate L.intensity / L.color, which syncLights() copies every frame
        if (L.ref) L.ref.src = src;
        else if (ud.update || ud.setLights) this.lightLinks.push({ L, src, scale: o.lightScale ?? 1 });
      }
    }
    for (const e of ud.emitters || []) {
      const p = e.pos.clone();
      p.x *= fx * s; p.y *= s; p.z *= s;
      if (o.rotY) p.applyAxisAngle(UP, o.rotY);
      p.add(obj.position);
      this.emitters.push({ type: e.type, pos: p, rate: e.rate ?? 4, acc: Math.random() });
    }
    if (ud.update) this.updaters.push(ud.update);
    obj.traverse((m) => {
      if (m.isMesh) {
        m.receiveShadow = true;
        if (o.shadows === false) m.castShadow = false;
      }
    });
    if (o.static !== false) {
      obj.updateMatrixWorld(true);
      // Freeze every transform the prop never animates. update() mostly drives materials and
      // lights (neon flicker, beacons); only the nodes it actually moves keep recomputing their
      // matrices each frame (in the city that was ~1500 meshes of otherwise static buildings).
      const moving = ud.update ? animatedNodes(obj, ud.update) : new Set();
      if (moving) obj.traverse((m) => { m.matrixAutoUpdate = moving.has(m); });
    }
    return obj;
  }

  ledge(x0, x1, y, o = {}) { return this.world.addLedge(x0, x1, y, o); }
  solid(x0, x1, y0, y1, o = {}) { return this.world.addSolid(x0, x1, y0, y1, o); }

  ladder(x, y0, y1, o = {}) {
    const lad = this.world.addLadder(x, y0, y1);
    if (o.visual !== false) {
      const m = makeLadderMesh(y1 - y0);
      m.position.set(x, y0, o.z ?? -0.35);
      this.ladderVis.set(lad, { z: o.z ?? -0.35, w: 0.55 });
      this.scene.add(m);
      m.updateMatrixWorld(true);
      m.traverse((c) => { c.matrixAutoUpdate = false; });
    }
  }

  /** Simple textured block (fallback geometry / level dressing). */
  block(x0, x1, y0, y1, z0, z1, material, o = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const m = new THREE.Mesh(box(w, h, d, o.mpt || 2, new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), typeof material === 'string' ? mat(material) : material);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = o.shadow !== false;
    m.receiveShadow = true;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    this.scene.add(m);
    if (o.solid) this.walkSrc.set(this.world.addSolid(x0, x1, y0, y1), m);
    if (o.ledge) this.walkSrc.set(this.world.addLedge(x0, x1, y1), m);
    return m;
  }

  light(x, y, z, color, intensity = 30, distance = 12, extra = {}) {
    return this.game.lights.addSource({ pos: new THREE.Vector3(x, y, z), color, intensity, distance, ...extra });
  }

  emitter(type, x, y, z, rate = 4) { this.emitters.push({ type, pos: new THREE.Vector3(x, y, z), rate, acc: Math.random() }); }
  burger(x, y, weapon) { this.burgers.push({ x, y, weapon }); }
  pickup(kind, x, y) { this.pickups.push({ kind, x, y }); }
  ingrid(x, y) { this.ingridSpots.push({ x, y }); }
  door(x, y = 0) { this.doors.push({ x, y }); }
  checkpoint(x, y = 0) { this.checkpoints.push({ x, y }); }
  encounter(x, spawns, o = {}) { this.encounters.push({ x, spawns, done: false, ...o }); }
  exit(x) { this.exitX = x; }
  update(fn) { this.updaters.push(fn); }
}
