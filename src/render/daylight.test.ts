import { describe, expect, it } from 'vitest'
import { darknessAt, lerpColor, lightingAt, NIGHT_SCENE_TINT } from './daylight.ts'

describe('daylight', () => {
  it('is bright by day, dark at night, and changes gradually at dusk and dawn', () => {
    expect(darknessAt(12 * 60)).toBe(0)
    expect(darknessAt(2 * 60)).toBe(1)
    expect(darknessAt(6 * 60)).toBeCloseTo(0.5) // tick 0: dawn, half light
    expect(darknessAt(20.5 * 60)).toBeCloseTo(0.5)
    // Monotonic darkening through dusk, in small steps.
    let prev = darknessAt(19 * 60)
    for (let m = 19 * 60 + 6; m <= 22 * 60; m += 6) {
      const d = darknessAt(m)
      expect(d).toBeGreaterThanOrEqual(prev)
      expect(d - prev).toBeLessThan(0.05)
      prev = d
    }
  })

  it('tints the scene from white to the night colour and keeps citizens lighter', () => {
    expect(lightingAt(12 * 60).sceneTint).toBe(0xffffff)
    const night = lightingAt(1 * 60)
    expect(night.sceneTint).toBe(NIGHT_SCENE_TINT)
    const lum = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)
    expect(lum(night.citizenTint)).toBeGreaterThan(lum(night.sceneTint))
    expect(night.lightAlpha).toBeGreaterThan(lightingAt(12 * 60).lightAlpha)
  })

  it('blends colours channel by channel', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    expect(lerpColor(0x102030, 0x102030, 0.7)).toBe(0x102030)
  })
})
