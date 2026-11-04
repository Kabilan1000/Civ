// All simulation tuning values live here. Never inline magic numbers in systems.
import type { Needs, Role, Stockpile, Terrain } from './types.ts'

/** Bump whenever the serialized WorldState shape changes, and add a migration. */
export const SCHEMA_VERSION = 9

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

// ── Calendar (M10a) ──────────────────────────────────────────────────────────
// Seasons and years are derived from `tick` (sim/calendar.ts): no stored
// state, no events. Like days, they turn over at dawn (06:00).
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
/** In calendar order; tick 0 is Spring 1, Year 1. */
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']
export const DAYS_PER_SEASON = 12
/** 4 seasons × 12 days. */
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length
export const TICKS_PER_SEASON = DAYS_PER_SEASON * TICKS_PER_DAY
export const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY

/** Ticks per second of real time at 1x speed. Used by the app layer, never by sim logic. */
export const BASE_TICKS_PER_SECOND = 5

/** Supported simulation speed multipliers. */
// 100x (500 ticks/s) added after M9 so seasons and ecology can be watched in a session.
// The controller still caps each frame at MAX_TICKS_PER_FRAME, so on a slow device
// 100x runs as fast as it can rather than falling behind.
export const SPEEDS = [1, 3, 10, 100] as const
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
export const BERRY_REGROW_INTERVAL = 48 // 5 units per bush per day (mature; half for young/old)
export const TREE_REGROW_INTERVAL = 160 // 1.5 units per tree per day (mature; half for young)

// ── Plant lifecycle (M10b, docs/design/LIVING_WORLD_TDS.md §7.1–7.2) ─────────
// Stages by age in whole days: seedling < SEEDLING_DAYS ≤ young < MATURE_AT ≤
// mature < floor(lifespan × OLD_AT‰ / 1000) ≤ old < lifespan ≤ death.
// Trees are short-lived pioneers (GDD §3.3); a dead tree is harvestable deadwood.

/**
 * Plant senescence — the 'old' stage and death. On since M10c, together with
 * reproduction (TDS §7.11: never one without the other). Saves from before
 * M10c are migrated to v8 with re-staggered plant ages, so switching this on
 * never kills a world's plants at its first dawn.
 */
export const PLANT_SENESCENCE_ENABLED = true
/** Seed dispersal and fallen-fruit germination (M10c). */
export const PLANT_REPRODUCTION_ENABLED = true
export const PLANT_SEEDLING_DAYS = { berries: 2, wood: 6 } as const
export const PLANT_MATURE_AT_DAYS = { berries: 5, wood: 20 } as const
export const PLANT_OLD_AT_PERMILLE = { berries: 800, wood: 750 } as const
export const PLANT_LIFESPAN_DAYS = { berries: { min: 28, max: 44 }, wood: { min: 90, max: 150 } } as const
/** Units cap by stage. Mature equals v0.1 (BERRY_MAX / TREE_WOOD_MAX), so day-1 balance is unchanged. Deadwood keeps its wood at death. */
export const PLANT_STAGE_MAX = {
  berries: { seedling: 0, young: 3, mature: BERRY_MAX, old: 4 },
  wood: { seedling: 0, young: 4, mature: TREE_WOOD_MAX, old: TREE_WOOD_MAX },
} as const
export type RegrowthRate = 'none' | 'half' | 'full'
export const PLANT_REGROWTH: Readonly<Record<'berries' | 'wood', Record<'seedling' | 'young' | 'mature' | 'old' | 'dead', RegrowthRate>>> = {
  berries: { seedling: 'none', young: 'half', mature: 'full', old: 'half', dead: 'none' },
  wood: { seedling: 'none', young: 'half', mature: 'full', old: 'none', dead: 'none' },
}
/** Deadwood loses one unit (to ledger.woodDecayed) every this many days after death. */
export const DEADWOOD_ROT_DAYS = 4

