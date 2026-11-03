import { describe, expect, it } from 'vitest'
import { seedRng } from '../rng.ts'
import { valueNoiseField } from './noise.ts'

describe('valueNoiseField', () => {
  const octaves = [{ cell: 6, weight: 1 }]

  it('is deterministic per seed and differs between seeds', () => {
    const a = valueNoiseField(seedRng('n'), 36, 24, octaves)
    expect(valueNoiseField(seedRng('n'), 36, 24, octaves)).toEqual(a)
    expect(valueNoiseField(seedRng('m'), 36, 24, octaves)).not.toEqual(a)
  })

  it('stays in [0, 1] and is spatially coherent', () => {
    const f = valueNoiseField(seedRng('range'), 36, 24, octaves)
    let neighbourDiff = 0
    for (let i = 0; i < f.length; i++) {
      expect(f[i]! >= 0 && f[i]! <= 1).toBe(true)
      if ((i + 1) % 36 !== 0) neighbourDiff += Math.abs(f[i]! - f[i + 1]!)
    }
    // Smooth noise: adjacent tiles differ far less than independent random values (~0.33).
    expect(neighbourDiff / (35 * 24)).toBeLessThan(0.1)
  })
})
