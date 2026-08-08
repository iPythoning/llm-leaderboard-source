# llm-leaderboard-source

LLM 月度排行榜的**唯一权威数据源**。三个消费平台（pulseagent.io 全 8 语言、paibao.ai/paibaowork.com、paibaowork.com 阿里云 EmDash 站）都从这里接收数据，不各自维护拷贝。

## 数据流

```
monthly-generate.yml (每月 27 日 cron，无人值守)
  └─ scripts/generate.mjs   两段式，全走自建 OmniRoute 网关，不碰 Anthropic：
       ① research()   Sonar Pro（真联网+带引用）产出研究备忘录
       ② chatJSON()   DeepSeek V4 Flash 把备忘录整理成 schema JSON（en+zh）+ 6 语言翻译
  └─ scripts/validate.mjs   zod 校验，任何不合法输出都不落盘
  └─ commit data/YYYY-MM.json → main
        └─ sync.yml (push 触发)
             └─ scripts/sync.mjs  POST 全部月份到三个平台的鉴权端点
                  ├─ pulseagent.io   POST /api/leaderboard/ingest  → D1，页面即时更新，无需部署
                  ├─ paibao-portal   POST /api/leaderboard/publish → 持久卷 overlay + revalidate，即时生效
                  └─ paibaowork.com  POST /api/leaderboard/ingest  → sqlite /data 卷，即时生效
```

## LLM 网关

`scripts/omni-client.mjs` 是给 OmniRoute（自建网关，服务器 47，`https://omni.paibao.ai/v1`，OpenAI 兼容
`/v1/chat/completions`）用的极简 fetch 封装，不依赖任何 provider SDK。模型可用 env 覆盖：

- `RESEARCH_MODEL`（默认 `tllm/sonar-pro`）——**必须是真联网模型**。改模型前用
  `curl https://omni.paibao.ai/v1/models` 确认它真的联网（`felo/felo-search`、`pol/perplexity-*`
  也是候选），不要凭 `tool_calling: true` 就假设它能查到本周发布的新模型——那只代表支持
  function calling，不代表内置检索。
- `SYNTH_MODEL`（默认 `deepseek/deepseek-v4-flash`）——负责把研究备忘录整理成结构化 JSON +
  6 语言翻译，不需要联网。

## Schema

`schema/schema.mjs` = 权威 schema（移植自 paibao-portal `lib/leaderboard/schema.ts`，四仓保持一致）。
en + zh 必填；ar/pt/es/id/fr/tr 可选，消费端渲染时回退 en。9 个分类 id 固定：
`reasoning image video code voice music vision open-source cost-effectiveness`。

## Secrets / Vars（GitHub 仓库设置）

| 名称 | 类型 | 用途 |
|---|---|---|
| `OMNI_API_KEY` | secret | 月度生成——OmniRoute 专用 key（**不要复用 PulseAgent 生产 key**，泄漏半径不同） |
| `OMNI_BASE_URL` | var（可选） | 默认 `https://omni.paibao.ai/v1`，不用配 |
| `RESEARCH_MODEL` / `SYNTH_MODEL` | var（可选） | 覆盖默认模型 |
| `PULSEAGENT_INGEST_URL` | var | `https://pulseagent.io/api/leaderboard/ingest` |
| `PULSEAGENT_INGEST_TOKEN` | secret | 与 pulseagent-io worker secret `LEADERBOARD_INGEST_TOKEN` 同值 |
| `PAIBAO_INGEST_URL` | var | `https://paibao.ai/api/leaderboard/publish` |
| `PAIBAO_INGEST_TOKEN` | secret | 与 portal 容器 env `LEADERBOARD_API_KEY` 同值 |
| `PAIBAOWORK_INGEST_URL` | var | `https://paibaowork.com/api/leaderboard/ingest` |
| `PAIBAOWORK_INGEST_TOKEN` | secret | 与阿里云站 `cms/.env.runtime` 的 `LEADERBOARD_INGEST_TOKEN` 同值 |

## 本地命令

```bash
npm ci
npm run validate                 # 校验 data/ 全部月份
MONTH=2026-08 OMNI_API_KEY=... npm run generate   # 手动生成某月
npm run sync                     # 手动推送（需上表 env）
```
