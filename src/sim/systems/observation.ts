// Observation (schema v9): who keeps which land fresh. Runs after act (so it
// sees where citizens actually stand) every OBSERVE_INTERVAL ticks:
//   • every living citizen observes CITIZEN_SIGHT_RADIUS around them;
//   • the inhabited settlement stays in view — the campfire (while anyone
//     lives) and every occupied shelter;
// Explorers' surveys (systems/tasks.ts) refresh their whole reveal radius.
// Observation only updates map.lastSeen: it never discovers land, moves
// anyone or changes the map's version.

import { CAMP_SIGHT_RADIUS, CITIZEN_SIGHT_RADIUS, OBSERVE_INTERVAL, SHELTER_SIGHT_RADIUS } from '../constants.ts'
import { observeAround } from '../map/visibility.ts'
import type { WorldState } from '../types.ts'

export function updateObservation(state: WorldState): void {
  if (state.tick % OBSERVE_INTERVAL !== 0) return
  const { map, tick } = state
  let anyoneAlive = false
  for (const c of state.citizens) {
    if (!c.alive) continue
    anyoneAlive = true
    observeAround(map, c.pos.y * map.width + c.pos.x, CITIZEN_SIGHT_RADIUS, tick)
  }
  if (!anyoneAlive) return
  for (const s of state.structures) {
    if (s.kind === 'campfire') observeAround(map, s.tile, CAMP_SIGHT_RADIUS, tick)
    else if (s.stage === 'complete' && s.residentIds.length > 0) observeAround(map, s.tile, SHELTER_SIGHT_RADIUS, tick)
  }
}
