// Marion "Cobra" Cobretti – player controller, weapons and animation.
import * as THREE from 'three';
import { createCharacter } from '../actors/characters.js';
import { Poses, emptyPose, layerUpper, copyPose } from '../actors/rig.js';
import { moveBody, dropThrough } from './physics.js';
import { WEAPONS } from './combat.js';
import { input } from '../core/input.js';
import { sound } from '../core/sound.js';

const RUN = 7.2, ACC_G = 55, ACC_A = 30, FRICTION = 40;
const JUMP_V = 16.2;

export class Player {
  constructor(game) {
    this.game = game;
    this.rig = createCharacter('cobra');
    game.scene.add(this.rig.root);
    this.body = { x: 0, y: 0, vx: 0, vy: 0, w: 0.62, h: 1.8, onGround: false, ground: null, dropTimer: 0, climbing: false, ladder: null };
    this.facing = 1;
    this.z = 0;
    this.pose = emptyPose();
    this.tmp = emptyPose();
    this.reset(true);

    // laser sight beam + dot
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.15, 0.1), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0), beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    game.scene.add(this.beam);
    this.muzzleWP = new THREE.Vector3();
  }

  reset(full = false) {
    this.hp = 100;
    this.maxHp = 100;
    this.weapon = 'headbutt';
    this.weaponTime = 0;
    this.pill = 0;
    this.invuln = 0;
    this.state = 'normal';
    this.action = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.runPhase = 0;
    this.lastPhaseStep = 0;
    this.crouching = false;
    this.cooldown = 0;
    this.recoil = 0;
    this.aimHold = 0;
    this.deadT = 0;
    this.hurtT = 0;
    this.time = 0;
    this.control = true;
    this.body.vx = this.body.vy = 0;
    this.body.climbing = false;
    if (full) { this.grenades = 3; this.owned = new Set(); }
  }

  get alive() { return this.state !== 'dead'; }

  spawnAt(x, y) {
    this.body.x = x;
    this.body.y = y;
    this.body.vx = this.body.vy = 0;
    this.body.onGround = false;
    this.rig.root.position.set(x, y, 0);
  }

  bounds() {
    const b = this.body;
    return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h };
  }

  giveWeapon(w) {
    if (w === 'pill') {
      this.pill = 10;
      sound.sfx('powerup');
      this.owned.add('pill');
      return;
    }
    this.weapon = w;
    this.weaponTime = 1;
    this.owned.add(w);
    sound.sfx('gunCock', { volume: 0.8 });
  }

  // ------------------------------------------------------------- damage

  hit(dmg, info = {}) {
    if (this.state === 'dead' || this.invuln > 0 || !this.control) return false;
    if (this.pill > 0) return false;
    const g = this.game;
    this.hp -= dmg * g.difficulty.damage;
    this.invuln = 1.1;
    this.hurtT = 0.35;
    this.rig.flash(0.12);
    this.rig.impulse('spineX', -4);
    this.rig.impulse('headX', -6);
    const dir = info.dir || -this.facing;
    this.body.vx = dir * 6;
    if (!this.body.climbing) this.body.vy = Math.max(this.body.vy, 4.5);
    this.body.climbing = false;
    g.particles.blood(this.body.x, this.body.y + 1.3, 0.1, dir, 10);
    g.camRig.shake(0.45);
    g.renderer.hurt(0.8);
    g.hitStop(0.06);
    sound.sfx('playerHurt');
    sound.sfx('hit', { volume: 0.8 });
    if (this.hp <= 0) {
      if (g.ingrid && g.ingrid.state === 'following') {
        // Ingrid takes the fall: she's snatched away instead of Cobra losing a life
        this.hp = 55;
        g.ingrid.abduct('lethal');
        g.hud.banner('INGRID TAKEN!', 'Find her again before the Night Slasher does', 3);
        this.invuln = 2.2;
      } else {
        this.die();
      }
    }
    return true;
  }

  die() {
    this.state = 'dead';
    this.deadT = 0;
    this.hp = 0;
    this.body.climbing = false;
    this.body.vx = -this.facing * 4;
    this.body.vy = 6;
    this.weapon = 'headbutt';
    this.weaponTime = 0;
    this.pill = 0;
    sound.sfx('playerDie');
    sound.duck(0.7, 1.5);
    this.game.onPlayerDeath();
  }

  // ------------------------------------------------------------- update

  update(dt) {
    const g = this.game;
    const b = this.body;
    this.time += dt;
    if (this.scripted) {
      // cinematic control: pose/position supplied by the director
      const sp = this.scriptPose;
      // place the root first so run-time IK (hands on props) solves against this frame's position
      if (this.scriptPos) { b.x = this.scriptPos.x; b.y = this.scriptPos.y; this.rig.root.position.copy(this.scriptPos); }
      this.rig.update(dt, sp, this.scriptRate || 10, this.scriptYaw ?? null);
      this.rig.blob.position.y = 0.015;
      this.rig.root.visible = this.scriptVisible !== false;
      if (!this.scriptLaser) this.beam.visible = false;
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.pill > 0) {
      this.pill -= dt;
      if (Math.random() < 0.6) g.particles.sparkle(b.x, b.y + 0.9, 0.1, [3, 2.6, 0.8]);
      if (this.pill <= 0) { sound.sfx('quack'); g.hud.toast('INVINCIBILITY WORE OFF'); }
    }

    if (this.state === 'dead') {
      this.deadT += dt;
      b.vx *= 0.96;
      moveBody(g.world, b, dt);
      this.animate(dt);
      return;
    }

    const ctl = this.control && g.state === 'play';
    const ax = ctl ? input.axisX() : 0;
    const wantDown = ctl && input.down('down');
    const wantUp = ctl && input.down('up');
    const ladderNear = g.world.ladderAt(b.x, b.y + 0.1, 0.5);
    const ladderBelow = b.onGround ? g.world.ladderAt(b.x, b.y - 0.3, 0.5) : null;

    // ---- ladders
    if (!b.climbing && ctl) {
      if (input.pressed('up') && ladderNear && b.y < ladderNear.y1 - 0.15) this.startClimb(ladderNear);
      else if (input.pressed('down') && ladderBelow && ladderBelow.y1 <= b.y + 0.2 && ladderBelow.y0 < b.y - 0.5) {
        this.startClimb(ladderBelow);
        b.y -= 0.35;
      }
    }
    if (b.climbing) {
      const L = b.ladder;
      b.vx = 0;
      b.vy = (wantUp ? 1 : 0) * 4.2 - (wantDown ? 1 : 0) * 4.6;
      if (Math.abs(b.vy) > 0) {
        this.runPhase += dt * 7;
        if (Math.floor(this.runPhase / Math.PI) !== this.lastPhaseStep) { this.lastPhaseStep = Math.floor(this.runPhase / Math.PI); sound.sfx('ladder', { x: b.x, volume: 0.5 }); }
      }
      moveBody(g.world, b, dt);
      if (b.y >= L.y1) { b.y = L.y1; b.climbing = false; b.vy = 0; b.onGround = true; b.ground = { y: L.y1 }; }
      else if (b.y <= L.y0 && wantDown) { b.y = L.y0; b.climbing = false; }
      if (ctl && (input.pressed('jump') || (ax !== 0 && input.pressed('jump')))) {
        b.climbing = false;
        b.vy = JUMP_V * 0.6;
        b.vx = ax * RUN * 0.6;
        sound.sfx('jump', { volume: 0.6 });
      }
      if (ax !== 0) this.facing = ax;
      this.animate(dt);
      return;
    }

    // ---- crouch / drop-through
    this.crouching = ctl && wantDown && b.onGround;
    if (this.crouching && input.pressed('jump')) {
      if (dropThrough(b)) { this.crouching = false; sound.sfx('whoosh', { volume: 0.4 }); }
    }
    b.h = this.crouching ? 1.15 : 1.8;

    // ---- horizontal
    const target = this.crouching || (this.action && this.action.type === 'headbutt' && b.onGround) ? 0 : ax * RUN;
    const acc = b.onGround ? (ax !== 0 ? ACC_G : FRICTION) : ACC_A;
    if (this.hurtT <= 0) {
      if (b.vx < target) b.vx = Math.min(target, b.vx + acc * dt);
      else if (b.vx > target) b.vx = Math.max(target, b.vx - acc * dt);
    }
    if (ax !== 0 && !(this.action && this.action.lockFacing)) this.facing = ax;

    // ---- jumping
    if (b.onGround) this.coyote = 0.11; else this.coyote -= dt;
    const jumpPressed = ctl && (input.pressed('jump') && !this.crouching || (input.pressed('up') && !ladderNear));
    if (jumpPressed) this.jumpBuffer = 0.13; else this.jumpBuffer -= dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      b.vy = JUMP_V;
      b.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpCut = false;
      sound.sfx('jump', { volume: 0.7 });
      g.particles.dust(b.x, b.y, 0, 4);
      if (g.def.rain) g.particles.splash(b.x, b.y, 0, 6);
    }
    if (!this.jumpCut && b.vy > 0 && ctl && !input.down('jump') && !input.down('up')) {
      b.vy *= 0.55;
      this.jumpCut = true;
    }

    const wasAir = !b.onGround;
    const ev = moveBody(g.world, b, dt);
    if (ev.landed && wasAir) {
      sound.sfx('land', { volume: Math.min(1, ev.fallSpeed / 18) });
      g.particles.dust(b.x, b.y, 0, Math.min(10, Math.floor(ev.fallSpeed / 3)));
      if (g.def.rain) g.particles.splash(b.x, b.y, 0, 10);
      if (ev.fallSpeed > 17) g.camRig.shake(0.15);
      this.rig.impulse('spineX', ev.fallSpeed * 0.12);
    }

    // hazards (molten metal, pits)
    const hz = g.world.hazardAt(b.x, b.y, b.w, b.h);
    if (hz) { this.invuln = 0; this.pill = 0; this.hit(999, { dir: -this.facing }); }
    if (b.y < -12) { this.invuln = 0; this.hit(999, {}); }

    // ---- footsteps
    if (b.onGround && Math.abs(b.vx) > 0.5) {
      this.runPhase += dt * Math.abs(b.vx) * (2 * Math.PI / 3.1);
      const step = Math.floor(this.runPhase / Math.PI);
      if (step !== this.lastPhaseStep) {
        this.lastPhaseStep = step;
        sound.sfx(g.def.metalFloor && b.y > 0.5 ? 'metalStep' : 'step', { x: b.x, volume: 0.45 });
        if (g.def.rain) g.particles.splash(b.x + this.facing * 0.2, b.y, 0.05, 4);
        else if (g.def.dusty) g.particles.dust(b.x, b.y, 0, 1, [0.7, 0.6, 0.45]);
      }
    }

    // ---- weapons
    if (ctl) this.updateWeapons(dt);
    this.animate(dt);
  }

  startClimb(L) {
    const b = this.body;
    b.climbing = true;
    b.ladder = L;
    b.vx = 0;
    b.vy = 0;
    this.action = null;
    this.crouching = false;
    b.h = 1.8;
  }

  updateWeapons(dt) {
    const g = this.game;
    const b = this.body;
    // weapon timer drains continuously (the Quackometer)
    if (this.weapon !== 'headbutt') {
      this.weaponTime -= dt / WEAPONS[this.weapon].duration;
      if (this.weaponTime <= 0) this.loseWeapon();
    }
    if (this.action) {
      this.action.t += dt;
      const a = this.action;
      if (a.type === 'headbutt' && !a.hitDone && a.t >= a.dur * 0.42) { a.hitDone = true; this.meleeHit(); }
      if (a.type === 'throw' && !a.released && a.t >= a.dur * 0.45) { a.released = true; this.releaseKnife(); }
      if (a.t >= a.dur) this.action = null;
    }
    if (input.pressed('grenade') && this.grenades > 0 && this.cooldown <= 0 && !this.action) {
      this.grenades--;
      this.action = { type: 'throw', t: 0, dur: 0.42, grenade: true, lockFacing: true };
      this.cooldown = 0.45;
      sound.sfx('grenadeThrow');
    }
    const W = WEAPONS[this.weapon];
    const firing = W.auto ? input.down('fire') : input.pressed('fire');
    if (firing && this.cooldown <= 0 && !this.action) {
      this.cooldown = W.cooldown;
      if (this.weapon === 'headbutt') {
        this.action = { type: 'headbutt', t: 0, dur: 0.36, lockFacing: true };
        sound.sfx('whoosh', { volume: 0.5, pitch: 0.8 });
      } else if (this.weapon === 'knife') {
        this.action = { type: 'throw', t: 0, dur: 0.3, lockFacing: true };
        sound.sfx('knifeThrow');
        this.weaponTime -= W.drain;
      } else {
        this.shoot(W);
      }
    }
  }

  loseWeapon() {
    this.weapon = 'headbutt';
    this.weaponTime = 0;
    sound.sfx('quack');
    this.game.hud.toast('QUACK! Weapon worn out');
    this.game.particles.sparkle(this.body.x, this.body.y + 1.5, 0.2, [3, 3, 0.5]);
  }

  gunY() { return this.body.y + (this.crouching ? 0.92 : 1.42); }

  shoot(W) {
    const g = this.game;
    const b = this.body;
    const dir = this.facing;
    this.aimHold = 0.9;
    this.recoil = 1;
    this.weaponTime -= W.drain;
    const y = this.gunY();
    const mx = b.x + dir * (this.weapon === 'smg' ? 0.85 : 0.78);
    const spread = (W.spread || 0) * (Math.random() * 2 - 1);
    g.projectiles.spawn({ kind: 'bullet', owner: 'player', x: mx, y, vx: dir * W.speed, vy: spread * W.speed, dmg: W.dmg * g.difficulty.playerDamage });
    g.particles.muzzle(mx + dir * 0.05, y, 0.12, dir, this.weapon === 'pistol');
    g.particles.shell(b.x + dir * 0.3, y + 0.05, 0.1, dir);
    g.lights.flash(mx + dir * 0.3, y, 0.8, '#ffb35a', this.weapon === 'pistol' ? 90 : 55, 9, 0.06);
    sound.sfx(this.weapon === 'pistol' ? 'pistol' : 'mg', { x: b.x });
    g.camRig.shake(this.weapon === 'pistol' ? 0.12 : 0.05);
    this.rig.impulse('chestX', -1.2);
  }

  releaseKnife() {
    const g = this.game;
    const b = this.body;
    const dir = this.facing;
    if (this.action.grenade) {
      g.projectiles.spawn({ kind: 'grenade', owner: 'player', x: b.x + dir * 0.5, y: b.y + 1.7, vx: dir * 9 + b.vx * 0.5, vy: 7.5, fuse: 1.3 });
      return;
    }
    const W = WEAPONS.knife;
    g.projectiles.spawn({ kind: 'knife', owner: 'player', x: b.x + dir * 0.6, y: this.gunY() + 0.05, vx: dir * W.speed, vy: 0, dmg: W.dmg * g.difficulty.playerDamage, radius: 0.12 });
  }

  meleeHit() {
    const g = this.game;
    const b = this.body;
    const dir = this.facing;
    const box = this.crouching
      ? { x0: Math.min(b.x, b.x + dir * 1.25), x1: Math.max(b.x, b.x + dir * 1.25), y0: b.y + 0.1, y1: b.y + 1.3 }
      : { x0: Math.min(b.x, b.x + dir * 1.3), x1: Math.max(b.x, b.x + dir * 1.3), y0: b.y + 0.55, y1: b.y + 2.0 };
    let hits = 0;
    for (const t of g.hittables()) {
      if (!t.alive) continue;
      const tb = t.bounds();
      if (tb.x1 < box.x0 || tb.x0 > box.x1 || tb.y1 < box.y0 || tb.y0 > box.y1) continue;
      t.hit(WEAPONS.headbutt.dmg * g.difficulty.playerDamage, { x: b.x + dir * 0.7, y: b.y + 1.6, dir, kind: 'melee', owner: 'player' });
      hits++;
      if (hits >= 2) break;
    }
    if (hits) {
      sound.sfx('headbutt', { x: b.x });
      g.hitStop(0.07);
      g.camRig.shake(0.22);
      g.particles.sparks(b.x + dir * 0.75, b.y + 1.6, 0.1, 5, dir, [3, 3, 3]);
    }
  }

  // ------------------------------------------------------------- anim

  animate(dt) {
    const b = this.body;
    const r = this.rig;
    const p = this.tmp;
    for (const k in p) p[k] = 0;
    let rate = 14;
    let yaw = null;
    r.setFacing(this.facing);
    const armed = this.weapon === 'pistol' || this.weapon === 'smg';
    r.show('pistol', this.weapon === 'pistol');
    r.show('smg', this.weapon === 'smg');
    r.show('knife', this.weapon === 'knife' && !(this.action && this.action.released));

    if (this.state === 'dead') {
      Poses.dead(p, Math.min(1, this.deadT * 2.2), -1);
      rate = 10;
    } else if (b.climbing) {
      Poses.climb(p, this.runPhase);
      yaw = Math.PI;
      rate = 16;
    } else if (!b.onGround) {
      Poses.jump(p, b.vy);
      rate = 10;
    } else if (this.crouching) {
      Poses.crouch(p, this.time);
      rate = 18;
    } else if (Math.abs(b.vx) > 0.4) {
      Poses.run(p, this.runPhase, Math.min(1, Math.abs(b.vx) / 6.5));
      rate = 18;
    } else {
      Poses.idle(p, this.time, armed ? 1 : 0);
    }

    if (this.state !== 'dead' && !b.climbing) {
      const a = this.action;
      if (a && a.type === 'headbutt') {
        const q = copyPose({ ...p }, p);
        Poses.headbutt(q, Math.min(1, a.t / a.dur));
        layerUpper(p, q, 1);
        p.spineX = q.spineX * (this.crouching ? 0.6 : 1) + (this.crouching ? 0.4 : 0);
        rate = 30;
      } else if (a && a.type === 'throw') {
        const q = copyPose({ ...p }, p);
        Poses.throwArm(q, this.facing, Math.min(1, a.t / a.dur));
        layerUpper(p, q, 1);
        rate = 30;
      } else if (armed && (this.aimHold > 0 || Math.abs(b.vx) > 0.4 || this.crouching)) {
        const q = copyPose({ ...p }, p);
        if (this.weapon === 'smg') Poses.aimSMG(q, this.facing, this.recoil);
        else Poses.aimPistol(q, this.facing, this.recoil);
        layerUpper(p, q, 1);
        if (this.crouching) p.spineX = 0.15;
        rate = Math.max(rate, 22);
      }
      if (this.hurtT > 0) Poses.hurt(p, 1 - this.hurtT / 0.35);
    }
    r.update(dt, p, rate, yaw);
    r.root.position.set(b.x, b.y, this.z);

    // contact shadow follows the ground below
    const gy = this.game.world.groundAt(b.x, b.y + 0.05);
    const hgt = isFinite(gy) ? b.y - gy : 10;
    r.blob.position.y = -hgt + 0.015;
    r.blob.material.opacity = 0.55 * Math.max(0, 1 - hgt / 5);
    r.blob.visible = hgt < 5;

    // invulnerability flicker / invincibility glow
    const flick = this.invuln > 0 && this.state !== 'dead' && Math.floor(this.time * 20) % 2 === 0;
    r.root.visible = !flick || this.invuln > 1.05;
    if (r.matchTip) r.matchTip.material.emissiveIntensity = 0.3 + Math.max(0, Math.sin(this.time * 2.3)) * 0.4;

    this.updateLaser();
  }

  updateLaser() {
    const g = this.game;
    const on = this.weapon === 'smg' && this.state !== 'dead' && !this.body.climbing && this.control;
    this.beam.visible = on;
    if (!on) return;
    const b = this.body;
    const dir = this.facing;
    const y = this.gunY() - 0.06;
    const x0 = b.x + dir * 0.75;
    let len = 32;
    for (const t of g.hittables()) {
      if (!t.alive) continue;
      const tb = t.bounds();
      if (y < tb.y0 || y > tb.y1) continue;
      const d = dir > 0 ? tb.x0 - x0 : x0 - tb.x1;
      if (d > 0 && d < len) len = d;
    }
    const step = 0.5;
    for (let s = 0; s < len; s += step) {
      if (g.world.blocked(x0 + dir * s, y, x0 + dir * (s + step), y)) { len = s + step * 0.5; break; }
    }
    this.beam.position.set(x0, y, 0.05);
    this.beam.scale.set(len, 1, 1);
    this.beam.rotation.set(0, dir > 0 ? 0 : Math.PI, 0);
    g.particles.glow(x0 + dir * len, y, 0.12, [6, 0.3, 0.2], 0.25, 0.04);
    if (Math.random() < 0.5) g.lights.flash(x0 + dir * len, y, 0.4, '#ff2010', 3, 2.5, 0.05);
  }
}
