import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { ECO_HISTORY_MAX, FOG_FULL_DAYS, NEAR_CAMP_TILES, TICKS_PER_DAY } from '../constants.ts'
import { plantCensus } from '../selectors.ts'
import { deserialize, serialize } from '../serialize.ts'
import { bearingBushes } from '../systems/lifecycle.ts'
import type { WorldState } from '../types.ts'
import { createWorld, DEFAULT_SIM_RULES, step, stepN, stepWithRules } from '../world.ts'
import { ecoCensus } from './census.ts'

const DAY = TICKS_PER_DAY
const manhattanOf = (s: WorldState, a: number, b: number) =>
  Math.abs((a % s.map.width) - (b % s.map.width)) + Math.abs(Math.floor(a / s.map.width) - Math.floor(b / s.map.width))

describe('ecology census (M10d)', () => {
  it('counts bushes near the campfire exactly (4-neighbour distance ≤ NEAR_CAMP_TILES, bearing, known land)', () => {
    const row = '.'.repeat(24)
    const { state } = sandbox(
      [row, row, row, row, row],
      { camp: [2, 2], citizens: [{ x: 2, y: 3 }] },
    )
    const put = (x: number, y: number) => {
      const t = y * 24 + x
      state.map.resources[t] = { kind: 'berries', amount: 4, max: 5, stage: 'mature', bornTick: 0, lifespanDays: 40, diedTick: null } as never
      return t
    }
    put(2 + NEAR_CAMP_TILES, 2) // exactly at the edge: near
    put(4, 4) // near
    put(2 + NEAR_CAMP_TILES + 1, 2) // one beyond: not near
    const seedling = put(3, 2)
    state.map.resources[seedling]!.stage = 'seedling' // bears nothing: neither bearing nor near
    state.map.resources[seedling]!.amount = 0
    const hidden = put(5, 2)
    state.map.discovered[hidden] = 0 // unknown land: alive, but not counted as known bearing
    const e = ecoCensus(state)
    expect(e.bushes).toEqual({ seedling: 1, young: 0, mature: 4, old: 0 })
    expect(e.bearing).toBe(3)
    expect(e.nearBushes).toBe(2)
    expect(e.nearBerries).toBe(8)
    expect(e.nearCapacity).toBe(10)
    expect(e.berries).toBe(16) // every living bush, known or not
  })

  it('agrees with the simulation and the dashboard on every dawn of a growing world', () => {
    const s = createWorld({ seed: 'census' })
    for (let d = 0; d < 40; d++) {
      stepN(s, DAY)
      const e = s.ecoHistory.at(-1)!
      expect(e.tick).toBe(s.tick)
      expect(e).toEqual(ecoCensus(s)) // recorded = live census at that moment
      expect(e.bearing).toBe(bearingBushes(s)) // the very count the birth check uses
      const p = plantCensus(s)
      const sum = (x: typeof e.bushes) => x.seedling + x.young + x.mature + x.old
      expect(sum(e.bushes) + sum(e.trees)).toBe(p.bushes + p.trees)
      expect(e.deadwood).toBe(p.deadwood)
      expect(e.recent + e.fading + e.stale).toBe(s.map.discovered.reduce<number>((n, x) => n + x, 0))
      expect(e.stale).toBe(s.map.lastSeen.filter((v, i) => s.map.discovered[i] === 1 && s.tick - v >= FOG_FULL_DAYS * DAY).length)
      expect(e.gathered).toBe(s.ledger.foodGathered)
      expect(e.decayed).toBe(s.ledger.foodDecayed)
      expect(e.plantBirths).toEqual(s.ecology.counters.births)
      expect(e.population).toBe(s.citizens.filter((c) => c.alive).length)
    }
  })

  it('records one census per dawn from tick 0, bounded at ECO_HISTORY_MAX; save/resume exact', () => {
    const s = createWorld({ seed: 'census-bound' })
    expect(s.ecoHistory.map((e) => e.tick)).toEqual([0])
    stepN(s, (ECO_HISTORY_MAX + 5) * DAY)
    expect(s.ecoHistory).toHaveLength(ECO_HISTORY_MAX)
    expect(s.ecoHistory.every((e, i) => i === 0 || e.tick - s.ecoHistory[i - 1]!.tick === DAY)).toBe(true)
    expect(s.ecoHistory.at(-1)!.tick).toBe(s.tick)
    const r = deserialize(serialize(s))
    stepN(s, DAY + 7)
    stepN(r, DAY + 7)
    expect(serialize(r)).toBe(serialize(s))
  })
})

