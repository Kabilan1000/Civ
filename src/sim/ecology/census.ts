// Ecology census (M10d, observability only). One pure function computes the
// figures for both the daily record (state.ecoHistory, schema v13) and the
// live dashboard, so what the player sees always matches what is stored.
// Reads state; never writes it and never draws randomness.

import { NEAR_CAMP_TILES } from '../constants.ts'
import { freshnessOf } from '../map/visibility.ts'
import { getCampfire } from '../structures.ts'
import type { EcoSample, StageCounts, WorldState } from '../types.ts'

const stages = (): StageCounts => ({ seedling: 0, young: 0, mature: 0, old: 0 })

export function ecoCensus(state: WorldState): EcoSample {
  const { map, tick } = state
  const bushes = stages()
  const trees = stages()
  let deadwood = 0
  let deadwoodWood = 0
  let berries = 0
  let bearing = 0
  let nearBushes = 0
  let nearBerries = 0
  let nearCapacity = 0
  let recent = 0
  let fading = 0
  let stale = 0
  const camp = getCampfire(state)?.tile ?? -1
  const cx = camp % map.width
  const cy = Math.floor(camp / map.width)
  for (let i = 0; i < map.resources.length; i++) {
    const known = map.discovered[i] === 1
    if (known) {
      const f = freshnessOf(1, map.lastSeen[i]!, tick)
      if (f <= 1) recent++
      else if (f === 5) stale++
      else fading++
    }
    const r = map.resources[i]
    if (!r) continue
    if (r.stage === 'dead') {
      deadwood++
      deadwoodWood += r.amount
      continue
    }
    ;(r.kind === 'berries' ? bushes : trees)[r.stage]++
    if (r.kind !== 'berries') continue
    berries += r.amount
    if (r.stage === 'seedling' || !known) continue
    bearing++
    if (camp >= 0 && Math.abs((i % map.width) - cx) + Math.abs(Math.floor(i / map.width) - cy) <= NEAR_CAMP_TILES) {
      nearBushes++
      nearBerries += r.amount
      nearCapacity += r.max
    }
  }
  const c = state.ecology.counters
  const a = state.activity
  return {
    tick,
    bushes,
    trees,
    deadwood,
    deadwoodWood,
    berries,
    bearing,
    nearBushes,
    nearBerries,
    nearCapacity,
    population: state.citizens.reduce((n, x) => n + (x.alive ? 1 : 0), 0),
    recent,
    fading,
    stale,
    plantBirths: { berries: c.births.berries, wood: c.births.wood },
    plantDeaths: { berries: c.deaths.berries, wood: c.deaths.wood },
    gathered: state.ledger.foodGathered,
    regrown: state.ledger.foodRegrown,
    decayed: state.ledger.foodDecayed,
    forageTrips: a.forageTrips,
    forageSteps: a.forageSteps,
    resurveys: a.resurveys,
    held: a.birthsHeldByLand,
  }
}
