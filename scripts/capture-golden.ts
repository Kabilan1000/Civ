// Records the v5 golden-state fixture (TDS §6.4, D1/D6) from the CURRENT
// simulation. Run on a clean checkout, before changing any sim code:
//   node --experimental-strip-types scripts/capture-golden.ts <commit>
import { writeFileSync } from 'node:fs'
import { SCHEMA_VERSION } from '../src/sim/constants.ts'
import { computeGolden, GOLDEN_SEEDS, type GoldenFixture } from '../src/sim/__tests__/golden.ts'

const commit = process.argv[2]
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('usage: capture-golden.ts <full 40-char commit hash>')

const fixture: GoldenFixture = {
  description:
    'Pre-M10a golden serialize() hashes. M10a must reproduce every hash byte for byte; retired in M10b, where simulation behaviour changes on purpose.',
  schemaVersion: SCHEMA_VERSION,
  sourceCommit: commit,
  seeds: GOLDEN_SEEDS.map((seed) => computeGolden(seed)),
}
const out = new URL('../src/sim/__tests__/fixtures/golden-v5.json', import.meta.url)
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log(`wrote ${out.pathname} (${fixture.seeds.length} seeds) from ${commit}`)
