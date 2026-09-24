// Add the six optional locales to an existing monthly snapshot without rerunning research/core synthesis.
// Useful when the core model succeeds but a large translation request is truncated by the gateway.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monthlySnapshotSchema, EXTRA_LOCALES } from '../schema/schema.mjs'
import { chatJSON } from './omni-client.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const month = process.env.MONTH || new Date().toISOString().slice(0, 7)
const model = process.env.SYNTH_MODEL || 'auto/smart'
const path = join(ROOT, 'data', `${month}.json`)
const snapshot = monthlySnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
const localeNames = {
  ar: 'Arabic',
  pt: 'Brazilian Portuguese',
  es: 'Spanish (Latin America)',
  id: 'Indonesian',
  fr: 'French',
  tr: 'Turkish',
}

const system = (locale) => `You are a professional localizer for a monthly LLM leaderboard. Translate the provided English editorial content into ${localeNames[locale]} for B2B readers. Keep model names, company names, scores, dates and numbers unchanged. Preserve every id and rank exactly. Translate every field, keeping the same array counts and order. Output ONLY valid JSON, with no markdown or commentary.`

async function withRetry(label, fn) {
  try {
    return await fn()
  } catch (err) {
    console.warn(`${label}: retrying after error: ${err.message}`)
    return fn()
  }
}

async function translateCategory(locale, category) {
  const input = {
    id: category.id,
    i18n: category.i18n.en,
    models: category.models.map((model) => ({ rank: model.rank, i18n: model.i18n.en })),
  }
  const result = await chatJSON({
    model,
    system: system(locale),
    user: JSON.stringify(input, null, 1),
    maxTokens: 7000,
  })
  if (result.id !== category.id || !result.i18n || !Array.isArray(result.models))
    throw new Error(`${locale}/${category.id}: invalid category translation`)
  category.i18n[locale] = result.i18n
  for (const translated of result.models) {
    const target = category.models.find((item) => item.rank === translated.rank)
    if (!target || !translated.i18n) throw new Error(`${locale}/${category.id}: invalid model translation`)
    target.i18n[locale] = translated.i18n
  }
}

async function translateTrends(locale) {
  const result = await chatJSON({
    model,
    system: system(locale),
    user: JSON.stringify(snapshot.trendInsights.map((item) => ({ id: item.id, i18n: item.i18n.en })), null, 1),
    maxTokens: 5000,
  })
  if (!Array.isArray(result) || result.length !== snapshot.trendInsights.length)
    throw new Error(`${locale}: invalid trend translation`)
  for (const translated of result) {
    const target = snapshot.trendInsights.find((item) => item.id === translated.id)
    if (!target || !translated.i18n) throw new Error(`${locale}: unknown trend ${translated.id}`)
    target.i18n[locale] = translated.i18n
  }
}

for (const locale of EXTRA_LOCALES) {
  process.env.LOCALE = locale
  await withRetry(`translate:${locale}`, async () => {
    for (const category of snapshot.categories) await translateCategory(locale, category)
    await translateTrends(locale)
    console.log(`translated ${locale}`)
  })
}

const validated = monthlySnapshotSchema.parse(snapshot)
writeFileSync(path, JSON.stringify(validated, null, 1) + '\n')
console.log(`wrote ${path}`)
