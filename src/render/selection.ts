// Citizen picking from rendered positions (pure; no Pixi, no React).

import type { WorldFit } from './layout.ts'

export interface RenderedCitizen {
  id: number
  /** Centre in world pixels, as last drawn. */
  x: number
  y: number
}

/** Convert a point in canvas CSS pixels to world pixels. */
export function screenToWorld(fit: WorldFit, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - fit.x) / fit.scale, y: (sy - fit.y) / fit.scale }
}

/**
 * Nearest rendered citizen within `radius` world pixels of (x, y), or null.
 * Ties go to the later-drawn citizen (drawn on top), then the higher id.
 */
export function pickCitizen(citizens: readonly RenderedCitizen[], x: number, y: number, radius: number): number | null {
  let best: { id: number; d2: number } | null = null
  const r2 = radius * radius
  for (const c of citizens) {
    const dx = c.x - x
    const dy = c.y - y
    const d2 = dx * dx + dy * dy
    if (d2 <= r2 && (!best || d2 <= best.d2)) best = { id: c.id, d2 }
  }
  return best?.id ?? null
}
