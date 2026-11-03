import { assignFounderAges, createCitizens } from './citizens/create.ts'
import { resolveConfig } from './config.ts'
import { INITIAL_STOCKPILE, SCHEMA_VERSION, START_DISCOVERY_RADIUS } from './constants.ts'
import { pushEvent } from './events.ts'
import { allocateId } from './ids.ts'
import { revealAround } from './map/discovery.ts'
import { generateMap } from './map/generate.ts'
import { seedRng } from './rng.ts'
import { updateConstruction } from './systems/construction.ts'
import { decide } from './systems/decide.ts'
import { recordHistory, recordSample } from './systems/history.ts'
import { updateNeeds } from './systems/needs.ts'
import { assignInitialAges } from './ecology/flora.ts'
import { DEFAULT_ECOLOGY_RULES, updateEcology, type EcologyRules } from './systems/ecology.ts'
import { updateLifeCycle } from './systems/lifecycle.ts'
import { advanceTasks } from './systems/tasks.ts'
import { advanceTime } from './systems/time.ts'
import type { Structure, TileIndex, WorldConfig, WorldState } from './types.ts'

function createCampfire(id: number, tile: TileIndex): Structure {
  return {
    id,
    kind: 'campfire',
    tile,
    stage: 'complete',
    buildProgress: 0,
    buildCost: 0,
    woodDelivered: 0,
    woodRequired: 0,
    lastWorkTick: 0,
    residentIds: [],
  }
}

/**
 * Build a new world at tick 0 from a seed. Fully deterministic: the same
 * config always yields an identical state. The map uses its own derived RNG
 * (see map/generate.ts); WorldState.rng is then used in a fixed order for
 * citizens. Creation order: map, campfire, citizens, worldCreated event.
 */
export function createWorld(overrides: Partial<WorldConfig> = {}): WorldState {
  const config = resolveConfig(overrides)
  const { map, campTile, attempt, repairs } = generateMap(config.seed, config.width, config.height, {
    spawnTiles: config.citizenCount,
  })
  revealAround(map, campTile, START_DISCOVERY_RADIUS)
  assignInitialAges(map, config.seed) // own derived stream: placement is unchanged

  const state: WorldState = {
    schemaVersion: SCHEMA_VERSION,
    config,
    tick: 0,
    rng: seedRng(config.seed),
    nextId: 1,
    nextEventId: 1,
    map,
    citizens: [],
    structures: [],
    stockpile: { ...INITIAL_STOCKPILE },
    ledger: {
      foodGathered: 0,
      woodGathered: 0,
      foodRegrown: 0,
      woodRegrown: 0,
      foodEaten: 0,
      foodLost: 0,
      woodLost: 0,
      foodDecayed: 0,
      woodDecayed: 0,
    },
    history: [],
    events: [],
    ecology: {
      rng: seedRng(`${config.seed}#ecology`),
      counters: { births: { berries: 0, wood: 0 }, deaths: { berries: 0, wood: 0 }, seedsCast: 0, fallenFruitSprouts: 0 },
    },
    archive: [],
    population: {
      rng: seedRng(`${config.seed}#population`),
      counters: { births: 0, deaths: 0, oldAgeDeaths: 0, partnerships: 0, comingOfAge: 0, archived: 0 },
    },
  }

  state.structures.push(createCampfire(allocateId(state), campTile))
  state.citizens = createCitizens(state, campTile)
  assignFounderAges(state.citizens, config.seed) // own derived stream
  recordSample(state) // tick 0
  pushEvent(state, 'worldCreated', state.citizens.map((c) => c.id), {
    seed: config.seed,
    mapAttempt: attempt,
    mapRepairs: repairs,
  })
  return state
}

/**
 * Advance the world by exactly one tick, mutating it in place.
 * System order is fixed (see docs/ARCHITECTURE.md §3.4):
 * time → needs (incl. health, death) → ecology → life cycle (dawn) → construction → decide → act → history.
 * Social and stats systems (M6/M7) will follow act.
 */
export function step(state: WorldState): void {
  stepWithRules(state, DEFAULT_SIM_RULES)
}

/** Rule switches for systems still under development (only tests change them). */
export interface SimRules {
  ecology: EcologyRules
  /**
   * Population V1 (life cycle + housing headroom). Always on in the game; tests
   * turn it off to prove everything else still behaves exactly like v0.1.
   */
  population: boolean
}

export const DEFAULT_SIM_RULES: Readonly<SimRules> = { ecology: DEFAULT_ECOLOGY_RULES, population: true }

/**
 * step() with explicit rules — e.g. plant senescence on, which stays off by
 * default until M10c (TDS §7.11). Not part of the public sim API.
 */
export function stepWithRules(state: WorldState, rules: Readonly<SimRules>): void {
  advanceTime(state)
  updateNeeds(state)
  updateEcology(state, rules.ecology)
  if (rules.population) updateLifeCycle(state)
  updateConstruction(state, { headroom: rules.population })
  decide(state)
  advanceTasks(state)
  recordHistory(state)
}

export function stepN(state: WorldState, n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`stepN: n must be a non-negative integer, got ${n}`)
  for (let i = 0; i < n; i++) step(state)
}
