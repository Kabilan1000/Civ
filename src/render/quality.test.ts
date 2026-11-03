import { describe, expect, it } from 'vitest'
import { AdaptiveQuality, COOLDOWN_MS, MIN_RESOLUTION, MIN_WINDOW_FRAMES, UP_WINDOWS, WINDOW_MS, qualityLevels } from './quality.ts'

/** Feed `windows` windows of frames at `ms` each; returns the resolution changes seen. */
function feed(q: AdaptiveQuality, ms: number, windows: number, clock: { t: number }) {
  const changes: number[] = []
  // Whole windows: each needs WINDOW_MS of frames and at least MIN_WINDOW_FRAMES frames.
  const perWindow = Math.max(MIN_WINDOW_FRAMES, Math.ceil(WINDOW_MS / ms))
  for (let i = 0; i < windows * perWindow; i++) {
    clock.t += ms
    const r = q.sample(ms, clock.t)
    if (r !== null) changes.push(r)
  }
  return changes
}

describe('adaptive render quality', () => {
  it('caps pixel density by DPR, an absolute maximum and the canvas pixel budget', () => {
    expect(qualityLevels(3, 1280, 800)[0]).toBe(2)
    expect(qualityLevels(1, 1280, 800)).toEqual([1, 0.75])
    expect(qualityLevels(2, 3000, 2000)[0]).toBeLessThan(1) // a huge canvas is capped
    expect(Math.min(...qualityLevels(2, 1280, 800))).toBe(MIN_RESOLUTION)
  })

  it('ignores single spikes and background-tab gaps', () => {
    const q = new AdaptiveQuality(qualityLevels(2, 1280, 800))
    const clock = { t: 0 }
    for (let i = 0; i < (WINDOW_MS / 16) * 4; i++) {
      clock.t += 16
      expect(q.sample(i % 50 === 0 ? 200 : 16, clock.t)).toBeNull()
    }
    expect(q.sample(5000, clock.t)).toBeNull()
    expect(q.resolution).toBe(2)
  })

  it('reacts within seconds even on a very slow device', () => {
    const q = new AdaptiveQuality(qualityLevels(2, 1280, 800))
    const clock = { t: 0 }
    const changes = feed(q, 120, 2, clock) // ≈ 8 fps
    expect(changes).toEqual([1.5])
    expect(clock.t).toBeLessThanOrEqual(2 * WINDOW_MS + 2 * 120) // two windows ≈ 3 s
  })

  it('steps down only after sustained slowness, one level at a time, to a floor', () => {
    const q = new AdaptiveQuality(qualityLevels(2, 1280, 800))
    const clock = { t: 0 }
    expect(feed(q, 40, 1, clock)).toEqual([]) // one slow window is not enough
    expect(feed(q, 40, 1, clock)).toEqual([1.5])
    const rest = feed(q, 40, 20, clock)
    expect(rest).toEqual([1.25, 1, MIN_RESOLUTION])
    expect(q.resolution).toBe(MIN_RESOLUTION)
  })

  it('steps back up only after a long fast streak and a cooldown', () => {
    const q = new AdaptiveQuality(qualityLevels(2, 1280, 800))
    const clock = { t: 0 }
    feed(q, 40, 2, clock) // → 1.5 at t ≈ 3 s
    const changedAt = clock.t
    expect(feed(q, 10, UP_WINDOWS - 1, clock)).toEqual([]) // not enough fast windows yet
    const up = feed(q, 10, 6, clock) // fast windows keep coming; the cooldown (10 s) has to pass too
    expect(up).toEqual([2]) // exactly one step up, back to the top
    expect(clock.t - changedAt).toBeGreaterThan(COOLDOWN_MS)
  })

  it('does not oscillate: a level that proved too slow after rising becomes a ceiling', () => {
    const q = new AdaptiveQuality(qualityLevels(2, 1280, 800))
    const clock = { t: 0 }
    feed(q, 40, 2, clock) // 2 → 1.5
    expect(feed(q, 10, 10, clock)).toEqual([2]) // 1.5 → 2 after streak + cooldown
    feed(q, 40, 2, clock) // too slow again → 1.5, and 2 is now off limits
    expect(q.resolution).toBe(1.5)
    const later = feed(q, 10, UP_WINDOWS * 10, clock)
    expect(later).toEqual([])
    expect(q.resolution).toBe(1.5)
  })
})
