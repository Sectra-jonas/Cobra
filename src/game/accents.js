// Readability accents: a thin, broken "wet edge" glint along the front of everything the player
// can stand on and up both rails of every ladder. Night scenes are lit for mood by practicals
// (lamps, neon, windows); away from them roofs, decks and ladders sat at L* 0-5, as dark as the
// walls behind, and players could not see where to go (tools/readability.py measures this).
// Built from the physics data, so every walkable edge backed by a prop gets one; level-script
// colliders (the street, gates that open) have no source object and are left alone.
// One merged mesh, one unlit material, one draw call.
import * as THREE from 'three';

const ray = new THREE.Raycaster();
const O = new THREE.Vector3(), BACK = new THREE.Vector3(0, 0, -1);

// z of the frontmost face in the top few cm under a walk line, taken from the prop that made it,
// so the glint sits on the real edge (a coping cap 0.7 m behind the play plane, a fire-escape lip
// 0.9 m in front of it) and nothing on that edge hides it
function frontZ(src, x0, x1, y) {
  const zs = [];
  for (const t of [0.2, 0.5, 0.8]) {
    let z = -Infinity;
    for (const dy of [0.012, 0.04]) {
      ray.set(O.set(x0 + (x1 - x0) * t, y - dy, 30), BACK);
      const hit = ray.intersectObject(src, true)[0];
      if (hit) z = Math.max(z, hit.point.z);
    }
    if (z > -Infinity) zs.push(z);
  }
  if (!zs.length) return 0;
  zs.sort((a, b) => a - b);
  return zs[zs.length >> 1];
}

const vert = /* glsl */`
  attribute vec4 aG; // noise coordinate, metres from the start, length, gain
  attribute float aV; // across the strip: 1 on the edge itself, 0 where the highlight dies out
  varying vec4 vG;
  varying float vV;
  #include <fog_pars_vertex>
  void main() {
    vG = aG;
    vV = aV;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const frag = /* glsl */`
  uniform vec3 uColor;
  varying vec4 vG;
  varying float vV;
  #include <fog_pars_fragment>
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float vnoise(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    // a wet highlight: brightest on the edge itself, broken up along it, faded out at the ends
    float n = 0.6 * vnoise(vG.x * 1.3) + 0.4 * vnoise(vG.x * 4.7 + 11.0);
    float k = mix(0.22, 1.0, smoothstep(0.25, 0.75, n)) * smoothstep(0.0, 0.18, min(vG.y, vG.z - vG.y));
    k *= mix(0.25, 1.0, vV * vV);
    gl_FragColor = vec4(uColor * k * vG.w, 1.0);
    #include <fog_fragment>
  }`;

/**
 * @param {World} world physics world of the level
 * @param {LevelBuilder} L its builder (walkSrc / ladderVis say which prop made which collider)
 * @param {object} cfg level accents: { color: hex, ledges = 1, ladders = 1 } (brightness per kind)
 */
export function buildAccents(world, L, cfg) {
  const pos = [], g = [], v = [];
  const quad = (a, b, c, d, ga, gb, va = 0, vb = 1) => {
    // a-b at the start of the strip, c-d at its end; a/d on one long side (va), b/c on the other (vb)
    for (const [p, q, w] of [[a, ga, va], [b, ga, vb], [c, gb, vb], [a, ga, va], [c, gb, vb], [d, gb, va]]) { pos.push(...p); g.push(...q); v.push(w); }
  };
  // ladders are thin and sit on busy walls (brick, lit windows): their rails glint a little harder
  const ledgeGain = cfg.ledges ?? 1, ladderGain = (cfg.ladders ?? 1) * 1.35;
  const edges = [];
  for (const l of world.ledges) if (!l.mover && L.walkSrc.has(l)) edges.push([l.x0, l.x1, l.y, L.walkSrc.get(l)]);
  for (const s of world.solids) if (L.walkSrc.has(s)) edges.push([s.x0, s.x1, s.y1, L.walkSrc.get(s)]);
  if (ledgeGain > 0) {
    for (const [x0, x1, y, src] of edges) {
      if (y < 0.35 || x1 - x0 < 0.5) continue;
      const xa = x0 + 0.02, xb = x1 - 0.02, len = xb - xa, z = frontZ(src, x0, x1, y) + 0.012, n = y * 7.3;
      const ga = [xa + n, 0, len, ledgeGain], gb = [xb + n, len, len, ledgeGain];
      quad([xa, y - 0.06, z], [xa, y, z], [xb, y, z], [xb, y - 0.06, z], ga, gb); // front of the lip
      quad([xa, y + 0.003, z - 0.09], [xa, y + 0.003, z], [xb, y + 0.003, z], [xb, y + 0.003, z - 0.09], ga, gb, 0.5); // its top
    }
  }
  if (ladderGain > 0) {
    for (const lad of world.ladders) {
      const vis = L.ladderVis.get(lad);
      if (!vis) continue;
      const y0 = lad.y0 + 0.05, y1 = lad.y1 + 0.6, len = y1 - y0, z = vis.z + 0.045;
      for (const s of [-1, 1]) {
        // two half-strips per rail, bright down the middle like light running along a bar
        const x = lad.x + (s * vis.w) / 2, n = lad.x * 3.1 + s * 13.7, ga = [y0 + n, 0, len, ladderGain], gb = [y1 + n, len, len, ladderGain];
        for (const e of [-0.026, 0.026]) quad([x + e, y0, z], [x, y0, z], [x, y1, z], [x + e, y1, z], ga, gb);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aG', new THREE.Float32BufferAttribute(g, 4));
  geo.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(cfg.color ?? '#9fb6e6') } }]),
    vertexShader: vert, fragmentShader: frag, fog: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'accents';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
