// Primitive test range for gameplay tuning (?level=test).
import * as THREE from 'three';
import { mat, facadeMat } from '../core/materials.js';

export default {
  id: 'test',
  name: 'TEST RANGE',
  length: 120,
  start: { x: 4, y: 0 },
  quota: 5,
  rain: true,
  lightning: true,
  wet: { strength: 0.9, coverage: 0.5 },
  fog: { color: '#0b0d18', density: 0.012 },
  sky: { top: '#03040a', horizon: '#2a1630', bottom: '#07070c', glow: '#ff5a2a', glowAmt: 0.55, moon: true, sunDir: [0.4, 0.45, -1], sunColor: '#cfd8ff', sunSize: 0.9993, stars: 0.6, clouds: 0.75, cloudColor: '#1a1422', cloudLit: '#ff7a3a' },
  hemi: { sky: '#5a6aa0', ground: '#2a1a24', intensity: 1.4 },
  sun: { color: '#9fb4ff', intensity: 1.6, dir: [0.35, 0.8, 0.45] },
  rim: { color: '#6fb7ff', strength: 0.3 },
  env: { panels: [{ color: '#ff2f8e', w: 6, h: 3, pos: [-8, 2, -6], i: 3 }, { color: '#2fd2ff', w: 6, h: 3, pos: [8, 3, -6], i: 3 }, { color: '#ff9a40', w: 10, h: 2, pos: [0, 6, 6], i: 2 }] },
  grade: { exposure: 1.15, lift: [0.02, 0.01, 0.04], gain: [1.0, 0.98, 1.05], sat: 1.12, contrast: 1.08, vignette: 0.45, grain: 0.05, ca: 0.0015, bloom: { strength: 0.85, radius: 0.6, threshold: 0.8 } },
  skyline: [{ z: -70, minH: 25, maxH: 70, lit: 0.3, layerFade: 0.25, seed: 3 }, { z: -150, minH: 40, maxH: 120, lit: 0.25, layerFade: 0.5, seed: 9 }],
  music: 'city',
  ambience: 'rain',
  enemyPool: [['thug', 4], ['knifer', 3], ['gunner', 2], ['granny', 1.5], ['bazooka', 1], ['axeman', 1.5], ['biker', 1], ['bomber', 1]],
  maxAlive: 3,
  spawnInterval: 4,
  ingridTrigger: 30,
  build(L) {
    // ground
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 60), mat('concreteDark').clone());
    road.material.map = road.material.map.clone();
    road.rotation.x = -Math.PI / 2;
    road.position.set(60, 0, 28);
    road.receiveShadow = true;
    L.scene.add(road);
    L.wetMeshes = [road];
    L.solid(-50, 400, -5, 0);
    // backdrop wall with windows
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 20), facadeMat({ seed: 3, floors: 6, bays: 4 }));
    wall.position.set(60, 10, -1.5);
    L.scene.add(wall);
    // tiers
    L.block(14, 24, 3.0, 3.2, -1.2, 1.0, 'ironBlack', { ledge: true });
    L.ladder(15, 0, 3.2);
    L.block(22, 32, 6.2, 6.4, -1.2, 1.0, 'ironBlack', { ledge: true });
    L.ladder(30, 3.2, 6.4);
    L.block(40, 44, 0, 1.2, -1, 1, 'rustMetal', { solid: true });
    L.block(50, 64, 3.0, 3.2, -1.2, 1.0, 'ironBlack', { ledge: true });
    L.light(20, 4, 1, '#ff2f8e', 40, 12);
    L.light(45, 3, 1.5, '#ff9a40', 50, 14);
    L.light(70, 4, 1, '#2fd2ff', 40, 12);
    L.burger(19, 3.2, 'knife');
    L.burger(27, 6.4, 'pistol');
    L.burger(56, 3.2, 'smg');
    L.burger(80, 0, 'pill');
    L.ingrid(60, 3.2);
    L.ingrid(95, 0);
    L.checkpoint(40);
    L.door(70);
    L.encounter(20, [{ type: 'thug', dx: 14 }, { type: 'knifer', dx: 18, delay: 1 }]);
    L.emitter('steam', 35, 0, 2.5, 3);
    L.exit(110);
  },
};
