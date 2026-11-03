// Share: carry berries to a hungry neighbour and hand some over.
// Receiver: alive, satiety < SHARE_HUNGER_SATIETY, not carrying berries,
// within SOCIAL_SEARCH_STEPS. The giver must not be hungry themselves.
// Score: 0.9 × generosity × (0.4 + 0.6·their hunger) × distance, where
// generosity = 0.3 + 0.4·sociability + 0.3·(affinity+100)/200, +0.3 if
// that person recently fed us (reciprocity memory).

import { SHARE_HUNGER_SATIETY, SOCIAL_COOLDOWN } from '../../constants.ts'
import { recentMemories } from '../../citizens/memory.ts'
import { affinityOf } from '../../citizens/relationships.ts'
import { shareUnits } from '../../systems/social.ts'
import type { Citizen } from '../../types.ts'
import { clamp01, distanceFactor } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'
import { stepsTo } from './socialize.ts'

interface Receiver {
  citizen: Citizen
  score: number
}

function bestReceiver(ctx: DecisionContext): Receiver | null {
  const { state, citizen: c } = ctx
  if (c.carrying?.kind !== 'berries' || c.needs.satiety < 50) return null
  const last = c.lastSocialTick
  if (last !== null && state.tick - last < SOCIAL_COOLDOWN / 2) return null
  let best: Receiver | null = null
  for (const other of state.citizens) {
    if (other === c || !other.alive || other.needs.satiety >= SHARE_HUNGER_SATIETY) continue
    if (other.carrying?.kind === 'berries' || other.task?.phase === 'sleep' || shareUnits(c, other) <= 0) continue
    const steps = stepsTo(ctx, other)
    if (steps < 0) continue
    const reciprocity = recentMemories(state, c, 'receivedFood', other.id).length > 0 ? 0.3 : 0
    const generosity = 0.3 + 0.4 * c.personality.sociability + (0.3 * (affinityOf(c, other.id) + 100)) / 200 + reciprocity
    const hunger = 1 - other.needs.satiety / SHARE_HUNGER_SATIETY
    const score = clamp01(0.9 * generosity * (0.4 + 0.6 * hunger) * distanceFactor(steps))
    if (!best || score > best.score) best = { citizen: other, score }
  }
  return best
}

export function scoreShare(ctx: DecisionContext): number {
  return bestReceiver(ctx)?.score ?? 0
}

export function startShare(ctx: DecisionContext): boolean {
  const r = bestReceiver(ctx)
  if (!r) return false
  const p = r.citizen.pos
  return beginTask(ctx.state, ctx.citizen, 'share', p.y * ctx.state.map.width + p.x, r.citizen.id)
}
