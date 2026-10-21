// DOM menus: title, pause, level card, game over (+ C64-style name entry), victory.
import { input } from '../core/input.js';
import { sound } from '../core/sound.js';

const CSS = `
.menu { position: absolute; inset: 0; display: grid; place-items: center; z-index: 12; pointer-events: none; opacity: 0; transition: opacity .5s; }
.menu.on { opacity: 1; }
.menu.on .list, .menu.on .card, .menu.on .press, .menu.on .names { pointer-events: auto; }
.menu .list { display: flex; flex-direction: column; gap: 0; align-items: center; margin-top: 40vh; font-family: var(--font-display); }
.menu .item { font-size: clamp(18px, 2.3vw, 28px); line-height: 1.25; letter-spacing: .32em; color: rgba(233,238,251,.6); padding: 1px 26px; position: relative; cursor: pointer; transition: color .15s, transform .15s; background: none; border: 0; font-family: inherit; text-shadow: 0 2px 6px rgba(0,0,0,.9); }
.menu.on:not(.dim)::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent 43%, rgba(3,4,10,.55) 55%, rgba(3,4,10,.78) 78%, rgba(3,4,10,.6) 100%); }
.menu > * { position: relative; }
.menu .item.sel { color: #fff; transform: scale(1.06); text-shadow: 0 0 18px rgba(255,47,142,.8); }
.menu .item.sel::before, .menu .item.sel::after { content: ''; position: absolute; top: 50%; width: 18px; height: 3px; background: var(--neon-a); box-shadow: 0 0 10px var(--neon-a); }
.menu .item.sel::before { left: 0; } .menu .item.sel::after { right: 0; }
.menu .item small { color: var(--neon-b); letter-spacing: .2em; }
.menu .press { margin-top: 36vh; font-size: clamp(20px, 2.6vw, 30px); letter-spacing: .6em; color: #fff; animation: pblink 1.2s steps(2) infinite; text-shadow: 0 0 14px rgba(47,210,255,.8); font-family: var(--font-display); }
@keyframes pblink { 50% { opacity: .15; } }
.menu .foot { position: absolute; left: 0; right: 0; bottom: calc(18px + env(safe-area-inset-bottom)); text-align: center; font-family: var(--font-mono); font-size: 12px; letter-spacing: .25em; color: rgba(255,255,255,.35); padding-inline: 16px; }
.menu .card { min-width: min(560px, 90vw); max-width: 92vw; background: linear-gradient(180deg, rgba(10,12,22,.92), rgba(5,6,12,.95)); border: 1px solid rgba(120,200,255,.2); box-shadow: 0 30px 80px rgba(0,0,0,.6); padding: 26px 34px 30px; position: relative; font-family: var(--font-display); }
.menu .card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: linear-gradient(90deg, var(--neon-a), var(--neon-b)); }
.menu .card h2 { margin: 0 0 6px; font-size: clamp(34px, 5vw, 56px); line-height: 1; letter-spacing: .08em; font-weight: 600; text-wrap: balance;
  background: linear-gradient(180deg, #fff, #ffd2e6 45%, #ff3d9a 55%, #fff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.menu .card .sub { font-size: 18px; letter-spacing: .3em; color: var(--neon-b); margin-bottom: 16px; }
.menu .card table { width: 100%; border-collapse: collapse; font-size: 24px; letter-spacing: .12em; font-variant-numeric: tabular-nums; }
.menu .card td { padding: 3px 0; color: rgba(233,238,251,.75); }
.menu .card td:last-child { text-align: right; color: #fff; }
.menu .card .keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; font-size: 22px; letter-spacing: .1em; }
.menu .card .keys b { color: #fff; font-weight: 500; font-family: var(--font-mono); font-size: 16px; letter-spacing: .05em; background: rgba(255,255,255,.07); padding: 2px 8px; border-radius: 3px; justify-self: start; align-self: center; }
.menu .card .keys span { color: rgba(233,238,251,.7); }
.menu .card p { font-family: 'Teko', sans-serif; font-size: 20px; letter-spacing: .06em; color: rgba(233,238,251,.75); line-height: 1.25; margin: 6px 0; max-width: 60ch; }
.menu .card .hint { margin-top: 18px; font-size: 18px; letter-spacing: .3em; color: rgba(255,255,255,.45); text-align: center; }
.menu .names { margin-top: 10px; font-family: 'Share Tech Mono', monospace; font-size: 20px; color: #9fd8ff; letter-spacing: .12em; }
.menu .names .row { display: flex; justify-content: space-between; gap: 30px; }
.menu .names .row.me { color: #ffe14d; }
.menu .entry { font-family: 'Share Tech Mono', monospace; font-size: 34px; letter-spacing: .5em; color: #fff; text-align: center; margin: 12px 0; }
.menu .entry i { color: #ff3d9a; font-style: normal; animation: pblink .6s steps(2) infinite; }
.menu.dim { background: rgba(2,3,8,.55); backdrop-filter: blur(3px); }
`;

