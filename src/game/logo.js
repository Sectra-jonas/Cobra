// The COBRA logo: custom italic slab letterforms, extruded and bevelled, chrome
// faces with blood-red sides, plus a neon underline and a moving specular sweep.
import * as THREE from 'three';

// Letter outlines on a 0..1 tall grid (outer contour CCW, holes CW).
const GLYPHS = {
  C: { w: 0.66, outer: [[0, 0.16], [0.16, 0], [0.66, 0], [0.66, 0.3], [0.44, 0.3], [0.44, 0.2], [0.22, 0.2], [0.22, 0.8], [0.44, 0.8], [0.44, 0.7], [0.66, 0.7], [0.66, 1], [0.16, 1], [0, 0.84]], holes: [] },
  O: { w: 0.68, outer: [[0, 0.16], [0.16, 0], [0.52, 0], [0.68, 0.16], [0.68, 0.84], [0.52, 1], [0.16, 1], [0, 0.84]], holes: [[[0.22, 0.24], [0.22, 0.76], [0.46, 0.76], [0.46, 0.24]]] },
  B: { w: 0.66, outer: [[0, 0], [0.52, 0], [0.66, 0.14], [0.66, 0.4], [0.58, 0.5], [0.66, 0.6], [0.66, 0.86], [0.52, 1], [0, 1]], holes: [[[0.22, 0.18], [0.22, 0.42], [0.44, 0.42], [0.44, 0.18]], [[0.22, 0.58], [0.22, 0.82], [0.44, 0.82], [0.44, 0.58]]] },
  R: { w: 0.7, outer: [[0, 0], [0.22, 0], [0.22, 0.4], [0.32, 0.4], [0.47, 0], [0.7, 0], [0.52, 0.46], [0.66, 0.58], [0.66, 0.86], [0.52, 1], [0, 1]], holes: [[[0.22, 0.58], [0.22, 0.82], [0.44, 0.82], [0.44, 0.58]]] },
  A: { w: 0.72, outer: [[0, 0], [0.22, 0], [0.26, 0.22], [0.46, 0.22], [0.5, 0], [0.72, 0], [0.5, 1], [0.22, 1]], holes: [[[0.3, 0.4], [0.34, 0.76], [0.38, 0.76], [0.42, 0.4]]] },
};

function shapeFor(ch, slant) {
  const g = GLYPHS[ch];
  const sk = ([x, y]) => new THREE.Vector2(x + y * slant, y);
  const s = new THREE.Shape(g.outer.map(sk));
  for (const h of g.holes) s.holes.push(new THREE.Path(h.map(sk)));
  return s;
}

// Classic 80s chrome: a studio environment with a blue sky, a hard white horizon
// line, a sunset band and dark ground – what makes airbrushed chrome lettering read.
let chromeEnvTex = null;
function chromeEnv(renderer) {
  if (chromeEnvTex || !renderer) return chromeEnvTex;
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 sky = mix(vec3(0.42, 0.5, 0.72), vec3(0.03, 0.07, 0.3), smoothstep(0.02, 0.7, h));
        vec3 ground = mix(vec3(0.3, 0.05, 0.16), vec3(0.01, 0.005, 0.02), smoothstep(-0.02, -0.5, h));
        vec3 c = h > 0.0 ? sky : ground;
        c += vec3(0.9) * exp(-abs(h) * 90.0);
        c += vec3(0.8, 0.2, 0.4) * exp(-abs(h + 0.06) * 30.0) * 0.5;
        c += vec3(1.0, 0.95, 0.9) * pow(max(dot(vP, normalize(vec3(-0.5, 0.6, 0.6))), 0.0), 60.0) * 1.2;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  chromeEnvTex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return chromeEnvTex;
}

