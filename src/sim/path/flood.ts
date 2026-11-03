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
 * Same as distanceField but over a precomputed walk mask (1 = may enter),
 * plus one extra enterable tile (e.g. the citizen's home). Identical
 * results to distanceField with the equivalent predicate.
 */
export function distanceFieldMask(map: TileMap, start: TileIndex, mask: Uint8Array, extra = -1): Int32Array {
  const { width, height } = map
  const size = width * height
  const dist = new Int32Array(size).fill(-1)
  if (!isPassable(map, start)) return dist
  const queue = new Int32Array(size)
  let tail = 0
  dist[start] = 0
  queue[tail++] = start
  for (let head = 0; head < tail; head++) {
    const tile = queue[head]!
    const x = tile % width
    const next = dist[tile]! + 1
    let n = tile - width
    if (tile >= width && dist[n] === -1 && (mask[n] === 1 || n === extra)) { dist[n] = next; queue[tail++] = n }
    n = tile + 1
    if (x < width - 1 && dist[n] === -1 && (mask[n] === 1 || n === extra)) { dist[n] = next; queue[tail++] = n }
    n = tile + width
    if (n < size && dist[n] === -1 && (mask[n] === 1 || n === extra)) { dist[n] = next; queue[tail++] = n }
    n = tile - 1
    if (x > 0 && dist[n] === -1 && (mask[n] === 1 || n === extra)) { dist[n] = next; queue[tail++] = n }
  }
  return dist
}

/**
 * Breadth-first step counts from `start` over passable tiles accepted by
 * `canEnter` (start always counts as 0). -1 = unreachable. Ignores terrain
 * cost; used for cheap "how far is it" scoring, while actual travel uses A*.
 */
export function distanceField(map: TileMap, start: TileIndex, canEnter: (tile: TileIndex) => boolean): Int32Array {
  const { width, height } = map
  const size = width * height
  const dist = new Int32Array(size).fill(-1)
  if (!isPassable(map, start)) return dist
  // Hot path (one per AI decision, grows with explored territory): inline
  // neighbours in the same N, E, S, W order as grid.neighbors4, typed queue.
  const queue = new Int32Array(size)
  let tail = 0
  dist[start] = 0
  queue[tail++] = start
  for (let head = 0; head < tail; head++) {
    const tile = queue[head]!
    const x = tile % width
    const next = dist[tile]! + 1
    const visit = (n: number) => {
      if (dist[n] === -1 && isPassable(map, n) && canEnter(n)) {
        dist[n] = next
        queue[tail++] = n
      }
    }
    if (tile >= width) visit(tile - width)
    if (x < width - 1) visit(tile + 1)
    if (tile + width < size) visit(tile + width)
    if (x > 0) visit(tile - 1)
  }
  return dist
}
