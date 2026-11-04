// Versioned save format. serialize() is plain JSON.stringify; deserialize()
// parses, migrates older schema versions step by step, then validates the
// full shape before handing back a WorldState.

import {
  ARCHIVE_MAX,
  DAYS_PER_YEAR,
  FOUNDER_AGE,
  MAX_AGE,
  MAX_OVERCROWD,
  TICKS_PER_DAY,
  TICKS_PER_YEAR,
  HISTORY_MAX,
  MAX_EVENTS,
  MAX_MEMORIES,
  PLANT_STAGE_MAX,
  ROLES,
  SCHEMA_VERSION,
  SHELTER_CAPACITY,
  TERRAINS,
} from './constants.ts'
import { assignMigratedAges, fnv1a32 } from './ecology/flora.ts'
import { seedRng } from './rng.ts'
import type { TileMap, WorldState } from './types.ts'

export type SaveErrorCode = 'invalid-json' | 'unsupported-version' | 'invalid-data'

export class SaveError extends Error {
  readonly code: SaveErrorCode
  constructor(code: SaveErrorCode, message: string) {
    super(message)
    this.name = 'SaveError'
    this.code = code
  }
}

/**
 * migrations[v] upgrades raw data from schema v to v + 1. Each migration
 * only adds or reshapes fields; validation runs after the last one.
 */
