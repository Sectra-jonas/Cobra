// COBRA (2026 remake) – procedural audio engine: music, SFX and ambience, all synthesized
// at runtime with the Web Audio API (no audio files, no dependencies).
//
// Signal flow
//   instruments -> channel strips (per track) -> track faders -> musicBus -> duck -> slowLP ┐
//   sfx voices  -> panner -> sfxBus ------------------------------------------> slowLP ┤
//   ambience beds -> ambBus ------------------------------------------------------------ ┤
//   slowLP / ambBus -> master -> muffle LPF -> glue compressor -> soft limiter -> out
//   Sends: hall (music), gated reverb (80s snares), ping-pong delay (leads), chorus (pads),
//          room + big (sfx). All impulse responses / noise / curves are generated once.
//
// The Engine class only needs a BaseAudioContext, so the same code renders into an
// OfflineAudioContext for the self-test (see renderOffline at the bottom).

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
// Global tuning multiplier: Track sets it while scheduling (tape-style slow-motion).
let TUNE = 1;
const mtof = (m) => TUNE * 440 * Math.pow(2, (m - 69) / 12);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const EPS = 0.0001;

// ---------------------------------------------------------------------------------------
// Note / pattern helpers
// ---------------------------------------------------------------------------------------
const NOTE_IDX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// 'c#4' | 'bb3' | 60 -> midi number
function nm(s) {
  if (typeof s === 'number') return s;
  const m = /^([a-g])([#b]?)(-?\d)$/.exec(s.toLowerCase());
  if (!m) throw new Error('audio: bad note ' + s);
  return 12 * (+m[3] + 1) + NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
// Melody notation: "d5/4 a4/2 r/2 | f5/8" -> [{s: step, m: midi|null, l: len}] (16th steps).
// '|' is only a visual bar separator. A trailing '!' marks an accent.
function mel(str) {
  const out = []; let s = 0;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|' || !tok) continue;
    const [n, l0] = tok.split('/');
    const acc = l0 && l0.endsWith('!');
    const l = parseFloat(l0 || '2');
    if (n !== 'r') out.push({ s, m: nm(n), l, acc });
    s += l;
  }
  out.len = s;
  return out;
}
const CHORD_Q = {
  '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7, 12], sus4: [0, 5, 7], sus2: [0, 2, 7], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], dim: [0, 3, 6], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  m9: [0, 3, 7, 10, 14], aug: [0, 4, 8],
};
// 'Dm' / 'Bb' / 'F#m7' / 'E5' -> {root (midi in octave 2..3), tones: intervals}
function chord(sym) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
  const root = 36 + NOTE_IDX[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { root, iv: CHORD_Q[m[3]] || CHORD_Q[''] };
}
// Voice a chord with every tone inside [lo, lo+14) – smooth pad/stab voicings.
function voicing(sym, lo = 55) {
  const { root, iv } = chord(sym);
  return iv.map((i) => { let n = root + i; while (n < lo) n += 12; while (n >= lo + 14) n -= 12; return n; })
    .sort((a, b) => a - b);
}
// Drum pattern string, 16 chars per bar: X accent, x normal, o ghost, . rest
function hits(str) {
  const v = { X: 1, x: 0.75, o: 0.4, '-': 0.25 };
  const out = [];
  for (let i = 0; i < str.length; i++) if (v[str[i]]) out.push([i, v[str[i]]]);
  return out;
}
const PAT = (str) => { const h = hits(str); const a = new Array(str.length).fill(0); for (const [i, v] of h) a[i] = v; return a; };

// ---------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------
class Engine {
  constructor(ctx, { offline = false } = {}) {
    this.ctx = ctx;
    this.offline = offline;
    this.sr = ctx.sampleRate;
    this.maxF = Math.min(20000, this.sr * 0.45); // 'wide open' filter frequency
    this.cache = new Map();
    try { const f = ctx.createBiquadFilter(); f.frequency.automationRate = 'k-rate'; this.kRate = f.frequency.automationRate === 'k-rate'; } catch (err) { this.kRate = false; }
    this.listenerX = 0;
    this.slow = 1;
    this.intensity = 0;
    this.voices = [];
    this.beatCbs = new Set();
    this.beatQueue = [];
    this.track = null;
    this.oldTracks = [];
    this.amb = null;
    this.oldAmb = [];
    this.build();
  }

  // ---- node helpers --------------------------------------------------------------------
  gain(v = 1, dest = null) { const n = this.ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; }
  // Filters run their params at k-rate: envelopes/LFOs stay smooth (128-sample steps) but the
  // biquad no longer recomputes coefficients every sample – by far the biggest CPU saving.
  filt(type, f, Q = 0.707, dest = null) {
    const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = Q;
    if (this.kRate) { n.frequency.automationRate = 'k-rate'; n.Q.automationRate = 'k-rate'; n.gain.automationRate = 'k-rate'; }
    if (dest) n.connect(dest); return n;
  }
  osc(type, f, dest = null) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f; if (dest) o.connect(dest); return o;
  }
  pan(p, dest = null) {
    const n = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.gain(1);
    if (n.pan) n.pan.value = clamp(p, -1, 1);
    if (dest) n.connect(dest); return n;
  }
  shaper(curve, dest = null, os = '2x') { const n = this.ctx.createWaveShaper(); n.curve = curve; n.oversample = os; if (dest) n.connect(dest); return n; }
  // Plays a cached noise buffer: kind 'white'|'pink'|'brown'|'white2' (stereo)
  noise(kind, t, dur, dest, rate = 1) {
    const b = this.noiseBuf(kind);
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.loop = true; s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t, Math.random() * (b.duration - 0.1));
    if (dur != null) s.stop(t + dur);
    return s;
  }
  // gain envelope: 0 -> peak in a, exponential decay toward 0 with time constant d
  perc(param, t, peak, a, d, end = null) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(0, t + a, d);
    if (end != null) param.setValueAtTime(0, end);
  }
  // ADSR on a gain param for a note of length len (seconds)
  adsr(param, t, len, a, d, s, r, peak = 1) {
    const ta = t + a, td = ta + d, tr = Math.max(t + len, ta);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, ta);
    if (tr > ta) param.setTargetAtTime(peak * s, ta, d / 3 + 0.001);
    param.setTargetAtTime(0, tr, r / 4 + 0.001);
    return tr + r + 0.05;
  }
  sweep(param, t, from, to, dur, exp = true) {
    param.setValueAtTime(from, t);
    if (exp) param.exponentialRampToValueAtTime(Math.max(to, 1e-3), t + dur);
    else param.linearRampToValueAtTime(to, t + dur);
  }

  // ---- cached resources ------------------------------------------------------------------
  cached(key, make) { let v = this.cache.get(key); if (!v) { v = make(); this.cache.set(key, v); } return v; }

  noiseBuf(kind) {
    return this.cached('noise:' + kind, () => {
      const stereo = kind === 'white2' || kind === 'pink2';
      const len = Math.floor(this.sr * (stereo ? 4 : 2.5));
      const buf = this.ctx.createBuffer(stereo ? 2 : 1, len, this.sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          if (kind.startsWith('white')) d[i] = w;
          else if (kind.startsWith('pink')) { // Paul Kellet's refined pink filter
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
          } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown
        }
        // crossfade the loop seam
        const xf = 2048;
        for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
      }
      return buf;
    });
  }

  // Exponentially decaying stereo noise IR with progressive high-frequency damping.
  // gated: dense plateau then an abrupt cut (Phil Collins / LinnDrum era).
  ir(name, secs, { decay = 3, damp = 0.4, pre = 0.01, gated = false, bright = 1 } = {}) {
    return this.cached('ir:' + name, () => {
      const len = Math.floor(this.sr * secs);
      const buf = this.ctx.createBuffer(2, len, this.sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0, e2 = 0;
        const p0 = Math.floor(pre * this.sr);
        for (let i = 0; i < len; i++) {
          const t = i / this.sr;
          let env;
          if (gated) env = t < 0.012 ? t / 0.012 : (t < secs - 0.03 ? 1 - 0.35 * (t / secs) : Math.max(0, (secs - t) / 0.03) * 0.65);
          else env = Math.exp(-t * decay) * (i < p0 ? i / p0 : 1);
          const w = Math.random() * 2 - 1;
          const a = clamp(bright * (1 - damp * Math.min(1, t / secs * 2.2)), 0.05, 1);
          lp += a * (w - lp);
          const v = lp * env;
          d[i] = v; e2 += v * v;
        }
        // early reflections for non-gated rooms
        if (!gated) for (let k = 0; k < 6; k++) {
          const i = Math.floor((0.007 + k * 0.011 + Math.random() * 0.008 + ch * 0.003) * this.sr);
          if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * Math.exp(-k * 0.4) * Math.sqrt(e2 / len) * 6;
        }
        let s = 0; for (let i = 0; i < len; i++) s += d[i] * d[i];
        const norm = 1 / Math.sqrt(s || 1);
        for (let i = 0; i < len; i++) d[i] *= norm;
      }
      return buf;
    });
  }

  curve(name, fn, n = 2048) {
    return this.cached('curve:' + name, () => {
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
      return c;
    });
  }
  // tanh drive curve, k = amount
  drive(k) { return this.curve('drive' + k, (x) => Math.tanh(k * x) / Math.tanh(k)); }
  // asymmetric "fuzz" for synth guitar / roars
  fuzz() { return this.curve('fuzz', (x) => { const y = x >= 0 ? Math.tanh(4 * x) : Math.tanh(2.6 * x) * 0.92; return y * 0.9; }); }

  periodic(name, real, imag) {
    return this.cached('wave:' + name, () => this.ctx.createPeriodicWave(new Float32Array(real), new Float32Array(imag), { disableNormalization: false }));
  }

  // ---- master graph ----------------------------------------------------------------------
  build() {
    const c = this.ctx;
    // Soft limiter: linear to 0.6, tanh knee above; input pre-scaled by 0.5 so the curve
    // covers ±2.0 and the output can never exceed 0.98.
    const limCurve = this.curve('limiter', (x) => {
      const v = Math.abs(x * 2);
      const y = v < 0.6 ? v : 0.6 + 0.38 * Math.tanh((v - 0.6) / 0.38);
      return Math.sign(x) * y;
    }, 4096);
    this.limiter = this.shaper(limCurve, c.destination, '4x');
    this.limPre = this.gain(0.5, this.limiter);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 6; this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.008; this.comp.release.value = 0.2;
    this.comp.connect(this.limPre);
    this.makeup = this.gain(1.1, this.comp);
    this.muffle = this.filt('lowpass', this.maxF, 0.6, this.makeup);
    this.master = this.gain(0.85, this.muffle);
    this.slowLP = this.filt('lowpass', this.maxF, 0.5, this.master);
    this.musicDuck = this.gain(1, this.slowLP);
    this.musicBus = this.gain(0.34, this.musicDuck);
    this.sfxBus = this.gain(0.8, this.slowLP);
    this.ambBus = this.gain(0.35, this.master);

    // reverbs
    const conv = (buf, ret, retGain) => { const n = c.createConvolver(); n.normalize = false; n.buffer = buf; n.connect(this.gain(retGain, ret)); return n; };
    this.hallIn = this.gain(1, conv(this.ir('hall', 2.9, { decay: 1.8, damp: 0.75, pre: 0.02 }), this.musicBus, 0.55));
    this.gateIn = this.gain(1, conv(this.ir('gate', 0.34, { gated: true, bright: 0.55 }), this.musicBus, 0.5));
    this.roomIn = this.gain(1, conv(this.ir('room', 0.9, { decay: 5.5, damp: 0.6, pre: 0.005 }), this.sfxBus, 0.5));
    this.bigIn = this.gain(1, conv(this.ir('big', 2.6, { decay: 1.8, damp: 0.85, pre: 0.03, bright: 0.6 }), this.sfxBus, 0.5));

    // ping-pong delay for leads (time set per track)
    this.delayIn = this.gain(1);
    const dl = c.createDelay(2), dr = c.createDelay(2);
    dl.delayTime.value = 0.375; dr.delayTime.value = 0.375;
    const fb = this.gain(0.42), fb2 = this.gain(0.42);
    const dlp = this.filt('lowpass', 3200, 0.5), dhp = this.filt('highpass', 250, 0.5);
    this.delayIn.connect(dhp); dhp.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dr); dr.connect(fb2); fb2.connect(dl);
    const mrg = c.createChannelMerger(2);
    dl.connect(mrg, 0, 0); dr.connect(mrg, 0, 1);
    mrg.connect(this.gain(0.6, this.musicBus));
    mrg.connect(this.gain(0.15, this.hallIn));
    this.delayL = dl; this.delayR = dr;

    // stereo chorus for pads / polys
    this.chorusIn = this.gain(1);
    this.chorusIn.connect(this.gain(0.6, this.musicBus));
    for (const [base, rate, p] of [[0.011, 0.53, -0.85], [0.017, 0.41, 0.85], [0.023, 0.29, 0]]) {
      const d = c.createDelay(0.1); d.delayTime.value = base;
      const lfo = this.osc('sine', rate); const lg = this.gain(base * 0.18); lfo.connect(lg); lg.connect(d.delayTime); lfo.start();
      this.chorusIn.connect(d); d.connect(this.pan(p, this.gain(p ? 0.5 : 0.3, this.musicBus)));
    }
  }

  setDelayTime(sec) {
    const t = this.ctx.currentTime;
    this.delayL.delayTime.setTargetAtTime(sec, t, 0.05);
    this.delayR.delayTime.setTargetAtTime(sec, t, 0.05);
  }
}

// ---------------------------------------------------------------------------------------
// Baked one-shots: dense percussion (hats, snare noise, claps, axe clangs) is synthesized
// once in JS into cached AudioBuffers (a few random variants each), so a hit costs one
// BufferSource instead of a small node graph.
// ---------------------------------------------------------------------------------------
// RBJ biquad as a per-sample JS function (for baking only).
function rbj(type, f, Q, sr, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; } // peaking
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
Engine.prototype.bake = function (key, secs, gen, channels = 1) {
  return this.cached('bake:' + key, () => {
    const n = Math.ceil(secs * this.sr), buf = this.ctx.createBuffer(channels, n, this.sr);
    for (let c = 0; c < channels; c++) gen(buf.getChannelData(c), this.sr, c);
    return buf;
  });
};
Engine.prototype.play = function (buf, t, dest, rate = 1, v = 1) {
  const s = this.ctx.createBufferSource();
  s.buffer = buf; s.playbackRate.value = rate;
  s.connect(this.gain(v, dest)); s.start(t);
  return s;
};
const VARIANTS = 3;
const variant = () => (Math.random() * VARIANTS) | 0;
// Filtered, enveloped noise burst baked to a buffer: env = linear attack a, exponential decay tau.
function bakeNoise(e, key, secs, filters, a, tau, gain = 1) {
  return e.bake(key, secs, (d, sr) => {
    const fs = filters.map(([ty, f, q, g]) => rbj(ty, f, q, sr, g));
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let x = Math.random() * 2 - 1;
      for (const f of fs) x = f(x);
      d[i] = x * gain * Math.min(1, t / a) * Math.exp(-t / tau);
    }
  });
}

// ---------------------------------------------------------------------------------------
// Music instruments. Signature: (e: Engine, out: AudioNode, t: start time, ...).
// Each builds a short-lived voice graph that stops itself; shared resources are cached.
// ---------------------------------------------------------------------------------------
const VOWELS = {
  a: [[800, 6, 1], [1150, 7, 0.5], [2900, 9, 0.25]],
  o: [[450, 6, 1], [800, 7, 0.45], [2830, 10, 0.15]],
  e: [[400, 6, 1], [1700, 8, 0.4], [2600, 10, 0.25]],
  u: [[325, 6, 1], [700, 7, 0.3], [2530, 10, 0.1]],
  i: [[270, 7, 1], [2140, 9, 0.35], [2950, 10, 0.25]],
  uh: [[640, 6, 1], [1190, 7, 0.45], [2390, 9, 0.2]],
  ae: [[660, 6, 1], [1720, 8, 0.5], [2410, 9, 0.3]],
  m: [[260, 5, 1], [1050, 4, 0.08], [2200, 6, 0.03]],
};

// LinnDrum-style kick: pitch-swept sine body + noise click.
function kick(e, out, t, v = 1, p = {}) {
  const tune = p.tune || 1, dec = p.decay || 0.45;
  const g = e.gain(0, out);
  const o = e.osc('sine', 190 * tune, g);
  o.frequency.setValueAtTime(210 * tune, t);
  o.frequency.exponentialRampToValueAtTime(56 * tune, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(41 * tune, t + dec);
  e.perc(g.gain, t, v, 0.002, dec * 0.4);
  o.start(t); o.stop(t + dec * 2.6);
  const cg = e.gain(0, out);
  e.noise('white', t, 0.03, e.filt('highpass', 1600, 0.7, cg));
  e.perc(cg.gain, t, v * 0.32 * (p.click ?? 1), 0.0008, 0.007);
}

// Snare: tuned body + bright noise. The channel's gated-reverb send makes it "80s".
function snare(e, out, t, v = 1, p = {}) {
  const tone = p.tone || 190, dec = p.decay || 0.2;
  const bg = e.gain(0, out);
  const b = e.osc('triangle', tone * 1.8, bg);
  b.frequency.setValueAtTime(tone * 2, t); b.frequency.exponentialRampToValueAtTime(tone, t + 0.035);
  e.perc(bg.gain, t, v * 0.7, 0.001, 0.05); b.start(t); b.stop(t + 0.35);
  const nb = bakeNoise(e, 'snare' + dec + '_' + variant(), dec * 2.6, [['highpass', 1100, 0.6], ['peaking', 5200, 1, 5]], 0.001, dec / 2.6);
  e.play(nb, t, out, 1, v * 0.75 * (p.snap ?? 1));
}

// Clap: 4 staggered noise bursts + tail through a bandpass.
function clap(e, out, t, v = 1) {
  const buf = e.bake('clap' + variant(), 0.45, (d, sr) => {
    const bp = rbj('bandpass', 1300, 1.4, sr);
    const starts = [0, 0.009, 0.018, 0.027].map((x) => x + Math.random() * 0.003);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let env = 0;
      starts.forEach((s0, k) => { if (t >= s0) env = Math.max(env, (k === 3 ? 1.3 : 1) * Math.exp(-(t - s0) / (k === 3 ? 0.07 : 0.004))); });
      d[i] = bp(Math.random() * 2 - 1) * env * 1.6;
    }
  });
  e.play(buf, t, out, rnd(0.97, 1.03), v);
}

function hat(e, out, t, v = 1, open = false) {
  const buf = bakeNoise(e, (open ? 'ohat' : 'hat') + variant(), open ? 0.75 : 0.12,
    [['highpass', open ? 6500 : 7800, 0.8], ['peaking', 10500, 1.5, 6]], 0.0015, open ? 0.13 : 0.018);
  e.play(buf, t, out, 1, v);
}

