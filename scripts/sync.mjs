// Push every monthly snapshot to each platform's authenticated ingest endpoint.
// Idempotent upsert: platforms replace their stored copy of each month.
// A configured target that fails => non-zero exit (CI turns red; nothing hides).
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monthlySnapshotSchema } from '../schema/schema.mjs'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGETS = [
  { name: 'pulseagent.io', url: process.env.PULSEAGENT_INGEST_URL, token: process.env.PULSEAGENT_INGEST_TOKEN },
  { name: 'paibao-portal', url: process.env.PAIBAO_INGEST_URL, token: process.env.PAIBAO_INGEST_TOKEN },
  { name: 'paibaowork.com', url: process.env.PAIBAOWORK_INGEST_URL, token: process.env.PAIBAOWORK_INGEST_TOKEN },
]

// ONLY_MONTH=YYYY-MM limits the push (useful when Cloudflare 429s burst POSTs).
// ONLY_TARGETS=comma-separated target names (pulseagent.io,paibao-portal,paibaowork.com).
const onlyMonth = process.env.ONLY_MONTH || ''
const onlyTargets = new Set(
  (process.env.ONLY_TARGETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const files = readdirSync(DATA_DIR)
  .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
  .filter((f) => !onlyMonth || f === `${onlyMonth}.json`)
  .sort()
if (!files.length) throw new Error(onlyMonth ? `no data/${onlyMonth}.json` : 'no snapshots in data/')
const snapshots = files.map((f) => monthlySnapshotSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'))))

async function postOnce(url, token, snap) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(snap),
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    const err = new Error(`HTTP ${res.status}: ${text}`)
    err.status = res.status
    throw err
  }
}

async function postWithRetry(target, snap) {
  let lastErr
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await postOnce(target.url, target.token, snap)
      return
    } catch (err) {
      lastErr = err
      if (err.status === 429 || err.status >= 500) {
        const wait = Math.min(60_000, 3000 * 2 ** attempt)
        console.warn(`retry ${target.name} ${snap.month} after ${err.status} (wait ${wait}ms)`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw lastErr
}

let failed = false
for (const target of TARGETS) {
  if (onlyTargets.size && !onlyTargets.has(target.name)) {
    console.warn(`skip ${target.name}: not in ONLY_TARGETS`)
    continue
  }
  if (!target.url || !target.token) {
    console.warn(`skip ${target.name}: URL/token not configured`)
    continue
  }
  for (const snap of snapshots) {
    try {
      await postWithRetry(target, snap)
      console.log(`ok   ${target.name} ${snap.month}`)
      await sleep(2000)
    } catch (err) {
      failed = true
      console.error(`FAIL ${target.name} ${snap.month}: ${err.message}`)
    }
  }
}
process.exit(failed ? 1 : 0)
