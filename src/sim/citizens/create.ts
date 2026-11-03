import {
  DECISION_INTERVAL,
  INITIAL_NEEDS,
  ROLES,
  SPAWN_RADIUS,
  TRAIT_PRECISION,
} from '../constants.ts'
import { isPassable, manhattan, toPoint } from '../grid.ts'
import { allocateId } from '../ids.ts'
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
 * Distinct passable tiles within SPAWN_RADIUS (Manhattan) of the campfire,
 * excluding the campfire tile itself, in seeded random order.
 */
export function pickSpawnTiles(state: WorldState, campTile: TileIndex, count: number): TileIndex[] {
  const { map } = state
  const center = toPoint(campTile, map.width)
  const candidates: TileIndex[] = []
  for (let i = 0; i < map.terrain.length; i++) {
    if (i === campTile || !isPassable(map, i)) continue
    if (manhattan(toPoint(i, map.width), center) <= SPAWN_RADIUS) candidates.push(i)
  }
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
