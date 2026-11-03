// Needs system: deterministic per-tick decay and recovery, clamped to 0..100.
// Rates live in constants.ts (see the "Needs" section for the daily balance).
//
//   satiety  −SATIETY_DECAY every tick; restored only by eating
//   energy   ENERGY_RATES[activity]: idle/walking/working drain, sleeping refills
//   social   −SOCIAL_DECAY, or +SOCIAL_RECOVERY while someone is within SOCIAL_RADIUS
//   health   falls while starving (satiety 0) or exhausted (energy 0), scaled
//            down by resilience; recovers slowly while fed and rested.
//            No death yet (M5).

import {
  ENERGY_RATES,
  EXHAUSTED_HEALTH_LOSS,
  HEALTH_RECOVERY,
  HEALTH_RECOVERY_MIN_ENERGY,
  HEALTH_RECOVERY_MIN_SATIETY,
  HEALTH_RESILIENCE_FACTOR,
  SATIETY_DECAY,
  SOCIAL_DECAY,
  SOCIAL_RADIUS,
  SOCIAL_RECOVERY,
  STARVING_HEALTH_LOSS,
  type Activity,
} from '../constants.ts'
import { manhattan } from '../grid.ts'
import type { Citizen, WorldState } from '../types.ts'

export const clampNeed = (x: number) => (x < 0 ? 0 : x > 100 ? 100 : x)

/** What the citizen's current task phase means for energy use. */
export function activityOf(c: Citizen): Activity {
  const t = c.task
  if (!t) return 'idle'
  if (t.phase === 'sleep') return 'resting'
  if (t.phase === 'gather') return 'working'
  if (c.pathIndex < c.path.length) return 'walking'
  return 'idle'
}

export function updateNeeds(state: WorldState): void {
  const living = state.citizens.filter((c) => c.alive)
  for (const c of living) {
    const n = c.needs
    n.satiety = clampNeed(n.satiety - SATIETY_DECAY)
    n.energy = clampNeed(n.energy + ENERGY_RATES[activityOf(c)])

    const company = living.some((o) => o !== c && manhattan(o.pos, c.pos) <= SOCIAL_RADIUS)
    n.social = clampNeed(n.social + (company ? SOCIAL_RECOVERY : -SOCIAL_DECAY))

    const toughness = 1 - HEALTH_RESILIENCE_FACTOR * c.personality.resilience
    let dh = 0
    if (n.satiety <= 0) dh -= STARVING_HEALTH_LOSS * toughness
    if (n.energy <= 0) dh -= EXHAUSTED_HEALTH_LOSS * toughness
    if (dh === 0 && n.satiety >= HEALTH_RECOVERY_MIN_SATIETY && n.energy >= HEALTH_RECOVERY_MIN_ENERGY) {
      dh = HEALTH_RECOVERY
    }
    n.health = clampNeed(n.health + dh)
  }
}
