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

/** Placeholder map (until M2): grass surrounded by a water border this many tiles thick. */
export const PLACEHOLDER_BORDER = 1

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

export const INITIAL_STOCKPILE: Readonly<Stockpile> = { food: 20, wood: 0 }