type Migration = (data: Record<string, unknown>) => Record<string, unknown>
const migrations: Record<number, Migration> = {
  // v1 → v2 (M4): add the resource ledger. Older worlds start counting from 0,
  // so conservation checks hold from the moment they are loaded.
  1: (data) => ({
    ...data,
    ledger: { foodGathered: 0, woodGathered: 0, foodRegrown: 0, woodRegrown: 0, foodEaten: 0 },
  }),
  // v2 → v3 (M5): structures get an explicit construction stage, wood
  // requirement and last-work tick (replacing `complete`); citizens get a
  // death cause; the ledger counts goods lost with the dead.
  2: (data) => {
    const structures = (data.structures as Record<string, unknown>[]).map(({ complete, ...s }) => ({
      ...s,
      stage: complete ? 'complete' : 'planned',
      woodRequired: s.woodDelivered ?? 0,
      lastWorkTick: data.tick,
    }))
    const citizens = (data.citizens as Record<string, unknown>[]).map((c) => ({
      ...c,
      deathCause: c.alive === false ? 'starvation' : null,
    }))
    const ledger = { ...(data.ledger as Record<string, unknown>), foodLost: 0, woodLost: 0 }
    return { ...data, structures, citizens, ledger }
  },
  // v3 → v4 (M6): memories get unique ids (allocated from nextId in citizen
  // order — v3 never recorded any, but older hand-made data is handled);
  // citizens get lastSocialTick (null = never socialised).
  3: (data) => {
    let nextId = data.nextId as number
    const citizens = (data.citizens as Record<string, unknown>[]).map((c) => ({
      ...c,
      memories: ((c.memories as Record<string, unknown>[]) ?? []).map((m) => ({ id: nextId++, ...m })),
      lastSocialTick: null,
    }))
    return { ...data, citizens, nextId }
  },
  // v4 → v5 (M7): an empty history (no snapshots are fabricated for the
  // past — recording starts at the next HISTORY_INTERVAL tick) and
  // lastDecisionTick = null (the stored lastScores' tick is unknown).
  4: (data) => ({
    ...data,
    history: [],
    citizens: (data.citizens as Record<string, unknown>[]).map((c) => ({ ...c, lastDecisionTick: null })),
  }),
  // v5 → v6 (M10b): plant lifecycles. Every plant becomes mature with its
  // amount and max unchanged, and gets a lifespan and age derived from hashes
  // of seed and tile (staggered like new worlds, no RNG state; TDS §6.5). Plants are never
  // removed or moved — including those near structures, inside what is now
  // the settlement clearing (TDS §7.11). The ledger gains decay counters, the
  // world an ecology stream and counters, and events their own id counter
  // (starting at nextId, so every existing id stays unique). History samples
  // are kept unchanged.
  5: (data) => {
    const tick = data.tick as number
    const seed = String((data.config as Record<string, unknown>).seed)
    const map = data.map as Record<string, unknown>
    const migrated = {
      ...map,
      resources: (map.resources as (Record<string, unknown> | null)[]).map((r) => (r ? { ...r } : null)),
    } as unknown as TileMap
    assignMigratedAges(migrated, seed, tick)
    return {
      ...data,
      nextEventId: data.nextId,
      map: migrated,
      ledger: { ...(data.ledger as Record<string, unknown>), foodDecayed: 0, woodDecayed: 0 },
      ecology: {
        rng: seedRng(`${seed}#ecology@${tick}`),
        counters: { births: { berries: 0, wood: 0 }, deaths: { berries: 0, wood: 0 }, seedsCast: 0, fallenFruitSprouts: 0 },
      },
    }
  },
  // v6 → v7 (Population V1): every existing citizen is a founder-like adult
  // aged FOUNDER_AGE (birthday spread over the year), derived from a hash of
  // seed and id — no RNG state — with bornTick on a dawn. No families yet:
  // parents, partner and children start empty. An empty archive and a
  // population stream (seed#population@tick) with zero counters.
  6: (data) => {
    const tick = data.tick as number
    const seed = String((data.config as Record<string, unknown>).seed)
    const dayStart = tick - (tick % TICKS_PER_DAY)
    const citizens = (data.citizens as Record<string, unknown>[]).map((c) => {
      const h = fnv1a32(`${seed}:founder:${String(c.id)}`)
      const years = FOUNDER_AGE.min + (h % (FOUNDER_AGE.max - FOUNDER_AGE.min + 1))
      const dayOfYear = (h >>> 8) % DAYS_PER_YEAR
      return {
        ...c,
        bornTick: dayStart - (years * DAYS_PER_YEAR + dayOfYear) * TICKS_PER_DAY,
        parentIds: null,
        partnerId: null,
        childIds: [],
        lastChildTick: null,
      }
    })
    return {
      ...data,
      citizens,
      archive: [],
      population: {
        rng: seedRng(`${seed}#population@${tick}`),
        // Deaths that really happened before migration are counted (all were from needs).
        counters: { births: 0, deaths: (data.citizens as Record<string, unknown>[]).filter((c) => c.alive === false).length, oldAgeDeaths: 0, partnerships: 0, comingOfAge: 0, archived: 0 },
      },
    }
  },
  // v7 → v8 (M10c): plant senescence and reproduction switch on. Before M10c
  // plants kept ageing while senescence was off, so in an established world
  // most are already past their lifespan and would all die at the first dawn.
  // Every living mature plant (all of them, before M10c) therefore gets a
  // fresh lifespan and an age in its mature window relative to the save's
  // current day, from hashes of seed, tile and a 'v8' salt — staggered so that
  // no more than 10% of a kind share a death day. Positions, kinds, amounts
  // and caps are unchanged; citizens, families, buildings, ledger, events and
  // history are untouched.
  7: (data) => {
    const tick = data.tick as number
    const seed = String((data.config as Record<string, unknown>).seed)
    const map = data.map as Record<string, unknown>
    const migrated = {
      ...map,
      resources: (map.resources as (Record<string, unknown> | null)[]).map((r) => (r ? { ...r } : null)),
    } as unknown as TileMap
    assignMigratedAges(migrated, seed, tick, 'v8:', (n) => n.stage === 'mature')
    return { ...data, map: migrated }
  },
}

export function serialize(state: WorldState): string {
  return JSON.stringify(state)
}

export function deserialize(json: string): WorldState {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new SaveError('invalid-json', 'Save data is not valid JSON')
  }
  if (!isRecord(raw)) throw new SaveError('invalid-data', 'Save data must be a JSON object')

  let data = raw
  const version = data.schemaVersion
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new SaveError('unsupported-version', `Save has missing or invalid schemaVersion: ${String(version)}`)
  }
  if ((version as number) > SCHEMA_VERSION) {
    throw new SaveError(
      'unsupported-version',
      `Save schemaVersion ${String(version)} is newer than supported version ${SCHEMA_VERSION}`,
    )
  }
  for (let v = version as number; v < SCHEMA_VERSION; v++) {
    const migrate = migrations[v]
    if (!migrate) throw new SaveError('unsupported-version', `No migration from schemaVersion ${v}`)
    data = migrate(data)
    data.schemaVersion = v + 1
  }

  validateWorld(data)
  return data
}

// ── Validation ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(path: string, expected: string): never {
  throw new SaveError('invalid-data', `Invalid save data at ${path}: expected ${expected}`)
}

function obj(v: unknown, path: string): Record<string, unknown> {
  return isRecord(v) ? v : fail(path, 'object')
}

