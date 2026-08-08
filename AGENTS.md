# AGENTS.md — llm-leaderboard-source

> 全局规则见 `~/AGENTS.md`（冲突时以它为准）。开工前读 `docs/HANDOFF.md`。

## 这是什么

LLM 月度排行榜的唯一权威数据源 + 无人值守月度生成/同步流水线。消费端三个：
pulseagent.io（Astro/CF Worker，D1 ingest）、paibao-portal（Next.js，文件 overlay ingest）、
paibaowork.com 阿里云 EmDash 站（sqlite ingest）。详见 README.md 的数据流图。

## 验证命令

```bash
npm ci && npm run validate
```

## 红线

- `schema/schema.mjs` 是三个平台共同依赖的合同——改字段必须同步改三边渲染代码，否则等于破坏下游。
- 生成器输出必须过 zod 校验才落盘；禁止放宽校验来「让 CI 绿」。
- 数据内容面向终端读者：禁止出现内部代号/技术栈（customer-facing-language 规则适用）。
- secrets 只经 GitHub Actions secrets 注入，仓库文件里永不出现 token；`OMNI_API_KEY` 用专用
  key，不复用 PulseAgent 生产 key（共享泄漏半径）。
- **联网能力不能靠猜**：`RESEARCH_MODEL` 必须是 OmniRoute `/v1/models` 里真正联网检索的模型
  （如 `tllm/sonar-pro`）。`capabilities.tool_calling: true` 只代表支持 function calling，
  不代表内置网络检索——换模型前先 `curl https://omni.paibao.ai/v1/models` 核实，别凭字段名猜。
