// Renderer + post-processing chain:
//   RenderPass (MSAA HDR) -> UnrealBloom -> OutputPass (ACES + sRGB) -> FinalPass
// FinalPass does the "film" layer: grading, chromatic aberration, vignette, grain,
// heat haze, letterbox, flashes, damage pulse and the optional C64 retro mode.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.05 },
    uCA: { value: 0.0015 },
    uLetterbox: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uDamage: { value: 0 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uC64: { value: 0 },
    uHeat: { value: 0 },
    uFade: { value: 0 },
    uScan: { value: 0 },
    uWarp: { value: 0 },
    uLensRain: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uLetterbox, uDamage, uSat, uContrast, uC64, uHeat, uFade, uScan, uWarp, uLensRain;
    uniform vec2 uRes;
    uniform vec4 uFlash;
    uniform vec3 uLift, uGamma, uGain;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }

    const vec3 PAL[16] = vec3[16](
      vec3(0.0), vec3(1.0), vec3(0.408,0.216,0.169), vec3(0.439,0.643,0.698),
      vec3(0.435,0.239,0.525), vec3(0.345,0.553,0.263), vec3(0.208,0.157,0.475), vec3(0.722,0.78,0.435),
      vec3(0.435,0.31,0.145), vec3(0.263,0.224,0.0), vec3(0.604,0.404,0.349), vec3(0.267),
      vec3(0.424), vec3(0.604,0.824,0.518), vec3(0.424,0.369,0.71), vec3(0.584)
    );
    float bayer4(vec2 p) {
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      int idx = x + y * 4;
      int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
      return float(m[idx]) / 16.0 - 0.5;
    }
    vec3 c64(vec3 c, vec2 pix) {
      c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.25);
      c += bayer4(pix) * 0.11;
      float best = 1e9; vec3 res = c;
      for (int i = 0; i < 16; i++) {
        vec3 d = c - PAL[i];
        float e = dot(d * vec3(0.3, 0.59, 0.11), d) ;
        if (e < best) { best = e; res = PAL[i]; }
      }
      return res;
    }

    // Raindrops on the lens: a grid of cells, each with a drop that appears, sits,
    // slides a little and evaporates; returns a refraction offset and a drop mask.
    vec3 lensDrops(vec2 uv, float t, float aspect) {
      vec2 g = vec2(uv.x * aspect, uv.y) * 7.0;
      vec2 off = vec2(0.0); float mask = 0.0;
      for (int L = 0; L < 2; L++) {
        vec2 gg = g * (L == 0 ? 1.0 : 1.9) + float(L) * 3.7;
        vec2 id = floor(gg);
        float h = hash(id + float(L) * 17.0);
        float life = fract(t * (0.05 + h * 0.08) + h);
        vec2 c = id + vec2(0.2 + 0.6 * hash(id + 3.1), 0.25 + 0.5 * hash(id + 7.7));
        c.y -= smoothstep(0.55, 1.0, life) * 0.45;
        vec2 d = gg - c;
        d.y *= 1.0 + smoothstep(0.55, 1.0, life) * 0.8;
        float r = (0.07 + 0.07 * hash(id + 11.0)) * (L == 0 ? 1.0 : 0.7);
        float dl = length(d);
        float drop = smoothstep(r, r * 0.6, dl) * step(h, 0.55) * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
        off += d / r * drop * 0.012;
        mask = max(mask, drop);
      }
      return vec3(off, mask);
    }

    void main() {
      vec2 uv = vUv;
      float lensMask = 0.0;
      if (uLensRain > 0.0) {
        vec3 ld = lensDrops(vUv, uTime, uRes.x / uRes.y);
        uv -= ld.xy * uLensRain;
        lensMask = ld.z * uLensRain;
      }
      // shockwave / impact warp
      if (uWarp > 0.0) {
        vec2 d = uv - 0.5;
        uv += d * uWarp * 0.06 * sin(length(d) * 30.0 - uTime * 20.0);
      }
      // heat haze, strongest at the bottom of the frame
      if (uHeat > 0.0) {
        float k = uHeat * smoothstep(0.85, 0.0, uv.y);
        uv.x += (noise(uv * vec2(18.0, 9.0) + vec2(0.0, -uTime * 2.2)) - 0.5) * 0.006 * k;
        uv.y += (noise(uv * vec2(14.0, 7.0) + vec2(3.0, -uTime * 1.7)) - 0.5) * 0.004 * k;
      }
      vec2 pix = uv * uRes;
      if (uC64 > 0.5) {
        vec2 lo = vec2(320.0, 200.0);
        vec2 cell = floor(uv * lo);
        uv = (cell + 0.5) / lo;
        pix = cell * vec2(1.0);
      }
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      float ca = uCA * (1.0 + r2 * 4.0) + uDamage * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dc * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dc * ca).b;

      // grading (display-referred)
      col = pow(max(col, 0.0), 1.0 / uGamma);
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // contrast as an S-curve around mid-grey (slope uContrast there) that keeps the toe: a
      // linear stretch clipped everything under ~4% to black, and with it every unlit ledge
      vec3 c2 = clamp(2.0 * col, 0.0, 2.0);
      col = mix(0.5 * pow(c2, vec3(uContrast)), 1.0 - 0.5 * pow(2.0 - c2, vec3(uContrast)), step(1.0, c2));

      // damage pulse: desaturate + red edge
      if (uDamage > 0.0) {
        float lum = dot(col, vec3(0.3, 0.59, 0.11));
        col = mix(col, vec3(lum) * vec3(1.1, 0.75, 0.75), uDamage * 0.5);
        col += vec3(0.45, 0.0, 0.02) * uDamage * smoothstep(0.15, 0.55, r2 * 2.2);
      }

      // vignette
      col *= mix(1.0, smoothstep(0.95, 0.15, r2 * 1.9), uVignette);
      col += lensMask * 0.035;

      if (uC64 > 0.5) {
        col = c64(clamp(col, 0.0, 1.0), pix);
      } else {
        // film grain (luma-weighted)
        float g = hash(pix + fract(uTime * 37.0) * 100.0) - 0.5;
        col += g * uGrain * (1.0 - l * 0.6);
        // scanlines (cinematic intro flavor)
        col *= 1.0 - uScan * 0.12 * (0.5 + 0.5 * sin(pix.y * 3.14159));
      }

      // flash (muzzle/explosion/lightning) and fades
      col = mix(col, uFlash.rgb, clamp(uFlash.a, 0.0, 1.0));
      col *= 1.0 - uFade;

      // letterbox bars (cinematics)
      float bar = uLetterbox * 0.12;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.pixelRatio = Math.min(this.maxPixelRatio, 1.25);
    r.setPixelRatio(this.pixelRatio);
    r.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(r.domElement);
    r.domElement.tabIndex = 0;
    this.gl = r;
    this.container = container;

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(null, null);
    this.composer.addPass(this.renderPass);
    // Safety net: a single NaN/Inf pixel (bad normal, divide-by-zero in a shader) would be
    // smeared into huge black blocks by the bloom mip chain – zero them before bloom.
    this.sanitize = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a);
        }`,
    });
    this.composer.addPass(this.sanitize);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.75, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;

    this.flash = { color: new THREE.Color(1, 1, 1), amount: 0, decay: 6 };
    this.damage = 0;
    this.warp = 0;
    this.frameTimes = [];
    this.lastQualityChange = 0;
    this.time = 0;
    this.autoQuality = true;

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    // cached CSS size: reading clientWidth/Height every frame forces a synchronous style +
    // layout pass right after the HUD's DOM writes
    this.width = w;
    this.height = h;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    const s = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.u.uRes.value.set(s.x, s.y);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  setGrade(g = {}) {
    const u = this.u;
    if (g.lift) u.uLift.value.set(...g.lift);
    if (g.gamma) u.uGamma.value.set(...g.gamma);
    if (g.gain) u.uGain.value.set(...g.gain);
    if (g.sat !== undefined) u.uSat.value = g.sat;
    if (g.contrast !== undefined) u.uContrast.value = g.contrast;
    if (g.vignette !== undefined) u.uVignette.value = g.vignette;
    if (g.grain !== undefined) u.uGrain.value = g.grain;
    if (g.ca !== undefined) u.uCA.value = g.ca;
    if (g.heat !== undefined) u.uHeat.value = g.heat;
    u.uLensRain.value = g.lensRain ?? 0;
    if (g.exposure !== undefined) this.gl.toneMappingExposure = g.exposure;
    if (g.bloom) {
      if (g.bloom.strength !== undefined) this.bloom.strength = g.bloom.strength;
      if (g.bloom.radius !== undefined) this.bloom.radius = g.bloom.radius;
      if (g.bloom.threshold !== undefined) this.bloom.threshold = g.bloom.threshold;
    }
  }

  doFlash(color = '#ffffff', amount = 0.6, decay = 8) {
    this.flash.color.set(color);
    this.flash.amount = Math.max(this.flash.amount, amount);
    this.flash.decay = decay;
  }

  hurt(amount = 1) { this.damage = Math.min(1, this.damage + amount); }
  shock(amount = 1) { this.warp = Math.max(this.warp, amount); }

  set letterbox(v) { this.u.uLetterbox.value = v; }
  get letterbox() { return this.u.uLetterbox.value; }
  set fade(v) { this.u.uFade.value = v; }
  get fade() { return this.u.uFade.value; }
  set c64(v) { this.u.uC64.value = v ? 1 : 0; }
  get c64() { return this.u.uC64.value > 0.5; }
  set scan(v) { this.u.uScan.value = v; }

  render(scene, camera, dt) {
    this.camera = camera;
    this.time += dt;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.flash.amount = Math.max(0, this.flash.amount - dt * this.flash.decay);
    this.damage = Math.max(0, this.damage - dt * 1.6);
    this.warp = Math.max(0, this.warp - dt * 2.5);
    const u = this.u;
    u.uTime.value = this.time;
    u.uFlash.value.set(this.flash.color.r, this.flash.color.g, this.flash.color.b, this.flash.amount);
    u.uDamage.value = this.damage;
    u.uWarp.value = this.warp;
    this.composer.render(dt);
    this.trackPerformance(dt);
  }

  // Dynamic resolution: step pixel ratio down when frames are slow, back up when fast. Every
  // step reallocates the render targets (a small hitch and a visible resolution change), so it
  // follows sustained trends only: one slow window (median of 90 frames) steps down, stepping up
  // needs three fast windows in a row and never comes within 15 s of a step down (no ping-pong).
  trackPerformance(dt) {
    if (!this.autoQuality || this.time < 4) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length * 0.5)];
    this.frameTimes.length = 0;
    this.fastWindows = med < 1 / 58 ? (this.fastWindows || 0) + 1 : 0;
    if (this.time - this.lastQualityChange < 3) return;
    let next = this.pixelRatio;
    if (med > 1 / 45) next = Math.max(0.6, this.pixelRatio - 0.15);
    else if (this.fastWindows >= 3 && this.pixelRatio < this.maxPixelRatio && this.time - (this.lastDrop ?? -1e9) > 15) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (Math.abs(next - this.pixelRatio) > 0.01) {
      if (next < this.pixelRatio) this.lastDrop = this.time;
      this.pixelRatio = next;
      this.lastQualityChange = this.time;
      this.fastWindows = 0;
      this.resize();
    }
  }
}
