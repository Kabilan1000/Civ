import type { Terrain, TileMap } from '../types.ts'

const LEGEND: Record<string, Terrain> = { '~': 'water', '.': 'grass', s: 'sand', f: 'forest', '#': 'rock' }

/** Build a TileMap from rows of ~ water, . grass, s sand, f forest, # rock. */
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
    resources: terrain.map(() => null),
    discovered: terrain.map(() => 0 as const),
    version: 0,
  }
}
