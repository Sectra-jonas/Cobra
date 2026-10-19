// Fail-safe facade over the procedural audio engine. Game code calls `sound.sfx(...)`
// etc.; if audio.js fails to load (or before it loads), calls are silently dropped.
let impl = null;
const pending = [];

import('./audio.js')
  .then((m) => {
    impl = m.audio || m.default;
    impl.init?.();
    for (const [k, args] of pending.splice(0)) impl[k]?.(...args);
  })
  .catch((e) => console.warn('[cobra] audio unavailable:', e));

const QUEUEABLE = new Set(['setMasterVolume', 'setMusicVolume', 'setSfxVolume', 'unlock', 'playMusic', 'setAmbience']);

export const sound = new Proxy({}, {
  get(_, key) {
    if (key === 'ready') return !!(impl && impl.ready);
    if (key === 'loaded') return !!impl;
    return (...args) => {
      if (impl && typeof impl[key] === 'function') {
        try { return impl[key](...args); } catch (e) { console.warn('[cobra] audio error', key, e); }
      } else if (!impl && QUEUEABLE.has(key)) {
        pending.push([key, args]);
      }
      return undefined;
    };
  },
});
