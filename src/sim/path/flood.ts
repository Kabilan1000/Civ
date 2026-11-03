import { isPassable, neighbors4 } from '../grid.ts'
import type { TileIndex, TileMap } from '../types.ts'

/**
 * Tiles reachable from `start` by 4-directional moves over passable terrain
 * (optionally restricted by `canEnter`). Returns a mask (1 = reachable) of
 * length width * height; all zeros if `start` is out of range or impassable.
 */
export function reachableMask(
  map: TileMap,
  start: TileIndex,
  canEnter: (tile: TileIndex) => boolean = () => true,
): Uint8Array {
  const mask = new Uint8Array(map.width * map.height)
  if (!isPassable(map, start)) return mask
  const stack: TileIndex[] = [start]
  mask[start] = 1
  while (stack.length > 0) {
    const tile = stack.pop()!
    for (const n of neighbors4(map, tile)) {
      if (mask[n] === 0 && isPassable(map, n) && canEnter(n)) {
        mask[n] = 1
        stack.push(n)
      }
    }
  }
  return mask
}

/**
 * Label connected passable regions. Regions are numbered 1, 2, ... in order of
 * their lowest tile index; impassable tiles are 0. Deterministic.
 */
export function labelRegions(map: TileMap): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(map.width * map.height)
  const sizes: number[] = [0]
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0 || !isPassable(map, i)) continue
    const label = sizes.length
    let size = 0
    const stack: TileIndex[] = [i]
    labels[i] = label
    while (stack.length > 0) {
      const tile = stack.pop()!
      size++
      for (const n of neighbors4(map, tile)) {
        if (labels[n] === 0 && isPassable(map, n)) {
          labels[n] = label
          stack.push(n)
        }
      }
    }
    sizes.push(size)
  }
  return { labels, sizes }
}

/**
 * Breadth-first step counts from `start` over passable tiles accepted by
 * `canEnter` (start always counts as 0). -1 = unreachable. Ignores terrain
 * cost; used for cheap "how far is it" scoring, while actual travel uses A*.
 */
export function distanceField(map: TileMap, start: TileIndex, canEnter: (tile: TileIndex) => boolean): Int32Array {
  const dist = new Int32Array(map.width * map.height).fill(-1)
  if (!isPassable(map, start)) return dist
  dist[start] = 0
  const queue: TileIndex[] = [start]
  for (let head = 0; head < queue.length; head++) {
    const tile = queue[head]!
    for (const n of neighbors4(map, tile)) {
      if (dist[n] === -1 && isPassable(map, n) && canEnter(n)) {
        dist[n] = dist[tile]! + 1
        queue.push(n)
      }
    }
  }
  return dist
}
