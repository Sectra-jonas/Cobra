// Unified input: keyboard, gamepad (standard mapping) and on-screen touch controls.
// Game code reads actions only: input.down('fire'), input.pressed('jump'), input.axisX().

const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space'],  // "up" also jumps (joystick-style) unless a ladder is in reach – see Player
  fire: ['KeyJ', 'KeyZ', 'ControlLeft', 'ControlRight', 'KeyF'],
  grenade: ['KeyK', 'KeyX', 'KeyG'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space', 'KeyJ', 'KeyZ', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  c64: ['F2', 'KeyC'],
  skip: ['Enter', 'Escape', 'Space'],
};

class Input {
  constructor() {
    this.keys = new Set();
    this.latched = new Set(); // taps shorter than a frame still register
    this.prev = new Map();
    this.cur = new Map();
    this.touch = new Map();
    this.anyKeyPressed = false;
    this.lastDevice = 'keyboard';
    this.listeners = [];
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.anyKeyPressed = true;
      this.keys.add(e.code);
      this.latched.add(e.code);
      this.lastDevice = 'keyboard';
      for (const l of this.listeners) l(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => { this.anyKeyPressed = true; });
  }

  onKey(fn) { this.listeners.push(fn); }

  gamepadState() {
    const s = {};
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { /* blocked in sandboxed frames */ }
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const any = p.buttons.some((x) => x.pressed) || Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5;
      if (any) this.lastDevice = 'gamepad';
      s.left = s.left || b(14) || ax < -0.4;
      s.right = s.right || b(15) || ax > 0.4;
      s.up = s.up || b(12) || ay < -0.6;
      s.down = s.down || b(13) || ay > 0.6;
      s.jump = s.jump || b(0);
      s.fire = s.fire || b(2) || b(7) || b(5);
      s.grenade = s.grenade || b(1) || b(6) || b(4);
      s.pause = s.pause || b(9);
      s.confirm = s.confirm || b(0) || b(9);
      s.back = s.back || b(1);
      s.skip = s.skip || b(9) || b(0);
      s.c64 = s.c64 || b(8);
      this.padX = Math.abs(ax) > 0.2 ? ax : (b(14) ? -1 : b(15) ? 1 : 0);
    }
    return s;
  }

  update() {
    const pad = this.gamepadState();
    this.prev = this.cur;
    this.cur = new Map();
    for (const action of Object.keys(KEYMAP)) {
      let v = KEYMAP[action].some((k) => this.keys.has(k) || this.latched.has(k)) || !!pad[action] || !!this.touch.get(action);
      this.cur.set(action, v);
    }
    this.latched.clear();
  }

  down(a) { return !!this.cur.get(a); }
  pressed(a) { return !!this.cur.get(a) && !this.prev.get(a); }
  released(a) { return !this.cur.get(a) && !!this.prev.get(a); }
  axisX() { return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0); }
  consumeAny() { const v = this.anyKeyPressed; this.anyKeyPressed = false; return v; }

  // On-screen controls for touch devices.
  buildTouch(root) {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!coarse && !new URLSearchParams(location.search).has('touch')) return;
    const wrap = document.createElement('div');
    wrap.className = 'touch';
    wrap.innerHTML = `
      <div class="pad">
        <button data-a="up" aria-label="Up">▲</button>
        <button data-a="left" aria-label="Left">◀</button>
        <button data-a="right" aria-label="Right">▶</button>
        <button data-a="down" aria-label="Down">▼</button>
      </div>
      <div class="acts">
        <button data-a="grenade" class="small" aria-label="Grenade">G</button>
        <button data-a="fire" aria-label="Murder">MURDER</button>
        <button data-a="jump" aria-label="Jump">JUMP</button>
      </div>
      <button data-a="pause" class="pausebtn" aria-label="Pause">II</button>`;
    root.appendChild(wrap);
    for (const b of wrap.querySelectorAll('button')) {
      const a = b.dataset.a;
      const on = (e) => { e.preventDefault(); this.touch.set(a, true); if (a === 'jump' || a === 'fire') this.touch.set('confirm', true); this.anyKeyPressed = true; this.lastDevice = 'touch'; };
      const off = (e) => { e.preventDefault(); this.touch.set(a, false); this.touch.set('confirm', false); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
    document.body.classList.add('has-touch');
  }
}

export const input = new Input();
