// Long-term (Generations) history presentation (schema v11). Pure, testable.
// A summary taken at a season-start tick describes the season that just
// ended, so labels use tick − 1.

import { seasonAt, yearAt } from '../../sim/index.ts'
import { SEASON_LABELS } from './calendar.ts'

/** "Summer, Year 3" — the season a summary covers. */
export function generationLabel(tick: number): string {
  return `${SEASON_LABELS[seasonAt(tick - 1)]}, Year ${yearAt(tick - 1)}`
}

/** Axis label: "Year 3". */
export function generationYear(tick: number): string {
  return `Year ${yearAt(tick - 1)}`
}

export interface PopulationMarks {
  /** Index of the highest population (first occurrence), if any data. */
  peak: { at: number; value: number } | null
  /** The largest fall from an earlier high to a later low, if it is meaningful. */
  decline: { from: number; to: number; high: number; low: number } | null
}

/**
 * Major peak and decline in a population series. A decline counts only if it
 * loses at least `minDrop` people and 10% of its starting high — routine
 * season-to-season wobble is not a "decline".
 */
export function populationMarks(population: readonly number[], minDrop = 3): PopulationMarks {
  if (population.length === 0) return { peak: null, decline: null }
  let peak = 0
  for (let i = 1; i < population.length; i++) if (population[i]! > population[peak]!) peak = i
  let hi = 0
  let best: PopulationMarks['decline'] = null
  for (let i = 1; i < population.length; i++) {
    if (population[i]! > population[hi]!) hi = i
    const drop = population[hi]! - population[i]!
    if (drop >= minDrop && drop * 10 >= population[hi]! && (!best || drop > best.high - best.low)) best = { from: hi, to: i, high: population[hi]!, low: population[i]! }
  }
  return { peak: { at: peak, value: population[peak]! }, decline: best }
}
