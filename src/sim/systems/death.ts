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
//   • Living citizens within WITNESS_RADIUS remember seeing it ('sawDeath').
//   • Others' relationship records with the dead are kept (history); the
//     dead can never be chosen for, or take part in, a new interaction.
// Cause (needs): 'starvation' if satiety is 0, otherwise 'exhaustion'.
// Cause 'oldAge': the birthday hazard in systems/lifecycle.ts (Population V1).

import { WITNESS_RADIUS } from '../constants.ts'
import { ageYears } from '../citizens/life.ts'
import { remember } from '../citizens/memory.ts'
import { pushEvent } from '../events.ts'
import { manhattan } from '../grid.ts'
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
  // The partner is free to partner again; the dead keep partnerId as history.
  if (c.partnerId !== null) {
    const partner = state.citizens.find((o) => o.id === c.partnerId)
    if (partner && partner.partnerId === c.id) partner.partnerId = null
  }
  state.population.counters.deaths++
  pushEvent(state, 'died', [c.id], { cause, day: dayNumberAt(state.tick), age: ageYears(c, state.tick) })
  for (const o of state.citizens) {
    if (o.alive && manhattan(o.pos, c.pos) <= WITNESS_RADIUS) remember(state, o, 'sawDeath', -0.8, { subjectId: c.id })
  }
  assignHomes(state)
}