function crash(e, out, t, v = 1, len = 2.4) {
  const g = e.gain(0, out);
  const hp = e.filt('highpass', 3800, 0.6, g);
  e.noise('white2', t, len * 1.6, hp);
  e.perc(g.gain, t, v * 0.42, 0.003, len / 3.5);
  const rg = e.gain(0, out);
  e.noise('white2', t, len, e.filt('bandpass', 7800, 2.5, rg));
  e.perc(rg.gain, t, v * 0.5, 0.001, len / 5);
}

function tom(e, out, t, m, v = 1) {
  const f = mtof(m);
  const g = e.gain(0, out);
  const o = e.osc('sine', f * 1.7, g);
  o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  e.perc(g.gain, t, v * 0.85, 0.002, 0.16); o.start(t); o.stop(t + 0.75);
  const ng = e.gain(0, out);
  e.noise('white', t, 0.1, e.filt('lowpass', f * 8, 0.7, ng));
  e.perc(ng.gain, t, v * 0.25, 0.001, 0.02);
}

// Analog bass: two detuned saws + sine sub through a resonant LPF with envelope.
function bass(e, out, t, m, len, v = 1, p = {}) {
  const f = mtof(m);
  const amp = e.gain(0, out);
  const flt = e.filt('lowpass', 300, p.q ?? 6, amp);
  const o1 = e.osc(p.wave || 'sawtooth', f, flt); o1.detune.value = -9;
  const o2 = e.osc(p.wave || 'sawtooth', f, flt); o2.detune.value = 9;
  const sg = e.gain(p.sub ?? 0.5, amp);
  const so = e.osc('sine', f / (p.subOct ? 2 : 1), sg);
  const cut = p.cut ?? 260, env = p.env ?? 1800, dec = p.decay ?? 0.11;
  flt.frequency.setValueAtTime(cut + env * v, t);
  flt.frequency.setTargetAtTime(cut, t + 0.002, dec);
  const end = e.adsr(amp.gain, t, len, 0.003, 0.09, p.sus ?? 0.75, 0.04, v * 0.42);
  for (const o of [o1, o2, so]) { o.start(t); o.stop(end); }
}

// Poly-synth / brass / pad: detuned saws per note into one shared filter + amp.
function poly(e, out, t, notes, len, v = 1, p = {}) {
  const amp = e.gain(0, out);
  const flt = e.filt('lowpass', 800, p.q ?? 1.2, amp);
  const det = p.det ?? 11;
  const oscs = [];
  for (const m of notes) for (const d of p.three ? [-det, 0, det] : [-det, det]) {
    const o = e.osc(p.wave || 'sawtooth', mtof(m), flt); o.detune.value = d + rnd(-2, 2); oscs.push(o);
  }
  const cut = p.cut ?? 700, env = p.env ?? 3200, fa = p.fa ?? 0.04;
  flt.frequency.setValueAtTime(cut, t);
  flt.frequency.linearRampToValueAtTime(cut + env * v, t + fa);
  flt.frequency.setTargetAtTime(cut + env * (p.fs ?? 0.3) * v, t + fa, p.fd ?? 0.18);
  if (p.close) flt.frequency.setTargetAtTime(cut, t + len, 0.1);
  const peak = v * (p.vol ?? 0.2) / Math.sqrt(notes.length * (p.three ? 1.5 : 1));
  const end = e.adsr(amp.gain, t, len, p.a ?? 0.008, p.d ?? 0.25, p.s ?? 0.65, p.r ?? 0.3, peak);
  for (const o of oscs) { o.start(t); o.stop(end); }
}
const brass = (e, out, t, notes, len, v = 1, p = {}) =>
  poly(e, out, t, notes, len, v, { a: 0.045, fa: 0.09, cut: 500, env: 2600, fs: 0.45, fd: 0.3, d: 0.4, s: 0.8, r: 0.35, vol: 0.24, ...p });
const stab = (e, out, t, notes, len, v = 1, p = {}) =>
  poly(e, out, t, notes, len, v, { a: 0.003, fa: 0.006, cut: 450, env: 4800, fs: 0.15, fd: 0.09, d: 0.12, s: 0.35, r: 0.18, vol: 0.24, ...p });
const pad = (e, out, t, notes, len, v = 1, p = {}) =>
  poly(e, out, t, notes, len, v, { a: 1.2, fa: 1.8, cut: 380, env: 1300, fs: 0.8, fd: 1.5, d: 1, s: 0.9, r: 1.6, vol: 0.16, three: true, det: 14, ...p });

// DX7-ish FM bell / glass: modulator ratio + decaying index, plus a short "tine" partial.
function bell(e, out, t, m, len, v = 1, p = {}) {
  const f = mtof(m);
  const amp = e.gain(0, out);
  const car = e.osc('sine', f, amp);
  const mod = e.osc('sine', f * (p.ratio ?? 3.5));
  const mg = e.gain(0); mod.connect(mg); mg.connect(car.frequency);
  const idx = p.index ?? 2.4;
  mg.gain.setValueAtTime(f * idx, t); mg.gain.setTargetAtTime(f * idx * 0.12, t, p.idec ?? 0.3);
  const dec = p.decay ?? 0.9;
  e.perc(amp.gain, t, v * 0.22, 0.002, dec);
  const tg = e.gain(0, out); const tine = e.osc('sine', f * 7.01, tg);
  e.perc(tg.gain, t, v * 0.05, 0.001, 0.05);
  const end = t + Math.max(len, dec * 5);
  for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
}

// C64 SID nod: one pulse voice racing through chord tones (~30 Hz) – pulse width
// modulation from the difference of two slightly detuned saws.
function pulseArp(e, out, t, notes, len, v = 1, p = {}) {
  const rate = p.rate ?? 1 / 30, pw = p.pwm ?? 0.9;
  const a = e.osc('sawtooth', mtof(notes[0])), b = e.osc('sawtooth', mtof(notes[0]));
  const amp = e.gain(0, out);
  const lp = e.filt('lowpass', p.cut ?? 4200, 0.7, amp);
  const hp = e.filt('highpass', 120, 0.7, lp);
  a.connect(hp); const inv = e.gain(-1, hp); b.connect(inv);
  let i = 0;
  for (let tt = t; tt < t + len; tt += rate, i++) {
    const f = mtof(notes[i % notes.length]);
    a.frequency.setValueAtTime(f, tt); b.frequency.setValueAtTime(f + pw, tt);
  }
  const end = e.adsr(amp.gain, t, len, 0.004, 0.1, p.sus ?? 0.7, 0.06, v * 0.11);
  a.start(t); b.start(t + 0.5 / mtof(notes[0])); a.stop(end); b.stop(end);
}

// Lead synth: saw + square, delayed vibrato, optional glide.
function lead(e, out, t, m, len, v = 1, p = {}) {
  const f = mtof(m);
  const amp = e.gain(0, out);
  const flt = e.filt('lowpass', 2000, p.q ?? 2, amp);
  const o1 = e.osc(p.wave || 'sawtooth', f, flt);
  const o2g = e.gain(0.6, flt); const o2 = e.osc('square', f, o2g); o2.detune.value = p.det ?? 7;
  if (p.from != null) {
    for (const o of [o1, o2]) { o.frequency.setValueAtTime(mtof(p.from), t); o.frequency.exponentialRampToValueAtTime(f, t + (p.glide ?? 0.06)); }
  }
  const lfo = e.osc('sine', p.vibRate ?? 5.6); const lg = e.gain(0); lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
  lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(p.vib ?? 16, t + Math.min(len, 0.25) + 0.25);
  const cut = p.cut ?? 1600;
  flt.frequency.setValueAtTime(cut * 0.6, t);
  flt.frequency.linearRampToValueAtTime(cut * 2.4, t + 0.03);
  flt.frequency.setTargetAtTime(cut * 1.3, t + 0.03, 0.25);
  const end = e.adsr(amp.gain, t, len, p.a ?? 0.008, 0.25, p.s ?? 0.75, p.r ?? 0.14, v * (p.vol ?? 0.17));
  for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
}

// "Aah" choir pad: detuned saws through parallel vowel formant filters.
function choir(e, out, t, notes, len, v = 1, p = {}) {
  const amp = e.gain(0, out);
  const mix = e.gain(1);
  const oscs = [];
  for (const m of notes) for (const d of [-13, 0, 12]) {
    const o = e.osc('sawtooth', mtof(m), mix); o.detune.value = d + rnd(-3, 3); oscs.push(o);
  }
  for (const [f, q, g] of VOWELS[p.vowel || 'a']) mix.connect(e.filt('bandpass', f, q, e.gain(g * 3.2, amp)));
  const peak = v * (p.vol ?? 0.16) / Math.sqrt(notes.length * 2);
  const end = e.adsr(amp.gain, t, len, p.a ?? 0.6, 0.6, 0.9, p.r ?? 1.0, peak);
  for (const o of oscs) { o.start(t); o.stop(end); }
}

// Distorted synth "guitar" power chord (palm-muted or ringing). Notes feed one shared
// fuzz + cabinet chain per channel (like a real amp), so the envelope drives the distortion.
function guitarAmp(e, out) {
  if (out._amp) return out._amp;
  const cab = e.filt('lowpass', 3600, 0.9, e.gain(0.16, out));
  const pk = e.filt('peaking', 1500, 1.2, cab); pk.gain.value = 4;
  const ws = e.shaper(e.fuzz(), e.filt('highpass', 110, 0.7, pk), '2x');
  return (out._amp = ws);
}
function guitar(e, out, t, notes, len, v = 1, p = {}) {
  const amp = e.gain(0, guitarAmp(e, out));
  const tone = e.filt('lowpass', p.mute ? 1300 : 2600, 0.7, amp);
  const oscs = [];
  for (const m of notes) for (const d of [-6, 6]) { const o = e.osc('sawtooth', mtof(m), tone); o.detune.value = d; oscs.push(o); }
  const drive = (p.drive ?? 2.5) * v;
  let end;
  if (p.mute) { e.perc(amp.gain, t, drive, 0.002, 0.03); end = t + 0.25; }
  else end = e.adsr(amp.gain, t, len, 0.003, 0.4, 0.6, 0.12, drive);
  for (const o of oscs) { o.start(t); o.stop(end); }
}

// Metallic partials hit: anvils, pipes, clanks. f = base frequency (Hz).
function metal(e, out, t, f, v = 1, p = {}) {
  const ratios = p.ratios || [1, 2.76, 5.4, 8.93];
  const dec = p.decay ?? 0.35;
  const amp = e.gain(0, out);
  const oscs = [];
  ratios.forEach((r, i) => {
    if (f * r > 18000) return; // keep partials below Nyquist
    const g = e.gain(1 / (i + 1.3), amp); const o = e.osc('sine', f * r * rnd(0.995, 1.005), g); oscs.push(o);
    if (i === 0 && p.fm) {
      const mo = e.osc('sine', f * 1.414); const mg = e.gain(f * p.fm); mo.connect(mg); mg.connect(o.frequency);
      mg.gain.setTargetAtTime(0, t, 0.03); oscs.push(mo);
    }
  });
  e.perc(amp.gain, t, v * 0.32, 0.001, dec);
  const ng = e.gain(0, out);
  e.noise('white', t, 0.06, e.filt('bandpass', p.click ?? 3500, 1.2, ng));
  e.perc(ng.gain, t, v * 0.5, 0.0005, 0.012);
  for (const o of oscs) { o.start(t); o.stop(t + dec * 6); }
}

// Two axe blades struck together: bright inharmonic ring with beating + scrape.
function axe(e, out, t, v = 1, p = {}) {
  const dec = p.decay ?? 0.22, F = 1050;
  const buf = e.bake('axe' + dec + '_' + variant(), dec * 7, (d, sr) => {
    const parts = [];
    [1, 1.47, 2.09, 2.56, 3.37, 4.61].forEach((r, i) => {
      parts.push([F * r * rnd(0.996, 1.004), 0.9 / (i + 1), Math.random() * 6.28]);
      if (i < 3) parts.push([F * r + 3.5 + i, 0.9 / (i + 1), Math.random() * 6.28]); // beating pairs
    });
    const hi = rbj('bandpass', 6500, 2, sr), lo = rbj('bandpass', 3000, 2, sr);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let x = 0;
      for (const [f, a, ph] of parts) x += a * Math.sin(6.2832 * f * t + ph);
      const n = Math.random() * 2 - 1, k = Math.min(1, t / 0.14);
      const scrape = (hi(n) * (1 - k) + lo(n) * k) * 0.8 * Math.exp(-t / 0.04);
      d[i] = (x * 0.2 * Math.exp(-t / dec) + scrape) * Math.min(1, t / 0.0006);
    }
  });
  e.play(buf, t, out, ((p.f ?? F) / F) * rnd(0.94, 1.06), v);
}

