import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monthlySnapshotSchema } from '../schema/schema.mjs'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const files = readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()

if (files.length === 0) {
  console.error('validate: no data files found')
  process.exit(1)
}

let failed = false
for (const f of files) {
  try {
    const snap = monthlySnapshotSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')))
    if (`${snap.month}.json` !== f) throw new Error(`month field ${snap.month} does not match filename`)
    const locales = new Set(Object.keys(snap.categories[0].i18n))
    console.log(`ok   ${f}  categories=${snap.categories.length} locales=${[...locales].join(',')}`)
  } catch (err) {
    failed = true
    console.error(`FAIL ${f}\n${err.message}`)
  }
}
process.exit(failed ? 1 : 0)
