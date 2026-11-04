// How each freshness level looks (returning fog, schema v9). Pure, testable.
//
//   0 observed  clear          1 recent   a faint veil
//   2–4 fading  thickening     5 stale    the fog has returned (land still drawn)
//   6 unknown   full fog (never discovered)
//
// Under stale fog the player sees the land as it was when last observed: a
// plant that grew, died or vanished meanwhile keeps its remembered look until
// someone sees the place again. Fresher tiles always show the real state.

import type { Freshness } from '../sim/index.ts'
import { COLORS } from './palette.ts'

export const FOG_ALPHA: readonly number[] = [0, 0.07, 0.18, 0.28, 0.38, 0.52, COLORS.fogAlpha]

export interface SpriteView {
  /** Texture key to show, or null for nothing. */
  key: string | null
  alpha: number
}

/**
 * What a tile's plant sprite shows. `current` is the plant's real texture key
 * (null: no plant); `remembered` what was last seen there (undefined: never
 * recorded — e.g. just after loading, when everything counts as seen).
 */
export function spriteView(freshness: Freshness, current: string | null, remembered: string | null | undefined): SpriteView {
  const alpha = 1 - FOG_ALPHA[freshness]!
  if (freshness === 5) return { key: remembered === undefined ? current : remembered, alpha }
  return { key: current, alpha }
}

/** Whether the real state should be remembered (anything not yet stale is being kept up to date). */
export const remembersAt = (freshness: Freshness) => freshness < 5
