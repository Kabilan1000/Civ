import type { Terrain, TileMap } from '../types.ts'

import { plantNode } from '../ecology/flora.ts'

const LEGEND: Record<string, Terrain> = {
  '~': 'water', '.': 'grass', s: 'sand', f: 'forest', '#': 'rock', b: 'grass', T: 'forest',
}

/**
 * Build a TileMap from rows of ~ water, . grass, s sand, f forest, # rock, b berry bush (grass), T tree (forest).
 * Plants are full and mature (born at tick 0, the longest lifespan); tests that need other stages edit the nodes.
 */
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
      ch === 'b' ? plantNode('berries') : ch === 'T' ? plantNode('wood') : null),
    discovered: terrain.map(() => 0 as const),
    version: 0,
  }
}
