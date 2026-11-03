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

export interface ResourceNode {
  kind: ResourceKind
  amount: number
  max: number
}

export interface TileMap {
  width: number
  height: number
  /** Length width * height, indexed by TileIndex. */
  terrain: Terrain[]
  resources: (ResourceNode | null)[]
  /** Civilization-wide fog of war: 1 = discovered. */
  discovered: (0 | 1)[]
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

export interface Relationship {
  /** -100..100 */
  affinity: number
  /** 0..100 */
  familiarity: number
  lastTick: number
}

export type MemoryKind =
  | 'foundResource'
  | 'resourceDepleted'
  | 'chat'
  | 'argument'
  | 'receivedFood'
  | 'builtShelter'
  | 'sawDeath'
  | 'discovered'

export interface Memory {
  tick: number
  kind: MemoryKind
  subjectId?: number
  tile?: TileIndex
  /** -1..1 */
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
  /** Top scores from the last decision, for the inspector. */
  lastScores: ActionScore[]
  alive: boolean
  diedTick: number | null
}

export type StructureKind = 'campfire' | 'shelter'

export interface Structure {
  id: number
  kind: StructureKind
  tile: TileIndex
  buildProgress: number
  buildCost: number
  woodDelivered: number
  complete: boolean
  residentIds: number[]
}

export type SimEventKind =
  | 'worldCreated'
  | 'dayStarted'
  | 'shelterStarted'
  | 'shelterCompleted'
  | 'chat'
  | 'argument'
  | 'sharedFood'
  | 'discovered'
  | 'starving'
  | 'died'
  | 'friendship'
  | 'rivalry'

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
  /** Next id to hand out; shared by citizens, structures and events. */
  nextId: number
  map: TileMap
  /** Sorted by id. Dead citizens stay in the list with alive = false. */
  citizens: Citizen[]
  structures: Structure[]
  stockpile: Stockpile
  /** Oldest first; capped at MAX_EVENTS. */
  events: SimEvent[]
}
