import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLANT_MATURE_AT_DAYS, SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { oldAtDays, plantAgeDays } from '../ecology/flora.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { ResourceNode, WorldState } from '../types.ts'
import { step, stepN } from '../world.ts'
import { conservationTotals, plantViolations } from './invariants.ts'

// v7 → v8 (M10c) on REAL established Population V1 villages: 30 citizens at
// day 900 and 60 citizens at day 2160, saved by the published Population V1
// build. Before M10c plants kept ageing with senescence off, so in these
// worlds every plant is past its lifespan: switching senescence on without
// the migration would kill them all at the first dawn (TDS §7.11b).

const FIXTURES = [
  ['30 citizens, day 900', 'popv1-save-v7-30.json'],
  ['60 citizens, day 2160', 'popv1-save-v7-60.json'],
] as const

const plants = (w: { map: { resources: (ResourceNode | null)[] } }) => w.map.resources.filter((r): r is ResourceNode => r !== null)
const nextDawn = (tick: number) => tick + (TICKS_PER_DAY - (tick % TICKS_PER_DAY)) % TICKS_PER_DAY || tick + TICKS_PER_DAY

for (const [label, file] of FIXTURES) {
  describe(`v7 → v8 migration of an established village (${label})`, () => {
    const json = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
    const v7 = JSON.parse(json)
    const w = deserialize(json)

    it('the fixture is a real v7 world whose plants are all past their lifespan', () => {
      expect(v7.schemaVersion).toBe(7)
      const old = plants(v7).filter((n) => plantAgeDays(n, v7.tick) >= n.lifespanDays)
      expect(old.length).toBe(plants(v7).length) // the hazard the migration exists for
    })

    it('keeps every plant where it was with what it held; only ages are renewed', () => {
      expect(w.schemaVersion).toBe(SCHEMA_VERSION)
      const holding = (m: { resources: (ResourceNode | null)[] }) => m.resources.map((r) => r && [r.kind, r.amount, r.max, r.stage])
      expect(holding(w.map)).toEqual(holding(v7.map))
    })

    it('gives living plants a valid, staggered age distribution: none past its life, ≤ 10% per death day', () => {
      for (const n of plants(w)) {
        const age = plantAgeDays(n, w.tick)
        expect(age).toBeGreaterThanOrEqual(PLANT_MATURE_AT_DAYS[n.kind])
        expect(age).toBeLessThan(oldAtDays(n.kind, n.lifespanDays))
        expect(Math.abs(n.bornTick % TICKS_PER_DAY)).toBe(0)
      }
      for (const kind of ['berries', 'wood'] as const) {
        const ofKind = plants(w).filter((n) => n.kind === kind)
        const perDay = new Map<number, number>()
        for (const n of ofKind) {
          const d = n.lifespanDays - plantAgeDays(n, w.tick)
          perDay.set(d, (perDay.get(d) ?? 0) + 1)
        }
        expect(Math.max(...perDay.values())).toBeLessThanOrEqual(Math.max(1, Math.floor(ofKind.length / 10)))
      }
      expect(plantViolations(w, true)).toEqual([])
    })

    it('leaves citizens, families, buildings, ledger, events, history, archive and population untouched', () => {
      for (const k of ['citizens', 'structures', 'stockpile', 'ledger', 'events', 'history', 'archive', 'ecology', 'rng', 'nextId', 'nextEventId'] as const) {
        expect(w[k as keyof WorldState], k).toEqual(v7[k])
      }
      // Population is untouched apart from the profile the v9 → v10 step adds: the classic rules it lived by.
      const { profile, ...population } = w.population
      expect(population).toEqual(v7.population)
      expect(profile.id).toBe('classic-v1')
      expect(w.map.terrain).toEqual(v7.map.terrain)
      expect(w.map.discovered).toEqual(v7.map.discovered)
    })

    it('no mass die-off: the first dawn under the new rules kills at most 10% of either kind', () => {
      const s = deserialize(json)
      const before = { ...s.ecology.counters.deaths }
      stepN(s, nextDawn(s.tick) - s.tick)
      const counts = { berries: plants(v7).filter((n) => n.kind === 'berries').length, wood: plants(v7).filter((n) => n.kind === 'wood').length }
      for (const kind of ['berries', 'wood'] as const) {
        expect(s.ecology.counters.deaths[kind] - before[kind]).toBeLessThanOrEqual(Math.max(1, Math.floor(counts[kind] / 10)))
      }
    })

    it('lives on under M10c: conservation and plant invariants every tick for 30 days; save/resume exact across dawns', () => {
      const s = deserialize(json)
      const start = conservationTotals(s)
      for (let t = 0; t < 30 * TICKS_PER_DAY; t++) {
        step(s)
        expect(conservationTotals(s)).toEqual(start)
        if (t % 24 === 0) expect(plantViolations(s, true)).toEqual([])
      }
      expect(s.ecology.counters.births.berries + s.ecology.counters.births.wood).toBeGreaterThan(0)
      const resumed = deserialize(serialize(s))
      stepN(s, 3 * TICKS_PER_DAY)
      stepN(resumed, 3 * TICKS_PER_DAY)
      expect(serialize(resumed)).toBe(serialize(s))
    })
  })
}
