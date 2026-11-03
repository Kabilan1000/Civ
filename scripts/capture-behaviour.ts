// Records fixtures/behaviour-v5.json: id-independent behaviour hashes
// (src/sim/__tests__/fingerprint.ts) for the golden seeds and checkpoints,
// from the CURRENT simulation. Run on a clean checkout before M10b:
//   node --experimental-strip-types scripts/capture-behaviour.ts <commit>
import { writeFileSync } from 'node:fs'
import { behaviourHash } from '../src/sim/__tests__/fingerprint.ts'
import { GOLDEN_SEEDS, GOLDEN_TICKS } from '../src/sim/__tests__/golden.ts'
import { createWorld, stepN } from '../src/sim/world.ts'

const commit = process.argv[2]
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('usage: capture-behaviour.ts <full 40-char commit hash>')
const seeds = GOLDEN_SEEDS.map((seed) => {
  const s = createWorld({ seed })
  const checkpoints = GOLDEN_TICKS.map((tick) => {
    stepN(s, tick - s.tick)
    return { tick, behaviour: behaviourHash(s) }
  })
  return { seed, checkpoints }
})
const out = new URL('../src/sim/__tests__/fixtures/behaviour-v5.json', import.meta.url)
writeFileSync(
  out,
  JSON.stringify(
    {
      description:
        'Pre-M10b id-independent behaviour hashes. With plant senescence disabled (the M10b default), the v6 simulation must reproduce every hash.',
      sourceCommit: commit,
      seeds,
    },
    null,
    2,
  ) + '\n',
)
console.log(`wrote ${out.pathname} from ${commit}`)
