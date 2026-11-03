// Tile-by-tile movement along a stored path.
//
// State (all on Citizen, serializable):
//   path          tiles to step onto, excluding the current tile (A* convention)
//   pathIndex     index into `path` of the next tile to enter
//   moveTicksLeft ticks of walking left before entering path[pathIndex]
//
// Timing: entering a tile takes stepCost(tile) ticks of movement. With a path
// set before tick T, the citizen enters path[0] at the end of tick
// T + cost(path[0]) - 1, path[1] cost(path[1]) ticks later, and so on.
//
// Safety: before every step the next tile must still be passable and a
// 4-neighbour of the current position; otherwise the path is dropped and the
// citizen stays where it is ('blocked'). Movement never skips tiles.

import { isAdjacent4, isPassable, stepCost, toPoint } from '../grid.ts'
import type { Citizen, TileIndex, TileMap } from '../types.ts'

export type MoveResult = 'idle' | 'moving' | 'arrived' | 'blocked'

export function hasPath(c: Citizen): boolean {
  return c.pathIndex < c.path.length
}

export function clearPath(c: Citizen): void {
  c.path = []
  c.pathIndex = 0
  c.moveTicksLeft = 0
}

/** Start following `path` (A* convention: excludes the current tile). */
export function setPath(map: TileMap, c: Citizen, path: TileIndex[]): void {
  clearPath(c)
  if (path.length === 0) return
  const cost = stepCost(map, path[0]!)
  if (cost === null) return
  c.path = [...path]
  c.moveTicksLeft = cost
}

/** Advance one tick of movement. */
export function advanceMovement(map: TileMap, c: Citizen): MoveResult {
  if (!hasPath(c)) {
    clearPath(c)
    return 'idle'
  }
  const next = c.path[c.pathIndex]!
  if (!isPassable(map, next) || !isAdjacent4(c.pos, toPoint(next, map.width))) {
    clearPath(c)
    return 'blocked'
  }
  if (c.moveTicksLeft > 1) {
    c.moveTicksLeft--
    return 'moving'
  }

  c.pos = toPoint(next, map.width)
  c.pathIndex++
  if (!hasPath(c)) {
    clearPath(c)
    return 'arrived'
  }
  const cost = stepCost(map, c.path[c.pathIndex]!)
  if (cost === null) {
    clearPath(c)
    return 'blocked'
  }
  c.moveTicksLeft = cost
  return 'moving'
}
