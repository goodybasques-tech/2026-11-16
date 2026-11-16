"""合同校验：检查本期所有已存在的文件，并做跨文件检查。每个环节交付前、下一个环节开工前都跑一遍。

用法：python3 tools/validate.py episodes/<本期> [--json]
退出码：有「错误」时为 1（GitHub Actions 据此拦住下一步），只有「警告」时为 0。
"""
import sys
from pathlib import Path

import jsonschema

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (CHANNEL, CONTRACTS, FILES, AnchorError, build_index,  # noqa: E402
                    episode_dir, iter_sentences, load, resolve, save)

# 这些参数键里放的是上屏文字，必须引用稿子（"@s0012.o1"），或者用 "ui:" 前缀的频道界面字
TEXT_KEYS = {"title", "kicker", "caption", "captions", "quote", "speaker", "role", "label", "text",
             "sub", "value", "compare", "unit", "index", "headline"}
BEAT_MIN, BEAT_MAX, BEAT_HARD_MAX = 1.5, 9.0, 14.0


class Report:
    def __init__(self):
        self.errors, self.warnings, self.info = [], [], []

    def err(self, where, msg):
        self.errors.append(f"[{where}] {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"[{where}] {msg}")


def check_schema(rep, name, data):
    schema = load(CONTRACTS / f"{name}.schema.json")
    v = jsonschema.Draft202012Validator(schema)
    for e in sorted(v.iter_errors(data), key=lambda e: list(e.path)):
        path = "/".join(str(p) for p in e.path) or "(根)"
        rep.err(name, f"{path}：{e.message}")


def check_script(rep, sc):
    seen = set()
    chapters = [c["id"] for c in sc["chapters"]]
    src_ids = {s["id"] for s in sc["sources"]}
    last_ch = -1
    for seg in sc["segments"]:
        if seg["id"] in seen:
            rep.err("script", f'重复的段 id {seg["id"]}')
        seen.add(seg["id"])
        if seg["chapter"] not in chapters:
            rep.err("script", f'{seg["id"]} 指向不存在的章节 {seg["chapter"]}')
        else:
            k = chapters.index(seg["chapter"])
            if k < last_ch:
                rep.err("script", f'{seg["id"]}：章节顺序倒退（{seg["chapter"]}）')
            last_ch = k
    for seg, s in iter_sentences(sc):
        if s["id"] in seen:
            rep.err("script", f'重复的句 id {s["id"]}')
        seen.add(s["id"])
        for e in s.get("emphasis", []):
            if e["text"] not in s["text"]:
                rep.err("script", f'{s["id"]}.{e["id"]}：重点词「{e["text"]}」不在原文里（必须逐字出现）')
        if s.get("needs_image") and not s.get("image_brief"):
            rep.warn("script", f'{s["id"]} 需要配图但没写 image_brief')
        for r in s.get("sources", []):
            if r not in src_ids:
                rep.err("script", f'{s["id"]} 引用了不存在的出处 {r}')
        ids = [o["id"] for o in s.get("onscreen", [])] + [e["id"] for e in s.get("emphasis", [])]
        if len(ids) != len(set(ids)):
            rep.err("script", f'{s["id"]}：重点词或上屏文字 id 重复')


def check_timeline(rep, sc, tl):
    ids = [s["id"] for _, s in iter_sentences(sc)]
    have = {s["id"] for s in tl["sentences"]}
    miss = [i for i in ids if i not in have]
    if miss:
        rep.err("timeline", f"时间轴缺句子：{', '.join(miss)}（稿子改过？重跑 tts.py + timeline.py）")
    prev = -1
    for s in tl["sentences"]:
        if s["start"] < prev - 1e-6:
            rep.err("timeline", f'{s["id"]} 的时间早于上一句')
        prev = s["start"]


def check_assets(rep, ep, sc, am):
    sids = {s["id"] for _, s in iter_sentences(sc)}
    approved = {}
    for it in am["items"]:
        for s in it["sentences"]:
            if s not in sids:
                rep.err("assets", f'{it["id"]} 指向不存在的句子 {s}')
        if not (ep / it["file"]).exists():
            rep.warn("assets", f'{it["id"]} 文件不存在：{it["file"]}')
        lic = it["license"]["type"]
        if it["status"] == "approved":
            if lic in ("unknown", "needs-review"):
                rep.err("assets", f'{it["id"]} 已批准但授权是 {lic}——先确认授权')
            approved[it["id"]] = it
        if lic in ("cc-by", "cc-by-sa", "press-kit", "licensed") and not it["license"].get("attribution"):
            rep.warn("assets", f'{it["id"]}（{lic}）缺署名 attribution')
        if it["subject"].get("faces", 0) and not it.get("people"):
            rep.warn("assets", f'{it["id"]} 有人脸但没写 people——校验环节无法判断是否配错人')
    for _, s in iter_sentences(sc):
        if s.get("needs_image") and not any(s["id"] in it["sentences"] for it in approved.values()):
            rep.warn("assets", f'{s["id"]} 需要配图，还没有已批准的图')
    return approved


def walk_strings(obj, key=None):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_strings(v, key)
    elif isinstance(obj, str):
        yield key, obj


def check_storyboard(rep, ep, sc, tl, am_approved, sb):
    cat = load(CHANNEL / "templates.json")
    templates, transitions = cat["templates"], set(cat["transitions"])
    onscreen = {f'{s["id"]}.{o["id"]}' for _, s in iter_sentences(sc) for o in s.get("onscreen", [])}
    idx = build_index(tl) if tl else None

    starts = []
    for b in sb["beats"]:
        w = b["id"]
        t = templates.get(b["template"])
        if not t:
            rep.err("storyboard", f'{w}：模板 {b["template"]} 不在 channel/templates.json')
        else:
            for r in t["required"]:
                if r not in b["params"]:
                    rep.err("storyboard", f'{w}：模板 {b["template"]} 缺必填参数 {r}')
        if b["template"] == "custom" and not (ep / "06_scenes" / f'{w}.js').exists():
            rep.warn("storyboard", f'{w}：定制镜头代码 06_scenes/{w}.js 还没写')
        tr = b.get("transition_in", {}).get("type")
        if tr and tr not in transitions:
            rep.err("storyboard", f'{w}：转场 {tr} 不在频道转场列表')
        for k, v in walk_strings(b["params"]):
            if v.startswith("@"):
                if v[1:] not in onscreen:
                    rep.err("storyboard", f'{w}：上屏文字引用 {v} 在稿子的 onscreen 里找不到')
            elif v.startswith("#"):
                if am_approved is not None and v[1:] not in am_approved:
                    rep.err("storyboard", f'{w}：素材 {v} 不存在或未批准')
            elif k in TEXT_KEYS and not v.startswith("ui:"):
                rep.err("storyboard", f'{w}：参数 {k}="{v}" 是手打文字——上屏文字必须 @引用稿子，界面字用 ui: 前缀')
        if idx is None:
            continue
        try:
            st = resolve(b["start"], idx)
        except AnchorError as e:
            rep.err("storyboard", f"{w}：{e}")
            continue
        starts.append((w, st, b))

    if idx is None:
        rep.warn("storyboard", "还没有时间轴，跳过时间检查")
        return
    if starts and starts[0][1] > 0.01:
        rep.err("storyboard", f"开头 0–{starts[0][1]:.2f}s 没有画面（第一个 beat 应从 START 开始）")
    hit_times = {}
    for i, (w, st, b) in enumerate(starts):
        en = starts[i + 1][1] if i + 1 < len(starts) else tl["duration"]
        d = en - st
        if d <= 0:
            rep.err("storyboard", f"{w}：时长 {d:.2f}s（起点不晚于下一个 beat？顺序错了）")
            continue
        if d < BEAT_MIN:
            rep.warn("storyboard", f"{w}：只有 {d:.2f}s，太短")
        elif d > BEAT_HARD_MAX:
            rep.err("storyboard", f"{w}：{d:.2f}s 没有换画面（上限 {BEAT_HARD_MAX}s）")
        elif d > BEAT_MAX:
            rep.warn("storyboard", f"{w}：{d:.2f}s 偏长，考虑拆开或加 hits")
        hs = []
        for h in b.get("hits", []):
            try:
                ht = resolve(h["at"], idx)
            except AnchorError as e:
                rep.err("storyboard", f"{w} hit：{e}")
                continue
            hs.append(ht)
            if not (st - 0.01 <= ht < en):
                rep.err("storyboard", f'{w}：hit {h["at"]}（{ht:.2f}s）不在本片段 [{st:.2f}, {en:.2f}) 内')
        hit_times[w] = hs
        if i > 0:
            inside = [x for x in tl["words"] if x["start"] + 0.03 < st < x["end"] - 0.03]
            if inside:
                x = inside[0]
                rep.warn("storyboard", f'{w}：切在 {st:.2f}s，正好在「{x["text"]}」（{x["sentence"]}.w{x["i"]}）发音中间')
    covered = sum(1 for _ in starts)
    rep.info.append(f"分镜：{covered} 个片段，平均 {tl['duration'] / max(covered, 1):.1f}s/个")
    # 重点词覆盖：每个重点词最好有一个 hit
    hit_anchor_names = {h["at"].split("-")[0].split("+")[0] for b in sb["beats"] for h in b.get("hits", [])}
    for e in tl["emphasis"]:
        if e["ref"] not in hit_anchor_names:
            rep.warn("storyboard", f'重点词 {e["ref"]}「{e["text"]}」没有对应的画面重音（hits）')


def main(ep_arg, as_json=False):
    ep = episode_dir(ep_arg)
    rep = Report()
    data = {}
    for name, rel in FILES.items():
        p = ep / rel
        if p.exists():
            data[name] = load(p)
            check_schema(rep, name, data[name])
    if rep.errors:
        return finish(rep, ep, as_json)  # 格式都不对就不做跨文件检查
    sc = data["script"]
    check_script(rep, sc)
    tl = data.get("timeline")
    if tl:
        check_timeline(rep, sc, tl)
    approved = check_assets(rep, ep, sc, data["assets"]) if "assets" in data else None
    if "storyboard" in data:
        check_storyboard(rep, ep, sc, tl, approved, data["storyboard"])
    return finish(rep, ep, as_json)


def finish(rep, ep, as_json):
    print(f"== 校验 {ep.name} ==")
    for m in rep.info:
        print("  " + m)
    for m in rep.errors:
        print("  错误 " + m)
    for m in rep.warnings:
        print("  警告 " + m)
    print(f"  合计：{len(rep.errors)} 个错误，{len(rep.warnings)} 个警告")
    if as_json:
        save(ep / "07_review" / "validate.json",
             {"errors": rep.errors, "warnings": rep.warnings, "info": rep.info})
    return 1 if rep.errors else 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    sys.exit(main(args[0], as_json="--json" in sys.argv))
