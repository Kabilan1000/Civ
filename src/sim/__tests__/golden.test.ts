import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assignFounderAges } from '../citizens/create.ts'
import { CLASSIC_PROFILE } from '../constants.ts'
import { createWorld, DEFAULT_SIM_RULES, stepWithRules } from '../world.ts'
import { behaviourHash } from './fingerprint.ts'
import { GOLDEN_SEEDS, GOLDEN_TICKS, tick0MapHash, type GoldenFixture } from './golden.ts'

// docs/design/LIVING_WORLD_TDS.md §6.4.
//
// D1 (M10a byte parity) is retired as planned: M10b changes the save shape
// (plant fields, ecology state, a separate event-id counter), so serialize()
// can no longer match the v5 hashes. What it guarded — "the simulation still
// behaves exactly as before" — is now checked by BEHAVIOUR PARITY below.
//
// D6 (seed stability) stays: the tick-0 terrain and resource placement for
// every existing seed must match v0.1 byte for byte.

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-v5.json', import.meta.url), 'utf8')) as GoldenFixture
const behaviour = JSON.parse(readFileSync(new URL('./fixtures/behaviour-v5.json', import.meta.url), 'utf8')) as {
  sourceCommit: string
  seeds: { seed: string; checkpoints: { tick: number; behaviour: string }[] }[]
}

describe('D6 seed stability: tick-0 terrain and resources unchanged since v0.1', () => {
  for (const expected of golden.seeds) {
    it(`seed "${expected.seed}"`, () => {
      expect(tick0MapHash(createWorld({ seed: expected.seed }))).toBe(expected.tick0Map)
    })
  }
})

// Population V1 changes behaviour on purpose (partnerships, births, aging,
// housing headroom). With its rules switched off, every other system —
// including M10b's plant lifecycle (senescence off) and the v7 save shape —
// must still behave exactly like the pre-M10b simulation.
// Plant senescence and reproduction (M10c) also change behaviour on purpose and are switched off here.
const NO_POPULATION = { ...DEFAULT_SIM_RULES, ecology: { senescence: false, reproduction: false }, population: false, resurvey: false }
// The demographic profile (schema v10) is a population rule too: under the accelerated profile
// founders become elders (who don't explore) within the checkpoints. The baseline lived by the
// classic profile, so parity worlds use it — founder ages redrawn from the same creation-only stream.
function classicWorld(seed: string) {
  const s = createWorld({ seed })
  s.population.profile = { ...CLASSIC_PROFILE, founderAge: { ...CLASSIC_PROFILE.founderAge }, fertileAge: { ...CLASSIC_PROFILE.fertileAge } }
  assignFounderAges(s.citizens, seed, s.population.profile)
  return s
}

const stepNWith = (s: Parameters<typeof stepWithRules>[0], n: number) => {
  for (let i = 0; i < n; i++) stepWithRules(s, NO_POPULATION)
}

describe('behaviour parity with the pre-M10b simulation (population and plant life-cycle rules off)', () => {
  it('fixture was recorded from a known commit for the golden seeds and checkpoints', () => {
    expect(behaviour.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(behaviour.seeds.map((s) => s.seed)).toEqual([...GOLDEN_SEEDS])
    for (const s of behaviour.seeds) expect(s.checkpoints.map((c) => c.tick)).toEqual([...GOLDEN_TICKS])
  })

  for (const expected of behaviour.seeds) {
    it(`seed "${expected.seed}": every checkpoint behaves identically`, () => {
      const s = classicWorld(expected.seed)
      const actual = GOLDEN_TICKS.map((tick) => {
        stepNWith(s, tick - s.tick)
        return { tick, behaviour: behaviourHash(s) }
      })
      expect(actual).toEqual(expected.checkpoints)
    })
  }
})
