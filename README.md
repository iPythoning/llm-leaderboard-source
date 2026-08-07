# llm-leaderboard-source

LLM 月度排行榜的**唯一权威数据源**。两个消费平台（pulseagent.io 全 8 语言、paibao.ai / paibaowork.com）都从这里接收数据，不各自维护拷贝。

## 数据流

```
monthly-generate.yml (每月 27 日 cron，无人值守)
  └─ scripts/generate.mjs   Claude (claude-opus-5 + web_search) 研究并生成当月 JSON（8 语言）
  └─ scripts/validate.mjs   zod 校验，任何不合法输出都不落盘
  └─ commit data/YYYY-MM.json → main
        └─ sync.yml (push 触发)
             └─ scripts/sync.mjs  POST 全部月份到两个平台的鉴权端点
                  ├─ pulseagent.io  POST /api/leaderboard/ingest  → D1，页面即时更新，无需部署
                  └─ paibao-portal  POST /api/leaderboard/publish → 持久卷 overlay + revalidate，即时生效
```

## Schema

`schema/schema.mjs` = 权威 schema（移植自 paibao-portal `lib/leaderboard/schema.ts`，两边保持一致）。
en + zh 必填；ar/pt/es/id/fr/tr 可选，消费端渲染时回退 en。9 个分类 id 固定：
`reasoning image video code voice music vision open-source cost-effectiveness`。

## Secrets / Vars（GitHub 仓库设置）

| 名称 | 类型 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | 月度生成 |
| `PULSEAGENT_INGEST_URL` | var | `https://pulseagent.io/api/leaderboard/ingest` |
| `PULSEAGENT_INGEST_TOKEN` | secret | 与 pulseagent-io worker secret `LEADERBOARD_INGEST_TOKEN` 同值 |
| `PAIBAO_INGEST_URL` | var | `https://paibao.ai/api/leaderboard/publish` |
| `PAIBAO_INGEST_TOKEN` | secret | 与 portal 容器 env `LEADERBOARD_API_KEY` 同值 |

## 本地命令

```bash
npm ci
npm run validate                 # 校验 data/ 全部月份
MONTH=2026-08 npm run generate   # 手动生成某月（需 ANTHROPIC_API_KEY 或 ant auth 登录）
npm run sync                     # 手动推送（需上表 env）
```
