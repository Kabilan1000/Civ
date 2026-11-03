// All simulation tuning values live here. Never inline magic numbers in systems.
import type { Needs, Role, Stockpile, Terrain } from './types.ts'

/** Bump whenever the serialized WorldState shape changes, and add a migration. */
export const SCHEMA_VERSION = 1

// ── Time ────────────────────────────────────────────────────────────────────

/** In-game minutes that pass per simulation tick. */
export const MINUTES_PER_TICK = 6

/** Ticks per in-game day (24h * 60min / 6min). */
export const TICKS_PER_DAY = 240

/** Clock time of tick-of-day 0. Days begin at dawn, 06:00. */
export const DAY_START_MINUTE = 6 * 60

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'

/** Phase boundaries as tick-of-day, ascending. Night is the last 70 ticks (≈29%). */
export const DAY_PHASES: readonly { phase: DayPhase; startTick: number }[] = [
  { phase: 'dawn', startTick: 0 }, // 06:00
  { phase: 'day', startTick: 20 }, // 08:00
  { phase: 'dusk', startTick: 140 }, // 20:00
  { phase: 'night', startTick: 170 }, // 23:00
]

/** Ticks per second of real time at 1x speed. Used by the app layer, never by sim logic. */
export const BASE_TICKS_PER_SECOND = 5

/** Supported simulation speed multipliers. */
export const SPEEDS = [1, 3, 10] as const
export type Speed = (typeof SPEEDS)[number]

// ── World ───────────────────────────────────────────────────────────────────

export const MIN_MAP_SIZE = 8
export const MAX_MAP_SIZE = 128

// ── Map generation ──────────────────────────────────────────────────────────

/** Regenerate attempts (with derived seeds) before falling back to a carved clearing. */
export const MAPGEN_MAX_ATTEMPTS = 12

export const ELEVATION_OCTAVES = [
  { cell: 9, weight: 0.65 },
  { cell: 4, weight: 0.35 },
] as const
export const MOISTURE_OCTAVES = [
  { cell: 7, weight: 0.7 },
  { cell: 3, weight: 0.3 },
] as const

/** How strongly elevation drops towards the map edge (shapes an island). */
export const ISLAND_FALLOFF = 0.7

/** Terrain shares by elevation rank (lowest → water, then sand; highest → rock). */
export const WATER_FRACTION = 0.3
export const SAND_FRACTION = 0.08
export const ROCK_FRACTION = 0.05
/** Share of the remaining grass/forest land that becomes forest (wettest first). */
export const FOREST_FRACTION_OF_LAND = 0.35

/** The settlement's connected land region must cover at least this share of the map. */
export const MIN_REGION_FRACTION = 0.3

export const BERRY_CHANCE = 0.1 // per grass tile
export const TREE_CHANCE = 0.55 // per forest tile
export const BERRY_MAX = 5
export const TREE_WOOD_MAX = 8

/** Reachable resource tiles guaranteed inside the starting discovery radius. */
export const MIN_START_BERRY_TILES = 3
export const MIN_START_TREE_TILES = 3

/** Radius (euclidean, tiles) around the campfire that starts discovered. */
export const START_DISCOVERY_RADIUS = 6

/** Citizens spawn on distinct passable tiles within this Manhattan distance of the campfire. */
export const SPAWN_RADIUS = 4

export const MAX_EVENTS = 200

export interface TerrainRule {
  passable: boolean
  /** Ticks to step onto this tile. Only meaningful when passable. */
  stepCost: number
}

export const TERRAIN_RULES: Readonly<Record<Terrain, TerrainRule>> = {
  water: { passable: false, stepCost: 0 },
  sand: { passable: true, stepCost: 3 },
  grass: { passable: true, stepCost: 2 },
  forest: { passable: true, stepCost: 3 },
  rock: { passable: false, stepCost: 0 },
}

export const TERRAINS = Object.keys(TERRAIN_RULES) as Terrain[]

// ── Citizens ────────────────────────────────────────────────────────────────

export const ROLES: readonly Role[] = ['forager', 'builder', 'explorer']

export const INITIAL_NEEDS: Readonly<Needs> = {
  satiety: 80,
  energy: 90,
  social: 70,
  health: 100,
}

/** Ticks between routine AI re-evaluations (staggered per citizen). */
export const DECISION_INTERVAL = 10

/** Personality traits are rounded to this many decimal places at creation. */
export const TRAIT_PRECISION = 100

// ── Wandering (M3 placeholder behaviour until the utility AI in M4) ─────────

/** Wander destinations are picked within this Manhattan distance of the citizen. */
export const WANDER_RADIUS = 7
/** Random destination picks tried per decision before giving up for now. */
export const WANDER_MAX_TRIES = 8
/** Ticks to linger at a destination before choosing the next one (inclusive range). */
export const WANDER_PAUSE_MIN = 4
export const WANDER_PAUSE_MAX = 16
/** Ticks to wait before trying again when no destination could be found. */
export const WANDER_RETRY_TICKS = 5

export const INITIAL_STOCKPILE: Readonly<Stockpile> = { food: 20, wood: 0 }
