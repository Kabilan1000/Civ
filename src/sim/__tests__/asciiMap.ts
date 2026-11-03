import type { Terrain, TileMap } from '../types.ts'

import { BERRY_MAX, TREE_WOOD_MAX } from '../constants.ts'

const LEGEND: Record<string, Terrain> = {
  '~': 'water', '.': 'grass', s: 'sand', f: 'forest', '#': 'rock', b: 'grass', T: 'forest',
}

/** Build a TileMap from rows of ~ water, . grass, s sand, f forest, # rock, b berry bush (grass), T tree (forest). */
export function asciiMap(rows: string[]): TileMap {
  const width = rows[0]!.length
  if (rows.some((r) => r.length !== width)) throw new Error('asciiMap: ragged rows')
  const terrain = rows.join('').split('').map((ch) => {
    const t = LEGEND[ch]
    if (!t) throw new Error(`asciiMap: unknown tile '${ch}'`)
    return t
  })
  return {
    width,
    height: rows.length,
    terrain,
    resources: rows.join('').split('').map((ch) =>
      ch === 'b' ? { kind: 'berries' as const, amount: BERRY_MAX, max: BERRY_MAX }
      : ch === 'T' ? { kind: 'wood' as const, amount: TREE_WOOD_MAX, max: TREE_WOOD_MAX }
      : null),
    discovered: terrain.map(() => 0 as const),
    version: 0,
  }
}
