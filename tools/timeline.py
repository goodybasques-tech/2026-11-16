"""02_audio/*.json（每段的 TTS 对齐数据）→ 03_timeline.json

用法：python3 tools/timeline.py episodes/<本期>

每段对齐文件的格式（tools/tts.py 写出；tools/mock_tts.py 也写同样格式）：
{
  "segment": "p001", "text": "<送进 TTS 的原文>", "audio": "02_audio/p001.mp3", "duration": 7.31,
  "alignment": {"characters": [...], "character_start_times_seconds": [...], "character_end_times_seconds": [...]},
  "normalized_alignment": {...}   # 可选
}
"""
import difflib
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CHANNEL, FILES, episode_dir, load, save, tokenize  # noqa: E402


def segment_text(seg):
    return " ".join(s["text"] for s in seg["sentences"])


def char_times(text, alignment):
    """返回与 text 等长的 [(start, end) 或 None]。对齐串与原文不一致时用 difflib 对应。"""
    chars = alignment["characters"]
    st = alignment["character_start_times_seconds"]
    en = alignment["character_end_times_seconds"]
    aligned = "".join(chars)
    out = [None] * len(text)
    if aligned == text:
        for i in range(len(text)):
            out[i] = (st[i], en[i])
        return out, 1.0
    sm = difflib.SequenceMatcher(a=text, b=aligned, autojunk=False)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            out[a + k] = (st[b + k], en[b + k])
    # 没对上的字符：用左右邻居插值
    known = [i for i, v in enumerate(out) if v]
    for i, v in enumerate(out):
        if v:
            continue
        left = max((k for k in known if k < i), default=None)
        right = min((k for k in known if k > i), default=None)
        if left is not None and right is not None:
            t = out[left][1] + (out[right][0] - out[left][1]) * (i - left) / (right - left)
            out[i] = (t, t)
        elif left is not None:
            out[i] = (out[left][1], out[left][1])
        elif right is not None:
            out[i] = (out[right][0], out[right][0])
    return out, sm.ratio()


def span_time(ct, a, b, text=None):
    """一段字符的发音起止；给了 text 时跳过空格和标点（句末标点会带上停顿时间）。"""
    idx = range(a, b)
    if text is not None:
        core = [i for i in idx if not unicodedata.category(text[i])[0] in "PZ"]
        idx = core or idx
    vals = [ct[i] for i in idx if ct[i]]
    if not vals:
        return None
    return min(v[0] for v in vals), max(v[1] for v in vals)