// Noise riser (bandpass sweeping up), used for builds into sections.
function riser(e, out, t, dur, v = 1, p = {}) {
  const g = e.gain(0, out);
  const bp = e.filt('bandpass', 300, p.q ?? 3, g);
  bp.frequency.setValueAtTime(p.from ?? 250, t);
  bp.frequency.exponentialRampToValueAtTime(p.to ?? 7000, t + dur);
  e.noise('white2', t, dur + 0.05, bp);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.5, t + dur * 0.95); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
}
// Reverse-cymbal swell that lands on t + dur.
function swell(e, out, t, dur, v = 1) {
  const g = e.gain(0, out);
  e.noise('white2', t, dur + 0.02, e.filt('highpass', 4200, 0.6, g));
  g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(v * 0.35, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
}

// Cinematic sub boom + noise slam.
function impact(e, out, t, v = 1, p = {}) {
  const len = p.len ?? 2.2;
  const g = e.gain(0, out);
  const o = e.osc('sine', 70, e.shaper(e.drive(2), g));
  o.frequency.setValueAtTime(p.f ?? 78, t); o.frequency.exponentialRampToValueAtTime(26, t + len);
  e.perc(g.gain, t, v * 0.9, 0.004, len / 3);
  o.start(t); o.stop(t + len * 2);
  const ng = e.gain(0, out);
  const lp = e.filt('lowpass', 3000, 0.7, ng);
  lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
  e.noise('brown', t, 2.5, lp);
  e.perc(ng.gain, t, v * 1.1, 0.002, 0.5);
}

// Dark drone: detuned saws an octave apart, slowly breathing filter.
function drone(e, out, t, m, len, v = 1, p = {}) {
  const amp = e.gain(0, out);
  const cut = p.cut ?? 420;
  const flt = e.filt('lowpass', cut, 2.5, amp);
  const lfo = e.osc('sine', p.rate ?? 0.11); const lg = e.gain(cut * 0.5); lfo.connect(lg); lg.connect(flt.frequency);
  const oscs = [lfo];
  for (const [mm, d] of [[m, -7], [m, 6], [m - 12, 0], [m + 7, 3]]) { const o = e.osc('sawtooth', mtof(mm), flt); o.detune.value = d; oscs.push(o); }
  const end = e.adsr(amp.gain, t, len, p.a ?? 2.5, 1, 1, p.r ?? 2.5, v * 0.13);
  for (const o of oscs) { o.start(t); o.stop(end); }
}

// Lub-dub heartbeat thump.
function heartbeat(e, out, t, v = 1) {
  for (const [dt, a] of [[0, 1], [0.19, 0.7]]) {
    const g = e.gain(0, out);
    const o = e.osc('sine', 62, e.filt('lowpass', 180, 0.7, g));
    o.frequency.setValueAtTime(75, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
    e.perc(g.gain, t + dt, v * a * 0.95, 0.006, 0.055);
    o.start(t + dt); o.stop(t + dt + 0.5);
  }
}

// Clock tick: tiny bandpassed click.
function tick(e, out, t, v = 1, hi = false) {
  const g = e.gain(0, out);
  e.noise('white', t, 0.03, e.filt('bandpass', hi ? 4200 : 2900, 6, g));
  e.perc(g.gain, t, v * 2.5, 0.0003, 0.006);
}

// Distant police wail (heavily reverbed via the channel send).
function sirenFar(e, out, t, len, v = 1) {
  const g = e.gain(0, out);
  const o = e.osc('triangle', 950, e.filt('lowpass', 1600, 0.8, g));
  const lfo = e.osc('sine', 0.34); const lg = e.gain(300); lfo.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.08, t + len * 0.4); g.gain.linearRampToValueAtTime(0, t + len);
  o.start(t); lfo.start(t); o.stop(t + len + 0.1); lfo.stop(t + len + 0.1);
}

// ---------------------------------------------------------------------------------------
// Track player: per-track mixer (channel strips with sends + intensity layers),
// arrangement (sections), and a step sequencer driven by the engine's look-ahead clock.
//
// A song definition:
//   { bpm, swing, delay: beats, form: [[section, bars], ...], loop: formIndex | null,
//     mix: { chName: { vol, dest: 'out'|'wide'|'pump'|'pumpWide', pan, hall, gate, delay, layer } },
//     step(k, s) }   // called every 16th; s = { t, d, bar, gbar, st, beat, sec, sb, sl, last, pass }
// Layers: 0 = always, 1 = "full" (intensity ≳ 0.3), 2 = "max" (intensity ≳ 0.7). Strip gains ramp.
// ---------------------------------------------------------------------------------------
const layerLevel = (L, x) => (L <= 0 ? 1 : L === 1 ? smooth(0.12, 0.45, x) : smooth(0.55, 0.88, x));

class Track {
  constructor(e, name, song, t0, fade, startBar = 0) {
    this.e = e; this.name = name; this.song = song;
    this.bpm = song.bpm; this.swing = song.swing || 0;
    this.t0 = t0; this.nextT = t0; this.n = startBar * 16; this.beat = 0;
    this.ended = false; this.stopAt = Infinity; this.mem = {};
    this.out = e.gain(0, e.musicBus); this.wide = e.gain(0, e.chorusIn);
    this.hall = e.gain(0, e.hallIn); this.gate = e.gain(0, e.gateIn); this.dly = e.gain(0, e.delayIn);
    this.faders = [this.out, this.wide, this.hall, this.gate, this.dly];
    for (const f of this.faders) {
      f.gain.setValueAtTime(0, t0);
      if (fade > 0.01) f.gain.linearRampToValueAtTime(1, t0 + fade); else f.gain.setValueAtTime(1, t0);
    }
    this.pumpA = e.gain(1, this.out); this.pumpB = e.gain(1, this.wide);
    const dests = { out: this.out, wide: this.wide, pump: this.pumpA, pumpWide: this.pumpB };
    this.ch = {}; this.strips = [];
    for (const [cn, d] of Object.entries(song.mix)) {
      const inp = e.gain(0);
      const dest = dests[d.dest || 'out'];
      inp.connect(d.pan ? e.pan(d.pan, dest) : dest);
      if (d.hall) inp.connect(e.gain(d.hall, this.hall));
      if (d.gate) inp.connect(e.gain(d.gate, this.gate));
      if (d.delay) inp.connect(e.gain(d.delay, this.dly));
      this.ch[cn] = inp; this.strips.push({ inp, d });
    }
    let b = 0;
    this.form = song.form;
    this.secStart = this.form.map(([, n]) => { const s = b; b += n; return s; });
    this.totalBars = b;
    this.loopBar = song.loop == null ? -1 : this.secStart[song.loop];
    if (song.delay) e.setDelayTime((60 / this.bpm) * song.delay);
    this.layerOff = [Infinity, -1, -1];
    this.setIntensity(e.intensity, true);
  }

  get stepDur() { return 60 / this.bpm / 4 / this.e.musicRate; }

  setIntensity(x, instant = false) {
    const now = this.e.ctx.currentTime;
    for (const { inp, d } of this.strips) {
      const v = (d.vol ?? 1) * layerLevel(d.layer || 0, x);
      if (instant) inp.gain.value = v; else inp.gain.setTargetAtTime(v, now, 0.6);
    }
    for (let L = 1; L < 3; L++) {
      if (layerLevel(L, x) > 0.001) this.layerOff[L] = Infinity;
      else if (instant) this.layerOff[L] = -1;
      else if (this.layerOff[L] === Infinity) this.layerOff[L] = now + 3.5;
    }
  }
  // Is layer L audible (or still fading out)? Lets songs skip CPU for muted layers.
  on(L) { return L <= 0 || this.nextT < this.layerOff[L]; }

  pos(n) {
    const gbar = Math.floor(n / 16), st = n % 16;
    let bar = gbar, pass = 0;
    if (bar >= this.totalBars) {
      if (this.loopBar < 0) return null;
      const span = this.totalBars - this.loopBar;
      pass = 1 + Math.floor((bar - this.totalBars) / span);
      bar = this.loopBar + ((bar - this.totalBars) % span);
    }
    let i = this.form.length - 1;
    while (this.secStart[i] > bar) i--;
    const sb = bar - this.secStart[i], sl = this.form[i][1];
    return { bar, gbar, st, beat: st >> 2, sec: this.form[i][0], sb, sl, last: sb === sl - 1, pass };
  }

  advance(until) {
    const e = this.e;
    while (!this.ended && this.nextT < until && this.nextT < this.stopAt) {
      const s = this.pos(this.n);
      if (!s) { this.ended = true; this.endT = this.nextT; break; }
      s.t = this.nextT; s.d = this.stepDur;
      TUNE = e.musicPitch;
      try { this.song.step(this, s); } catch (err) { if (!this.err) console.error('audio: track ' + this.name, err); this.err = err; }
      TUNE = 1;
      if (s.st % 4 === 0 && e.track === this) e.beatQueue.push([this.nextT, this.beat++, s.gbar]);
      this.nextT += this.stepDur * (1 + this.swing * (this.n % 2 === 0 ? 1 : -1));
      this.n++;
    }
  }

  // Sidechain-style duck of the 'pump' / 'pumpWide' groups from the kick.
  pump(t, depth = 0.5) {
    for (const g of [this.pumpA.gain, this.pumpB.gain]) {
      g.setTargetAtTime(1 - depth, t, 0.004);
      g.setTargetAtTime(1, t + 0.05, 0.085);
    }
  }
  // Play instrument fn on channel ch.
  p(fn, ch, t, ...args) { const out = this.ch[ch]; if (out) fn(this.e, out, t, ...args); }

  // 16-step drum maps: { kick, snare, clap, hat, ohat, rim } -> PAT arrays (velocity per step)
  drums(s, map, o = {}) {
    const t = s.t, st = s.st;
    for (const k in map) {
      const v = map[k] && map[k][st];
      if (!v) continue;
      const hv = v * rnd(0.86, 1);
      if (k === 'kick') { this.p(kick, 'kick', t, hv, o.kick); this.pump(t, o.pump ?? 0.5); }
      else if (k === 'snare') this.p(snare, 'snare', t, hv, o.snare);
      else if (k === 'clap') this.p(clap, o.clapCh || 'snare', t + 0.003, hv * 0.9);
      else if (k === 'hat') this.p(hat, 'hat', t + rnd(0, 0.004), hv, false);
      else if (k === 'ohat') this.p(hat, 'hat', t, hv, true);
      else if (k === 'rim') this.p(tick, o.rimCh || 'perc', t, hv * 0.6, true);
    }
  }
  // Tom fill over the last `steps` 16ths of a bar (descending).
  fill(s, steps = 8, base = 50, v = 0.8) {
    if (s.st < 16 - steps) return;
    const i = s.st - (16 - steps);
    if (i % 2 === 0 || steps <= 4) this.p(tom, 'tom', s.t, base + 12 - Math.floor((i / steps) * 4) * 3, v * rnd(0.85, 1));
  }

  fadeOut(t, dur) {
    for (const f of this.faders) {
      const g = f.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
      g.linearRampToValueAtTime(0, t + Math.max(0.02, dur));
    }
    this.stopAt = t + dur + 0.05;
    this.disposeAt = t + dur + 4;
  }
  dispose() { for (const f of this.faders) f.disconnect(); }
}

// ---------------------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------------------
const MIX = {
  kick: { vol: 0.8 },
  snare: { vol: 1.1, gate: 0.85, hall: 0.12 },
  hat: { vol: 0.9, pan: 0.22 },
  tom: { vol: 0.55, gate: 0.5, hall: 0.18 },
  crash: { vol: 0.9, hall: 0.25, pan: -0.15 },
  bass: { vol: 0.6, dest: 'pump' },
  pad: { vol: 1.2, dest: 'pumpWide', hall: 0.35 },
  stab: { vol: 1.7, dest: 'wide', hall: 0.25, delay: 0.1 },
  brass: { vol: 1.4, dest: 'wide', hall: 0.4 },
  lead: { vol: 1.1, hall: 0.25, delay: 0.28 },
  bell: { vol: 1.6, dest: 'wide', hall: 0.4, delay: 0.25 },
  arp: { vol: 1.8, pan: -0.3, delay: 0.18, hall: 0.12 },
  gtr: { vol: 2.6, dest: 'pump', hall: 0.1 },
  choir: { vol: 1.2, dest: 'wide', hall: 0.5 },
  metal: { vol: 1.5, pan: 0.3, hall: 0.3 },
  axe: { vol: 1.0, hall: 0.45 },
  perc: { vol: 2.5, pan: -0.35, hall: 0.2 },
  drone: { vol: 0.8, dest: 'wide', hall: 0.4 },
  fx: { vol: 0.8, hall: 0.55 },
  boom: { vol: 1, hall: 0.45, gate: 0.3 },
  hb: { vol: 0.9 },
};
// mix({ lead: { layer: 2 }, bass2: {...} }) – channel names with a numeric suffix inherit
// the base preset ('lead2' -> MIX.lead).
function mix(over) {
  const m = {};
  for (const k in over) m[k] = { ...(MIX[k.replace(/\d+$/, '')] || {}), ...over[k] };
  return m;
}
// Bass rhythm patterns: [step, octave offset, length in 16ths]
const BP = {
  drive8: [[0, 0, 2], [2, 0, 2], [4, 0, 2], [6, 12, 2], [8, 0, 2], [10, 0, 2], [12, 0, 2], [14, 12, 2]],
  gallop: [[0, 0, 1], [2, 0, 1], [3, 0, 1], [4, 12, 1], [6, 0, 1], [7, 0, 1], [8, 0, 1], [10, 0, 1], [11, 0, 1], [12, 12, 1], [14, 0, 1], [15, 0, 1]],
  pulse16: Array.from({ length: 16 }, (_, i) => [i, i % 8 === 6 ? 12 : 0, 1]),
  sparse: [[0, 0, 6], [6, 0, 2], [10, 0, 2], [12, 12, 2], [14, 0, 2]],
  noir: [[0, 0, 3], [3, 0, 1], [6, 0, 2], [8, 0, 3], [11, 12, 1], [12, 0, 2], [14, 0, 1], [15, 12, 1]],
  hold: [[0, 0, 15]],
};
function bassLine(k, s, ch, root, pat, p = {}, v = 0.85) {
  for (const [st, o, l] of pat) if (st === s.st) k.p(bass, ch, s.t, root + o, l * s.d * 0.92, v * (st % 4 === 0 ? 1 : 0.8) * rnd(0.9, 1), p);
}
function melAt(m) { if (!m.byStep) { m.byStep = {}; for (const n of m) m.byStep[n.s] = n; } return m.byStep; }
// Plays melody m (looping within the section) on channel ch. o: { fn, tr, legato, v, p, glide, from }
function playMel(k, s, ch, m, o = {}) {
  const pos = (s.sb - (o.from || 0)) * 16 + s.st;
  if (pos < 0) return;
  const n = melAt(m)[pos % m.len];
  if (!n) return;
  const tr = o.tr || 0, fn = o.fn || lead;
  let p = o.p || {};
  const prev = k.mem[ch];
  if (o.glide && prev != null && prev !== n.m + tr && Math.abs(prev - n.m - tr) <= 5) p = { ...p, from: prev, glide: 0.045 };
  k.mem[ch] = n.m + tr;
  k.p(fn, ch, s.t, n.m + tr, n.l * s.d * (o.legato ?? 0.9), (o.v ?? 0.9) * (n.acc ? 1.1 : 1) * rnd(0.9, 1), p);
}
const up = (notes, n = 12) => notes.map((x) => x + n);

// ---------------------------------------------------------------------------------------
// MAIN THEME (shared by 'intro' and 'title') – D minor, heroic-dark.
//   A: Dm Bb C A (hook)   B: Gm Bb F A (lift)   C: Bb C Dm Dm Bb C Gm A (bridge, bells)
// ---------------------------------------------------------------------------------------
const TH = {
  A: ['Dm', 'Bb', 'C', 'A'],
  B: ['Gm', 'Bb', 'F', 'A'],
  C: ['Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'Gm', 'A'],
  hookA: mel(`d5/3 d5/1 a4/2 d5/2 f5/4 e5/2 d5/2 | f5/6 g5/2 f5/2 d5/2 bb4/4 | c5/3 c5/1 e5/2 g5/2 a5/4 g5/2 e5/2 | e5/6 c#5/2 a4/8 |
              d5/3 d5/1 a4/2 d5/2 f5/4 a5/2 g5/2 | f5/4 d5/2 f5/2 bb5/8 | a5/3 g5/1 e5/2 c5/2 g5/4 f5/2 e5/2 | e5/6 f5/2 e5/4 c#5/4`),
  hookB: mel(`bb5/8 a5/4 g5/4 | f5/8 d5/4 f5/4 | a5/6 g5/2 f5/4 c5/4 | e5/8 c#5/4 e5/4 |
              g5/4 bb5/4 d6/8 | c6/4 bb5/4 f5/8 | a5/6 c6/2 a5/4 f5/4 | e5/4 a5/4 c#6/8`),
  bridge: mel(`d6/8 f6/8 | e6/8 g6/8 | a6/12 f6/4 | d6/16 | d6/8 f6/8 | g6/8 c6/8 | bb5/12 a5/4 | a5/8 c#6/8`),
  counter: mel(`a4/4 d5/4 f5/4 a5/4 | bb4/4 d5/4 f5/4 bb5/4 | c5/4 e5/4 g5/4 c6/4 | c#5/4 e5/4 a5/8`),
};
const DR = {
  kick: PAT('X.....x.X.......'), kickB: PAT('X.....x.X..x..x.'), kickHalf: PAT('X...............'),
  four: PAT('X...X...X...X...'), snare: PAT('....X.......X...'), snHalf: PAT('........X.......'),
  hat8: PAT('x.o.x.o.x.o.x...'), hat16: PAT('xoxoxoxoxoxoxoxo'), ohat: PAT('..............x.'),
  ohOff: PAT('..x...x...x...x.'), clap: PAT('....x.......x...'),
};

function themeStep(k, s, sec = s.sec) {
  const t = s.t, st = s.st, d = s.d;
  const prog = sec === 'B' ? TH.B : sec === 'C' ? TH.C : TH.A;
  const C = prog[s.sb % prog.length];
  const root = chord(C).root, vo = voicing(C, 57);
  const big = sec !== 'in' && sec !== 'brk';
  if (st === 0) k.p(pad, 'pad', t, vo, d * 16, sec === 'in' ? 0.7 : 0.85);
  if (big) {
    k.drums(s, {
      kick: s.last && sec !== 'C' ? DR.kickB : DR.kick, snare: DR.snare,
      hat: sec === 'A' ? DR.hat8 : DR.hat16, ohat: DR.ohat,
    }, { pump: 0.55 });
    if (s.last) k.fill(s, 4, 45, 0.85);
    if (s.sb === 0 && st === 0) k.p(crash, 'crash', t, 0.9);
    if (sec === 'C' && st === 8 && s.sb % 2 === 1) k.p(tom, 'tom', t, 43, 0.7);
  } else {
    if (st === 0) k.p(kick, 'kick', t, 0.7, { decay: 0.6 });
    if (s.last && st >= 8) { k.p(snare, 'snare', t, 0.25 + (st - 8) * 0.08); }
    if (s.last && st === 0) k.p(riser, 'fx', t, d * 16, 0.6);
  }
  bassLine(k, s, 'bass', root, sec === 'brk' || sec === 'in' ? BP.sparse : sec === 'B' ? BP.gallop : BP.drive8,
    { cut: sec === 'brk' ? 160 + s.sb * 90 : 230, env: 1700 });
  if (st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.7, sec === 'brk' ? 1 : 0.7);
  if (sec === 'A' || sec === 'A2' || sec === 'A3') playMel(k, s, 'lead', TH.hookA, { tr: sec === 'A3' ? 12 : 0, glide: true, v: sec === 'A3' ? 0.8 : 0.9 });
  if (sec === 'A3') playMel(k, s, 'lead2', TH.hookA, { p: { wave: 'square', cut: 1100 }, v: 0.6 });
  if (sec === 'B') { playMel(k, s, 'lead', TH.hookB, { glide: true }); if (st === 0) k.p(brass, 'brass', t, vo, d * 14, 0.6); }
  if (sec === 'C') playMel(k, s, 'bell', TH.bridge, { fn: bell, legato: 1, v: 0.8, p: { ratio: 3.5, decay: 1.1 } });
  if (sec === 'brk') playMel(k, s, 'bell', TH.counter, { fn: bell, v: 0.65, p: { ratio: 1, index: 1.6, decay: 0.5 } });
  if ((sec === 'A2' || sec === 'A3') && (st === 0 || st === 6 || st === 10)) k.p(stab, 'stab', t, vo, d * 1.6, st === 0 ? 0.95 : 0.75);
}

// ---------------------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------------------
const SONGS = {};

// INTRO (120 BPM, 2 s per bar) – scripted cinematic opening.
//   dark  bars 0-11  (0-24 s): drone, heartbeat, clock ticks, distant sirens, low brass swells,
//                              SID pulse from bar 6, bass pulse from bar 8, riser + toms into…
//   slam  bars 12-13 (24 s):   the "COBRA" title hit: sub boom + gated snare + crash + brass stab
//   A/B/A2/B2 (28-60 s+):       main theme statement, then loops A..B2 for the title screen.
SONGS.intro = {
  bpm: 120, delay: 0.75,
  form: [['dark', 12], ['slam', 2], ['A', 8], ['B', 8], ['A2', 8], ['B2', 8]], loop: 2,
  mix: mix({
    kick: {}, snare: {}, hat: {}, tom: {}, crash: {}, bass: {}, pad: {}, stab: {}, brass: {}, lead: {}, lead2: { vol: 0.6, pan: 0.3 },
    bell: {}, arp: {}, fx: {}, drone: {}, hb: {}, perc: { vol: 1.5 }, boom: {}, siren: { vol: 0.8, hall: 0.9, pan: -0.4 },
  }),
  step(k, s) {
    if (s.sec === 'dark') return introDark(k, s);
    if (s.sec === 'slam') return introSlam(k, s);
    themeStep(k, s, s.sec === 'B2' ? 'B' : s.sec);
  },
};
function introDark(k, s) {
  const b = s.sb, st = s.st, t = s.t, d = s.d;
  if (b === 0 && st === 0) k.p(drone, 'drone', t, 50, 24.6, 0.9, { a: 5, cut: 260, r: 1.5 });
  if (b === 6 && st === 0) k.p(drone, 'drone', t, 46, 12.4, 0.45, { a: 6, cut: 340, rate: 0.17, r: 1.2 });
  const hbEvery = b >= 8 ? 4 : 8;
  if (st % hbEvery === 0 && b < 12) k.p(heartbeat, 'hb', t, 0.45 + b * 0.04);
  if (b >= 2 && st % (b >= 9 ? 1 : 2) === 0) k.p(tick, 'perc', t + rnd(0, 0.003), (st % 4 === 0 ? 0.6 : 0.3) * (0.5 + b / 24), st % 8 === 0);
  if ((b === 1 || b === 7) && st === 0) { k.p(sirenFar, 'siren', t, b === 1 ? 7 : 6, 0.9); }
  const swells = { 4: 'Dm', 6: 'Bb', 8: 'Gm', 10: 'A' };
  if (swells[b] && st === 0) k.p(brass, 'brass', t, voicing(swells[b], 45), d * 26, 0.8, { a: 1.3, fa: 2.2, fd: 0.8, r: 1.2, cut: 300, env: 1500 });
  if ([3, 5, 9].includes(b) && st === 0) k.p(bell, 'bell', t, b === 9 ? 81 : 74, 4, 0.5, { ratio: 1.41, index: 3, decay: 2.2 });
  if (b >= 6 && st % 4 === 0) k.p(pulseArp, 'arp', t, [50, 53, 57, 62], d * 3.7, 0.25 + (b - 6) * 0.08, { cut: 1200 + (b - 6) * 400 });
  if (b >= 8 && st % 2 === 0) k.p(bass, 'bass', t, 38, d * 1.6, 0.7 + (st % 4 === 0 ? 0.2 : 0), { cut: 110 + (b - 8) * 70 + st * 4, env: 600 + (b - 8) * 300, q: 8 });
  if (b === 10 && st === 0) k.p(riser, 'fx', t, d * 32, 0.85, { to: 9000 });
  if (b === 11 && st === 0) k.p(swell, 'fx', t, d * 16, 1);
  if (b === 11 && st >= 8) k.p(tom, 'tom', t, 52 - Math.floor((st - 8) / 2) * 3, 0.5 + (st - 8) * 0.06);
}
function introSlam(k, s) {
  const t = s.t, st = s.st, d = s.d;
  if (s.sb === 0 && st === 0) {
    k.p(impact, 'boom', t, 1.0, { len: 3 });
    k.p(kick, 'kick', t, 1, { decay: 0.8 });
    k.p(snare, 'snare', t, 1, { decay: 0.35 });
    k.p(crash, 'crash', t, 1, 4);
    k.p(stab, 'brass', t, [38, 50, 53, 57, 62, 65, 69], d * 10, 1, { r: 1.6, s: 0.5, d: 0.6, fs: 0.25 });
    k.p(pad, 'pad', t, voicing('Dm', 50), d * 28, 0.7, { a: 0.4 });
    k.p(drone, 'drone', t, 38, 7, 0.7, { a: 0.05, cut: 500, r: 2 });
    k.pump(t, 0.8);
  }
  if (s.sb === 1) {
    if (st >= 8 && st % 2 === 0) k.p(snare, 'snare', t, 0.35 + (st - 8) * 0.07);
    if (st === 0 || st === 8) k.p(kick, 'kick', t, 0.8);
    if (st === 8) k.p(swell, 'fx', t, d * 8, 0.8);
  }
}

// TITLE (112 BPM) – the main theme as a full arrangement, ~103 s before looping to A.
//   in(4) A(8) A2(8, + stabs) B(8, lift + brass) brk(4, SID arp + bells) C(8, bell bridge) A3(8, octave-up hook)
SONGS.title = {
  bpm: 112, delay: 0.75,
  form: [['in', 4], ['A', 8], ['A2', 8], ['B', 8], ['brk', 4], ['C', 8], ['A3', 8]], loop: 1,
  mix: mix({ kick: {}, snare: {}, hat: {}, tom: {}, crash: {}, bass: {}, pad: {}, stab: {}, brass: {}, lead: {}, lead2: { vol: 0.6, pan: 0.3 }, bell: {}, arp: {}, fx: {} }),
  step(k, s) { themeStep(k, s); },
};

// CITY (118 BPM, C minor, light swing) – rain-noir stealth/action groove. ~98 s, loops to A.
//   in(4) A(8) B(8) A2(8) brk(4) C(8) B2(8)
//   layer 0 (base): bass + hats + pad + bell drips   layer 1 (full): drums + stabs + crash
//   layer 2 (max):  lead with delay throws + SID arp + rim/shaker + tom fills
const CITY = {
  A: ['Cm', 'Cm', 'Ab', 'G'],
  B: ['Fm', 'Ab', 'Eb', 'G'],
  C: ['Ab', 'Bb', 'Cm', 'Cm'],
  leadA: mel(`g5/6 eb5/2 f5/4 g5/4 | c6/8 bb5/4 g5/4 | ab5/6 g5/2 f5/4 eb5/4 | d5/12 r/4 |
              g5/6 eb5/2 f5/4 g5/4 | eb6/6 d6/2 c6/4 bb5/4 | ab5/4 c6/4 f5/4 ab5/4 | g5/16`),
  leadB: mel(`f5/4 ab5/4 c6/6 bb5/2 | ab5/8 eb5/8 | g5/6 f5/2 eb5/4 bb4/4 | b4/8 d5/4 g5/4`),
  bellC: mel(`c6/6 eb6/2 g6/8 | d6/6 f6/2 bb5/8 | g5/4 c6/4 eb6/8 | d6/16`),
  hat: PAT('x-o-x-o-x-o-x-ox'), kick: PAT('X.....x...x.....'), kick2: PAT('X.....x...x...x.'),
  stab: PAT('...x......x.....'), rim: PAT('..x..x....x..x.x'),
};
SONGS.city = {
  bpm: 118, swing: 0.05, delay: 0.75,
  form: [['in', 4], ['A', 8], ['B', 8], ['A2', 8], ['brk', 4], ['C', 8], ['B2', 8]], loop: 1,
  mix: mix({
    kick: { layer: 1 }, snare: { layer: 1, vol: 1.0 }, hat: { layer: 0, vol: 0.8 }, tom: { layer: 2 }, crash: { layer: 1, vol: 0.7 },
    bass: { layer: 0 }, pad: { layer: 0, vol: 1.1 }, stab: { layer: 1, vol: 1.5 }, lead: { layer: 2, delay: 0.38 },
    bell: { layer: 0, vol: 1.4 }, arp: { layer: 2, vol: 1.1 }, perc: { layer: 2, vol: 2.5 }, fx: { layer: 0 },
  }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d, sec = s.sec;
    const prog = sec === 'B' || sec === 'B2' ? CITY.B : sec === 'C' ? CITY.C : CITY.A;
    const C = prog[s.sb % 4], root = chord(C).root, vo = voicing(C, 55);
    const quiet = sec === 'in' || sec === 'brk';
    if (st === 0) k.p(pad, 'pad', t, vo, d * 16, 0.8, { cut: quiet ? 300 : 420 });
    k.drums(s, { hat: sec === 'in' ? DR.hat8 : CITY.hat });
    bassLine(k, s, 'bass', root, sec === 'brk' ? BP.hold : BP.noir, { cut: 170 + (sec === 'C' ? s.sb * 25 : 0), env: 1300, q: 7 });
    if ((sec === 'in' || sec === 'A') && st === 0 && s.sb % 2 === 0) k.p(bell, 'bell', t + d * 2, vo[2] + 24, 2, 0.6, { ratio: 3.5, decay: 1.4 });
    if (sec === 'C') playMel(k, s, 'bell', CITY.bellC, { fn: bell, legato: 1, v: 0.9, p: { decay: 1.2 } });
    if (sec === 'brk' && s.last && st === 0) k.p(riser, 'fx', t, d * 16, 0.6);
    if (k.on(1) && !quiet) {
      k.drums(s, { kick: s.last ? CITY.kick2 : CITY.kick, snare: DR.snare, clap: sec === 'B2' ? DR.clap : null }, { pump: 0.5 });
      if (CITY.stab[st]) k.p(stab, 'stab', t, vo, d * 1.2, 0.8, { cut: 600 });
      if (s.sb === 0 && st === 0) k.p(crash, 'crash', t, 0.8);
    }
    if (sec === 'brk' && k.on(1) && st === 0) k.p(kick, 'kick', t, 0.6);
    if (k.on(2)) {
      if (sec === 'A' || sec === 'A2') playMel(k, s, 'lead', CITY.leadA, { glide: true, tr: sec === 'A2' ? 12 : 0, v: sec === 'A2' ? 0.75 : 0.9, p: { cut: 1300 } });
      if (sec === 'B' || sec === 'B2') playMel(k, s, 'lead', CITY.leadB, { glide: true, p: { cut: 1400 } });
      if (!quiet && st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.6, 0.8, { cut: 3000 });
      if (!quiet) k.drums(s, { rim: CITY.rim }, { rimCh: 'perc' });
      if (s.last && !quiet) k.fill(s, 6, 45, 0.7);
    }
  },
};

// RURAL (126 BPM, E minor) – golden-hour highway chase, synth-rock. ~91 s, loops to A.
//   in(4) A(8) B(8) A2(8) brk(4, half-time) C(8, build) A3(8)
//   layer 0: palm-muted fuzz guitar + bass + hats   layer 1: drums + open chords + brass
//   layer 2: lead + toms + crash accents + SID arp
const RUR = {
  A: ['E5', 'C5', 'D5', 'B5'], B: ['A5', 'C5', 'G5', 'D5'], C: ['C5', 'D5', 'E5', 'E5'],
  padA: ['Em', 'C', 'D', 'B'], padB: ['Am', 'C', 'G', 'D'], padC: ['C', 'D', 'Em', 'Em'],
  leadA: mel(`e5/4 g5/4 b5/6 a5/2 | g5/8 e5/8 | f#5/4 g5/4 a5/6 g5/2 | f#5/12 d#5/4 |
              e5/4 g5/4 b5/6 d6/2 | e6/8 b5/8 | c6/4 b5/4 a5/4 g5/4 | f#5/16`),
  leadB: mel(`a5/6 c6/2 b5/4 a5/4 | g5/8 e5/8 | d5/4 g5/4 b5/6 d6/2 | a5/16`),
  kick: PAT('X.......X.X.....'), kick2: PAT('X.....X.X.X...X.'), hat: PAT('x.x.x.x.x.x.x.x.'),
};
const power = (sym) => { const r = chord(sym).root + 12; return [r, r + 7, r + 12]; };
SONGS.rural = {
  bpm: 126, delay: 0.5,
  form: [['in', 4], ['A', 8], ['B', 8], ['A2', 8], ['brk', 4], ['C', 8], ['A3', 8]], loop: 1,
  mix: mix({
    kick: { layer: 1 }, snare: { layer: 1 }, hat: { layer: 0, vol: 0.85 }, tom: { layer: 2 }, crash: { layer: 2, vol: 0.8 },
    bass: { layer: 0 }, gtr: { layer: 0, pan: -0.25 }, gtr2: { layer: 1, pan: 0.3, vol: 1.6, hall: 0.2 },
    pad: { layer: 0, vol: 0.8 }, brass: { layer: 1, vol: 1.2 }, lead: { layer: 2 }, arp: { layer: 2, vol: 1.0 }, fx: {},
  }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d, sec = s.sec;
    const pr = sec === 'B' ? [RUR.B, RUR.padB] : sec === 'C' ? [RUR.C, RUR.padC] : [RUR.A, RUR.padA];
    const C = pr[0][s.sb % 4], P = pr[1][s.sb % 4], root = chord(C).root, pw = power(C), vo = voicing(P, 55);
    const half = sec === 'brk';
    if (st === 0) k.p(pad, 'pad', t, vo, d * 16, 0.7);
    if (!half && st % 2 === 0 && sec !== 'in') k.p(guitar, 'gtr', t, pw.slice(0, 2), d, st % 4 === 0 ? 0.95 : 0.75, { mute: true });
    if (sec === 'in' && st % 4 === 0) k.p(guitar, 'gtr', t, pw.slice(0, 2), d, 0.6 + s.sb * 0.1, { mute: true });
    if (half && st === 0) k.p(guitar, 'gtr', t, pw, d * 15, 0.8);
    bassLine(k, s, 'bass', root, half ? BP.sparse : sec === 'C' ? BP.gallop : BP.drive8, { cut: 260, env: 2000, q: 4 });
    k.drums(s, { hat: sec === 'in' ? null : RUR.hat });
    if (k.on(1) && sec !== 'in') {
      if (half) k.drums(s, { kick: DR.kickHalf, snare: DR.snHalf });
      else k.drums(s, { kick: s.last ? RUR.kick2 : RUR.kick, snare: DR.snare, ohat: DR.ohat }, { pump: 0.35 });
      if (!half && (st === 0 || (st === 10 && s.sb % 2 === 1))) k.p(guitar, 'gtr2', t, pw, d * (st === 0 ? 6 : 5), 0.85);
      if (sec === 'B' && st === 0) k.p(brass, 'brass', t, vo, d * 14, 0.7);
      if (sec === 'A3' && (st === 0 || st === 6 || st === 12)) k.p(stab, 'brass', t, vo, d * 1.5, 0.8);
    }
    if (sec === 'in' && s.last && st === 0) k.p(riser, 'fx', t, d * 16, 0.5);
    if (half && s.last && st === 0) k.p(swell, 'fx', t, d * 16, 0.9);
    if (k.on(2)) {
      if (sec === 'A' || sec === 'A2' || sec === 'A3') playMel(k, s, 'lead', RUR.leadA, { glide: true, tr: sec === 'A3' ? 12 : 0, v: sec === 'A3' ? 0.75 : 0.9, p: { cut: 1900, vib: 22 } });
      if (sec === 'B') playMel(k, s, 'lead', RUR.leadB, { glide: true, p: { cut: 1900 } });
      if (sec === 'C' && st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.7, 0.5 + s.sb * 0.06, { cut: 2000 + s.sb * 400 });
      if (s.sb === 0 && st === 0 && sec !== 'in') k.p(crash, 'crash', t, 0.9);
      if (s.last && sec !== 'in' && !half) k.fill(s, 8, 43, 0.8);
      if (sec === 'C' && s.sb >= 6 && st % 2 === 0) k.p(tom, 'tom', t, 40 + (st >> 2) * 3, 0.5);
    }
  },
};

// FACTORY (128 BPM, F phrygian/minor) – industrial foundry, metallic percussion. ~75 s, loops to A.
//   in(4) A(8) B(8) brk(4) C(8) A2(8)
//   layer 0: 16th ostinato bass + drone + clanks + hats   layer 1: 4/4 kick, gated snare, anvils
//   layer 2: dark lead + choir + tom fills + extra anvils
const FAC = {
  A: ['Fm', 'Fm', 'Gb', 'Fm'], B: ['Db', 'Eb', 'Fm', 'Fm'], C: ['Bbm', 'Gb', 'Eb', 'C'],
  ost: [0, 0, 12, 0, 1, 0, 0, 12, 0, 0, 12, 0, 3, 1, 0, -2],
  anvil: PAT('X..x..x...x..x..'), anvil2: PAT('X..x..x...x..xXx'), clank: PAT('..o.....o..o...o'),
  hat: PAT('o-x-o-x-o-x-o-xo'),
  lead: mel(`f5/8 gb5/4 f5/4 | eb5/8 c5/8 | db5/6 c5/2 bb4/4 c5/4 | c5/16 |
             f5/4 ab5/4 c6/8 | db6/6 c6/2 bb5/8 | ab5/4 gb5/4 f5/4 eb5/4 | f5/16`),
};
SONGS.factory = {
  bpm: 128, delay: 0.75,
  form: [['in', 4], ['A', 8], ['B', 8], ['brk', 4], ['C', 8], ['A2', 8]], loop: 1,
  mix: mix({
    kick: { layer: 1, vol: 0.62 }, snare: { layer: 1, vol: 1.0 }, hat: { layer: 0, vol: 0.75, pan: -0.2 }, tom: { layer: 2 },
    bass: { layer: 0, vol: 0.6 }, drone: { layer: 0, vol: 0.7 }, metal: { layer: 0, vol: 1.2 }, metal2: { layer: 1, vol: 0.9, pan: -0.25 },
    lead: { layer: 2, vol: 1.0, delay: 0.3 }, choir: { layer: 2, vol: 1.0 }, pad: { layer: 0, vol: 0.8 }, crash: { layer: 1, vol: 0.7 }, fx: { vol: 0.6 },
  }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d, sec = s.sec;
    const prog = sec === 'B' ? FAC.B : sec === 'C' ? FAC.C : FAC.A;
    const C = prog[s.sb % 4], root = chord(C).root, vo = voicing(C, 53);
    const quiet = sec === 'in' || sec === 'brk';
    if (st === 0 && s.sb % 4 === 0) k.p(drone, 'drone', t, root + 12, d * 64, 0.8, { a: 1.5, cut: 380, rate: 0.23 });
    if (st === 0) k.p(pad, 'pad', t, vo, d * 16, 0.6, { cut: 300, env: 700 });
    if (!(sec === 'brk' && st % 2)) k.p(bass, 'bass', t, root + FAC.ost[st] - (root > 41 ? 12 : 0), d * 0.8, (st % 4 === 0 ? 0.95 : 0.7) * rnd(0.9, 1), { cut: 140 + (quiet ? 0 : 60) + (st % 8 === 0 ? 120 : 0), env: 900, q: 9, sub: 0.6 });
    k.drums(s, { hat: sec === 'in' ? DR.hat8 : FAC.hat });
    if (FAC.clank[st]) k.p(metal, 'metal', t, rnd(220, 330), 0.7 * rnd(0.7, 1), { ratios: [1, 1.63, 2.83, 4.1], decay: 0.1, click: 1800 });
    if (FAC.anvil[st] && quiet) k.p(metal, 'metal', t, 760, 0.35, { decay: 0.3 });
    if (k.on(1) && !quiet) {
      k.drums(s, { kick: DR.four, snare: DR.snare }, { kick: { tune: 0.9, decay: 0.5 }, pump: 0.55 });
      const ap = s.last ? FAC.anvil2 : FAC.anvil;
      if (ap[st]) k.p(metal, 'metal2', t, st === 0 ? 540 : 780, ap[st], { decay: 0.28, fm: 4 });
      if (st === 4 || st === 12) k.p(metal, 'metal2', t + 0.004, 1480, 0.35, { decay: 0.06 });
      if (s.sb === 0 && st === 0) k.p(crash, 'crash', t, 0.8);
    }
    if (sec === 'brk' && s.last && st === 0) k.p(riser, 'fx', t, d * 16, 0.6, { q: 6 });
    if (k.on(2) && !quiet) {
      if (sec === 'A' || sec === 'A2' || sec === 'C') playMel(k, s, 'lead', FAC.lead, { glide: true, tr: sec === 'C' ? -12 : 0, p: { cut: 1100, vib: 12 } });
      if (sec === 'B' && st === 0) k.p(choir, 'choir', t, voicing(C, 57), d * 16, 0.9, { vowel: 'o' });
      if (s.last) k.fill(s, 8, 41, 0.8);
    }
  },
};

// BOSS – the Night Slasher (140 BPM, B minor/phrygian). ~65 s, loops to A.
//   in(2) A(8) B(8) brk(4) C(8) A2(8)
//   layer 0: ritual axe clangs + choir + tribal toms + 16th bass (always menacing)
//   layer 1: kick/snare + brass stabs + crash   layer 2: lead + double-time clangs + SID arp
const BOSS = {
  A: ['Bm', 'Bm', 'C', 'F#'], B: ['Em', 'C', 'F#sus4', 'F#'], C: ['G', 'A', 'Bm', 'Bm'],
  axe: PAT('X..x..X...x.X...'), axe2: PAT('..x.....x.x...xx'),
  toms: PAT('X..x..x.X..x.x..'),
  ost: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 1, 0, 12],
  kick: PAT('X.x...x.X.x...x.'), stab: PAT('X.....x.....x...'),
  lead: mel(`b5/4 c6/4 b5/2 a5/2 f#5/4 | g5/6 f#5/2 e5/4 d5/4 | e5/4 g5/4 c6/8 | c#6/8 a#5/8 |
             b5/4 d6/4 f#6/8 | e6/6 d6/2 c6/8 | b5/4 a5/4 g5/4 e5/4 | f#5/16`),
};
SONGS.boss = {
  bpm: 140, delay: 0.5,
  form: [['in', 2], ['A', 8], ['B', 8], ['brk', 4], ['C', 8], ['A2', 8]], loop: 1,
  mix: mix({
    kick: { layer: 1, vol: 0.62 }, snare: { layer: 1 }, hat: { layer: 1, vol: 0.8 }, tom: { layer: 0, vol: 0.38 }, crash: { layer: 1, vol: 0.8 },
    bass: { layer: 0, vol: 0.6 }, choir: { layer: 0, vol: 1.2 }, axe: { layer: 0, vol: 0.9, pan: 0.25 }, axe2: { layer: 2, vol: 0.8, pan: -0.35 },
    stab: { layer: 1, vol: 1.5 }, lead: { layer: 2 }, arp: { layer: 2, vol: 1.0 }, fx: {}, boom: { layer: 1, vol: 0.6 },
  }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d, sec = s.sec;
    const prog = sec === 'B' ? BOSS.B : sec === 'C' ? BOSS.C : BOSS.A;
    const C = prog[s.sb % 4], root = chord(C).root, vo = voicing(C, 57);
    const quiet = sec === 'in' || sec === 'brk';
    if (st === 0 && s.sb % 2 === 0) k.p(choir, 'choir', t, voicing(C, 52), d * 32, 0.9, { vowel: sec === 'B' ? 'o' : 'a', a: 0.4 });
    if (BOSS.axe[st]) k.p(axe, 'axe', t, BOSS.axe[st] * rnd(0.85, 1), { f: st === 0 ? 900 : 1080 });
    if (!quiet || sec === 'brk') bassLine(k, s, 'bass', root - 12, BP.pulse16.map(([i, , l]) => [i, BOSS.ost[i], l]), { cut: 200, env: 1500, q: 7 }, 0.85);
    if (BOSS.toms[st] && sec !== 'in') k.p(tom, 'tom', t, st % 8 === 0 ? 38 : 45, BOSS.toms[st] * 0.8);
    if (k.on(1) && !quiet) {
      k.drums(s, { kick: BOSS.kick, snare: DR.snare, hat: DR.hat16 }, { pump: 0.45 });
      if (BOSS.stab[st]) k.p(stab, 'stab', t, vo, d * 1.4, 0.85, { cut: 700 });
      if (s.sb === 0 && st === 0) { k.p(crash, 'crash', t, 0.9); k.p(impact, 'boom', t, 0.6, { len: 1.4 }); }
    }
    if (sec === 'brk' && s.last && st === 0) k.p(riser, 'fx', t, d * 16, 0.7);
    if (sec === 'in' && s.last && st >= 8 && st % 2 === 0) k.p(snare, 'snare', t, 0.3 + (st - 8) * 0.08);
    if (k.on(2) && !quiet) {
      if (BOSS.axe2[st]) k.p(axe, 'axe2', t, 0.8, { f: 1250, decay: 0.15 });
      if (sec !== 'B') playMel(k, s, 'lead', BOSS.lead, { glide: true, p: { cut: 1800, vib: 24, vibRate: 6.2 } });
      if (sec === 'B' && st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.6, 0.8);
      if (s.last) k.fill(s, 8, 45, 0.85);
    }
  },
};

// VICTORY (120 BPM, D major) – the theme resolved to major: 10-bar anthem (20 s), then
// a soft 8-bar loop (pad + bells + SID arp) for results screens.
const VIC = {
  prog: ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'D', 'D'], soft: ['D', 'Bm', 'G', 'A'],
  hook: mel(`d5/3 d5/1 a4/2 d5/2 f#5/4 e5/2 d5/2 | e5/6 f#5/2 e5/2 c#5/2 a4/4 | d5/3 d5/1 f#5/2 a5/2 b5/4 a5/2 f#5/2 | g5/6 a5/2 b5/8 |
             a5/3 a5/1 f#5/2 a5/2 d6/4 c#6/2 a5/2 | e5/6 f#5/2 e5/2 c#5/2 a4/4 | b4/4 d5/4 g5/4 b5/4 | a5/8 c#6/8 | d6/16 | r/16`),
  bells: mel(`f#6/4 a6/4 d6/8 | d6/4 f#6/4 b5/8 | b5/4 d6/4 g6/8 | a6/4 e6/4 c#6/8`),
};
SONGS.victory = {
  bpm: 120, delay: 0.75,
  form: [['main', 10], ['soft', 8]], loop: 1,
  mix: mix({ kick: {}, snare: {}, hat: {}, tom: {}, crash: {}, bass: {}, pad: {}, stab: {}, brass: {}, lead: {}, bell: {}, arp: { vol: 1.0 }, fx: {}, boom: { vol: 0.6 } }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d;
    if (s.sec === 'main') {
      const C = VIC.prog[s.sb], vo = voicing(C, 57), root = chord(C).root;
      if (s.sb < 8) {
        if (st === 0) k.p(pad, 'pad', t, vo, d * 16, 0.8);
        k.drums(s, { kick: DR.kick, snare: DR.snare, hat: DR.hat8, ohat: DR.ohat }, { pump: 0.4 });
        bassLine(k, s, 'bass', root, BP.drive8, { cut: 260, env: 1800 });
        if (st === 0 || st === 6 || st === 10) k.p(stab, 'stab', t, vo, d * 1.6, st ? 0.75 : 0.95);
        if (st === 0 && s.sb % 4 === 0) k.p(crash, 'crash', t, 0.9);
        if (s.sb === 7) k.fill(s, 8, 47, 0.85);
        if (st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.6, 0.6);
      } else if (s.sb === 8 && st === 0) {
        k.p(crash, 'crash', t, 1, 4); k.p(kick, 'kick', t, 1); k.p(snare, 'snare', t, 0.9);
        k.p(impact, 'boom', t, 0.6, { len: 2 });
        k.p(brass, 'brass', t, [50, 57, 62, 66, 69, 74], d * 24, 1, { a: 0.02, fa: 0.08 });
        k.p(pad, 'pad', t, voicing('Dadd9', 57), d * 28, 0.9, { a: 0.1 });
        k.p(bass, 'bass', t, 38, d * 20, 0.9, { sus: 1, cut: 300, decay: 1 });
      }
      if (s.sb === 8 && st >= 1 && st <= 12) k.p(tom, 'tom', t, 38, 0.15 + (12 - st) * 0.02);
      playMel(k, s, 'lead', VIC.hook, { glide: true, v: 0.9 });
    } else {
      const C = VIC.soft[s.sb % 4], vo = voicing(C, 57), root = chord(C).root;
      if (st === 0) { k.p(pad, 'pad', t, vo, d * 16, 0.6, { cut: 300, env: 800 }); k.p(bass, 'bass', t, root, d * 14, 0.5, { cut: 160, env: 300, sus: 1 }); }
      playMel(k, s, 'bell', VIC.bells, { fn: bell, legato: 1, v: 0.6, p: { decay: 1.1 } });
      if (st % 4 === 0) k.p(pulseArp, 'arp', t, up(vo), d * 3.6, 0.35, { cut: 1800 });
    }
  },
};

