// Wander: walk to a random nearby discovered tile, linger, repeat.
// The only behaviour in M3; the utility AI (M4) will score it alongside
// other actions.

import { WANDER_MAX_TRIES, WANDER_RADIUS } from '../../constants.ts'
import { inBounds, isPassable, toIndex } from '../../grid.ts'
import { findPath } from '../../path/astar.ts'
import { nextInt } from '../../rng.ts'
import { setPath } from '../../systems/movement.ts'
import type { Citizen, TileIndex, TileMap, WorldState } from '../../types.ts'

/** Wander paths only cross discovered tiles, so citizens never walk into the fog. */
export function discoveredOnly(map: TileMap): (tile: TileIndex) => boolean {
  return (tile) => map.discovered[tile] === 1
}

/**
 * Try up to WANDER_MAX_TRIES random destinations within WANDER_RADIUS
 * (Manhattan) that are passable, discovered and reachable over discovered
 * tiles. On success the citizen gets a 'wander' task and a path (computed
 * once, here). Returns false if nothing suitable was found.
 */
export function startWander(state: WorldState, c: Citizen): boolean {
  const { map, rng } = state
  const here = toIndex(c.pos.x, c.pos.y, map.width)
  const canEnter = discoveredOnly(map)

  for (let attempt = 0; attempt < WANDER_MAX_TRIES; attempt++) {
    const dx = nextInt(rng, -WANDER_RADIUS, WANDER_RADIUS)
    const reach = WANDER_RADIUS - Math.abs(dx)
    const dy = nextInt(rng, -reach, reach)
    const x = c.pos.x + dx
    const y = c.pos.y + dy
    if (!inBounds(map, x, y)) continue
    const target = toIndex(x, y, map.width)
    if (target === here || !isPassable(map, target) || !canEnter(target)) continue

    const path = findPath(map, here, target, { canEnter })
    if (path === null || path.length === 0) continue

    c.task = { kind: 'wander', phase: 'moveTo', targetTile: target, targetId: null, ticksLeft: 0, startedTick: state.tick }
    setPath(map, c, path)
    return true
  }
  return false
}
