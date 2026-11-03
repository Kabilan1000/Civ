// Rest: walk to a spot near the campfire and sleep until REST_STOP_ENERGY.
// With no reachable camp, sleep where you stand.

import { NIGHT_REST_BONUS, REST_STOP_ENERGY } from '../../constants.ts'
import { clamp01, rising } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { enterArrivalPhase } from '../phases.ts'
import { beginTask } from '../travel.ts'

export function scoreRest(ctx: DecisionContext): number {
  const energy = ctx.citizen.needs.energy
  if (energy >= 90) return 0
  const tired = 1 - energy / 100
  const night = ctx.night ? NIGHT_REST_BONUS * Math.min(1, tired / 0.4) : 0
  return clamp01(rising(tired, 0.1, 0.8) + night)
}

export function startRest(ctx: DecisionContext): boolean {
  const { state, citizen: c } = ctx
  if (c.needs.energy >= REST_STOP_ENERGY) return false
  if (ctx.restSpot && beginTask(state, c, 'rest', ctx.restSpot.tile)) return true
  c.task = { kind: 'rest', phase: 'sleep', targetTile: ctx.here, targetId: null, ticksLeft: 0, startedTick: state.tick }
  enterArrivalPhase(state, c)
  return true
}
