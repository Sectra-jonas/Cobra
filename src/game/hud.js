// DOM HUD overlay. Layout echoes the C64 original (cobra-head lives, weapon tray,
// burger energy, big score) restyled as an 80s action-movie VHS overlay.
const ICONS = {
  cobra: `<svg viewBox="0 0 32 32"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dff8a"/><stop offset="1" stop-color="#1f7a31"/></linearGradient></defs>
    <path d="M16 2c-7 0-12 5-11 12 1 5 5 7 7 11l1 5h6l1-5c2-4 6-6 7-11 1-7-4-12-11-12z" fill="url(#cg)" stroke="#06240d" stroke-width="1.2"/>
    <path d="M16 7c-3 0-5 2-5 5 0 2 2 4 5 5 3-1 5-3 5-5 0-3-2-5-5-5z" fill="#0d3d18" opacity=".55"/>
    <ellipse cx="12.5" cy="11" rx="1.6" ry="2.2" fill="#ffe14d"/><ellipse cx="19.5" cy="11" rx="1.6" ry="2.2" fill="#ffe14d"/>
    <ellipse cx="12.5" cy="11.3" rx=".55" ry="1.6" fill="#111"/><ellipse cx="19.5" cy="11.3" rx=".55" ry="1.6" fill="#111"/>
    <path d="M16 18v4m0 0l-1.5 2m1.5-2l1.5 2" stroke="#ff3b4a" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`,
  headbutt: `<svg viewBox="0 0 32 32"><path d="M7 13c0-3 2-5 5-5h9c3 0 5 2 5 5v6c0 4-3 7-7 7h-5c-4 0-7-3-7-7z" fill="currentColor"/><path d="M12 8v6M16 8v6M20 8v6M7 16h5" stroke="#000" stroke-opacity=".35" stroke-width="1.4"/></svg>`,
  knife: `<svg viewBox="0 0 32 32"><path d="M4 21L22 9c3-2 6-1 6 1L9 25z" fill="currentColor"/><rect x="2" y="21" width="9" height="4" rx="1.5" transform="rotate(-33 6 23)" fill="currentColor" opacity=".6"/></svg>`,
  pistol: `<svg viewBox="0 0 32 32"><path d="M3 10h25v5H15l-1 2h-3l-2 9H4l2-9H3z" fill="currentColor"/><rect x="25" y="8" width="2" height="2" fill="currentColor"/></svg>`,
  smg: `<svg viewBox="0 0 32 32"><path d="M2 11h22l3-2h3v6h-6l-3 3h-4l-1 8h-4l1-8H9l-1 4H5l1-6H2z" fill="currentColor"/><path d="M24 16h7" stroke="#ff2e2e" stroke-width="1.5"/></svg>`,
  pill: `<svg viewBox="0 0 32 32"><g transform="rotate(-35 16 16)"><rect x="5" y="11" width="22" height="10" rx="5" fill="currentColor" opacity=".55"/><path d="M16 11h6a5 5 0 010 10h-6z" fill="currentColor"/></g></svg>`,
  duck: `<svg viewBox="0 0 32 32"><path d="M20 6a6 6 0 00-5 9c-5-1-11 1-12 6 0 5 5 8 12 8 8 0 13-3 13-8 0-3-2-5-4-6a6 6 0 00-4-9z" fill="#ffd21f" stroke="#7a5a00" stroke-width="1"/><path d="M25 11l6 1-6 2z" fill="#ff7a1a"/><circle cx="21.5" cy="10" r="1.3" fill="#111"/></svg>`,
  burger: `<svg viewBox="0 0 32 32"><path d="M4 14C4 7 9 4 16 4s12 3 12 10z" fill="#d98a32"/><g fill="#fff3c8"><ellipse cx="11" cy="8" rx="1" ry=".5"/><ellipse cx="17" cy="7" rx="1" ry=".5"/><ellipse cx="22" cy="10" rx="1" ry=".5"/><ellipse cx="14" cy="11" rx="1" ry=".5"/></g><path d="M3 15c2 2 4-1 6 1s4-1 6 1 4-1 6 1 4-1 8 0v2H3z" fill="#4fbf36"/><rect x="3" y="18" width="26" height="3" fill="#ffb51f"/><rect x="3" y="20" width="26" height="4" rx="2" fill="#5a2d14"/><path d="M4 24h24c0 3-3 4-6 4H10c-3 0-6-1-6-4z" fill="#e3a050"/></svg>`,
  heart: `<svg viewBox="0 0 32 32"><path d="M16 28C5 20 2 14 4 9c2-5 9-6 12 0 3-6 10-5 12 0 2 5-1 11-12 19z" fill="currentColor"/></svg>`,
  skull: `<svg viewBox="0 0 32 32"><path d="M16 3C9 3 5 8 5 14c0 4 2 6 4 7v5h3v-3h2v3h4v-3h2v3h3v-5c2-1 4-3 4-7 0-6-4-11-11-11z" fill="currentColor"/><circle cx="11.5" cy="14" r="3" fill="#000"/><circle cx="20.5" cy="14" r="3" fill="#000"/><path d="M15 18h2l-1 2z" fill="#000"/></svg>`,
  grenade: `<svg viewBox="0 0 32 32"><ellipse cx="15" cy="19" rx="8" ry="9" fill="currentColor"/><rect x="12" y="6" width="7" height="5" fill="currentColor" opacity=".7"/><path d="M19 8c4 0 6 2 6 5" stroke="currentColor" stroke-width="2" fill="none"/></svg>`,
};

