// Ages, life stages and kinship (Population V1, TDS §8). Pure helpers.
//
// Life-stage ages come from the world's own DemographicProfile
// (state.population.profile, schema v10): new worlds use the accelerated
// profile, saves from before it keep the classic one they were simulated
// under. The calendar itself (48-day years) is the same for both.

import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants.ts'
import type { Citizen, DemographicProfile, WorldState } from '../types.ts'

export type LifeStage = 'child' | 'adult' | 'elder'

/** Whole world years since birth (a world year is 48 days). */
export function ageYears(c: Pick<Citizen, 'bornTick'>, tick: number): number {
  return Math.floor((tick - c.bornTick) / TICKS_PER_YEAR)
}

export function lifeStageAt(age: number, profile: DemographicProfile): LifeStage {
  return age < profile.adultAge ? 'child' : age < profile.elderAge ? 'adult' : 'elder'
}

/** A citizen's life stage in their world. */
export function lifeStage(state: Pick<WorldState, 'tick' | 'population'>, c: Pick<Citizen, 'bornTick'>): LifeStage {
  return lifeStageAt(ageYears(c, state.tick), state.population.profile)
}

export const isChild = (state: Pick<WorldState, 'tick' | 'population'>, c: Pick<Citizen, 'bornTick'>) =>
  ageYears(c, state.tick) < state.population.profile.adultAge

/** True on the dawn that starts a new year of this citizen's life (not at birth). */
export function isBirthday(c: Pick<Citizen, 'bornTick'>, tick: number): boolean {
  const days = Math.floor((tick - c.bornTick) / TICKS_PER_DAY)
  return tick % TICKS_PER_DAY === 0 && days > 0 && days % DAYS_PER_YEAR === 0
}

/**
 * Old-age hazard (‰) rolled on each birthday from the profile's elder age:
 * floor(1000·k²/span²), k = age − elderAge + 1, span = maxAge − elderAge + 1,
 * so deaths rise gradually through old age and are certain at maxAge.
 * Classic (50–65): 3‰ at 50, 140‰ at 55, 472‰ at 60. Fast (15–22): 15‰ at
 * 15, 140‰ at 17, 390‰ at 19, 765‰ at 21. Integer arithmetic only.
 */
export function oldAgeHazardPermille(age: number, profile: DemographicProfile): number {
  if (age < profile.elderAge) return 0
  if (age >= profile.maxAge) return 1000
  const span = profile.maxAge - profile.elderAge + 1
  const k = age - profile.elderAge + 1
  return Math.min(1000, Math.floor((1000 * k * k) / (span * span)))
}

/** Parent, child or sibling (sharing a parent). Kin never partner. */
export function areKin(a: Pick<Citizen, 'id' | 'parentIds'>, b: Pick<Citizen, 'id' | 'parentIds'>): boolean {
  if (a.parentIds?.includes(b.id) || b.parentIds?.includes(a.id)) return true
  return !!a.parentIds && !!b.parentIds && a.parentIds.some((p) => b.parentIds!.includes(p))
}
