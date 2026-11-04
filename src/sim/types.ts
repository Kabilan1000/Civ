// Serializable simulation data model. Everything reachable from WorldState
// must be plain JSON: no classes, Map/Set, functions or cycles. Entities refer
// to each other by numeric id.

/** Flat tile index: y * width + x. */
export type TileIndex = number

export interface Point {
  x: number
  y: number
}

export type Terrain = 'water' | 'sand' | 'grass' | 'forest' | 'rock'
export type ResourceKind = 'berries' | 'wood'
export type Role = 'forager' | 'builder' | 'explorer'

/** sfc32 generator state: four uint32 words. */
export type RngState = [number, number, number, number]

/**
 * Plant life stages (M10b, systems/ecology.ts). 'dead' is harvestable
 * deadwood and exists only for trees.
 */
export type PlantStage = 'seedling' | 'young' | 'mature' | 'old' | 'dead'

/** A plant on a tile: a berry bush or a (pioneer) tree. Identified by its tile index, never by an id. */
export interface ResourceNode {
  kind: ResourceKind
  /** Whole units on the plant, 0..max. */
  amount: number
  /** Cap for the current stage (stored so AI and renderer need not know the calendar). For deadwood: its wood at death. */
  max: number
  stage: PlantStage
  /** Tick the plant germinated; negative for plants older than the world. Age in days = floor((tick − bornTick) / 240). */
  bornTick: number
  /** Whole days. */
  lifespanDays: number
  /** Tick the tree died (stage 'dead'); null while alive. */
  diedTick: number | null
}

export interface TileMap {
  width: number
  height: number
  /** Length width * height, indexed by TileIndex. */
  terrain: Terrain[]
  resources: (ResourceNode | null)[]
  /** Permanent discovery (terrain and connectivity are never forgotten): 1 = discovered. */
  discovered: (0 | 1)[]
  /** Tick each tile was last observed (schema v9), or −1 if never. Freshness fades; discovery does not. */
  lastSeen: number[]
  /** Incremented on any map change so renderers can re-bake cached layers. */
  version: number
}

/** Personality traits, each in [0, 1]. */
export interface Personality {
  sociability: number
  diligence: number
  curiosity: number
  resilience: number
}

/** Needs, each in [0, 100] where 100 = fully satisfied. The UI shows satiety inverted as "Hunger". */
export interface Needs {
  satiety: number
  energy: number
  social: number
  health: number
}

export type ActionKind =
  | 'eat'
  | 'forage'
  | 'chop'
  | 'deliver'
  | 'share'
  | 'build'
  | 'rest'
  | 'socialize'
  | 'explore'
  | 'wander'
  | 'idle'

export interface Task {
  kind: ActionKind
  /** Action-specific phase name, e.g. 'moveTo', 'gather', 'deposit'. */
  phase: string
  targetTile: TileIndex | null
  /** Citizen or structure id. */
  targetId: number | null
  ticksLeft: number
  startedTick: number
}

/**
 * How one citizen sees another (directional: A's record of B lives on A).
 * Familiarity is always changed equally on both sides, so it stays symmetric;
 * affinity can differ (a giver and a receiver feel differently).
 * No record = strangers (familiarity 0, affinity 0).
 */
export interface Relationship {
  /** -100..100 */
  affinity: number
  /** 0..100 */
  familiarity: number
  /** Tick of the last completed interaction (pair cooldown). */
  lastTick: number
}

export type MemoryKind =
  | 'foundResource'
  | 'resourceDepleted'
  | 'chat'
  | 'argument'
  | 'receivedFood'
  | 'gaveFood'
  | 'builtShelter'
  | 'sawDeath'
  | 'discovered'
  | 'childBorn'
  | 'partnered'

/** Something that really happened to this citizen. See citizens/memory.ts. */
export interface Memory {
  /** Unique across the world (shared id counter). */
  id: number
  tick: number
  kind: MemoryKind
  /** The other citizen involved, if any. */
  subjectId?: number
  /** Where it happened / what tile it concerns, if any. */
  tile?: TileIndex
  /** -1..1: how good or bad it felt. Also its salience for eviction. */
  valence: number
}

export interface Carrying {
  kind: ResourceKind
  amount: number
}

export interface ActionScore {
  kind: ActionKind
  score: number
}

export interface Citizen {
  id: number
  name: string
  role: Role
  personality: Personality
  needs: Needs
  /** Current tile. */
  pos: Point
  path: TileIndex[]
  pathIndex: number
  moveTicksLeft: number
  task: Task | null
  nextDecisionTick: number
  carrying: Carrying | null
  homeId: number | null
  /** Keyed by the other citizen's id (as a string, since JSON keys are strings). */
  relationships: Record<string, Relationship>
  memories: Memory[]
  /** All action scores from the last decision, best first, for the inspector. */
  lastScores: ActionScore[]
  /** Tick at which lastScores were computed, or null (never decided). */
  lastDecisionTick: number | null
  /** Tick of the last completed social interaction, or null (never). */
  lastSocialTick: number | null
  alive: boolean
  diedTick: number | null
  deathCause: DeathCause | null
  // ── Population V1 (schema v7) ──
  /** Tick of birth, aligned to a dawn; negative for founders. Age in world years = floor((tick − bornTick) / TICKS_PER_YEAR). */
  bornTick: number
  /** Parents' ids (null for founders). They may since have been archived. */
  parentIds: [number, number] | null
  /** Living partner (mutual), or null. Cleared on the partner's death. */
  partnerId: number | null
  /** Children's ids, ascending. */
  childIds: number[]
  /** Tick this citizen last became a parent, or null. */
  lastChildTick: number | null
}

