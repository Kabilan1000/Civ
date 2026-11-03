import { describe, expect, it } from 'vitest'
import {
  BERRY_MAX,
  MIN_REGION_FRACTION,
  MIN_START_BERRY_TILES,
  MIN_START_TREE_TILES,
  START_DISCOVERY_RADIUS,
  TREE_WOOD_MAX,
} from '../constants.ts'
import { isPassable, toPoint } from '../grid.ts'
import { findPath } from '../path/astar.ts'
import type { TileMap } from '../types.ts'
import { withinRadius } from './discovery.ts'
import { analyzeStartArea, generateMap } from './generate.ts'

const gen = (seed: string, maxAttempts?: number) => generateMap(seed, 36, 24, { spawnTiles: 12, maxAttempts })

function expectValidMap(map: TileMap, campTile: number) {
  const size = map.width * map.height
  expect(map.terrain).toHaveLength(size)
  expect(map.resources).toHaveLength(size)

  // Border is water.
  map.terrain.forEach((t, i) => {
    const { x, y } = toPoint(i, map.width)
    if (x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1) expect(t).toBe('water')
  })

  // Campfire on accessible land with a large connected region.
  expect(map.terrain[campTile]).toBe('grass')
  expect(map.resources[campTile]).toBeNull()
  const start = analyzeStartArea(map, campTile)
  expect(start.reachableTiles).toBeGreaterThanOrEqual(Math.ceil(size * MIN_REGION_FRACTION))

  // Reachable food and wood inside the starting discovery radius.
  expect(start.berryTiles.length).toBeGreaterThanOrEqual(MIN_START_BERRY_TILES)
  expect(start.treeTiles.length).toBeGreaterThanOrEqual(MIN_START_TREE_TILES)
  // Reachable while walking only on initially discovered tiles (the start region).
  const inStartArea = (t: number) => withinRadius(map, campTile, t, START_DISCOVERY_RADIUS)
  for (const tile of [...start.berryTiles, ...start.treeTiles]) {
    expect(inStartArea(tile)).toBe(true)
    expect(findPath(map, campTile, tile, { canEnter: inStartArea })).not.toBeNull()
  }

  // Resources only on suitable terrain, with sane non-negative amounts.
  map.resources.forEach((r, i) => {
    if (!r) return
    expect(r.amount).toBeGreaterThanOrEqual(0)
    expect(r.amount).toBeLessThanOrEqual(r.max)
    if (r.kind === 'berries') {
      expect(map.terrain[i]).toBe('grass')
      expect(r.max).toBe(BERRY_MAX)
    } else {
      expect(map.terrain[i]).toBe('forest')
      expect(r.max).toBe(TREE_WOOD_MAX)
    }
  })
}

describe('generateMap', () => {
  it('produces identical maps from identical seeds', () => {
    expect(JSON.stringify(gen('same'))).toBe(JSON.stringify(gen('same')))
  })

  it('produces different maps from different seeds', () => {
    const terrains = new Set(Array.from({ length: 20 }, (_, i) => gen(`diff-${i}`).map.terrain.join()))
    expect(terrains.size).toBe(20)
  })

  it('generates valid, playable maps across 100 seeds', () => {
    for (let i = 0; i < 100; i++) {
      const { map, campTile } = gen(`valid-${i}`)
      expectValidMap(map, campTile)
    }
  })

  it('uses every terrain type in coherent amounts', () => {
    const { map } = gen('terrain-mix')
    const count = (t: string) => map.terrain.filter((x) => x === t).length
    for (const t of ['water', 'sand', 'grass', 'forest', 'rock']) expect(count(t)).toBeGreaterThan(0)
    expect(count('water') / map.terrain.length).toBeGreaterThan(0.25)
    expect(map.resources.some((r) => r?.kind === 'berries')).toBe(true)
    expect(map.resources.some((r) => r?.kind === 'wood')).toBe(true)
  })

  it('places the campfire near the centre of the map', () => {
    for (let i = 0; i < 20; i++) {
      const { map, campTile } = gen(`centre-${i}`)
      const p = toPoint(campTile, map.width)
      expect(Math.abs(p.x - 18) + Math.abs(p.y - 12)).toBeLessThanOrEqual(8)
    }
  })

  it('falls back to a deterministic carved clearing when attempts run out', () => {
    const a = gen('fallback', 0)
    expect(a.attempt).toBe(-1)
    expectValidMap(a.map, a.campTile)
    expect(JSON.stringify(gen('fallback', 0))).toBe(JSON.stringify(a))
  })

  it('works on small maps and fails clearly when citizens cannot fit', () => {
    const small = generateMap('small', 12, 10, { spawnTiles: 12 })
    expect(isPassable(small.map, small.campTile)).toBe(true)
    expect(() => generateMap('tiny', 8, 8, { spawnTiles: 500 })).toThrow(/room for 500 citizens/)
  })
})
