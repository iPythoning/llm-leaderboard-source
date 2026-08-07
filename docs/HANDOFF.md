# 交接状态 · HANDOFF（llm-leaderboard-source）

## 当前目标

把 pulseagent.io 与 paibao.ai/paibaowork.com 的 LLM leaderboard 收敛到本仓单一权威源，月度无人值守更新（2026-08-08 创建）。

## 已完成

- 数据合流：2026-04（8 语言）、2026-06、2026-07（en+zh）来自 paibao-portal 与 pulseagent-io-site，`npm run validate` 全绿。
- `schema/schema.mjs`：权威 zod schema（移植 portal 版，en+zh 必填 + 6 语言可选）。
- `scripts/generate.mjs`：claude-opus-5 + web_search 生成 en+zh 核心，再并行翻译 6 语言，结构化输出 + zod 双重校验。
- `scripts/sync.mjs`：POST 全部月份到两个平台 ingest 端点（幂等 upsert，配置了的目标失败即红）。
- workflows：`monthly-generate.yml`（每月 27 日 cron → commit main）、`sync.yml`（data/ 变更 → 推两平台）。

## 待办 / 已知坑

- `ANTHROPIC_API_KEY` secret 未设——月度生成在设好前会红（sync 不受影响）。老板一条命令：
  `gh secret set ANTHROPIC_API_KEY -R iPythoning/llm-leaderboard-source`
- 消费端已接线：pulseagent.io `POST /api/leaderboard/ingest`（已上线，D1 已灌 3 期并线上验证）；
  paibao-portal 复用既有 `POST /api/leaderboard/publish`（PR #8，写 overlay 卷）——**47 生产的
  `LEADERBOARD_API_KEY` env 必须与本仓 secret `PAIBAO_INGEST_TOKEN` 同值**，portal 发布前
  sync 的 paibao 腿会红（这是预期信号，不是要修的 bug）。
- 生成器尚未跑过真实一轮（首月建议 workflow_dispatch 手动触发一次核对内容质量）。

## 验证方式

`npm ci && npm run validate`
