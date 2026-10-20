// Boot + top-level flow: press-start -> intro cinematic -> title -> levels -> victory.
import { Renderer } from './core/renderer.js';
import { input } from './core/input.js';
import { sound } from './core/sound.js';
import { HUD } from './game/hud.js';
import { Game } from './game/game.js';
import { Director } from './game/intro.js';
import { Menus } from './game/menu.js';
import testLevel from './levels/test.js';

const q = new URLSearchParams(location.search);
const app = document.getElementById('app');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const bootbar = document.getElementById('bootbar');
const setBoot = (f) => { if (bootbar) bootbar.style.width = `${Math.round(f * 100)}%`; };
// fade the boot screen out, then take it out of rendering: its pulsing prompt would otherwise
// keep repainting (invisibly) for the whole session
const hideBoot = () => { boot.classList.add('done'); setTimeout(() => { boot.hidden = true; }, 900); };

const renderer = new Renderer(app);
const hud = new HUD(ui);
input.buildTouch(ui);

let game = null, director = null, menus = null;
let mode = 'boot';
let last = performance.now();
let levels = [];

async function loadLevels() {
  const list = [];
  for (const p of ['./levels/city.js', './levels/rural.js', './levels/factory.js']) {
    try { list.push((await import(p)).default); } catch (e) { console.warn('[cobra] level missing', p, e.message); }
  }
  return list;
}

const unlockAudio = () => { sound.unlock(); };
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
input.onKey((e) => { if (menus) menus.typed(e); if (e.code === 'Enter' && menus && menus.mode === 'name') menus.submitName(); });

// ------------------------------------------------------------------ flow

async function toTitle(fromIntro = false) {
  if (!fromIntro) {
    hud.show(false);
    await game.loadLevel(0);
    director.attach();
    // the title's logo lights need their own shader variants: build them now, drawn black
    const fade = renderer.fade;
    renderer.fade = 1;
    director.warmup();
    renderer.fade = fade;
    director.toTitle(true);
  }
  mode = 'title';
  menus.title();
}

function startPlay() {
  mode = 'game';
  game.state = 'play';
  hud.show(true);
  hud.banner(game.def.name, game.def.subtitle || '', 3.2);
  if (game.def.location) setTimeout(() => hud.location(game.def.location, game.def.locationSub || ''), 1800);
  sound.playMusic(game.def.music || 'city');
  sound.setAmbience(game.def.ambience || null);
}

async function loadAndPlay(index) {
  mode = 'loading';
  hud.show(false);
  renderer.fade = 1;
  await game.loadLevel(index);
  game.player.scripted = false;
  game.player.control = true;
  game.camRig.override = null;
  game.camRig.blend = 0;
  renderer.fade = 0;
  startPlay();
}

function wireGame() {
  game.onPause = (p) => { if (p) menus.pause(); else menus.hide(); };
  game.onLevelComplete = (stats) => {
    renderer.letterbox = 0;
    setTimeout(() => {
      hud.show(false);
      const next = levels[game.levelIndex + 1];
      if (game.def.final) { victory(); return; }
      menus.levelCard(game.def, stats, next);
      menus.onContinue = () => { if (next) loadAndPlay(game.levelIndex + 1); else victory(); };
    }, 400);
  };
  game.onGameOver = () => {
    hud.show(false);
    if (menus.qualifies(game.score)) menus.nameEntry(game.score, () => toTitle());
    else toTitle();
  };
  game.onVictory = () => victory();
  menus.onStart = (diff) => {
    game.newGame(diff);
    director.onGameStart = () => startPlay();
    director.startGame();
    mode = 'starting';
  };
  menus.onResume = () => game.togglePause();
  menus.onRestart = () => { game.state = 'play'; sound.setMuffle(0); const keep = game.score; loadAndPlay(game.levelIndex).then(() => { game.score = keep; }); };
  menus.onQuit = () => { game.state = 'idle'; sound.setMuffle(0); toTitle(); };
  director.onTitle = () => { mode = 'title'; menus.title(); };
}

function victory() {
  mode = 'victory';
  hud.show(false);
  sound.playMusic('victory');
  menus.victory(game.score);
  menus.onContinue = () => {
    if (menus.qualifies(game.score)) menus.nameEntry(game.score, () => toTitle());
    else toTitle();
  };
}

async function start() {
  setBoot(0.15);
  levels = q.get('level') === 'test' ? [testLevel] : await loadLevels();
  if (!levels.length) levels.push(testLevel);
  setBoot(0.35);
  game = new Game(renderer, hud, levels);
  window.__game = game;
  window.__director = () => director;
  window.__input = input;
  menus = new Menus(ui, game, renderer);
  director = new Director(game, ui);
  wireGame();
  game.newGame(q.get('difficulty') || menus.difficulty);
  setBoot(0.5);

  const direct = q.has('level');
  await game.loadLevel(direct ? (q.get('level') === 'test' ? 0 : Math.min(parseInt(q.get('level'), 10) || 0, levels.length - 1)) : 0);
  setBoot(1);
  if (direct) {
    hideBoot();
    startPlay();
    window.__ready = true;
    return;
  }
  director.attach();
  director.warmup();
  game.state = 'cinematic';
  renderer.fade = 1;
  // a gesture is required before audio can play: hold on a press-start screen
  const touch = document.body.classList.contains('has-touch');
  hud.prime();
  boot.classList.add('ready');
  boot.querySelector('.t').innerHTML = `<div class="ok">READY</div><div class="go">${touch ? 'TAP TO START' : 'PRESS ANY KEY'}</div>`
    + `<div class="sub">${touch ? '' : 'OR CLICK ANYWHERE · '}HEADPHONES RECOMMENDED</div>`;
  mode = 'press';
  window.__ready = true;
  if (q.has('autostart')) beginIntro();
}

function beginIntro() {
  if (mode !== 'press') return;
  sound.unlock();
  hideBoot();
  if (q.has('skipintro')) { director.toTitle(true); return; }
  mode = 'intro';
  director.startIntro();
}
window.addEventListener('keydown', () => beginIntro());
window.addEventListener('pointerdown', () => beginIntro());

// ------------------------------------------------------------------ loop

function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  window.__fps = (window.__fps || 60) * 0.95 + (1 / Math.max(1e-3, (now - last) / 1000)) * 0.05;
  last = now;
  input.update();
  if (input.pressed('c64') && mode !== 'boot' && !(menus && menus.mode === 'name')) renderer.c64 = !renderer.c64;
  if (game && game.scene) {
    if (mode === 'intro' || mode === 'title' || mode === 'starting' || mode === 'press') director.update(rawDt);
    if (menus) menus.update(rawDt);
    if (mode !== 'loading') game.update(rawDt);
    game.render(rawDt);
  }
  requestAnimationFrame(frame);
}

start().catch((e) => { console.error(e); boot.querySelector('.t').textContent = 'FAILED TO START: ' + e.message; });
requestAnimationFrame(frame);
