// Temporary M1 map: open grass with a water border. Replaced by noise-based
// generation in M2; the TileMap shape stays the same.
import { PLACEHOLDER_BORDER } from '../constants.ts'
import { toPoint } from '../grid.ts'
import type { Terrain, TileIndex, TileMap } from '../types.ts'

export function createPlaceholderMap(width: number, height: number): TileMap {
  const size = width * height
  const terrain: Terrain[] = new Array<Terrain>(size)
  for (let i = 0; i < size; i++) {
    const { x, y } = toPoint(i, width)
    const border =
      x < PLACEHOLDER_BORDER ||
      y < PLACEHOLDER_BORDER ||
      x >= width - PLACEHOLDER_BORDER ||
      y >= height - PLACEHOLDER_BORDER
    terrain[i] = border ? 'water' : 'grass'
  }
  return {
    width,
    height,
    terrain,
    resources: new Array<null>(size).fill(null),
    discovered: new Array<0 | 1>(size).fill(0),
    version: 0,
  }
}

/** Mark every tile within a euclidean radius of `center` as discovered. */
export function revealAround(map: TileMap, center: TileIndex, radius: number): void {
  const c = toPoint(center, map.width)
  const r2 = radius * radius
  let changed = false
  for (let i = 0; i < map.terrain.length; i++) {
    const p = toPoint(i, map.width)
    const dx = p.x - c.x
    const dy = p.y - c.y
    if (dx * dx + dy * dy <= r2 && map.discovered[i] === 0) {
      map.discovered[i] = 1
      changed = true
    }
  }
  if (changed) map.version++
}
