"""Platform readability audit: can the player see where the ledges and ladders are?

Usage:
  python tools/readability.py [--level 0] [--url http://127.0.0.1:8123/index.html]
                              [--w 1600] [--h 900] [--shots out_dir] [--json out.json]
                              [--eval "js"] [--stride 2]

Stands the player on every ledge of a level in turn (enemies, rain flashes and film grain
off) and, in each frame, measures every ledge and ladder on screen in CIE L* (0 = black,
100 = white), the way a player's eye separates shapes:
  ledge  - lightness just above vs just below the walk line, and any bright lip on it;
  ladder - lightness step, plus extra bright/dark rung and rail structure, in the ladder
           column compared with the wall beside it.
Values under L* 8 are floored first: a typical monitor in a lit room shows them all as
black, so a step from L* 1 to L* 6 does not count. An element's score is the median over
the frames that show it; >= 15 reads clearly, 8-15 is weak, < 8 is effectively invisible.
Prints a summary per element kind and the worst elements, which are what to light or trim first.
"""
import argparse
import io
import json
import pathlib
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

ap = argparse.ArgumentParser()
ap.add_argument("--level", default="0")
ap.add_argument("--url", default="http://127.0.0.1:8123/index.html")
ap.add_argument("--w", type=int, default=1600)
ap.add_argument("--h", type=int, default=900)
ap.add_argument("--shots", default="", help="directory to save the measured frames into")
ap.add_argument("--json", default="")
ap.add_argument("--top", type=int, default=12)
ap.add_argument("--eval", default="", help="JS (may await) run after setup, e.g. to try lighting values live")
ap.add_argument("--stride", type=int, default=1, help="stand on every Nth ledge only (quicker sweeps)")
args = ap.parse_args()

FLOOR = 8.0
HUD_TOP, HUD_BOTTOM, MARGIN = 150, 130, 40

SETUP = r"""() => {
  const g = __game;
  g.spawnEnemy = () => null;
  for (const e of g.enemies) { e.alive = false; if (e.rig) e.rig.root.visible = false; }
  g.lightning = null; g.sun.intensity = g.sunBase;
  g.renderer.setGrade({ grain: 0, lensRain: 0 });
  const W = g.world;
  return { ledges: W.ledges.filter((l) => !l.mover && l.y > 0.5 && l.x1 - l.x0 > 0.6).map((l) => [l.x0, l.x1, l.y]),
           ladders: W.ladders.map((l) => [l.x, l.y0, l.y1]) };
}"""

PROJECT = r"""([x, y, w, h]) => {
  const g = __game; g.player.spawnAt(x, y); g.camRig.snap(x, y);
  for (const e of g.enemies) { e.alive = false; if (e.rig) e.rig.root.visible = false; }
  return null;
}"""

# project the sample points of every element after the camera has settled
SAMPLE = r"""([els, w, h]) => {
  const g = __game;
  const P = (x, y) => { const s = g.camRig.toScreen(new (g.camRig.focus.constructor)(x, y, 0), w, h); return [s.x, s.y]; };
  const out = [];
  for (const [i, kind, a, b, c] of els) {
    const pts = [];
    if (kind === 'ledge') {
      const n = Math.max(2, Math.ceil((b - a) / 0.5));
      for (let k = 0; k <= n; k++) { const x = a + (b - a) * (0.04 + 0.92 * k / n); const p = P(x, c), q = P(x, c + 1); pts.push([p[0], p[1], q[1] - p[1]]); }
    } else {
      const n = Math.max(2, Math.ceil((c - b) / 0.5));
      for (let k = 0; k <= n; k++) { const y = b + (c - b) * (0.08 + 0.84 * k / n); const p = P(a, y), q = P(a + 1, y); pts.push([p[0], p[1], q[0] - p[0]]); }
    }
    out.push([i, pts]);
  }
  const pb = g.player.body, pp = P(pb.x, pb.y), pq = P(pb.x + 0.7, pb.y + 2.0);
  return { els: out, player: [pp[0], pq[1], 2 * (pq[0] - pp[0]), pp[1]] };
}"""


def lstar(png):
    im = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.float32) / 255
    lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.where(Y > 0.008856, 116 * np.cbrt(Y) - 16, 903.3 * Y)


def band(L, x0, x1, y0, y1, q=50):
    H, W = L.shape
    x0, x1 = int(max(0, round(x0))), int(min(W, round(x1)))
    y0, y1 = int(max(0, round(y0))), int(min(H, round(y1)))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return float(np.percentile(np.maximum(L[y0:y1, x0:x1], FLOOR), q))


def visible(x, y, w, h):
    return MARGIN < x < w - MARGIN and HUD_TOP < y < h - HUD_BOTTOM


