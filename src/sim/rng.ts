// Seeded, reproducible randomness. The generator state is a plain
// [uint32, uint32, uint32, uint32] tuple stored in WorldState.rng, so a saved
// world resumes the exact same random sequence. Every function advances the
// state array in place. Only integer ops (Math.imul, shifts, >>> 0) are used,
// which are exact on every JS engine.

import type { RngState } from './types.ts'

const UINT32_RANGE = 0x1_0000_0000
const WARMUP_ROUNDS = 15

/** cyrb128: hash a string into four 32-bit seed words. */
function hashSeed(seed: string): RngState {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** Create a fresh generator state from a string seed. */
export function seedRng(seed: string): RngState {
  const state = hashSeed(seed)
  for (let i = 0; i < WARMUP_ROUNDS; i++) nextUint32(state)
  return state
}

/** sfc32 step: returns a uint32 and advances the state. */
export function nextUint32(s: RngState): number {
  let [a, b, c, d] = s
  const t = (((a + b) >>> 0) + d) >>> 0
  d = (d + 1) >>> 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) >>> 0
  c = ((c << 21) | (c >>> 11)) >>> 0
  c = (c + t) >>> 0
  s[0] = a >>> 0
  s[1] = b
  s[2] = c
  s[3] = d
  return t
}

/** Float in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextUint32(s) / UINT32_RANGE
}

/** Integer in [min, max], inclusive. */
export function nextInt(s: RngState, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`nextInt: invalid range [${min}, ${max}]`)
  }
  return min + Math.floor(nextFloat(s) * (max - min + 1))
}

/** True with probability p. */
export function chance(s: RngState, p: number): boolean {
  return nextFloat(s) < p
}

/** Uniformly pick one element. Throws on an empty array. */
export function pick<T>(s: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array')
  return items[nextInt(s, 0, items.length - 1)] as T
}

/** Fisher–Yates shuffle in place; returns the same array. */
export function shuffle<T>(s: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(s, 0, i)
    const tmp = items[i] as T
    items[i] = items[j] as T
    items[j] = tmp
  }
  return items
}
