// Returning fog (schema v9). Discovery is permanent; freshness is not.
// map.lastSeen[i] is the tick a tile was last observed (−1: never). These are
// pure helpers shared by the simulation (observation, resurvey targets),
// selectors and the renderer.

import { FOG_CLEAR_DAYS, FOG_FULL_DAYS, TICKS_PER_DAY } from '../constants.ts'
import type { TileIndex, TileMap } from '../types.ts'

/**
 * Visual freshness of a tile, 0..6:
 *   0 observed   seen within the last day (someone is there or was just now)
 *   1 recent     seen within FOG_CLEAR_DAYS
 *   2–4 fading   seen FOG_CLEAR_DAYS…FOG_FULL_DAYS ago, in three steps
 *   5 stale      not seen for FOG_FULL_DAYS or more: the fog has returned
 *   6 unknown    never discovered
 */
export type Freshness = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const FRESHNESS_STALE = 5
export const FRESHNESS_UNKNOWN = 6

export function freshnessOf(discovered: 0 | 1, lastSeen: number, tick: number): Freshness {
  if (discovered === 0) return 6
  const age = lastSeen < 0 ? Infinity : tick - lastSeen
  if (age < TICKS_PER_DAY) return 0
  const clear = FOG_CLEAR_DAYS * TICKS_PER_DAY
  const full = FOG_FULL_DAYS * TICKS_PER_DAY
  if (age < clear) return 1
  if (age >= full) return 5
  return (2 + Math.floor(((age - clear) * 3) / (full - clear))) as Freshness
}

/** True once a discovered tile has gone unobserved for FOG_CLEAR_DAYS (fading or stale). */
export function isFaded(map: TileMap, tile: TileIndex, tick: number): boolean {
  return map.discovered[tile] === 1 && (map.lastSeen[tile]! < 0 || tick - map.lastSeen[tile]! >= FOG_CLEAR_DAYS * TICKS_PER_DAY)
}

/**
 * Observe every DISCOVERED tile within a Euclidean radius of `center` at
 * `tick`. Observation never discovers new land (only explorers' surveys do)
 * and never changes the map's version: it is freshness only.
 */
export function observeAround(map: TileMap, center: TileIndex, radius: number, tick: number): void {
  const { width, height } = map
  const cx = center % width
  const cy = Math.floor(center / width)
  const r2 = radius * radius
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
      const dx = x - cx
      const dy = y - cy
      const i = y * width + x
      if (dx * dx + dy * dy <= r2 && map.discovered[i] === 1) map.lastSeen[i] = tick
    }
  }
}

/** Freshness of every tile (for the renderer and statistics). */
export function freshnessMap(map: TileMap, tick: number): Uint8Array {
  const out = new Uint8Array(map.discovered.length)
  for (let i = 0; i < out.length; i++) out[i] = freshnessOf(map.discovered[i]!, map.lastSeen[i]!, tick)
  return out
}