def score_ledge(L, pts, player, w, h):
    out = []
    px0, py0, pw, py1 = player
    for (x, y, m) in pts:
        m = -m  # pixels per metre (screen y grows downward)
        if m < 4 or not visible(x, y, w, h):
            continue
        if abs(x - px0) < pw and py0 - 4 < y < py1 + 8:
            continue
        hw = max(3, 0.22 * m)
        A = band(L, x - hw, x + hw, y - 0.75 * m, y - 0.12 * m)  # above the walk line
        B = band(L, x - hw, x + hw, y + 0.12 * m, y + 0.75 * m)  # below it: the platform's front
        E = band(L, x - hw, x + hw, y - 0.15 * m, y + 0.15 * m, 85)  # a bright lip, even a thin one
        if A is None or B is None or E is None:
            continue
        out.append(max(abs(A - B), E - max(A, B)))
    return out


def score_ladder(L, pts, player, w, h):
    # rails and rungs are thin: score the step in median lightness and the extra bright or dark
    # structure in the ladder column compared with the wall beside it
    out = []
    for (x, y, m) in pts:
        if m < 4 or not visible(x, y, w, h):
            continue
        hh = max(3, 0.22 * m)
        C = [band(L, x - 0.32 * m, x + 0.32 * m, y - hh, y + hh, q) for q in (10, 50, 90)]
        sides = []
        for sgn in (-1, 1):
            S = [band(L, x + sgn * 0.55 * m, x + sgn * 1.0 * m, y - hh, y + hh, q) for q in (10, 50, 90)]
            if None not in S:
                sides.append(S)
        if None in C or not sides:
            continue
        out.append(min(max(abs(C[1] - S[1]), (C[2] - C[1]) - (S[2] - S[1]), (C[1] - C[0]) - (S[1] - S[0])) for S in sides))
    return out


with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="chrome", args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    pg = br.new_page(viewport={"width": args.w, "height": args.h})
    pg.goto(f"{args.url}?level={args.level}&skipintro")
    pg.wait_for_function("window.__game && __game.state === 'play' && !__game.loading", timeout=180000)
    data = pg.evaluate(SETUP)
    if args.eval:
        pg.evaluate(f"async () => {{ {args.eval} }}")
    els = [(i, "ledge", *l) for i, l in enumerate(data["ledges"])]
    els += [(len(data["ledges"]) + i, "ladder", *l) for i, l in enumerate(data["ladders"])]
    meta = {e[0]: e for e in els}
    scores = {e[0]: [] for e in els}
    pg.wait_for_timeout(1500)
    for n, (_, _, x0, x1, y) in enumerate([e for e in els if e[1] == "ledge"][:: args.stride]):
        pg.evaluate(PROJECT, [(x0 + x1) / 2, y, args.w, args.h])
        pg.wait_for_timeout(450)
        proj = pg.evaluate(SAMPLE, [[list(e) for e in els], args.w, args.h])
        png = pg.screenshot()
        if args.shots:
            pathlib.Path(args.shots).mkdir(parents=True, exist_ok=True)
            (pathlib.Path(args.shots) / f"L{args.level}_{n:03d}.png").write_bytes(png)
        L = lstar(png)
        for i, pts in proj["els"]:
            f = score_ledge if meta[i][1] == "ledge" else score_ladder
            s = f(L, pts, proj["player"], args.w, args.h)
            if len(s) >= 2:
                scores[i].append(float(np.median(s)))
    br.close()

rows = []
for i, e in meta.items():
    if not scores[i]:
        continue
    kind = e[1]
    where = f"x {e[2]:.1f}..{e[3]:.1f} y {e[4]:.1f}" if kind == "ledge" else f"x {e[2]:.1f} y {e[3]:.1f}..{e[4]:.1f}"
    rows.append({"kind": kind, "where": where, "score": round(float(np.median(scores[i])), 1), "frames": len(scores[i])})

print(f"level {args.level}: {sum(r['kind'] == 'ledge' for r in rows)} ledges, {sum(r['kind'] == 'ladder' for r in rows)} ladders measured")
for kind in ("ledge", "ladder"):
    s = np.array([r["score"] for r in rows if r["kind"] == kind])
    if len(s):
        print(f"  {kind:6s} median {np.median(s):5.1f}   clear(>=15) {np.mean(s >= 15) * 100:4.0f}%   weak {np.mean((s >= 8) & (s < 15)) * 100:4.0f}%   invisible(<8) {np.mean(s < 8) * 100:4.0f}%")
print("  worst:")
for r in sorted(rows, key=lambda r: r["score"])[: args.top]:
    print(f"    {r['score']:5.1f}  {r['kind']:6s} {r['where']}  ({r['frames']} frames)")
if args.json:
    pathlib.Path(args.json).write_text(json.dumps(rows, indent=1), encoding="utf-8")