// LEVEL CLEAR – ~5 s fanfare sting (non-looping): D-D-D Bb C | D major hold + bells.
SONGS.levelclear = {
  bpm: 138, form: [['f', 3]], loop: null,
  mix: mix({ kick: {}, snare: {}, tom: {}, crash: {}, bass: {}, pad: {}, brass: {}, stab: {}, bell: {}, boom: { vol: 0.5 } }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d;
    if (s.sb === 0) {
      const hitsAt = { 0: ['D', 3], 3: ['D', 3], 6: ['D', 2], 8: ['Bb', 4], 12: ['C', 4] };
      const h = hitsAt[st];
      if (h) {
        const vo = voicing(h[0], 57);
        k.p(stab, 'stab', t, [...vo, vo[0] + 12], d * h[1] * 0.85, st >= 8 ? 1 : 0.85, { s: 0.6 });
        k.p(bass, 'bass', t, chord(h[0]).root, d * h[1] * 0.9, 0.9, { cut: 300 });
        k.p(tom, 'tom', t, st >= 8 ? 43 : 38, 0.6);
      }
      if (st === 0) k.p(crash, 'crash', t, 0.6, 1.5);
      if (st >= 12) k.p(snare, 'snare', t, 0.3 + (st - 12) * 0.12);
    }
    if (s.sb === 1 && st === 0) {
      k.p(crash, 'crash', t, 1, 3.5); k.p(kick, 'kick', t, 1); k.p(snare, 'snare', t, 1, { decay: 0.3 });
      k.p(impact, 'boom', t, 0.5, { len: 1.6 });
      k.p(brass, 'brass', t, [50, 54, 57, 62, 66, 69], d * 20, 1, { a: 0.015, fa: 0.06, r: 1.2 });
      k.p(pad, 'pad', t, voicing('Dadd9', 57), d * 22, 0.9, { a: 0.05, r: 1.5 });
      k.p(bass, 'bass', t, 38, d * 18, 0.9, { sus: 1, cut: 260, decay: 0.8 });
    }
    if (s.sb === 1 && st % 2 === 0 && st <= 10) k.p(bell, 'bell', t, [74, 78, 81, 86, 90, 93][st / 2], 1.5, 0.6, { ratio: 3.5, decay: 0.9 });
  },
};

