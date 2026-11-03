// Versioned save format. serialize() is plain JSON.stringify; deserialize()
// parses, migrates older schema versions step by step, then validates the
// full shape before handing back a WorldState.

import { MAX_EVENTS, MAX_MEMORIES, ROLES, SCHEMA_VERSION, SHELTER_CAPACITY, TERRAINS } from './constants.ts'
import type { WorldState } from './types.ts'

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
const ACTION_KINDS = ['eat', 'forage', 'chop', 'deliver', 'share', 'build', 'rest', 'socialize', 'explore', 'wander', 'idle'] as const
const STRUCTURE_KINDS = ['campfire', 'shelter'] as const
const STRUCTURE_STAGES = ['planned', 'underConstruction', 'complete'] as const
const DEATH_CAUSES = ['starvation', 'exhaustion'] as const
const MEMORY_KINDS = [
  'foundResource', 'resourceDepleted', 'chat', 'argument',
  'receivedFood', 'gaveFood', 'builtShelter', 'sawDeath', 'discovered',
] as const
const EVENT_KINDS = [
  'worldCreated', 'dayStarted', 'shelterStarted', 'shelterCompleted', 'shelterAbandoned', 'movedIn', 'chat', 'argument',
  'sharedFood', 'discovered', 'starving', 'died', 'friendship', 'rivalry',
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
      oneOf(node.kind, RESOURCE_KINDS, `${p}.kind`)
      const max = num(node.max, `${p}.max`, 0)
      num(node.amount, `${p}.amount`, 0, max)
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
      if (mem.subjectId !== undefined) citizenRef(mem.subjectId, `${mp}.subjectId`)
      if (mem.tile !== undefined) tile(mem.tile, `${mp}.tile`)
      num(mem.valence, `${mp}.valence`, -1, 1)
    })
    arr(c.lastScores, `${p}.lastScores`).forEach((s, j) => {
      const score = obj(s, `${p}.lastScores[${j}]`)
      oneOf(score.kind, ACTION_KINDS, `${p}.lastScores[${j}].kind`)
      num(score.score, `${p}.lastScores[${j}].score`)
    })
    nullable(c.lastSocialTick, `${p}.lastSocialTick`, (v, lp) => int(v, lp, 0, d.tick as number))
    const alive = bool(c.alive, `${p}.alive`)
    const diedTick = nullable(c.diedTick, `${p}.diedTick`, (v, dp) => int(v, dp, 0))
    const cause = nullable(c.deathCause, `${p}.deathCause`, (v, cp) => oneOf(v, DEATH_CAUSES, cp))
    if (alive !== (diedTick === null) || alive !== (cause === null)) fail(`${p}`, 'alive, diedTick and deathCause to agree')
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
    if (residents.length > SHELTER_CAPACITY) fail(`${p}.residentIds`, `at most ${SHELTER_CAPACITY} residents`)
  })

  const stock = obj(d.stockpile, 'stockpile')
  num(stock.food, 'stockpile.food', 0)
  num(stock.wood, 'stockpile.wood', 0)
  const ledger = obj(d.ledger, 'ledger')
  for (const k of ['foodGathered', 'woodGathered', 'foodRegrown', 'woodRegrown', 'foodEaten', 'foodLost', 'woodLost']) {
    int(ledger[k], `ledger.${k}`, 0)
  }

  // Events
  const events = arr(d.events, 'events')
  if (events.length > MAX_EVENTS) fail('events', `at most ${MAX_EVENTS} entries`)
  events.forEach((raw, i) => {
    const p = `events[${i}]`
    const e = obj(raw, p)
    uniqueId(e.id, `${p}.id`)
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
