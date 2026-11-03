// Deliver: carry the current load to the campfire stockpile.

import { CARRY_CAPACITY } from '../../constants.ts'
import { siteHasRoom } from '../../structures.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

export function scoreDeliver(ctx: DecisionContext): number {
  const carry = ctx.citizen.carrying
  if (!carry || carry.amount <= 0 || ctx.campTile === null || ctx.campSteps < 0) return 0
  // Wood a reachable construction site still needs goes to the site (Build →
  // supply), not back to the stockpile: otherwise a long haul could be
  // interrupted into an endless camp ↔ camp loop.
  const site = ctx.site
  if (
    carry.kind === 'wood' && site && site.stage === 'planned' && ctx.siteWorkTile &&
    site.woodDelivered < site.woodRequired && siteHasRoom(ctx.state, site, ctx.citizen)
  ) {
    return 0
  }
  const fullness = carry.amount / CARRY_CAPACITY[carry.kind]
  const villageNeedsFood = carry.kind === 'berries' && ctx.state.stockpile.food === 0 ? 0.1 : 0
  return 0.25 + 0.55 * fullness + villageNeedsFood
}

export function startDeliver(ctx: DecisionContext): boolean {
  if (ctx.campTile === null || !ctx.citizen.carrying) return false
  return beginTask(ctx.state, ctx.citizen, 'deliver', ctx.campTile)
}
