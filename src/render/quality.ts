// Adaptive render resolution (pure logic; the renderer applies the result).
//
// The canvas resolution starts at min(devicePixelRatio, MAX_RESOLUTION), also
// capped so the canvas never exceeds MAX_CANVAS_PIXELS. Frame intervals are
// grouped into windows of WINDOW_MS (at least MIN_WINDOW_FRAMES frames), so a
// slow device reacts within seconds; each window's median is compared with
// the thresholds:
//   • two consecutive slow windows (median > SLOW_MS) → one level down
//   • UP_WINDOWS consecutive fast windows (median < FAST_MS), and at least
//     COOLDOWN_MS since the last change → one level up
//   • if a level we stepped UP to turns out slow again, the level below
//     becomes a permanent ceiling — so quality never oscillates
// Gaps above MAX_INTERVAL_MS (tab in background, debugger) are ignored, and a
// single spike never changes anything (medians, two windows).
// This only changes how many pixels are drawn — never the simulation.

export const MAX_RESOLUTION = 2
export const MAX_CANVAS_PIXELS = 4_200_000 // ≈ 2560×1640 device pixels
export const MIN_RESOLUTION = 0.75
export const WINDOW_MS = 1500
export const MIN_WINDOW_FRAMES = 10
export const SLOW_MS = 28 // below ≈ 36 fps
export const FAST_MS = 18 // above ≈ 55 fps
export const UP_WINDOWS = 6
export const COOLDOWN_MS = 10_000
export const MAX_INTERVAL_MS = 250

/** Resolution steps from the best the device should get down to the minimum. */
export function qualityLevels(devicePixelRatio: number, cssWidth: number, cssHeight: number): number[] {
  const area = Math.max(1, cssWidth * cssHeight)
  const byPixels = Math.sqrt(MAX_CANVAS_PIXELS / area)
  const top = Math.max(MIN_RESOLUTION, Math.min(devicePixelRatio || 1, MAX_RESOLUTION, byPixels))
  const levels = [top, 1.5, 1.25, 1, MIN_RESOLUTION].filter((l) => l <= top + 1e-9)
  return [...new Set(levels.map((l) => Math.round(l * 100) / 100))].sort((a, b) => b - a)
}

export class AdaptiveQuality {
  private levels: number[]
  private index = 0
  private ceiling = 0 // highest index allowed (0 = top level)
  private samples: number[] = []
  private windowMs = 0
  private slowWindows = 0
  private fastWindows = 0
  private lastChangeAt = -Infinity
  private lastChangeWasUp = false

  constructor(levels: number[]) {
    this.levels = levels.length ? levels : [1]
  }

  get resolution(): number {
    return this.levels[this.index]!
  }

  /** Recompute levels (e.g. on resize); keeps the current step as close as possible. */
  setLevels(levels: number[]): number {
    const current = this.resolution
    this.levels = levels.length ? levels : [1]
    let i = this.levels.findIndex((l) => l <= current + 1e-9)
    if (i < 0) i = this.levels.length - 1
    this.index = Math.max(i, Math.min(this.ceiling, this.levels.length - 1))
    this.ceiling = Math.min(this.ceiling, this.levels.length - 1)
    return this.resolution
  }

  /**
   * Feed one frame interval. Returns the new resolution when it should
   * change, otherwise null.
   */
  sample(intervalMs: number, nowMs: number): number | null {
    if (!(intervalMs > 0) || intervalMs > MAX_INTERVAL_MS) return null
    this.samples.push(intervalMs)
    this.windowMs += intervalMs
    if (this.windowMs < WINDOW_MS || this.samples.length < MIN_WINDOW_FRAMES) return null
    this.windowMs = 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]!
    this.samples = []

    if (median > SLOW_MS) {
      this.fastWindows = 0
      if (++this.slowWindows >= 2 && this.index < this.levels.length - 1) {
        // Going back down right after going up: that level is too much for this device.
        if (this.lastChangeWasUp) this.ceiling = this.index + 1
        return this.change(this.index + 1, nowMs, false)
      }
    } else if (median < FAST_MS) {
      this.slowWindows = 0
      const canRise = this.index > this.ceiling && nowMs - this.lastChangeAt >= COOLDOWN_MS
      if (++this.fastWindows >= UP_WINDOWS && canRise) return this.change(this.index - 1, nowMs, true)
    } else {
      this.slowWindows = 0
      this.fastWindows = 0
    }
    return null
  }

  private change(index: number, nowMs: number, up: boolean): number {
    this.index = index
    this.lastChangeAt = nowMs
    this.lastChangeWasUp = up
    this.slowWindows = 0
    this.fastWindows = 0
    return this.resolution
  }
}
