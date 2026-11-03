// Task executor: advances each citizen's current task by one tick.
//
// wander phases:
//   moveTo  follow the path; on arrival → linger; if blocked → task ends
//   linger  wait `ticksLeft` ticks, then the task ends
// A finished task clears the path and makes the citizen decide next tick.

import { WANDER_PAUSE_MAX, WANDER_PAUSE_MIN } from '../constants.ts'
import { nextInt } from '../rng.ts'
import type { Citizen, WorldState } from '../types.ts'
import { advanceMovement, clearPath } from './movement.ts'

export function endTask(state: WorldState, c: Citizen): void {
  c.task = null
  clearPath(c)
  c.nextDecisionTick = state.tick + 1
}

export function advanceTasks(state: WorldState): void {
  for (const c of state.citizens) {
    const task = c.task
    if (!c.alive || task === null) continue

    switch (task.phase) {
      case 'moveTo': {
        const result = advanceMovement(state.map, c)
        if (result === 'arrived') {
          task.phase = 'linger'
          task.ticksLeft = nextInt(state.rng, WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
        } else if (result !== 'moving') {
          endTask(state, c)
        }
        break
      }
      case 'linger':
        task.ticksLeft--
        if (task.ticksLeft <= 0) endTask(state, c)
        break
      default:
        endTask(state, c) // unknown phase: fail safe
    }
  }
}