def main(ep_arg):
    ep = episode_dir(ep_arg)
    script = load(ep / FILES["script"])
    voice = load(CHANNEL / "voice.json")
    pmin = voice["pauses"]["min"]
    levels = sorted(voice["pauses"]["strength"], key=lambda x: x["min_dur"])

    def strength(d):
        s = 0
        for lv in levels:
            if d >= lv["min_dur"]:
                s = lv["strength"]
        return s

    segs, sents, words, emph, pauses, cuts = [], [], [], [], [], []
    warnings = []
    offset = 0.0
    prev_last_word = None  # (abs_end, sentence_id, chapter)
    order = script["segments"]

    for si, seg in enumerate(order):
        af = ep / "02_audio" / f'{seg["id"]}.json'
        if not af.exists():
            raise SystemExit(f"缺少对齐文件：{af}（先跑 tools/tts.py）")
        al = load(af)
        text = segment_text(seg)
        if al["text"] != text:
            warnings.append(f'{seg["id"]}：稿子改过但音频没重做（对齐文件里的原文与稿子不同），请重跑 tts.py')
        ct, ratio = char_times(text, al["alignment"])
        if ratio < 0.98:
            warnings.append(f'{seg["id"]}：对齐串与原文相似度 {ratio:.2f}，时间可能不准')

        nxt = order[si + 1] if si + 1 < len(order) else None
        if "gap_after" in seg:
            gap = seg["gap_after"]
        elif nxt is None:
            gap = 0.0
        elif nxt["chapter"] != seg["chapter"]:
            gap = voice["gaps"]["chapter"]
        else:
            gap = voice["gaps"]["segment"]
        segs.append({"id": seg["id"], "chapter": seg["chapter"], "audio": al["audio"],
                     "offset": round(offset, 3), "duration": al["duration"], "gap_after": gap})

        cursor = 0
        seg_words = []
        for s in seg["sentences"]:
            a = text.index(s["text"], cursor)
            b = a + len(s["text"])
            cursor = b
            toks = tokenize(s["text"])
            sw = []
            for i, (w, wa, wb) in enumerate(toks, 1):
                t = span_time(ct, a + wa, a + wb)
                rec = {"sentence": s["id"], "i": i, "text": w,
                       "start": round(offset + t[0], 3), "end": round(offset + t[1], 3)}
                sw.append(rec)
            words.extend(sw)
            seg_words.extend(sw)
            if sw:
                sents.append({"id": s["id"], "segment": seg["id"], "start": sw[0]["start"], "end": sw[-1]["end"]})
            for e in s.get("emphasis", []):
                k = s["text"].find(e["text"])
                if k < 0:
                    warnings.append(f'{s["id"]}.{e["id"]}：重点词「{e["text"]}」不在句子原文里')
                    continue
                t = span_time(ct, a + k, a + k + len(e["text"]), text)
                emph.append({"ref": f'{s["id"]}.{e["id"]}', "text": e["text"], "type": e["type"],
                             "start": round(offset + t[0], 3), "end": round(offset + t[1], 3)})

        # 段内停顿
        for w0, w1 in zip(seg_words, seg_words[1:]):
            d = round(w1["start"] - w0["end"], 3)
            if d >= pmin:
                kind = "sentence" if w0["sentence"] != w1["sentence"] else "word"
                pauses.append({"start": w0["end"], "end": w1["start"], "dur": d, "kind": kind})
                cuts.append({"t": round((w0["end"] + w1["start"]) / 2, 3),
                             "strength": strength(d) + (1 if kind == "sentence" else 0),
                             "after": w0["sentence"] if kind == "sentence" else f'{w0["sentence"]}.w{w0["i"]}'})
        # 段间停顿
        if prev_last_word and seg_words:
            pe, psid, pch = prev_last_word
            d = round(seg_words[0]["start"] - pe, 3)
            pauses.append({"start": pe, "end": seg_words[0]["start"], "dur": d, "kind": "segment"})
            st = voice["pauses"]["chapter_strength"] if pch != seg["chapter"] else max(3, strength(d))
            cuts.append({"t": round((pe + seg_words[0]["start"]) / 2, 3), "strength": st, "after": psid})
        if seg_words:
            prev_last_word = (seg_words[-1]["end"], seg_words[-1]["sentence"], seg["chapter"])
        offset += al["duration"] + gap

    duration = round(offset, 3)
    for c in cuts:
        c["strength"] = min(4, max(1, c["strength"]))
    cuts.sort(key=lambda c: c["t"])

    chapters = []
    for c in script["chapters"]:
        cs = [s for s in segs if s["chapter"] == c["id"]]
        if cs:
            chapters.append({"id": c["id"], "start": cs[0]["offset"]})
    for i, c in enumerate(chapters):
        c["end"] = chapters[i + 1]["start"] if i + 1 < len(chapters) else duration

    tl = {"schema": "timeline/v1", "episode_id": script["episode_id"], "duration": duration,
          "segments": segs, "chapters": chapters, "sentences": sents, "words": words,
          "emphasis": emph, "pauses": pauses, "cut_candidates": cuts}
    save(ep / FILES["timeline"], tl)
    print(f"时间轴已写出：{ep / FILES['timeline']}")
    print(f"  总长 {duration:.2f}s｜{len(segs)} 段｜{len(sents)} 句｜{len(words)} 词｜{len(emph)} 个重点词｜{len(cuts)} 个候选切点")
    for w in warnings:
        print("  警告：" + w)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
