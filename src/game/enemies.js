// The Night Slasher's gang. Behaviours are faithful to the 1986 game (bouncers,
// knifemen, bazooka women, pram-pushing ladies, axe men, bikers, bombers) with
// modern telegraphs, hit reactions and tier-aware chasing.
import * as THREE from 'three';
import { createCharacter } from '../actors/characters.js';
import { Poses, emptyPose, layerUpper, copyPose } from '../actors/rig.js';
import { moveBody } from './physics.js';
import { sound } from '../core/sound.js';

export const ENEMY_TYPES = {
  thug: { char: 'thug', hp: 105, speed: 3.7, behavior: 'brawler', dmg: 20, score: 300, reach: 1.15, cooldown: 0.9 },
  knifer: { char: 'knifer', hp: 55, speed: 3.4, behavior: 'thrower', dmg: 18, score: 250, range: [5, 10], cooldown: 1.7 },
  gunner: { char: 'gunner', hp: 55, speed: 3.1, behavior: 'shooter', dmg: 16, score: 250, range: [6, 13], cooldown: 1.6 },
  bazooka: { char: 'bazooka', hp: 70, speed: 2.3, behavior: 'bazooka', dmg: 40, score: 400, range: [8, 17], cooldown: 3.4 },
  granny: { char: 'granny', hp: 40, speed: 2.4, behavior: 'pram', dmg: 12, score: 350, reach: 1.0, cooldown: 1.2 },
  axeman: { char: 'axeman', hp: 90, speed: 4.6, behavior: 'axe', dmg: 28, score: 350, reach: 1.35, cooldown: 1.2 },
  biker: { char: 'biker', hp: 80, speed: 13, behavior: 'biker', dmg: 35, score: 500 },
  grabber: { char: 'grabber', hp: 70, speed: 5.6, behavior: 'grabber', dmg: 14, score: 450, reach: 1.0, cooldown: 1.0 },
  bomber: { char: 'bomber', hp: 60, speed: 2.4, behavior: 'bomber', dmg: 35, score: 300, range: [4, 12], cooldown: 2.8 },
};

const rigPool = new Map();
function takeRig(kind) {
  const pool = rigPool.get(kind);
  if (pool && pool.length) {
    const r = pool.pop();
    r.setOpacity(1);
    r.root.visible = true;
    r.root.rotation.set(0, 0, 0);
    r.hitFlash = 0;
    for (const k in r.pose) r.pose[k] = 0;
    return r;
  }
  return createCharacter(kind);
}
function giveRig(rig) {
  rig.root.removeFromParent();
  if (!rigPool.has(rig.kind)) rigPool.set(rig.kind, []);
  rigPool.get(rig.kind).push(rig);
}
export function freeRigs(type) { return rigPool.get(ENEMY_TYPES[type]?.char)?.length || 0; }

let pramProto = null, bikeProto = null;

// Builds everything enemies can bring into the scene before play starts (a character costs
// 15-25 ms to generate, a bike or pram 15 ms): a rig pool per type sized for the biggest
// encounter on top of its share of the ambient crowd (they overlap: encounters lock the
// camera while ambient spawns continue), +1 for a corpse still fading out, plus the bike and
// pram models. `extra`: further spawns the level can trigger (boss summons), one rig each.
// Returns the rigs and extra models so the game can make them GPU-resident too.
export function prewarmEnemies(game, extra = []) {
  const def = game.def;
  const need = new Map();
  const total = def.enemyPool.reduce((s, [, w]) => s + w, 0) || 1;
  const crowd = (def.maxAlive ?? 4) + 3;
  for (const enc of game.builder.encounters) {
    const n = new Map();
    for (const s of enc.spawns) n.set(s.type, (n.get(s.type) || 0) + 1);
    for (const [t, c] of n) need.set(t, Math.max(need.get(t) || 0, c));
  }
  for (const [t, w] of def.enemyPool) need.set(t, (need.get(t) || 0) + Math.ceil((w / total) * crowd));
  for (const t of extra) need.set(t, (need.get(t) || 0) + 1);
  const rigs = [], models = [];
  for (const [t, n] of need) {
    const cfg = ENEMY_TYPES[t];
    if (!cfg) continue;
    if (!rigPool.has(cfg.char)) rigPool.set(cfg.char, []);
    const pool = rigPool.get(cfg.char);
    while (pool.length < n + 1) pool.push(createCharacter(cfg.char));
    rigs.push(...pool);
    if (cfg.behavior === 'pram') models.push(pramProto ||= game.props?.makePram ? game.props.makePram() : fallbackPram());
    if (cfg.behavior === 'biker') models.push(bikeProto ||= game.props?.makeMotorcycle ? game.props.makeMotorcycle() : fallbackBike());
  }
  return { rigs, extra: models };
}

