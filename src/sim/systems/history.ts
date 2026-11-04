// History system: records a genuine village snapshot at tick 0 (createWorld)
// and whenever a step lands on a multiple of HISTORY_INTERVAL. Runs last in
// step(), so a sample describes the state at the END of that tick. Bounded
// at HISTORY_MAX samples; the oldest are dropped. Nothing is ever back-filled
// or interpolated — a migrated save starts with an empty history.

import { ECO_HISTORY_MAX, GENERATIONS_MAX, HISTORY_INTERVAL, HISTORY_MAX, SHELTER_CAPACITY, TICKS_PER_DAY, TICKS_PER_SEASON } from '../constants.ts'
import { ecoCensus } from '../ecology/census.ts'
import { isSeasonStart } from '../calendar.ts'
import { countStages } from '../selectors.ts'
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
    ...countStages(state, living),
    births: state.population.counters.births,
    deaths: state.population.counters.deaths,
  }
}

export function recordSample(state: WorldState): void {
  state.history.push(takeSample(state))
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX)
}

export function recordHistory(state: WorldState): void {
  if (state.tick % HISTORY_INTERVAL === 0) recordSample(state)
  if (state.tick % TICKS_PER_DAY === 0) recordEcoSample(state)
  if (isSeasonStart(state.tick)) recordGeneration(state)
}

/** Daily ecology census (schema v13), at each dawn after every system has run. Bounded at ECO_HISTORY_MAX. */
export function recordEcoSample(state: WorldState): void {
  state.ecoHistory.push(ecoCensus(state))
  if (state.ecoHistory.length > ECO_HISTORY_MAX) state.ecoHistory.splice(0, state.ecoHistory.length - ECO_HISTORY_MAX)
}

/**
 * Long-term history (schema v11): at the first tick of each season, a compact
 * summary of the season that just ended — real end-of-season state plus its
 * peak and low from that season's recent samples. Bounded at GENERATIONS_MAX.
 */
export function recordGeneration(state: WorldState): void {
  const since = state.tick - TICKS_PER_SEASON
  const season = state.history.filter((h) => h.tick > since && h.tick <= state.tick).map((h) => h.population)
  const now = state.history.at(-1)!
  const eco = state.ecoHistory.at(-1)! // season starts are dawns: taken this same tick
  state.generations.push({
    tick: state.tick,
    population: now.population,
    children: now.children ?? 0,
    adults: now.adults ?? 0,
    elders: now.elders ?? 0,
    peak: Math.max(...season),
    low: Math.min(...season),
    housed: now.housed,
    capacity: now.capacity,
    food: now.food,
    births: state.population.counters.births,
    deaths: state.population.counters.deaths,
    bearing: eco.bearing,
    nearBushes: eco.nearBushes,
    held: eco.held,
  })
  if (state.generations.length > GENERATIONS_MAX) state.generations.splice(0, state.generations.length - GENERATIONS_MAX)
}
