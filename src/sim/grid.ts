// Grid helpers and terrain traversal rules. Movement is 4-directional.
import { TERRAIN_RULES } from './constants.ts'
import type { Point, TileIndex, TileMap } from './types.ts'

export function toIndex(x: number, y: number, width: number): TileIndex {
  return y * width + x
}

export function toPoint(index: TileIndex, width: number): Point {
  return { x: index % width, y: Math.floor(index / width) }
}

export function inBounds(map: Pick<TileMap, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height
}

/** Fixed neighbour order (N, E, S, W) keeps pathfinding deterministic. */
export const DIRECTIONS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

/** In-bounds 4-neighbours of a tile, in N, E, S, W order (DIRECTIONS). */
export function neighbors4(map: Pick<TileMap, 'width' | 'height'>, index: TileIndex): TileIndex[] {
  const { width, height } = map
  const x = index % width
  const result: TileIndex[] = []
  if (index >= width) result.push(index - width)
  if (x < width - 1) result.push(index + 1)
  if (index + width < width * height) result.push(index + width)
  if (x > 0) result.push(index - 1)
  return result
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function isAdjacent4(a: Point, b: Point): boolean {
  return manhattan(a, b) === 1
}

export function isPassable(map: TileMap, index: TileIndex): boolean {
  const terrain = map.terrain[index]
  return terrain !== undefined && TERRAIN_RULES[terrain].passable
}

/** Ticks needed to step onto a tile, or null if it can't be entered. */
export function stepCost(map: TileMap, index: TileIndex): number | null {
  const terrain = map.terrain[index]
  if (terrain === undefined) return null
  const rule = TERRAIN_RULES[terrain]
  return rule.passable ? rule.stepCost : null
}