export class Enemy {
  constructor(game, type, x, y, opts = {}) {
    this.game = game;
    this.type = type;
    this.cfg = ENEMY_TYPES[type];
    this.rig = takeRig(this.cfg.char);
    game.scene.add(this.rig.root);
    this.body = { x, y, vx: 0, vy: 0, w: 0.66, h: 1.8, onGround: false, ground: null, dropTimer: 0, climbing: false };
    this.hp = this.cfg.hp * game.difficulty.enemyHp;
    this.facing = opts.facing || (game.player.body.x > x ? 1 : -1);
    this.state = opts.emerge ? 'emerge' : 'active';
    this.z = opts.emerge ? -1.4 : 0;
    this.t = 0;
    this.cool = 0.6 + Math.random() * 0.8;
    this.attack = null;
    this.phase = Math.random() * 6;
    this.alive = true;
    this.deadT = 0;
    this.pose = emptyPose();
    this.thinkT = 0;
    this.lowThrow = false;
    this.speedMul = 0.85 + Math.random() * 0.3;
    this.patrolDir = this.facing;
    this.carrying = null;
    if (this.cfg.behavior === 'pram') this.makePram();
    if (this.cfg.behavior === 'biker') this.makeBike(opts.facing || -1);
    this.rig.root.position.set(x, y, this.z);
  }

  get isEnemy() { return true; }

