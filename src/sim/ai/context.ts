// Everything an action needs to score itself for one citizen at one tick.
// Built once per decision; cheap (one BFS over the 36x24 map).

import { REST_RADIUS } from '../constants.ts'
import { isPassable, manhattan, toIndex, toPoint } from '../grid.ts'
import { distanceField } from '../path/flood.ts'
import { dayPhaseAt } from '../systems/time.ts'
import type { Citizen, ResourceKind, TileIndex, WorldState } from '../types.ts'

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
  /** Nearest reachable rest spot near the campfire. */
  restSpot: Target | null
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
  const steps = distanceField(map, here, (t) => map.discovered[t] === 1)
  const campTile = getCampTile(state)
  const campSteps = campTile === null ? -1 : steps[campTile]!
  const reserved = reservedTiles(state, c)

  const resource = (kind: ResourceKind) =>
    nearest(steps, (t) => {
      const node = map.resources[t]
      return node !== null && node !== undefined && node.kind === kind && node.amount > 0 && !reserved.has(t)
    })

  let restSpot: Target | null = null
  if (campTile !== null && campSteps >= 0) {
    const camp = toPoint(campTile, map.width)
    restSpot = nearest(steps, (t) => isPassable(map, t) && manhattan(toPoint(t, map.width), camp) <= REST_RADIUS)
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
  }
}