// GAME OVER – ~6 s somber sting (non-looping): falling brass line over a tolling bell.
SONGS.gameover = {
  bpm: 80, form: [['f', 2]], loop: null,
  mix: mix({ drone: { vol: 0.7 }, brass: { vol: 1.2 }, pad: {}, bell: { vol: 1.5 }, lead: { vol: 0.9, delay: 0.2 }, boom: { vol: 0.6 }, hb: {} }),
  step(k, s) {
    const t = s.t, st = s.st, d = s.d;
    if (s.sb === 0) {
      if (st === 0) {
        k.p(drone, 'drone', t, 38, 6.5, 0.8, { a: 0.6, r: 2, cut: 300 });
        k.p(bell, 'bell', t, 62, 4, 0.8, { ratio: 1.41, index: 2.5, decay: 2.4 });
        k.p(brass, 'brass', t, voicing('Gm', 50), d * 7.5, 0.7, { a: 0.3 });
        k.p(heartbeat, 'hb', t, 0.6);
      }
      if (st === 8) { k.p(brass, 'brass', t, voicing('Bb', 50), d * 7.5, 0.65, { a: 0.3 }); k.p(heartbeat, 'hb', t, 0.4); }
      const line = { 0: 69, 4: 67, 8: 65, 12: 64 };
      if (line[st] != null) k.p(lead, 'lead', t, line[st], d * 3.8, 0.6, { cut: 900, vib: 10, a: 0.05 });
    }
    if (s.sb === 1 && st === 0) {
      k.p(impact, 'boom', t, 0.6, { len: 2.5, f: 60 });
      k.p(brass, 'brass', t, voicing('Dm', 50), d * 12, 0.8, { a: 0.15, r: 1.8 });
      k.p(pad, 'pad', t, voicing('Dm', 45), d * 12, 0.8, { a: 0.1, r: 2 });
      k.p(lead, 'lead', t, 62, d * 10, 0.6, { cut: 800, vib: 12, a: 0.08, r: 1.2 });
      k.p(bell, 'bell', t, 50, 4, 0.7, { ratio: 1.41, index: 2, decay: 2.5 });
    }
  },
};

// ---------------------------------------------------------------------------------------
// SFX building blocks. Every sfx is fn(e, out, t, p, opts) -> duration (s); p = pitch factor.
// Layering convention: transient (click/crack) + body (tone/thump) + tail (noise/reverb send).
// ---------------------------------------------------------------------------------------
// Filtered noise burst. o: { n, f, f2, sw, ft, q, v, a, d, dur, rate }
function nz(e, out, t, o) {
  const g = e.gain(0, out);
  let dest = g;
  if (o.f) {
    const fl = e.filt(o.ft || 'bandpass', o.f, o.q ?? 1, g);
    if (o.f2) e.sweep(fl.frequency, t, o.f, o.f2, o.sw ?? o.dur ?? 0.2);
    dest = fl;
  }
  const dur = o.dur ?? Math.max(0.1, (o.d ?? 0.08) * 6);
  e.noise(o.n || 'white', t, dur + 0.02, dest, o.rate ?? 1);
  if (o.hold) { // attack, hold, release (sustained noises)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.v ?? 1, t + (o.a ?? 0.01));
    g.gain.setValueAtTime(o.v ?? 1, t + o.hold); g.gain.linearRampToValueAtTime(0, t + dur);
  } else e.perc(g.gain, t, o.v ?? 1, o.a ?? 0.002, o.d ?? 0.08);
  return g;
}
// Pitched oscillator blip. o: { w, f, f2, sw, lin, v, a, d, dur, lp, q }
function tone(e, out, t, o) {
  const g = e.gain(0, out);
  const os = e.osc(o.w || 'sine', o.f, o.lp ? e.filt('lowpass', o.lp, o.q ?? 0.7, g) : g);
  if (o.f2) e.sweep(os.frequency, t, o.f, o.f2, o.sw ?? o.dur ?? 0.2, !o.lin);
  const dur = o.dur ?? Math.max(0.1, (o.d ?? 0.1) * 6);
  if (o.hold) {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.v ?? 1, t + (o.a ?? 0.01));
    g.gain.setValueAtTime(o.v ?? 1, t + o.hold); g.gain.linearRampToValueAtTime(0, t + dur);
  } else e.perc(g.gain, t, o.v ?? 1, o.a ?? 0.002, o.d ?? 0.1);
  os.start(t); os.stop(t + dur + 0.02);
  return os;
}
// Low body thump (sine pitch drop through a soft clipper).
function thump(e, out, t, f0, f1, d, v = 1) {
  const g = e.gain(0, out);
  const o = e.osc('sine', f0, e.shaper(e.drive(1.5), g));
  e.sweep(o.frequency, t, f0, f1, d * 2.5);
  e.perc(g.gain, t, v, 0.002, d);
  o.start(t); o.stop(t + d * 7 + 0.05);
}
// Formant voice: glottal saw (+ breath noise, optional fuzz roughness) through three
// vowel formant bandpasses, with f0 / vowel / amplitude contours given as [[dt, value], ...].
function voice(e, out, t, o) {
  const dur = o.dur;
  const amp = e.gain(0, out);
  const src = e.gain(1);
  const glot = e.osc(o.wave || 'sawtooth', o.f0[0][1], src);
  glot.frequency.setValueAtTime(o.f0[0][1], t);
  for (const [dt, f] of o.f0.slice(1)) glot.frequency.linearRampToValueAtTime(f, t + dt);
  const lfo = e.osc('sine', o.vibRate ?? 6); const lg = e.gain(o.vib ?? 2); lfo.connect(lg); lg.connect(glot.frequency);
  const jit = e.gain(o.jitter ?? 6); e.noise('brown', t, dur + 0.05, e.filt('lowpass', 40, 0.7, jit)); jit.connect(glot.frequency);
  if (o.breath) e.noise('white', t, dur + 0.05, e.gain(o.breath, src));
  let feed = src;
  if (o.rough) { feed = e.gain(1); src.connect(e.gain(o.rough, e.shaper(e.fuzz(), feed))); }
  const sh = o.fShift ?? 1, vs = o.vowels;
  VOWELS[vs[0][1]].forEach(([f, q], i) => {
    const bp = e.filt('bandpass', f * sh, q * (o.qMul ?? 1));
    const fg = e.gain(VOWELS[vs[0][1]][i][2] * 3.5, amp);
    feed.connect(bp); bp.connect(fg);
    bp.frequency.setValueAtTime(f * sh, t);
    for (const [dt, vw] of vs.slice(1)) {
      const [ff, , gg] = VOWELS[vw][i];
      bp.frequency.linearRampToValueAtTime(ff * sh, t + dt); fg.gain.linearRampToValueAtTime(gg * 3.5, t + dt);
    }
  });
  amp.gain.setValueAtTime(0, t);
  for (const [dt, l] of o.env) amp.gain.linearRampToValueAtTime(l * (o.v ?? 1), t + dt);
  amp.gain.linearRampToValueAtTime(0, t + dur);
  glot.start(t); lfo.start(t); glot.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
}
// Pan automation helper for pass-bys (returns a node to connect into).
function panSweep(e, out, t, from, to, dur) {
  const p = e.pan(from, out);
  if (p.pan) { p.pan.setValueAtTime(from, t); p.pan.linearRampToValueAtTime(to, t + dur); }
  return p;
}