function arr(v: unknown, path: string): unknown[] {
  return Array.isArray(v) ? v : fail(path, 'array')
}

function int(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
    fail(path, `integer in [${min}, ${max}]`)
  }
  return v as number
}

function num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(path, `number in [${min}, ${max}]`)
  return v
}

function str(v: unknown, path: string): string {
  return typeof v === 'string' ? v : fail(path, 'string')
}

function bool(v: unknown, path: string): boolean {
  return typeof v === 'boolean' ? v : fail(path, 'boolean')
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  return options.includes(v as T) ? (v as T) : fail(path, `one of ${options.join(', ')}`)
}

function nullable<T>(v: unknown, path: string, check: (v: unknown, path: string) => T): T | null {
  return v === null ? null : check(v, path)
}

const RESOURCE_KINDS = ['berries', 'wood'] as const
const PLANT_STAGES = ['seedling', 'young', 'mature', 'old', 'dead'] as const
const ACTION_KINDS = ['eat', 'forage', 'chop', 'deliver', 'share', 'build', 'rest', 'socialize', 'explore', 'wander', 'idle'] as const
const STRUCTURE_KINDS = ['campfire', 'shelter'] as const
const STRUCTURE_STAGES = ['planned', 'underConstruction', 'complete'] as const
const DEATH_CAUSES = ['starvation', 'exhaustion', 'oldAge'] as const
const MEMORY_KINDS = [
  'foundResource', 'resourceDepleted', 'chat', 'argument',
  'receivedFood', 'gaveFood', 'builtShelter', 'sawDeath', 'discovered', 'childBorn', 'partnered',
] as const
const EVENT_KINDS = [
  'worldCreated', 'dayStarted', 'shelterStarted', 'shelterCompleted', 'shelterAbandoned', 'movedIn', 'chat', 'argument',
  'sharedFood', 'discovered', 'starving', 'died', 'friendship', 'rivalry', 'born', 'cameOfAge', 'partnered',
] as const

