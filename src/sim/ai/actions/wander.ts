// Wander: walk to a random nearby discovered tile, linger, repeat.
// Low-scoring fallback when nothing more useful is available.

import { ROLE_WEIGHTS, WANDER_MAX_TRIES, WANDER_RADIUS } from '../../constants.ts'
import { inBounds, isPassable, toIndex } from '../../grid.ts'
import { nextInt } from '../../rng.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

export function scoreWander(ctx: DecisionContext): number {
  const c = ctx.citizen
  return (0.1 + 0.08 * c.personality.curiosity) * (ROLE_WEIGHTS[c.role].wander ?? 1)
}

/**
 * Try up to WANDER_MAX_TRIES random destinations within WANDER_RADIUS
 * (Manhattan) that are passable, discovered and reachable over discovered
 * tiles. Returns false if nothing suitable was found.
 */
export function startWander(ctx: DecisionContext): boolean {
  const { state, citizen: c, steps } = ctx
  const { map, rng } = state
  for (let attempt = 0; attempt < WANDER_MAX_TRIES; attempt++) {
    const dx = nextInt(rng, -WANDER_RADIUS, WANDER_RADIUS)
    const reach = WANDER_RADIUS - Math.abs(dx)
    const dy = nextInt(rng, -reach, reach)
    const x = c.pos.x + dx
    const y = c.pos.y + dy
    if (!inBounds(map, x, y)) continue
    const target = toIndex(x, y, map.width)
    if (target === ctx.here || !isPassable(map, target) || steps[target]! < 0) continue
    if (beginTask(state, c, 'wander', target)) return true
  }
  return false
}