// ── Plant reproduction (M10c, TDS §7.1–7.2) ──────────────────────────────────
// Once per dawn each seed-bearing plant may cast one seed. Stripped plants
// can't seed (GDD §3.9); a dying bush's remaining berries may sprout nearby.
// New plants start as seedlings holding nothing, so reproduction never adds
// resources — those still enter only through counted regrowth.
/**
 * A plant must hold at least this much at dawn to cast a seed (a bush picked
 * bare cannot spread).
 * M10c tuning: berries 3 → 1 (TDS risk R2's fallback). At 60 citizens every
 * bush on the island was stripped daily, none ever held 3 at dawn, and the
 * whole stock aged out within one lifetime: a 60-citizen village starved.
 */
export const SEED_MIN_UNITS = { berries: 1, wood: 4 } as const
/** Daily chance (‰) that an eligible plant casts a seed; halved when old. M10c tuning: berries 120 → 200 (see SEED_MIN_UNITS). */
export const SEED_CHANCE_PERMILLE = { berries: 200, wood: 50 } as const
/** A seed lands within this Chebyshev radius (never on its parent). */
export const DISPERSAL_RADIUS = { berries: 3, wood: 2 } as const
/**
 * A seed germinates only if at most this many same-kind plants are among the
 * 8 neighbours (deadwood counts as a tree). M10c tuning: berries 2 → 1, so
 * crowding — not the safety cap — limits bush density once seeding is easier.
 */
export const CROWD_MAX = { berries: 1, wood: 5 } as const
/** Per berry on a dying bush (up to FALLEN_FRUIT_MAX_ROLLS): chance (‰) it sprouts on the bush's tile or a neighbour. */
export const FALLEN_FRUIT_PERMILLE = 150
export const FALLEN_FRUIT_MAX_ROLLS = 6
/** No germination within this Manhattan distance of any structure (or on one). Existing plants there stay. */
export const SETTLED_CLEARING = 2
/** Safety bound (‰ of land tiles): germination stops at this many plants of a kind. Reaching it means tuning is wrong. */
export const PLANT_SAFETY_CAP_PERMILLE = { berries: 200, wood: 450 } as const
/**
 * Habitat suitability 0–100 by terrain (ecology/habitat.ts adds neighbourhood
 * rules: sand needs grass next to it for bushes; ≥ 3 tree neighbours shade a
 * bush to 40%; a tree on grass is 40 at a forest edge, else 15).
 */
export const HABITAT = {
  berries: { grass: 100, forest: 30, sand: 15, rock: 0, water: 0 },
  wood: { grass: 15, forest: 100, sand: 0, rock: 0, water: 0 },
} as const
export const SHADE_TREES = 3
export const SHADE_PERCENT = 40
export const FOREST_EDGE_TREES = 2
export const FOREST_EDGE_SUITABILITY = 40

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
/** …and at most this many walking steps from it (a house across a ridge is a bad site). */
export const SITE_MAX_WALK_STEPS = 12
/**
 * Population V1: once the inner ring (≤ SITE_MAX_CAMP_DISTANCE) has no valid
 * site left — it holds about ten shelters — the village may build further out.
 * The inner ring is always tried first, so small villages are unaffected.
 */
export const SITE_OUTER_CAMP_DISTANCE = 10
export const SITE_OUTER_WALK_STEPS = 20
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
// M9: raised from 45 — sharing happened ~0.5×/village/month, too rare to matter.
export const SHARE_HUNGER_SATIETY = 55
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
// M9: raised from 8/6 — at the old values a grudge never reached RIVALRY_AFFINITY in 30-day sweeps.
export const ARGUE_AFFINITY_BASE = 12
export const ARGUE_AFFINITY_TOUCHY = 8
export const SHARE_AFFINITY_RECEIVER = 15
export const SHARE_AFFINITY_GIVER = 5
/** Argument probability: base + low-sociability + stress + bad-blood terms, capped. */
export const ARGUE_BASE = 0.05
export const ARGUE_MAX = 0.6
/** Relationship milestones that produce events (once per crossing). */
export const FRIENDSHIP_AFFINITY = 50
export const RIVALRY_AFFINITY = -40
/** Grudges heal slowly: a chat raises affinity only GRUDGE_HEALING × as much while it is below GRUDGE_AFFINITY (M9). */
export const GRUDGE_AFFINITY = -10
export const GRUDGE_HEALING = 0.5
/** Partners with affinity below this are avoided. */
export const AVOID_AFFINITY = -50

