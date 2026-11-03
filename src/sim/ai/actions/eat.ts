// Eat: from carried berries on the spot, otherwise walk to camp and eat from
// the shared stockpile (only within CAMP_RADIUS of the campfire).

import { CRITICAL_SATIETY, SATIETY_DECAY } from '../../constants.ts'

/** Average ticks per step used to estimate the walk to the stockpile. */
const TICKS_PER_STEP_ESTIMATE = 2.5
/** The walk estimate never adds more than this much hunger. */
const MAX_WALK_ALLOWANCE = 10
import { recentMemories } from '../../citizens/memory.ts'
import { clamp01, distanceFactor, rising } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { enterArrivalPhase } from '../phases.ts'
import { beginTask } from '../travel.ts'

export function carriedFood(ctx: DecisionContext): number {
  const carry = ctx.citizen.carrying
  return carry && carry.kind === 'berries' ? carry.amount : 0
}

/** Is there food this citizen can eat (carried, or reachable stockpile)? */
export function hasFoodAccess(ctx: DecisionContext): boolean {
  return carriedFood(ctx) > 0 || (ctx.state.stockpile.food > 0 && ctx.campSteps >= 0)
}

export function scoreEat(ctx: DecisionContext): number {
  // Judge hunger by satiety on arrival at the food.
  const walk = carriedFood(ctx) > 0 ? 0 : Math.min(MAX_WALK_ALLOWANCE, Math.max(0, ctx.campSteps) * TICKS_PER_STEP_ESTIMATE * SATIETY_DECAY)
  const hunger = Math.min(1, 1 - (ctx.citizen.needs.satiety - walk) / 100)
  let access = 0
  if (carriedFood(ctx) > 0) access = 1
  else if (ctx.state.stockpile.food > 0 && ctx.campSteps >= 0) access = distanceFactor(ctx.campSteps)
  if (access === 0) return 0
  // Starving citizens eat regardless of distance.
  if (ctx.citizen.needs.satiety < CRITICAL_SATIETY) access = 1
  // Having recently witnessed a death makes a citizen eat earlier (caution).
  const cautious = recentMemories(ctx.state, ctx.citizen, 'sawDeath').length > 0
  return clamp01(rising(hunger, cautious ? 0.15 : 0.25, 0.85) * access)
}

export function startEat(ctx: DecisionContext): boolean {
  const { state, citizen: c } = ctx
  if (carriedFood(ctx) > 0) {
    c.task = { kind: 'eat', phase: 'eat', targetTile: ctx.here, targetId: null, ticksLeft: 0, startedTick: state.tick }
    enterArrivalPhase(state, c)
    return true
  }
  if (ctx.campTile === null || state.stockpile.food <= 0) return false
  return beginTask(state, c, 'eat', ctx.campTile)
}
