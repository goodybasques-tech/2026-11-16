"""共用：读写 JSON、本期目录、锚点解析。只用标准库（jsonschema 仅 validate.py 用）。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
CHANNEL = ROOT / "channel"

FILES = {
    "script": "01_script.json",
    "timeline": "03_timeline.json",
    "assets": "04_assets/manifest.json",
    "storyboard": "05_storyboard.json",
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def episode_dir(arg):
    p = Path(arg)
    if not p.is_absolute() and not p.exists():
        p = ROOT / "episodes" / arg
    if not (p / FILES["script"]).exists():
        raise SystemExit(f"找不到本期稿子：{p / FILES['script']}")
    return p


def iter_sentences(script):
    for seg in script["segments"]:
        for s in seg["sentences"]:
            yield seg, s


# ---------- 词切分 ----------
# 中文逐字；英文/数字按词（保留 40,000 / 3rd / -33% / don't 这类整体）
WORD_RE = re.compile(r"[㐀-鿿]|[A-Za-z0-9$£€][A-Za-z0-9'’%.,$-]*[A-Za-z0-9%]|[A-Za-z0-9]")


def tokenize(text):
    """返回 [(word, char_start, char_end)]，下标相对于 text。"""
    return [(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(text)]


# ---------- 锚点 ----------
ANCHOR_RE = re.compile(
    r"^(?P<base>START|END|s\d{4}(?::end|\.e\d+(?::end)?|\.w\d+(?::end)?)?|c\d{2}(?::end)?)"
    r"(?P<off>[+-]\d+(?:\.\d+)?)?$"
)


class AnchorError(ValueError):
    pass


def build_index(timeline):
    """把时间轴整理成 锚点名 → 秒 的字典。"""
    idx = {"START": 0.0, "END": timeline["duration"]}
    for s in timeline["sentences"]:
        idx[s["id"]] = s["start"]
        idx[s["id"] + ":end"] = s["end"]
    for w in timeline["words"]:
        k = f'{w["sentence"]}.w{w["i"]}'
        idx[k] = w["start"]
        idx[k + ":end"] = w["end"]
    for e in timeline["emphasis"]:
        idx[e["ref"]] = e["start"]
        idx[e["ref"] + ":end"] = e["end"]
    for c in timeline.get("chapters", []):
        idx[c["id"]] = c["start"]
        idx[c["id"] + ":end"] = c["end"]
    return idx


def resolve(anchor, index):
    m = ANCHOR_RE.match(anchor)
    if not m:
        raise AnchorError(f"锚点格式不对：{anchor}")
    base = m.group("base")
    if base not in index:
        raise AnchorError(f"锚点指向不存在的位置：{anchor}")
    return round(index[base] + float(m.group("off") or 0), 3)
