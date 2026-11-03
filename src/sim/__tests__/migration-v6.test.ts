import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLANT_LIFESPAN_DAYS, PLANT_MATURE_AT_DAYS, SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { oldAtDays, plantAgeDays } from '../ecology/flora.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { ResourceNode } from '../types.ts'
import { stepN } from '../world.ts'
import { behaviourHash } from './fingerprint.ts'
import { conservationTotals, plantViolations } from './invariants.ts'

// v5 → v6 (M10b) on a REAL v0.1 save: fixtures/m9-save-v5.json was written by
// the pre-M10b simulation (commit in m9-save-v5.behaviour.json), together with
// how that world continues under the old code. TDS §6.5, §7.11.

const v5json = readFileSync(new URL('./fixtures/m9-save-v5.json', import.meta.url), 'utf8')
const v5 = JSON.parse(v5json)
const expected = JSON.parse(readFileSync(new URL('./fixtures/m9-save-v5.behaviour.json', import.meta.url), 'utf8')) as {
  sourceCommit: string
  savedTick: number
  continuation: { tick: number; behaviour: string }[]
}

describe('v5 → v6 migration of a real v0.1 save', () => {
  it('the fixture really is a v5 save from a recorded commit', () => {
    expect(v5.schemaVersion).toBe(5)
    expect(v5.tick).toBe(expected.savedTick)
    expect(expected.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  const w = deserialize(v5json)

  it('loads as v6 with every plant kept exactly: same tiles, kinds, amounts and caps', () => {
    expect(w.schemaVersion).toBe(SCHEMA_VERSION)
    const before = v5.map.resources.map((r: { kind: string; amount: number; max: number } | null) => r && [r.kind, r.amount, r.max])
    const after = w.map.resources.map((r) => r && [r.kind, r.amount, r.max])
    expect(after).toEqual(before)
  })

  it('keeps plants that now fall inside the settlement clearing (germination-only rule)', () => {
    const tiles = w.structures.map((s) => ({ x: s.tile % w.map.width, y: Math.floor(s.tile / w.map.width) }))
    const near = w.map.resources.filter((r, i) => {
      const x = i % w.map.width
      const y = Math.floor(i / w.map.width)
      return r && tiles.some((t) => Math.abs(t.x - x) + Math.abs(t.y - y) <= 2)
    })
    expect(near.length).toBeGreaterThan(0) // the fixture does have such plants…
    expect(plantViolations(w, false)).toEqual([]) // …and they are valid
  })

  it('gives every plant a staggered, mature, dawn-aligned age (H6)', () => {
    const plants = w.map.resources.filter((r): r is ResourceNode => r !== null)
    for (const n of plants) {
      expect(n.stage).toBe('mature')
      expect(n.diedTick).toBeNull()
      expect(Math.abs(n.bornTick % TICKS_PER_DAY)).toBe(0)
      const age = plantAgeDays(n, w.tick)
      expect(age).toBeGreaterThanOrEqual(PLANT_MATURE_AT_DAYS[n.kind])
      expect(age).toBeLessThan(oldAtDays(n.kind, n.lifespanDays))
      expect(n.lifespanDays).toBeGreaterThanOrEqual(PLANT_LIFESPAN_DAYS[n.kind].min)
      expect(n.lifespanDays).toBeLessThanOrEqual(PLANT_LIFESPAN_DAYS[n.kind].max)
    }
    for (const kind of ['berries', 'wood'] as const) {
      const ofKind = plants.filter((n) => n.kind === kind)
      const perDay = new Map<number, number>()
      for (const n of ofKind) {
        const d = n.lifespanDays - plantAgeDays(n, w.tick)
        perDay.set(d, (perDay.get(d) ?? 0) + 1)
      }
      expect(Math.max(...perDay.values())).toBeLessThanOrEqual(Math.max(1, Math.floor(ofKind.length / 10)))
    }
  })

  it('adds the decay ledger, ecology state and a separate event counter without disturbing ids', () => {
    expect(w.ledger.foodDecayed).toBe(0)
    expect(w.ledger.woodDecayed).toBe(0)
    expect(w.ecology.counters).toEqual({ births: { berries: 0, wood: 0 }, deaths: { berries: 0, wood: 0 }, seedsCast: 0, fallenFruitSprouts: 0 })
    expect(w.nextEventId).toBe(v5.nextId)
    expect(w.nextId).toBe(v5.nextId)
    expect(w.events.map((e) => e.id)).toEqual(v5.events.map((e: { id: number }) => e.id))
  })

  it('continues exactly as the v0.1 simulation would have (behaviour parity for 30 days)', () => {
    const s = deserialize(v5json)
    const start = conservationTotals(s)
    const got: { tick: number; behaviour: string }[] = []
    for (const c of expected.continuation) {
      while (s.tick < c.tick) {
        stepN(s, 1)
        expect(conservationTotals(s)).toEqual(start)
      }
      got.push({ tick: s.tick, behaviour: behaviourHash(s) })
    }
    expect(got).toEqual(expected.continuation)
  })

  it('round-trips: a migrated world saves and loads to the identical state', () => {
    const s = deserialize(v5json)
    stepN(s, 500)
    const json = serialize(s)
    expect(serialize(deserialize(json))).toBe(json)
  })
})
