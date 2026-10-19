// Ambient life: passing traffic on the road in front of the action and a police
// helicopter sweeping its searchlight across the skyline.
import * as THREE from 'three';
import { sound } from '../core/sound.js';

export class Traffic {
  /** cfg: { kinds:[propName], lanes:[{ z, dir, speed }], interval:[min,max], lights:bool, spray:bool } */
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.cars = [];
    this.t = 3 + Math.random() * 4;
    this.protos = {};
  }

  make(kind) {
    const g = this.game;
    const f = g.props?.[kind];
    if (!f) return null;
    if (!this.protos[kind]) this.protos[kind] = [];
    const pool = this.protos[kind];
    const free = pool.find((c) => !c.userData.busy);
    if (free) return free;
    const car = f({ seed: Math.floor(Math.random() * 50), headlights: true });
    car.userData.setLights?.(!!this.cfg.lights);
    car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    pool.push(car);
    return car;
  }

  update(dt) {
    const g = this.game;
    const cam = g.camRig;
    this.t -= dt;
    if (this.t <= 0 && g.state === 'play' && !g.lock && !g.bossActive) {
      const [a, b] = this.cfg.interval || [8, 16];
      this.t = a + Math.random() * (b - a);
      const lane = this.cfg.lanes[Math.floor(Math.random() * this.cfg.lanes.length)];
      const kinds = this.cfg.kinds;
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const car = this.make(kind);
      if (car) {
        const half = cam.visibleHalfWidth() * 1.6 + 8;
        car.userData.busy = true;
        car.position.set(cam.focus.x - lane.dir * half, 0, lane.z);
        car.rotation.y = lane.dir > 0 ? 0 : Math.PI;
        car.visible = true;
        g.scene.add(car);
        const speed = (lane.speed || 14) * (0.85 + Math.random() * 0.3);
        this.cars.push({ car, dir: lane.dir, speed, life: 0, siren: kind === 'makePoliceCar' });
        sound.sfx(kind === 'makePoliceCar' && Math.random() < 0.6 ? 'siren' : 'carPass', { x: car.position.x, volume: 0.55 });
      }
    }
    for (const c of this.cars) {
      c.life += dt;
      const dx = c.dir * c.speed * dt;
      c.car.position.x += dx;
      if (c.car.userData.rollBy) c.car.userData.rollBy(Math.abs(dx));
      else for (const n of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) { const w = c.car.getObjectByName(n); if (w) w.rotation.z -= Math.abs(dx) / 0.35; }
      c.car.userData.update?.(dt, g.time);
      if (this.cfg.spray && Math.random() < 0.8) {
        const back = c.car.position.x - c.dir * 2.3;
        g.particles.splash(back, 0, c.car.position.z + (Math.random() - 0.5) * 1.4, 3);
        if (Math.random() < 0.25) g.particles.smoke(back, 0.3, c.car.position.z, { vx: -c.dir * 2, vy: 0.4, size: 0.5, size1: 2.2, life: 1.2, color: [0.7, 0.72, 0.8, 0.12], color1: [0.7, 0.72, 0.8, 0] });
      }
      if (this.cfg.dust && Math.random() < 0.6) g.particles.dust(c.car.position.x - c.dir * 2.4, 0, c.car.position.z, 1, [0.75, 0.62, 0.45]);
      if (Math.abs(c.car.position.x - cam.focus.x) > cam.visibleHalfWidth() * 1.7 + 12 && c.life > 1) {
        c.done = true;
        c.car.userData.busy = false;
        c.car.removeFromParent();
      }
    }
    this.cars = this.cars.filter((c) => !c.done);
  }
}

// Police helicopter crossing the skyline with a sweeping searchlight cone.
export class Helicopter {
  constructor(game, { z = -42, y = 30, speed = 7 } = {}) {
    this.game = game;
    this.z = z; this.y = y; this.speed = speed;
    this.t = 0;
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#0b0c10', roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 10), dark);
    body.scale.set(1.6, 0.9, 0.9);
    g.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 5, 8).rotateZ(Math.PI / 2), dark);
    tail.position.set(-3.6, 0.3, 0);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.1), dark);
    fin.position.set(-5.9, 0.8, 0);
    g.add(fin);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.08), dark);
    skid.position.set(0.2, -1.3, 0.7);
    g.add(skid, skid.clone().translateZ(-1.4));
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 0.3), dark);
    this.rotor.position.y = 1.2;
    g.add(this.rotor);
    this.blinkR = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.2) }));
    this.blinkR.position.set(-5.9, 1.4, 0);
    this.blinkW = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }));
    this.blinkW.position.set(0, -0.9, 0);
    g.add(this.blinkR, this.blinkW);
    // searchlight cone (additive, fades along its length)
    const coneGeo = new THREE.ConeGeometry(5, 34, 24, 1, true);
    coneGeo.translate(0, -17, 0);
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#cfe0ff') } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float a = smoothstep(-34.0, -2.0, vY) * 0.12 * pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(uColor, a); }',
    });
    this.cone = new THREE.Mesh(coneGeo, coneMat);
    this.cone.position.set(0.8, -0.9, 0);
    g.add(this.cone);
    this.group = g;
    game.scene.add(g);
    this.x = game.camRig.focus.x - 120;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.x += this.speed * dt;
    if (this.x > g.camRig.focus.x + 160) this.x = g.camRig.focus.x - 160;
    this.group.position.set(this.x, this.y + Math.sin(this.t * 0.7) * 1.2, this.z);
    this.group.rotation.z = Math.sin(this.t * 0.5) * 0.05 - 0.08;
    this.rotor.rotation.y += dt * 28;
    this.blinkR.visible = Math.floor(this.t * 1.4) % 2 === 0;
    this.blinkW.visible = Math.floor(this.t * 2.1 + 0.5) % 3 === 0;
    this.cone.rotation.z = Math.sin(this.t * 0.45) * 0.55;
    this.cone.rotation.x = Math.sin(this.t * 0.31) * 0.25 + 0.2;
  }
}