  bounds() {
    const b = this.body;
    if (this.bike) return { x0: b.x - 1.1, x1: b.x + 1.1, y0: b.y, y1: b.y + 1.9 };
    return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h };
  }

  makePram() {
    pramProto ||= this.game.props?.makePram ? this.game.props.makePram() : fallbackPram();
    this.pram = pramProto.clone();
    this.game.scene.add(this.pram);
  }

  makeBike(dir) {
    bikeProto ||= this.game.props?.makeMotorcycle ? this.game.props.makeMotorcycle() : fallbackBike();
    this.bike = bikeProto.clone();
    this.game.scene.add(this.bike);
    this.facing = dir;
    this.body.vx = dir * this.cfg.speed;
    this.engineT = 0;
    sound.sfx('motorcycle', { x: this.body.x });
  }

  // -------------------------------------------------------------- damage
  hit(dmg, info = {}) {
    if (!this.alive) return;
    const g = this.game;
    this.hp -= dmg;
    this.rig.flash(0.1);
    const dir = info.dir || -this.facing;
    this.rig.impulse('spineX', info.kind === 'melee' ? -7 : -3.5);
    this.rig.impulse('headX', -5);
    this.rig.impulse('spineY', (Math.random() - 0.5) * 6);
    g.particles.blood(info.x ?? this.body.x, info.y ?? this.body.y + 1.3, 0.1, dir, info.kind === 'melee' ? 8 : 12);
    if (this.attack && info.kind !== 'bullet') this.attack = null;
    if (!this.bike) {
      this.body.vx = dir * (info.kind === 'melee' ? 5 : info.kind === 'explosion' ? 9 : 2.2);
      if (info.kind === 'melee' || info.kind === 'explosion') this.body.vy = Math.max(this.body.vy, info.kind === 'explosion' ? 8 : 3);
      this.stun = info.kind === 'melee' ? 0.45 : 0.18;
    }
    if (this.hp <= 0) this.die(info);
    else sound.sfx(this.rig.spec.female ? 'femaleHurt' : 'enemyHurt', { x: this.body.x, volume: 0.7 });
  }

  die(info = {}) {
    const g = this.game;
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    const dir = info.dir || -this.facing;
    this.deathDir = dir === this.facing ? 1 : -1; // fall forward if hit from behind
    if (this.bike) {
      this.bikeCrash = { t: 0, vx: this.body.vx * 0.6, vy: 3, spin: 0 };
      this.body.vx = this.facing * 6;
      this.body.vy = 7;
    } else {
      this.body.vx = dir * (info.kind === 'explosion' ? 10 : info.kind === 'melee' ? 6 : 3.5);
      this.body.vy = info.kind === 'explosion' ? 9 : 4.5;
    }
    sound.sfx(this.rig.spec.female ? 'femaleHurt' : 'enemyDie', { x: this.body.x });
    g.onEnemyKilled(this, info);
    if (this.carrying) { g.ingrid.release(); this.carrying = null; }
    if (this.pram && !this.pramFree) { this.releasePram(0.3); }
  }

  remove() {
    giveRig(this.rig);
    if (this.pram && !this.pramFree) this.pram.removeFromParent();
    if (this.bike) this.bike.removeFromParent();
    this.removed = true;
  }

  // -------------------------------------------------------------- AI
  update(dt) {
    const g = this.game;
    const b = this.body;
    const P = g.player.body;
    this.t += dt;
    this.cool -= dt;
    this.stun = Math.max(0, (this.stun || 0) - dt);

    if (this.state === 'dead') {
      this.deadT += dt;
      b.vx *= Math.pow(0.04, dt);
      if (!this.bike) moveBody(g.world, b, dt);
      else this.updateBikeCrash(dt);
      if (this.deadT > 2.6) this.rig.setOpacity(Math.max(0, 1 - (this.deadT - 2.6) / 0.7));
      if (this.deadT > 3.3) this.remove();
      this.animate(dt);
      return;
    }

    if (this.state === 'emerge') {
      this.z += dt * 2.2;
      b.vx = this.facing * 1.2;
      if (this.z >= 0) { this.z = 0; this.state = 'active'; }
      moveBody(g.world, b, dt);
      this.animate(dt);
      return;
    }

    if (b.climbing) {
      const L = b.ladder;
      b.vy = 3.6;
      moveBody(g.world, b, dt);
      this.phase += dt * 6;
      if (b.y >= L.y1) { b.y = L.y1 + 0.02; b.climbing = false; b.vy = 0; this.climbCool = 2; }
      this.animate(dt);
      return;
    }
    this.climbCool = Math.max(0, (this.climbCool || 0) - dt);
    const dx = P.x - b.x, dy = P.y - b.y, adx = Math.abs(dx);
    // stragglers left far behind quietly leave (keeps the street readable and spawns flowing)
    if (adx > 34 && !this.carrying && !g.lock && !this.onScreen()) { this.alive = false; this.remove(); return; }
    const sameTier = Math.abs(dy) < 1.3;
    const playerAlive = g.player.alive && g.player.control;
    const hasLOS = !g.world.blocked(b.x, b.y + 1.4, P.x, P.y + 1.2);
    let want = 0;

    switch (this.cfg.behavior) {
      case 'brawler':
      case 'axe':
      case 'grabber': {
        let tx = P.x, tdy = dy;
        if (this.cfg.behavior === 'grabber') {
          const ing = g.ingrid;
          if (this.carrying) {
            // run away from Cobra with Ingrid over the shoulder
            want = Math.sign(b.x - P.x) || 1;
            if (Math.abs(b.x - P.x) > 30) { g.ingrid.lose(); this.carrying = null; this.remove(); this.alive = false; this.removed = true; return; }
            break;
          }
          if (ing && ing.grabbable()) { tx = ing.body.x; tdy = ing.body.y - b.y; }
        }
        let tdx = tx - b.x;
        // target is up on another tier: head for a ladder that gets there
        if (tdy > 2.2 && b.onGround && !this.attack && !this.climbCool) {
          let best = null, bd = 16;
          for (const l of g.world.ladders) {
            const d = Math.abs(l.x - b.x);
            if (d < bd && Math.abs(l.y0 - b.y) < 0.4 && l.y1 >= b.y + tdy - 0.6) { best = l; bd = d; }
          }
          this.seekLadder = best;
          if (best) {
            tdx = best.x - b.x;
            if (Math.abs(tdx) < 0.45) { b.climbing = true; b.ladder = best; b.vx = 0; this.seekLadder = null; this.animate(dt); return; }
            want = Math.sign(tdx);
          }
        } else this.seekLadder = null;
        if (false) {
        }
        if (!this.attack && want === 0) {
          if (Math.abs(tdx) > (this.cfg.reach || 1) * 0.85) want = Math.sign(tdx);
          // jump up toward a target above
          if (tdy > 2 && tdy < 3.9 && Math.abs(tx - b.x) < 4.5 && b.onGround && this.cool < 0.5) {
            b.vy = 15.2; b.onGround = false; this.cool = 0.8;
          }
          if (this.cfg.behavior === 'grabber' && g.ingrid && g.ingrid.grabbable() && Math.abs(tdx) < 0.8 && Math.abs(tdy) < 1) {
            g.ingrid.grab(this);
            this.carrying = g.ingrid;
            sound.sfx('ingridScream');
            g.hud.banner('INGRID KIDNAPPED!', 'Stop him before he gets away', 2.5);
          } else if (playerAlive && adx < (this.cfg.reach || 1.1) && sameTier && this.cool <= 0) {
            this.startAttack(this.cfg.behavior === 'axe' ? 'axe' : 'punch', this.cfg.behavior === 'axe' ? 0.75 : 0.55);
          } else if (this.cfg.behavior === 'axe' && playerAlive && adx > 4 && adx < 9 && sameTier && hasLOS && this.cool <= 0 && Math.random() < 0.02) {
            this.startAttack('axeThrow', 0.6);
          }
        }
        break;
      }
      case 'thrower':
      case 'shooter':
      case 'bomber':
      case 'bazooka': {
        const [rmin, rmax] = this.cfg.range;
        const okTier = this.cfg.behavior === 'bazooka' || this.cfg.behavior === 'bomber' ? true : sameTier;
        if (!this.attack) {
          if (adx > rmax || !okTier && adx > 3) want = Math.sign(dx);
          else if (adx < rmin && okTier) want = -Math.sign(dx);
          if (playerAlive && okTier && adx <= rmax + 1 && adx > 1.2 && this.cool <= 0 && hasLOS && this.onScreen()) {
            const kind = { thrower: 'knifeThrow', shooter: 'shoot', bomber: 'bomb', bazooka: 'rocket' }[this.cfg.behavior];
            this.startAttack(kind, { knifeThrow: 0.75, shoot: 0.8, bomb: 0.8, rocket: 1.3 }[kind]);
          }
          if (adx < 1.2 && sameTier && this.cool <= 0 && playerAlive) this.startAttack('punch', 0.55);
        }
        break;
      }
      case 'pram': {
        if (!this.pramFree && !this.attack) {
          want = Math.sign(dx);
          if (adx < 11 && sameTier && b.onGround && this.onScreen()) this.releasePram(7.8);
        } else if (!this.attack) {
          if (adx > 1.1) want = Math.sign(dx) * 0.8;
          if (adx < (this.cfg.reach || 1) && sameTier && this.cool <= 0 && playerAlive) this.startAttack('punch', 0.6);
        }
        break;
      }
      case 'biker':
        this.updateBike(dt);
        this.animate(dt);
        return;
      default:
        break;
    }

    // contact damage
    if (playerAlive && this.cfg.behavior !== 'pram') {
      const pb = g.player.bounds(), eb = this.bounds();
      if (pb.x1 > eb.x0 + 0.15 && pb.x0 < eb.x1 - 0.15 && pb.y1 > eb.y0 + 0.2 && pb.y0 < eb.y1 - 0.3) {
        if (g.player.pill > 0) this.hit(999, { dir: Math.sign(b.x - P.x) || 1, kind: 'melee' });
        else if (this.attack == null && this.cool <= 0.3) g.player.hit(this.cfg.dmg * 0.6, { dir: Math.sign(P.x - b.x) || 1 });
      }
    }

    // attack timeline
    if (this.attack) {
      this.attack.t += dt;
      want = 0;
      this.facing = Math.sign(dx) || this.facing;
      const a = this.attack;
      const k = a.t / a.dur;
      if (!a.fired && k >= (a.hitAt ?? 0.55)) { a.fired = true; this.executeAttack(a.kind); }
      if (a.t >= a.dur) { this.attack = null; this.cool = this.cfg.cooldown * (0.7 + Math.random() * 0.6) * g.difficulty.enemyCooldown; }
    }

    // edge handling
    if (want !== 0 && b.onGround) {
      const ahead = g.world.groundAt(b.x + want * 0.7, b.y + 0.2);
      const drop = b.y - ahead;
      if (drop > 0.6) {
        const targetBelow = dy < -0.5 || drop < 1.6 || (this.cfg.behavior === 'grabber' && this.carrying);
        if (!targetBelow || drop > 7) want = 0;
      }
    }
    if (this.stun > 0) want = 0;
    const speed = this.cfg.speed * this.speedMul * (this.carrying ? 0.8 : 1) * g.difficulty.enemySpeed;
    const tv = want * speed;
    const acc = b.onGround ? 22 : 8;
    if (this.stun <= 0) {
      if (b.vx < tv) b.vx = Math.min(tv, b.vx + acc * dt);
      else if (b.vx > tv) b.vx = Math.max(tv, b.vx - acc * dt);
    } else b.vx *= Math.pow(0.02, dt);
    if (want !== 0 && !this.attack) this.facing = want > 0 ? 1 : -1;
    else if (!this.attack && adx < 15 && !this.carrying) this.facing = Math.sign(dx) || this.facing;
    moveBody(g.world, b, dt);
    if (b.y < -12) { this.alive = false; g.onEnemyKilled(this, {}); this.remove(); return; }
    const hz = g.world.hazardAt(b.x, b.y, b.w, b.h);
    if (hz) this.hit(999, { dir: 1, kind: 'hazard' });
    this.animate(dt);
  }

  onScreen() {
    const g = this.game;
    return Math.abs(this.body.x - g.camRig.focus.x) < g.camRig.visibleHalfWidth() - 0.5;
  }

  startAttack(kind, dur) {
    this.attack = { kind, t: 0, dur, fired: false, hitAt: { punch: 0.5, axe: 0.55, knifeThrow: 0.6, shoot: 0.7, bomb: 0.6, rocket: 0.75, axeThrow: 0.6 }[kind] };
    if (kind === 'shoot' || kind === 'rocket') {
      // telegraph glint
      this.game.particles.glow(this.body.x + this.facing * 0.6, this.body.y + 1.45, 0.3, [5, 4, 2], 0.6, 0.35);
      if (kind === 'rocket') sound.sfx('gunCock', { x: this.body.x, volume: 0.6, pitch: 0.7 });
    }
    if (kind === 'knifeThrow') this.lowThrow = !this.lowThrow && Math.random() < 0.6;
  }

  executeAttack(kind) {
    const g = this.game;
    const b = this.body;
    const P = g.player.body;
    const dir = this.facing;
    switch (kind) {
      case 'punch':
      case 'axe': {
        const reach = (this.cfg.reach || 1.1) + 0.35;
        const dx = P.x - b.x;
        if (Math.sign(dx) === dir && Math.abs(dx) < reach && Math.abs(P.y - b.y) < 1.3) {
          if (g.player.pill > 0) { this.hit(999, { dir: -dir, kind: 'melee' }); break; }
          if (g.player.hit(this.cfg.dmg, { dir })) sound.sfx(kind === 'axe' ? 'bossSlash' : 'punch', { x: b.x });
        } else sound.sfx('whoosh', { x: b.x, volume: 0.5 });
        break;
      }
      case 'knifeThrow': {
        const y = b.y + (this.lowThrow ? 0.45 : 1.45);
        g.projectiles.spawn({ kind: 'knife', owner: 'enemy', x: b.x + dir * 0.5, y, vx: dir * 13.5, vy: 0, dmg: this.cfg.dmg, radius: 0.08 });
        sound.sfx('knifeThrow', { x: b.x });
        break;
      }
      case 'axeThrow': {
        const dx = P.x - b.x;
        g.projectiles.spawn({ kind: 'axe', owner: 'enemy', x: b.x + dir * 0.4, y: b.y + 1.7, vx: Math.sign(dx) * 9, vy: 6.5, dmg: this.cfg.dmg });
        sound.sfx('whoosh', { x: b.x });
        break;
      }
      case 'shoot': {
        const y = b.y + 1.42;
        g.projectiles.spawn({ kind: 'bullet', owner: 'enemy', x: b.x + dir * 0.75, y, vx: dir * 24, vy: 0, dmg: this.cfg.dmg });
        g.particles.muzzle(b.x + dir * 0.8, y, 0.1, dir);
        g.lights.flash(b.x + dir * 0.9, y, 0.8, '#ffb35a', 50, 8, 0.06);
        sound.sfx('pistol', { x: b.x, volume: 0.7, pitch: 1.1 });
        break;
      }
      case 'rocket': {
        const sx = b.x + dir * 0.8, sy = b.y + 1.55;
        const tx = P.x, ty = P.y + 1.0;
        const d = Math.hypot(tx - sx, ty - sy) || 1;
        g.projectiles.spawn({ kind: 'rocket', owner: 'enemy', x: sx, y: sy, vx: (tx - sx) / d * 11, vy: (ty - sy) / d * 11, dmg: this.cfg.dmg });
        g.particles.muzzle(sx, sy, 0.1, dir, true);
        g.particles.smoke(b.x - dir * 0.8, sy, 0, { vx: -dir * 2, size: 0.6, size1: 2.2, life: 1.2 });
        sound.sfx('rocketLaunch', { x: b.x });
        break;
      }
      case 'bomb': {
        const T = 1.05;
        const dx = P.x - b.x, dy = P.y - (b.y + 1.6);
        g.projectiles.spawn({ kind: 'bomb', owner: 'enemy', x: b.x + dir * 0.4, y: b.y + 1.6, vx: dx / T, vy: (dy + 0.5 * 26 * T * T) / T, fuse: 1.7, dmg: this.cfg.dmg });
        sound.sfx('grenadeThrow', { x: b.x });
        break;
      }
      default: break;
    }
  }

  // -------------------------------------------------------------- prams
  releasePram(speed) {
    this.pramFree = true;
    const g = this.game;
    g.spawnPram(this.pram, this.body.x + this.facing * 0.9, this.body.y, this.facing * speed);
    this.pram = null;
    this.cool = 1;
    if (speed > 1) sound.sfx('pram', { x: this.body.x });
  }

  // -------------------------------------------------------------- bikes
  updateBike(dt) {
    const g = this.game;
    const b = this.body;
    b.vx = this.facing * this.cfg.speed * g.difficulty.enemySpeed;
    const ev = moveBody(g.world, b, dt);
    if (ev.hitWall) { this.alive = false; this.remove(); return; }
    this.engineT -= dt;
    if (this.engineT <= 0) { this.engineT = 2.4; }
    const pb = g.player.bounds(), eb = this.bounds();
    if (g.player.alive && pb.x1 > eb.x0 + 0.2 && pb.x0 < eb.x1 - 0.2 && pb.y0 < eb.y1 - 0.5 && pb.y1 > eb.y0 + 0.2) {
      if (g.player.pill > 0) this.hit(999, { dir: -this.facing, kind: 'melee' });
      else g.player.hit(this.cfg.dmg, { dir: this.facing });
    }
    if (Math.random() < 0.3) g.particles.smoke(b.x - this.facing * 1.1, b.y + 0.4, 0, { vy: 0.3, size: 0.2, size1: 1, life: 0.9, color: [0.5, 0.5, 0.52, 0.25] });
    if (Math.abs(b.x - g.player.body.x) > 45 && Math.sign(b.x - g.player.body.x) === this.facing) { this.alive = false; this.remove(); }
    this.placeBike(0);
  }

  placeBike(tilt) {
    const b = this.body;
    if (!this.bike) return;
    this.bike.position.set(b.x, b.y, 0);
    this.bike.rotation.set(0, this.facing > 0 ? 0 : Math.PI, tilt);
    for (const n of ['wheelF', 'wheelR']) {
      const w = this.bike.getObjectByName(n);
      if (w) w.rotation.z -= (Math.abs(b.vx) / 0.35) * 0.016;
    }
  }

  updateBikeCrash(dt) {
    const g = this.game;
    const c = this.bikeCrash;
    const b = this.body;
    c.t += dt;
    moveBody(g.world, b, dt);
    if (this.bike) {
      c.vx *= Math.pow(0.3, dt);
      this.bike.position.x += c.vx * dt;
      c.spin += dt * 4;
      this.bike.rotation.z = Math.min(1.4, c.spin) * -1;
      if (c.t > 0.7 && !c.boom) {
        c.boom = true;
        g.projectiles.explode(this.bike.position.x, 0.6, 'player', 2.8, 0);
        this.bike.visible = false;
      }
    }
  }

  // -------------------------------------------------------------- anim
  animate(dt) {
    const r = this.rig;
    const b = this.body;
    const p = this.pose;
    for (const k in p) p[k] = 0;
    let rate = 14;
    r.setFacing(this.facing);
    const tt = this.t + this.phase;
    if (this.state === 'dead') {
      Poses.dead(p, Math.min(1, this.deadT * 2.4), -this.deathDir || -1);
      rate = 12;
    } else if (b.climbing) {
      Poses.climb(p, this.phase);
      r.update(dt, p, 16, Math.PI);
      r.root.position.set(b.x, b.y, this.z);
      return;
    } else if (this.bike) {
      Poses.idle(p, tt);
      p.hipsY = -0.25; p.thLX = -1.5; p.thRX = -1.5; p.knLX = 1.6; p.knRX = 1.6; p.ftLX = -0.2; p.ftRX = -0.2;
      p.thLZ = 0.25; p.thRZ = -0.25;
      p.spineX = 0.45; p.shLX = -1.2; p.shRX = -1.2; p.elLX = -0.3; p.elRX = -0.3; p.shLZ = 0.25; p.shRZ = -0.25;
      rate = 20;
    } else if (!b.onGround) {
      Poses.jump(p, b.vy);
    } else if (Math.abs(b.vx) > 0.35) {
      this.phase += dt * Math.abs(b.vx) * (2 * Math.PI / 2.9);
      Poses.run(p, this.phase, Math.min(1, Math.abs(b.vx) / 5.5));
      rate = 16;
    } else {
      Poses.idle(p, tt, this.type === 'gunner' ? 1 : 0);
    }
    if (this.state !== 'dead' && !this.bike) {
      const a = this.attack;
      const q = copyPose({ ...p }, p);
      if (a) {
        const k = Math.min(1, a.t / a.dur);
        if (a.kind === 'punch') Poses.punch(q, k, this.facing);
        else if (a.kind === 'axe') Poses.axeSwing(q, k, this.facing);
        else if (a.kind === 'knifeThrow' || a.kind === 'bomb' || a.kind === 'axeThrow') Poses.throwArm(q, this.facing, k);
        else if (a.kind === 'shoot') Poses.aimPistol(q, this.facing, k > 0.7 ? 1 - (k - 0.7) * 3 : 0);
        else if (a.kind === 'rocket') Poses.shoulderTube(q, this.facing);
        layerUpper(p, q, 1);
        if (a.kind === 'axe' || a.kind === 'punch') p.spineX = q.spineX;
        rate = 24;
      } else if (this.type === 'bazooka') {
        Poses.shoulderTube(q, this.facing);
        layerUpper(p, q, 0.85);
      } else if (this.type === 'granny' && !this.pramFree) {
        Poses.push(q);
        layerUpper(p, q, 1);
        p.spineX = 0.3;
      } else if (this.carrying) {
        Poses.carry(q);
        layerUpper(p, q, 1);
      } else if (this.type === 'axeman') {
        q.shRX = -0.5; q.elRX = -1.4; layerUpper(p, q, 0.8);
      }
      if (this.stun > 0) Poses.hurt(p, 1 - this.stun / 0.45);
    }
    r.update(dt, p, rate);
    r.root.position.set(b.x, b.y + (this.bike && this.state !== 'dead' ? 0.62 : 0), this.z);
    if (this.bike && this.state !== 'dead') {
      const seat = this.bike.getObjectByName('seat');
      if (seat) {
        this.bike.updateMatrixWorld();
        const wp = seat.getWorldPosition(new THREE.Vector3());
        r.root.position.set(wp.x, wp.y - r.hipH * 0.72, 0);
      }
    }
    const gy = this.game.world.groundAt(b.x, b.y + 0.05);
    const hgt = isFinite(gy) ? b.y - gy : 10;
    r.blob.position.y = -hgt + 0.015;
    r.blob.visible = hgt < 5 && !this.bike;
    if (this.pram && !this.pramFree) {
      this.pram.position.set(b.x + this.facing * 0.95, b.y, 0);
      this.pram.rotation.y = this.facing > 0 ? 0 : Math.PI;
    }
  }
}

