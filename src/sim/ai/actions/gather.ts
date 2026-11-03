// Forage (berries → food) and chop (trees → wood): walk to the nearest
// discovered, reachable, unreserved node, gather until full or empty.

import {
  CARRY_CAPACITY,
  FOOD_RESERVE_PER_CITIZEN,
  NIGHT_WORK_FACTOR,
  ROLE_WEIGHTS,
  WOOD_TARGET,
} from '../../constants.ts'
import type { ResourceKind } from '../../types.ts'
import { clamp01, distanceFactor } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

const WORK_BASE = 0.5
const MIN_DEMAND = 0.15

function scoreGather(ctx: DecisionContext, kind: ResourceKind): number {
  const c = ctx.citizen
  const target = kind === 'berries' ? ctx.berries : ctx.wood
  if (!target) return 0
  const carry = c.carrying
  if (carry && (carry.kind !== kind || carry.amount >= CARRY_CAPACITY[kind])) return 0
  const fullness = carry ? carry.amount / CARRY_CAPACITY[kind] : 0

  const stock = ctx.state.stockpile
  // Demand falls to MIN_DEMAND once the village stockpile target is met, so
  // citizens stop hoarding and spend time elsewhere.
  let demand: number
  if (kind === 'berries') {
    const shortage = 1 - Math.min(1, stock.food / (FOOD_RESERVE_PER_CITIZEN * Math.max(1, ctx.livingCount)))
    const hunger = 1 - c.needs.satiety / 100
    demand = MIN_DEMAND + (1 - MIN_DEMAND) * Math.max(shortage, hunger)
  } else {
    demand = MIN_DEMAND + (1 - MIN_DEMAND) * (1 - Math.min(1, stock.wood / WOOD_TARGET))
  }

  const action = kind === 'berries' ? 'forage' : 'chop'
  const role = ROLE_WEIGHTS[c.role][action] ?? 1
  const diligence = 0.8 + 0.4 * c.personality.diligence
  const night = ctx.night ? NIGHT_WORK_FACTOR : 1
  return clamp01(WORK_BASE * role * diligence * demand * distanceFactor(target.steps) * (1 - 0.5 * fullness) * night)
}

function startGather(ctx: DecisionContext, kind: ResourceKind): boolean {
  const target = kind === 'berries' ? ctx.berries : ctx.wood
  if (!target) return false
  return beginTask(ctx.state, ctx.citizen, kind === 'berries' ? 'forage' : 'chop', target.tile)
}

export const scoreForage = (ctx: DecisionContext) => scoreGather(ctx, 'berries')
export const startForage = (ctx: DecisionContext) => startGather(ctx, 'berries')
export const scoreChop = (ctx: DecisionContext) => scoreGather(ctx, 'wood')
export const startChop = (ctx: DecisionContext) => startGather(ctx, 'wood')
