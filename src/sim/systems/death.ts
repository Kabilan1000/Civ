// Death. A citizen dies when health reaches 0 (checked by the needs system).
//
// Rules on death (all deterministic):
//   • alive = false, diedTick and deathCause recorded; the citizen stays in
//     `state.citizens` (serialized) but no system moves, feeds or schedules it.
//   • Task and path are cleared, so any reservation they implied (resource
//     node, construction site, worker slot) is released immediately.
//   • Carried goods perish with them and are counted in ledger.foodLost /
//     woodLost (conservation still balances).
//   • Their home slot is released and re-filled by assignHomes.
//   • A 'died' event records who, the cause and the day.
// Cause: 'starvation' if satiety is 0, otherwise 'exhaustion'.

import { pushEvent } from '../events.ts'
import type { Citizen, DeathCause, WorldState } from '../types.ts'
import { assignHomes } from './construction.ts'
import { clearPath } from './movement.ts'
import { dayNumberAt } from './time.ts'

export function killCitizen(state: WorldState, c: Citizen, cause: DeathCause): void {
  if (!c.alive) return
  c.alive = false
  c.diedTick = state.tick
  c.deathCause = cause
  c.task = null
  clearPath(c)
  c.lastScores = []
  if (c.carrying) {
    if (c.carrying.kind === 'berries') state.ledger.foodLost += c.carrying.amount
    else state.ledger.woodLost += c.carrying.amount
    c.carrying = null
  }
  for (const s of state.structures) s.residentIds = s.residentIds.filter((id) => id !== c.id)
  c.homeId = null
  pushEvent(state, 'died', [c.id], { cause, day: dayNumberAt(state.tick) })
  assignHomes(state)
}