const CSS = `
#hud { position: absolute; inset: 0; pointer-events: none; font-family: 'Teko', 'Arial Narrow', 'Roboto Condensed', sans-serif; color: var(--hud-fg); z-index: 5; }
#hud.hidden { opacity: 0; }
#hud { transition: opacity .6s; }
.hud-bottom { position: absolute; left: max(18px, env(safe-area-inset-left)); right: max(18px, env(safe-area-inset-right)); bottom: calc(14px + env(safe-area-inset-bottom)); display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
.panel { position: relative; background: linear-gradient(180deg, rgba(12,14,24,.78), rgba(6,7,12,.86)); border: 1px solid rgba(120,200,255,.18); box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 8px 30px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06); transform: skewX(-12deg); padding: 6px 14px; border-radius: 3px; will-change: transform; }
.panel > .in { transform: skewX(12deg); display: flex; align-items: center; gap: 10px; will-change: transform; }
.panel::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, var(--neon-a), var(--neon-b)); opacity: .9; }
.lives svg { width: 34px; height: 34px; filter: drop-shadow(0 0 6px rgba(80,255,120,.45)); transition: transform .3s, opacity .3s; }
.lives .lost { opacity: .12; transform: scale(.8); filter: grayscale(1); }
.nade { display: flex; align-items: center; gap: 2px; font-size: 24px; color: #c7d68a; margin-left: 6px; }
.nade svg { width: 22px; height: 22px; }
.tray { display: flex; gap: 6px; }
.slot { width: 44px; height: 40px; display: grid; place-items: center; color: #3a3f52; position: relative; border-radius: 3px; background: rgba(255,255,255,.03); transition: color .25s, background .25s; }
.slot svg { width: 30px; height: 30px; }
.slot.owned { color: #9fb4d4; }
.slot.active { color: #fff; background: linear-gradient(180deg, rgba(255,60,140,.28), rgba(255,60,140,.06)); }
.slot.active::after { content: ''; position: absolute; left: 50%; bottom: -5px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #ffe14d; box-shadow: 0 0 8px #ffe14d; }
.slot .key { position: absolute; top: 1px; left: 3px; font-size: 13px; color: rgba(255,255,255,.3); }
.quack { display: flex; align-items: center; gap: 8px; min-width: 190px; }
.quack svg { width: 36px; height: 36px; transition: transform .2s; }
.quack .bar { flex: 1; height: 10px; background: rgba(255,255,255,.08); border-radius: 2px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.quack .fill { height: 100%; width: 100%; background: linear-gradient(90deg, #ff9d1c, #ffe14d); box-shadow: 0 0 10px rgba(255,210,40,.7); transform: scaleX(0); transform-origin: left; transition: transform .15s linear; will-change: transform; }
.quack.low .fill { background: linear-gradient(90deg, #ff2b4a, #ff7a1a); animation: blink .4s steps(2) infinite; }
.quack .lbl { font-size: 16px; letter-spacing: .12em; color: rgba(255,255,255,.55); position: absolute; top: -18px; left: 56px; }
.quack.empty { opacity: .45; }
.health { display: flex; align-items: center; gap: 10px; }
.burgerhp { width: 52px; height: 52px; position: relative; }
.burgerhp svg { width: 52px; height: 52px; position: absolute; inset: 0; transition: clip-path .25s; filter: drop-shadow(0 0 6px rgba(255,170,60,.35)); }
#h-burger { position: absolute; inset: 0; will-change: transform; }
.burgerhp .ghost { opacity: .12; filter: grayscale(1); }
.hpnum { font-size: 34px; line-height: .8; font-weight: 600; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
.hpnum small { display: block; font-size: 14px; letter-spacing: .2em; color: rgba(255,255,255,.45); }
.score { position: absolute; right: max(22px, env(safe-area-inset-right)); top: calc(12px + env(safe-area-inset-top)); text-align: right; }
.score .digits { will-change: transform; font-size: 56px; line-height: .85; font-weight: 600; letter-spacing: .06em; font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #ffffff 0%, #d9e6ff 45%, #6f7fa8 50%, #e8f0ff 56%, #9fb0d6 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(0,0,0,.6)) drop-shadow(0 0 12px rgba(120,170,255,.35)); }
.score .hi { font-size: 18px; letter-spacing: .25em; color: rgba(255,255,255,.5); }
.combo { position: absolute; right: 0; top: 66px; font-size: 34px; color: #ff4fa0; text-shadow: 0 0 12px #ff2b8a; opacity: 0; transform: scale(.6); transition: opacity .2s, transform .2s; }
.combo.on { opacity: 1; transform: scale(1); }
.obj { position: absolute; left: max(20px, env(safe-area-inset-left)); top: calc(14px + env(safe-area-inset-top)); display: flex; flex-direction: column; gap: 6px; }
.obj .lvl { font-size: 18px; letter-spacing: .3em; color: rgba(255,255,255,.55); }
.obj .row { display: flex; align-items: center; gap: 8px; font-size: 22px; line-height: 1; }
.obj .bslot { width: 26px; height: 26px; opacity: .2; filter: grayscale(1); transition: all .3s; }
.obj .bslot.got { opacity: 1; filter: none; transform: scale(1.05); }
.obj .ingrid svg { width: 22px; height: 22px; color: #4a4050; transition: color .3s; }
.obj .ingrid.on svg { color: #ff5fa2; filter: drop-shadow(0 0 6px #ff5fa2); }
.obj .ingrid.on span { color: #ffd2e6; }
.obj .kills svg { width: 22px; height: 22px; color: #c8ccd8; }
.obj .kbar { width: 120px; height: 6px; background: rgba(255,255,255,.1); border-radius: 2px; overflow: hidden; }
.obj .kbar i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #39d0ff, #b46bff); transform: scaleX(0); transform-origin: left; transition: transform .3s; will-change: transform; }
.obj .done { color: #7dff8a; }
.boss { position: absolute; left: 50%; top: calc(18px + env(safe-area-inset-top)); width: min(560px, 70vw); transform: translateX(-50%); text-align: center; display: none; }
.boss.on { display: block; animation: drop .6s cubic-bezier(.2,1.4,.4,1); }
.boss .name { font-size: 26px; letter-spacing: .35em; color: #ff3b4a; text-shadow: 0 0 14px rgba(255,40,60,.7); }
.boss .bbar { height: 12px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,60,80,.4); transform: skewX(-12deg); overflow: hidden; }
.boss .bbar i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #7a0010, #ff2b3b, #ff8a8a); box-shadow: 0 0 14px #ff2b3b; transform-origin: left; transition: transform .2s; will-change: transform; }
.banner { position: absolute; left: 0; right: 0; top: 30%; text-align: center; opacity: 0; transition: opacity .35s, transform .35s; transform: scale(1.15); }
.banner.on { opacity: 1; transform: scale(1); }
.banner .t { font-size: clamp(42px, 7vw, 92px); line-height: .9; font-weight: 700; letter-spacing: .04em;
  background: linear-gradient(180deg, #fff 0%, #ffe6f3 40%, #ff3d9a 52%, #ffb0d8 70%, #ffffff 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 3px 0 #2a0016) drop-shadow(0 0 24px rgba(255,40,140,.55)); }
.banner .s { font-size: clamp(18px, 2.2vw, 28px); letter-spacing: .25em; color: #bfe7ff; text-shadow: 0 0 12px rgba(60,180,255,.7); margin-top: 6px; }
.loc { position: absolute; left: max(28px, env(safe-area-inset-left)); bottom: calc(110px + env(safe-area-inset-bottom)); font-family: var(--font-type); font-size: clamp(16px, 1.7vw, 24px); letter-spacing: .14em; color: #f1ece2; text-shadow: 0 2px 8px rgba(0,0,0,.9); opacity: 0; transition: opacity .8s; white-space: nowrap; }
.loc.on { opacity: 1; }
.loc small { display: block; font-size: .7em; letter-spacing: .3em; color: #ff5a6a; margin-top: 4px; }
.toast { position: absolute; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom)); transform: translateX(-50%); font-size: 24px; letter-spacing: .2em; color: #fff; text-shadow: 0 0 10px rgba(0,0,0,.9), 0 0 18px rgba(80,180,255,.6); opacity: 0; transition: opacity .3s; white-space: nowrap; }
.toast.on { opacity: 1; }
.pop { position: absolute; font-size: 26px; font-weight: 600; color: #fff; text-shadow: 0 0 8px rgba(255,60,160,.9), 0 2px 0 #000; transform: translate(-50%, -50%); animation: pop 1s ease-out forwards; white-space: nowrap; }
.pop.neg { color: #ff6060; }
.arrow { position: absolute; left: 0; top: 0; width: 0; height: 0; display: none; will-change: transform; }
.arrow.on { display: block; }
.arrow b { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; display: grid; place-items: center; color: #ff5fa2; filter: drop-shadow(0 0 8px #ff5fa2); animation: pulse 1s infinite; }
.arrow b svg { width: 26px; height: 26px; }
.arrow.exit b { color: #7dff8a; filter: drop-shadow(0 0 8px #7dff8a); }
.arrow.burger b { color: #ffb347; filter: drop-shadow(0 0 8px #ffb347); }
@keyframes pop { 0% { opacity: 0; transform: translate(-50%, -30%) scale(.6); } 15% { opacity: 1; transform: translate(-50%, -60%) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -160%) scale(1); } }
@keyframes blink { 50% { opacity: .35; } }
@keyframes drop { from { transform: translate(-50%, -40px); opacity: 0; } }
@keyframes pulse { 50% { transform: scale(1.25); } }
@media (max-width: 760px) {
  .quack { min-width: 120px; } .slot { width: 34px; height: 32px; } .slot svg { width: 24px; height: 24px; }
  .score .digits { font-size: 40px; } .lives svg { width: 26px; height: 26px; } .burgerhp, .burgerhp svg { width: 40px; height: 40px; }
  .hud-bottom { flex-wrap: wrap; justify-content: center; bottom: calc(150px + env(safe-area-inset-bottom)); }
  .obj .lvl { display: none; }
}
@media (prefers-reduced-motion: reduce) { .pop, .boss.on { animation: none; } }
`;

