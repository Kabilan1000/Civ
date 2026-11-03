import { describe, expect, it } from 'vitest'
import {
  BASE_TICKS_PER_SECOND,
  DEFAULT_WORLD_CONFIG,
  MINUTES_PER_TICK,
  SPEEDS,
  TICKS_PER_DAY,
} from './index.ts'

describe('simulation constants', () => {
  it('uses 240 ticks per day', () => {
    expect(TICKS_PER_DAY).toBe(240)
  })

  it('maps one day of ticks onto 24 in-game hours', () => {
    expect(TICKS_PER_DAY * MINUTES_PER_TICK).toBe(24 * 60)
  })

  it('offers 1x/3x/10x speeds at 5 ticks per second base', () => {
    expect(SPEEDS).toEqual([1, 3, 10])
    expect(SPEEDS.map((s) => s * BASE_TICKS_PER_SECOND)).toEqual([5, 15, 50])
  })

  it('defaults to a 36x24 map with 12 citizens', () => {
    expect(DEFAULT_WORLD_CONFIG).toMatchObject({ width: 36, height: 24, citizenCount: 12 })
  })
})
