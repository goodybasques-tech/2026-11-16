"""真配音：逐段调用 ElevenLabs「带时间戳」接口，写出 02_audio/<段>.mp3 + <段>.json。

用法：ELEVENLABS_API_KEY=... python3 tools/tts.py episodes/<本期> [--force] [--only=p003,p007]

- 只重做原文变了的段（对齐文件里存了原文，对不上才重做）；--force 全部重做。
- channel/voice.json 的 use_context_stitching=true 时，会把前后段原文作为 previous_text / next_text 传入，
  让分段生成的语气衔接自然。
- 接口：POST /v1/text-to-speech/{voice_id}/with-timestamps，返回 audio_base64 + 字符级 alignment。
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CHANNEL, FILES, episode_dir, load, save  # noqa: E402
from timeline import segment_text  # noqa: E402

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format={fmt}"


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()), 3)


def call(voice, text, prev_text, next_text, key):
    body = {"text": text, "model_id": voice["model_id"], "voice_settings": voice["voice_settings"]}
    if voice.get("pronunciation_dictionary_locators"):
        body["pronunciation_dictionary_locators"] = voice["pronunciation_dictionary_locators"]
    if voice.get("use_context_stitching"):
        if prev_text:
            body["previous_text"] = prev_text
        if next_text:
            body["next_text"] = next_text
    req = urllib.request.Request(
        API.format(voice_id=voice["voice_id"], fmt=voice["output_format"]),
        data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def main(ep_arg, force=False, only=None):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("缺少环境变量 ELEVENLABS_API_KEY")
    voice = load(CHANNEL / "voice.json")
    if voice["voice_id"].startswith("TODO"):
        raise SystemExit("channel/voice.json 里还没填 voice_id")
    ep = episode_dir(ep_arg)
    script = load(ep / FILES["script"])
    segs = script["segments"]
    texts = [segment_text(s) for s in segs]
    (ep / "02_audio").mkdir(exist_ok=True)
    for i, seg in enumerate(segs):
        if only and seg["id"] not in only:
            continue
        jf = ep / "02_audio" / f'{seg["id"]}.json'
        if not force and jf.exists() and load(jf).get("text") == texts[i] and not load(jf).get("mock"):
            print(f'{seg["id"]}：没变，跳过')
            continue
        res = call(voice, texts[i], texts[i - 1] if i else None, texts[i + 1] if i + 1 < len(texts) else None, key)
        ext = voice["output_format"].split("_")[0]
        rel = f'02_audio/{seg["id"]}.{ext}'
        (ep / rel).write_bytes(base64.b64decode(res["audio_base64"]))
        rec = {"segment": seg["id"], "text": texts[i], "audio": rel, "duration": probe_duration(ep / rel),
               "alignment": res["alignment"]}
        if res.get("normalized_alignment"):
            rec["normalized_alignment"] = res["normalized_alignment"]
        save(jf, rec)
        print(f'{seg["id"]}：{rec["duration"]:.2f}s')
    print("完成。下一步：python3 tools/timeline.py " + str(ep))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    only = None
    for a in sys.argv:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))
    main(args[0], force="--force" in sys.argv, only=only)
