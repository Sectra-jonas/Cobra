"""Headless screenshot helper for visual checks.

Usage:
  python tools/shot.py URL OUT.png [--w 1600] [--h 900] [--wait 2500]
                       [--keys "Enter,ArrowRight:1500"] [--eval "js expr"] [--console]

Waits for window.__ready (if the page sets it), then `--wait` ms, presses keys
(KEY or KEY:holdMs), evaluates JS, and saves a screenshot. Prints console
errors so broken modules show up immediately.
"""
import argparse
import sys
import time

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("url")
ap.add_argument("out")
ap.add_argument("--w", type=int, default=1600)
ap.add_argument("--h", type=int, default=900)
ap.add_argument("--wait", type=int, default=2500)
ap.add_argument("--keys", default="")
ap.add_argument("--eval", default="")
ap.add_argument("--console", action="store_true")
ap.add_argument("--preeval", default="", help="JS evaluated right after load, before --wait")
ap.add_argument("--shots", type=int, default=1, help="number of screenshots, spaced by --gap ms")
ap.add_argument("--gap", type=int, default=1000)
ap.add_argument("--tour", default="", help="comma list of x[:y] positions to teleport the player to (game pages)")
args = ap.parse_args()

logs = []
with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        channel="chrome",
        args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": args.w, "height": args.h})
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    page.goto(args.url)
    try:
        page.wait_for_function("window.__ready === true", timeout=60000)
    except Exception as e:  # noqa: BLE001
        logs.append(f"[shot] __ready not set: {e}")
    if args.preeval:
        try:
            print("preeval:", page.evaluate(args.preeval))
        except Exception as e:  # noqa: BLE001
            print("preeval error:", e)
    page.wait_for_timeout(args.wait)
    for k in [k for k in args.keys.split(",") if k]:
        if ":" in k:
            key, hold = k.split(":")
            if key == "wait":
                page.wait_for_timeout(int(hold))
                continue
            page.keyboard.down(key)
            page.wait_for_timeout(int(hold))
            page.keyboard.up(key)
        else:
            page.keyboard.press(k)
            page.wait_for_timeout(120)
    if args.eval:
        try:
            r = page.evaluate(args.eval)
            print("eval:", r)
        except Exception as e:  # noqa: BLE001
            print("eval error:", e)
    if args.tour:
        stem = args.out[:-4] if args.out.endswith(".png") else args.out
        for i, pos in enumerate(args.tour.split(",")):
            x, _, y = pos.partition(":")
            page.evaluate(f"(() => {{ const g = __game; g.player.spawnAt({float(x)}, {float(y or 0)}); g.camRig.snap({float(x)}, {float(y or 0)}); }})()")
            page.wait_for_timeout(900)
            page.screenshot(path=f"{stem}_{i}.png")
    elif args.shots <= 1:
        page.screenshot(path=args.out)
    else:
        stem = args.out[:-4] if args.out.endswith(".png") else args.out
        for i in range(args.shots):
            page.screenshot(path=f"{stem}_{i}.png")
            page.wait_for_timeout(args.gap)
    browser.close()

errors = [l for l in logs if ("error" in l.lower() and "404" not in l) or "[warning]" in l or args.console]
for l in errors[:60]:
    print(l)
print("saved", args.out)
