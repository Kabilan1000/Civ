// Workforce roles (explorer staffing fix). Small and deterministic:
//
//   • Staffing counts only citizens who can do the work: ADULTS (not
//     children, who don't work, and not elders, who no longer explore).
//   • A newborn's role is provisional (shown as "will work as"); the real
//     choice is made when they come of age, from the adult workforce then.
//   • If a village has no adult explorer, one adult forager or builder —
//     the most curious whose departure leaves food gathering and
//     construction staffed — becomes the explorer. This happens only while
//     there are none, so nobody is switched back and forth.
// No citizen is created or removed; only `role` changes.

import { MAX_EXPLORERS, MIN_BUILDERS, MIN_FORAGER_SHARE_PERMILLE } from '../constants.ts'
import type { Citizen, Role, WorldState } from '../types.ts'
import { lifeStage } from './life.ts'

const adults = (state: WorldState) => state.citizens.filter((c) => c.alive && lifeStage(c, state.tick) === 'adult')

/** Living adults by role (children and elders excluded). */
export function adultRoles(state: WorldState, except?: Citizen): Record<Role, number> {
  const count: Record<Role, number> = { forager: 0, builder: 0, explorer: 0 }
  for (const c of adults(state)) if (c !== except) count[c.role]++
  return count
}

/** Foragers a workforce of `n` adults keeps (food first): at least 2, and a quarter of it. */
export function minForagers(n: number): number {
  return Math.max(2, Math.ceil((n * MIN_FORAGER_SHARE_PERMILLE) / 1000))
}

/** The less staffed of forager/builder (ties: forager — food first). */
function neededWorker(count: Record<Role, number>): Role {
  return count.builder < count.forager ? 'builder' : 'forager'
}

/** Role for a newborn (provisional until coming of age), from the adult workforce now. */
export function provisionalRole(state: WorldState): Role {
  const count = adultRoles(state)
  return count.explorer < 1 ? 'explorer' : neededWorker(count)
}

/**
 * Role for a citizen coming of age, from the adult workforce they join: an
 * explorer if there is none (or the curious may make a second, up to
 * MAX_EXPLORERS), otherwise whichever of foraging and building has fewer hands.
 */
export function roleAtAdulthood(state: WorldState, c: Citizen): Role {
  const count = adultRoles(state, c)
  if (count.explorer === 0) return 'explorer'
  if (count.explorer < MAX_EXPLORERS && c.personality.curiosity >= SECOND_EXPLORER_CURIOSITY) return 'explorer'
  return neededWorker(count)
}
const SECOND_EXPLORER_CURIOSITY = 0.6

/**
 * With no adult explorer, the most curious adult forager or builder whose
 * move keeps foraging and building staffed becomes one (ties: lower id).
 * Returns the citizen, or null if nobody can be spared or one already exists.
 */
export function chooseReplacementExplorer(state: WorldState): Citizen | null {
  const pool = adults(state)
  const count = adultRoles(state)
  if (count.explorer > 0) return null
  const n = pool.length
  const canSpare = (role: Role) =>
    role === 'forager' ? count.forager - 1 >= minForagers(n) : role === 'builder' ? count.builder - 1 >= MIN_BUILDERS : false
  let best: Citizen | null = null
  for (const c of pool) {
    if (!canSpare(c.role)) continue
    if (!best || c.personality.curiosity > best.personality.curiosity || (c.personality.curiosity === best.personality.curiosity && c.id < best.id)) best = c
  }
  return best
}
