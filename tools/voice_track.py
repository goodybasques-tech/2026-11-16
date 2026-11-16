"""按 03_timeline.json 的偏移把各段音频拼成整条人声轨：02_audio/voice_full.wav（48 kHz 单声道）。

用法：python3 tools/voice_track.py episodes/<本期>
每段放在 timeline 给出的 offset 上，段间是静音；总长 = timeline.duration，画面与声音用同一条时间轴。
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import FILES, episode_dir, load  # noqa: E402


def main(ep_arg):
    ep = episode_dir(ep_arg)
    tl = load(ep / FILES["timeline"])
    cmd = ["ffmpeg", "-loglevel", "error", "-y"]
    parts = []
    for i, s in enumerate(tl["segments"]):
        cmd += ["-i", str(ep / s["audio"])]
        ms = int(round(s["offset"] * 1000))
        parts.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,"
                     f"atrim=0:{s['duration']},adelay={ms}:all=1[a{i}]")
    n = len(tl["segments"])
    mix = "".join(f"[a{i}]" for i in range(n))
    graph = ";".join(parts) + f";{mix}amix=inputs={n}:normalize=0:dropout_transition=0,apad,atrim=0:{tl['duration']}[out]"
    out = ep / "02_audio" / "voice_full.wav"
    cmd += ["-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-ac", "1", str(out)]
    subprocess.run(cmd, check=True)
    print(f"人声轨：{out}（{tl['duration']:.2f}s）")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
