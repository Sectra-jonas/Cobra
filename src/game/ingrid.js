// Ingrid Knutsen: appears mid-level, follows Cobra along his exact path once
// touched, can be kidnapped by grabbers, runs off if shot, and shields Cobra from
// one lethal hit (she's snatched away instead – faithful to the original rules).
import * as THREE from 'three';
import { createCharacter } from '../actors/characters.js';
import { Poses, emptyPose } from '../actors/rig.js';
import { moveBody } from './physics.js';
import { sound } from '../core/sound.js';

export class Ingrid {
  constructor(game) {
    this.game = game;
    this.rig = createCharacter('ingrid');
    this.rig.root.visible = false;
    game.scene.add(this.rig.root);
    this.body = { x: 0, y: 0, vx: 0, vy: 0, w: 0.55, h: 1.75, onGround: false, ground: null, dropTimer: 0 };
    this.state = 'hidden';
    this.trail = [];
    this.pose = emptyPose();
    this.t = 0;
    this.facing = -1;
    this.alive = true;
    this.carrier = null;
    this.appearances = 0;
    this.respawnT = 0;
    this.spots = [];
    this.marker = this.makeMarker();
  }

  makeMarker() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff5fa2';
    g.beginPath();
    g.moveTo(32, 56); g.bezierCurveTo(4, 34, 8, 8, 32, 22); g.bezierCurveTo(56, 8, 60, 34, 32, 56);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: new THREE.Color(2.5, 2.5, 2.5), depthWrite: false, transparent: true }));
    s.scale.set(0.45, 0.45, 1);
    s.visible = false;
    this.game.scene.add(s);
    return s;
  }

  get following() { return this.state === 'following'; }

  setSpots(spots) { this.spots = spots.slice().sort((a, b) => a.x - b.x); }

  // Ingrid shows up at a spot ahead of Cobra, cowering and waiting for rescue.
  appear(spot) {
    this.state = 'waiting';
    this.rig.root.visible = true;
    this.body.x = spot.x;
    this.body.y = spot.y;
    this.body.vx = this.body.vy = 0;
    this.alive = true;
    this.appearances++;
    this.rig.setOpacity(1);
    this.game.hud.toast('INGRID SPOTTED — reach her!');
    sound.sfx('ingridScream', { x: spot.x, volume: 0.6 });
  }

  nextSpot() {
    const px = this.game.player.body.x;
    const ahead = this.spots.filter((s) => s.x > px + 14);
    return ahead[0] || this.spots[this.spots.length - 1];
  }

  grabbable() { return this.state === 'waiting' || this.state === 'following'; }

  grab(carrier) {
    this.state = 'carried';
    this.carrier = carrier;
    this.trail.length = 0;
  }

  release() {
    if (this.state !== 'carried') return;
    this.state = 'waiting';
    this.carrier = null;
    this.body.vy = 3;
    this.body.onGround = false;
    this.game.hud.toast('INGRID IS FREE — get to her!');
  }

  lose() {
    this.state = 'gone';
    this.carrier = null;
    this.rig.root.visible = false;
    this.respawnT = 6;
    this.game.hud.banner('INGRID IS GONE', 'They took her deeper into the territory', 2.6);
  }

  // Cobra took a lethal hit with Ingrid at his side: a gang member snatches her.
  abduct() {
    const g = this.game;
    sound.sfx('ingridTaken');
    const side = this.body.x < g.player.body.x ? -1 : 1;
    const e = g.spawnEnemy('grabber', this.body.x + side * 1.2, this.body.y, { facing: -side });
    if (e) {
      this.grab(e);
      e.carrying = this;
    } else this.lose();
  }

  // Player bullet/knife hit her: she panics and runs away.
  hit(dmg, info) {
    if (this.state !== 'following' && this.state !== 'waiting') return;
    this.state = 'fleeing';
    this.fleeDir = info.dir || 1;
    this.fleeT = 0;
    this.rig.flash(0.15);
    sound.sfx('ingridScream', { x: this.body.x });
    this.game.addScore(-500, this.body.x, this.body.y + 2);
    this.game.hud.banner("DON'T SHOOT INGRID!", 'She ran off — find her again', 2.4);
  }

  bounds() {
    const b = this.body;
    return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h };
  }

  update(dt) {
    const g = this.game;
    const P = g.player;
    const b = this.body;
    this.t += dt;
    const p = this.pose;
    for (const k in p) p[k] = 0;
    let rate = 14;
    let yaw = null;
    this.marker.visible = false;

    switch (this.state) {
      case 'hidden':
      case 'gone':
        this.rig.root.visible = false;
        if (this.state === 'gone') {
          this.respawnT -= dt;
          if (this.respawnT <= 0 && this.spots.length) this.appear(this.nextSpot());
        }
        return;
      case 'waiting': {
        this.rig.root.visible = true;
        moveBody(g.world, b, dt);
        b.vx *= 0.8;
        this.facing = P.body.x > b.x ? 1 : -1;
        const near = Math.abs(P.body.x - b.x) < 7 && Math.abs(P.body.y - b.y) < 3;
        if (near && Math.sin(this.t * 1.3) > 0.3) { Poses.idle(p, this.t); Poses.wave(p, this.t); }
        else Poses.cower(p, this.t);
        this.marker.visible = true;
        this.marker.position.set(b.x, b.y + 2.25 + Math.sin(this.t * 3) * 0.08, 0.2);
        if (P.alive && Math.abs(P.body.x - b.x) < 0.9 && Math.abs(P.body.y - b.y) < 1.2) this.startFollowing();
        break;
      }
      case 'hiding': {
        // tucked away behind cover while Cobra faces the Night Slasher
        this.rig.root.visible = true;
        moveBody(g.world, b, dt);
        this.facing = P.body.x > b.x ? 1 : -1;
        Poses.cower(p, this.t);
        break;
      }
      case 'following': {
        this.rig.root.visible = true;
        this.followTrail(dt, p);
        rate = 16;
        if (this.climbing) yaw = Math.PI;
        break;
      }
      case 'carried': {
        const c = this.carrier;
        if (!c || !c.alive) { this.release(); break; }
        const cb = c.body;
        b.x = cb.x - c.facing * 0.05;
        b.y = cb.y + 1.25;
        this.facing = -c.facing;
        Poses.carried(p, this.t);
        p.fallX = -1.35;
        rate = 20;
        if (Math.random() < 0.01) sound.sfx('ingridScream', { x: b.x, volume: 0.5 });
        break;
      }
      case 'fleeing': {
        this.fleeT += dt;
        b.vx = this.fleeDir * 6.5;
        moveBody(g.world, b, dt);
        this.facing = this.fleeDir;
        this.phase = (this.phase || 0) + dt * 14;
        Poses.run(p, this.phase, 1);
        if (this.fleeT > 2.2) {
          this.rig.setOpacity(Math.max(0, 1 - (this.fleeT - 2.2) * 2));
        }
        if (this.fleeT > 2.7) { this.state = 'gone'; this.respawnT = 8; this.rig.setOpacity(1); this.rig.root.visible = false; }
        break;
      }
      default: break;
    }
    this.rig.setFacing(this.facing);
    this.rig.update(dt, p, rate, yaw);
    this.rig.root.position.set(b.x, b.y, 0.05);
    const gy = g.world.groundAt(b.x, b.y + 0.05);
    const hgt = isFinite(gy) ? b.y - gy : 10;
    this.rig.blob.position.y = -hgt + 0.015;
    this.rig.blob.visible = hgt < 5 && this.state !== 'carried';
  }

  startFollowing() {
    this.state = 'following';
    this.trail.length = 0;
    const P = this.game.player.body;
    this.trail.push({ x: this.body.x, y: this.body.y, c: false, gr: true });
    this.trail.push({ x: P.x, y: P.y, c: false, gr: true });
    sound.sfx('ingridThanks');
    this.game.hud.banner('INGRID IS WITH YOU', 'Keep her safe — she shields you once', 2.4);
    this.game.onIngridRescued();
  }

  // Breadcrumb follow: replays Cobra's path ~1.5 m behind him.
  followTrail(dt, p) {
    const P = this.game.player.body;
    const b = this.body;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(P.x - last.x, P.y - last.y) > 0.12) {
      this.trail.push({ x: P.x, y: P.y, c: P.climbing, gr: P.onGround });
      if (this.trail.length > 400) this.trail.shift();
    }
    // walk back along the trail until 1.5 m from the player
    let dist = 0, idx = this.trail.length - 1;
    while (idx > 0 && dist < 1.5) {
      dist += Math.hypot(this.trail[idx].x - this.trail[idx - 1].x, this.trail[idx].y - this.trail[idx - 1].y);
      idx--;
    }
    // drop consumed history behind her
    let my = 0;
    for (let i = 0; i < idx; i++) if (Math.hypot(this.trail[i].x - b.x, this.trail[i].y - b.y) < 0.3) my = i;
    if (my > 0) { this.trail.splice(0, my); idx -= my; }
    const tgt = this.trail[Math.max(0, idx)];
    const dx = tgt.x - b.x, dy = tgt.y - b.y;
    const d = Math.hypot(dx, dy);
    const maxStep = (d > 6 ? 14 : 7.8) * dt;
    const k = d > maxStep ? maxStep / d : 1;
    const ox = b.x;
    b.x += dx * k;
    b.y += dy * k;
    b.vx = (b.x - ox) / Math.max(dt, 1e-4);
    this.climbing = tgt.c;
    if (Math.abs(dx) > 0.02) this.facing = Math.sign(dx);
    else this.facing = P.x > b.x ? 1 : -1;
    if (tgt.c) { this.phase = (this.phase || 0) + dt * 7 * Math.min(1, d * 4); Poses.climb(p, this.phase); }
    else if (!tgt.gr && this.game.world.groundAt(b.x, b.y + 0.05) < b.y - 0.1) Poses.jump(p, dy > 0 ? 8 : -6);
    else if (Math.abs(b.vx) > 0.4) { this.phase = (this.phase || 0) + dt * Math.abs(b.vx) * 2.2; Poses.run(p, this.phase, Math.min(1, Math.abs(b.vx) / 6)); }
    else Poses.idle(p, this.t);
    // catch up instantly if left far behind (e.g. respawn)
    if (Math.abs(P.x - b.x) > 30) { b.x = P.x - this.game.player.facing * 1.5; b.y = P.y; this.trail.length = 0; this.trail.push({ x: P.x, y: P.y, c: false, gr: true }); }
  }
}
