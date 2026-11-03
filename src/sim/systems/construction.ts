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
  MAX_OVERCROWD,
  PLAN_INTERVAL,
  SHELTER_CAPACITY,
  SHELTER_WOOD,
  SHELTER_WORK_TICKS,
  SITE_ABANDON_TICKS,
} from '../constants.ts'
import { pushEvent } from '../events.ts'
import { allocateId } from '../ids.ts'
import { chooseSite, getOpenSite, getShelters, housingDeficit } from '../structures.ts'
import { isChild } from '../citizens/life.ts'
import type { Citizen, Structure, WorldState } from '../types.ts'

export function planShelter(state: WorldState, opts: { headroom?: boolean } = {}): Structure | null {
  if (housingDeficit(state, opts) <= 0 || getOpenSite(state)) return null
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

/**
 * Household-aware home assignment (Population V1, TDS §8.3). Deterministic;
 * runs on completions, deaths and every dawn. In order:
 *   1. drop residents who died or whose home vanished;
 *   2. reunite couples: one partner joins the other's home if it has a free
 *      bed, else both move to a shelter with two free beds;
 *   3. children follow a housed parent, even into a full home (overcrowding
 *      up to MAX_OVERCROWD above SHELTER_CAPACITY — this is housing demand);
 *   4. lodgers (adults with no partner or child at home) move out of
 *      overcrowded homes into free beds elsewhere;
 *   5. the homeless fill free beds, in id order.
 */
export function assignHomes(state: WorldState): void {
  const living = new Map(state.citizens.filter((c) => c.alive).map((c) => [c.id, c]))
  const shelters = getShelters(state)
    .filter((s) => s.stage === 'complete')
    .sort((a, b) => a.id - b.id)
  const byId = new Map(shelters.map((s) => [s.id, s]))

  // 1. Drop residents who died or whose home vanished.
  for (const s of shelters) s.residentIds = s.residentIds.filter((id) => living.get(id)?.homeId === s.id)
  for (const c of living.values()) if (c.homeId !== null && !byId.has(c.homeId)) c.homeId = null

  const free = (s: Structure) => SHELTER_CAPACITY - s.residentIds.length
  const move = (c: Citizen, s: Structure) => {
    if (c.homeId === s.id) return
    const old = c.homeId === null ? undefined : byId.get(c.homeId)
    if (old) old.residentIds = old.residentIds.filter((id) => id !== c.id)
    c.homeId = s.id
    s.residentIds.push(c.id)
    s.residentIds.sort((a, b) => a - b)
    pushEvent(state, 'movedIn', [c.id], { structureId: s.id })
  }
  const homeOf = (c: Citizen) => (c.homeId === null ? undefined : byId.get(c.homeId))
  const ordered = [...living.values()].sort((a, b) => a.id - b.id)

  // 2. Couples share a home.
  for (const c of ordered) {
    const p = c.partnerId === null ? undefined : living.get(c.partnerId)
    if (!p || p.id < c.id) continue
    if (c.homeId !== null && c.homeId === p.homeId) continue
    const hc = homeOf(c)
    const hp = homeOf(p)
    if (hc && free(hc) >= 1) move(p, hc)
    else if (hp && free(hp) >= 1) move(c, hp)
    else {
      const both = shelters.find((s) => free(s) >= 2)
      if (both) {
        move(c, both)
        move(p, both)
      }
    }
  }

  // 3. Children live with a housed parent.
  for (const c of ordered) {
    if (!isChild(c, state.tick) || !c.parentIds) continue
    const parent = c.parentIds.map((id) => living.get(id)).find((p) => p && p.homeId !== null)
    const home = parent && homeOf(parent)
    if (home && c.homeId !== home.id && home.residentIds.length < SHELTER_CAPACITY + MAX_OVERCROWD) move(c, home)
  }

  // 4. Lodgers leave overcrowded homes when a bed is free elsewhere.
  for (const s of shelters) {
    if (s.residentIds.length <= SHELTER_CAPACITY) continue
    const here = new Set(s.residentIds)
    const lodgers = s.residentIds
      .map((id) => living.get(id)!)
      .filter((c) => !isChild(c, state.tick) && !(c.partnerId !== null && here.has(c.partnerId)) && !c.childIds.some((k) => here.has(k)))
    for (const lodger of lodgers) {
      if (s.residentIds.length <= SHELTER_CAPACITY) break
      const target = shelters.find((t) => t !== s && free(t) >= 1)
      if (target) move(lodger, target)
    }
  }

  // 5. The homeless fill free beds.
  for (const c of ordered) {
    if (c.homeId !== null) continue
    const target = shelters.find((s) => free(s) >= 1)
    if (target) move(c, target)
  }
}

export function updateConstruction(state: WorldState, opts: { headroom?: boolean } = {}): void {
  abandonStaleSites(state)
  if (state.tick % PLAN_INTERVAL === 0) planShelter(state, opts)
}
