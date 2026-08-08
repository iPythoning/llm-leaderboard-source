// Monthly leaderboard generation — two-phase pipeline over the OmniRoute
// gateway (self-hosted, server 47), no Anthropic dependency:
//   1. research()  — a genuinely web-search-grounded model (default: Perplexity
//      Sonar Pro via tllm/sonar-pro) gathers current facts + real source URLs.
//   2. chatJSON()  — DeepSeek V4 Flash turns the research memo into the exact
//      schema shape (en+zh), then per-locale translation passes fill the rest.
// zod validates every stage; nothing invalid ever reaches data/.
//
// Env: OMNI_API_KEY (required), OMNI_BASE_URL (default https://omni.paibao.ai/v1),
// RESEARCH_MODEL (default tllm/sonar-pro), SYNTH_MODEL (default deepseek/deepseek-v4-flash),
// MONTH=YYYY-MM overrides the target month.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monthlySnapshotSchema, EXTRA_LOCALES, ALLOWED_ICONS } from '../schema/schema.mjs'
import { research, chatJSON } from './omni-client.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'data')
const RESEARCH_MODEL = process.env.RESEARCH_MODEL ?? 'tllm/sonar-pro'
const SYNTH_MODEL = process.env.SYNTH_MODEL ?? 'deepseek/deepseek-v4-flash'

const month = process.env.MONTH ?? new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

const existing = readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()
const refFile = existing.filter((f) => f < `${month}.json`).at(-1) ?? existing.at(-1)
if (!refFile) throw new Error('no reference snapshot in data/')
const reference = JSON.parse(readFileSync(join(DATA_DIR, refFile), 'utf8'))
console.log(`generating ${month} (reference: ${refFile}, research=${RESEARCH_MODEL}, synth=${SYNTH_MODEL})`)

const CATEGORY_IDS = reference.categories.map((c) => c.id)

async function withRetry(label, fn) {
  try {
    return await fn()
  } catch (err) {
    console.warn(`${label}: retrying after error: ${err.message}`)
    return await fn()
  }
}

// ---------- phase 1: web research memo (plain text, real citations) ----------
const RESEARCH_SYSTEM = `You are a research analyst preparing the primary-source dossier for a monthly LLM leaderboard covering these exact 9 categories, in this order: ${CATEGORY_IDS.join(', ')}.

Use web search. For EVERY factual claim (current leader, score, release date, price) you must have actually retrieved it from a search result this turn — never state a figure you did not find. If a category's landscape hasn't changed since the reference issue, say so explicitly rather than inventing change.

For each category, report:
- current leader (model name + company), and previous leader if it changed since the reference issue
- top 4-6 models ranked, each with: company, a one-line score/benchmark figure if available, 3-5 concrete strengths (numbers/dates/benchmarks, not adjectives), release date if known
- what changed this month vs the reference issue
- one sentence starting "As of ${today}, ..." stating the leader and a concrete number — this must be a fact you can attribute to a specific source

Also report 3-5 cross-category trend observations for the month, and list every source you actually consulted with its real URL and the date you checked it (benchmark sites like Artificial Analysis / LMArena / SWE-bench, official vendor changelogs/announcements).

Write in English, structured with clear headers per category. Be concrete and numeric. Do not pad with generic commentary.`

const memo = await withRetry('research', () =>
  research({
    model: RESEARCH_MODEL,
    system: RESEARCH_SYSTEM,
    user: `Reference issue (${reference.month}) for continuity — current leaders and category structure:\n\n${JSON.stringify(
      reference.categories.map((c) => ({ id: c.id, currentLeader: c.currentLeader, leaderCompany: c.leaderCompany })),
      null,
      1,
    )}\n\nResearch the current state of each category for the ${month} issue now.`,
    maxTokens: 8000,
  }),
)
console.log(`research memo: ${memo.length} chars`)

