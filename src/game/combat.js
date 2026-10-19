// Weapons table, projectiles (bullets, knives, axes, rockets, bombs, grenades)
// and explosions.
import * as THREE from 'three';
import * as Gear from '../actors/gear.js';
import { sound } from '../core/sound.js';

export const WEAPONS = {
  headbutt: { name: 'HEADBUTT', dmg: 55, cooldown: 0.36, melee: true, tier: 0 },
  knife: { name: 'KNIFE', dmg: 75, cooldown: 0.3, speed: 26, drain: 0.03, duration: 28, tier: 1 },
  pistol: { name: '.45 COLT', dmg: 48, cooldown: 0.2, speed: 72, drain: 0.016, duration: 32, tier: 2 },
  smg: { name: 'LASER SMG', dmg: 24, cooldown: 0.072, speed: 80, drain: 0.0065, duration: 24, auto: true, spread: 0.03, tier: 3 },
};

const _tracerGeo = new THREE.PlaneGeometry(1, 1);
const tracerMats = {
  player: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  enemy: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};

let knifeProto = null, rocketProto = null, bombProto = null, grenadeProto = null, axeProto = null;

function segAABB(x0, y0, x1, y1, b) {
  // slab test; b: {x0,x1,y0,y1}
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, d, lo, hi] of [[x0, dx, b.x0, b.x1], [y0, dy, b.y0, b.y1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return -1; }
    else {
      let t0 = (lo - p) / d, t1 = (hi - p) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

let scorchTex = null;
function scorchTexture() {
  if (scorchTex) return scorchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 34;
    const gr = g.createRadialGradient(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0, 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 18 + Math.random() * 26);
    gr.addColorStop(0, 'rgba(0,0,0,0.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  scorchTex = new THREE.CanvasTexture(c);
  return scorchTex;
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
  }

  clear() {
    for (const p of this.list) p.mesh.removeFromParent();
    this.list.length = 0;
  }

  // Burn mark on the surface below an explosion; fades after a while.
  scorch(x, y, radius) {
    const g = this.game;
    const gy = g.world.groundAt(x, y + 0.5);
    if (!isFinite(gy) || y - gy > 2) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.6, radius * 1.2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: '#000000', opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6;
    m.position.set(x, gy + 0.02, 0.3);
    m.renderOrder = 3;
    this.group.add(m);
    const t0 = performance.now();
    const fade = () => {
      const k = (performance.now() - t0) / 1000;
      if (k > 14 || !m.parent) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); return; }
      if (k > 10) m.material.opacity = 0.9 * (1 - (k - 10) / 4);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  spawn(o) {
    const p = { t: 0, life: 3, gravity: 0, radius: 0.1, spin: 0, bounces: 0, z: 0, ...o };
    switch (p.kind) {
      case 'bullet': {
        const m = new THREE.Mesh(_tracerGeo, tracerMats[p.owner === 'player' ? 'player' : 'enemy']);
        m.scale.set(p.owner === 'player' ? 1.6 : 0.9, p.owner === 'player' ? 0.045 : 0.07, 1);
        p.mesh = m;
        p.life = 1.2;
        break;
      }
      case 'knife': {
        knifeProto ||= Gear.makeThrownKnife();
        p.mesh = knifeProto.clone();
        p.mesh.scale.setScalar(1.6);
        p.spin = p.owner === 'player' ? 0 : 0;
        p.life = 2.2;
        break;
      }
      case 'axe': {
        axeProto ||= Gear.makeAxe();
        p.mesh = axeProto.clone();
        p.spin = -16 * Math.sign(p.vx || 1);
        p.gravity = 16;
        p.life = 3;
        p.radius = 0.3;
        break;
      }
      case 'rocket': {
        rocketProto ||= Gear.makeRocket();
        p.mesh = rocketProto.clone();
        p.life = 4;
        p.radius = 0.2;
        break;
      }
      case 'bomb':
      case 'grenade': {
        if (p.kind === 'bomb') { bombProto ||= Gear.makeBomb(); p.mesh = bombProto.clone(); }
        else { grenadeProto ||= Gear.makeGrenade(); p.mesh = grenadeProto.clone(); p.mesh.scale.setScalar(1.5); }
        p.gravity = 26;
        p.fuse = p.fuse ?? 1.6;
        p.life = 6;
        p.radius = 0.15;
        p.spin = -10 * Math.sign(p.vx || 1);
        break;
      }
      default:
        return null;
    }
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.traverse((c) => { if (c.isMesh) c.castShadow = p.kind !== 'bullet'; });
    this.group.add(p.mesh);
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game;
    const P = g.particles;
    for (const p of this.list) {
      p.t += dt;
      const px = p.x, py = p.y;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'rocket') {
        if (Math.random() < 0.9) P.smoke(p.x - Math.sign(p.vx) * 0.35, p.y, p.z, { vy: 0.4, size: 0.25, size1: 1.4, life: 1.6, color: [0.6, 0.6, 0.62, 0.35] });
        P.glow(p.x - Math.sign(p.vx) * 0.35, p.y, p.z, [5, 2, 0.4], 0.6, 0.05);
        g.lights.flash(p.x, p.y, 0.4, '#ff8a30', 18, 6, 0.04);
      }
      if ((p.kind === 'bomb' || p.kind === 'grenade') && p.mesh.userData.fuse) {
        // fuse sparkle
        if (Math.random() < 0.5) P.sparkle(p.x, p.y + 0.15, p.z, [4, 2, 0.5]);
      }
      // orient
      const m = p.mesh;
      m.position.set(p.x, p.y, p.z);
      if (p.kind === 'bullet') {
        m.rotation.z = Math.atan2(p.vy, p.vx);
        m.position.x -= Math.cos(m.rotation.z) * m.scale.x * 0.5;
      } else if (p.kind === 'knife') {
        m.rotation.set(0, p.vx > 0 ? 0 : Math.PI, 0);
        if (p.owner !== 'player') m.rotation.z += p.t * 0; // straight
      } else if (p.kind === 'rocket') {
        m.rotation.set(0, 0, Math.atan2(p.vy, p.vx));
      } else {
        m.rotation.z += p.spin * dt;
      }

      // world collision
      let impact = false;
      if (p.kind === 'bomb' || p.kind === 'grenade') {
        const gy = g.world.groundAt(p.x, Math.max(p.y, py) + 0.05);
        if (p.y - p.radius < gy && p.vy < 0 && gy > -50) {
          p.y = gy + p.radius;
          p.vy = -p.vy * 0.45;
          p.vx *= 0.7;
          p.spin *= 0.7;
          if (Math.abs(p.vy) > 1.5) sound.sfx('metalHit', { x: p.x, volume: 0.35, pitch: 1.6 });
        }
        p.fuse -= dt;
        if (p.fuse <= 0) { this.explode(p.x, p.y, p.owner, p.kind === 'grenade' ? 3.2 : 2.6, p.kind === 'grenade' ? 140 : 40); p.dead = true; continue; }
      } else {
        // solids block everything; thrown/falling things also stop on the surface below them
        if (g.world.blocked(px, py, p.x, p.y)) impact = true;
        else if (p.kind !== 'bullet' && p.vy < 0 && p.y < g.world.groundAt(p.x, py + 0.01)) impact = true;
      }

      // actor collision
      if (!impact && !p.dead) {
        const targets = p.owner === 'player' ? g.hittables() : g.playerHittables();
        let best = null, bt = 2;
        for (const a of targets) {
          if (!a.alive || a === p.ignore) continue;
          const b = a.bounds();
          const pad = p.radius;
          const t = segAABB(px, py, p.x, p.y, { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad });
          if (t >= 0 && t < bt) { bt = t; best = a; }
        }
        if (best) {
          const hx = px + (p.x - px) * bt, hy = py + (p.y - py) * bt;
          if (p.kind === 'rocket') { this.explode(hx, hy, p.owner, 2.6, 45); p.dead = true; continue; }
          if (p.kind === 'bomb' || p.kind === 'grenade') { this.explode(hx, hy, p.owner, 3, p.kind === 'grenade' ? 140 : 40); p.dead = true; continue; }
          best.hit(p.dmg, { x: hx, y: hy, dir: Math.sign(p.vx) || 1, kind: p.kind, owner: p.owner });
          p.dead = true;
          continue;
        }
      }
      if (impact) {
        if (p.kind === 'rocket') { this.explode(p.x, p.y, p.owner, 2.6, 45); }
        else {
          P.sparks(p.x, p.y, p.z, p.kind === 'bullet' ? 7 : 10, -Math.sign(p.vx) * 0.6);
          g.lights.flash(p.x, p.y, 0.5, '#ffb070', 8, 4, 0.05);
          sound.sfx(p.kind === 'knife' || p.kind === 'axe' ? 'knifeHit' : 'metalHit', { x: p.x, volume: 0.4, pitch: 1.4 });
        }
        p.dead = true;
        continue;
      }
      if (p.t > p.life || Math.abs(p.x - g.player.body.x) > 40) p.dead = true;
    }
    for (const p of this.list) if (p.dead) p.mesh.removeFromParent();
    this.list = this.list.filter((p) => !p.dead);
  }

  explode(x, y, owner, radius = 2.6, dmg = 60) {
    const g = this.game;
    this.scorch(x, y, radius);
    g.particles.explosion(x, y, 0.2, radius / 2.6);
    g.lights.flash(x, y + 0.5, 1.5, '#ff9a40', 260 * radius / 2.6, 16, 0.45);
    g.camRig.shake(0.55);
    g.renderer.doFlash('#ffcf9a', 0.18, 6);
    g.renderer.shock(0.6);
    sound.sfx('explosion', { x });
    g.hitStop(0.05);
    const targets = owner === 'player' ? g.hittables() : [...g.playerHittables(), ...g.hittables().filter((h) => h.isProp)];
    for (const a of targets) {
      if (!a.alive) continue;
      const b = a.bounds();
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < radius + 0.5) a.hit(dmg * (1 - Math.min(1, d / (radius + 0.5)) * 0.5), { x, y, dir: Math.sign(cx - x) || 1, kind: 'explosion', owner });
    }
  }
}