export class Menus {
  constructor(ui, game, renderer) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.ui = ui;
    this.game = game;
    this.renderer = renderer;
    this.el = document.createElement('div');
    this.el.className = 'menu';
    ui.appendChild(this.el);
    this.mode = null;
    this.sel = 0;
    this.items = [];
    this.difficulty = 'zombie';
    try { this.difficulty = localStorage.getItem('cobra.diff') || 'zombie'; } catch (e) { /* ignore */ }
    this.scores = this.loadScores();
    this.vol = { music: 0.8, sfx: 1 };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem('cobra.vol') || '{}')); } catch (e) { /* ignore */ }
    sound.setMusicVolume(this.vol.music);
    sound.setSfxVolume(this.vol.sfx);
  }

  volLabel(k) {
    const v = Math.round(this.vol[k] * 10);
    return `${k === 'music' ? 'MUSIC' : 'SOUND FX'} <small>${'▮'.repeat(v)}${'▯'.repeat(10 - v)}</small>`;
  }

  adjustVol(k, d) {
    this.vol[k] = Math.max(0, Math.min(1, Math.round((this.vol[k] + d) * 10) / 10));
    if (k === 'music') sound.setMusicVolume(this.vol.music); else sound.setSfxVolume(this.vol.sfx);
    try { localStorage.setItem('cobra.vol', JSON.stringify(this.vol)); } catch (e) { /* ignore */ }
    sound.sfx('uiMove');
    const keepSel = this.sel;
    if (this.mode === 'pause') this.pause(); else this.drawList();
    this.sel = keepSel;
    this.paint();
  }

  loadScores() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('cobra.scores') || 'null'); } catch (e) { /* ignore */ }
    // default table nods to the original's creators and the film's cast
    return s || [
      ['ZACH', 50000], ['KAREN', 40000], ['JOFFA', 30000], ['MARTIN', 25000], ['STALLONE', 20000],
      ['GONZALES', 15000], ['INGRID', 10000], ['NIGHT', 7500], ['SLASHER', 5000], ['COBRETTI', 2500],
    ];
  }

  saveScores() { try { localStorage.setItem('cobra.scores', JSON.stringify(this.scores)); } catch (e) { /* ignore */ } }

  hide() { this.el.classList.remove('on', 'dim'); this.mode = null; }

  render(html, dim = false) {
    this.el.innerHTML = html;
    this.el.classList.add('on');
    this.el.classList.toggle('dim', dim);
    for (const [i, b] of [...this.el.querySelectorAll('.item')].entries()) {
      b.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.paint(); sound.sfx('uiMove'); } });
      b.addEventListener('click', () => { this.sel = i; this.activate(); });
    }
  }

  paint() {
    [...this.el.querySelectorAll('.item')].forEach((b, i) => b.classList.toggle('sel', i === this.sel));
  }

  // ---------------------------------------------------------------- screens
  title() {
    this.mode = 'press';
    this.render(`<div class="press">PRESS ENTER</div><div class="foot">Based on Ocean Software's 1986 COBRA · C64 / ZX SPECTRUM / AMSTRAD CPC · F2 TOGGLES C64 MODE</div>`);
    this.el.querySelector('.press').addEventListener('click', () => this.mainMenu());
  }

  diffName() { return { cop: 'COP', zombie: 'ZOMBIE SQUAD', cobra: 'COBRA' }[this.difficulty]; }

  mainMenu() {
    this.mode = 'main';
    this.items = [
      { id: 'start', label: 'START GAME' },
      { id: 'diff', label: () => `DIFFICULTY <small>${this.diffName()}</small>` },
      { id: 'c64', label: () => `C64 MODE <small>${this.renderer.c64 ? 'ON' : 'OFF'}</small>` },
      { id: 'music', label: () => this.volLabel('music') },
      { id: 'sfx', label: () => this.volLabel('sfx') },
      { id: 'controls', label: 'CONTROLS' },
      { id: 'scores', label: 'HI-SCORES' },
      { id: 'credits', label: 'ABOUT' },
    ];
    this.sel = 0;
    this.drawList();
  }

  drawList(dim = false) {
    this.render(`<div class="list">${this.items.map((it) => `<button class="item" type="button">${typeof it.label === 'function' ? it.label() : it.label}</button>`).join('')}</div>
      <div class="foot">↑ ↓ SELECT · ← → ADJUST · ENTER CONFIRM</div>`, dim);
    this.paint();
  }

  controls() {
    this.mode = 'card';
    this.render(`<div class="card"><h2>CONTROLS</h2><div class="sub">KEYBOARD · GAMEPAD · TOUCH</div>
      <div class="keys">
        <b>← → / A D</b><span>Run</span>
        <b>SPACE / ↑ / W</b><span>Jump (hold for height) — ↑ climbs when at a ladder</span>
        <b>↓ / S</b><span>Duck · climb down ladders · ↓ + SPACE drops through platforms</span>
        <b>J / Z / CTRL</b><span>MURDER — headbutt, or use the weapon from the last burger</span>
        <b>K / X</b><span>Throw grenade</span>
        <b>ESC / P</b><span>Pause</span>
        <b>F2 / C</b><span>Toggle C64 mode</span>
        <b>PAD</b><span>Stick/D-pad move · A jump · X / RT murder · B grenade · START pause</span>
      </div>
      <p>Weapons hide inside beef burgers — some up high, so climb the ladders and fire escapes, or follow the burger pointer. Each one wears out — watch the rubber duck. Find all four burgers, rescue Ingrid and clear the gang to move on.</p>
      <div class="hint">ENTER / ESC — BACK</div></div>`, true);
  }

  credits() {
    this.mode = 'card';
    this.render(`<div class="card"><h2>ABOUT</h2><div class="sub">A MODERN REMAKE</div>
      <p>A tribute to <i>Cobra</i> by Ocean Software (1986) for the Commodore 64, ZX Spectrum and Amstrad CPC, based on the Warner Bros. film. The C64 version was written by Zach Townsend with graphics by Karen Davies, from an idea by Jonathan Smith, whose Spectrum version won Newsfield's Best Platform Game award. Martin Galway wrote the music.</p>
      <p>This remake keeps the original's rules — headbutts, weapons in burgers, the Quackometer, prams, bazooka women, Ingrid and the Night Slasher — and rebuilds everything else: real-time lighting, rain, wet streets, procedural models, music and sound. No image or audio files are used.</p>
      <div class="hint">ENTER / ESC — BACK</div></div>`, true);
  }

  hiscores(highlight = -1) {
    this.mode = 'card';
    this.render(`<div class="card"><h2>HI-SCORES</h2><div class="sub">COBRA HALL OF FAME</div>
      <div class="names">${this.scores.map(([n, s], i) => `<div class="row${i === highlight ? ' me' : ''}"><span>${String(i + 1).padStart(2, '0')}. ${n}</span><span>${String(s).padStart(6, '0')}</span></div>`).join('')}</div>
      <div class="hint">ENTER — CONTINUE</div></div>`, true);
  }

  pause() {
    this.mode = 'pause';
    this.items = [
      { id: 'resume', label: 'RESUME' },
      { id: 'restart', label: 'RESTART LEVEL' },
      { id: 'c64', label: () => `C64 MODE <small>${this.renderer.c64 ? 'ON' : 'OFF'}</small>` },
      { id: 'music', label: () => this.volLabel('music') },
      { id: 'sfx', label: () => this.volLabel('sfx') },
      { id: 'controls', label: 'CONTROLS' },
      { id: 'quit', label: 'QUIT TO TITLE' },
    ];
    this.sel = 0;
    this.drawList(true);
    const l = this.el.querySelector('.list');
    l.style.marginTop = '0';
    l.insertAdjacentHTML('afterbegin', '<div style="font-size:64px;letter-spacing:.3em;color:#fff;text-shadow:0 0 20px rgba(255,47,142,.7);margin-bottom:18px">PAUSED</div>');
  }

  levelCard(def, stats, next) {
    this.mode = 'level';
    const t = Math.round(stats.time);
    this.render(`<div class="card"><h2>${def.name.replace(/^LEVEL \d+ — /, '')} CLEARED</h2><div class="sub">${next ? 'NEXT: ' + next.name : 'THE FACTORY AWAITS'}</div>
      <table>
        <tr><td>KILLERS TAKEN DOWN</td><td>${stats.kills}</td></tr>
        <tr><td>TIME</td><td>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</td></tr>
        <tr><td>ENERGY BONUS</td><td>+${stats.bonus}</td></tr>
        <tr><td>SCORE</td><td>${String(this.game.score).padStart(6, '0')}</td></tr>
      </table><div class="hint">ENTER — CONTINUE</div></div>`, true);
  }

  nameEntry(score, done) {
    this.mode = 'name';
    this.entry = { name: '', score, done };
    const draw = () => {
      this.render(`<div class="card"><h2>GAME OVER</h2><div class="sub">ENTER YOUR NAME</div>
        <div class="entry">${this.entry.name}<i>_</i></div>
        <table><tr><td>SCORE</td><td>${String(score).padStart(6, '0')}</td></tr></table>
        <div class="hint">TYPE · ENTER TO CONFIRM</div></div>`, true);
    };
    draw();
    this.entry.draw = draw;
  }

  qualifies(score) { return score > this.scores[this.scores.length - 1][1]; }

  submitName() {
    const e = this.entry;
    const name = (e.name || 'COBRA').slice(0, 8);
    this.scores.push([name, e.score]);
    this.scores.sort((a, b) => b[1] - a[1]);
    this.scores = this.scores.slice(0, 10);
    this.saveScores();
    const idx = this.scores.findIndex((r) => r[0] === name && r[1] === e.score);
    this.hiscores(idx);
    this.mode = 'scoresAfter';
    this.after = e.done;
  }

  typed(ev) {
    if (this.mode !== 'name') return;
    if (/^[a-zA-Z0-9 ]$/.test(ev.key) && this.entry.name.length < 8) { this.entry.name += ev.key.toUpperCase(); sound.sfx('typewriter'); this.entry.draw(); }
    else if (ev.key === 'Backspace') { this.entry.name = this.entry.name.slice(0, -1); this.entry.draw(); }
  }

  victory(score) {
    this.mode = 'victory';
    this.render(`<div class="card"><h2>THE CURE</h2><div class="sub">THE NIGHT SLASHER IS DEAD · INGRID IS SAFE</div>
      <p>"You're the disease… and I'm the cure."</p>
      <table><tr><td>FINAL SCORE</td><td>${String(score).padStart(6, '0')}</td></tr></table>
      <div class="hint">ENTER — CONTINUE</div></div>`, true);
  }

  // ---------------------------------------------------------------- input
  update() {
    if (!this.mode) return;
    if (this.mode === 'press') { if (input.pressed('confirm')) { sound.sfx('uiSelect'); this.mainMenu(); } return; }
    if (this.mode === 'name') return;
    if (this.mode === 'card' || this.mode === 'level' || this.mode === 'victory' || this.mode === 'scoresAfter') {
      if (input.pressed('confirm') || input.pressed('back')) {
        sound.sfx('uiBack');
        if (this.mode === 'level' || this.mode === 'victory') { const cb = this.onContinue; this.hide(); cb && cb(); }
        else if (this.mode === 'scoresAfter') { const cb = this.after; this.hide(); cb && cb(); }
        else if (this.game.state === 'paused') this.pause();
        else this.mainMenu();
      }
      return;
    }
    const n = this.items.length;
    if (input.pressed('down')) { this.sel = (this.sel + 1) % n; this.paint(); sound.sfx('uiMove'); }
    if (input.pressed('up') || input.pressed('jump') && false) { this.sel = (this.sel + n - 1) % n; this.paint(); sound.sfx('uiMove'); }
    const cur = this.items[this.sel];
    if (cur && (cur.id === 'music' || cur.id === 'sfx')) {
      if (input.pressed('left')) this.adjustVol(cur.id, -0.1);
      if (input.pressed('right')) this.adjustVol(cur.id, 0.1);
    }
    if (input.pressed('confirm')) this.activate();
    if (this.mode === 'pause' && input.pressed('back')) this.choose('resume');
  }

  activate() {
    const it = this.items[this.sel];
    if (it) this.choose(it.id);
  }

  choose(id) {
    sound.sfx('uiSelect');
    switch (id) {
      case 'start': this.hide(); this.onStart && this.onStart(this.difficulty); break;
      case 'diff': {
        const order = ['cop', 'zombie', 'cobra'];
        this.difficulty = order[(order.indexOf(this.difficulty) + 1) % 3];
        try { localStorage.setItem('cobra.diff', this.difficulty); } catch (e) { /* ignore */ }
        this.drawList(); break;
      }
      case 'c64': { const keep = this.sel; this.renderer.c64 = !this.renderer.c64; if (this.mode === 'pause') this.pause(); else this.drawList(); this.sel = keep; this.paint(); break; }
      case 'music': case 'sfx': this.adjustVol(id, this.vol[id] >= 1 ? -1 : 0.1); break;
      case 'controls': this.controls(); break;
      case 'scores': this.hiscores(); break;
      case 'credits': this.credits(); break;
      case 'resume': this.hide(); this.onResume && this.onResume(); break;
      case 'restart': this.hide(); this.onRestart && this.onRestart(); break;
      case 'quit': this.hide(); this.onQuit && this.onQuit(); break;
      default: break;
    }
  }
}
