// 2D platformer physics in the x/y plane: one-way ledges, solid blocks, ladders,
// hazards and moving platforms, bucketed along x for fast queries.
export const GRAVITY = 38;
const BUCKET = 8;

export class World {
  constructor() {
    this.ledges = [];   // { x0, x1, y, drop:true, mover?:obj }
    this.solids = [];   // { x0, x1, y0, y1 }
    this.ladders = [];  // { x, y0, y1 }
    this.hazards = [];  // { x0, x1, y0, y1, kind }
    this.buckets = new Map();
    this.movers = [];   // ledges whose x0/x1/y change each frame (conveyors are static but carry velocity)
    this.minX = 0;
    this.maxX = 300;
  }

  _bucketKeys(x0, x1) {
    const a = Math.floor(x0 / BUCKET), b = Math.floor(x1 / BUCKET);
    const keys = [];
    for (let k = a; k <= b; k++) keys.push(k);
    return keys;
  }

  _index(item, kind) {
    item._kind = kind;
    for (const k of this._bucketKeys(item.x0 ?? item.x, item.x1 ?? item.x)) {
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(item);
    }
  }

  addLedge(x0, x1, y, opts = {}) {
    const l = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y, drop: opts.drop !== false, vx: opts.vx || 0, tag: opts.tag };
    this.ledges.push(l);
    if (opts.mover) { l.mover = true; l._kind = 'ledge'; this.movers.push(l); } else this._index(l, 'ledge');
    return l;
  }

  addSolid(x0, x1, y0, y1, opts = {}) {
    const s = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), tag: opts.tag };
    this.solids.push(s);
    this._index(s, 'solid');
    return s;
  }

  removeSolid(s) {
    this.solids = this.solids.filter((o) => o !== s);
    for (const b of this.buckets.values()) {
      const i = b.indexOf(s);
      if (i >= 0) b.splice(i, 1);
    }
  }

  addLadder(x, y0, y1) {
    const l = { x, y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
    this.ladders.push(l);
    this._index(l, 'ladder');
    return l;
  }

  addHazard(x0, x1, y0, y1, kind = 'pit') {
    const h = { x0, x1, y0, y1, kind };
    this.hazards.push(h);
    this._index(h, 'hazard');
    return h;
  }

  query(x0, x1) {
    const out = new Set();
    for (const k of this._bucketKeys(x0, x1)) {
      const b = this.buckets.get(k);
      if (b) for (const it of b) out.add(it);
    }
    for (const m of this.movers) if (m.x1 >= x0 && m.x0 <= x1) out.add(m);
    return out;
  }

  // Highest support surface at x with top <= y + tolerance (for AI edge checks, spawning).
  groundAt(x, y, tol = 0.05) {
    let best = -Infinity;
    for (const it of this.query(x - 0.01, x + 0.01)) {
      if (it._kind === 'ledge' || it.mover) {
        if (x >= it.x0 && x <= it.x1 && it.y <= y + tol && it.y > best) best = it.y;
      } else if (it._kind === 'solid') {
        if (x >= it.x0 && x <= it.x1 && it.y1 <= y + tol && it.y1 > best) best = it.y1;
      }
    }
    return best;
  }

  ladderAt(x, y, reach = 0.55) {
    for (const it of this.query(x - reach, x + reach)) {
      if (it._kind !== 'ladder') continue;
      if (Math.abs(it.x - x) <= reach && y >= it.y0 - 0.05 && y <= it.y1 + 0.05) return it;
    }
    return null;
  }

  hazardAt(x, y, w, h) {
    for (const it of this.query(x - w, x + w)) {
      if (it._kind !== 'hazard') continue;
      if (x + w / 2 > it.x0 && x - w / 2 < it.x1 && y + h > it.y0 && y < it.y1) return it;
    }
    return null;
  }

  // True if a horizontal/diagonal segment is blocked by a solid (line of sight for AI shots).
  blocked(x0, y0, x1, y1) {
    const steps = Math.ceil(Math.abs(x1 - x0) / 0.5) + 1;
    const items = this.query(Math.min(x0, x1), Math.max(x0, x1));
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (const it of items) if (it._kind === 'solid' && x > it.x0 && x < it.x1 && y > it.y0 && y < it.y1) return true;
    }
    return false;
  }
}

