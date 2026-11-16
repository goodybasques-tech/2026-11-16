#!/usr/bin/env python3
"""Render still frames from a scene page that exposes window.renderAt(t).

Usage: python tools/render_stills.py <scene.html> <out_dir> t1 t2 ...
Writes <out_dir>/f_<t>.png. Uses the same page and renderAt(t) the video renderer uses,
so a still is exactly what that moment of the film will look like.
"""
import sys, pathlib
from playwright.sync_api import sync_playwright


def main():
    scene, out = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2])
    times = [float(x) for x in sys.argv[3:]]
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = b.new_page(viewport={"width": 1920, "height": 1080})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(scene.as_uri())
        pg.wait_for_function("typeof window.renderAt === 'function'")
        pg.evaluate("document.fonts.ready")
        for t in times:
            pg.evaluate(f"renderAt({t})")
            f = out / f"f_{t:05.2f}.png"
            pg.locator("canvas").screenshot(path=str(f))
            print(f)
        if errs:
            print("PAGE ERRORS:", *errs, sep="\n")
            sys.exit(1)
        b.close()


if __name__ == "__main__":
    main()
