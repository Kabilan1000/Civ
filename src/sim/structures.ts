// Structure rules shared by planning, the AI, movement and rendering.
//
// Solidity: shelters (any stage) occupy their tile and block movement — the
// only exception is a resident entering their own completed home to sleep.
// The campfire stays walkable (citizens eat and deposit around it).

import {
  HOUSING_HEADROOM,
  MAX_POPULATION,
  MAX_SITE_WORKERS,
  PROSPERITY_FOOD_PER_CAPITA,
  SHELTER_CAPACITY,
  SITE_MAX_CAMP_DISTANCE,
  SITE_MAX_WALK_STEPS,
  SITE_OUTER_CAMP_DISTANCE,
  SITE_OUTER_WALK_STEPS,
  SITE_MIN_CAMP_DISTANCE,
} from './constants.ts'
import { isPassable, manhattan, neighbors4, toIndex, toPoint } from './grid.ts'
import { distanceField, reachableMask } from './path/flood.ts'
import type { Citizen, Structure, TileIndex, WorldState } from './types.ts'

export function getCampfire(state: WorldState): Structure | undefined {
  return state.structures.find((s) => s.kind === 'campfire')
}

export function getShelters(state: WorldState): Structure[] {
  return state.structures.filter((s) => s.kind === 'shelter')
}

/** The (single) unfinished shelter, if any. */
export function getOpenSite(state: WorldState): Structure | undefined {
  return state.structures.find((s) => s.kind === 'shelter' && s.stage !== 'complete')
}

export function solidTiles(state: WorldState): Set<TileIndex> {
  const tiles = new Set<TileIndex>()
  for (const s of state.structures) if (s.kind === 'shelter') tiles.add(s.tile)
  return tiles
}

/** The citizen's completed home, if assigned. */
export function getHome(state: WorldState, c: Citizen): Structure | undefined {
  if (c.homeId === null) return undefined
  const home = state.structures.find((s) => s.id === c.homeId)
  return home && home.stage === 'complete' ? home : undefined
}

/**
 * Tiles anyone may walk on this tick: passable, discovered and not solid.
 * Derived data, cached per (state, tick, map.version, structure count) — the
 * inputs that can change it — so all decisions in a tick share one mask.
 * Never serialized; results are identical without the cache.
 */
const maskCache = new WeakMap<WorldState, { key: string; mask: Uint8Array }>()

export function baseWalkMask(state: WorldState): Uint8Array {
  const { map } = state
  const key = `${state.tick}:${map.version}:${state.structures.length}:${map.terrain.length}`
  const cached = maskCache.get(state)
  if (cached && cached.key === key) return cached.mask
  const mask = new Uint8Array(map.terrain.length)
  for (let i = 0; i < mask.length; i++) mask[i] = map.discovered[i] === 1 && isPassable(map, i) ? 1 : 0
  for (const s of state.structures) if (s.kind === 'shelter') mask[s.tile] = 0
  maskCache.set(state, { key, mask })
  return mask
}

/**
 * Walkability for a citizen: discovered, not solid — except the citizen's own
 * completed home, which they may enter (to sleep).
 */
export function walkableFor(state: WorldState, c: Citizen): (tile: TileIndex) => boolean {
  const solid = solidTiles(state)
  const home = getHome(state, c)?.tile ?? -1
  const { discovered } = state.map
  return (tile) => discovered[tile] === 1 && (tile === home || !solid.has(tile))
}

/**
 * Beds the village wants but doesn't have or plan (Population V1, TDS §8.4):
 *   living (children included) + couples living apart + headroom
 *   − beds in all shelters (planned ones included).
 * Headroom (HOUSING_HEADROOM spare beds) applies only while the village is
 * prosperous — at least one couple, food ≥ PROSPERITY_FOOD_PER_CAPITA × living
 * and below the cap — so builders build ahead in good times. Every birth raises `living`, so a
 * birth into a full home always creates demand: births can never deadlock
 * waiting for a spare bed.
 */
export function housingDeficit(state: WorldState, opts: { headroom?: boolean } = {}): number {
  const living = state.citizens.filter((c) => c.alive)
  const n = living.length
  let apart = 0
  let couples = 0
  for (const c of living) {
    if (c.partnerId === null || c.partnerId < c.id) continue
    const p = living.find((o) => o.id === c.partnerId)
    if (!p) continue
    couples++
    if (c.homeId === null || c.homeId !== p.homeId) apart++
  }
  // Build ahead only when it can matter: families exist and food is plentiful.
  const prosperous = couples > 0 && state.stockpile.food >= PROSPERITY_FOOD_PER_CAPITA * n && n < MAX_POPULATION
  const wanted = n + apart + ((opts.headroom ?? true) && prosperous ? HOUSING_HEADROOM : 0)
  return Math.max(0, wanted - getShelters(state).length * SHELTER_CAPACITY)
}

/** Wood carried by citizens currently hauling to `site`. */
export function woodInTransit(state: WorldState, site: Structure): number {
  let total = 0
  for (const c of state.citizens) {
    const t = c.task
    if (c.alive && t?.kind === 'build' && t.targetId === site.id && c.carrying?.kind === 'wood') {
      total += c.carrying.amount
    }
  }
  return total
}

/** Wood the site still needs beyond what is delivered or on its way. */
export function woodStillNeeded(state: WorldState, site: Structure): number {
  return Math.max(0, site.woodRequired - site.woodDelivered - woodInTransit(state, site))
}

