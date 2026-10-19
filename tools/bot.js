// Chaos bot: runs right, jumps, climbs, shoots and throws grenades; logs state every few seconds.
(() => {
  const I = __input;
  const press = (c, ms) => { I.keys.add(c); setTimeout(() => I.keys.delete(c), ms); };
  window.__botLog = [];
  let t = 0;
  I.keys.add('ArrowRight');
  const id = setInterval(() => {
    t += 0.1;
    const g = __game;
    if (!g || !g.player) return;
    if (Math.random() < 0.06) press('Space', 200 + Math.random() * 300);
    if (Math.random() < 0.12) press('KeyJ', 120);
    if (Math.random() < 0.02) press('KeyK', 100);
    if (Math.random() < 0.03) press('ArrowUp', 900);
    if (Math.random() < 0.015) { I.keys.delete('ArrowRight'); I.keys.add('ArrowLeft'); setTimeout(() => { I.keys.delete('ArrowLeft'); I.keys.add('ArrowRight'); }, 700); }
    if (Math.random() < 0.02) press('ArrowDown', 400);
    if (Math.floor(t * 10) % 50 === 0) window.__botLog.push(JSON.stringify(window.__state()));
    if (g.player.body.vx === 0 && g.player.body.onGround && Math.random() < 0.1) press('Space', 400);
  }, 100);
  return 'bot on';
})()
