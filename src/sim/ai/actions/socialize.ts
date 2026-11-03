// Socialize: walk to a nearby available citizen and talk (chat or argue —
// decided when the conversation ends, see systems/social.ts).
//
// Partner choice (best "partner factor", ties by lower id):
//   (0.5 + 0.5·(affinity+100)/200) × (1 + 0.3·familiarity/50, capped)
//   × distance factor × 0.3 if we argued recently (memory) × 1.3 if they
//   recently gave us food (memory). Excluded: dead, asleep, busy, out of
//   SOCIAL_SEARCH_STEPS, pair cooldown, or affinity below AVOID_AFFINITY.
// Score: rising(loneliness) × (0.6 + 0.6·sociability) × partner factor,
// 0 while hungry/tired (SOCIAL_MIN_NEED) or on cooldown; ×0.4 at night.

import {
  AVOID_AFFINITY,
  PAIR_COOLDOWN,
  SOCIAL_COOLDOWN,
  SOCIAL_MIN_NEED,
  SOCIAL_SEARCH_STEPS,
} from '../../constants.ts'
import { recentMemories } from '../../citizens/memory.ts'
import { getRelationship } from '../../citizens/relationships.ts'
import { isAvailableForChat } from '../../systems/social.ts'
import type { Citizen } from '../../types.ts'
import { clamp01, distanceFactor, rising } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

const NIGHT_FACTOR = 0.4

export interface Partner {
  citizen: Citizen
  steps: number
  factor: number
}

/** Steps to another citizen's tile over tiles we may walk (-1 if unreachable/far). */
export function stepsTo(ctx: DecisionContext, other: Citizen): number {
  const d = ctx.steps[other.pos.y * ctx.state.map.width + other.pos.x]!
  return d >= 0 && d <= SOCIAL_SEARCH_STEPS ? d : -1
}

export function partnerFactor(ctx: DecisionContext, other: Citizen, steps: number): number {
  const { state, citizen: c } = ctx
  const rel = getRelationship(c, other.id)
  const affinity = rel?.affinity ?? 0
  const familiarity = rel?.familiarity ?? 0
  let f = (0.5 + (0.5 * (affinity + 100)) / 200) * (1 + 0.3 * Math.min(1, familiarity / 50)) * distanceFactor(steps)
  if (recentMemories(state, c, 'argument', other.id).length > 0) f *= 0.3
  if (recentMemories(state, c, 'receivedFood', other.id).length > 0) f *= 1.3
  return f
}

export function bestChatPartner(ctx: DecisionContext): Partner | null {
  const { state, citizen: c } = ctx
  let best: Partner | null = null
  for (const other of state.citizens) {
    if (other === c || !isAvailableForChat(other)) continue
    const rel = getRelationship(c, other.id)
    if (rel && (state.tick - rel.lastTick < PAIR_COOLDOWN || rel.affinity < AVOID_AFFINITY)) continue
    const steps = stepsTo(ctx, other)
    if (steps < 0) continue
    const factor = partnerFactor(ctx, other, steps)
    if (!best || factor > best.factor) best = { citizen: other, steps, factor }
  }
  return best
}

export function onSocialCooldown(ctx: DecisionContext): boolean {
  const last = ctx.citizen.lastSocialTick
  return last !== null && ctx.state.tick - last < SOCIAL_COOLDOWN
}

export function scoreSocialize(ctx: DecisionContext): number {
  const c = ctx.citizen
  if (c.needs.satiety < SOCIAL_MIN_NEED || c.needs.energy < SOCIAL_MIN_NEED || onSocialCooldown(ctx)) return 0
  const partner = bestChatPartner(ctx)
  if (!partner) return 0
  const loneliness = 1 - c.needs.social / 100
  const night = ctx.night ? NIGHT_FACTOR : 1
  return clamp01(rising(loneliness, 0.15, 0.8) * (0.6 + 0.6 * c.personality.sociability) * Math.min(1, partner.factor) * night)
}

export function startSocialize(ctx: DecisionContext): boolean {
  const partner = bestChatPartner(ctx)
  if (!partner) return false
  const p = partner.citizen.pos
  return beginTask(ctx.state, ctx.citizen, 'socialize', p.y * ctx.state.map.width + p.x, partner.citizen.id)
}
