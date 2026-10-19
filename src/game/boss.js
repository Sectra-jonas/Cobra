// The Night Slasher: three-phase boss fight in the foundry, ending like the film –
// a moving hook carries him into the furnace.
import * as THREE from 'three';
import { createCharacter } from '../actors/characters.js';
import { Poses, emptyPose, layerUpper, copyPose } from '../actors/rig.js';
import { moveBody } from './physics.js';
import { sound } from '../core/sound.js';

const MAX_HP = 1400;

export class Boss {
  constructor(game, x, y, arena) {
    this.game = game;
    this.arena = arena; // { x0, x1, furnaceX, hookY }
    this.rig = createCharacter('slasher');
    game.scene.add(this.rig.root);
    this.body = { x, y, vx: 0, vy: 0, w: 0.7, h: 1.95, onGround: false, ground: null, dropTimer: 0 };
    this.hp = MAX_HP * game.difficulty.enemyHp;
    this.maxHp = this.hp;
    this.alive = true;
    this.state = 'dormant';
    this.t = 0;
    this.stateT = 0;
    this.facing = -1;
    this.pose = emptyPose();
    this.phase = 1;
    this.cool = 1.5;
    this.recent = 0;
    this.staggerT = 0;
    this.runPhase = 0;
    this.combo = 0;
    this.calls = 0;
    this.aura = 0;
    this.name = 'THE NIGHT SLASHER';
  }

  get isEnemy() { return true; }

