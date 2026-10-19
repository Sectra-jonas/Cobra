// Fixed-size pool of real PointLights assigned each frame to the most relevant
// light *sources* (neon, lamps, fires) near the camera focus, plus short-lived
// dynamic lights (muzzle flashes, explosions). Keeping the count constant avoids
// shader recompiles while letting a level contain hundreds of light sources.
import * as THREE from 'three';

export class LightPool {
  constructor(scene, size = 10) {
    this.lights = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 10, 2);
      l.userData.src = null;
      l.userData.level = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.sources = [];
    this.dynamic = [];
    this.scene = scene;
  }

  clear() {
    this.sources.length = 0;
    this.dynamic.length = 0;
    for (const l of this.lights) { l.intensity = 0; l.userData.src = null; }
  }

  /** src: { pos:Vector3, color, intensity, distance, flicker?:0..1, on?:bool } */
  addSource(src) {
    src.color = new THREE.Color(src.color);
    src.distance = src.distance ?? 12;
    src.intensity = src.intensity ?? 30;
    src.on = src.on ?? true;
    src.seed = Math.random() * 100;
    this.sources.push(src);
    return src;
  }

  flash(x, y, z, color = '#ffb060', intensity = 60, distance = 10, life = 0.07) {
    this.dynamic.push({ pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, life, t: 0, dyn: true, on: true });
  }

  update(dt, focus, time) {
    for (const d of this.dynamic) d.t += dt;
    this.dynamic = this.dynamic.filter((d) => d.t < d.life);
    const cand = [];
    for (const d of this.dynamic) cand.push({ s: d, score: 1e6 - d.t });
    for (const s of this.sources) {
      if (!s.on) continue;
      const dx = Math.abs(s.pos.x - focus.x), dy = Math.abs(s.pos.y - focus.y) * 0.6;
      if (dx > 26) continue;
      const score = s.intensity / (1 + (dx * dx + dy * dy) * 0.04) * (s.priority || 1);
      cand.push({ s, score });
    }
    cand.sort((a, b) => b.score - a.score);
    const chosen = cand.slice(0, this.lights.length).map((c) => c.s);
    const set = new Set(chosen);
    // keep lights already bound to a chosen source
    const free = [];
    for (const l of this.lights) {
      if (l.userData.src && set.has(l.userData.src)) set.delete(l.userData.src);
      else free.push(l);
    }
    for (const s of set) {
      const l = free.pop();
      if (!l) break;
      l.userData.src = s;
      l.userData.level = s.dyn ? 1 : 0;
    }
    for (const l of free) { l.userData.src = null; }
    for (const l of this.lights) {
      const s = l.userData.src;
      if (!s) {
        l.userData.level = Math.max(0, l.userData.level - dt * 4);
        l.intensity *= l.userData.level > 0 ? 0.8 : 0;
        continue;
      }
      l.userData.level = Math.min(1, l.userData.level + dt * 4);
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.distance;
      let k = 1;
      if (s.dyn) k = 1 - s.t / s.life;
      if (s.flicker) {
        const n = Math.sin(time * 23 + s.seed) * Math.sin(time * 7.3 + s.seed * 2) + Math.sin(time * 61 + s.seed);
        k *= n > 1.2 * (1 - s.flicker) ? 1 : 0.15;
      }
      if (s.pulse) k *= 0.75 + 0.25 * Math.sin(time * s.pulse + s.seed);
      l.intensity = s.intensity * k * l.userData.level;
    }
  }
}