// ---------------------------------------------------------------------------------------
// SFX catalogue
// ---------------------------------------------------------------------------------------
const SFX = {
  headbutt(e, out, t, p) {
    thump(e, out, t, 140 * p, 48 * p, 0.07, 1);
    nz(e, out, t, { f: 900 * p, q: 1, v: 0.9, d: 0.03 });
    nz(e, out, t + 0.004, { f: 2800 * p, ft: 'highpass', v: 0.5, d: 0.012 });
    tone(e, out, t, { w: 'triangle', f: 240 * p, f2: 150 * p, sw: 0.1, v: 0.35, d: 0.06 });
    return 0.5;
  },
  punch(e, out, t, p) {
    nz(e, out, t, { f: 1400 * p, f2: 500 * p, sw: 0.05, q: 1.5, v: 0.35, a: 0.02, d: 0.02, dur: 0.07 });
    thump(e, out, t + 0.04, 160 * p, 60 * p, 0.055, 1);
    nz(e, out, t + 0.04, { f: 1500 * p, q: 0.9, v: 1.1, d: 0.02 });
    nz(e, out, t + 0.042, { f: 4000, ft: 'highpass', v: 0.4, d: 0.008 });
    return 0.4;
  },
  hit(e, out, t, p) {
    thump(e, out, t, 110 * p, 45 * p, 0.06, 1);
    nz(e, out, t, { f: 1100 * p, ft: 'lowpass', q: 0.8, v: 0.9, d: 0.045 });
    nz(e, out, t + 0.002, { f: 3000 * p, q: 1.2, v: 0.5, d: 0.012 });
    return 0.4;
  },
  kick(e, out, t, p) {
    nz(e, out, t, { f: 500 * p, f2: 1800 * p, sw: 0.1, q: 1.3, v: 0.5, a: 0.04, d: 0.03, dur: 0.14 });
    thump(e, out, t + 0.09, 120 * p, 42 * p, 0.08, 1.1);
    nz(e, out, t + 0.09, { f: 800 * p, q: 0.8, v: 0.9, d: 0.035 });
    return 0.55;
  },
  knifeThrow(e, out, t, p) {
    const g = e.gain(1, out);
    const am = e.gain(0.5, g); const lfo = e.osc('square', 24 * p); const lg = e.gain(0.5); lfo.connect(lg); lg.connect(am.gain);
    nz(e, am, t, { f: 2600 * p, f2: 1800 * p, sw: 0.35, q: 3, v: 1.1, a: 0.03, hold: 0.2, dur: 0.38 });
    lfo.start(t); lfo.stop(t + 0.4);
    tone(e, out, t, { f: 4200 * p, v: 0.12, d: 0.05 });
    return 0.5;
  },
  knifeHit(e, out, t, p) {
    thump(e, out, t, 320 * p, 120 * p, 0.035, 0.7);
    metal(e, out, t, 1900 * p, 0.6, { ratios: [1, 2.32, 3.9], decay: 0.12, click: 5000 });
    nz(e, out, t, { f: 2500, q: 1, v: 0.5, d: 0.01 });
    return 0.8;
  },
  pistol(e, out, t, p) {
    nz(e, out, t, { f: 1200 * p, ft: 'highpass', v: 1.4, d: 0.018 });
    nz(e, out, t, { f: 420 * p, q: 0.6, v: 1.2, d: 0.07 });
    thump(e, out, t, 95 * p, 38 * p, 0.11, 1.2);
    nz(e, out, t + 0.01, { n: 'pink', f: 1400 * p, f2: 300, sw: 0.6, ft: 'lowpass', v: 0.5, d: 0.25 });
    metal(e, out, t + 0.05, 2600 * p, 0.12, { ratios: [1, 2.76, 5.4], decay: 0.03 });
    return 1.4;
  },
  mg(e, out, t, p) {
    nz(e, out, t, { f: 2100 * p, q: 0.7, v: 1.1, d: 0.022, dur: 0.12 });
    tone(e, out, t, { f: 150 * p, f2: 55, sw: 0.05, v: 0.8, d: 0.03, dur: 0.15 });
    return 0.3;
  },
  laserOn(e, out, t, p) {
    tone(e, out, t, { w: 'sine', f: 700 * p, f2: 2600 * p, sw: 0.25, v: 0.3, a: 0.01, d: 0.18, dur: 0.5 });
    tone(e, out, t, { w: 'square', f: 120 * p, lp: 900, v: 0.12, a: 0.02, hold: 0.25, dur: 0.45 });
    nz(e, out, t, { f: 3000, v: 0.4, d: 0.006 });
    return 0.6;
  },
  shell(e, out, t, p) {
    const f = rnd(3000, 4200) * p;
    [[0, 0.8], [0.08 + rnd(0, 0.03), 0.5], [0.15 + rnd(0, 0.04), 0.26], [0.2 + rnd(0, 0.04), 0.12]].forEach(([dt, v]) =>
      metal(e, out, t + dt, f * rnd(0.97, 1.03), v, { ratios: [1, 2.41, 4.13], decay: 0.045, click: 7000 }));
    return 0.6;
  },
  reload(e, out, t, p) {
    nz(e, out, t, { f: 3000 * p, q: 2, v: 0.7, d: 0.008 });
    nz(e, out, t + 0.05, { f: 1200 * p, f2: 2600 * p, sw: 0.1, q: 2, v: 0.25, a: 0.02, d: 0.04, dur: 0.12 });
    metal(e, out, t + 0.28, 900 * p, 0.6, { ratios: [1, 1.7, 3.1], decay: 0.04, click: 2500 });
    thump(e, out, t + 0.28, 200 * p, 90, 0.025, 0.5);
    return 0.6;
  },
  gunCock(e, out, t, p) {
    metal(e, out, t, 1500 * p, 0.5, { ratios: [1, 2.2, 3.7], decay: 0.03, click: 3500 });
    nz(e, out, t + 0.02, { f: 2600 * p, f2: 1200 * p, sw: 0.08, q: 2, v: 0.35, a: 0.01, d: 0.03, dur: 0.1 });
    metal(e, out, t + 0.13, 1100 * p, 0.8, { ratios: [1, 1.9, 3.3], decay: 0.04, click: 2800 });
    thump(e, out, t + 0.13, 220 * p, 100, 0.02, 0.5);
    return 0.5;
  },
  grenadeThrow(e, out, t, p) {
    metal(e, out, t, 4600 * p, 0.5, { ratios: [1, 2.7], decay: 0.12, click: 8000 });
    nz(e, out, t + 0.06, { f: 400 * p, f2: 1300 * p, sw: 0.28, q: 1.4, v: 0.9, a: 0.12, d: 0.08, dur: 0.35 });
    return 0.6;
  },
  explosion(e, out, t, p) {
    nz(e, out, t, { f: 7000, ft: 'lowpass', v: 1.4, d: 0.03 });
    nz(e, out, t, { n: 'brown', f: 1600 * p, f2: 140, sw: 1.6, ft: 'lowpass', q: 0.9, v: 1.6, a: 0.005, d: 0.55, dur: 3 });
    const g = e.gain(0, out); const o = e.osc('sine', 62 * p, e.shaper(e.drive(2.5), g));
    e.sweep(o.frequency, t, 62 * p, 24, 1.4); e.perc(g.gain, t, 1.1, 0.004, 0.45); o.start(t); o.stop(t + 3);
    for (let i = 0; i < 14; i++) {
      const dt = 0.12 + Math.pow(Math.random(), 1.6) * 1.4;
      nz(e, out, t + dt, { f: rnd(1500, 5000), q: 1.5, v: rnd(0.1, 0.35) * (1.5 - dt), d: 0.008 });
    }
    return 3.2;
  },
  rocketLaunch(e, out, t, p) {
    thump(e, out, t, 110 * p, 40, 0.09, 1);
    nz(e, out, t, { f: 700 * p, f2: 3200 * p, sw: 0.5, q: 0.8, v: 0.9, a: 0.02, hold: 0.6, dur: 1.4 });
    nz(e, out, t, { n: 'brown', f: 400, ft: 'lowpass', v: 0.8, a: 0.02, hold: 0.5, dur: 1.3 });
    for (let i = 0; i < 8; i++) nz(e, out, t + rnd(0.05, 0.9), { f: rnd(2000, 6000), v: 0.2, d: 0.006 });
    return 1.6;
  },
  rocketFly(e, out, t, p) {
    const g = e.gain(1, out);
    const lfo = e.osc('sine', 9 * p); const lg = e.gain(0.25); lfo.connect(lg); lg.connect(g.gain);
    nz(e, g, t, { f: 2400 * p, q: 0.7, v: 0.55, a: 0.1, hold: 0.9, dur: 1.3 });
    nz(e, g, t, { n: 'brown', f: 300 * p, ft: 'lowpass', v: 0.6, a: 0.1, hold: 0.9, dur: 1.3 });
    lfo.start(t); lfo.stop(t + 1.35);
    return 1.4;
  },
  burger(e, out, t, p) {
    for (const dt of [0, 0.13]) {
      nz(e, out, t + dt, { f: 1300 * p, q: 1.2, v: 0.9, d: 0.025 });
      nz(e, out, t + dt + 0.01, { n: 'pink', f: 700 * p, ft: 'lowpass', v: 0.6, d: 0.05 });
      thump(e, out, t + dt, 180 * p, 90, 0.03, 0.4);
    }
    nz(e, out, t + 0.05, { n: 'pink', f: 500, f2: 1500, sw: 0.2, q: 4, v: 0.25, d: 0.06, dur: 0.3 });
    [72, 76, 79, 84, 88].forEach((m, i) => bell(e, out, t + 0.28 + i * 0.055, m, 0.6, 0.9 - i * 0.08, { ratio: 3.5, index: 1.6, decay: 0.35 }));
    return 1.6;
  },
  powerup(e, out, t, p) {
    pulseArp(e, out, t, [60, 64, 67, 72, 76, 79, 84].map((m) => m + 12 * Math.log2(p)), 0.55, 2.2, { rate: 1 / 26, cut: 6000 });
    tone(e, out, t, { w: 'triangle', f: 300 * p, f2: 1500 * p, sw: 0.5, v: 0.25, a: 0.02, d: 0.2, dur: 0.7 });
    [84, 88, 91, 96].forEach((m, i) => bell(e, out, t + 0.45 + i * 0.06, m, 0.6, 0.7, { decay: 0.4 }));
    return 1.5;
  },
  // Rubber duck: squeeze-squeak, then a nasal two-part "qua-ack" sliding down.
  quack(e, out, t, p) {
    const sq = e.gain(0, out);
    const o = e.osc('triangle', 1500 * p, e.filt('bandpass', 2200 * p, 2, sq));
    o.frequency.setValueAtTime(1350 * p, t); o.frequency.linearRampToValueAtTime(2300 * p, t + 0.1); o.frequency.linearRampToValueAtTime(1900 * p, t + 0.2);
    const wob = e.osc('sine', 38); const wg = e.gain(140 * p); wob.connect(wg); wg.connect(o.frequency);
    sq.gain.setValueAtTime(0, t); sq.gain.linearRampToValueAtTime(0.6, t + 0.02); sq.gain.setValueAtTime(0.6, t + 0.16); sq.gain.linearRampToValueAtTime(0, t + 0.22);
    o.start(t); wob.start(t); o.stop(t + 0.25); wob.stop(t + 0.25);
    const q0 = t + 0.3;
    for (const [dt, f0, f1, len] of [[0, 520, 430, 0.1], [0.12, 470, 300, 0.22]]) {
      voice(e, out, q0 + dt, {
        f0: [[0, f0 * p], [len, f1 * p]], vowels: [[0, 'ae'], [len, 'a']], dur: len, wave: 'square',
        env: [[0.012, 1], [len * 0.6, 0.85]], v: 0.55, fShift: 1.25, qMul: 1.6, breath: 0.15, vib: 25, vibRate: 30, jitter: 12,
      });
      nz(e, out, q0 + dt, { f: 1300 * p, q: 5, v: 0.25, d: 0.03 });
    }
    return 0.9;
  },
  weaponLost(e, out, t, p) {
    const g = e.gain(0, out);
    const f = e.filt('lowpass', 3000, 6, g);
    const o = e.osc('sawtooth', 820 * p, f);
    e.sweep(o.frequency, t, 820 * p, 110 * p, 0.55); e.sweep(f.frequency, t, 4000, 300, 0.55);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.6);
    o.start(t); o.stop(t + 0.62);
    nz(e, out, t + 0.05, { f: 1200, f2: 300, sw: 0.3, q: 1, v: 0.25, a: 0.05, d: 0.1, dur: 0.4 });
    return 0.8;
  },
  playerHurt(e, out, t, p) {
    const f = rnd(0.96, 1.04) * p;
    voice(e, out, t, { f0: [[0, 135 * f], [0.06, 150 * f], [0.28, 92 * f]], vowels: [[0, 'uh'], [0.25, 'o']], dur: 0.32, env: [[0.015, 1], [0.12, 0.8], [0.25, 0.3]], v: 0.8, breath: 0.25, rough: 0.6, jitter: 10 });
    thump(e, out, t, 120, 50, 0.04, 0.5);
    return 0.5;
  },
  playerDie(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 150 * p], [0.15, 165 * p], [0.9, 85 * p], [1.2, 70 * p]], vowels: [[0, 'a'], [0.5, 'o'], [1.1, 'u']], dur: 1.25, env: [[0.03, 1], [0.6, 0.85], [1.0, 0.35]], v: 0.85, breath: 0.3, rough: 0.9, vib: 4, jitter: 14 });
    thump(e, out, t + 1.0, 90, 40, 0.09, 1);
    nz(e, out, t + 1.0, { f: 900, ft: 'lowpass', v: 0.7, d: 0.08 });
    return 1.9;
  },
  enemyHurt(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 118 * p], [0.05, 128 * p], [0.22, 86 * p]], vowels: [[0, 'o'], [0.2, 'u']], dur: 0.25, env: [[0.012, 1], [0.1, 0.7]], v: 0.75, breath: 0.2, rough: 0.7, jitter: 10 });
    return 0.4;
  },
  enemyDie(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 160 * p], [0.08, 175 * p], [0.6, 70 * p]], vowels: [[0, 'a'], [0.5, 'uh']], dur: 0.7, env: [[0.02, 1], [0.35, 0.7], [0.6, 0.2]], v: 0.8, breath: 0.25, rough: 0.8, jitter: 12 });
    thump(e, out, t + 0.55, 85, 38, 0.08, 0.9);
    nz(e, out, t + 0.55, { f: 800, ft: 'lowpass', v: 0.6, d: 0.07 });
    return 1.1;
  },
  femaleHurt(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 330 * p], [0.05, 360 * p], [0.3, 250 * p]], vowels: [[0, 'a'], [0.28, 'ae']], dur: 0.34, env: [[0.012, 1], [0.15, 0.7]], v: 0.7, fShift: 1.18, breath: 0.3, rough: 0.25, jitter: 14 });
    return 0.5;
  },
  jump(e, out, t, p) {
    nz(e, out, t, { f: 800 * p, f2: 1700 * p, sw: 0.18, q: 1.2, v: 0.6, a: 0.04, d: 0.06, dur: 0.25 });
    voice(e, out, t, { f0: [[0, 140 * p], [0.1, 155 * p]], vowels: [[0, 'uh'], [0.1, 'uh']], dur: 0.12, env: [[0.015, 0.5], [0.08, 0.3]], v: 0.5, breath: 0.4, jitter: 6 });
    return 0.35;
  },
  land(e, out, t, p) {
    thump(e, out, t, 95 * p, 45, 0.05, 0.9);
    nz(e, out, t, { n: 'pink', f: 1500 * p, ft: 'lowpass', v: 0.7, d: 0.05 });
    nz(e, out, t + 0.02, { f: 3000 * p, q: 1, v: 0.2, d: 0.03 });
    return 0.4;
  },
  step(e, out, t, p) {
    nz(e, out, t, { f: rnd(380, 650) * p, q: 1.1, v: 1, d: 0.018 });
    thump(e, out, t, 90 * p, 55, 0.02, 0.55);
    nz(e, out, t + rnd(0.025, 0.05), { f: rnd(1800, 3400) * p, q: 1.4, v: rnd(0.25, 0.45), d: 0.014 });
    return 0.25;
  },
  ladder(e, out, t, p) {
    metal(e, out, t, rnd(560, 760) * p, 1, { ratios: [1, 2.6, 4.4], decay: 0.07, click: 2400 });
    nz(e, out, t, { f: 1200, q: 1, v: 0.6, d: 0.015 });
    return 0.5;
  },
};