// ── Population V1 (schema v7, docs/design/LIVING_WORLD_TDS.md §8) ──────────
// Ages are in world years (TICKS_PER_YEAR = 48 days), game-paced so a founding
// generation is replaced within a session at 100×.
export const ADULT_AGE = 14
export const ELDER_AGE = 50
/** Nobody lives past this age: the old-age hazard is certain on this birthday. */
export const MAX_AGE = 65
/** Founders' ages at world creation (inclusive). */
export const FOUNDER_AGE = { min: 18, max: 36 } as const
/** Partners must both be this age range to have a child. */
export const FERTILE_AGE = { min: 16, max: 42 } as const
/** Mutual affinity and familiarity both partners need (friendship is 50: deliberately reachable). */
export const PARTNER_AFFINITY = 30
export const PARTNER_FAMILIARITY = 30
/** Daily chance (‰) that an eligible couple has a child. */
export const BIRTH_CHANCE_PERMILLE = 40
/** A parent has at most one child per this many days. */
export const BIRTH_SPACING_DAYS = 48
/** Births need stockpile food ≥ this × living citizens. */
export const BIRTH_FOOD_PER_CAPITA = 3
export const MAX_POPULATION = 60
/** A home may hold this many residents above SHELTER_CAPACITY (children of its residents). */
export const MAX_OVERCROWD = 2
/** While prosperous, the planner keeps this many spare beds. */
export const HOUSING_HEADROOM = 3
/** Prosperous = stockpile food ≥ this × living (and population below the cap). */
export const PROSPERITY_FOOD_PER_CAPITA = 5
/** Children's satiety decays at this share of the adult rate. */
export const CHILD_SATIETY_FACTOR = 0.6
/** Children wander within this Manhattan distance of the campfire. */
export const CHILD_ROAM_RADIUS = 4
/** A child's traits are the parents' average ± up to this much (then rounded). */
export const CHILD_TRAIT_VARIATION = 0.1
/** Explorers are not assigned to newborns beyond this many. */
export const MAX_EXPLORERS = 2
/** The dead move to the compact archive this many days after death. */
export const ARCHIVE_AFTER_DAYS = 48
export const ARCHIVE_MAX = 400

// ── Memory (M6) ─────────────────────────────────────────────────────────────

export const MAX_MEMORIES = 24
/** A repeat of the same kind/subject/tile within this window refreshes the old memory. */
export const MEMORY_MERGE_TICKS = 240
/** Memories older than this no longer influence decisions (they may still be kept). */
export const MEMORY_RELEVANCE_TICKS = 480
/** Citizens within this distance witness a death. */
export const WITNESS_RADIUS = 6

// ── Returning fog and resurveying (schema v9) ───────────────────────────────
// Discovery is permanent (map.discovered: terrain, connectivity, paths). What
// fades is *freshness*: map.lastSeen records when each tile was last observed.
/** Tiles observed within this many days are clear; fog then fades in until FOG_FULL_DAYS. */
export const FOG_CLEAR_DAYS = 12
export const FOG_FULL_DAYS = 24
/** Citizens observe their surroundings every this many ticks (10 times a day). */
export const OBSERVE_INTERVAL = 24
/** Ordinary sight: Euclidean radius around every living citizen. */
export const CITIZEN_SIGHT_RADIUS = 2
/** The inhabited settlement stays in view: around the campfire and every occupied shelter. */
export const CAMP_SIGHT_RADIUS = 3
export const SHELTER_SIGHT_RADIUS = 2
/** A resurvey target must refresh at least this many fading or stale tiles. */
export const RESURVEY_MIN_GAIN = 8
/** Resurveying is less urgent than exploring the unknown: its score is scaled by this. */
export const RESURVEY_WEIGHT = 0.8

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
/** Beyond this many reserves' worth, foraging demand drops to FORAGE_SURPLUS_DEMAND (M9: stockpiles grew without limit). */
export const FOOD_SURPLUS_RESERVES = 3
export const FORAGE_SURPLUS_DEMAND = 0.05
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
