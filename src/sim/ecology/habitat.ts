// Habitat, crowding and the settled clearing (M10c, TDS §7.1). Pure helpers
// over the map and structures; integer arithmetic only.

import {
  CROWD_MAX,
  FOREST_EDGE_SUITABILITY,
  FOREST_EDGE_TREES,
  HABITAT,
  PLANT_SAFETY_CAP_PERMILLE,
  SETTLED_CLEARING,
  SHADE_PERCENT,
  SHADE_TREES,
} from '../constants.ts'
import type { ResourceKind, TileIndex, TileMap, WorldState } from '../types.ts'

/** Same-kind plants (any stage; deadwood counts as a tree) among the 8 neighbours. */
export function neighbours8(map: TileMap, tile: TileIndex, kind: ResourceKind): number {
  const { width, height } = map
  const x0 = tile % width
  const y0 = Math.floor(tile / width)
  let n = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const x = x0 + dx
      const y = y0 + dy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (map.resources[y * width + x]?.kind === kind) n++
    }
  }
  return n
}

function grassNextTo(map: TileMap, tile: TileIndex): boolean {
  const { width, height } = map
  const x = tile % width
  const y = Math.floor(tile / width)
  const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < width && yy < height && map.terrain[yy * width + xx] === 'grass'
  return at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)
}

/** Habitat suitability 0–100 for a new plant of `kind` on `tile` (GDD §3.5). */
export function suitability(map: TileMap, kind: ResourceKind, tile: TileIndex): number {
  const terrain = map.terrain[tile]!
  if (kind === 'berries') {
    let s: number = HABITAT.berries[terrain]
    if (terrain === 'sand' && !grassNextTo(map, tile)) s = 0
    if (s > 0 && neighbours8(map, tile, 'wood') >= SHADE_TREES) s = Math.floor((s * SHADE_PERCENT) / 100)
    return s
  }
  if (terrain === 'grass') return neighbours8(map, tile, 'wood') >= FOREST_EDGE_TREES ? FOREST_EDGE_SUITABILITY : HABITAT.wood.grass
  return HABITAT.wood[terrain]
}

export function crowded(map: TileMap, kind: ResourceKind, tile: TileIndex): boolean {
  return neighbours8(map, tile, kind) > CROWD_MAX[kind]
}

/** Grass, forest and sand tiles: the base for the safety cap. */
export function landTiles(map: TileMap): number {
  let n = 0
  for (const t of map.terrain) if (t === 'grass' || t === 'forest' || t === 'sand') n++
  return n
}

export function safetyCap(map: TileMap, kind: ResourceKind): number {
  return Math.floor((landTiles(map) * PLANT_SAFETY_CAP_PERMILLE[kind]) / 1000)
}

/**
 * Tiles where nothing may germinate: every structure tile (campfire, shelters,
 * planned sites) and everything within SETTLED_CLEARING (Manhattan) of one.
 * Only germination is blocked — plants already growing there are untouched.
 */
export function clearingMask(state: WorldState): Uint8Array {
  const { width, height } = state.map
  const mask = new Uint8Array(width * height)
  for (const s of state.structures) {
    const sx = s.tile % width
    const sy = Math.floor(s.tile / width)
    for (let dy = -SETTLED_CLEARING; dy <= SETTLED_CLEARING; dy++) {
      const reach = SETTLED_CLEARING - Math.abs(dy)
      for (let dx = -reach; dx <= reach; dx++) {
        const x = sx + dx
        const y = sy + dy
        if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = 1
      }
    }
  }
  return mask
}
