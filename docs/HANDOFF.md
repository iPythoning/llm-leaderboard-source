# 交接状态 · HANDOFF（llm-leaderboard-source）

## 当前目标

把 pulseagent.io 与 paibao.ai/paibaowork.com 的 LLM leaderboard 收敛到本仓单一权威源，月度无人值守更新（2026-08-08 创建）。

## 已完成

- 数据合流：2026-04（8 语言）、2026-06、2026-07（en+zh）来自 paibao-portal 与 pulseagent-io-site，`npm run validate` 全绿。
- `schema/schema.mjs`：权威 zod schema（移植 portal 版，en+zh 必填 + 6 语言可选）。
- `scripts/generate.mjs`（**2026-08-08 重写，不再依赖 Anthropic**）：两段式，全走自建 OmniRoute
  网关（`https://omni.paibao.ai/v1`，OpenAI 兼容）。① `research()` 用 `tllm/sonar-pro`（真联网+
  带引用）产研究备忘录；② `chatJSON()` 用 `deepseek/deepseek-v4-flash` 把备忘录整理成 en+zh
  核心 JSON，再并行翻译 6 语言。JSON 模式失败一次自动带错误信息重试；429/5xx 重试 3 次。
  `scripts/omni-client.mjs` 是零依赖 fetch 封装。
  ⚠️ **踩坑记录**：一开始误判「omni 免费池/付费池都没有联网能力」——这是没查上游注册表就下
  的结论，违反 `~/AGENTS.md` 的「上游优先检查」铁律。老板纠正后实测
  `curl https://omni.paibao.ai/v1/models`（走 ssh pulse 到 127.0.0.1:20128，OmniRoute 自身
  API）才发现 `tllm/sonar-pro`/`felo/felo-search`/`pol/perplexity-*` 都是真联网模型。
  教训：`capabilities.tool_calling: true` 只代表支持 function calling，不代表内置检索——
  两者是完全不同的能力，别混。
- `scripts/sync.mjs`：POST 全部月份到两个平台 ingest 端点（幂等 upsert，配置了的目标失败即红）。
- workflows：`monthly-generate.yml`（每月 27 日 cron → commit main）、`sync.yml`（data/ 变更 → 推两平台）。
- **2026-09-24 9月天梯榜真正更新完成**：
  - `research/2026-09.md`：核对 Artificial Analysis LLM/Image/Video/TTS/Music、Terminal-Bench 2.1、Vision Arena、MMMU-Pro 与 GDPval-AA 页面。
  - `data/2026-09.json`：9 类、7 个来源、en+zh，`npm run validate` 全绿；六个可选语言按 schema 约定缺失时回退 en。
  - 9 月主要变化：Claude Opus 5.5 以 Intelligence Index 58 取代 Opus 5；GPT Image 2.5 Sunburst 以 Elo 1197 领先图像；Gemini Omni Flash 以 Elo 1233 领先含音频视频；Sonic 3.6 以 Elo 1278 领先 TTS；Mureka V9 以 Elo 1177 领先器乐；Claude Fable 5 High 以 Vision Arena 1310±8 领先视觉；MiMo-V2.6-Pro 以 46 领先开源权重；GPT-6 Luna (low) 以 $0.0045/task 领先成本。
  - `scripts/generate.mjs` 改为按分类独立合成核心 JSON，并将图标固定回 schema 合同；翻译请求按小块发送，避免网关截断。
  - 三端同步：pulseagent.io 与 paibao.ai 已在首次 push ingest 成功；paibaowork.com 因远端 `LEADERBOARD_INGEST_TOKEN` 缺失返回 503，已备份 `.env.runtime`、轮换 GitHub `PAIBAOWORK_INGEST_TOKEN`、注入远端 env，并用原生产镜像 digest 重建容器后定向同步成功。

- **2026-09 同步（2026-09-24 收口）**：三端均已 ingest 真实 2026-09，并在公开页核对到 2026-09、Claude Opus 5.5 与 GPT Image 2.5 Sunburst。
  - ✅ pulseagent.io `/tools/llm-leaderboard` + `/zh/tools/llm-leaderboard`
  - ✅ paibao.ai `/zh|en/tools/llm-leaderboard`（当前公网跳转至 paibaowork 页面，内容已核对）
  - ✅ paibaowork.com `/tools/llm-leaderboard`（定向 sync run 成功）
- 本期使用 `SKIP_TRANSLATIONS=1` 生成并交付 en+zh 核心快照；现有 2026-06～2026-08 也采用 en+zh，六语言由消费端回退 en。首次完整翻译仍需在翻译模型稳定后单独抽查。
- `OMNI_API_KEY` 已设；GitHub `SYNTH_MODEL` 当前为 `auto/smart`，`RESEARCH_MODEL` 未覆盖时回退 `tllm/sonar-pro`。GitHub hosted runner 对部分搜索路由有 egress/认证限制，真实月度运行前先验证模型可用性。
- `generate.mjs` 现在按分类生成核心快照并按 schema 固定 icon；`skip_translations` 是翻译供应商故障时的显式手动降级开关，不应作为常规路径。
- 消费端三条腿：
  ① pulseagent.io `POST /api/leaderboard/ingest`（D1，已上线）；
  ② paibao-portal `POST /api/leaderboard/publish`（overlay 卷，已上线）；
  ③ paibaowork.com `POST /api/leaderboard/ingest`（sqlite `/data` 卷，已恢复 `LEADERBOARD_INGEST_TOKEN` 并完成 2026-09 ingest）。

## 验证方式

`npm ci && npm run validate`
