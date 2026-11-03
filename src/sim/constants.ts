// All simulation tuning values live here. Never inline magic numbers in systems.
import type { Needs, Role, Stockpile, Terrain } from './types.ts'

/** Bump whenever the serialized WorldState shape changes, and add a migration. */
export const SCHEMA_VERSION = 5

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
export const BERRY_MAX = 6
export const TREE_WOOD_MAX = 8

/** Reachable resource tiles guaranteed inside the starting discovery radius. */
export const MIN_START_BERRY_TILES = 6
export const MIN_START_TREE_TILES = 3

/** Radius (euclidean, tiles) around the campfire that starts discovered. */
export const START_DISCOVERY_RADIUS = 6

/** Citizens spawn on distinct passable tiles within this Manhattan distance of the campfire. */
export const SPAWN_RADIUS = 4

export const MAX_EVENTS = 200

/** A history sample is recorded at tick 0 and every HISTORY_INTERVAL ticks (10 per day). */
export const HISTORY_INTERVAL = 24
/** At most this many samples are kept (60 days); the oldest are dropped first. */
export const HISTORY_MAX = 600

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

// ── Needs (per tick; 240 ticks = 1 day) ─────────────────────────────────────
// Balance: satiety drops 48/day → ~2 food per citizen per day (≈23 for 12).
// Awake energy drain ≈ 50/day; sleeping at 0.8/tick refills that in ~65
// ticks (≈6.5 h of the 7 h night).

export const SATIETY_DECAY = 0.2
/** Energy change per tick by activity (negative = drain). */
export const ENERGY_RATES = {
  idle: -0.2,
  walking: -0.3,
  working: -0.4,
  resting: 0.8,
  /** Sleeping in one's own completed shelter. */
  restingHome: 1.2,
} as const
export type Activity = keyof typeof ENERGY_RATES

/** Social need only recovers through real interactions (see "Social" below). */
export const SOCIAL_DECAY = 0.12

/** Health loss per tick at satiety 0 / energy 0, scaled by (1 - HEALTH_RESILIENCE_FACTOR * resilience). */
export const STARVING_HEALTH_LOSS = 0.15
export const EXHAUSTED_HEALTH_LOSS = 0.1
export const HEALTH_RESILIENCE_FACTOR = 0.5
/** Health regained per tick while satiety ≥ 40 and energy ≥ 25. */
export const HEALTH_RECOVERY = 0.05
export const HEALTH_RECOVERY_MIN_SATIETY = 40
export const HEALTH_RECOVERY_MIN_ENERGY = 25

// ── Food, carrying and gathering ────────────────────────────────────────────

/** Satiety restored per unit of food eaten. */
export const FOOD_SATIETY = 25
/** Ticks to eat one unit; citizens stop eating at EAT_STOP_SATIETY. */
export const EAT_TICKS = 3
export const EAT_STOP_SATIETY = 90
/** Max units a citizen can carry, by resource kind. */
export const CARRY_CAPACITY = { berries: 6, wood: 4 } as const
/** Ticks to gather one unit, by resource kind. */
export const GATHER_TICKS = { berries: 3, wood: 5 } as const
/** Citizens deposit and eat from the stockpile within this Manhattan distance of the campfire. */
export const CAMP_RADIUS = 1
/** Rest spots are passable tiles within this Manhattan distance of the campfire. */
export const REST_RADIUS = 2
/** Sleep ends at this energy. */
export const REST_STOP_ENERGY = 98

/** Every N ticks each non-full node regrows one unit. */
export const BERRY_REGROW_INTERVAL = 48 // 5 units per bush per day
export const TREE_REGROW_INTERVAL = 160 // 1.5 units per tree per day

// ── Construction & housing ──────────────────────────────────────────────────
// Balance: 4 shelters house 12 citizens and cost 48 wood. Builders gather
// ≈4 wood per 25 ticks each, so the wood takes ~2 days of the builders' work;
// labour is 2–3 hours per shelter with two workers.

export const SHELTER_WOOD = 12
/** Labour ticks per shelter (one builder adds one per tick). */
export const SHELTER_WORK_TICKS = 60
export const SHELTER_CAPACITY = 3
/** At most this many citizens work on (haul to or build) one site at a time. */
export const MAX_SITE_WORKERS = 2
/** Shelters are placed this far from the campfire (Manhattan, inclusive). */
export const SITE_MIN_CAMP_DISTANCE = 3
export const SITE_MAX_CAMP_DISTANCE = 6
/** How often (ticks) the village considers planning a new shelter. */
export const PLAN_INTERVAL = 10
/** A site with no delivery or labour for this long is abandoned (wood refunded). */
export const SITE_ABANDON_TICKS = 480

// ── Social (M6) ─────────────────────────────────────────────────────────────
// Balance: social decays ≈29/day; one chat restores 30, so about one good
// conversation a day keeps a citizen content.

