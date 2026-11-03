// Resource regrowth: every BERRY_REGROW_INTERVAL ticks each berry bush below
// max regrows one unit; trees every TREE_REGROW_INTERVAL. Stateless timing
// (tick modulo interval), counted in the ledger, bumps map.version on change.

import { BERRY_REGROW_INTERVAL, TREE_REGROW_INTERVAL } from '../constants.ts'
import type { ResourceKind, WorldState } from '../types.ts'

function regrow(state: WorldState, kind: ResourceKind): number {
  let grown = 0
  for (const node of state.map.resources) {
    if (node && node.kind === kind && node.amount < node.max) {
      node.amount++
      grown++
    }
  }
  return grown
}

export function regrowResources(state: WorldState): void {
  let changed = 0
  if (state.tick % BERRY_REGROW_INTERVAL === 0) {
    const n = regrow(state, 'berries')
    state.ledger.foodRegrown += n
    changed += n
  }
  if (state.tick % TREE_REGROW_INTERVAL === 0) {
    const n = regrow(state, 'wood')
    state.ledger.woodRegrown += n
    changed += n
  }
  if (changed > 0) state.map.version++
}
