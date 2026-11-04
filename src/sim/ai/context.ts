// Everything an action needs to score itself for one citizen at one tick.
// Built once per decision; cheap (one BFS over the 36x24 map).

import { recentMemories } from '../citizens/memory.ts'
import { REST_RADIUS } from '../constants.ts'

/** A remembered productive node is treated as this many steps closer. */
export const REMEMBERED_DISCOUNT = 3
import { isPassable, manhattan, toIndex, toPoint } from '../grid.ts'
import { distanceFieldMask } from '../path/flood.ts'
import { baseWalkMask, getHome, getOpenSite, solidTiles, workTiles } from '../structures.ts'
import { dayPhaseAt } from '../systems/time.ts'
import type { Citizen, ResourceKind, Structure, TileIndex, WorldState } from '../types.ts'

export interface Target {
  tile: TileIndex
  /** BFS steps over discovered tiles from the citizen. */
  steps: number
}

export interface DecisionContext {
  state: WorldState
  citizen: Citizen
  here: TileIndex
  /** BFS steps to every tile over discovered, passable terrain (-1 = unreachable). */
  steps: Int32Array
  campTile: TileIndex | null
  /** Steps to the campfire, or -1 if unreachable / no campfire. */
  campSteps: number
  night: boolean
  livingCount: number
  /** Nearest discovered, reachable, non-empty node not targeted by another citizen. */
  berries: Target | null
  wood: Target | null
  /** Where to sleep: own completed home if reachable, else nearest spot near the campfire. */
  restSpot: Target | null
  restAtHome: boolean
  /** The open construction site and the nearest reachable tile to work it from. */
  site: Structure | null
  siteWorkTile: Target | null
  /** Lazily computed by ai/actions/explore.ts (undefined = not yet computed). */
  frontierMemo?: { tile: TileIndex; steps: number; gain: number; resurvey: boolean } | null
  /** Explorers may resurvey stale land when nothing is left to discover (default on). */
  resurvey?: boolean
}

export function getCampTile(state: WorldState): TileIndex | null {
  return state.structures.find((s) => s.kind === 'campfire')?.tile ?? null
}

/** Tiles other citizens are currently heading to or gathering from. */
function reservedTiles(state: WorldState, self: Citizen): Set<TileIndex> {
  const reserved = new Set<TileIndex>()
  for (const other of state.citizens) {
    const t = other.task
    if (other === self || !other.alive || !t || t.targetTile === null) continue
    if (t.kind === 'forage' || t.kind === 'chop') reserved.add(t.targetTile)
  }
  return reserved
}

function nearest(steps: Int32Array, accept: (tile: TileIndex) => boolean): Target | null {
  let best: Target | null = null
  for (let i = 0; i < steps.length; i++) {
    const d = steps[i]!
    if (d < 0 || (best && d >= best.steps) || !accept(i)) continue
    best = { tile: i, steps: d } // ties keep the lowest index (scanned first)
  }
  return best
}

export function buildContext(state: WorldState, c: Citizen): DecisionContext {
  const { map } = state
  const here = toIndex(c.pos.x, c.pos.y, map.width)
  const home = getHome(state, c)
  const steps = distanceFieldMask(map, here, baseWalkMask(state), home?.tile ?? -1)
  const campTile = getCampTile(state)
  const campSteps = campTile === null ? -1 : steps[campTile]!
  const reserved = reservedTiles(state, c)

  // Remembered good spots (recent 'foundResource' memories) feel REMEMBERED_DISCOUNT steps closer.
  const remembered = new Set(recentMemories(state, c, 'foundResource').map((m) => m.tile))
  const resource = (kind: ResourceKind): Target | null => {
    let best: (Target & { cost: number }) | null = null
    for (let t = 0; t < steps.length; t++) {
      const d = steps[t]!
      const node = map.resources[t]
      if (d < 0 || !node || node.kind !== kind || node.amount <= 0 || reserved.has(t)) continue
      const cost = remembered.has(t) ? Math.max(0, d - REMEMBERED_DISCOUNT) : d
      if (!best || cost < best.cost) best = { tile: t, steps: d, cost }
    }
    return best && { tile: best.tile, steps: best.steps }
  }

  const solid = solidTiles(state)
  let restSpot: Target | null = home && steps[home.tile]! >= 0 ? { tile: home.tile, steps: steps[home.tile]! } : null
  const restAtHome = restSpot !== null
  if (!restSpot && campTile !== null && campSteps >= 0) {
    const camp = toPoint(campTile, map.width)
    restSpot = nearest(
      steps,
      (t) => isPassable(map, t) && !solid.has(t) && manhattan(toPoint(t, map.width), camp) <= REST_RADIUS,
    )
  }

  const site = getOpenSite(state) ?? null
  let siteWorkTile: Target | null = null
  if (site) {
    const options = new Set(workTiles(state, site))
    siteWorkTile = nearest(steps, (t) => options.has(t))
  }

  return {
    state,
    citizen: c,
    here,
    steps,
    campTile,
    campSteps,
    night: dayPhaseAt(state.tick) === 'night',
    livingCount: state.citizens.filter((x) => x.alive).length,
    berries: resource('berries'),
    wood: resource('wood'),
    restSpot,
    restAtHome,
    site,
    siteWorkTile,
  }
}
