// Atmosphere: procedural sky dome, distant skyline with procedural windows,
// GPU rain, lightning, and a planar-reflection wet street.
import * as THREE from 'three';
import * as TX from './textures.js';

// ------------------------------------------------------------------ sky

export class Sky {
  constructor(scene, opts = {}) {
    this.uniforms = {
      uTop: { value: new THREE.Color(opts.top || '#05070f') },
      uHorizon: { value: new THREE.Color(opts.horizon || '#2a1a3a') },
      uBottom: { value: new THREE.Color(opts.bottom || '#0b0a10') },
      uGlow: { value: new THREE.Color(opts.glow || '#ff6a2a') },       // city light pollution / sunset band
      uGlowAmt: { value: opts.glowAmt ?? 0.5 },
      uSunDir: { value: new THREE.Vector3(...(opts.sunDir || [0.3, 0.35, -1])).normalize() },
      uSunColor: { value: new THREE.Color(opts.sunColor || '#dfe8ff') },
      uSunSize: { value: opts.sunSize ?? 0.9994 },
      uMoon: { value: opts.moon ? 1 : 0 },
      uStars: { value: opts.stars ?? 0 },
      uClouds: { value: opts.clouds ?? 0.5 },
      uCloudColor: { value: new THREE.Color(opts.cloudColor || '#3a2c40') },
      uCloudLit: { value: new THREE.Color(opts.cloudLit || '#ff8a4a') },
      uTime: { value: 0 },
      uNoise: { value: TX.noiseTexture(256, 121, 4, 6) },
      uLightning: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uBottom, uGlow, uSunColor, uCloudColor, uCloudLit;
        uniform vec3 uSunDir;
        uniform float uGlowAmt, uSunSize, uMoon, uStars, uClouds, uTime, uLightning;
        uniform sampler2D uNoise;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
          col = mix(col, uBottom, smoothstep(0.0, -0.15, h));
          // horizon glow band (city light pollution / sunset)
          col += uGlow * uGlowAmt * exp(-abs(h) * 9.0) * 0.6;
          float sd = dot(d, normalize(uSunDir));
          // sun or moon
          if (uMoon > 0.5) {
            float disk = smoothstep(uSunSize, uSunSize + 0.00025, sd);
            vec2 mp = (d.xy - normalize(uSunDir).xy) * 60.0;
            float crater = texture2D(uNoise, mp * 0.5 + 0.5).r;
            col = mix(col, uSunColor * (1.6 + crater * 0.8), disk);
            col += uSunColor * pow(max(sd, 0.0), 300.0) * 0.6 + uSunColor * pow(max(sd, 0.0), 12.0) * 0.08;
          } else {
            float disk = smoothstep(uSunSize, uSunSize + 0.0004, sd);
            col += uSunColor * disk * 18.0;
            col += uSunColor * pow(max(sd, 0.0), 60.0) * 1.2 + uSunColor * pow(max(sd, 0.0), 6.0) * 0.25;
          }
          // stars
          if (uStars > 0.0 && h > 0.0) {
            vec3 sp = floor(d * 380.0);
            float s = hash(sp);
            float tw = 0.6 + 0.4 * sin(uTime * (2.0 + s * 5.0) + s * 40.0);
            col += vec3(0.8, 0.85, 1.0) * step(0.9965, s) * tw * uStars * smoothstep(0.0, 0.25, h);
          }
          // clouds: plane projection
          if (uClouds > 0.0 && h > -0.02) {
            vec2 uv = d.xz / (h + 0.12) * 0.18 + vec2(uTime * 0.004, 0.0);
            float n = texture2D(uNoise, uv).r * 0.6 + texture2D(uNoise, uv * 2.7 + 0.3).g * 0.4;
            float c = smoothstep(0.42, 0.78, n) * uClouds * smoothstep(-0.02, 0.18, h);
            vec3 cc = mix(uCloudColor, uCloudLit, pow(max(sd, 0.0), 4.0) * 0.8 + exp(-h * 6.0) * 0.5);
            cc += vec3(0.7, 0.75, 1.0) * uLightning * 2.0;
            col = mix(col, cc, c);
          }
          col += vec3(0.5, 0.55, 0.8) * uLightning * 0.35 * smoothstep(-0.1, 0.5, h);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }
}

// --------------------------------------------------------------- skyline

// Distant buildings as one instanced mesh; windows are computed in the shader
// from world position so every building gets crisp procedural detail for free.
export function makeSkyline(scene, { x0 = -50, x1 = 400, z = -80, count = 60, minH = 20, maxH = 90, depth = 14, seed = 1, wall = '#0b0d14', fogColor = '#0a0c14', lit = 0.35, aviation = true, warm = 0.75, layerFade = 0.4 } = {}) {
  const R = TX.rng(seed);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uWall: { value: new THREE.Color(wall) },
      uLit: { value: lit },
      uWarm: { value: warm },
      uFade: { value: layerFade },
      uFogCol: { value: new THREE.Color(fogColor) },
      uTime: { value: 0 },
    }]),
    fog: true,
    vertexShader: /* glsl */`
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vSeed;
      varying vec3 vScale;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(instanceMatrix) * normal);
        vSeed = instanceMatrix[3].xyz;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uWall;
      uniform float uLit, uWarm, uFade, uTime;
      uniform vec3 uFogCol;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vSeed;
      varying vec3 vScale;
      #include <fog_pars_fragment>
      float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
      void main() {
        float bseed = h21(vSeed.xz * 0.013);
        vec3 wall = uWall * (0.8 + bseed * 0.5);
        vec3 col = wall;
        vec2 fp = abs(vN.z) > 0.5 ? vW.xy : vW.zy;
        // per-building grid style
        vec2 cell = vec2(1.4 + bseed * 1.4, 3.2);
        vec2 g = fp / cell;
        vec2 gi = floor(g), gf = fract(g);
        float win = step(0.18, gf.x) * step(gf.x, 0.82) * step(0.25, gf.y) * step(gf.y, 0.8);
        float r = h21(gi + vSeed.xz);
        float on = step(1.0 - uLit * (0.6 + bseed * 0.8), r);
        // horizontal band buildings (office floors all lit)
        if (bseed > 0.82) on = step(0.35, h21(vec2(gi.y, vSeed.x)));
        vec3 wc = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.72, 0.42), step(1.0 - uWarm, h21(gi * 1.7 + 3.0)));
        wc *= 0.6 + r * 0.8;
        float top = vSeed.y + vScale.y;
        float roof = step(top - 0.6, vW.y);
        col = mix(col, wc * 2.4, win * on * (1.0 - roof) * step(0.5, abs(vN.z) + abs(vN.x)));
        col = mix(col, wall * 1.4, roof * 0.0);
        // aviation light on tall buildings
        float blink = step(0.5, fract(uTime * 0.5 + bseed));
        if (vScale.y > 55.0 && vW.y > top - 0.8 && abs(vW.x - vSeed.x) < 0.6 && vN.z > 0.5) col += vec3(6.0, 0.2, 0.1) * blink;
        // depth layer fade toward fog
        col = mix(col, uFogCol, uFade);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const d = new THREE.Object3D();
  let x = x0;
  for (let i = 0; i < count; i++) {
    const w = 8 + R() * 18;
    const h = minH + Math.pow(R(), 1.6) * (maxH - minH);
    d.position.set(x + w / 2, 0, z - R() * depth);
    d.scale.set(w, h, 8 + R() * 10);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    x += w + R() * 3;
    if (x > x1) x = x0 + R() * 20;
  }
  mesh.frustumCulled = false;
  scene.add(mesh);
  mesh.userData.update = (dt) => { mat.uniforms.uTime.value += dt; };
  return mesh;
}

// ------------------------------------------------------------------ rain

export class Rain {
  constructor(scene, { count = 7000, area = [70, 34, 40], color = '#9fb3d8', opacity = 0.32, wind = -0.18, speed = 24 } = {}) {
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(0.018, 0.85);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 4] = Math.random() * area[0];
      off[i * 4 + 1] = Math.random() * area[1];
      off[i * 4 + 2] = Math.random() * area[2];
      off[i * 4 + 3] = 0.75 + Math.random() * 0.5;
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = count;
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uArea: { value: new THREE.Vector3(...area) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uWind: { value: wind },
      uSpeed: { value: speed },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec4 aOff;
        uniform float uTime, uWind, uSpeed;
        uniform vec3 uCenter, uArea;
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          vUv = uv;
          vec3 o = aOff.xyz;
          float fall = uTime * uSpeed * aOff.w;
          vec3 p;
          p.y = mod(o.y - fall, uArea.y);
          p.x = mod(o.x - uCenter.x + p.y * uWind * 0.0 - fall * uWind, uArea.x);
          p.z = o.z;
          vec3 wpos = vec3(uCenter.x - uArea.x * 0.5 + p.x, uCenter.y - 6.0 + p.y, uCenter.z - uArea.z + 8.0 + p.z);
          vec3 lp = position;
          lp.x += lp.y * uWind;
          vec4 mv = viewMatrix * vec4(wpos + lp, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uOpacity, uFlash;
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          float a = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.6, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 2.0);
          a *= uOpacity * smoothstep(1.0, 4.0, vDepth) * (1.0 + uFlash * 3.0);
          gl_FragColor = vec4(uColor * (1.0 + uFlash * 2.0), a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.layers.set(1);
    scene.add(this.mesh);
  }
  update(dt, camera, flash = 0) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.set(camera.position.x, camera.position.y - 4, camera.position.z);
    this.uniforms.uFlash.value = flash;
  }
}

// ------------------------------------------------------------- lightning

export class Lightning {
  constructor(scene, sky, { min = 7, max = 18 } = {}) {
    this.sky = sky;
    this.next = 4 + Math.random() * 6;
    this.min = min; this.max = max;
    this.level = 0;
    this.seq = [];
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 9), transparent: true, opacity: 1, depthWrite: false, fog: false });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);
    this.onStrike = null;
  }
  makeBolt(x, z) {
    const pts = [];
    let px = x, py = 110;
    const segs = 22;
    for (let i = 0; i <= segs; i++) {
      pts.push(new THREE.Vector3(px, py, z));
      px += (Math.random() - 0.5) * 7;
      py -= 110 / segs * (0.7 + Math.random() * 0.6);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.TubeGeometry(curve, 60, 0.35, 4, false);
  }
  update(dt, camera) {
    this.next -= dt;
    if (this.next <= 0) {
      this.next = this.min + Math.random() * (this.max - this.min);
      this.seq = [0, 0.08, 0.16, 0.3].map((t, i) => ({ t, a: i === 2 ? 0.6 : 1 }));
      this.seqT = 0;
      const dist = Math.random();
      this.makeBolt(camera.position.x + (Math.random() - 0.5) * 140, -260 - dist * 200);
      if (this.onStrike) this.onStrike(dist);
    }
    if (this.seq.length) {
      this.seqT += dt;
      let lvl = 0;
      for (const s of this.seq) if (this.seqT >= s.t && this.seqT < s.t + 0.07) lvl = Math.max(lvl, s.a);
      this.level = lvl;
      if (this.seqT > 0.5) this.seq = [];
    } else this.level = Math.max(0, this.level - dt * 6);
    this.bolt.visible = this.level > 0.3;
    this.sky.uniforms.uLightning.value = this.level;
  }
}

// --------------------------------------------------------- wet street

const RIPPLE_GLSL = /* glsl */`
  float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 ripples(vec2 p, float t) {
    vec2 acc = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 2.2 : 3.7;
      vec2 q = p * sc + float(L) * 7.3;
      vec2 ci = floor(q);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = ci + vec2(i, j);
        float r = rh(c);
        vec2 ctr = c + vec2(rh(c + 1.3), rh(c + 7.1));
        float ph = fract(t * (0.6 + r * 0.5) + r);
        vec2 dv = q - ctr;
        float d = length(dv);
        float ring = sin((d - ph * 0.9) * 40.0) * smoothstep(0.0, 0.08, ph * 0.9 - d + 0.08) * smoothstep(ph * 0.9 + 0.02, ph * 0.9 - 0.06, d) * (1.0 - ph);
        acc += normalize(dv + 1e-4) * ring;
      }
    }
    return acc;
  }
