(() => { const g = __game; g.burgers = new Set(['knife','pistol','smg','pill']); g.kills = g.def.quota; for (const e of g.builder.encounters) e.done = true; g.ingrid.appear({x: 192, y: 0}); g.player.spawnAt(193, 0); g.camRig.snap(193, 0); g.ingrid.startFollowing(); g.checkObjectives();
  setTimeout(() => { g.player.spawnAt(205, 0); g.camRig.snap(205,0); }, 3000);
  setTimeout(() => { const b = g.boss; b.hp = 30; b.state = 'stalk'; b.body.y = 0; b.body.x = 214; b.hit(50, {dir: 1, kind: 'bullet'}); }, 8000);
  return true; })()
