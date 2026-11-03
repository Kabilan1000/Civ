import { describe, expect, it } from 'vitest'
import { asciiMap } from '../__tests__/asciiMap.ts'
import { TERRAIN_RULES } from '../constants.ts'
import { isAdjacent4, isPassable, neighbors4, stepCost, toIndex, toPoint } from '../grid.ts'
import { generateMap } from '../map/generate.ts'
import type { TileIndex, TileMap } from '../types.ts'
import { findPath, pathCost } from './astar.ts'

const at = (map: TileMap, x: number, y: number) => toIndex(x, y, map.width)
const points = (map: TileMap, path: TileIndex[]) => path.map((t) => toPoint(t, map.width))

/** Every step is a 4-neighbour of the previous position and passable. */
function expectWalkable(map: TileMap, start: TileIndex, path: TileIndex[]) {
  let prev = toPoint(start, map.width)
  for (const tile of path) {
    const p = toPoint(tile, map.width)
    expect(isAdjacent4(prev, p)).toBe(true)
    expect(isPassable(map, tile)).toBe(true)
    prev = p
  }
}

/** Reference Dijkstra (no heuristic) for optimality checks. */
function dijkstraCost(map: TileMap, start: TileIndex, goal: TileIndex): number | null {
  const dist = new Array<number>(map.terrain.length).fill(Infinity)
  const done = new Array<boolean>(map.terrain.length).fill(false)
  dist[start] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i
    if (u < 0) return null
    if (u === goal) return dist[u]!
    done[u] = true
    for (const n of neighbors4(map, u)) {
      const c = stepCost(map, n)
      if (c !== null && dist[u]! + c < dist[n]!) dist[n] = dist[u]! + c
    }
  }
}

describe('findPath', () => {
  it('returns [] when already at the goal', () => {
    const map = asciiMap(['...'])
    expect(findPath(map, 1, 1)).toEqual([])
  })

  it('excludes start and includes goal, one 4-neighbour step per entry', () => {
    const map = asciiMap(['.....'])
    expect(findPath(map, 0, 4)).toEqual([1, 2, 3, 4])
  })

  it('never moves diagonally', () => {
    const map = asciiMap(['....', '....', '....', '....'])
    const path = findPath(map, at(map, 0, 0), at(map, 3, 3))!
    expect(path).toHaveLength(6)
    expectWalkable(map, at(map, 0, 0), path)
  })

  it('routes around water', () => {
    const map = asciiMap([
      '.....',
      '.~~~.',
      '.~.~.',
      '.~~~.',
      '.....',
    ])
    const path = findPath(map, at(map, 2, 0), at(map, 2, 4))!
    expectWalkable(map, at(map, 2, 0), path)
    expect(path).toHaveLength(8)
    expect(findPath(map, at(map, 0, 0), at(map, 2, 2))).toBeNull() // enclosed pocket
  })

  it('routes around a rock wall through the only gap', () => {
    const map = asciiMap([
      '.#...',
      '.#.#.',
      '.#.#.',
      '...#.',
    ])
    const path = findPath(map, at(map, 0, 0), at(map, 4, 0))!
    expectWalkable(map, at(map, 0, 0), path)
    expect(points(map, path)).toContainEqual({ x: 1, y: 3 })
    expect(points(map, path)).toContainEqual({ x: 2, y: 0 })
    // down the left column, through the gap at (1,3), up column 2, then east
    expect(path).toHaveLength(10)
    expect(pathCost(map, path)).toBe(20)
  })

  it('respects terrain step costs', () => {
    expect(TERRAIN_RULES.grass.stepCost).toBe(2)
    expect(TERRAIN_RULES.sand.stepCost).toBe(3)
    expect(TERRAIN_RULES.forest.stepCost).toBe(3)
    // Straight through 3 sand = 3*3 + 2 = 11; grass detour = 6 tiles * 2 = 12.
    const sandy = asciiMap(['.....', '.sss.', '.....'])
    const viaSand = findPath(sandy, at(sandy, 0, 1), at(sandy, 4, 1))!
    expect(pathCost(sandy, viaSand)).toBe(11)
    expect(points(sandy, viaSand).every((p) => p.y === 1)).toBe(true)

    // Straight through 5 forest = 5*3 + 2 = 17; grass detour = 8 tiles * 2 = 16 → detour wins.
    const woods = asciiMap(['.......', '.fffff.', '.......'])
    const aroundWoods = findPath(woods, at(woods, 0, 1), at(woods, 6, 1))!
    expect(pathCost(woods, aroundWoods)).toBe(16)
    expect(points(woods, aroundWoods).some((p) => p.y !== 1)).toBe(true)
  })

  it('finds optimal-cost paths on generated maps (matches Dijkstra)', () => {
    for (let s = 0; s < 5; s++) {
      const { map, campTile } = generateMap(`astar-${s}`, 36, 24, { spawnTiles: 12 })
      const goals = [0, 37, 100, 300, 500, 700, 863].map((g) => (g + s * 13) % map.terrain.length)
      for (const goal of goals) {
        const path = findPath(map, campTile, goal)
        const expected = dijkstraCost(map, campTile, goal)
        if (expected === null || !isPassable(map, goal)) {
          expect(path).toBeNull()
        } else {
          expect(path).not.toBeNull()
          expectWalkable(map, campTile, path!)
          expect(path!.at(-1) ?? campTile).toBe(goal)
          expect(pathCost(map, path!)).toBe(expected)
        }
      }
    }
  })

  it('breaks ties deterministically (f, then h, then tile index; N,E,S,W)', () => {
    const map = asciiMap(['...', '...', '...'])
    // Many equal-cost routes exist; the documented tie-break always picks this one.
    expect(findPath(map, 0, 8)).toEqual([1, 2, 5, 8])
    const big = generateMap('ties', 36, 24, { spawnTiles: 12 })
    const a = findPath(big.map, big.campTile, 450)
    const copy = JSON.parse(JSON.stringify(big.map)) as TileMap
    for (let i = 0; i < 5; i++) expect(findPath(copy, big.campTile, 450)).toEqual(a)
  })

  it('returns null for unreachable or invalid endpoints', () => {
    const map = asciiMap(['..~..', '..~..', '..~#.'])
    expect(findPath(map, at(map, 0, 0), at(map, 4, 0))).toBeNull() // across water
    expect(findPath(map, at(map, 0, 0), at(map, 2, 0))).toBeNull() // goal is water
    expect(findPath(map, at(map, 3, 2), at(map, 4, 2))).toBeNull() // start is rock
    expect(findPath(map, -1, 0)).toBeNull()
    expect(findPath(map, 0, 999)).toBeNull()
    expect(findPath(map, 0.5, 1)).toBeNull()
  })

  it('gives up after maxExpansions', () => {
    const map = asciiMap(['..........'])
    expect(findPath(map, 0, 9, { maxExpansions: 3 })).toBeNull()
    expect(findPath(map, 0, 9, { maxExpansions: 20 })).toHaveLength(9)
  })
})

describe('pathCost', () => {
  it('sums step costs and rejects impassable tiles', () => {
    const map = asciiMap(['.sf~'])
    expect(pathCost(map, [])).toBe(0)
    expect(pathCost(map, [1, 2])).toBe(6)
    expect(pathCost(map, [1, 2, 3])).toBeNull()
  })
})