`;

export class WetGround {
  /** Applies planar wet reflections to `materials` (MeshStandardMaterials of meshes lying in y = planeY). */
  constructor(renderer, { planeY = 0, scale = 0.5, strength = 0.85, rain = 1, puddleScale = 0.07, coverage = 0.55 } = {}) {
    this.renderer = renderer;
    this.planeY = planeY;
    this.scale = scale;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, s.x * scale), Math.max(2, s.y * scale), {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.texMatrix = new THREE.Matrix4();
    this.uniforms = {
      uRefl: { value: this.rt.texture },
      uTexMatrix: { value: this.texMatrix },
      uPuddle: { value: TX.puddleMask({ coverage }) },
      uTime: { value: 0 },
      uRain: { value: rain },
      uReflStrength: { value: strength },
      uPuddleScale: { value: puddleScale },
    };
    this.meshes = [];
  }

  apply(mesh) {
    const mat = mesh.material;
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uTexMatrix; varying vec4 vReflUv; varying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vReflUv = uTexMatrix * modelMatrix * vec4(transformed, 1.0); vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uRefl; uniform sampler2D uPuddle; uniform float uTime, uRain, uReflStrength, uPuddleScale;
          varying vec4 vReflUv; varying vec3 vWPos;
          ${RIPPLE_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float pud = texture2D(uPuddle, vWPos.xz * uPuddleScale).r;
          diffuseColor.rgb *= mix(1.0, 0.35, pud);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor * 0.75, 0.04, pud);`)
        .replace('#include <opaque_fragment>', `
          {
            vec2 rip = ripples(vWPos.xz, uTime) * uRain;
            vec2 ruv = vReflUv.xy / vReflUv.w;
            ruv += rip * 0.012 * (0.4 + pud) + (normal.xy) * 0.01 * (1.0 - pud);
            float lod = mix(3.8, 0.4, pud);
            vec3 refl = textureLod(uRefl, ruv, lod).rgb;
            float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            float fres = 0.08 + 0.92 * pow(1.0 - ndv, 4.0);
            float amt = uReflStrength * mix(0.35, 1.0, pud) * fres;
            outgoingLight = outgoingLight * (1.0 - amt * 0.6) + refl * amt;
          }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'wetground1';
    mat.needsUpdate = true;
    this.meshes.push(mesh);
  }

  resize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(Math.max(2, Math.floor(s.x * this.scale)), Math.max(2, Math.floor(s.y * this.scale)));
  }

  update(dt, scene, camera) {
    this.uniforms.uTime.value += dt;
    // Re-rendered every other frame (it costs as much CPU as the main pass). The puddles sample
    // it through the matrix of the camera it was rendered from, so static scenery stays
    // world-locked in between and only moving things lag a frame - invisible in a blurred,
    // rippled reflection. Camera cuts and jumps re-render immediately.
    const cut = !this.camPos || this.camPos.distanceToSquared(camera.position) > 0.25 || this.camFov !== camera.fov;
    if (!cut && !this.stale) { this.stale = true; return; }
    this.stale = false;
    (this.camPos ||= new THREE.Vector3()).copy(camera.position);
    this.camFov = camera.fov;
    const renderer = this.renderer;
    const n = new THREE.Vector3(0, 1, 0);
    const planePos = new THREE.Vector3(camera.position.x, this.planeY, 0);
    const camPos = camera.position.clone();
    if (camPos.y < this.planeY) return;
    const view = planePos.clone().sub(camPos);
    view.reflect(n).negate().add(planePos);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = planePos.clone().sub(lookAt);
    target.reflect(n).negate().add(planePos);
    const vc = this.camera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane clip
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, planePos);
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + pm[8]) / pm[0],
      (Math.sign(clip.y) + pm[9]) / pm[5],
      -1.0,
      (1.0 + pm[10]) / pm[14],
    );
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1.0 - 0.003; pm[14] = clip.w;

    for (const m of this.meshes) m.visible = false;
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevShadow;
    for (const m of this.meshes) m.visible = true;
  }
}
