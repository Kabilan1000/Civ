// Construction & housing system (runs every tick, after resources).
//
// Planning: every PLAN_INTERVAL ticks, if there is a housing deficit and no
// unfinished shelter, the village plans ONE new shelter on the best valid
// site (structures.chooseSite). One open site at a time keeps builders
// focused and makes double-booking impossible.
//
// Stages: planned → (all wood delivered) underConstruction → (buildProgress
// reaches buildCost) complete. Wood moves stockpile → carried → site; it is
// never duplicated: a builder only fetches what the site still needs after
// counting wood already in transit.
//
// Abandonment: a site with no delivery or labour for SITE_ABANDON_TICKS is
// removed and its delivered wood refunded to the stockpile. Planning resumes
// later (possibly elsewhere). Builder tasks referencing it simply end.
//
// Housing: completed shelters hold SHELTER_CAPACITY residents. assignHomes
// keeps existing living residents in place and fills free slots with
// homeless living citizens in ascending id order, shelters in ascending id
// order — deterministic and stable (nobody moves without reason).

import {
  PLAN_INTERVAL,
  SHELTER_CAPACITY,
  SHELTER_WOOD,
  SHELTER_WORK_TICKS,
  SITE_ABANDON_TICKS,
} from '../constants.ts'
import { pushEvent } from '../events.ts'
import { allocateId } from '../ids.ts'
import { chooseSite, getOpenSite, getShelters, housingDeficit } from '../structures.ts'
import type { Structure, WorldState } from '../types.ts'

export function planShelter(state: WorldState): Structure | null {
  if (housingDeficit(state) <= 0 || getOpenSite(state)) return null
  const tile = chooseSite(state)
  if (tile === null) return null
  const site: Structure = {
    id: allocateId(state),
    kind: 'shelter',
    tile,
    stage: 'planned',
    buildProgress: 0,
    buildCost: SHELTER_WORK_TICKS,
    woodDelivered: 0,
    woodRequired: SHELTER_WOOD,
    lastWorkTick: state.tick,
    residentIds: [],
  }
  state.structures.push(site)
  pushEvent(state, 'shelterStarted', [], { structureId: site.id, tile })
  return site
}

function abandonStaleSites(state: WorldState): void {
  for (const site of [...state.structures]) {
    if (site.kind !== 'shelter' || site.stage === 'complete') continue
    if (state.tick - site.lastWorkTick < SITE_ABANDON_TICKS) continue
    state.stockpile.wood += site.woodDelivered // refund: nothing is lost
    state.structures = state.structures.filter((s) => s !== site)
    pushEvent(state, 'shelterAbandoned', [], { structureId: site.id, woodRefunded: site.woodDelivered })
  }
}

/** Builder hands `amount` wood to the site. Returns the amount accepted. */
export function supplySite(state: WorldState, site: Structure, amount: number): number {
  if (site.stage !== 'planned') return 0
  const accepted = Math.min(amount, site.woodRequired - site.woodDelivered)
  if (accepted <= 0) return 0
  site.woodDelivered += accepted
  site.lastWorkTick = state.tick
  if (site.woodDelivered >= site.woodRequired) site.stage = 'underConstruction'
  return accepted
}

/** One builder's labour tick. Returns true if this tick completed the shelter. */
export function workOnSite(state: WorldState, site: Structure): boolean {
  if (site.stage !== 'underConstruction') return false
  site.buildProgress++
  site.lastWorkTick = state.tick
  if (site.buildProgress < site.buildCost) return false
  site.stage = 'complete'
  pushEvent(state, 'shelterCompleted', [], { structureId: site.id })
  assignHomes(state)
  return true
}

export function assignHomes(state: WorldState): void {
  const living = new Map(state.citizens.filter((c) => c.alive).map((c) => [c.id, c]))
  const shelters = getShelters(state)
    .filter((s) => s.stage === 'complete')
    .sort((a, b) => a.id - b.id)

  // Drop residents who died or whose home vanished.
  for (const s of shelters) s.residentIds = s.residentIds.filter((id) => living.get(id)?.homeId === s.id)
  for (const c of living.values()) {
    if (c.homeId !== null && !shelters.some((s) => s.id === c.homeId)) c.homeId = null
  }

  const homeless = [...living.values()].filter((c) => c.homeId === null).sort((a, b) => a.id - b.id)
  for (const s of shelters) {
    while (s.residentIds.length < SHELTER_CAPACITY && homeless.length > 0) {
      const c = homeless.shift()!
      c.homeId = s.id
      s.residentIds.push(c.id)
      s.residentIds.sort((a, b) => a - b)
      pushEvent(state, 'movedIn', [c.id], { structureId: s.id })
    }
  }
}

export function updateConstruction(state: WorldState): void {
  abandonStaleSites(state)
  if (state.tick % PLAN_INTERVAL === 0) planShelter(state)
}