// Vertical normal sweep: tilts the reflection from ground to sky across each letter,
// producing the airbrushed chrome horizon band on flat faces.
function chromeBandNormal() {
  const h = 128, data = new Uint8Array(4 * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const a = (v - 0.48) * 1.5 + Math.sin(v * 9.0) * 0.06;
    const ny = Math.sin(a), nz = Math.cos(a);
    for (let x = 0; x < 4; x++) {
      const j = (y * 4 + x) * 4;
      data[j] = 128; data[j + 1] = (ny * 0.5 + 0.5) * 255; data[j + 2] = (nz * 0.5 + 0.5) * 255; data[j + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, 4, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// The sweep as one extra point light (range 4, decay 2) evaluated by the material itself.
const sweepU = { uSweepPos: { value: new THREE.Vector3() }, uSweepColor: { value: new THREE.Color(0, 0, 0) } };
function litBySweep(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, sweepU);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSweepPos;\nuniform vec3 uSweepColor;')
      .replace('#include <lights_fragment_end>', `{
          IncidentLight sweepLight;
          vec3 sweepVec = uSweepPos - geometryPosition;
          float sweepDist = length(sweepVec);
          sweepLight.direction = sweepVec / max(sweepDist, 1e-4);
          sweepLight.color = uSweepColor * getDistanceAttenuation(sweepDist, 4.0, 2.0);
          sweepLight.visible = true;
          RE_Direct(sweepLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        }
        #include <lights_fragment_end>`);
  };
  mat.customProgramCacheKey = () => 'logoSweep';
}

export function makeLogo({ text = 'COBRA', height = 1, depth = 0.22, slant = 0.22, gap = 0.08, renderer = null } = {}) {
  const group = new THREE.Group();
  group.name = 'cobraLogo';
  const env = chromeEnv(renderer);
  const chrome = new THREE.MeshPhysicalMaterial({ color: '#f2f5fa', metalness: 1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMap: env, envMapIntensity: 0.95, normalMap: chromeBandNormal() });
  const sides = new THREE.MeshPhysicalMaterial({ color: '#b3101c', metalness: 0.9, roughness: 0.22, clearcoat: 0.8, emissive: '#4a0006', emissiveIntensity: 0.6, envMap: env, envMapIntensity: 0.6 });
  const letters = [];
  let x = 0;
  for (const ch of text) {
    const shape = shapeFor(ch, slant);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.022, bevelSegments: 3, curveSegments: 4 });
    geo.translate(x, 0, -depth / 2);
    const m = new THREE.Mesh(geo, [chrome, sides]);
    m.castShadow = false;
    const pivot = new THREE.Group();
    pivot.add(m);
    group.add(pivot);
    letters.push({ pivot, mesh: m, x0: x, w: GLYPHS[ch].w });
    x += GLYPHS[ch].w + gap;
  }
  const width = x - gap + slant;
  // centre letters & move pivots to each letter centre (for individual slams)
  for (const L of letters) {
    const cx = L.x0 + L.w / 2 + slant * 0.5 - width / 2;
    L.mesh.position.set(-(L.x0 + L.w / 2 + slant * 0.5), -0.5, 0);
    L.pivot.position.set(cx, 0, 0);
  }
  // neon underline
  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.18, 0.75), toneMapped: true });
  const line = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, 0.022, 0.01), lineMat);
  line.position.set(0, -0.63, 0.05);
  group.add(line);
  const line2 = line.clone();
  line2.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.3, 2.4) });
  line2.position.y = -0.69;
  line2.scale.x = 0.7;
  group.add(line2);
  // key + sweep "lights" travel with the logo. They are not real lights: the scene's light
  // count is part of every shader program, so lights that come and go with the logo would need
  // a second set of programs for the whole level (~10 s of compiles). The sweep is shaded in
  // the letters' own shader instead, with three's point-light code; the key was always dark.
  const key = new THREE.Object3D();
  key.intensity = 0;
  const sweep = new THREE.Object3D();
  sweep.color = new THREE.Color('#ff4aa0');
  sweep.intensity = 0;
  sweep.position.set(-width, 0.2, 0.9);
  group.add(key, sweep);
  for (const mat of [chrome, sides]) litBySweep(mat);
  for (const L of letters) L.mesh.onBeforeRender = (r, s, camera) => {
    sweepU.uSweepPos.value.setFromMatrixPosition(sweep.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    sweepU.uSweepColor.value.copy(sweep.color).multiplyScalar(sweep.intensity);
  };
  group.scale.setScalar(height);
  group.userData = { letters, width, line, line2, sweep, key, chrome, sides };
  return group;
}

// Animate a slam-in: each letter drops from the camera with stagger. t in seconds since start.
export function animateLogo(logo, t, mode = 'slam') {
  const { letters, line, line2, sweep, width } = logo.userData;
  if (mode === 'slam') {
    letters.forEach((L, i) => {
      const k = THREE.MathUtils.clamp((t - i * 0.07) / 0.28, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      L.pivot.position.z = (1 - e) * 4.5;
      L.pivot.rotation.x = (1 - e) * -0.9;
      L.pivot.scale.setScalar(0.6 + e * 0.4 + Math.sin(Math.min(1, k * 1.2) * Math.PI) * 0.06);
      L.mesh.visible = k > 0;
    });
    const lk = THREE.MathUtils.clamp((t - 0.45) / 0.35, 0, 1);
    line.scale.x = lk; line2.scale.x = lk * 0.7;
  } else {
    letters.forEach((L) => { L.pivot.position.z = 0; L.pivot.rotation.x = 0; L.pivot.scale.setScalar(1); L.mesh.visible = true; });
    line.scale.x = 1; line2.scale.x = 0.7;
  }
  // specular sweep every few seconds
  const st = (t % 4.5) / 1.4;
  sweep.intensity = st < 1 ? 3.5 * Math.sin(st * Math.PI) : 0;
  sweep.position.x = (st - 0.5) * width * 1.4;
}
