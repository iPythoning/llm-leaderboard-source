// Monthly leaderboard generation: web research (server-side web_search) → core
// en+zh snapshot → parallel translation into the 6 extra locales → zod-validated
// data/<month>.json. Fails loudly on any invalid output; never publishes junk.
//
// Env: ANTHROPIC_API_KEY (or an `ant auth login` profile). MONTH=YYYY-MM overrides.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { monthlySnapshotSchema, EXTRA_LOCALES, ALLOWED_ICONS } from '../schema/schema.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'data')
const MODEL = 'claude-opus-5'

const client = new Anthropic({ timeout: 30 * 60 * 1000 })

const month = process.env.MONTH ?? new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

const existing = readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()
const refFile = existing.filter((f) => f < `${month}.json`).at(-1) ?? existing.at(-1)
if (!refFile) throw new Error('no reference snapshot in data/')
const reference = JSON.parse(readFileSync(join(DATA_DIR, refFile), 'utf8'))
console.log(`generating ${month} (reference: ${refFile})`)

// ---------- coarse JSON schemas for structured output (zod does strict checks after) ----------
const S = {
  str: { type: 'string' },
  dict: (props, required) => ({ type: 'object', properties: props, required, additionalProperties: false }),
  arr: (items) => ({ type: 'array', items }),
}
const localeDict = (value, locales) => S.dict(Object.fromEntries(locales.map((l) => [l, value])), locales)

const coreLocales = ['en', 'zh']
const modelI18n = S.dict({ highlight: S.str, strengths: S.arr(S.str) }, ['highlight', 'strengths'])
const catI18n = S.dict(
  { title: S.str, subtitle: S.str, description: S.str, changeNote: S.str, marketNote: S.str, geoSnippet: S.str },
  ['title', 'subtitle', 'description', 'geoSnippet'],
)
const coreSchema = S.dict(
  {
    month: S.str,
    publishedAt: S.str,
    asOf: S.str,
    sources: S.arr(S.dict({ name: S.str, url: S.str, asOf: S.str, type: { type: 'string', enum: ['benchmark', 'official-changelog', 'community-leaderboard', 'editorial'] } }, ['name', 'url', 'asOf', 'type'])),
    categories: S.arr(S.dict(
      {
        id: S.str,
        icon: { type: 'string', enum: ALLOWED_ICONS },
        currentLeader: S.str,
        leaderCompany: S.str,
        previousLeader: S.str,
        i18n: localeDict(catI18n, coreLocales),
        models: S.arr(S.dict({ rank: { type: 'integer' }, name: S.str, company: S.str, score: S.str, i18n: localeDict(modelI18n, coreLocales) }, ['rank', 'name', 'company', 'i18n'])),
        features: S.arr(localeDict(S.str, coreLocales)),
      },
      ['id', 'icon', 'currentLeader', 'leaderCompany', 'i18n', 'models'],
    )),
    trendInsights: S.arr(S.dict({ id: S.str, i18n: localeDict(S.dict({ title: S.str, description: S.str }, ['title', 'description']), coreLocales) }, ['id', 'i18n'])),
  },
  ['month', 'publishedAt', 'asOf', 'sources', 'categories', 'trendInsights'],
)

const patchSchema = S.dict(
  {
    categories: S.arr(S.dict(
      {
        id: S.str,
        i18n: catI18n,
        models: S.arr(S.dict({ rank: { type: 'integer' }, i18n: modelI18n }, ['rank', 'i18n'])),
        features: S.arr(S.str),
      },
      ['id', 'i18n', 'models'],
    )),
    trendInsights: S.arr(S.dict({ id: S.str, i18n: S.dict({ title: S.str, description: S.str }, ['title', 'description']) }, ['id', 'i18n'])),
  },
  ['categories', 'trendInsights'],
)

// ---------- API helpers ----------
async function structuredCall({ system, user, schema, tools, maxTokens }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    ...(tools ? { tools } : {}),
  })
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'refusal') throw new Error(`refusal: ${msg.stop_details?.category ?? 'unknown'}`)
  if (msg.stop_reason === 'max_tokens') throw new Error('output truncated (max_tokens)')
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return JSON.parse(text)
}

async function withRetry(label, fn) {
  try {
    return await fn()
  } catch (err) {
    console.warn(`${label}: retrying after error: ${err.message}`)
    return await fn()
  }
}

// ---------- step 1: core en+zh snapshot with web research ----------
const CORE_SYSTEM = `You are the editor of a monthly LLM leaderboard published on two commercial AI-platform websites (English and Chinese editions). You research the current state of AI models with web search, then produce one JSON document following the provided schema exactly.

Hard rules:
- Keep the exact 9 category ids, icons, and their order from the reference issue. Do not add or remove categories.
- Rankings must reflect verifiable, current public evidence: LMArena/lmarena.ai, Artificial Analysis, LiveBench, official vendor changelogs and model release announcements. Cite each consulted source in "sources" with the real URL and an asOf date.
- Each category lists 4-6 models, rank 1 = leader. currentLeader/leaderCompany mirror rank 1. Set previousLeader only when the leader changed vs the reference issue (use the reference issue's currentLeader).
- geoSnippet must begin with "As of ${today}" (zh: "截至 ${today}") and cite concrete ranks/scores — it is the sentence we want AI answer engines to quote verbatim.
- zh content is written natively for Chinese B2B readers, not literal translation. Model names, company names and scores stay in their original form.
- trendInsights: 3-5 cross-category observations about this month's model landscape.
- month="${month}", publishedAt=now (ISO 8601 with Z), asOf="${today}".
- Never mention this leaderboard's publisher or any internal tooling in the content.`

const core = await withRetry('core', async () => {
  const draft = await structuredCall({
    system: CORE_SYSTEM,
    user: `Reference issue (${reference.month}) for structure, tone and previous leaders:\n\n${JSON.stringify(reference, null, 1)}\n\nResearch the current model landscape and produce the ${month} issue now.`,
    schema: coreSchema,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 30 }],
    maxTokens: 100000,
  })
  draft.month = month
  return monthlySnapshotSchema.parse(draft)
})
console.log(`core ok: ${core.categories.length} categories, ${core.sources.length} sources`)

// ---------- step 2: translate into the 6 extra locales (parallel) ----------
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
    const patch = await structuredCall({
      system: `You are a professional localizer for a monthly LLM leaderboard. Translate the provided English editorial content into ${LOCALE_NAMES[locale]} for B2B readers. Keep model names, company names, scores, dates and numbers unchanged. geoSnippet keeps its "As of ${today}" time anchor translated naturally into ${LOCALE_NAMES[locale]}. Preserve every id and rank exactly; translate every category, every model, every feature string (same count and order) and every trend insight. Output JSON per the schema.`,
      user: JSON.stringify(enOnly, null, 1),
      schema: patchSchema,
      maxTokens: 64000,
    })
    // merge patch into core
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
