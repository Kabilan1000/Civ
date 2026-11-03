import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../constants.ts'
import { computeGolden, GOLDEN_SEEDS, GOLDEN_TICKS, type GoldenFixture } from './golden.ts'

// D1 (M10a parity) and D6 (seed stability), docs/design/LIVING_WORLD_TDS.md §6.4.
// The fixture was recorded from the simulation BEFORE M10a by
// scripts/capture-golden.ts. Every hash must match byte for byte: M10a may not
// change WorldState, ids, events, RNG use or behaviour. Retired in M10b.

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/golden-v5.json', import.meta.url), 'utf8'),
) as GoldenFixture

describe('golden v5 state (pre-M10a parity)', () => {
  it('fixture covers the documented seeds and checkpoints from a recorded commit', () => {
    expect(fixture.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(fixture.schemaVersion).toBe(5)
    expect(SCHEMA_VERSION).toBe(fixture.schemaVersion)
    expect(fixture.seeds.map((s) => s.seed)).toEqual([...GOLDEN_SEEDS])
    for (const s of fixture.seeds) expect(s.checkpoints.map((c) => c.tick)).toEqual([...GOLDEN_TICKS])
  })

  for (const expected of fixture.seeds) {
    it(`seed "${expected.seed}": serialize() is byte-identical at every checkpoint`, () => {
      const actual = computeGolden(expected.seed)
      expect(actual.tick0Map).toBe(expected.tick0Map)
      expect(actual.checkpoints).toEqual(expected.checkpoints)
    })
  }
})
