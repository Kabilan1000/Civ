// Deliver: carry the current load to the campfire stockpile.

import { CARRY_CAPACITY } from '../../constants.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

export function scoreDeliver(ctx: DecisionContext): number {
  const carry = ctx.citizen.carrying
  if (!carry || carry.amount <= 0 || ctx.campTile === null || ctx.campSteps < 0) return 0
  const fullness = carry.amount / CARRY_CAPACITY[carry.kind]
  const villageNeedsFood = carry.kind === 'berries' && ctx.state.stockpile.food === 0 ? 0.1 : 0
  return 0.25 + 0.55 * fullness + villageNeedsFood
}

export function startDeliver(ctx: DecisionContext): boolean {
  if (ctx.campTile === null || !ctx.citizen.carrying) return false
  return beginTask(ctx.state, ctx.citizen, 'deliver', ctx.campTile)
}