Object.assign(SFX, {
  // Pram: squeaky wheels (periodic squeaks at wheel rate) + rolling rumble + rattle.
  pram(e, out, t, p) {
    const dur = 1.6;
    const rg = e.gain(0, out);
    nz(e, rg, t, { n: 'brown', f: 320, ft: 'lowpass', v: 1, a: 0.1, hold: dur - 0.3, dur });
    const am = e.osc('sine', 5.5 * p); const ag = e.gain(0.5); am.connect(ag); ag.connect(rg.gain); rg.gain.value = 0.6;
    am.start(t); am.stop(t + dur);
    for (let i = 0, tt = t + 0.05; tt < t + dur - 0.15; i++, tt += rnd(0.16, 0.22)) {
      const f = rnd(1700, 2500) * p;
      const g = e.gain(0, out);
      const o = e.osc('triangle', f, e.filt('bandpass', f * 1.2, 3, g));
      o.frequency.setValueAtTime(f, tt); o.frequency.linearRampToValueAtTime(f * rnd(1.15, 1.35), tt + 0.06); o.frequency.linearRampToValueAtTime(f * 0.9, tt + 0.1);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(rnd(0.25, 0.45), tt + 0.015); g.gain.linearRampToValueAtTime(0, tt + 0.11);
      o.start(tt); o.stop(tt + 0.12);
      if (i % 2) metal(e, out, tt + 0.07, rnd(900, 1300), 0.15, { ratios: [1, 2.3], decay: 0.02 });
    }
    return dur + 0.1;
  },
  pramCrash(e, out, t, p) {
    nz(e, out, t, { f: 2500, ft: 'highpass', v: 1, d: 0.04 });
    thump(e, out, t, 130 * p, 50, 0.07, 0.9);
    for (let i = 0; i < 7; i++) metal(e, out, t + rnd(0, 0.35), rnd(500, 2200) * p, rnd(0.3, 0.7), { ratios: [1, 1.8, 2.9, 4.4], decay: rnd(0.04, 0.15) });
    nz(e, out, t + 0.02, { n: 'pink', f: 1200, ft: 'lowpass', v: 0.6, d: 0.15 });
    tone(e, out, t + 0.3, { w: 'triangle', f: 2200 * p, f2: 900 * p, sw: 0.9, v: 0.15, a: 0.02, d: 0.35, dur: 1.0, lp: 3000 });
    return 1.5;
  },
  // Motorcycle pass-by with doppler shift, pan sweep and distance envelope (~2.5 s).
  motorcycle(e, out, t, p, o = {}) {
    const dur = 2.5, mid = t + 1.2, dir = o.dir ?? 1;
    const pn = panSweep(e, out, t, -0.9 * dir, 0.9 * dir, dur);
    const g = e.gain(0, pn);
    const lp = e.filt('lowpass', 1500, 1.2, g);
    const ws = e.shaper(e.drive(3), lp);
    const f = 92 * p;
    const o1 = e.osc('sawtooth', f, ws), o2 = e.osc('square', f * 2.01, e.gain(0.4, ws));
    const put = e.osc('square', f / 3); const pg = e.gain(0.35); put.connect(pg); const am = e.gain(0.65, ws); pg.connect(am.gain);
    o1.disconnect(); o1.connect(am);
    for (const os of [o1, o2]) {
      const k = os === o1 ? 1 : 2.01;
      os.frequency.setValueAtTime(f * k * 1.16, t);
      os.frequency.linearRampToValueAtTime(f * k * 1.2, mid - 0.25);
      os.frequency.linearRampToValueAtTime(f * k * 0.84, mid + 0.25);
      os.frequency.linearRampToValueAtTime(f * k * 0.8, t + dur);
    }
    lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(2600, mid); lp.frequency.linearRampToValueAtTime(600, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.8); g.gain.linearRampToValueAtTime(0.5, mid); g.gain.linearRampToValueAtTime(0.1, mid + 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const os of [o1, o2, put]) { os.start(t); os.stop(t + dur + 0.05); }
    nz(e, pn, t, { n: 'pink', f: 900, q: 0.7, v: 0.25, a: 1.1, hold: 1.25, dur });
    return dur + 0.1;
  },
  carPass(e, out, t, p, o = {}) {
    const dur = 2.4, mid = t + 1.15, dir = o.dir ?? 1;
    const pn = panSweep(e, out, t, -0.85 * dir, 0.85 * dir, dur);
    const g = e.gain(0, pn);
    const lp = e.filt('lowpass', 500, 1, g);
    const f = 48 * p;
    const oscs = [[1, 'sawtooth', 1], [2, 'sawtooth', 0.5], [0.5, 'sine', 0.8]].map(([k, w, v]) => { const os = e.osc(w, f * k, e.gain(v, lp)); return [os, k]; });
    for (const [os, k] of oscs) {
      os.frequency.setValueAtTime(f * k * 1.12, t); os.frequency.linearRampToValueAtTime(f * k * 1.14, mid - 0.2);
      os.frequency.linearRampToValueAtTime(f * k * 0.88, mid + 0.2); os.frequency.linearRampToValueAtTime(f * k * 0.86, t + dur);
      os.start(t); os.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, mid); g.gain.linearRampToValueAtTime(0, t + dur);
    const tg = e.gain(0, pn);
    nz(e, tg, t, { n: 'pink', f: 700, q: 0.6, v: 1, a: 0.01, hold: dur - 0.05, dur });
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(0.9, mid); tg.gain.linearRampToValueAtTime(0, t + dur);
    return dur + 0.1;
  },
  // V8 idle: loping burble (irregular firing AM) + a throttle blip at ~1.5 s.
  engineIdle(e, out, t, p) {
    const dur = 3;
    const g = e.gain(0, out);
    const lp = e.filt('lowpass', 260, 2, g);
    const ws = e.shaper(e.drive(2.5), lp);
    const f = 33 * p;
    const o1 = e.osc('sawtooth', f), o2 = e.osc('sawtooth', f * 2.003);
    const am = e.gain(0.5, ws); o1.connect(am); o2.connect(e.gain(0.6, am));
    const lope = e.osc('square', f / 4); const lg = e.gain(0.45); lope.connect(lg); lg.connect(am.gain);
    for (const os of [o1, o2, lope]) {
      const k = os === o2 ? 2.003 : os === lope ? 0.25 : 1;
      os.frequency.setValueAtTime(f * k, t);
      os.frequency.setValueAtTime(f * k, t + 1.4); os.frequency.linearRampToValueAtTime(f * k * 2.2, t + 1.65); os.frequency.linearRampToValueAtTime(f * k, t + 2.3);
      os.start(t); os.stop(t + dur + 0.05);
    }
    lp.frequency.setValueAtTime(260, t + 1.4); lp.frequency.linearRampToValueAtTime(900, t + 1.65); lp.frequency.linearRampToValueAtTime(260, t + 2.3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.15); g.gain.setValueAtTime(0.7, t + dur - 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    nz(e, out, t, { n: 'brown', f: 150, ft: 'lowpass', v: 0.4, a: 0.1, hold: dur - 0.4, dur });
    return dur + 0.1;
  },
  carDoor(e, out, t, p) {
    thump(e, out, t, 85 * p, 45, 0.08, 1);
    metal(e, out, t + 0.005, 1800 * p, 0.35, { ratios: [1, 2.2, 3.4], decay: 0.035, click: 3000 });
    nz(e, out, t, { n: 'pink', f: 650, ft: 'lowpass', v: 0.6, d: 0.09 });
    return 0.7;
  },
  ingridScream(e, out, t, p) {
    voice(e, out, t, {
      f0: [[0, 820 * p], [0.12, 1080 * p], [0.7, 1000 * p], [1.1, 760 * p]], vowels: [[0, 'ae'], [0.3, 'a'], [1.1, 'a']], dur: 1.2,
      env: [[0.06, 1], [0.8, 0.85], [1.05, 0.3]], v: 0.55, fShift: 1.22, breath: 0.35, rough: 0.35, vib: 28, vibRate: 7, jitter: 20,
    });
    return 1.4;
  },
  // Soft warm "mm-hmm" hum + a gentle chime.
  ingridThanks(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 215 * p], [0.22, 245 * p]], vowels: [[0, 'm'], [0.22, 'm']], dur: 0.26, env: [[0.05, 1], [0.18, 0.8]], v: 0.8, fShift: 1.1, breath: 0.08, vib: 3, jitter: 3 });
    voice(e, out, t + 0.34, { f0: [[0, 255 * p], [0.12, 250 * p], [0.42, 190 * p]], vowels: [[0, 'uh'], [0.1, 'm'], [0.42, 'm']], dur: 0.45, env: [[0.04, 1], [0.3, 0.6]], v: 0.8, fShift: 1.1, breath: 0.12, vib: 3, jitter: 3 });
    [79, 83, 86, 91].forEach((m, i) => bell(e, out, t + 0.05 + i * 0.09, m, 1, 0.45, { ratio: 1, index: 1.2, decay: 0.7 }));
    return 1.8;
  },
  ingridTaken(e, out, t, p) {
    SFX.ingridScream(e, out, t, p);
    impact(e, out, t + 0.15, 0.7, { len: 1.8 });
    stab(e, out, t + 0.15, [50, 53, 56, 62, 65], 1.4, 1, { r: 0.8, s: 0.5 });
    brass(e, out, t + 0.6, [38, 44, 50], 1.6, 0.8, { r: 1 });
    return 3;
  },
  axeClang(e, out, t, p) { axe(e, out, t, 1.2, { f: 1050 * p, decay: 0.28 }); return 1.6; },
  metalHit(e, out, t, p) {
    metal(e, out, t, 420 * p, 1, { ratios: [1, 2.76, 5.4, 8.93, 13.3], decay: 0.4, fm: 3, click: 2500 });
    thump(e, out, t, 160 * p, 70, 0.04, 0.5);
    return 2.2;
  },
  metalStep(e, out, t, p) {
    metal(e, out, t, rnd(300, 460) * p, 0.9, { ratios: [1, 2.3, 3.9, 6.1], decay: 0.05, click: 1600 });
    nz(e, out, t, { f: 1500 * p, q: 1, v: 0.7, d: 0.016 });
    if (Math.random() < 0.5) metal(e, out, t + rnd(0.03, 0.06), rnd(1200, 1900), 0.12, { ratios: [1, 2.6], decay: 0.02 });
    return 0.5;
  },
  // Deep, slow "heh… heh… heh… HAH" through low-shifted formants.
  bossLaugh(e, out, t, p) {
    const syl = [[0.05, 92, 'e', 0.7], [0.29, 88, 'e', 0.75], [0.53, 84, 'a', 0.8], [0.83, 96, 'a', 1], [1.3, 70, 'uh', 0.6]];
    for (const [dt, f0, vw, v] of syl) {
      const len = dt > 1 ? 0.5 : 0.18;
      nz(e, out, t + dt - 0.03, { f: 1400, q: 0.8, v: 0.12 * v, a: 0.02, d: 0.02, dur: 0.06 });
      voice(e, out, t + dt, { f0: [[0, f0 * p], [len, f0 * p * 0.86]], vowels: [[0, vw], [len, vw === 'uh' ? 'o' : vw]], dur: len, env: [[0.02, 1], [len * 0.5, 0.7]], v: v * 0.9, fShift: 0.82, breath: 0.25, rough: 0.5, jitter: 8, vib: 2 });
    }
    return 2.4;
  },
  bossSlash(e, out, t, p) {
    const g = e.gain(0, out);
    const bp = e.filt('bandpass', 300, 2, g);
    bp.frequency.setValueAtTime(300 * p, t); bp.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.16); bp.frequency.exponentialRampToValueAtTime(500 * p, t + 0.4);
    e.noise('white', t, 0.45, bp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 0.42);
    nz(e, out, t, { n: 'pink', f: 500, ft: 'lowpass', v: 0.6, a: 0.12, d: 0.1, dur: 0.45 });
    metal(e, out, t + 0.12, 2400 * p, 0.18, { ratios: [1, 1.5, 2.3], decay: 0.25 });
    return 0.9;
  },
  bossRoar(e, out, t, p) {
    voice(e, out, t, { f0: [[0, 70 * p], [0.3, 98 * p], [1.0, 84 * p], [1.4, 58 * p]], vowels: [[0, 'o'], [0.35, 'a'], [1.1, 'uh']], dur: 1.5, env: [[0.12, 1], [1.0, 0.9], [1.35, 0.3]], v: 0.95, fShift: 0.8, breath: 0.6, rough: 1.6, jitter: 18, vib: 5 });
    thump(e, out, t, 60 * p, 35, 0.3, 0.6);
    return 1.8;
  },
  glassBreak(e, out, t, p) {
    nz(e, out, t, { f: 3000, ft: 'highpass', v: 1, d: 0.04 });
    thump(e, out, t, 200 * p, 90, 0.02, 0.3);
    for (let i = 0; i < 16; i++) {
      const dt = Math.pow(Math.random(), 1.5) * 0.6;
      metal(e, out, t + dt, rnd(2500, 7000) * p, rnd(0.2, 0.6) * (1 - dt), { ratios: [1, 1.7, 2.9], decay: rnd(0.02, 0.09), click: 8000 });
    }
    nz(e, out, t + 0.03, { f: 5000, q: 0.7, v: 0.4, d: 0.12 });
    return 1.3;
  },
  splash(e, out, t, p) {
    nz(e, out, t, { f: 3200 * p, f2: 700, sw: 0.4, ft: 'lowpass', q: 1, v: 1, a: 0.005, d: 0.18, dur: 1 });
    thump(e, out, t, 110 * p, 50, 0.05, 0.5);
    for (let i = 0; i < 9; i++) {
      const tt = t + 0.1 + Math.random() * 0.6, f = rnd(500, 1100) * p;
      tone(e, out, tt, { f, f2: f * 1.8, sw: 0.04, v: 0.15, a: 0.003, d: 0.02, dur: 0.08 });
    }
    return 1.2;
  },
  steamHiss(e, out, t, p) {
    const g = e.gain(1, out);
    const lfo = e.osc('sine', 13); const lg = e.gain(0.15); lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + 1.5);
    nz(e, g, t, { f: 3500 * p, ft: 'highpass', q: 0.7, v: 0.6, a: 0.04, hold: 1, dur: 1.45 });
    nz(e, g, t, { f: 6500 * p, q: 1.5, v: 0.4, a: 0.03, hold: 0.9, dur: 1.4 });
    return 1.6;
  },
  sparks(e, out, t, p) {
    for (let i = 0; i < 22; i++) {
      const dt = Math.pow(Math.random(), 1.4) * 0.7;
      nz(e, out, t + dt, { f: rnd(3500, 9000) * p, q: 2, v: rnd(0.2, 0.7) * (1 - dt), d: 0.004, dur: 0.03 });
    }
    tone(e, out, t, { w: 'sawtooth', f: 120, lp: 1800, v: 0.25, a: 0.005, d: 0.08, dur: 0.4 });
    return 0.9;
  },
  furnaceRoar(e, out, t, p) {
    const dur = 2.8;
    nz(e, out, t, { n: 'brown', f: 420 * p, ft: 'lowpass', q: 1, v: 1, a: 0.4, hold: 1.8, dur });
    const g = e.gain(0.7, out);
    const lfo = e.osc('sine', 7); const lg = e.gain(0.3); lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + dur);
    nz(e, g, t, { n: 'pink', f: 900 * p, q: 0.8, v: 0.6, a: 0.5, hold: 1.7, dur });
    for (let i = 0; i < 18; i++) nz(e, out, t + rnd(0.2, dur - 0.3), { f: rnd(1500, 4000), q: 1.5, v: rnd(0.1, 0.3), d: 0.006, dur: 0.04 });
    return dur + 0.1;
  },
  hookChain(e, out, t, p) {
    let tt = t;
    for (let i = 0; i < 16; i++) {
      tt += 0.03 + 0.05 * Math.abs(Math.sin(i * 0.45)) + rnd(0, 0.015);
      metal(e, out, tt, rnd(1400, 3000) * p, rnd(0.2, 0.45), { ratios: [1, 2.2, 3.6], decay: 0.03, click: 5000 });
    }
    metal(e, out, tt + 0.08, 520 * p, 0.9, { ratios: [1, 2.6, 4.9], decay: 0.25, fm: 2 });
    thump(e, out, tt + 0.08, 140, 60, 0.04, 0.5);
    return tt - t + 1;
  },
  // Police wail through a horn-speaker-ish bandpass (~3 s).
  siren(e, out, t, p) {
    const dur = 3;
    const g = e.gain(0, out);
    const bp = e.filt('bandpass', 1300, 1.2, e.shaper(e.drive(2), g));
    const o = e.osc('sawtooth', 700 * p, e.filt('lowpass', 2600, 0.7, bp));
    o.frequency.setValueAtTime(650 * p, t);
    for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(1550 * p, t + i + 0.55); o.frequency.linearRampToValueAtTime(650 * p, t + i + 1); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.15); g.gain.setValueAtTime(0.32, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
    return dur + 0.1;
  },
  matchStrike(e, out, t, p) {
    const g = e.gain(1, out);
    const am = e.osc('square', 140); const ag = e.gain(0.5); am.connect(ag); ag.connect(g.gain); am.start(t); am.stop(t + 0.14);
    nz(e, g, t, { f: 3200 * p, f2: 4500 * p, sw: 0.12, q: 2, v: 0.6, a: 0.01, d: 0.05, dur: 0.14 });
    nz(e, out, t + 0.1, { n: 'pink', f: 600, f2: 2400, sw: 0.12, ft: 'lowpass', q: 1.5, v: 0.8, a: 0.02, d: 0.12, dur: 0.5 });
    nz(e, out, t + 0.2, { f: 4000, ft: 'highpass', v: 0.12, a: 0.05, hold: 0.4, dur: 0.85 });
    return 1.1;
  },
  typewriter(e, out, t, p) {
    nz(e, out, t, { f: 2600 * p, q: 1.5, v: 1.2, d: 0.007 });
    thump(e, out, t, 190 * p, 110, 0.015, 0.7);
    metal(e, out, t + 0.012, 1250 * p, 0.4, { ratios: [1, 2.4], decay: 0.018, click: 4000 });
    return 0.25;
  },
  heartbeat(e, out, t, p) { heartbeat(e, out, t, 1.1); return 0.8; },
  whoosh(e, out, t, p) {
    const g = e.gain(0, out);
    const bp = e.filt('bandpass', 300, 1.4, g);
    bp.frequency.setValueAtTime(300 * p, t); bp.frequency.exponentialRampToValueAtTime(1600 * p, t + 0.18); bp.frequency.exponentialRampToValueAtTime(420 * p, t + 0.42);
    e.noise('white', t, 0.46, bp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8, t + 0.17); g.gain.linearRampToValueAtTime(0, t + 0.44);
    return 0.5;
  },
  // Time slows: tape-stop downward sweep + reverse swell + sub drop.
  slowmo(e, out, t, p) {
    swell(e, out, t, 0.35, 0.8);
    tone(e, out, t + 0.3, { w: 'sawtooth', f: 520 * p, f2: 45, sw: 1.1, lp: 1400, v: 0.3, a: 0.01, d: 0.45, dur: 1.4 });
    thump(e, out, t + 0.3, 90 * p, 25, 0.35, 0.9);
    nz(e, out, t + 0.3, { n: 'pink', f: 2500, f2: 200, sw: 1, ft: 'lowpass', v: 0.4, a: 0.01, d: 0.4, dur: 1.3 });
    return 1.8;
  },
  impactBoom(e, out, t, p) {
    out = e.gain(0.8, out);
    impact(e, out, t, 1, { len: 3 });
    snare(e, out, t, 1, { decay: 0.35 });
    crash(e, out, t, 0.8, 3);
    kick(e, out, t, 1, { decay: 0.8 });
    stab(e, out, t, [38, 50, 53, 57, 62], 1.2, 0.9, { r: 1.2 });
    return 3.5;
  },
  uiMove(e, out, t, p) { tone(e, out, t, { w: 'square', f: 900 * p, f2: 1100 * p, sw: 0.03, lp: 3000, v: 0.55, d: 0.025 }); return 0.2; },
  uiSelect(e, out, t, p) {
    tone(e, out, t, { w: 'square', f: 660 * p, lp: 3500, v: 0.28, d: 0.04 });
    tone(e, out, t + 0.07, { w: 'square', f: 990 * p, lp: 4000, v: 0.28, d: 0.07 });
    bell(e, out, t + 0.07, 88, 0.6, 0.5, { decay: 0.3 });
    return 0.6;
  },
  uiBack(e, out, t, p) {
    tone(e, out, t, { w: 'square', f: 700 * p, f2: 420 * p, sw: 0.1, lp: 2500, v: 0.55, d: 0.06 });
    return 0.35;
  },
  pause(e, out, t, p) {
    thump(e, out, t, 120, 50, 0.1, 0.4);
    bell(e, out, t, 81, 1, 0.6, { ratio: 1, index: 1.4, decay: 0.5 });
    bell(e, out, t + 0.12, 74, 1, 0.6, { ratio: 1, index: 1.4, decay: 0.6 });
    return 1.2;
  },
  extraLife(e, out, t, p) {
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => {
      pulseArp(e, out, t + i * 0.07, [m, m + 12], 0.09, 2.3, { rate: 1 / 40 });
    });
    bell(e, out, t + 0.5, 96, 1, 0.8, { decay: 0.6 });
    bell(e, out, t + 0.5, 84, 1, 0.6, { decay: 0.6 });
    return 1.4;
  },
  sectionClear(e, out, t, p) {
    stab(e, out, t, [62, 66, 69, 74], 0.25, 0.9);
    brass(e, out, t + 0.3, [62, 66, 69, 74, 78], 0.9, 0.9, { a: 0.02, fa: 0.05 });
    [86, 90, 93, 98].forEach((m, i) => bell(e, out, t + 0.3 + i * 0.07, m, 1, 0.5, { decay: 0.5 }));
    return 1.9;
  },
  objective(e, out, t, p) {
    bell(e, out, t, 76, 1, 0.8, { ratio: 3.5, decay: 0.8 });
    bell(e, out, t + 0.18, 83, 1, 0.8, { ratio: 3.5, decay: 0.9 });
    pad(e, out, t, [64, 71, 76], 0.9, 0.7, { a: 0.25, r: 0.6 });
    return 1.8;
  },
  alarm(e, out, t, p) {
    const dur = 2.2;
    const g = e.gain(0, out);
    const o = e.osc('square', 440 * p, e.filt('lowpass', 2200, 1, e.shaper(e.drive(2), g)));
    for (let i = 0; i * 0.25 < dur; i++) o.frequency.setValueAtTime((i % 2 ? 554 : 440) * p, t + i * 0.25);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.02); g.gain.setValueAtTime(0.28, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
    return dur + 0.1;
  },
});

// Per-sfx settings: v = random pitch variation (±), lim = max simultaneous voices,
// room / big = reverb send amounts (default room 0.12).
const SFX_CFG = {
  step: { v: 0.12, lim: 4, room: 0.06 }, mg: { v: 0.07, lim: 8, room: 0.1, big: 0.1 }, hit: { v: 0.1 }, punch: { v: 0.08 },
  kick: { v: 0.06 }, headbutt: { v: 0.05 }, enemyHurt: { v: 0.07 }, metalStep: { v: 0.1, lim: 4 }, shell: { v: 0.1, lim: 6, room: 0.05 },
  typewriter: { v: 0.05, lim: 4, room: 0.04 }, ladder: { v: 0.08, lim: 3 }, knifeHit: { v: 0.06 }, axeClang: { v: 0.05, room: 0.25, big: 0.2 },
  land: { v: 0.08 }, whoosh: { v: 0.1 }, sparks: { v: 0.1 }, jump: { v: 0.05 },
  pistol: { big: 0.3, room: 0.15 }, explosion: { big: 0.45, room: 0.1 }, rocketLaunch: { big: 0.3 }, rocketFly: { lim: 3 },
  impactBoom: { big: 0.5, room: 0 }, bossLaugh: { big: 0.4 }, bossRoar: { big: 0.35 }, ingridScream: { big: 0.25 }, ingridTaken: { big: 0.4 },
  siren: { big: 0.3, lim: 2 }, metalHit: { big: 0.2 }, glassBreak: { room: 0.3 }, slowmo: { big: 0.4 }, alarm: { room: 0.3, lim: 1 },
  uiMove: { room: 0, lim: 2 }, uiSelect: { room: 0.04 }, uiBack: { room: 0 }, pause: { room: 0.1 }, motorcycle: { lim: 2 }, carPass: { lim: 2 },
  engineIdle: { lim: 1 }, furnaceRoar: { lim: 2, big: 0.15 }, steamHiss: { lim: 3 }, heartbeat: { room: 0, lim: 2 }, bossSlash: { v: 0.04 },
};
const MAX_VOICES = 40;

