# 新闻动画自动工作流

每期 6–15 分钟的新闻解说动画。账号风格统一，每期内容不同。所有 AI 都从本仓库取输入、往本仓库交输出，彼此之间只靠 `contracts/` 里的数据合同交接。

## 两层结构

- `channel/`：**频道层**，建一次、少改。包括频道圣经、配音参数、BGM 库、引擎和镜头模板。
- `episodes/<日期-短名>/`：**每期层**，每期新做。

```
episodes/2026-11-20-xxx/
  01_script.json        稿子（Gemini → 人审批）
  02_audio/             每段配音 + 字符级对齐（ElevenLabs）、整条人声轨 voice_full.wav
  03_timeline.json      时间轴（脚本自动生成）
  04_assets/            图片 raw/ + manifest.json（ChatGPT 找图 → 预处理 → 人抽查）
  05_storyboard.json    分镜（Claude → 人审批）
  06_scenes/            定制镜头代码（Claude）
  07_review/            校验报告（脚本 + GPT）
  08_out/               成片
```

## 每期流程

| # | 环节 | 执行者 | 产出 | 人把关 |
|---|---|---|---|---|
| 1 | 稿子 | Gemini | 01_script.json | **审批** |
| 2 | 配音 | `tools/tts.py`（ElevenLabs） | 02_audio/ | — |
| 3 | 时间轴 | `tools/timeline.py` | 03_timeline.json | — |
| 4 | 找图 | ChatGPT + 预处理脚本 | 04_assets/ | 抽查 |
| 5 | 分镜 + 风格帧 | Claude | 05_storyboard.json + 关键帧 | **审批** |
| 6 | 制作 | Claude（按章节并行） | 参数 + 06_scenes/ | — |
| 7 | 校验 | `tools/validate.py` → GPT → Claude 修复 | 07_review/ | — |
| 8 | 渲染 + 混音 | 脚本 | 08_out/ | **看成片** |

## 搭建进度

- [x] 第 1 步（部分）：数据合同、配音、时间轴、人声轨、合同校验
- [ ] 第 0 步：频道圣经（`channel/bible.md` 草案中，等创意拍板）
- [ ] 第 1 步（剩余）：图片预处理、BGM 选曲与混音、GitHub Actions
- [ ] 第 2 步：引擎 + 镜头模板（频道套件）
- [ ] 第 3 步：分镜 agent
- [ ] 第 4 步：制作 + GPT 校验闭环
- [ ] 第 5 步：串成 Actions + 审批关卡
- [ ] 第 6 步：复盘记忆

## 现在就能跑

```bash
pip install jsonschema          # 唯一的 Python 依赖；还需要 ffmpeg
python3 tools/mock_tts.py episodes/_example     # 没有 API key 时用假配音
# 或：ELEVENLABS_API_KEY=... python3 tools/tts.py episodes/<本期>
python3 tools/timeline.py episodes/_example
python3 tools/voice_track.py episodes/_example
python3 tools/validate.py episodes/_example
```

规则细节见 `docs/contracts.md`。