/** Citizens (other than `except`) with a build task for `site`. */
export function siteWorkers(state: WorldState, site: Structure, except?: Citizen): number {
  return state.citizens.filter((c) => c !== except && c.alive && c.task?.kind === 'build' && c.task.targetId === site.id)
    .length
}

export function siteHasRoom(state: WorldState, site: Structure, c: Citizen): boolean {
  return siteWorkers(state, site, c) < MAX_SITE_WORKERS
}

/** Passable, discovered, non-solid 4-neighbours of a structure, from which builders work. */
export function workTiles(state: WorldState, site: Structure): TileIndex[] {
  const solid = solidTiles(state)
  return neighbors4(state.map, site.tile).filter(
    (t) => isPassable(state.map, t) && state.map.discovered[t] === 1 && !solid.has(t),
  )
}

// ── Site selection ──────────────────────────────────────────────────────────

/**
 * Valid shelter tile: discovered grass, sand or treeless forest — never a
 * tile with a resource node (bushes and trees, even depleted ones, regrow) —, not the
 * campfire or another structure, no citizen standing on it, within
 * SITE_MIN..MAX_CAMP_DISTANCE of the campfire, no other shelter in its 8
 * neighbours (keeps alleys open), and — the critical-route rule — making it
 * solid must not cut off any tile currently reachable from the campfire.
 */
export function isValidSite(
  state: WorldState,
  tile: TileIndex,
  campTile: TileIndex,
  reachableBefore?: number,
  maxCampDistance: number = SITE_MAX_CAMP_DISTANCE,
): boolean {
  const { map } = state
  const t = map.terrain[tile]
  if ((t !== 'grass' && t !== 'sand' && t !== 'forest') || map.discovered[tile] !== 1 || map.resources[tile] !== null) {
    return false
  }
  if (state.structures.some((s) => s.tile === tile)) return false
  const p = toPoint(tile, map.width)
  const camp = toPoint(campTile, map.width)
  const d = manhattan(p, camp)
  if (d < SITE_MIN_CAMP_DISTANCE || d > maxCampDistance) return false
  if (state.citizens.some((c) => c.alive && c.pos.x === p.x && c.pos.y === p.y)) return false
  for (const s of getShelters(state)) {
    const q = toPoint(s.tile, map.width)
    if (Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1) return false
  }

  const solid = solidTiles(state)
  const walk = (extra: TileIndex | null) =>
    reachableMask(map, campTile, (x) => map.discovered[x] === 1 && !solid.has(x) && x !== extra)
  const count = (mask: Uint8Array) => mask.reduce((n, v) => n + v, 0)
  const before = reachableBefore ?? count(walk(null))
  // Everything reachable before (except the site itself) must stay reachable.
  return count(walk(tile)) === before - 1
}

/**
 * Best site: the valid tile with the shortest WALK from the campfire (BFS
 * steps over walkable tiles, at most SITE_MAX_WALK_STEPS), then Manhattan
 * distance, then tile index. Null if none.
 */
export function chooseSite(state: WorldState): TileIndex | null {
  return chooseSiteWithin(state, SITE_MAX_CAMP_DISTANCE, SITE_MAX_WALK_STEPS) ?? chooseSiteWithin(state, SITE_OUTER_CAMP_DISTANCE, SITE_OUTER_WALK_STEPS)
}

function chooseSiteWithin(state: WorldState, maxDistance: number, maxSteps: number): TileIndex | null {
  const camp = getCampfire(state)
  if (!camp) return null
  const { map } = state
  const campPoint = toPoint(camp.tile, map.width)
  const solid = solidTiles(state)
  const reachable = reachableMask(map, camp.tile, (x) => map.discovered[x] === 1 && !solid.has(x))
  const reachableCount = reachable.reduce((n, v) => n + v, 0)

  const candidates: TileIndex[] = []
  for (let y = campPoint.y - maxDistance; y <= campPoint.y + maxDistance; y++) {
    for (let x = campPoint.x - maxDistance; x <= campPoint.x + maxDistance; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      const tile = toIndex(x, y, map.width)
      if (reachable[tile] === 1) candidates.push(tile)
    }
  }
  const walk = distanceField(map, camp.tile, (x) => map.discovered[x] === 1 && !solid.has(x))
  const steps = (t: TileIndex) => walk[t]!
  const near = candidates.filter((t) => steps(t) >= 0 && steps(t) <= maxSteps)
  near.sort(
    (a, b) =>
      steps(a) - steps(b) ||
      manhattan(toPoint(a, map.width), campPoint) - manhattan(toPoint(b, map.width), campPoint) ||
      a - b,
  )
  for (const tile of near) {
    if (isValidSite(state, tile, camp.tile, reachableCount, maxDistance)) return tile
  }
  return null
}

/**
 * Wood the village still needs for housing: what the open site lacks plus a
 * full shelter's worth for every further shelter the deficit calls for.
 * Added to the chop target so builders keep gathering while homes are needed.
 */
export function housingWoodNeed(state: WorldState, shelterWood: number): number {
  const open = getOpenSite(state)
  const openNeed = open && open.stage === 'planned' ? open.woodRequired - open.woodDelivered : 0
  return openNeed + Math.ceil(housingDeficit(state) / SHELTER_CAPACITY) * shelterWood
}