describe('activity tallies (M10d) count real events only', () => {
  it('forage trips: one per forage task begun; steps are the walking distance to the bush', () => {
    const s = createWorld({ seed: 'tally-forage' })
    stepN(s, 2 * DAY)
    const before = { ...s.activity }
    let trips = 0
    let minSteps = 0
    let maxSteps = 0
    for (let t = 0; t < 6 * DAY; t++) {
      const pos = new Map(s.citizens.map((c) => [c.id, c.pos.y * s.map.width + c.pos.x]))
      step(s)
      for (const c of s.citizens) {
        if (c.alive && c.task?.kind === 'forage' && c.task.startedTick === s.tick) {
          trips++
          minSteps += manhattanOf(s, pos.get(c.id)!, c.task.targetTile!) // can't be shorter than this
          maxSteps += c.path.length // A* may prefer cheaper terrain over fewer steps
        }
      }
    }
    expect(trips).toBeGreaterThan(20)
    expect(s.activity.forageTrips - before.forageTrips).toBe(trips)
    const steps = s.activity.forageSteps - before.forageSteps
    expect(steps).toBeGreaterThanOrEqual(minSteps)
    expect(steps).toBeLessThanOrEqual(maxSteps)
  })

  it('resurveys: on fully known land every explorer trip is one; with resurveying off there are none', () => {
    const load = () => {
      const s = deserialize(readFileSync(new URL('../__tests__/fixtures/popv1-save-v7-60.json', import.meta.url), 'utf8'))
      s.map.discovered = s.map.discovered.map(() => 1) // nothing left to discover…
      s.map.lastSeen = s.map.lastSeen.map(() => s.tick - 30 * DAY) // …and all of it awaiting resurvey
      s.map.version++
      return s
    }
    const s = load()
    let trips = 0
    for (let t = 0; t < 20 * DAY; t++) {
      step(s)
      for (const c of s.citizens) if (c.alive && c.task?.kind === 'explore' && c.task.startedTick === s.tick) trips++
    }
    expect(trips).toBeGreaterThan(3)
    expect(s.activity.resurveys).toBe(trips)
    const off = load()
    for (let t = 0; t < 5 * DAY; t++) stepWithRules(off, { ...DEFAULT_SIM_RULES, resurvey: false })
    expect(off.activity.resurveys).toBe(0)
  })

  it('removing the whole observability record changes nothing the villagers do', () => {
    const a = createWorld({ seed: 'observer-only' })
    const b = createWorld({ seed: 'observer-only' })
    const strip = (w: WorldState) => {
      const o = JSON.parse(serialize(w))
      delete o.ecoHistory
      delete o.activity
      for (const g of o.generations) {
        delete g.bearing
        delete g.nearBushes
        delete g.held
      }
      return JSON.stringify(o)
    }
    for (let t = 0; t < 30 * DAY; t++) {
      step(a)
      step(b)
      if (t % 97 === 0) {
        b.ecoHistory = b.ecoHistory.slice(-1) // keep only what the next season summary may read
        b.activity = { forageTrips: 0, forageSteps: 0, resurveys: 0, birthsHeldByLand: 0 }
      }
    }
    expect(strip(b)).toBe(strip(a))
  })
})
