// Push every monthly snapshot to each platform's authenticated ingest endpoint.
// Idempotent upsert: platforms replace their stored copy of each month.
// A configured target that fails => non-zero exit (CI turns red; nothing hides).
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monthlySnapshotSchema } from '../schema/schema.mjs'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

const TARGETS = [
  { name: 'pulseagent.io', url: process.env.PULSEAGENT_INGEST_URL, token: process.env.PULSEAGENT_INGEST_TOKEN },
  { name: 'paibao-portal', url: process.env.PAIBAO_INGEST_URL, token: process.env.PAIBAO_INGEST_TOKEN },
  { name: 'paibaowork.com', url: process.env.PAIBAOWORK_INGEST_URL, token: process.env.PAIBAOWORK_INGEST_TOKEN },
]

const files = readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()
const snapshots = files.map((f) => monthlySnapshotSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'))))

let failed = false
for (const target of TARGETS) {
  if (!target.url || !target.token) {
    console.warn(`skip ${target.name}: URL/token not configured`)
    continue
  }
  for (const snap of snapshots) {
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}` },
        body: JSON.stringify(snap),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
      console.log(`ok   ${target.name} ${snap.month}`)
    } catch (err) {
      failed = true
      console.error(`FAIL ${target.name} ${snap.month}: ${err.message}`)
    }
  }
}
process.exit(failed ? 1 : 0)
