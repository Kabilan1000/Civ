// Decision system: citizens without a task whose decision is due pick one.
// M3: wandering only. M4 replaces this with utility scoring.

import { startWander } from '../ai/actions/wander.ts'
import { WANDER_RETRY_TICKS } from '../constants.ts'
import type { WorldState } from '../types.ts'

export function decide(state: WorldState): void {
  for (const c of state.citizens) {
    if (!c.alive || c.task !== null || state.tick < c.nextDecisionTick) continue
    if (!startWander(state, c)) c.nextDecisionTick = state.tick + WANDER_RETRY_TICKS
  }
}
