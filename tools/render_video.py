#!/usr/bin/env python3
"""Render a scene page (window.renderAt(t)) to PNG frames and an mp4.

Usage:
  python tools/render_video.py <scene path from repo root> --out out.mp4 [--t0 0] [--t1 18.3] [--fps 30]
                               [--audio file --audio-gain-lufs -16] [--stills 1.0,4.5,...] [--workers 2]
Frames are rendered by the same page and renderAt(t) as stills, so stills == video frames.
"""
import argparse, functools, http.server, os, pathlib, shutil, socketserver, subprocess, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/usr/bin/google-chrome"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def serve(port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    h.log_message = lambda *a: None
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", port), h)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def open_page(p, url):
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(url)
    try:
        pg.wait_for_function("window.sceneReady === true", timeout=120000)
    except Exception:
        print("scene failed to load:", *errs, sep="\n"); raise
    return b, pg, errs


def render_range(url, times, frames_dir, start_index):
    with sync_playwright() as p:
        b, pg, errs = open_page(p, url)
        for k, t in enumerate(times):
            pg.evaluate(f"renderAt({t:.6f})")
            pg.screenshot(path=str(frames_dir / f"f_{start_index + k:05d}.png"))
        b.close()
        return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene"); ap.add_argument("--out", required=True)
    ap.add_argument("--t0", type=float, default=0); ap.add_argument("--t1", type=float, required=False)
    ap.add_argument("--fps", type=int, default=30); ap.add_argument("--audio"); ap.add_argument("--lufs", type=float, default=-16)
    ap.add_argument("--stills", default=""); ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--port", type=int, default=8780)
    a = ap.parse_args()
    srv = serve(a.port)
    url = f"http://127.0.0.1:{a.port}/{a.scene}"
    out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)

    if a.stills:
        ts = [float(x) for x in a.stills.split(",")]
        with sync_playwright() as p:
            b, pg, errs = open_page(p, url)
            for t in ts:
                t0 = time.time(); pg.evaluate(f"renderAt({t})")
                f = out.parent / f"{out.stem}_{t:05.2f}.png"; pg.screenshot(path=str(f))
                print(f, f"{time.time()-t0:.1f}s")
            if errs: print("console errors:", *errs[:5], sep="\n")
            b.close()
        return

    frames_dir = pathlib.Path("/tmp/frames_" + out.stem); shutil.rmtree(frames_dir, ignore_errors=True); frames_dir.mkdir()
    n = int(round((a.t1 - a.t0) * a.fps))
    times = [a.t0 + i / a.fps for i in range(n)]
    t_start = time.time()
    chunks = [list(range(i, n, a.workers)) for i in range(a.workers)]
    # contiguous chunks keep each page's state cache warm
    size = (n + a.workers - 1) // a.workers
    threads, results = [], []
    for w in range(a.workers):
        idx = list(range(w * size, min(n, (w + 1) * size)))
        if not idx: continue
        th = threading.Thread(target=lambda idx=idx: results.append(render_range(url, [times[i] for i in idx], frames_dir, idx[0])))
        th.start(); threads.append(th)
    for th in threads: th.join()
    print(f"rendered {n} frames in {time.time()-t_start:.0f}s")

    cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", str(a.fps), "-i", str(frames_dir / "f_%05d.png")]
    if a.audio:
        cmd += ["-ss", str(a.t0), "-t", str(a.t1 - a.t0), "-i", a.audio,
                "-filter:a", f"loudnorm=I={a.lufs}:TP=-1.5:LRA=11,afade=t=out:st={a.t1 - a.t0 - 0.35}:d=0.35", "-c:a", "aac", "-b:a", "320k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", str(out)]
    subprocess.run(cmd, check=True)
    print(out)


if __name__ == "__main__":
    main()
