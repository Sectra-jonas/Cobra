// Frame-time instrumentation, injected before any page script by tools/perf.py.
// Records every rAF interval plus what happened in the frame that caused it: WebGL calls
// that can block (shader compile/link, uploads) with the time spent inside them, draw
// counts and named JS segments (perf.wrap). Long frames can then be attributed.
(() => {
  const P = (window.__perf = { frames: [], on: false });
  const fresh = () => ({ gl: {}, seg: {}, ev: [], draws: 0 });
  P.cur = fresh();
  const add = (bucket, name, ms) => {
    const a = P.cur[bucket][name] || (P.cur[bucket][name] = [0, 0]);
    a[0]++; a[1] += ms;
  };
  P.event = (s) => P.cur.ev.push(s);
  // time every call of obj[name] into segment `label` (inclusive of nested work)
  P.wrap = (obj, name, label) => {
    const orig = obj && obj[name];
    if (typeof orig !== 'function' || orig.__perf) return false;
    const w = function (...a) {
      const t = performance.now();
      try { return orig.apply(this, a); } finally { add('seg', label, performance.now() - t); }
    };
    w.__perf = true;
    obj[name] = w;
    return true;
  };
  P.wrapProto = (cls, label, skip = []) => {
    if (!cls) return;
    for (const k of Object.getOwnPropertyNames(cls.prototype)) {
      if (k === 'constructor' || skip.includes(k)) continue;
      const d = Object.getOwnPropertyDescriptor(cls.prototype, k);
      if (d && typeof d.value === 'function') P.wrap(cls.prototype, k, `${label}.${k}`);
    }
  };

  const GL = ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog',
    'getShaderInfoLog', 'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation',
    'texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'texStorage2D', 'texStorage3D', 'generateMipmap',
    'bufferData', 'bufferSubData', 'readPixels', 'renderbufferStorageMultisample', 'renderbufferStorage',
    'blitFramebuffer', 'finish', 'flush', 'getError', 'checkFramebufferStatus', 'invalidateFramebuffer'];
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const name of GL) {
      const orig = C.prototype[name];
      if (!orig) continue;
      C.prototype[name] = function (...a) {
        const t = performance.now();
        const r = orig.apply(this, a);
        add('gl', name, performance.now() - t);
        return r;
      };
    }
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C.prototype[name];
      if (!orig) continue;
      C.prototype[name] = function (...a) { P.cur.draws++; return orig.apply(this, a); };
    }
  }

  // Our rAF callback is registered before the game's, so at tick N it sees the work of
  // frame N-1, and (now - last) is the interval that work produced.
  let last = 0;
  const tick = (now) => {
    if (P.on) {
      P.cur.dt = now - last;
      P.cur.t = now;
      if (P.sample) { try { Object.assign(P.cur, P.sample()); } catch (e) { /* level switching */ } }
      P.frames.push(P.cur);
    }
    P.cur = fresh();
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // long tasks outside rAF (timers, input, GC-heavy callbacks)
  P.longtasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { /* unsupported */ }
})();