export class HUD {
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'hud';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="obj">
        <div class="lvl" id="h-level">LEVEL 1 — THE CITY</div>
        <div class="row burgers">${['knife', 'pistol', 'smg', 'pill'].map((w) => `<span class="bslot" data-w="${w}">${ICONS.burger}</span>`).join('')}</div>
        <div class="row ingrid"><span>${ICONS.heart}</span><span id="h-ingrid">INGRID — MISSING</span></div>
        <div class="row kills"><span>${ICONS.skull}</span><span class="kbar"><i id="h-kbar"></i></span><span id="h-kills">0/30</span></div>
      </div>
      <div class="score"><div class="digits" id="h-score">000000</div><div class="hi" id="h-hi">HI 050000</div><div class="combo" id="h-combo">x2</div></div>
      <div class="boss" id="h-boss"><div class="name" id="h-bossname">THE NIGHT SLASHER</div><div class="bbar"><i id="h-bossbar"></i></div></div>
      <div class="banner" id="h-banner"><div class="t" id="h-bt"></div><div class="s" id="h-bs"></div></div>
      <div class="toast" id="h-toast"></div>
      <div class="loc" id="h-loc"></div>
      <div class="arrow" id="h-arrow"><b>${ICONS.heart}</b></div>
      <div class="hud-bottom">
        <div class="panel"><div class="in"><div class="lives" id="h-lives"></div><div class="nade" id="h-nade">${ICONS.grenade}<span>3</span></div></div></div>
        <div class="panel"><div class="in">
          <div class="tray" id="h-tray">${['headbutt', 'knife', 'pistol', 'smg', 'pill'].map((w) => `<div class="slot" data-w="${w}">${ICONS[w]}</div>`).join('')}</div>
          <div class="quack empty" id="h-quack">${ICONS.duck}<div class="bar"><div class="fill" id="h-qfill"></div></div></div>
        </div></div>
        <div class="panel"><div class="in health">
          <div class="burgerhp"><span class="ghost">${ICONS.burger}</span><span id="h-burger">${ICONS.burger}</span></div>
          <div class="hpnum"><span id="h-hp">100</span><small>ENERGY</small></div>
        </div></div>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.$ = (id) => el.querySelector('#' + id);
    this.cache = {};
    this.bannerT = 0;
    this.toastT = 0;
    this.comboT = 0;
    this.lastLives = -1;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  // The first paint of the HUD makes the browser compile its raster shaders (blurred shadows,
  // drop-shadow filters, gradient text) on the GPU thread: ~150 ms that used to land on the
  // first frames of play. Paint everything once, 1% opaque over the boot screen, while loading.
  prime(ms = 600) {
    const el = this.el, banner = this.$('h-banner'), toast = this.$('h-toast');
    this.$('h-bt').textContent = 'COBRA';
    this.$('h-bs').textContent = 'NIGHT';
    toast.textContent = 'CHECKPOINT';
    el.classList.remove('hidden');
    for (const e of [el, banner, toast]) e.style.transition = 'none';
    banner.classList.add('on');
    toast.classList.add('on');
    Object.assign(el.style, { opacity: '0.01', zIndex: '60' });
    setTimeout(() => {
      banner.classList.remove('on');
      toast.classList.remove('on');
      el.classList.add('hidden');
      Object.assign(el.style, { opacity: '', zIndex: '' });
      requestAnimationFrame(() => { for (const e of [el, banner, toast]) e.style.transition = ''; });
    }, ms);
  }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  update(dt, s) {
    // s: { score, hi, lives, grenades, weapon, owned:Set, quack, pill, hp, burgers:Set, ingrid, kills, quota, level, combo }
    this.set('score', s.score, (v) => { this.$('h-score').textContent = String(Math.max(0, v)).padStart(6, '0'); });
    this.set('hi', s.hi, (v) => { this.$('h-hi').textContent = 'HI ' + String(v).padStart(6, '0'); });
    this.set('lives', s.lives, (v) => {
      const n = Math.max(3, v);
      this.$('h-lives').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < v ? '' : 'lost'}">${ICONS.cobra}</span>`).join('');
    });
    this.set('nade', s.grenades, (v) => { this.$('h-nade').querySelector('span').textContent = v; });
    const trayKey = s.weapon + [...s.owned].join() + (s.pill > 0 ? 'P' : '');
    this.set('tray', trayKey, () => {
      for (const sl of this.$('h-tray').children) {
        const w = sl.dataset.w;
        sl.classList.toggle('owned', w === 'headbutt' || s.owned.has(w));
        sl.classList.toggle('active', w === s.weapon || (w === 'pill' && s.pill > 0));
      }
    });
    const q = s.pill > 0 ? s.pill / 10 : s.quack;
    const qk = Math.round(q * 200);
    this.set('quack', qk, () => {
      this.$('h-qfill').style.transform = `scaleX(${Math.min(1, Math.max(0, q))})`;
      const qe = this.$('h-quack');
      qe.classList.toggle('low', q > 0 && q < 0.25);
      qe.classList.toggle('empty', q <= 0);
    });
    const hp = Math.max(0, Math.round(s.hp));
    this.set('hp', hp, (v) => {
      this.$('h-hp').textContent = v;
      // the burger gets eaten from the right as energy drops
      this.$('h-burger').querySelector('svg').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    });
    this.set('burgers', [...s.burgers].join(), () => {
      for (const b of this.el.querySelectorAll('.bslot')) b.classList.toggle('got', s.burgers.has(b.dataset.w));
    });
    this.set('ingrid', s.ingrid, (v) => {
      const row = this.el.querySelector('.obj .ingrid');
      row.classList.toggle('on', v === 'following');
      this.$('h-ingrid').textContent = { hidden: 'INGRID — MISSING', waiting: 'INGRID — NEEDS YOU', following: 'INGRID — SAFE WITH YOU', carried: 'INGRID — KIDNAPPED!', fleeing: 'INGRID — RUNNING', gone: 'INGRID — TAKEN AWAY', hiding: 'INGRID — HIDING' }[v] || v;
    });
    this.set('kills', `${s.kills}/${s.quota}`, () => {
      this.$('h-kills').textContent = `${Math.min(s.kills, s.quota)}/${s.quota}`;
      this.$('h-kills').classList.toggle('done', s.kills >= s.quota);
      this.$('h-kbar').style.transform = `scaleX(${Math.min(1, s.kills / s.quota)})`;
    });
    this.set('level', s.level, (v) => { this.$('h-level').textContent = v; });
    this.set('combo', s.combo, (v) => {
      const c = this.$('h-combo');
      c.textContent = `x${v} COMBO`;
      c.classList.toggle('on', v > 1);
    });

    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.$('h-banner').classList.remove('on'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.$('h-toast').classList.remove('on'); }
  }

  banner(title, sub = '', time = 2.5) {
    this.$('h-bt').textContent = title;
    this.$('h-bs').textContent = sub;
    this.$('h-banner').classList.add('on');
    this.bannerT = time;
  }

  // Typed location caption ("LOS ANGELES · 11:47 PM") for level starts.
  location(line1, line2 = '') {
    const el = this.$('h-loc');
    el.classList.add('on');
    let i = 0;
    const full = line1;
    clearInterval(this.locTimer);
    this.locTimer = setInterval(() => {
      i++;
      el.innerHTML = full.slice(0, i) + (line2 && i >= full.length ? `<small>${line2}</small>` : '');
      if (i >= full.length) {
        clearInterval(this.locTimer);
        setTimeout(() => el.classList.remove('on'), 3200);
      }
    }, 45);
  }

  toast(text, time = 2) {
    const t = this.$('h-toast');
    t.textContent = text;
    t.classList.add('on');
    this.toastT = time;
  }

  popup(x, y, text, neg = false) {
    const p = document.createElement('div');
    p.className = 'pop' + (neg ? ' neg' : '');
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.el.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }

  boss(name, frac) {
    const b = this.$('h-boss');
    if (name === null) { b.classList.remove('on'); return; }
    b.classList.add('on');
    this.$('h-bossname').textContent = name;
    this.$('h-bossbar').style.transform = `scaleX(${Math.min(1, Math.max(0, frac))})`;
  }

  // Off-screen pointer toward a world target (already projected to screen space).
  arrow(kind, sx, sy, w, h) {
    const a = this.$('h-arrow');
    if (!kind) { if (this.arrowKind) { a.classList.remove('on'); this.arrowKind = null; } return; }
    if (this.arrowKind !== kind) {
      this.arrowKind = kind;
      a.className = `arrow on ${kind}`;
      a.querySelector('b').innerHTML = kind === 'exit' ? '▶' : kind === 'burger' ? ICONS.burger : ICONS.heart;
    }
    const m = 46;
    a.style.transform = `translate(${Math.round(Math.min(w - m, Math.max(m, sx)))}px, ${Math.round(Math.min(h - 140, Math.max(m + 70, sy)))}px)`;
  }
}

export { ICONS };
