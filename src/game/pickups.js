// Collectibles: the four weapon burgers per section (faithful to the original:
// knife, pistol, laser-sighted SMG and the invincibility pill are hidden in
// beef burgers), grenade crates and the rare extra-life cobra head.
import * as THREE from 'three';
import { makeBurger } from '../actors/gear.js';
import { sound } from '../core/sound.js';

const LABEL = { knife: 'KNIFE', pistol: '.45 COLT', smg: 'LASER SMG', pill: 'INVINCIBILITY PILL' };
let burgerProto = null;

function beamMesh(color) {
  const geo = new THREE.CylinderGeometry(0.35, 0.6, 6, 16, 1, true);
  geo.translate(0, 3, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 2.2) * (0.5 + 0.5 * sin(vUv.x * 40.0 + uTime * 3.0)) * 0.35;
      gl_FragColor = vec4(uColor * 1.6, a); }`,
  });
  return new THREE.Mesh(geo, mat);
}

const crateGeo = new THREE.BoxGeometry(0.6, 0.38, 0.4), bandGeo = new THREE.BoxGeometry(0.62, 0.06, 0.42);
const crateMat = new THREE.MeshStandardMaterial({ color: '#3d4a2a', roughness: 0.6, metalness: 0.2 });
const bandMat = new THREE.MeshStandardMaterial({ color: '#c79a16' });
crateGeo.userData.shared = bandGeo.userData.shared = true;

function buildModel(kind) {
  let model, beam = null;
  if (kind === 'burger') {
    burgerProto ||= makeBurger(1);
    model = burgerProto.clone();
    beam = beamMesh('#ffb347');
  } else if (kind === 'grenades') {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.y = 0.19;
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.3;
    model = new THREE.Group();
    model.add(crate, band);
  } else {
    const s = new THREE.Mesh(new THREE.TorusKnotGeometry(0.18, 0.06, 64, 8, 2, 3), new THREE.MeshStandardMaterial({ color: '#1b6b2a', emissive: '#2dff5a', emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4 }));
    s.position.y = 0.45;
    model = new THREE.Group();
    model.add(s);
    beam = beamMesh('#45ff7a');
  }
  return { model, beam };
}

// Every pickup model, for Game.warmGpu (grenade crates drop from enemies mid-fight).
export function pickupWarmSet() {
  const g = new THREE.Group();
  for (const k of ['burger', 'grenades', 'life']) {
    const { model, beam } = buildModel(k);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(model);
    if (beam) g.add(beam);
  }
  return g;
}

export class Pickup {
  constructor(game, kind, x, y, opts = {}) {
    this.game = game;
    this.kind = kind;         // 'burger' | 'grenades' | 'life'
    this.weapon = opts.weapon;
    this.x = x;
    this.y = y;
    this.t = Math.random() * 6;
    this.taken = false;
    this.group = new THREE.Group();
    const { model, beam } = buildModel(kind);
    this.model = model;
    this.beam = beam;
    this.group.add(model);
    if (beam) this.group.add(beam);
    if (kind === 'burger') this.light = game.lights.addSource({ pos: new THREE.Vector3(x, y + 0.8, 0.8), color: '#ffb347', intensity: 14, distance: 5, pulse: 3 });
    this.group.position.set(x, y, 0);
    this.group.traverse((o) => { if (o.isMesh && o !== this.beam) o.castShadow = true; });
    game.scene.add(this.group);
  }

  update(dt) {
    if (this.taken) return;
    const g = this.game;
    this.t += dt;
    if (this.model) {
      this.model.position.y = 0.3 + Math.sin(this.t * 2.6) * 0.12;
      this.model.rotation.y = this.t * 1.6;
    }
    if (this.beam) this.beam.material.uniforms.uTime.value = this.t;
    if (this.kind === 'burger' && Math.random() < 0.25) g.particles.sparkle(this.x, this.y + 0.5, 0, [3, 2, 0.6]);
    const P = g.player;
    if (!P.alive || P.scripted) return;
    const b = P.body;
    if (Math.abs(b.x - this.x) < 0.8 && b.y + b.h > this.y && b.y < this.y + 1.1) this.collect();
  }

  collect() {
    const g = this.game;
    const P = g.player;
    this.taken = true;
    this.group.removeFromParent();
    if (this.light) this.light.on = false;
    g.particles.ring(this.x, this.y + 0.7, 0.2, [3, 2, 0.6], 2.5, 0.4);
    for (let i = 0; i < 16; i++) g.particles.sparkle(this.x, this.y + 0.6, 0.2, [4, 3, 1]);
    if (this.kind === 'burger') {
      sound.sfx('burger');
      P.hp = Math.min(P.maxHp, P.hp + 30);
      P.giveWeapon(this.weapon);
      g.addScore(500, this.x, this.y + 1.5);
      g.onBurger(this.weapon);
      g.hud.banner(`BURGER: ${LABEL[this.weapon]}`, this.weapon === 'pill' ? 'Ten seconds of invincibility – run them down!' : 'Watch the Quackometer — weapons wear out', 2);
    } else if (this.kind === 'grenades') {
      sound.sfx('reload');
      P.grenades += 2;
      g.hud.toast('+2 GRENADES');
    } else if (this.kind === 'life') {
      sound.sfx('extraLife');
      g.lives++;
      g.hud.toast('EXTRA LIFE');
    }
  }

  dispose() {
    this.group.removeFromParent();
    if (this.light) this.light.on = false;
  }
}
