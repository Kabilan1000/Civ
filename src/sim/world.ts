import { createCitizens } from './citizens/create.ts'
import { resolveConfig } from './config.ts'
import { INITIAL_STOCKPILE, SCHEMA_VERSION, START_DISCOVERY_RADIUS } from './constants.ts'
import { pushEvent } from './events.ts'
import { allocateId } from './ids.ts'
import { revealAround } from './map/discovery.ts'
import { generateMap } from './map/generate.ts'
import { seedRng } from './rng.ts'
import { decide } from './systems/decide.ts'
import { advanceTasks } from './systems/tasks.ts'
import { advanceTime } from './systems/time.ts'
import type { Structure, TileIndex, WorldConfig, WorldState } from './types.ts'

function createCampfire(id: number, tile: TileIndex): Structure {
  return {
    id,
    kind: 'campfire',
    tile,
    buildProgress: 0,
    buildCost: 0,
    woodDelivered: 0,
    complete: true,
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

  const state: WorldState = {
    schemaVersion: SCHEMA_VERSION,
    config,
    tick: 0,
    rng: seedRng(config.seed),
    nextId: 1,
    map,
    citizens: [],
    structures: [],
    stockpile: { ...INITIAL_STOCKPILE },
    events: [],
  }

  state.structures.push(createCampfire(allocateId(state), campTile))
  state.citizens = createCitizens(state, campTile)
  pushEvent(state, 'worldCreated', state.citizens.map((c) => c.id), {
    seed: config.seed,
    mapAttempt: attempt,
    mapRepairs: repairs,
  })
  return state
}

/**
 * Advance the world by exactly one tick, mutating it in place.
 * System order is fixed (see docs/ARCHITECTURE.md §3.4). Needs, health and
 * resources (M4+) slot in between time and decide; social and stats after act.
 */
export function step(state: WorldState): void {
  advanceTime(state)
  decide(state)
  advanceTasks(state)
}

export function stepN(state: WorldState, n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`stepN: n must be a non-negative integer, got ${n}`)
  for (let i = 0; i < n; i++) step(state)
}
