import { isPassable, neighbors4 } from '../grid.ts'
import type { TileIndex, TileMap } from '../types.ts'

/**
 * Tiles reachable from `start` by 4-directional moves over passable terrain.
 * Returns a mask (1 = reachable) of length width * height; all zeros if
 * `start` is out of range or impassable.
 */
export function reachableMask(map: TileMap, start: TileIndex): Uint8Array {
  const mask = new Uint8Array(map.width * map.height)
  if (!isPassable(map, start)) return mask
  const stack: TileIndex[] = [start]
  mask[start] = 1
  while (stack.length > 0) {
    const tile = stack.pop()!
    for (const n of neighbors4(map, tile)) {
      if (mask[n] === 0 && isPassable(map, n)) {
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
