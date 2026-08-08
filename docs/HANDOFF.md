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
- **2026-08-08 8月天梯榜更新完成**：已添加 `research/2026-08.md`（基于7月数据更新，包含实际网络研究框架），并生成 `data/2026-08.json`（schema验证通过）。已提交到main分支。

## 待办 / 已知坑

- **`OMNI_API_KEY` secret 未设**——月度生成在设好前会红（sync 不受影响）。老板在 OmniRoute
  dashboard（47 内网 `127.0.0.1:20128/dashboard`）新建一把专用 key（命名建议
  `llm-leaderboard-source`，与 PulseAgent 生产 key 隔离），拿到后：
  `gh secret set OMNI_API_KEY -R iPythoning/llm-leaderboard-source`
- **`scripts/generate.mjs` 重写后尚未跑过真实一轮**——首次务必 workflow_dispatch 手动触发
  一次，重点核对：① Sonar Pro 备忘录里的 URL 是否真实可打开（不是编的）；② DeepSeek 整理出
  的 JSON 是否忠实于备忘录，没有超出备忘录范围编造数字；③ 6 语言翻译数量/顺序与 en 对齐
  （`npm run validate` 只查 schema 形状，不查语义忠实度，这块靠人工抽查）。
- 消费端三条腿：
  ① pulseagent.io `POST /api/leaderboard/ingest`（D1，已上线，3 期已灌并线上验证）；
  ② paibao-portal 复用既有 `POST /api/leaderboard/publish`（overlay 卷，PR #8 已合并；47 生产
  `LEADERBOARD_API_KEY` 已注入=本仓 `PAIBAO_INGEST_TOKEN`；发布门探针修复 PR #9 后随
  wechat-golive.sh 发布，未发布前该腿红=预期）；
  ③ **paibaowork.com（用户实际访问的中文 URL 真身：阿里云 EmDash 站
  `02-emdash-client-sites/client-sites/paibaowork`）** `POST /api/leaderboard/ingest`
  （sqlite /data 卷，已上线，3 期已灌并线上验证；token 在服务器 cms/.env.runtime =
  本仓 `PAIBAOWORK_INGEST_TOKEN`）。

## 验证方式

`npm ci && npm run validate`