function validateWorld(d: Record<string, unknown>): asserts d is Record<string, unknown> & WorldState {
  const config = obj(d.config, 'config')
  str(config.seed, 'config.seed')
  const width = int(config.width, 'config.width', 1)
  const height = int(config.height, 'config.height', 1)
  int(config.citizenCount, 'config.citizenCount', 1)

  int(d.tick, 'tick', 0)
  const rng = arr(d.rng, 'rng')
  if (rng.length !== 4) fail('rng', '4 uint32 words')
  rng.forEach((w, i) => int(w, `rng[${i}]`, 0, 0xffff_ffff))
  const nextId = int(d.nextId, 'nextId', 1)
  const nextEventId = int(d.nextEventId, 'nextEventId', 1)

  // Map
  const map = obj(d.map, 'map')
  if (map.width !== width || map.height !== height) fail('map', 'dimensions matching config')
  const size = width * height
  const sized = (v: unknown, path: string) => {
    const a = arr(v, path)
    if (a.length !== size) fail(path, `array of length ${size}`)
    return a
  }
  sized(map.terrain, 'map.terrain').forEach((t, i) => oneOf(t, TERRAINS, `map.terrain[${i}]`))
  sized(map.resources, 'map.resources').forEach((r, i) =>
    nullable(r, `map.resources[${i}]`, (v, p) => {
      const node = obj(v, p)
      const kind = oneOf(node.kind, RESOURCE_KINDS, `${p}.kind`)
      const stage = oneOf(node.stage, PLANT_STAGES, `${p}.stage`)
      const max = int(node.max, `${p}.max`, 0)
      int(node.amount, `${p}.amount`, 0, max)
      int(node.bornTick, `${p}.bornTick`, -Infinity, d.tick as number)
      int(node.lifespanDays, `${p}.lifespanDays`, 1, 1000)
      if (stage === 'dead') {
        if (kind !== 'wood') fail(`${p}.stage`, "'dead' only for trees")
        int(node.diedTick, `${p}.diedTick`, 0, d.tick as number)
        if (max > PLANT_STAGE_MAX.wood.mature) fail(`${p}.max`, `at most ${PLANT_STAGE_MAX.wood.mature} for deadwood`)
      } else {
        if (node.diedTick !== null) fail(`${p}.diedTick`, 'null for a living plant')
        if (max !== PLANT_STAGE_MAX[kind][stage]) fail(`${p}.max`, `${PLANT_STAGE_MAX[kind][stage]} (the ${stage} cap)`)
      }
      return node
    }),
  )
  sized(map.discovered, 'map.discovered').forEach((v, i) => int(v, `map.discovered[${i}]`, 0, 1))
  int(map.version, 'map.version', 0)

  const tile = (v: unknown, p: string) => int(v, p, 0, size - 1)
  const id = (v: unknown, p: string) => int(v, p, 1, nextId - 1)
  const seenIds = new Set<number>()
  const uniqueId = (v: unknown, p: string) => {
    const value = id(v, p)
    if (seenIds.has(value)) fail(p, 'unique id')
    seenIds.add(value)
    return value
  }

  // Citizens
  let lastCitizenId = 0
  const citizenIds = new Set(
    arr(d.citizens, 'citizens').map((c) => (isRecord(c) ? c.id : undefined)).filter((x): x is number => Number.isInteger(x)),
  )
  const citizenRef = (v: unknown, p: string) => {
    const value = id(v, p)
    if (!citizenIds.has(value)) fail(p, 'an existing citizen id')
    return value
  }
  arr(d.citizens, 'citizens').forEach((raw, i) => {
    const p = `citizens[${i}]`
    const c = obj(raw, p)
    const cid = uniqueId(c.id, `${p}.id`)
    if (cid <= lastCitizenId) fail(`${p}.id`, 'citizens sorted by ascending id')
    lastCitizenId = cid
    str(c.name, `${p}.name`)
    oneOf(c.role, ROLES, `${p}.role`)
    const pers = obj(c.personality, `${p}.personality`)
    for (const k of ['sociability', 'diligence', 'curiosity', 'resilience']) num(pers[k], `${p}.personality.${k}`, 0, 1)
    const needs = obj(c.needs, `${p}.needs`)
    for (const k of ['satiety', 'energy', 'social', 'health']) num(needs[k], `${p}.needs.${k}`, 0, 100)
    const pos = obj(c.pos, `${p}.pos`)
    int(pos.x, `${p}.pos.x`, 0, width - 1)
    int(pos.y, `${p}.pos.y`, 0, height - 1)
    const path = arr(c.path, `${p}.path`)
    path.forEach((t, j) => tile(t, `${p}.path[${j}]`))
    int(c.pathIndex, `${p}.pathIndex`, 0, path.length)
    int(c.moveTicksLeft, `${p}.moveTicksLeft`, 0)
    nullable(c.task, `${p}.task`, (v, tp) => {
      const t = obj(v, tp)
      oneOf(t.kind, ACTION_KINDS, `${tp}.kind`)
      str(t.phase, `${tp}.phase`)
      nullable(t.targetTile, `${tp}.targetTile`, tile)
      nullable(t.targetId, `${tp}.targetId`, id)
      int(t.ticksLeft, `${tp}.ticksLeft`, 0)
      int(t.startedTick, `${tp}.startedTick`, 0)
      return t
    })
    int(c.nextDecisionTick, `${p}.nextDecisionTick`, 0)
    nullable(c.carrying, `${p}.carrying`, (v, cp) => {
      const carry = obj(v, cp)
      oneOf(carry.kind, RESOURCE_KINDS, `${cp}.kind`)
      num(carry.amount, `${cp}.amount`, 0)
      return carry
    })
    nullable(c.homeId, `${p}.homeId`, id)
    for (const [key, rel] of Object.entries(obj(c.relationships, `${p}.relationships`))) {
      const rp = `${p}.relationships.${key}`
      if (String(citizenRef(Number(key), `${rp} (key)`)) !== key || Number(key) === cid) {
        fail(`${rp} (key)`, 'another citizen\'s id')
      }
      const r = obj(rel, rp)
      num(r.affinity, `${rp}.affinity`, -100, 100)
      num(r.familiarity, `${rp}.familiarity`, 0, 100)
      int(r.lastTick, `${rp}.lastTick`, 0)
    }
    const memories = arr(c.memories, `${p}.memories`)
    if (memories.length > MAX_MEMORIES) fail(`${p}.memories`, `at most ${MAX_MEMORIES} entries`)
    memories.forEach((m, j) => {
      const mp = `${p}.memories[${j}]`
      const mem = obj(m, mp)
      uniqueId(mem.id, `${mp}.id`)
      int(mem.tick, `${mp}.tick`, 0, d.tick as number)
      oneOf(mem.kind, MEMORY_KINDS, `${mp}.kind`)
      if (mem.subjectId !== undefined) id(mem.subjectId, `${mp}.subjectId`) // may be archived
      if (mem.tile !== undefined) tile(mem.tile, `${mp}.tile`)
      num(mem.valence, `${mp}.valence`, -1, 1)
    })
    arr(c.lastScores, `${p}.lastScores`).forEach((s, j) => {
      const score = obj(s, `${p}.lastScores[${j}]`)
      oneOf(score.kind, ACTION_KINDS, `${p}.lastScores[${j}].kind`)
      num(score.score, `${p}.lastScores[${j}].score`)
    })
    nullable(c.lastSocialTick, `${p}.lastSocialTick`, (v, lp) => int(v, lp, 0, d.tick as number))
    nullable(c.lastDecisionTick, `${p}.lastDecisionTick`, (v, lp) => int(v, lp, 0, d.tick as number))
    const alive = bool(c.alive, `${p}.alive`)
    const diedTick = nullable(c.diedTick, `${p}.diedTick`, (v, dp) => int(v, dp, 0))
    const cause = nullable(c.deathCause, `${p}.deathCause`, (v, cp) => oneOf(v, DEATH_CAUSES, cp))
    if (alive !== (diedTick === null) || alive !== (cause === null)) fail(`${p}`, 'alive, diedTick and deathCause to agree')
    // Population V1
    const born = int(c.bornTick, `${p}.bornTick`, -Infinity, d.tick as number)
    if (alive && Math.floor(((d.tick as number) - born) / TICKS_PER_YEAR) > MAX_AGE) fail(`${p}.bornTick`, `a living age of at most ${MAX_AGE}`)
    nullable(c.parentIds, `${p}.parentIds`, (v, pp) => {
      const ps = arr(v, pp)
      if (ps.length !== 2) fail(pp, 'two parent ids')
      ps.forEach((x, j) => id(x, `${pp}[${j}]`))
      return ps
    })
    arr(c.childIds, `${p}.childIds`).forEach((x, j) => id(x, `${p}.childIds[${j}]`))
    nullable(c.lastChildTick, `${p}.lastChildTick`, (v, lp) => int(v, lp, 0, d.tick as number))
    nullable(c.partnerId, `${p}.partnerId`, (v, pp) => {
      const pid = id(v, pp)
      if (pid === cid) fail(pp, 'someone else')
      if (alive) {
        const partner = (d.citizens as Record<string, unknown>[]).find((o) => isRecord(o) && o.id === pid)
        if (!partner || partner.alive !== true || partner.partnerId !== cid) fail(pp, 'a living partner who has this citizen as partner')
      }
      return pid
    })
    if (!alive && (c.task !== null || c.homeId !== null)) fail(`${p}`, 'dead citizens to have no task or home')
  })

  // Structures
  arr(d.structures, 'structures').forEach((raw, i) => {
    const p = `structures[${i}]`
    const s = obj(raw, p)
    uniqueId(s.id, `${p}.id`)
    oneOf(s.kind, STRUCTURE_KINDS, `${p}.kind`)
    tile(s.tile, `${p}.tile`)
    oneOf(s.stage, STRUCTURE_STAGES, `${p}.stage`)
    const cost = int(s.buildCost, `${p}.buildCost`, 0)
    int(s.buildProgress, `${p}.buildProgress`, 0, cost)
    const required = int(s.woodRequired, `${p}.woodRequired`, 0)
    int(s.woodDelivered, `${p}.woodDelivered`, 0, required)
    int(s.lastWorkTick, `${p}.lastWorkTick`, 0)
    const residents = arr(s.residentIds, `${p}.residentIds`)
    residents.forEach((r, j) => id(r, `${p}.residentIds[${j}]`))
    if (residents.length > SHELTER_CAPACITY + MAX_OVERCROWD) fail(`${p}.residentIds`, `at most ${SHELTER_CAPACITY + MAX_OVERCROWD} residents`)
  })

  const stock = obj(d.stockpile, 'stockpile')
  num(stock.food, 'stockpile.food', 0)
  num(stock.wood, 'stockpile.wood', 0)
  const ledger = obj(d.ledger, 'ledger')
  for (const k of ['foodGathered', 'woodGathered', 'foodRegrown', 'woodRegrown', 'foodEaten', 'foodLost', 'woodLost', 'foodDecayed', 'woodDecayed']) {
    int(ledger[k], `ledger.${k}`, 0)
  }

  // Ecology
  const ecology = obj(d.ecology, 'ecology')
  const ecoRng = arr(ecology.rng, 'ecology.rng')
  if (ecoRng.length !== 4) fail('ecology.rng', '4 uint32 words')
  ecoRng.forEach((w, i) => int(w, `ecology.rng[${i}]`, 0, 0xffff_ffff))
  const counters = obj(ecology.counters, 'ecology.counters')
  for (const k of ['births', 'deaths']) {
    const c = obj(counters[k], `ecology.counters.${k}`)
    for (const kind of RESOURCE_KINDS) int(c[kind], `ecology.counters.${k}.${kind}`, 0)
  }
  int(counters.seedsCast, 'ecology.counters.seedsCast', 0)
  int(counters.fallenFruitSprouts, 'ecology.counters.fallenFruitSprouts', 0)

  // Population V1: archive of the long dead, population stream and counters
  const archive = arr(d.archive, 'archive')
  if (archive.length > ARCHIVE_MAX) fail('archive', `at most ${ARCHIVE_MAX} people`)
  archive.forEach((raw, i) => {
    const p = `archive[${i}]`
    const r = obj(raw, p)
    uniqueId(r.id, `${p}.id`)
    str(r.name, `${p}.name`)
    oneOf(r.role, ROLES, `${p}.role`)
    const born = int(r.bornTick, `${p}.bornTick`, -Infinity, d.tick as number)
    int(r.diedTick, `${p}.diedTick`, Math.max(0, born), d.tick as number)
    oneOf(r.cause, DEATH_CAUSES, `${p}.cause`)
    nullable(r.parentIds, `${p}.parentIds`, (v, pp) => arr(v, pp).map((x, j) => id(x, `${pp}[${j}]`)))
    nullable(r.partnerId, `${p}.partnerId`, id)
    arr(r.childIds, `${p}.childIds`).forEach((x, j) => id(x, `${p}.childIds[${j}]`))
  })
  const population = obj(d.population, 'population')
  const popRng = arr(population.rng, 'population.rng')
  if (popRng.length !== 4) fail('population.rng', '4 uint32 words')
  popRng.forEach((w, i) => int(w, `population.rng[${i}]`, 0, 0xffff_ffff))
  const pc = obj(population.counters, 'population.counters')
  for (const k of ['births', 'deaths', 'oldAgeDeaths', 'partnerships', 'comingOfAge', 'archived']) int(pc[k], `population.counters.${k}`, 0)

  // History
  const history = arr(d.history, 'history')
  if (history.length > HISTORY_MAX) fail('history', `at most ${HISTORY_MAX} samples`)
  let lastSampleTick = -1
  history.forEach((raw, i) => {
    const p = `history[${i}]`
    const h = obj(raw, p)
    const t = int(h.tick, `${p}.tick`, 0, d.tick as number)
    if (t <= lastSampleTick) fail(`${p}.tick`, 'strictly increasing ticks')
    lastSampleTick = t
    for (const k of ['population', 'food', 'wood', 'housed', 'capacity', 'discovered']) int(h[k], `${p}.${k}`, 0)
    for (const k of ['satiety', 'energy', 'health', 'social']) int(h[k], `${p}.${k}`, 0, 100)
    for (const k of ['children', 'adults', 'elders', 'births', 'deaths']) if (h[k] !== undefined) int(h[k], `${p}.${k}`, 0)
  })

  // Events
  const events = arr(d.events, 'events')
  const eventIds = new Set<number>() // events have their own id space (v6)
  if (events.length > MAX_EVENTS) fail('events', `at most ${MAX_EVENTS} entries`)
  events.forEach((raw, i) => {
    const p = `events[${i}]`
    const e = obj(raw, p)
    const eid = int(e.id, `${p}.id`, 1, nextEventId - 1)
    if (eventIds.has(eid)) fail(`${p}.id`, 'unique event id')
    eventIds.add(eid)
    int(e.tick, `${p}.tick`, 0, d.tick as number)
    oneOf(e.kind, EVENT_KINDS, `${p}.kind`)
    arr(e.citizenIds, `${p}.citizenIds`).forEach((c, j) => id(c, `${p}.citizenIds[${j}]`))
    if (e.data !== undefined) {
      for (const [k, v] of Object.entries(obj(e.data, `${p}.data`))) {
        if (typeof v !== 'string' && typeof v !== 'number') fail(`${p}.data.${k}`, 'string or number')
      }
    }
  })
}
