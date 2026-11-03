// Response curves for utility scoring. Only + - * / and min/max, so results
// are bit-identical on every JS engine.

import { DISTANCE_FALLOFF_STEPS } from '../constants.ts'

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** 0 below `start`, rising to 1 at `end`, shaped by a power of 1.5 (x * sqrt x). */
export function rising(x: number, start: number, end: number): number {
  const t = clamp01((x - start) / (end - start))
  return t * Math.sqrt(t)
}

/** 1 when adjacent, falling linearly to 1/3 at DISTANCE_FALLOFF_STEPS and beyond. */
export function distanceFactor(steps: number): number {
  return 1 - Math.min(steps, DISTANCE_FALLOFF_STEPS) / (DISTANCE_FALLOFF_STEPS * 1.5)
}
