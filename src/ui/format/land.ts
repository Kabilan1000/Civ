// Land & ecology presentation (M10d). Pure, testable helpers that turn the
// real records into short comparisons. They describe what changed together;
// they never name a single cause.

import type { EcoDay, HistorySample } from '../../sim/index.ts'
import { TICKS_PER_DAY } from '../../sim/index.ts'

export interface Change {
  before: number
  after: number
}

/**
 * Mean of the last `n` days vs the `n` days before them, skipping missing
 * values (null). Null when either half has fewer than ⌈n/2⌉ real values.
 */
export function windowChange(values: readonly (number | null)[], n: number): Change | null {
  const after = values.slice(-n).filter((v): v is number => v !== null)
  const before = values.slice(-2 * n, -n).filter((v): v is number => v !== null)
  const need = Math.ceil(n / 2)
  if (after.length < need || before.length < need) return null
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return { before: mean(before), after: mean(after) }
}

export type Direction = 'improving' | 'deteriorating' | 'mixed' | 'steady' | 'unknown'

export interface ForageTrend {
  direction: Direction
  /** Ripe berries on bearing bushes near the campfire, bearing bushes there, and steps per forage trip. */
  berries: Change | null
  bushes: Change | null
  steps: Change | null
}

/** +1 better, −1 worse, 0 no meaningful change, null unknown. */
function signal(c: Change | null, minAbs: number, minRel: number, higherIsBetter: boolean): number | null {
  if (!c) return null
  const delta = c.after - c.before
  if (Math.abs(delta) < Math.max(minAbs, minRel * Math.abs(c.before))) return 0
  return (delta > 0) === higherIsBetter ? 1 : -1
}

/**
 * Is forage near the settlement getting better or worse? Compares the last
 * `n` days with the `n` before on three real measures: berries on nearby
 * bushes (≥ 3 berries and 15% to count), nearby bearing bushes (≥ 2 and
 * 15%) and steps per forage trip (≥ 0.5 steps and 10%; fewer is better).
 * Measures that disagree give "mixed"; none that moved give "steady".
 */
export function forageTrend(days: readonly EcoDay[], n = 5): ForageTrend {
  const berries = windowChange(days.map((d) => d.nearBerries), n)
  const bushes = windowChange(days.map((d) => d.nearBushes), n)
  const steps = windowChange(days.map((d) => d.tripSteps), n)
  const signals = [signal(berries, 3, 0.15, true), signal(bushes, 2, 0.15, true), signal(steps, 0.5, 0.1, false)].filter(
    (s): s is number => s !== null,
  )
  const up = signals.some((s) => s > 0)
  const down = signals.some((s) => s < 0)
  const direction: Direction = signals.length === 0 ? 'unknown' : up && down ? 'mixed' : up ? 'improving' : down ? 'deteriorating' : 'steady'
  return { direction, berries, bushes, steps }
}

export interface VillageChange {
  days: number
  people: Change
  /** Births and deaths in the span; null if the older sample predates those fields. */
  births: number | null
  deaths: number | null
  /** Stockpile food per living person at both ends (null with nobody alive). */
  foodPerPerson: { before: number | null; after: number | null }
}

/** Population and food over the last `days` days, from the real recent samples. Null without a sample that old. */
export function villageChange(history: readonly HistorySample[], days: number): VillageChange | null {
  const now = history.at(-1)
  if (!now) return null
  const target = now.tick - days * TICKS_PER_DAY
  let then: HistorySample | undefined
  for (const h of history) if (h.tick <= target) then = h
  if (!then) return null
  const per = (h: HistorySample) => (h.population > 0 ? h.food / h.population : null)
  const has = then.births !== undefined && now.births !== undefined
  return {
    days: (now.tick - then.tick) / TICKS_PER_DAY,
    people: { before: then.population, after: now.population },
    births: has ? now.births! - then.births! : null,
    deaths: has ? now.deaths! - then.deaths! : null,
    foodPerPerson: { before: per(then), after: per(now) },
  }
}

/** Sum of a per-day figure over the last `n` days (missing days skipped); null if none are known. */
export function recentTotal(values: readonly (number | null)[], n: number): number | null {
  const known = values.slice(-n).filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

/** "41 → 44", "3.2 → 2.9" — one decimal below 10, whole numbers above. */
export function arrow(c: Change): string {
  const f = (v: number) => (Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)))
  return `${f(c.before)} → ${f(c.after)}`
}
