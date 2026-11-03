import { findPath } from '../path/astar.ts'
import { setPath } from '../systems/movement.ts'
import type { ActionKind, Citizen, TileIndex, TileMap, WorldState } from '../types.ts'
import { walkableFor } from '../structures.ts'
import { enterArrivalPhase } from './phases.ts'

/** Paths for citizens only cross discovered tiles, so nobody walks into the fog. */
export function discoveredOnly(map: TileMap): (tile: TileIndex) => boolean {
  return (tile) => map.discovered[tile] === 1
}

/**
 * Give the citizen a task that travels to `target` (A* over tiles walkable
 * for them: discovered, not a shelter except their own home; planned once
 * here) and then enters the kind's arrival phase. If already there, the
 * arrival phase starts immediately. Returns false and assigns nothing if the
 * target can't be reached.
 */
export function beginTask(
  state: WorldState,
  c: Citizen,
  kind: ActionKind,
  target: TileIndex,
  targetId: number | null = null,
): boolean {
  const here = c.pos.y * state.map.width + c.pos.x
  const path = findPath(state.map, here, target, { canEnter: walkableFor(state, c) })
  if (path === null) return false
  c.task = { kind, phase: 'moveTo', targetTile: target, targetId, ticksLeft: 0, startedTick: state.tick }
  setPath(state.map, c, path)
  if (path.length === 0) enterArrivalPhase(state, c)
  return true
}
