import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { isPassable } from '../grid.ts'
import { generateMap } from '../map/generate.ts'
import { findPath } from '../path/astar.ts'
import { createCitizen } from '../citizens/create.ts'
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants.ts'
import { allocateId } from '../ids.ts'
import type { WorldState } from '../types.ts'
import { createWorld, stepN } from '../world.ts'

/** Add adult citizens next to the founders until `n` live (Population V1 performance gates). */
function populate(s: WorldState, n: number): void {
  const founders = s.citizens.filter((c) => c.alive)
  for (let k = 0; s.citizens.length < n; k++) {
    const like = founders[k % founders.length]!
    const id = allocateId(s)
    const c = createCitizen(id, `Extra ${id}`, like.role, { ...like.personality }, like.pos, id)
    c.bornTick = s.tick - (s.population.profile.adultAge + 2) * TICKS_PER_YEAR - (k % 40) * TICKS_PER_DAY // an adult in this world's profile
    s.citizens.push(c)
  }
}

// Soft budgets with generous headroom for slow CI machines (docs/ARCHITECTURE.md §10).

describe('performance', () => {
  it('simulates 10 000 ticks (≈42 days) of the full colony AI at well under 1 ms per tick', () => {
    const s = createWorld({ seed: 'perf-sim' })
    stepN(s, 200) // warm up
    const t0 = performance.now()
    stepN(s, 10_000)
    const msPerTick = (performance.now() - t0) / 10_000
    // Architecture budget is 1 ms/tick (10x speed = 50 ticks/s). Measured ≈0.12 ms alone;
    // 0.5 ms leaves headroom for parallel test workers while still catching regressions.
    expect(msPerTick).toBeLessThan(0.5)
  })

  it('stays well under 1 ms per tick once most of the island is explored', () => {
    const s = createWorld({ seed: 'perf-explored' })
    stepN(s, 240 * 15)
    const explored = s.map.discovered.filter((d) => d === 1).length
    expect(explored).toBeGreaterThan(600) // most of the 864-tile map
    const t0 = performance.now()
    stepN(s, 2000)
    expect((performance.now() - t0) / 2000).toBeLessThan(0.5)
  })

  // Population V1 gates (TDS §8.5): step() ≤ 0.3 / 0.8 / 1.6 ms at 12 / 30 / 60 citizens.
  // Asserted at 2× for parallel test workers; the measured value is reported by the sweep.
  it.each([
    [12, 0.6],
    [30, 1.6],
    [60, 3.2],
  ])('runs a village of %i citizens within budget', (n, limit) => {
    const s = createWorld({ seed: `perf-pop-${n}` })
    populate(s, n)
    stepN(s, 240 * 3) // warm up: decisions, paths and housing settle
    const t0 = performance.now()
    stepN(s, 2400)
    const ms = (performance.now() - t0) / 2400
    expect(s.citizens.filter((c) => c.alive).length).toBeGreaterThanOrEqual(n - 2)
    expect(ms).toBeLessThan(limit)
  })

  it('generates a 36x24 map in well under 20 ms on average', () => {
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) generateMap(`perf-${i}`, 36, 24, { spawnTiles: 12 })
    expect((performance.now() - t0) / 50).toBeLessThan(20)
  })

  it('finds long A* paths across the map in under 1 ms on average', () => {
    const { map } = generateMap('perf-astar', 36, 24, { spawnTiles: 12 })
    const land = map.terrain.map((_t, i) => i).filter((i) => isPassable(map, i))
    const pairs = Array.from({ length: 200 }, (_, k) => [land[k % land.length]!, land[land.length - 1 - ((k * 7) % land.length)]!])
    for (const [a, b] of pairs.slice(0, 20)) findPath(map, a!, b!) // warm up
    const t0 = performance.now()
    for (const [a, b] of pairs) findPath(map, a!, b!)
    expect((performance.now() - t0) / pairs.length).toBeLessThan(1)
  })
})
