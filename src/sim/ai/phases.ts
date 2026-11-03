// What each task does once it reaches its target tile.
//   forage / chop → 'gather'   one unit per GATHER_TICKS
//   deliver       → 'deposit'  hand everything to the stockpile
//   eat           → 'eat'      one unit per EAT_TICKS
//   rest          → 'sleep'    until REST_STOP_ENERGY
//   build         → 'fetch' (at camp) | 'supply' (carrying wood) | 'construct'
//   wander        → 'linger'   WANDER_PAUSE_MIN..MAX ticks

import { EAT_TICKS, GATHER_TICKS, WANDER_PAUSE_MAX, WANDER_PAUSE_MIN } from '../constants.ts'
import { nextInt } from '../rng.ts'
import { getCampfire } from '../structures.ts'
import type { Citizen, WorldState } from '../types.ts'

export function enterArrivalPhase(state: WorldState, c: Citizen): void {
  const task = c.task
  if (!task) return
  switch (task.kind) {
    case 'forage':
      task.phase = 'gather'
      task.ticksLeft = GATHER_TICKS.berries
      break
    case 'chop':
      task.phase = 'gather'
      task.ticksLeft = GATHER_TICKS.wood
      break
    case 'deliver':
      task.phase = 'deposit'
      task.ticksLeft = 0
      break
    case 'eat':
      task.phase = 'eat'
      task.ticksLeft = EAT_TICKS
      break
    case 'rest':
      task.phase = 'sleep'
      task.ticksLeft = 0
      break
    case 'build':
      task.ticksLeft = 0
      if (task.targetTile === getCampfire(state)?.tile && c.carrying?.kind !== 'wood') task.phase = 'fetch'
      else if (c.carrying?.kind === 'wood') task.phase = 'supply'
      else task.phase = 'construct'
      break
    default:
      task.phase = 'linger'
      task.ticksLeft = nextInt(state.rng, WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
  }
}
