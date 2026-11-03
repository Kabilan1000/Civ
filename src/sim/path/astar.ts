// A* pathfinding on the tile grid.
//
// Path-return convention
// ──────────────────────
// findPath(map, start, goal) returns:
//   • TileIndex[] — the tiles to step onto, in order, EXCLUDING `start` and
//     INCLUDING `goal`. Consecutive entries (and start → path[0]) are always
//     4-neighbours, so a mover consumes one entry per step.
//   • []          — start === goal (already there; nothing to do).
//   • null        — no path: start or goal is out of range or impassable (or
//     rejected by options.canEnter), the goal is unreachable, or the search
//     exceeded maxExpansions.
//
// Cost of a path = sum of stepCost() of every tile in it (the start tile is
// free). Movement is 4-directional; water and rock are impassable.
//
// Determinism: neighbours are expanded in fixed N, E, S, W order and the open
// set is ordered by (f, then h, then tile index). A neighbour's parent only
// changes on a strictly lower cost, so equal-cost alternatives always resolve
// the same way.

import { TERRAIN_RULES } from '../constants.ts'
import { isPassable, manhattan, neighbors4, stepCost, toPoint } from '../grid.ts'
import type { Point, TileIndex, TileMap } from '../types.ts'
import { MinHeap } from './heap.ts'

/** Cheapest step cost of any passable terrain; keeps the heuristic admissible. */
const MIN_STEP_COST = Math.min(
  ...Object.values(TERRAIN_RULES)
    .filter((r) => r.passable)
    .map((r) => r.stepCost),
)

export interface FindPathOptions {
  /** Give up (return null) after expanding this many tiles. Default: whole map. */
  maxExpansions?: number
  /**
   * Extra restriction on which passable tiles may be entered (e.g. only
   * discovered tiles). Applies to every path tile including the goal; the
   * start tile is exempt.
   */
  canEnter?: (tile: TileIndex) => boolean
}

function validTile(map: TileMap, tile: TileIndex): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < map.width * map.height && isPassable(map, tile)
}

export function findPath(
  map: TileMap,
  start: TileIndex,
  goal: TileIndex,
  options: FindPathOptions = {},
): TileIndex[] | null {
  if (!validTile(map, start) || !validTile(map, goal)) return null
  if (start === goal) return []
  const canEnter = options.canEnter
  if (canEnter && !canEnter(goal)) return null

  const size = map.width * map.height
  const maxExpansions = options.maxExpansions ?? size
  const goalPoint: Point = toPoint(goal, map.width)
  const g = new Float64Array(size).fill(Infinity)
  const h = new Float64Array(size)
  const parent = new Int32Array(size).fill(-1)
  const closed = new Uint8Array(size)

  const heuristic = (tile: TileIndex) => manhattan(toPoint(tile, map.width), goalPoint) * MIN_STEP_COST
  const open = new MinHeap((a, b) => {
    const fa = g[a]! + h[a]!
    const fb = g[b]! + h[b]!
    if (fa !== fb) return fa < fb
    if (h[a] !== h[b]) return h[a]! < h[b]!
    return a < b
  })

  g[start] = 0
  h[start] = heuristic(start)
  open.push(start)
  let expansions = 0

  while (open.size > 0) {
    const current = open.pop()!
    if (closed[current]) continue // stale heap entry
    if (current === goal) return reconstruct(parent, start, goal)
    closed[current] = 1
    if (++expansions > maxExpansions) return null

    for (const next of neighbors4(map, current)) {
      if (closed[next]) continue
      if (canEnter && !canEnter(next)) continue
      const cost = stepCost(map, next)
      if (cost === null) continue
      const tentative = g[current]! + cost
      if (tentative < g[next]!) {
        g[next] = tentative
        h[next] = heuristic(next)
        parent[next] = current
        open.push(next) // duplicates are skipped via `closed`
      }
    }
  }
  return null
}

function reconstruct(parent: Int32Array, start: TileIndex, goal: TileIndex): TileIndex[] {
  const path: TileIndex[] = []
  for (let t = goal; t !== start; t = parent[t]!) path.push(t)
  return path.reverse()
}

/** Total ticks to walk `path` (start tile excluded). Null if any tile is impassable. */
export function pathCost(map: TileMap, path: readonly TileIndex[]): number | null {
  let total = 0
  for (const tile of path) {
    const cost = stepCost(map, tile)
    if (cost === null) return null
    total += cost
  }
  return total
}
