import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { isPassable } from '../grid.ts'
import { generateMap } from '../map/generate.ts'
import { findPath } from '../path/astar.ts'

// Soft budgets with generous headroom for slow CI machines (docs/ARCHITECTURE.md §10).

describe('performance', () => {
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
