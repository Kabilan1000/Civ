// Ages, life stages and kinship (Population V1, TDS §8). Pure helpers.

import { ADULT_AGE, DAYS_PER_YEAR, ELDER_AGE, MAX_AGE, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants.ts'
import type { Citizen } from '../types.ts'

export type LifeStage = 'child' | 'adult' | 'elder'

/** Whole world years since birth (a world year is 48 days). */
export function ageYears(c: Pick<Citizen, 'bornTick'>, tick: number): number {
  return Math.floor((tick - c.bornTick) / TICKS_PER_YEAR)
}

export function lifeStageAt(age: number): LifeStage {
  return age < ADULT_AGE ? 'child' : age < ELDER_AGE ? 'adult' : 'elder'
}

export function lifeStage(c: Pick<Citizen, 'bornTick'>, tick: number): LifeStage {
  return lifeStageAt(ageYears(c, tick))
}

export const isChild = (c: Pick<Citizen, 'bornTick'>, tick: number) => ageYears(c, tick) < ADULT_AGE

/** True on the dawn that starts a new year of this citizen's life (not at birth). */
export function isBirthday(c: Pick<Citizen, 'bornTick'>, tick: number): boolean {
  const days = Math.floor((tick - c.bornTick) / TICKS_PER_DAY)
  return tick % TICKS_PER_DAY === 0 && days > 0 && days % DAYS_PER_YEAR === 0
}

/**
 * Old-age hazard (‰) rolled on each birthday from ELDER_AGE:
 * floor(1000·k²/256) with k = age − (ELDER_AGE − 1), certain from MAX_AGE.
 * 3‰ at 50, 140‰ at 55, 472‰ at 60, 1000‰ at 65. Integer arithmetic only.
 */
export function oldAgeHazardPermille(age: number): number {
  if (age < ELDER_AGE) return 0
  if (age >= MAX_AGE) return 1000
  const k = age - (ELDER_AGE - 1)
  return Math.min(1000, Math.floor((1000 * k * k) / 256))
}

/** Parent, child or sibling (sharing a parent). Kin never partner. */
export function areKin(a: Pick<Citizen, 'id' | 'parentIds'>, b: Pick<Citizen, 'id' | 'parentIds'>): boolean {
  if (a.parentIds?.includes(b.id) || b.parentIds?.includes(a.id)) return true
  return !!a.parentIds && !!b.parentIds && a.parentIds.some((p) => b.parentIds!.includes(p))
}
