// Rest: walk to a spot near the campfire and sleep until REST_STOP_ENERGY.
// With no reachable camp, sleep where you stand.

import { CRITICAL_ENERGY, ENERGY_RATES, NIGHT_REST_BONUS, REST_STOP_ENERGY } from '../../constants.ts'
import { hasFoodAccess } from './eat.ts'

/** Below this satiety, eat before going to bed (unless exhausted). */
const EAT_BEFORE_BED_SATIETY = 40
const EAT_FIRST_FACTOR = 0.6

/** Average ticks per step used to estimate the walk to bed. */
const TICKS_PER_STEP_ESTIMATE = 2.5
/** The walk estimate never adds more than this much tiredness. */
const MAX_WALK_ALLOWANCE = 15
import { clamp01, rising } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { enterArrivalPhase } from '../phases.ts'
import { beginTask } from '../travel.ts'

export function scoreRest(ctx: DecisionContext): number {
  const energy = ctx.citizen.needs.energy
  if (energy >= 90) return 0
  // Judge tiredness by the energy left on arrival at the bed, so a far-off
  // worker heads home in time.
  const walk = Math.min(MAX_WALK_ALLOWANCE, (ctx.restSpot?.steps ?? 0) * TICKS_PER_STEP_ESTIMATE * -ENERGY_RATES.walking)
  const tired = Math.min(1, 1 - (energy - walk) / 100)
  const night = ctx.night ? NIGHT_REST_BONUS * Math.min(1, tired / 0.4) : 0
  // Full urgency at 30% energy, leaving reserve for the walk home.
  const score = clamp01(rising(tired, 0.1, 0.7) + night)
  // Sleeping hungry means waking up starving: eat first if food is available.
  const c = ctx.citizen
  const eatFirst = c.needs.satiety < EAT_BEFORE_BED_SATIETY && c.needs.energy >= CRITICAL_ENERGY && hasFoodAccess(ctx)
  return eatFirst ? score * EAT_FIRST_FACTOR : score
}

export function startRest(ctx: DecisionContext): boolean {
  const { state, citizen: c } = ctx
  if (c.needs.energy >= REST_STOP_ENERGY) return false
  if (ctx.restSpot && beginTask(state, c, 'rest', ctx.restSpot.tile)) return true
  c.task = { kind: 'rest', phase: 'sleep', targetTile: ctx.here, targetId: null, ticksLeft: 0, startedTick: state.tick }
  enterArrivalPhase(state, c)
  return true
}
