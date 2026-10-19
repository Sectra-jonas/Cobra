import * as THREE from 'three';
import { mat, box, facadeMat, neonMat } from '../src/core/materials.js';
export function makeWall() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(box(6, 4, 1, 2), mat('brickRed')); m.position.y = 2; m.castShadow = m.receiveShadow = true; g.add(m);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(6, 12), facadeMat({ seed: 3, floors: 6, bays: 4 })); f.position.set(8, 6, 0); g.add(f);
  const nm = neonMat('OPEN', { color: '#ff2a6d' });
  const n = new THREE.Mesh(new THREE.PlaneGeometry(2 * nm.userData.aspect, 2), nm); n.position.set(0, 2, 0.6); g.add(n);
  g.userData.lights = [{ pos: new THREE.Vector3(0, 2, 1.5), color: '#ff2a6d', intensity: 30, distance: 10 }];
  return g;
}
