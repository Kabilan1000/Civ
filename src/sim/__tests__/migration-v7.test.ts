import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ageYears } from '../citizens/life.ts'
import { FOUNDER_AGE, SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { deserialize, serialize } from '../serialize.ts'
import { step } from '../world.ts'
import { conservationTotals } from './invariants.ts'

// v6 → v7 (Population V1) on a REAL v6 save written by the M10b checkpoint
// code (commit c0e764d) — fixtures/m10b-save-v6.json.

const v6json = readFileSync(new URL('./fixtures/m10b-save-v6.json', import.meta.url), 'utf8')
const v6 = JSON.parse(v6json)

describe('v6 → v7 migration of a real M10b save', () => {
  it('the fixture is a v6 save', () => {
    expect(v6.schemaVersion).toBe(6)
  })

  const w = deserialize(v6json)

  it('existing citizens become founders: adults aged 18–36, birthdays on dawns, no families yet', () => {
    expect(w.schemaVersion).toBe(SCHEMA_VERSION)
    for (const c of w.citizens) {
      const age = ageYears(c, w.tick)
      expect(age).toBeGreaterThanOrEqual(FOUNDER_AGE.min)
      expect(age).toBeLessThanOrEqual(FOUNDER_AGE.max)
      expect(Math.abs(c.bornTick % TICKS_PER_DAY)).toBe(0)
      expect([c.parentIds, c.partnerId, c.childIds, c.lastChildTick]).toEqual([null, null, [], null])
    }
    expect(w.archive).toEqual([])
    expect(w.population.counters.births).toBe(0)
  })

  it('keeps everything else as saved: citizens, map, structures, ledger, events, history', () => {
    const ADDED = ['bornTick', 'parentIds', 'partnerId', 'childIds', 'lastChildTick']
    const strip = (c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).filter(([k]) => !ADDED.includes(k)))
    expect(w.citizens.map((c) => strip(c as never))).toEqual(v6.citizens)
    expect(w.map).toEqual(v6.map)
    expect(w.structures).toEqual(v6.structures)
    expect(w.ledger).toEqual(v6.ledger)
    expect(w.events).toEqual(v6.events)
    expect(w.history).toEqual(v6.history)
  })

  it('then lives on under Population V1: conservation every tick for 40 days, and partnerships form', () => {
    const s = deserialize(v6json)
    const start = conservationTotals(s)
    for (let t = 0; t < 40 * TICKS_PER_DAY; t++) {
      step(s)
      expect(conservationTotals(s)).toEqual(start)
    }
    expect(s.population.counters.partnerships).toBeGreaterThan(0)
    expect(serialize(deserialize(serialize(s)))).toBe(serialize(s))
  })
})
