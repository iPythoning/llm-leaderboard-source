import { z } from 'zod'

// Canonical monthly-snapshot schema, ported from paibao-portal lib/leaderboard/schema.ts.
// en + zh are required (editorial base); the other six locales are optional and
// fall back to en at render time on both consuming platforms.
export const LOCALES = ['en', 'zh', 'ar', 'pt', 'es', 'id', 'fr', 'tr']
export const EXTRA_LOCALES = LOCALES.filter((l) => l !== 'en' && l !== 'zh')

const buildLocaleDict = (value) =>
  z.object({
    en: value,
    zh: value,
    ar: value.optional(),
    pt: value.optional(),
    es: value.optional(),
    id: value.optional(),
    fr: value.optional(),
    tr: value.optional(),
  })

export const ALLOWED_ICONS = [
  'Brain', 'Image', 'Video', 'Code', 'Mic', 'Music', 'Eye', 'GitBranch',
  'Bot', 'Sparkles', 'Cpu', 'Layers', 'Search', 'Map', 'Zap', 'MessageSquare',
]
const iconSchema = z.enum(ALLOWED_ICONS)

export const sourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['benchmark', 'official-changelog', 'community-leaderboard', 'editorial']),
})

const modelI18nSchema = z.object({
  highlight: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(8),
})

export const modelEntrySchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().min(1),
  company: z.string().min(1),
  score: z.string().optional(),
  i18n: buildLocaleDict(modelI18nSchema),
})

const categoryI18nSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().min(1),
  description: z.string().min(1),
  changeNote: z.string().optional(),
  marketNote: z.string().optional(),
  // GEO snippet — must lead with a time anchor ("As of YYYY-MM-DD") and cite
  // concrete numbers/ranks so AI engines can quote it as fact.
  geoSnippet: z.string().min(40),
})

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  icon: iconSchema,
  currentLeader: z.string().min(1),
  leaderCompany: z.string().min(1),
  previousLeader: z.string().optional(),
  i18n: buildLocaleDict(categoryI18nSchema),
  models: z.array(modelEntrySchema).min(1).max(10),
  features: z.array(buildLocaleDict(z.string().min(1))).optional(),
})

export const trendInsightSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  i18n: buildLocaleDict(z.object({ title: z.string().min(1), description: z.string().min(1) })),
})

export const monthlySnapshotSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  publishedAt: z.string().datetime(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: z.array(sourceSchema).min(1),
  categories: z.array(categorySchema).min(1),
  trendInsights: z.array(trendInsightSchema),
})