// ---------- phase 2: core en+zh snapshot, structured from the memo ----------
const CORE_SYSTEM = `You are the editor of a monthly LLM leaderboard published on commercial AI-platform websites (English and Chinese editions). You are given a research memo already grounded in real web search — use ONLY the facts and URLs it contains. Do not invent models, scores, dates, or URLs beyond what the memo states.

Produce ONE JSON object with this exact shape (no markdown fences, no commentary):
{
  "month": "${month}",
  "publishedAt": "<ISO 8601 timestamp with Z, now>",
  "asOf": "${today}",
  "sources": [{"name": string, "url": string, "asOf": "YYYY-MM-DD", "type": "benchmark"|"official-changelog"|"community-leaderboard"|"editorial"}, ...],
  "categories": [
    {
      "id": one of [${CATEGORY_IDS.map((c) => `"${c}"`).join(', ')}] — all 9, in this exact order,
      "icon": one of [${ALLOWED_ICONS.join(', ')}],
      "currentLeader": string, "leaderCompany": string, "previousLeader": string (omit if unchanged),
      "i18n": { "en": {...}, "zh": {...} } — each with "title","subtitle","description","changeNote","marketNote","geoSnippet" (geoSnippet must start with "As of ${today}" in en / "截至 ${today}" in zh, and cite a concrete number/rank),
      "models": [{"rank": int, "name": string, "company": string, "score": string, "i18n": {"en": {"highlight": string, "strengths": [string,...]}, "zh": {...}}}, ...] (4-6 models)
    }, ...
  ],
  "trendInsights": [{"id": "kebab-case-id", "i18n": {"en": {"title","description"}, "zh": {...}}}, ...] (3-5 items)
}

zh content is written natively for Chinese B2B readers, not a literal translation — but the facts, numbers, and URLs must match the en version exactly. Model names, company names, and scores stay in their original (usually English/Latin) form in both locales. Never mention this leaderboard's publisher or any internal tooling in the content.`

const core = await withRetry('synth', async () => {
  const draft = await chatJSON({
    model: SYNTH_MODEL,
    system: CORE_SYSTEM,
    user: `Research memo:\n\n${memo}\n\nReference issue (${reference.month}) for structure/tone continuity:\n\n${JSON.stringify(reference, null, 1)}\n\nProduce the ${month} issue JSON now.`,
    maxTokens: 16000,
  })
  draft.month = month
  return monthlySnapshotSchema.parse(draft)
})
console.log(`core ok: ${core.categories.length} categories, ${core.sources.length} sources`)

// ---------- phase 3: translate into the 6 extra locales (parallel) ----------
const LOCALE_NAMES = { ar: 'Arabic', pt: 'Brazilian Portuguese', es: 'Spanish (Latin America)', id: 'Indonesian', fr: 'French', tr: 'Turkish' }

const enOnly = {
  categories: core.categories.map((c) => ({
    id: c.id,
    i18n: c.i18n.en,
    models: c.models.map((m) => ({ rank: m.rank, name: m.name, i18n: m.i18n.en })),
    ...(c.features ? { features: c.features.map((f) => f.en) } : {}),
  })),
  trendInsights: core.trendInsights.map((t) => ({ id: t.id, i18n: t.i18n.en })),
}

async function translate(locale) {
  return withRetry(`translate:${locale}`, async () => {
    const patch = await chatJSON({
      model: SYNTH_MODEL,
      system: `You are a professional localizer for a monthly LLM leaderboard. Translate the provided English editorial content into ${LOCALE_NAMES[locale]} for B2B readers. Keep model names, company names, scores, dates and numbers unchanged. geoSnippet keeps its "As of ${today}" time anchor translated naturally into ${LOCALE_NAMES[locale]}. Preserve every id and rank exactly; translate every category (title/subtitle/description/changeNote/marketNote/geoSnippet), every model (highlight/strengths, same count and order), every feature string (same count and order) and every trend insight (title/description). Output ONE JSON object: {"categories":[{"id":str,"i18n":{...},"models":[{"rank":int,"i18n":{...}}],"features":[str,...]?}],"trendInsights":[{"id":str,"i18n":{...}}]} — no markdown fences, no commentary.`,
      user: JSON.stringify(enOnly, null, 1),
      maxTokens: 12000,
    })
    for (const pc of patch.categories) {
      const c = core.categories.find((x) => x.id === pc.id)
      if (!c) throw new Error(`${locale}: unknown category ${pc.id}`)
      c.i18n[locale] = pc.i18n
      for (const pm of pc.models) {
        const m = c.models.find((x) => x.rank === pm.rank)
        if (!m) throw new Error(`${locale}: ${pc.id} unknown rank ${pm.rank}`)
        m.i18n[locale] = pm.i18n
      }
      if (c.features) {
        if (!pc.features || pc.features.length !== c.features.length)
          throw new Error(`${locale}: ${pc.id} features count mismatch`)
        c.features.forEach((f, i) => { f[locale] = pc.features[i] })
      }
    }
    for (const pt of patch.trendInsights) {
      const t = core.trendInsights.find((x) => x.id === pt.id)
      if (!t) throw new Error(`${locale}: unknown trend ${pt.id}`)
      t.i18n[locale] = pt.i18n
    }
    console.log(`translate ok: ${locale}`)
  })
}

if (process.env.SKIP_TRANSLATIONS !== '1') {
  await Promise.all(EXTRA_LOCALES.map(translate))
}

// ---------- final validation + write ----------
const finalSnap = monthlySnapshotSchema.parse(core)
const outPath = join(DATA_DIR, `${month}.json`)
writeFileSync(outPath, JSON.stringify(finalSnap, null, 1) + '\n')
console.log(`wrote ${outPath}`)