/**
 * Body: { x, y (feet), vx, vy, w, h, onGround, ground, dropTimer, climbing, ladder }
 * Integrates gravity and resolves collisions. Returns events {landed, hitHead, hitWall}.
 */
export function moveBody(world, b, dt, opts = {}) {
  const ev = { landed: false, hitHead: false, hitWall: 0, fallSpeed: 0 };
  if (b.dropTimer > 0) b.dropTimer -= dt;
  if (b.climbing) {
    b.x += (b.ladder.x - b.x) * Math.min(1, dt * 18);
    b.y += b.vy * dt;
    b.onGround = false;
    return ev;
  }
  const gravity = opts.gravity ?? GRAVITY;
  b.vy -= gravity * dt;
  if (b.vy < -32) b.vy = -32;

  // carried by ground (conveyors / moving platforms)
  if (b.onGround && b.ground && b.ground.vx) b.x += b.ground.vx * dt;

  // horizontal
  const prevX = b.x;
  b.x += b.vx * dt;
  const hw = b.w / 2;
  const items = world.query(Math.min(prevX, b.x) - hw - 1, Math.max(prevX, b.x) + hw + 1);
  for (const s of items) {
    if (s._kind !== 'solid') continue;
    if (b.y + b.h <= s.y0 + 0.001 || b.y >= s.y1 - 0.001) continue;
    if (b.x + hw <= s.x0 || b.x - hw >= s.x1) continue;
    // step-up for low obstacles (curbs, steps)
    if (s.y1 - b.y <= 0.36 && b.onGround) { b.y = s.y1; continue; }
    if (prevX <= s.x0 - hw + 0.001 || b.vx > 0) { b.x = s.x0 - hw; ev.hitWall = 1; }
    else { b.x = s.x1 + hw; ev.hitWall = -1; }
    b.vx = 0;
  }
  if (b.x < world.minX + hw) { b.x = world.minX + hw; ev.hitWall = -1; }
  if (b.x > world.maxX - hw) { b.x = world.maxX - hw; ev.hitWall = 1; }

  // vertical
  const prevY = b.y;
  b.y += b.vy * dt;
  const wasGround = b.onGround;
  b.onGround = false;
  const footL = b.x - hw * 0.6, footR = b.x + hw * 0.6;
  let support = null, supportY = -Infinity;
  for (const s of world.query(b.x - hw - 1, b.x + hw + 1)) {
    if (s._kind === 'ledge' || s.mover) {
      if (b.vy > 0.001) continue;
      if (footR < s.x0 || footL > s.x1) continue;
      if (b.dropTimer > 0 && s.drop && b.dropFrom === s) continue;
      if (prevY >= s.y - 0.02 && b.y <= s.y + 0.001 && s.y > supportY) { support = s; supportY = s.y; }
    } else if (s._kind === 'solid') {
      if (b.x + hw <= s.x0 + 0.02 || b.x - hw >= s.x1 - 0.02) continue;
      if (b.vy <= 0.001 && prevY >= s.y1 - 0.02 && b.y <= s.y1 + 0.001 && s.y1 > supportY) { support = s; supportY = s.y1; }
      else if (b.vy > 0 && prevY + b.h <= s.y0 + 0.02 && b.y + b.h >= s.y0) { b.y = s.y0 - b.h; b.vy = 0; ev.hitHead = true; }
    }
  }
  if (support) {
    if (!wasGround) { ev.landed = true; ev.fallSpeed = -b.vy; }
    b.y = supportY;
    b.vy = 0;
    b.onGround = true;
    b.ground = support;
  } else {
    b.ground = null;
  }
  return ev;
}

// Starts dropping through the ledge the body stands on (if droppable).
export function dropThrough(b) {
  if (b.onGround && b.ground && b.ground._kind === 'ledge' && b.ground.drop) {
    b.dropFrom = b.ground;
    b.dropTimer = 0.25;
    b.onGround = false;
    b.y -= 0.05;
    b.vy = -2;
    return true;
  }
  return false;
}

export function overlap(a, b) {
  return a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2 && a.y < b.y + b.h && a.y + a.h > b.y;
}
