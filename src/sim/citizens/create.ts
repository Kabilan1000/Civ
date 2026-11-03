import { DECISION_INTERVAL, INITIAL_NEEDS, ROLES, TRAIT_PRECISION } from '../constants.ts'
import { toPoint } from '../grid.ts'
import { allocateId } from '../ids.ts'
import { spawnCandidates } from '../map/generate.ts'
import { reachableMask } from '../path/flood.ts'
import { nextFloat, shuffle } from '../rng.ts'
import type { Citizen, Personality, Point, Role, RngState, TileIndex, WorldState } from '../types.ts'
import { CITIZEN_NAMES } from './names.ts'

function trait(rng: RngState): number {
  return Math.round(nextFloat(rng) * TRAIT_PRECISION) / TRAIT_PRECISION
}

export function randomPersonality(rng: RngState): Personality {
  // Fixed draw order keeps creation reproducible.
  const sociability = trait(rng)
  const diligence = trait(rng)
  const curiosity = trait(rng)
  const resilience = trait(rng)
  return { sociability, diligence, curiosity, resilience }
}

/**
 * Distinct passable tiles within SPAWN_RADIUS (Manhattan) of the campfire
 * that are reachable from it, excluding the campfire tile, in seeded order.
 */
export function pickSpawnTiles(state: WorldState, campTile: TileIndex, count: number): TileIndex[] {
  const candidates = spawnCandidates(state.map, campTile, reachableMask(state.map, campTile))
  if (candidates.length < count) {
    throw new Error(`Not enough spawn tiles: need ${count}, found ${candidates.length}`)
  }
  return shuffle(state.rng, candidates).slice(0, count)
}

export function createCitizen(
  id: number,
  name: string,
  role: Role,
  personality: Personality,
  pos: Point,
  order: number,
): Citizen {
  return {
    id,
    name,
    role,
    personality,
    needs: { ...INITIAL_NEEDS },
    pos: { ...pos },
    path: [],
    pathIndex: 0,
    moveTicksLeft: 0,
    task: null,
    // Stagger the first decisions so citizens don't all think on the same tick.
    nextDecisionTick: 1 + (order % DECISION_INTERVAL),
    carrying: null,
    homeId: null,
    relationships: {},
    memories: [],
    lastScores: [],
    alive: true,
    diedTick: null,
  }
}

/**
 * Create config.citizenCount citizens with unique names, a balanced role mix
 * (round-robin, then shuffled) and seeded personalities. RNG draw order:
 * names, roles, spawn tiles, then personalities per citizen.
 */
export function createCitizens(state: WorldState, campTile: TileIndex): Citizen[] {
  const count = state.config.citizenCount
  const names = shuffle(state.rng, [...CITIZEN_NAMES]).slice(0, count)
  const roles = shuffle(
    state.rng,
    Array.from({ length: count }, (_, i) => ROLES[i % ROLES.length] as Role),
  )
  const tiles = pickSpawnTiles(state, campTile, count)
  return names.map((name, i) =>
    createCitizen(
      allocateId(state),
      name,
      roles[i] as Role,
      randomPersonality(state.rng),
      toPoint(tiles[i] as TileIndex, state.map.width),
      i,
    ),
  )
}