export type DeathCause = 'starvation' | 'exhaustion' | 'oldAge'

/** A citizen who died long ago, compacted (Population V1). */
export interface PersonRecord {
  id: number
  name: string
  role: Role
  bornTick: number
  diedTick: number
  cause: DeathCause
  parentIds: [number, number] | null
  partnerId: number | null
  childIds: number[]
}

/** Population bookkeeping (Population V1). People themselves are in `citizens` and `archive`. */
export interface PopulationState {
  /** Dedicated stream for births, newborns' names/traits/roles and old-age rolls. */
  rng: RngState
  /** Cumulative since world creation (or migration to schema v7). */
  counters: {
    births: number
    deaths: number
    oldAgeDeaths: number
    partnerships: number
    comingOfAge: number
    archived: number
  }
}

export type StructureKind = 'campfire' | 'shelter'

/**
 * planned             site chosen; waiting for all woodRequired to be delivered
 * underConstruction   all wood delivered; builders add labour ticks
 * complete            buildProgress reached buildCost; houses residents
 */
export type StructureStage = 'planned' | 'underConstruction' | 'complete'

export interface Structure {
  id: number
  kind: StructureKind
  tile: TileIndex
  stage: StructureStage
  /** Labour ticks done / needed. */
  buildProgress: number
  buildCost: number
  /** Wood handed over to the site / needed. Delivered wood is held by the site. */
  woodDelivered: number
  woodRequired: number
  /** Last tick wood was delivered or labour done; used to abandon stale sites. */
  lastWorkTick: number
  /** Living citizens who live here (shelters only), ascending id. */
  residentIds: number[]
}

export type SimEventKind =
  | 'worldCreated'
  | 'dayStarted'
  | 'shelterStarted'
  | 'shelterCompleted'
  | 'shelterAbandoned'
  | 'movedIn'
  | 'chat'
  | 'argument'
  | 'sharedFood'
  | 'discovered'
  | 'starving'
  | 'died'
  | 'friendship'
  | 'rivalry'
  | 'born'
  | 'cameOfAge'
  | 'partnered'

export interface SimEvent {
  id: number
  tick: number
  kind: SimEventKind
  citizenIds: number[]
  data?: Record<string, number | string>
}

export interface Stockpile {
  food: number
  wood: number
}

/**
 * Cumulative resource accounting since world creation (all non-negative
 * integers). Lets tests and the dashboard check conservation:
 *   food on map + carried + stockpile.food + foodEaten + foodLost + foodDecayed
 *     = initial food + foodRegrown
 *   wood on map + carried + stockpile.wood + wood held by structures + woodLost + woodDecayed
 *     = initial wood + woodRegrown
 */
export interface Ledger {
  foodGathered: number
  woodGathered: number
  foodRegrown: number
  woodRegrown: number
  foodEaten: number
  /** Carried goods that perished with a citizen who died. */
  foodLost: number
  woodLost: number
  /** Units that left the world on plants: a dying bush's berries, a stage-cap drop, deadwood rot (M10b). */
  foodDecayed: number
  woodDecayed: number
}

/** Ecology bookkeeping (M10b). Plants themselves live in map.resources. */
export interface EcologyState {
  /** Dedicated sfc32 stream: ecology never draws from, or perturbs, the AI stream `WorldState.rng`. */
  rng: RngState
  /** Cumulative since world creation (or since migration to schema v6). */
  counters: {
    births: Record<ResourceKind, number>
    deaths: Record<ResourceKind, number>
    seedsCast: number
    fallenFruitSprouts: number
  }
}

/**
 * One genuine snapshot of the village, recorded every HISTORY_INTERVAL ticks
 * (systems/history.ts). Averages are over living citizens, rounded to whole
 * numbers so samples are compact and exactly reproducible.
 */
export interface HistorySample {
  tick: number
  population: number
  food: number
  wood: number
  housed: number
  /** Housing capacity of completed shelters. */
  capacity: number
  /** Discovered tiles. */
  discovered: number
  satiety: number
  energy: number
  health: number
  social: number
  /** Population V1: absent in samples recorded before the save reached schema v7. */
  children?: number
  adults?: number
  elders?: number
  /** Cumulative births and deaths (population counters) at sample time. */
  births?: number
  deaths?: number
}

export interface WorldConfig {
  seed: string
  width: number
  height: number
  citizenCount: number
}

export interface WorldState {
  schemaVersion: number
  config: WorldConfig
  /** Number of ticks simulated so far. See systems/time.ts for conventions. */
  tick: number
  rng: RngState
  /** Next id to hand out; shared by citizens, structures and memories. */
  nextId: number
  /** Next event id (schema v6+). Events have their own counter so new event kinds never shift entity ids. */
  nextEventId: number
  map: TileMap
  /** Sorted by id. Dead citizens stay in the list with alive = false. */
  citizens: Citizen[]
  structures: Structure[]
  stockpile: Stockpile
  ledger: Ledger
  /** Oldest first; at most HISTORY_MAX samples. */
  history: HistorySample[]
  /** Oldest first; capped at MAX_EVENTS. */
  events: SimEvent[]
  ecology: EcologyState
  /** Dead citizens compacted after ARCHIVE_AFTER_DAYS; oldest first, at most ARCHIVE_MAX. */
  archive: PersonRecord[]
  population: PopulationState
}
