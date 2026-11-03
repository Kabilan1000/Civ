import type { Role, Terrain } from '../sim/index.ts'

export const TILE_SIZE = 24

export const TERRAIN_COLORS: Record<Terrain, number> = {
  water: 0x2f6f9f,
  sand: 0xd9c48c,
  grass: 0x6aa84f,
  forest: 0x3f7f3b,
  rock: 0x878d94,
}

export const ROLE_COLORS: Record<Role, number> = {
  forager: 0xf2b134,
  builder: 0xe0704f,
  explorer: 0x5bc0de,
}

export const COLORS = {
  background: 0x12161c,
  fog: 0x0e1217,
  fogAlpha: 0.82,
  trunk: 0x6b4a2b,
  canopy: 0x2b5a28,
  canopyLight: 0x3f7a37,
  bush: 0x4c8a37,
  bushBare: 0x6b7f4a,
  berry: 0xd9475a,
  log: 0x7a4f2a,
  flame: 0xf59e2b,
  flameCore: 0xffe08a,
  glow: 0xffb347,
  outline: 0xffffff,
  wall: 0xc8a06a,
  roof: 0x8e3b2c,
  stake: 0xe8d9b5,
  windowLight: 0xffd36b,
  bubble: 0xf4f6fa,
  selection: 0xffe08a,
  bubbleArgue: 0xff5a4f,
  bubbleShare: 0xff9ecb,
  shadow: 0x000000,
} as const

/** Multiply an RGB colour's channels by `factor` (render-only, not simulation). */
export function shade(color: number, factor: number): number {
  const ch = (shift: number) => Math.min(255, Math.max(0, Math.round(((color >> shift) & 0xff) * factor)))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Cheap stable per-tile variation in [-1, 1] so flat terrain doesn't look flat. */
export function tileNoise(index: number): number {
  let h = (index + 1) * 2654435761
  h = (h ^ (h >>> 13)) >>> 0
  return ((h % 1000) / 1000) * 2 - 1
}
