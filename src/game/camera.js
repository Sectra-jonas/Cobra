// Side-on gameplay camera: look-ahead, tier-aware vertical framing, trauma shake,
// zoom pulses and cinematic overrides.
import * as THREE from 'three';

function n1(t, s) { return Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 7.9 + s * 0.7) * 0.2; }

export class CameraRig {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(30, aspect, 0.3, 2000);
    this.cam.layers.enable(1);
    this.focus = new THREE.Vector3(0, 0, 0);
    this.lead = 0;
    this.dist = 22.5;
    this.height = 2.4;
    this.lookY = 2.1;
    this.trauma = 0;
    this.time = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.roll = 0;
    this.minX = -1e9;
    this.maxX = 1e9;
    this.minY = 0;
    this.groundY = 0;
    this.override = null;
    this.blend = 0;
    this.lookAt = new THREE.Vector3();
  }

  setBounds(minX, maxX) { this.minX = minX; this.maxX = maxX; }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  snap(x, y) {
    this.focus.set(x, y, 0);
    this.groundY = y;
    this.update(0, null, true);
  }

  // target: { x, y, facing, vx, onGround, climbing }
  update(dt, target, instant = false) {
    this.time += dt;
    const halfW = this.visibleHalfWidth();
    if (target) {
      const leadT = target.facing * 3.2 + THREE.MathUtils.clamp(target.vx * 0.25, -1.5, 1.5);
      this.lead += (leadT - this.lead) * (1 - Math.exp(-2.2 * dt));
      // vertical: follow grounded height; when airborne only follow if leaving the framing band
      if (target.onGround || target.climbing) this.groundY = target.y;
      else if (target.y < this.groundY - 1.5) this.groundY = target.y + 1.5;
      else if (target.y > this.groundY + 4.5) this.groundY = target.y - 4.5;
      const fx = THREE.MathUtils.clamp(target.x + this.lead, this.minX + halfW, this.maxX - halfW);
      const fy = Math.max(this.minY, this.groundY);
      const kx = instant ? 1 : 1 - Math.exp(-5 * dt);
      const ky = instant ? 1 : 1 - Math.exp(-3.2 * dt);
      this.focus.x += (fx - this.focus.x) * kx;
      this.focus.y += (fy - this.focus.y) * ky;
    }
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-3 * dt));
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const sx = n1(this.time * 9, 1) * 0.55 * s, sy = n1(this.time * 9, 5) * 0.45 * s, sr = n1(this.time * 7, 9) * 0.035 * s;

    const d = this.dist / this.zoom;
    const camPos = new THREE.Vector3(this.focus.x + sx, this.focus.y + this.height + sy, d);
    const look = new THREE.Vector3(this.focus.x + sx * 0.6, this.focus.y + this.lookY + sy * 0.6, 0);
    if (this.override) {
      this.blend = Math.min(1, this.blend + dt / (this.override.blendTime || 0.8));
    } else {
      this.blend = Math.max(0, this.blend - dt / 0.8);
    }
    const b = this.blend * this.blend * (3 - 2 * this.blend);
    if (b > 0 && (this.override || this.lastOverride)) {
      const o = this.override || this.lastOverride;
      camPos.lerp(o.pos, b);
      look.lerp(o.look, b);
      this.cam.fov = THREE.MathUtils.lerp(30, o.fov || 30, b);
      this.cam.updateProjectionMatrix();
      if (this.override) this.lastOverride = this.override;
    } else if (this.cam.fov !== 30) {
      this.cam.fov = 30;
      this.cam.updateProjectionMatrix();
    }
    this.cam.position.copy(camPos);
    this.cam.up.set(Math.sin(sr + this.roll), Math.cos(sr + this.roll), 0);
    this.cam.lookAt(look);
    this.lookAt.copy(look);
  }

  visibleHalfWidth() {
    const d = this.dist / this.zoom;
    return Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * d * this.cam.aspect;
  }

  // Projects a world point to CSS pixels.
  toScreen(v, w, h) {
    const p = v.clone().project(this.cam);
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, behind: p.z > 1 };
  }
}