  bounds() {
    const b = this.body;
    return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + (this.state === 'lunge' ? 1.5 : b.h) };
  }

  wake() {
    this.state = 'intro';
    this.stateT = 0;
  }

  hit(dmg, info = {}) {
    if (!this.alive || this.state === 'dormant' || this.state === 'intro' || this.state === 'finale') return;
    const g = this.game;
    const mult = this.state === 'stagger' ? 2 : 1;
    this.hp -= dmg * mult * 0.85;
    this.recent += dmg;
    this.rig.flash(0.08);
    this.rig.impulse('spineX', info.kind === 'melee' ? -4 : -1.5);
    this.rig.impulse('headX', -3);
    g.particles.blood(info.x ?? this.body.x, info.y ?? this.body.y + 1.4, 0.1, info.dir || 1, 8);
    sound.sfx('enemyHurt', { x: this.body.x, pitch: 0.7 });
    if (this.recent > 170 && this.state !== 'stagger' && this.state !== 'leap') {
      this.recent = 0;
      this.setState('stagger');
      this.body.vx = (info.dir || 1) * 4;
      sound.sfx('bossRoar', { x: this.body.x });
      g.camRig.shake(0.3);
    }
    if (this.hp <= 0) { this.defeat(); return; }
    const f = this.hp / this.maxHp;
    if (this.phase === 1 && f < 0.62) this.enterPhase(2);
    else if (this.phase === 2 && f < 0.3) this.enterPhase(3);
  }

  enterPhase(p) {
    const g = this.game;
    this.phase = p;
    sound.sfx('bossLaugh', { x: this.body.x });
    g.hud.banner(p === 2 ? 'HE CALLS HIS ARMY' : 'BLOOD RAGE', p === 2 ? 'The New World answers the Night Slasher' : 'He\'s faster now — keep moving', 2.2);
    this.setState('call');
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    this.fired = false;
  }

  defeat() {
    const g = this.game;
    this.hp = 0;
    this.alive = false;
    this.setState('finale');
    g.bossDefeated(this);
  }

  // ------------------------------------------------------------------ AI
  update(dt) {
    const g = this.game;
    const b = this.body;
    const P = g.player.body;
    this.t += dt;
    this.stateT += dt;
    this.cool -= dt;
    this.recent = Math.max(0, this.recent - dt * 60);
    const dx = P.x - b.x, adx = Math.abs(dx);
    const speedMul = this.phase === 3 ? 1.3 : this.phase === 2 ? 1.12 : 1;
    let want = 0;

    switch (this.state) {
      case 'dormant':
        break;
      case 'intro':
        // stands on the catwalk, laughs, then drops to the floor
        this.facing = Math.sign(dx) || -1;
        if (this.stateT > 2.6 && !this.fired) {
          this.fired = true;
          b.vy = 9; b.vx = Math.sign(dx) * 3;
          b.dropTimer = 0.6; b.dropFrom = b.ground;
          sound.sfx('whoosh', { x: b.x });
        }
        if (this.fired && b.onGround && b.y < 0.5) { this.setState('stalk'); g.camRig.shake(0.5); g.particles.dust(b.x, 0, 0, 14, [0.4, 0.3, 0.25]); sound.sfx('land', { x: b.x }); }
        break;
      case 'stalk': {
        this.facing = Math.sign(dx) || this.facing;
        const ideal = this.phase === 1 ? 3.2 : 2.4;
        if (adx > ideal + 0.6) want = Math.sign(dx);
        else if (adx < 1.4) want = -Math.sign(dx) * 0.6;
        if (Math.abs(P.y - b.y) > 2.2 && this.cool <= 0) { this.setState('leap'); break; }
        if (this.cool <= 0 && g.player.alive) {
          const r = Math.random();
          if (adx < 2.6) this.setState('slash');
          else if (adx < 9 && r < 0.45) this.setState('lunge');
          else if (r < 0.75) this.setState('throw');
          else this.setState('leap');
        }
        break;
      }
      case 'slash': {
        // three-hit combo, each with a short windup glint
        const per = this.phase === 3 ? 0.42 : 0.55;
        const hitN = Math.floor(this.stateT / per);
        const k = (this.stateT % per) / per;
        this.facing = Math.sign(dx) || this.facing;
        if (k < 0.1 && !this['glint' + hitN]) { this['glint' + hitN] = true; g.particles.glow(b.x + this.facing * 0.6, b.y + 1.7, 0.3, [5, 4, 3], 0.5, 0.15); sound.sfx('bossSlash', { x: b.x, volume: 0.6 }); }
        if (k > 0.5 && !this['hit' + hitN] && hitN < 3) {
          this['hit' + hitN] = true;
          b.vx = this.facing * 3.5;
          if (Math.sign(dx) === this.facing && adx < 2.1 && Math.abs(P.y - b.y) < 1.6) g.player.hit(20, { dir: this.facing });
        }
        this.slashK = k; this.slashN = hitN;
        if (this.stateT > per * 3) { for (let i = 0; i < 3; i++) { this['glint' + i] = false; this['hit' + i] = false; } this.recover(0.9); }
        break;
      }
      case 'lunge': {
        // telegraph (crouch + eye glint), then a chest-high dash: duck under it or jump it
        const tele = this.phase === 3 ? 0.45 : 0.65;
        if (this.stateT < tele) {
          this.facing = Math.sign(dx) || this.facing;
          b.vx *= 0.8;
          if (Math.random() < 0.5) g.particles.glow(b.x + this.facing * 0.1, b.y + 1.75, 0.3, [6, 0.4, 0.3], 0.18, 0.06);
          if (!this.fired) { this.fired = true; sound.sfx('bossRoar', { x: b.x, volume: 0.6 }); }
        } else if (this.stateT < tele + 0.55) {
          b.vx = this.facing * 17 * speedMul;
          if (Math.random() < 0.8) g.particles.dust(b.x, b.y, 0, 1, [0.5, 0.35, 0.25]);
          const pb = g.player.bounds();
          if (!this.lungeHit && pb.x1 > b.x - 0.6 && pb.x0 < b.x + 0.6 && pb.y0 < b.y + 1.55 && pb.y1 > b.y + 1.25) {
            this.lungeHit = true;
            g.player.hit(30, { dir: this.facing });
          }
        } else { this.lungeHit = false; b.vx *= 0.85; if (this.stateT > tele + 0.9) this.recover(1.0); }
        break;
      }
      case 'throw': {
        this.facing = Math.sign(dx) || this.facing;
        if (this.stateT > 0.55 && !this.fired) {
          this.fired = true;
          const n = this.phase === 1 ? 2 : 3;
          const heights = [0.45, 1.45, 2.2].slice(0, n);
          heights.forEach((h, i) => setTimeout(() => {
            if (!this.alive) return;
            g.projectiles.spawn({ kind: 'knife', owner: 'enemy', x: b.x + this.facing * 0.5, y: b.y + h, vx: this.facing * (15 + i), vy: 0, dmg: 18, radius: 0.08 });
            sound.sfx('knifeThrow', { x: b.x });
          }, i * 160));
        }
        if (this.stateT > 1.1) this.recover(0.8);
        break;
      }
      case 'leap': {
        // big jump toward Cobra, slam shockwave on landing (jump to avoid)
        if (!this.fired) {
          this.fired = true;
          const T = 1.0;
          const tx = THREE.MathUtils.clamp(P.x, this.arena.x0 + 1, this.arena.x1 - 1);
          b.vx = (tx - b.x) / T;
          b.vy = 15;
          b.onGround = false;
          sound.sfx('whoosh', { x: b.x, pitch: 0.7 });
        }
        if (this.stateT > 0.2 && b.onGround) {
          g.camRig.shake(0.6);
          g.particles.dust(b.x, b.y, 0, 18, [0.45, 0.32, 0.25]);
          g.particles.ring(b.x, b.y + 0.2, 0.2, [4, 2, 0.8], 6, 0.4);
          sound.sfx('metalHit', { x: b.x, pitch: 0.6 });
          sound.sfx('explosion', { x: b.x, volume: 0.5, pitch: 1.4 });
          if (Math.abs(P.y - b.y) < 0.6 && adx < 4.2 && g.player.body.onGround) g.player.hit(24, { dir: Math.sign(dx) || 1 });
          this.recover(1.1);
        }
        break;
      }
      case 'call': {
        // clangs his blade overhead: cultists answer
        b.vx *= 0.8;
        if (Math.floor(this.stateT / 0.45) !== this.clang && this.stateT < 1.8) {
          this.clang = Math.floor(this.stateT / 0.45);
          sound.sfx('axeClang', { x: b.x });
          g.particles.sparks(b.x, b.y + 2.3, 0.2, 8);
        }
        if (this.stateT > 1.0 && !this.fired) {
          this.fired = true;
          const n = this.phase === 2 ? 2 : 3;
          for (let i = 0; i < n; i++) {
            const side = i % 2 ? 1 : -1;
            const ex = THREE.MathUtils.clamp(b.x + side * (9 + i), this.arena.x0 + 1, this.arena.x1 - 1);
            setTimeout(() => g.spawnEnemy(i === 2 ? 'gunner' : 'axeman', ex, 0.05, { facing: -side }), i * 600);
          }
        }
        if (this.stateT > 2.2) { this.aura = this.phase === 3 ? 1 : 0; this.recover(0.6); }
        break;
      }
      case 'stagger':
        b.vx *= 0.9;
        if (this.stateT > 1.4) this.recover(0.5);
        break;
      case 'finale':
        return; // driven by the level's finale script
      default: break;
    }

    if (this.state === 'stalk') {
      const tv = want * 4.6 * speedMul * g.difficulty.enemySpeed;
      b.vx += (tv - b.vx) * Math.min(1, dt * 8);
    }
    moveBody(g.world, b, dt);
    b.x = THREE.MathUtils.clamp(b.x, this.arena.x0, this.arena.x1);

    // contact damage when rushing through Cobra
    const pb = g.player.bounds();
    if (this.state === 'stalk' && pb.x1 > b.x - 0.3 && pb.x0 < b.x + 0.3 && pb.y0 < b.y + 1.8 && pb.y1 > b.y) {
      if (g.player.pill > 0) this.hit(40, { dir: -this.facing, kind: 'melee' });
      else g.player.hit(12, { dir: Math.sign(dx) || 1 });
    }
    if (this.aura > 0 && Math.random() < 0.4) g.particles.embers(b.x, b.y + 0.8, 0.2, 1, 0.4);
    this.animate(dt);
  }

  recover(cool) {
    this.setState('stalk');
    this.cool = cool * (this.phase === 3 ? 0.6 : this.phase === 2 ? 0.8 : 1) * this.game.difficulty.enemyCooldown;
  }

  animate(dt) {
    const b = this.body;
    const p = this.pose;
    for (const k in p) p[k] = 0;
    let rate = 14;
    this.rig.setFacing(this.facing);
    const t = this.t;
    if (!b.onGround) Poses.jump(p, b.vy);
    else if (Math.abs(b.vx) > 0.4) {
      this.runPhase += dt * Math.abs(b.vx) * (2 * Math.PI / 3.2);
      Poses.run(p, this.runPhase, Math.min(1, Math.abs(b.vx) / 6));
    } else {
      Poses.idle(p, t);
      p.spineX = 0.12; p.neckX = 0.1; p.headX = 0.12; // predatory hunch
      p.shRX = -0.6; p.elRX = -1.2;
    }
    const q = copyPose({ ...p }, p);
    switch (this.state) {
      case 'slash': {
        const k = this.slashK || 0;
        Poses.punch(q, k, this.facing);
        q.shRZ = (this.slashN % 2 ? 0.6 : -0.6) * (1 - k);
        layerUpper(p, q, 1);
        p.spineX = 0.3;
        rate = 26;
        break;
      }
      case 'lunge':
        if (this.stateT < 0.6) { Poses.crouch(p, t); p.shRX = 0.5; p.elRX = -1.6; }
        else { p.spineX = 0.7; p.shRX = -1.6; p.elRX = -0.1; p.shLX = 0.8; p.thLX = -1.0; p.knLX = 0.6; p.thRX = 0.6; p.knRX = 0.4; }
        rate = 24;
        break;
      case 'throw':
        Poses.throwArm(q, this.facing, Math.min(1, this.stateT / 0.8));
        layerUpper(p, q, 1);
        rate = 22;
        break;
      case 'call':
        Poses.victory(q, t);
        q.shLX = -2.8; q.shLZ = 0.2; q.elLX = -0.4;
        layerUpper(p, q, 1);
        p.headX = -0.3;
        break;
      case 'stagger':
        Poses.hurt(p, Math.min(1, this.stateT / 1.4));
        p.spineX = 0.5; p.hipsY = -0.15; p.knLX = 0.5; p.knRX = 0.5;
        break;
      case 'intro':
        Poses.victory(q, t);
        layerUpper(p, q, Math.min(1, this.stateT));
        break;
      default: break;
    }
    this.rig.update(dt, p, rate);
    this.rig.root.position.set(b.x, b.y, 0);
    const gy = this.game.world.groundAt(b.x, b.y + 0.05);
    const hgt = isFinite(gy) ? b.y - gy : 10;
    this.rig.blob.position.y = -hgt + 0.015;
  }
}
