"""假配音：不调 ElevenLabs，按语速估算生成对齐数据 + 同长度的提示音音频。
用来在没有 API key 时把整条流水线跑通。格式与 tools/tts.py 的输出完全一致。

用法：python3 tools/mock_tts.py episodes/<本期> [--no-audio]
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import FILES, episode_dir, load, save  # noqa: E402
from timeline import segment_text  # noqa: E402

PAUSE = {",": 0.22, ";": 0.3, ":": 0.3, ".": 0.42, "?": 0.45, "!": 0.45,
         "，": 0.22, "；": 0.3, "：": 0.3, "。": 0.42, "？": 0.45, "！": 0.45}


def fake_alignment(text, lead=0.12, tail=0.3):
    t = lead
    chars, st, en = [], [], []
    for ch in text:
        if "㐀" <= ch <= "鿿":
            d = 0.22
        elif ch == " ":
            d = 0.035
        elif ch in PAUSE:
            d = 0.04
        else:
            d = 0.062
        chars.append(ch)
        st.append(round(t, 3))
        t += d
        en.append(round(t, 3))
        if ch in PAUSE:
            t += PAUSE[ch]
    return {"characters": chars, "character_start_times_seconds": st,
            "character_end_times_seconds": en}, round(t + tail, 3)


def main(ep_arg, audio=True):
    ep = episode_dir(ep_arg)
    script = load(ep / FILES["script"])
    (ep / "02_audio").mkdir(exist_ok=True)
    for seg in script["segments"]:
        text = segment_text(seg)
        al, dur = fake_alignment(text)
        rel = f'02_audio/{seg["id"]}.wav'
        if audio:
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi",
                            "-i", f"sine=frequency=330:duration={dur}", "-ac", "1", "-ar", "44100",
                            "-af", "volume=0.05", str(ep / rel)], check=True)
        save(ep / "02_audio" / f'{seg["id"]}.json',
             {"segment": seg["id"], "text": text, "audio": rel, "duration": dur, "mock": True,
              "alignment": al})
        print(f'{seg["id"]}：{dur:.2f}s（假配音）')


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    main(args[0], audio="--no-audio" not in sys.argv)