/** Participants must be within this Manhattan distance to talk or hand over food. */
export const INTERACT_RADIUS = 2
/** Partners are sought within this many BFS steps. */
export const SOCIAL_SEARCH_STEPS = 10
/** Ticks a conversation takes (both participants). */
export const CHAT_TICKS = 8
/** Ticks to hand food to someone. */
export const SHARE_TICKS = 3
/** At most this many berries are given per share. */
export const SHARE_MAX_UNITS = 2
/** A citizen counts as hungry enough to be offered food below this satiety. */
export const SHARE_HUNGER_SATIETY = 45
/** A citizen won't start another interaction for this many ticks. */
export const SOCIAL_COOLDOWN = 40
/** The same pair won't interact again for this many ticks. */
export const PAIR_COOLDOWN = 120
/** Social actions are off while satiety or energy is below this (survival first). */
export const SOCIAL_MIN_NEED = 35
/** While talking/listening, the current task's score counts as at least this (so chats finish). */
export const CONVERSATION_COMMITMENT = 0.6

export const CHAT_SOCIAL = 30
export const CHAT_FAMILIARITY = 6
export const ARGUE_SOCIAL = 8
export const ARGUE_FAMILIARITY = 3
export const SHARE_SOCIAL = 15
export const SHARE_FAMILIARITY = 5
/** Affinity change: chat = CHAT_AFFINITY_BASE + CHAT_AFFINITY_CHARM × partner sociability. */
export const CHAT_AFFINITY_BASE = 5
export const CHAT_AFFINITY_CHARM = 6
/** Affinity change: argument = −(ARGUE_AFFINITY_BASE + ARGUE_AFFINITY_TOUCHY × (1 − own resilience)). */
export const ARGUE_AFFINITY_BASE = 8
export const ARGUE_AFFINITY_TOUCHY = 6
export const SHARE_AFFINITY_RECEIVER = 15
export const SHARE_AFFINITY_GIVER = 5
/** Argument probability: base + low-sociability + stress + bad-blood terms, capped. */
export const ARGUE_BASE = 0.05
export const ARGUE_MAX = 0.6
/** Relationship milestones that produce events (once per crossing). */
export const FRIENDSHIP_AFFINITY = 50
export const RIVALRY_AFFINITY = -40
/** Partners with affinity below this are avoided. */
export const AVOID_AFFINITY = -50

// ── Memory (M6) ─────────────────────────────────────────────────────────────

export const MAX_MEMORIES = 24
/** A repeat of the same kind/subject/tile within this window refreshes the old memory. */
export const MEMORY_MERGE_TICKS = 240
/** Memories older than this no longer influence decisions (they may still be kept). */
export const MEMORY_RELEVANCE_TICKS = 480
/** Citizens within this distance witness a death. */
export const WITNESS_RADIUS = 6

// ── Exploration (M6) ────────────────────────────────────────────────────────

/** Tiles within this euclidean radius are revealed by a survey. */
export const EXPLORE_REVEAL_RADIUS = 4
/** Ticks spent surveying at a frontier before tiles are revealed. */
export const SURVEY_TICKS = 4
/** Exploration requires satiety and energy at least this high. */
export const EXPLORE_MIN_NEED = 45
/** Another explorer's target within this Manhattan distance excludes a frontier. */
export const EXPLORE_SPACING = 4
/** Reveal at least this many tiles in one survey to log a 'discovered' event. */
export const DISCOVERY_EVENT_MIN_TILES = 10

// ── Utility AI ──────────────────────────────────────────────────────────────

/** A running task is only replaced if another action outscores it by this much. */
export const SWITCH_MARGIN = 0.2
/**
 * Eat/rest at or above this score (maximum urgency) also waive the margin —
 * scores are capped at 1, so a margin could otherwise keep a high-scoring
 * job (e.g. 0.84 construction) running until the need turns critical.
 */
export const URGENT_SCORE = 0.95
/** Below these, the margin is waived for eat / rest. */
export const CRITICAL_SATIETY = 15
export const CRITICAL_ENERGY = 25 // high enough that a far-off worker still gets home
/** Random jitter added to each score (seeded), for variety. */
export const SCORE_JITTER = 0.02
/** Travel distance (BFS steps) at which the distance factor bottoms out at 1/3. */
export const DISTANCE_FALLOFF_STEPS = 40
/** Village wants this much food per living citizen in the stockpile. */
export const FOOD_RESERVE_PER_CITIZEN = 6
/** Spare wood the village keeps in reserve; housing wood is added on top (structures.housingWoodNeed). */
export const WOOD_TARGET = 20
/** Scores at night are multiplied by this for outdoor work. */
export const NIGHT_WORK_FACTOR = 0.5
export const NIGHT_REST_BONUS = 0.35

/** Role multipliers on work scores (missing = 1). */
export const ROLE_WEIGHTS: Readonly<
  Record<Role, Partial<Record<'forage' | 'chop' | 'build' | 'explore' | 'wander', number>>>
> = {
  forager: { forage: 1.3, chop: 0.5, build: 0.4, explore: 0.3 },
  builder: { forage: 0.6, chop: 1.3, build: 1.4, explore: 0.3 },
  explorer: { forage: 0.8, chop: 0.7, build: 0.5, explore: 1.6, wander: 1.5 },
}
