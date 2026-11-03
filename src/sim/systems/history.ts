// History system: records a genuine village snapshot at tick 0 (createWorld)
// and whenever a step lands on a multiple of HISTORY_INTERVAL. Runs last in
// step(), so a sample describes the state at the END of that tick. Bounded
// at HISTORY_MAX samples; the oldest are dropped. Nothing is ever back-filled
// or interpolated — a migrated save starts with an empty history.

import { HISTORY_INTERVAL, HISTORY_MAX, SHELTER_CAPACITY } from '../constants.ts'
import type { HistorySample, WorldState } from '../types.ts'

export function takeSample(state: WorldState): HistorySample {
  const living = state.citizens.filter((c) => c.alive)
  const n = living.length
  const avg = (k: 'satiety' | 'energy' | 'health' | 'social') =>
    n === 0 ? 0 : Math.round(living.reduce((sum, c) => sum + c.needs[k], 0) / n)
  const complete = state.structures.filter((s) => s.kind === 'shelter' && s.stage === 'complete')
  return {
    tick: state.tick,
    population: n,
    food: state.stockpile.food,
    wood: state.stockpile.wood,
    housed: living.filter((c) => c.homeId !== null).length,
    capacity: complete.length * SHELTER_CAPACITY,
    discovered: state.map.discovered.reduce<number>((sum, d) => sum + d, 0),
    satiety: avg('satiety'),
    energy: avg('energy'),
    health: avg('health'),
    social: avg('social'),
  }
}

export function recordSample(state: WorldState): void {
  state.history.push(takeSample(state))
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX)
}

export function recordHistory(state: WorldState): void {
  if (state.tick % HISTORY_INTERVAL === 0) recordSample(state)
}
