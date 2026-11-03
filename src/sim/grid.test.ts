import { describe, expect, it } from 'vitest'
import { inBounds, isAdjacent4, isPassable, manhattan, neighbors4, stepCost, toIndex, toPoint } from './grid.ts'
import { asciiMap as mapOf } from './__tests__/asciiMap.ts'

describe('grid', () => {
  const map = mapOf(['~.s', 'f#.'])

  it('converts between index and point', () => {
    expect(toIndex(2, 1, 3)).toBe(5)
    expect(toPoint(5, 3)).toEqual({ x: 2, y: 1 })
    for (let i = 0; i < 6; i++) {
      const p = toPoint(i, 3)
      expect(toIndex(p.x, p.y, 3)).toBe(i)
    }
  })

  it('checks bounds', () => {
    expect(inBounds(map, 0, 0)).toBe(true)
    expect(inBounds(map, 2, 1)).toBe(true)
    expect(inBounds(map, 3, 0)).toBe(false)
    expect(inBounds(map, 0, -1)).toBe(false)
  })

  it('lists 4-neighbours in N, E, S, W order and clips at edges', () => {
    expect(neighbors4(map, toIndex(1, 0, 3))).toEqual([toIndex(2, 0, 3), toIndex(1, 1, 3), toIndex(0, 0, 3)])
    expect(neighbors4(map, toIndex(1, 1, 3))).toEqual([toIndex(1, 0, 3), toIndex(2, 1, 3), toIndex(0, 1, 3)])
  })

  it('applies terrain traversal rules', () => {
    expect(isPassable(map, 0)).toBe(false) // water
    expect(isPassable(map, 4)).toBe(false) // rock
    expect(stepCost(map, 0)).toBeNull()
    expect(stepCost(map, 1)).toBe(2) // grass
    expect(stepCost(map, 2)).toBe(3) // sand
    expect(stepCost(map, 3)).toBe(3) // forest
    expect(isPassable(map, 99)).toBe(false)
    expect(stepCost(map, -1)).toBeNull()
  })

  it('measures Manhattan distance and adjacency', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7)
    expect(isAdjacent4({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true)
    expect(isAdjacent4({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false)
    expect(isAdjacent4({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false)
  })
})