// Rolling pram hazard (jump over it!). Shootable.
export class Pram {
  constructor(game, mesh, x, y, vx) {
    this.game = game;
    this.mesh = mesh;
    game.scene.add(mesh);
    this.body = { x, y, vx, vy: 0, w: 0.9, h: 1.05, onGround: true, ground: null, dropTimer: 0 };
    this.alive = true;
    this.isProp = true;
    this.t = 0;
    this.hp = 25;
  }
  bounds() { const b = this.body; return { x0: b.x - 0.5, x1: b.x + 0.5, y0: b.y, y1: b.y + 1.05 }; }
  hit(dmg, info = {}) {
    this.hp -= dmg;
    this.game.particles.sparks(this.body.x, this.body.y + 0.6, 0.1, 6);
    if (this.hp <= 0) this.crash(info.dir || 1);
  }
  crash(dir) {
    if (!this.alive) return;
    this.alive = false;
    this.crashT = 0;
    this.spin = dir * 6;
    this.body.vy = 5;
    this.body.vx = dir * 3;
    sound.sfx('pramCrash', { x: this.body.x });
    this.game.particles.dust(this.body.x, this.body.y, 0, 8);
    this.game.addScore(150, this.body.x, this.body.y + 1.2);
  }
  update(dt) {
    const g = this.game;
    const b = this.body;
    this.t += dt;
    if (!this.alive) {
      this.crashT += dt;
      b.vy -= 30 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.mesh.rotation.z += this.spin * dt;
      const gy = g.world.groundAt(b.x, b.y + 0.5);
      if (b.y < gy) { b.y = gy; b.vy *= -0.3; this.spin *= 0.5; b.vx *= 0.5; }
      this.mesh.position.set(b.x, b.y, 0);
      if (this.crashT > 3) { this.mesh.removeFromParent(); this.dead = true; }
      return;
    }
    const ev = moveBody(g.world, b, dt);
    if (ev.hitWall) this.crash(-Math.sign(b.vx));
    if (b.onGround) {
      const ahead = g.world.groundAt(b.x + Math.sign(b.vx) * 0.5, b.y + 0.2);
      if (b.y - ahead > 0.5) { /* rolls off the edge */ }
    }
    this.mesh.position.set(b.x, b.y, 0);
    this.mesh.rotation.y = b.vx > 0 ? 0 : Math.PI;
    this.mesh.rotation.z = Math.sin(this.t * 22) * 0.025;
    const wheels = this.mesh.getObjectByName('wheels');
    if (wheels) wheels.children.forEach((w) => { w.rotation.z -= b.vx * dt * 3; });
    if (Math.random() < 0.08) sound.sfx('pram', { x: b.x, volume: 0.25 });
    // hit Cobra
    const pb = g.player.bounds(), eb = this.bounds();
    if (g.player.alive && pb.x1 > eb.x0 && pb.x0 < eb.x1 && pb.y0 < eb.y1 - 0.15 && pb.y1 > eb.y0) {
      if (g.player.pill > 0) this.crash(Math.sign(b.vx));
      else if (g.player.hit(22, { dir: Math.sign(b.vx) })) this.crash(-Math.sign(b.vx));
    }
    if (Math.abs(b.x - g.player.body.x) > 40 || this.t > 12) { this.mesh.removeFromParent(); this.dead = true; this.alive = false; }
  }
}

function fallbackPram() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: '#2a3550', roughness: 0.5 }));
  body.position.y = 0.6;
  g.add(body);
  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  for (const [x, z] of [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.25], [0.3, -0.25]]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), new THREE.MeshStandardMaterial({ color: '#111' }));
    w.position.set(x, 0.18, z);
    wheels.add(w);
  }
  g.add(wheels);
  return g;
}

function fallbackBike() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.7, roughness: 0.3 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.3), m);
  frame.position.y = 0.6;
  g.add(frame);
  for (const [n, x] of [['wheelF', 0.85], ['wheelR', -0.85]]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.08, 8, 20), new THREE.MeshStandardMaterial({ color: '#111' }));
    w.name = n;
    w.position.set(x, 0.38, 0);
    g.add(w);
  }
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(-0.15, 0.9, 0);
  g.add(seat);
  return g;
}
