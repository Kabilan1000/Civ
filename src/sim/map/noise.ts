// Seeded 2D value noise. Lattice values are drawn from the seeded RNG, then
// sampled with bilinear interpolation and a polynomial smoothstep, so only
// + - * / and Math.floor are used (exact on every JS engine).

import { nextFloat } from '../rng.ts'
import type { RngState } from '../types.ts'

export interface NoiseOctave {
  /** Lattice spacing in tiles; larger = smoother, bigger features. */
  cell: number
  weight: number
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Fill a width*height field (indexed y * width + x) with fractal value noise
 * in roughly [0, 1]. Draws from `rng` in a fixed order: octave by octave,
 * lattice row by row.
 */
export function valueNoiseField(
  rng: RngState,
  width: number,
  height: number,
  octaves: readonly NoiseOctave[],
): Float64Array {
  const field = new Float64Array(width * height)
  const totalWeight = octaves.reduce((sum, o) => sum + o.weight, 0)

  for (const { cell, weight } of octaves) {
    const lw = Math.floor((width - 1) / cell) + 2
    const lh = Math.floor((height - 1) / cell) + 2
    const lattice = new Float64Array(lw * lh)
    for (let i = 0; i < lattice.length; i++) lattice[i] = nextFloat(rng)

    for (let y = 0; y < height; y++) {
      const gy = y / cell
      const iy = Math.floor(gy)
      const ty = smoothstep(gy - iy)
      for (let x = 0; x < width; x++) {
        const gx = x / cell
        const ix = Math.floor(gx)
        const tx = smoothstep(gx - ix)
        const v00 = lattice[iy * lw + ix]!
        const v10 = lattice[iy * lw + ix + 1]!
        const v01 = lattice[(iy + 1) * lw + ix]!
        const v11 = lattice[(iy + 1) * lw + ix + 1]!
        const top = v00 + (v10 - v00) * tx
        const bottom = v01 + (v11 - v01) * tx
        field[y * width + x]! += ((top + (bottom - top) * ty) * weight) / totalWeight
      }
    }
  }
  return field
}
