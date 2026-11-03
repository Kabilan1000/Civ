import { toPoint } from '../grid.ts'
import type { TileIndex, TileMap } from '../types.ts'

/** True if `tile` lies within a euclidean `radius` of `center`. */
export function withinRadius(map: TileMap, center: TileIndex, tile: TileIndex, radius: number): boolean {
  const c = toPoint(center, map.width)
  const p = toPoint(tile, map.width)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return dx * dx + dy * dy <= radius * radius
}

/**
 * Mark every tile within a euclidean radius of `center` as discovered.
 * Bumps map.version if anything changed. Returns how many tiles were new.
 */
export function revealAround(map: TileMap, center: TileIndex, radius: number): number {
  let revealed = 0
  for (let i = 0; i < map.terrain.length; i++) {
    if (map.discovered[i] === 0 && withinRadius(map, center, i, radius)) {
      map.discovered[i] = 1
      revealed++
    }
  }
  if (revealed > 0) map.version++
  return revealed
}