// ---------------------------------------------------------------------------------------
// Ambience beds: continuous looping noise layers + randomly scheduled detail events.
// def.start(a, t) creates loops (push sources/LFOs to a.srcs); def.event(a, t) schedules one
// detail event at t and returns the delay until the next one.
// ---------------------------------------------------------------------------------------
function ambLoop(a, kind, dest) { const s = a.e.noise(kind, a.t0, null, dest); a.srcs.push(s); return s; }
function ambLfo(a, rate, depth, param, type = 'sine') {
  const o = a.e.osc(type, rate); const g = a.e.gain(depth); o.connect(g); g.connect(param); o.start(a.t0); a.srcs.push(o); return o;
}
const AMB = {
  // Rain on the city: broadband downpour + close patter + low roar + random drips.
  rain: {
    big: 0.1,
    start(a) {
      const e = a.e;
      ambLoop(a, 'pink2', e.filt('highpass', 450, 0.5, e.filt('lowpass', 7000, 0.5, e.gain(0.55, a.out))));
      const pg = e.gain(0.22, a.out);
      ambLoop(a, 'white2', e.filt('bandpass', 3400, 0.7, pg));
      ambLfo(a, 0.13, 0.07, pg.gain);
      ambLoop(a, 'brown', e.filt('lowpass', 220, 0.7, e.gain(0.55, a.out)));
    },
    event(a, t) {
      const e = a.e, f = rnd(1800, 4200);
      tone(e, e.pan(rnd(-1, 1), a.out), t, { f, f2: f * rnd(0.5, 0.7), sw: 0.02, v: rnd(0.04, 0.13), a: 0.001, d: 0.012, dur: 0.06 });
      if (Math.random() < 0.08) nz(e, e.pan(rnd(-0.8, 0.8), a.out), t, { f: rnd(600, 1400), q: 2, v: 0.2, d: 0.03, dur: 0.15 });
      return rnd(0.03, 0.22);
    },
  },
  // Gusty wind: two resonant noise bands with slow independent LFOs + occasional whistle.
  wind: {
    big: 0.05,
    start(a) {
      const e = a.e;
      for (const [f, rate, pan] of [[420, 0.07, -0.5], [760, 0.11, 0.5]]) {
        const g = e.gain(0.5, e.pan(pan, a.out));
        const bp = e.filt('bandpass', f, 1.6, g);
        ambLoop(a, 'pink2', bp);
        ambLfo(a, rate, f * 0.45, bp.frequency);
        ambLfo(a, rate * 1.7, 0.3, g.gain);
      }
      ambLoop(a, 'brown', e.filt('lowpass', 160, 0.7, e.gain(0.35, a.out)));
    },
    event(a, t) {
      const e = a.e, f = rnd(500, 900);
      tone(e, e.pan(rnd(-0.7, 0.7), a.out), t, { w: 'sine', f, f2: f * rnd(1.1, 1.5), sw: 2, v: 0.025, a: 0.8, hold: 1.5, dur: 3, lin: true });
      return rnd(4, 9);
    },
  },
  // Foundry interior: mains hum, rumble, machinery thump, distant clanks and steam.
  factory: {
    big: 0.35,
    start(a) {
      const e = a.e;
      const hum = e.gain(0.06, a.out);
      const lp = e.filt('lowpass', 320, 1, hum);
      for (const [f, w] of [[50, 'sawtooth'], [100, 'sine'], [150.4, 'sine']]) { const o = e.osc(w, f, lp); o.start(a.t0); a.srcs.push(o); }
      ambLoop(a, 'brown', e.filt('lowpass', 180, 0.8, e.gain(0.7, a.out)));
      const air = e.gain(0.06, a.out); ambLoop(a, 'pink2', e.filt('bandpass', 1800, 0.5, air)); ambLfo(a, 0.05, 0.03, air.gain);
      a.next2 = a.t0 + 0.5;
    },
    event(a, t) {
      const e = a.e, far = e.filt('lowpass', 2600, 0.7, e.pan(rnd(-0.9, 0.9), a.out));
      const r = Math.random();
      if (r < 0.55) metal(e, far, t, rnd(180, 900), rnd(0.12, 0.35), { ratios: [1, 2.3, 3.9, 6.1], decay: rnd(0.05, 0.25), fm: Math.random() < 0.3 ? 2 : 0 });
      else if (r < 0.75) nz(e, far, t, { f: rnd(3000, 6000), ft: 'highpass', v: 0.12, a: 0.05, hold: rnd(0.5, 1.5), dur: rnd(1, 2.2) });
      else if (r < 0.9) { for (let i = 0; i < 3; i++) thump(e, far, t + i * 0.42, 70, 40, 0.06, 0.35); }
      else SFX.hookChain(e, e.gain(0.25, far), t, rnd(0.8, 1.1));
      return rnd(0.8, 3.2);
    },
  },
  // Night exterior: crickets, distant traffic swell, soft air, the odd far-away siren.
  night: {
    big: 0.15,
    start(a) {
      const e = a.e;
      const tr = e.gain(0.3, a.out);
      ambLoop(a, 'brown', e.filt('lowpass', 380, 0.7, tr));
      ambLfo(a, 0.04, 0.15, tr.gain);
      ambLoop(a, 'pink2', e.filt('bandpass', 900, 0.6, e.gain(0.05, a.out)));
    },
    event(a, t) {
      const e = a.e, p = e.pan(rnd(-1, 1), a.out), f = rnd(4200, 4900), n = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) tone(e, p, t + i * 0.034, { f, v: 0.05, a: 0.004, d: 0.008, dur: 0.03 });
      if (Math.random() < 0.012) sirenFar(e, e.gain(0.6, a.out), t, 6, 0.8);
      return rnd(0.15, 0.9);
    },
  },
};

class Ambience {
  constructor(e, name, def, t, fade) {
    this.e = e; this.name = name; this.def = def; this.t0 = t;
    this.out = e.gain(0, e.ambBus);
    this.out.gain.setValueAtTime(0, t); this.out.gain.linearRampToValueAtTime(1, t + Math.max(0.05, fade));
    this.out.connect(e.gain(def.big ?? 0.15, e.bigIn));
    this.srcs = []; this.next = t + 0.2; this.stopAt = Infinity;
    def.start(this);
  }
  advance(until) {
    TUNE = 1;
    while (this.next < until && this.next < this.stopAt) this.next += Math.max(0.01, this.def.event(this, this.next));
  }
  stop(t, fade) {
    const g = this.out.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(0, t + Math.max(0.05, fade));
    for (const s of this.srcs) try { s.stop(t + fade + 0.1); } catch (err) { /* already stopped */ }
    this.stopAt = t + fade; this.disposeAt = t + fade + 4;
  }
  dispose() { this.out.disconnect(); }
}

// ---------------------------------------------------------------------------------------
// Engine control surface (wrapped by the `audio` singleton below)
// ---------------------------------------------------------------------------------------
const LOOKAHEAD = 0.12;
Engine.prototype.musicRate = 1;
Engine.prototype.musicPitch = 1;
Engine.prototype.sfxPitch = 1;

Object.assign(Engine.prototype, {
  update() {
    const now = this.ctx.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const ahead = now + (hidden ? 1.2 : LOOKAHEAD);
    if (this.track) this.track.advance(ahead);
    this.oldTracks = this.oldTracks.filter((tr) => {
      if (now > tr.disposeAt) { tr.dispose(); return false; }
      tr.advance(ahead); return true;
    });
    if (this.amb) this.amb.advance(ahead);
    this.oldAmb = this.oldAmb.filter((a) => { if (now > a.disposeAt) { a.dispose(); return false; } return true; });
    while (this.beatQueue.length && this.beatQueue[0][0] <= now + 0.005) {
      const [, beat, bar] = this.beatQueue.shift();
      for (const cb of this.beatCbs) { try { cb(beat, bar); } catch (err) { console.error('audio: onBeat callback', err); } }
    }
    this.pruneVoices(now);
  },

  // opts.bar (optional) starts the arrangement at that bar (skips intros / for tests)
  playMusic(name, { fade = 1.5, bar = 0 } = {}) {
    const song = SONGS[name];
    if (!song) { console.warn('audio: unknown track', name); return; }
    const cur = this.track;
    if (cur && cur.name === name && !cur.ended) return;
    const t = this.ctx.currentTime + 0.05;
    if (cur) { cur.fadeOut(t, fade); this.oldTracks.push(cur); }
    this.beatQueue.length = 0;
    // stings hit immediately; a track starting from silence fades in quickly
    const fadeIn = song.loop == null ? 0 : cur ? fade : Math.min(fade, 0.25);
    this.track = new Track(this, name, song, t, fadeIn, bar);
    this.track.advance(t + LOOKAHEAD);
  },
  stopMusic(fade = 1.5) {
    if (!this.track) return;
    this.track.fadeOut(this.ctx.currentTime, fade);
    this.oldTracks.push(this.track);
    this.track = null;
    this.beatQueue.length = 0;
  },
  setMusicIntensity(x) { this.intensity = clamp(+x || 0); if (this.track) this.track.setIntensity(this.intensity); },
  musicTime() { return this.track ? Math.max(0, this.ctx.currentTime - this.track.t0) : 0; },

  sfx(name, o = {}) {
    const fn = SFX[name];
    if (!fn) { console.warn('audio: unknown sfx', name); return; }
    const now = this.ctx.currentTime, t = now + 0.004;
    const cfg = SFX_CFG[name] || {};
    this.pruneVoices(now);
    const live = this.voices.filter((v) => !v.killed);
    const same = live.filter((v) => v.name === name);
    if (same.length >= (cfg.lim ?? 4)) this.killVoice(same[0], now);
    if (live.length >= MAX_VOICES) this.killVoice(live[0], now);
    let pan = +o.pan || 0, vol = o.volume ?? 1;
    if (o.x != null) {
      const dx = o.x - this.listenerX;
      pan = clamp(dx / 15, -1, 1);
      vol *= 1 / (1 + Math.max(0, Math.abs(dx) - 12) / 14);
    }
    const g = this.gain(clamp(vol, 0, 4)), pn = this.pan(pan, this.sfxBus);
    g.connect(pn);
    const room = cfg.room ?? 0.12, big = cfg.big ?? 0;
    if (room) pn.connect(this.gain(room, this.roomIn));
    if (big) pn.connect(this.gain(big, this.bigIn));
    const pitch = (o.pitch ?? 1) * this.sfxPitch * (cfg.v ? rnd(1 - cfg.v, 1 + cfg.v) : 1);
    let dur = 1;
    TUNE = 1;
    try { dur = fn(this, g, t, pitch, o) || 1; } catch (err) { console.error('audio: sfx ' + name, err); }
    this.voices.push({ name, g, pn, end: t + dur + 0.5 });
    return dur;
  },
  killVoice(v, now) {
    if (!v) return;
    const gg = v.g.gain;
    if (gg.cancelAndHoldAtTime) gg.cancelAndHoldAtTime(now); else { gg.cancelScheduledValues(now); gg.setValueAtTime(gg.value, now); }
    gg.linearRampToValueAtTime(0, now + 0.03);
    v.end = now + 0.08; v.killed = true;
  },
  pruneVoices(now) {
    if (this.offline) return;
    this.voices = this.voices.filter((v) => {
      if (v.end > now) return true;
      v.g.disconnect(); v.pn.disconnect(); return false;
    });
  },

  setAmbience(name, { fade = 2 } = {}) {
    const cur = this.amb ? this.amb.name : null;
    if ((name || null) === cur) return;
    const t = this.ctx.currentTime + 0.02;
    if (this.amb) { this.amb.stop(t, fade); this.oldAmb.push(this.amb); this.amb = null; }
    if (!name) return;
    const def = AMB[name];
    if (!def) { console.warn('audio: unknown ambience', name); return; }
    this.amb = new Ambience(this, name, def, t, fade);
    this.amb.advance(t + LOOKAHEAD);
  },

  // Rolling thunder: near = sharp crack + sub + bright rumble; far = delayed, dark, soft.
  thunder(distance = 0.5) {
    const d = clamp(distance);
    const t = this.ctx.currentTime + 0.05 + d * 1.6;
    const out = this.gain(lerp(1.1, 0.4, d), this.ambBus);
    out.connect(this.gain(0.5, this.bigIn));
    const pn = this.pan(rnd(-0.5, 0.5), out);
    if (d < 0.65) {
      const k = (0.65 - d) / 0.65;
      nz(this, pn, t, { f: 1200, ft: 'highpass', v: 1.2 * k, d: 0.06 });
      for (let i = 0; i < 10; i++) nz(this, pn, t + rnd(0, 0.35), { f: rnd(1500, 5000), q: 1.2, v: rnd(0.2, 0.6) * k, d: 0.01 });
      thump(this, pn, t, 70, 28, 0.6, 0.9 * k);
    }
    const dur = lerp(4.5, 7, d);
    const g = this.gain(0, pn);
    const lp = this.filt('lowpass', lerp(1100, 260, d), 0.8, g);
    lp.frequency.setValueAtTime(lerp(1600, 380, d), t); lp.frequency.exponentialRampToValueAtTime(lerp(300, 120, d), t + dur);
    this.noise('brown', t, dur + 0.1, lp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.1, t + lerp(0.03, 0.7, d));
    const bumps = 4 + (Math.random() * 4 | 0);
    for (let i = 1; i <= bumps; i++) {
      const tt = t + (i / (bumps + 1)) * dur * 0.8;
      g.gain.setTargetAtTime(rnd(0.35, 1) * (1 - i / (bumps + 2)) * 1.1, tt, 0.18);
    }
    g.gain.setTargetAtTime(0, t + dur * 0.8, dur * 0.08);
    setTimeout(() => out.disconnect(), (dur + 4 + d * 2) * 1000);
    return dur;
  },

  duck(amount = 0.5, time = 0.6) {
    const g = this.musicDuck.gain, t = this.ctx.currentTime, lo = 1 - clamp(amount);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(lo, t + 0.04);
    g.setValueAtTime(lo, t + 0.04 + time);
    g.linearRampToValueAtTime(1, t + 0.04 + time + 0.9);
  },
  setSlowMo(f) {
    f = clamp(+f || 1, 0.1, 1);
    this.slow = f;
    const t = this.ctx.currentTime;
    this.slowLP.frequency.setTargetAtTime(f >= 0.999 ? this.maxF : 500 + 9000 * f * f, t, 0.12);
    this.musicRate = this.musicPitch = lerp(0.62, 1, (f - 0.1) / 0.9);
    this.sfxPitch = 0.6 + 0.4 * f;
  },
  setMuffle(f) {
    f = clamp(+f || 0);
    this.muffle.frequency.setTargetAtTime(this.maxF * Math.pow(320 / this.maxF, f), this.ctx.currentTime, 0.06);
  },
  setVolumes(v) {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0.85 * v.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(0.34 * v.music, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(0.8 * v.sfx, t, 0.03);
    this.ambBus.gain.setTargetAtTime(0.35 * v.sfx, t, 0.03);
  },
});

// ---------------------------------------------------------------------------------------
// Public singleton
// ---------------------------------------------------------------------------------------
let ctx = null, engine = null, timer = null;
const state = {
  vol: { master: 1, music: 1, sfx: 1 }, intensity: 0.5, listenerX: 0, slow: 1, muffle: 0,
  pendingMusic: null, pendingAmb: undefined, beatCbs: new Set(),
};
function flush() {
  if (!engine || ctx.state !== 'running') return;
  if (state.pendingMusic) { const [n, o] = state.pendingMusic; state.pendingMusic = null; engine.playMusic(n, o); }
  if (state.pendingAmb !== undefined) { const [n, o] = state.pendingAmb; state.pendingAmb = undefined; engine.setAmbience(n, o); }
}

export const audio = {
  init() {
    if (ctx) return this;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return this;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) { console.warn('audio: no AudioContext', err); ctx = null; return this; }
    engine = new Engine(ctx);
    engine.beatCbs = state.beatCbs;
    engine.intensity = state.intensity;
    engine.listenerX = state.listenerX;
    engine.setVolumes(state.vol);
    if (state.slow !== 1) engine.setSlowMo(state.slow);
    if (state.muffle) engine.setMuffle(state.muffle);
    timer = setInterval(() => { if (ctx.state === 'running') { flush(); engine.update(); } }, 25);
    ctx.addEventListener?.('statechange', flush);
    return this;
  },
  unlock() {
    this.init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().then(flush).catch(() => {});
    try { // iOS-style unlock: play one silent sample inside the gesture
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start();
    } catch (err) { /* ignore */ }
    flush();
  },
  get ready() { return !!ctx && ctx.state === 'running'; },

  setMasterVolume(v) { state.vol.master = clamp(+v); engine?.setVolumes(state.vol); },
  setMusicVolume(v) { state.vol.music = clamp(+v); engine?.setVolumes(state.vol); },
  setSfxVolume(v) { state.vol.sfx = clamp(+v); engine?.setVolumes(state.vol); },

  playMusic(name, { fade = 1.5 } = {}) {
    this.init();
    if (this.ready) engine.playMusic(name, { fade }); else state.pendingMusic = [name, { fade }];
  },
  stopMusic(fade = 1.5) { state.pendingMusic = null; if (this.ready) engine.stopMusic(fade); },
  setMusicIntensity(x) { state.intensity = clamp(+x || 0); engine?.setMusicIntensity(state.intensity); },
  musicTime() { return this.ready ? engine.musicTime() : 0; },
  onBeat(cb) { state.beatCbs.add(cb); return () => state.beatCbs.delete(cb); },

  sfx(name, { pan = 0, volume = 1, pitch = 1, x = null, ...rest } = {}) {
    if (!this.ready) return;
    try { engine.sfx(name, { pan, volume, pitch, x, ...rest }); } catch (err) { console.error('audio: sfx', name, err); }
  },
  setListenerX(x) { state.listenerX = +x || 0; if (engine) engine.listenerX = state.listenerX; },
  setAmbience(name, { fade = 2 } = {}) {
    this.init();
    if (this.ready) engine.setAmbience(name, { fade }); else state.pendingAmb = [name, { fade }];
  },
  thunder(distance = 0.5) { if (this.ready) engine.thunder(distance); },
  duck(amount = 0.5, time = 0.6) { if (this.ready) engine.duck(amount, time); },
  setSlowMo(f) { state.slow = clamp(+f || 1, 0.1, 1); engine?.setSlowMo(state.slow); },
  setMuffle(f) { state.muffle = clamp(+f || 0); engine?.setMuffle(state.muffle); },
};
export default audio;

// Catalogue (for tools / tests)
export const TRACKS = Object.keys(SONGS);
export const SFX_NAMES = Object.keys(SFX);
export const AMBIENCES = Object.keys(AMB);

// Renders one item into an OfflineAudioContext with the exact same engine code and returns
// { peak, rms, activeDur, nan, buffer }. kind: 'sfx' | 'music' | 'amb' | 'thunder'.
export async function renderOffline(kind, name, seconds, opts = {}) {
  const sr = opts.sampleRate || 44100;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const octx = new OAC(2, Math.ceil(sr * seconds), sr);
  const e = new Engine(octx, { offline: true });
  e.setVolumes({ master: 1, music: 1, sfx: 1 });
  if (opts.intensity != null) e.intensity = opts.intensity;
  if (kind === 'sfx') e.sfx(name, opts);
  else if (kind === 'music') {
    if (!SONGS[name]) throw new Error('unknown track ' + name);
    e.track = new Track(e, name, SONGS[name], 0.02, 0, opts.bar || 0);
    for (const c of opts.mute || []) delete e.track.ch[c];
    if (opts.solo) for (const c of Object.keys(e.track.ch)) if (!opts.solo.includes(c)) delete e.track.ch[c];
    e.track.advance(seconds);
  }
  else if (kind === 'amb') { e.setAmbience(name, { fade: 0.1 }); e.amb.advance(seconds); }
  else if (kind === 'thunder') e.thunder(opts.distance ?? 0.3);
  const buffer = await octx.startRendering();
  let peak = 0, sum = 0, last = 0, nan = false;
  const n = buffer.length;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (v !== v) { nan = true; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      if (a > 0.001 && i > last) last = i;
    }
  }
  return { peak, rms: Math.sqrt(sum / (n * buffer.numberOfChannels)), activeDur: last / sr, nan, buffer };
}
// Mixer channel definitions of a track (used by the test page's per-channel profiler).
export const SONG_MIX = (name) => (SONGS[name] ? SONGS[name].mix : {});
