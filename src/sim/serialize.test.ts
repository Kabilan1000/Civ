import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from './constants.ts'
import { deserialize, SaveError, serialize } from './serialize.ts'
import { createWorld, stepN } from './world.ts'

function expectSaveError(fn: () => unknown, code: SaveError['code'], message?: RegExp) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(SaveError)
    expect((e as SaveError).code).toBe(code)
    if (message) expect((e as SaveError).message).toMatch(message)
    return
  }
  throw new Error('expected a SaveError')
}

function corrupt(mutate: (raw: Record<string, any>) => void): string {
  const raw = JSON.parse(serialize(createWorld()))
  mutate(raw)
  return JSON.stringify(raw)
}

/** The first plant of a kind (or any) in a raw save, for corruption tests. */
function plant(r: any, kind?: 'berries' | 'wood'): any {
  return r.map.resources.find((x: any) => x && (!kind || x.kind === kind))
}

describe('serialize / deserialize', () => {
  it('round-trips a world exactly', () => {
    const s = createWorld({ seed: 'round-trip' })
    stepN(s, 300)
    const json = serialize(s)
    const restored = deserialize(json)
    expect(restored).toEqual(s)
    expect(serialize(restored)).toBe(json)
  })

  it('migrates a v1 save (no ledger) to the current schema and keeps running', () => {
    const s = createWorld({ seed: 'migrate' })
    stepN(s, 200)
    // Rebuild the exact v1 shape: no ledger, structures with `complete`, no deathCause.
    const v1 = JSON.parse(serialize(s))
    delete v1.ledger
    v1.schemaVersion = 1
    v1.structures = v1.structures.map((st: any) => {
      const { stage, woodRequired: _w, lastWorkTick: _l, ...rest } = st
      return { ...rest, complete: stage === 'complete' }
    })
    v1.citizens = v1.citizens.map(({ deathCause: _d, lastSocialTick: _s, lastDecisionTick: _t, ...c }: any) => ({
      ...c,
      memories: c.memories.map(({ id: _id, ...m }: any) => m),
    }))
    delete v1.history
    const loaded = deserialize(JSON.stringify(v1))
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION)
    expect(loaded.ledger).toEqual({
      foodGathered: 0, woodGathered: 0, foodRegrown: 0, woodRegrown: 0, foodEaten: 0, foodLost: 0, woodLost: 0,
      foodDecayed: 0, woodDecayed: 0, // added by the v5 → v6 step
    })
    // Everything carries over except data v1 never had: the decision tick is unknown.
    expect(loaded.citizens.map((c) => c.lastDecisionTick)).toEqual(s.citizens.map(() => null))
    expect(loaded.citizens.map((c) => ({ ...c, lastDecisionTick: null, memories: c.memories.map((m) => m.kind) })))
      .toEqual(s.citizens.map((c) => ({ ...c, lastDecisionTick: null, memories: c.memories.map((m) => m.kind) })))
    expect(loaded.history).toEqual([]) // never fabricated
    expect(loaded.structures[0]).toMatchObject({ kind: 'campfire', stage: 'complete' })
    stepN(loaded, 200)
    expect(loaded.tick).toBe(400)
  })

  it('migrates a real v2 save written by the M4 code and keeps running deterministically', () => {
    const raw = readFileSync(join(import.meta.dirname, '__tests__/fixtures/m4-save-v2.json'), 'utf8')
    expect(JSON.parse(raw).schemaVersion).toBe(2)
    const a = deserialize(raw)
    expect(a.schemaVersion).toBe(SCHEMA_VERSION)
    expect(a.structures[0]).toMatchObject({ kind: 'campfire', stage: 'complete', woodRequired: 0 })
    expect(a.citizens.every((c) => c.deathCause === null)).toBe(true)
    expect(a.ledger).toMatchObject({ foodLost: 0, woodLost: 0 })
    const b = deserialize(raw)
    stepN(a, 1500)
    stepN(b, 1500)
    expect(serialize(a)).toBe(serialize(b))
    expect(a.structures.some((s) => s.kind === 'shelter')).toBe(true) // the old village starts building
  })

  it('migrates a real v3 save written by the M5 code and keeps running deterministically', () => {
    const raw = readFileSync(join(import.meta.dirname, '__tests__/fixtures/m5-save-v3.json'), 'utf8')
    const v3 = JSON.parse(raw)
    expect(v3.schemaVersion).toBe(3)
    const a = deserialize(raw)
    expect(a.schemaVersion).toBe(SCHEMA_VERSION)
    expect(a.citizens.every((c) => c.lastSocialTick === null)).toBe(true)
    expect(a.structures.filter((s) => s.kind === 'shelter' && s.stage === 'complete')).toHaveLength(4)
    expect(a.citizens.filter((c) => c.homeId !== null)).toHaveLength(12)
    const b = deserialize(raw)
    stepN(a, 1500)
    stepN(b, 1500)
    expect(serialize(a)).toBe(serialize(b))
    // The migrated village takes up the new behaviours.
    expect(a.citizens.some((c) => Object.keys(c.relationships).length > 0)).toBe(true)
    expect(a.map.discovered.filter((d) => d === 1).length).toBeGreaterThan(v3.map.discovered.filter((d: number) => d === 1).length)
  })

  it('migrates a real v4 save written by the M6 code without fabricating history', () => {
    const raw = readFileSync(join(import.meta.dirname, '__tests__/fixtures/m6-save-v4.json'), 'utf8')
    const v4 = JSON.parse(raw)
    expect(v4.schemaVersion).toBe(4)
    const a = deserialize(raw)
    expect(a.schemaVersion).toBe(SCHEMA_VERSION)
    expect(a.history).toEqual([])
    expect(a.citizens.every((c) => c.lastDecisionTick === null)).toBe(true)
    // Relationships and memories carry over untouched.
    expect(a.citizens.map((c) => c.relationships)).toEqual(v4.citizens.map((c: any) => c.relationships))
    expect(a.citizens.map((c) => c.memories)).toEqual(v4.citizens.map((c: any) => c.memories))
    const b = deserialize(raw)
    stepN(a, 500)
    stepN(b, 500)
    expect(serialize(a)).toBe(serialize(b))
    // Recording starts at the next interval after the save's tick — nothing earlier.
    expect(a.history.length).toBeGreaterThan(0)
    expect(a.history[0]!.tick).toBeGreaterThan(v4.tick)
    expect(a.history[0]!.tick % 24).toBe(0)
  })

  it('rejects a current-version save that is missing the ledger', () => {
    expectSaveError(() => deserialize(corrupt((r) => delete r.ledger)), 'invalid-data', /ledger/)
  })

  it('rejects invalid JSON', () => {
    expectSaveError(() => deserialize('{not json'), 'invalid-json')
    expectSaveError(() => deserialize('[]'), 'invalid-data')
    expectSaveError(() => deserialize('null'), 'invalid-data')
  })

  it('rejects missing, invalid and newer schema versions clearly', () => {
    expectSaveError(() => deserialize(corrupt((r) => delete r.schemaVersion)), 'unsupported-version', /missing or invalid/)
    expectSaveError(() => deserialize(corrupt((r) => (r.schemaVersion = 0))), 'unsupported-version')
    expectSaveError(() => deserialize(corrupt((r) => (r.schemaVersion = '1'))), 'unsupported-version')
    expectSaveError(
      () => deserialize(corrupt((r) => (r.schemaVersion = SCHEMA_VERSION + 1))),
      'unsupported-version',
      /newer than supported/,
    )
  })

  it.each([
    ['tick', (r: any) => (r.tick = -1), /tick/],
    ['rng length', (r: any) => r.rng.pop(), /rng/],
    ['rng word', (r: any) => (r.rng[0] = 2 ** 32), /rng\[0\]/],
    ['terrain value', (r: any) => (r.map.terrain[5] = 'lava'), /map\.terrain\[5\]/],
    ['terrain length', (r: any) => r.map.terrain.pop(), /map\.terrain/],
    ['map size', (r: any) => (r.map.width = 10), /map/],
    ['citizen role', (r: any) => (r.citizens[0].role = 'king'), /citizens\[0\]\.role/],
    ['citizen need', (r: any) => (r.citizens[1].needs.energy = 150), /citizens\[1\]\.needs\.energy/],
    ['citizen pos', (r: any) => (r.citizens[2].pos.x = 99), /citizens\[2\]\.pos\.x/],
    ['duplicate id', (r: any) => (r.citizens[1].id = r.citizens[0].id), /citizens\[1\]\.id/],
    ['id beyond nextId', (r: any) => (r.nextId = 2), /id/],
    ['structure', (r: any) => delete r.structures[0].kind, /structures\[0\]\.kind/],
    ['structure stage', (r: any) => (r.structures[0].stage = 'ruined'), /structures\[0\]\.stage/],
    ['over-capacity shelter', (r: any) => (r.structures[0].residentIds = r.citizens.slice(0, 4).map((c: any) => c.id)), /residentIds/],
    ['self relationship', (r: any) => (r.citizens[0].relationships[r.citizens[0].id] = { affinity: 0, familiarity: 0, lastTick: 0 }), /relationships/],
    ['relationship to nobody', (r: any) => (r.citizens[0].relationships['9999'] = { affinity: 0, familiarity: 0, lastTick: 0 }), /relationships/],
    ['affinity out of range', (r: any) => (r.citizens[0].relationships[r.citizens[1].id] = { affinity: 101, familiarity: 0, lastTick: 0 }), /affinity/],
    ['duplicate memory id', (r: any) => (r.citizens[0].memories = [
      { id: r.citizens[1].id, tick: 0, kind: 'chat', subjectId: r.citizens[1].id, valence: 0.3 },
    ]), /unique id/], // reported where the clash is detected
    ['too many memories', (r: any) => (r.citizens[0].memories = Array.from({ length: 25 }, (_, k) => ({ id: 1000 + k, tick: 0, kind: 'chat', valence: 0 }))), /memories/],
    ['history out of order', (r: any) => (r.history = [r.history[0], r.history[0]]), /history\[1\]\.tick/],
    ['history value', (r: any) => (r.history[0].satiety = 150), /history\[0\]\.satiety/],
    ['dead citizen with a task', (r: any) => Object.assign(r.citizens[0], {
      alive: false, diedTick: 0, deathCause: 'starvation',
      task: { kind: 'wander', phase: 'linger', targetTile: 0, targetId: null, ticksLeft: 1, startedTick: 0 },
    }), /dead citizens/],
    ['stockpile', (r: any) => (r.stockpile.food = -5), /stockpile\.food/],
    ['ledger', (r: any) => (r.ledger.foodEaten = -1), /ledger\.foodEaten/],
    ['task kind', (r: any) => (r.citizens[0].task = { kind: 'dance', phase: 'x', targetTile: null, targetId: null, ticksLeft: 0, startedTick: 0 }), /citizens\[0\]\.task\.kind/],
    ['event kind', (r: any) => (r.events[0].kind = 'party'), /events\[0\]\.kind/],
    ['event from the future', (r: any) => (r.events[0].tick = 10), /events\[0\]\.tick/],
    ['too many events', (r: any) => (r.events = Array.from({ length: 201 }, () => r.events[0])), /events/],
    // Schema v6 (M10b): plant lifecycles, ecology state, separate event ids.
    ['plant stage', (r: any) => (plant(r).stage = 'ancient'), /map\.resources\[\d+\]\.stage/],
    ['dead bush', (r: any) => Object.assign(plant(r, 'berries'), { stage: 'dead', diedTick: 0 }), /only for trees/],
    ['cap not matching stage', (r: any) => (plant(r).max = 99), /map\.resources\[\d+\]\.max/],
    ['amount above cap', (r: any) => (plant(r).amount = plant(r).max + 1), /map\.resources\[\d+\]\.amount/],
    ['fractional amount', (r: any) => (plant(r).amount = 1.5), /map\.resources\[\d+\]\.amount/],
    ['living plant with diedTick', (r: any) => (plant(r).diedTick = 0), /diedTick/],
    ['deadwood without diedTick', (r: any) => Object.assign(plant(r, 'wood'), { stage: 'dead', diedTick: null }), /diedTick/],
    ['lifespan', (r: any) => (plant(r).lifespanDays = 0), /lifespanDays/],
    ['born in the future', (r: any) => (plant(r).bornTick = r.tick + 1), /bornTick/],
    ['decay ledger', (r: any) => (r.ledger.woodDecayed = -1), /ledger\.woodDecayed/],
    ['missing ecology', (r: any) => delete r.ecology, /ecology/],
    ['ecology rng', (r: any) => r.ecology.rng.pop(), /ecology\.rng/],
    ['ecology counter', (r: any) => (r.ecology.counters.deaths.wood = -1), /ecology\.counters\.deaths\.wood/],
    ['event id beyond nextEventId', (r: any) => (r.nextEventId = r.events.at(-1).id), /events\[\d+\]\.id/],
    ['duplicate event id', (r: any) => (r.events[1] = { ...r.events[1], id: r.events[0].id }), /unique event id/],
  ])('rejects corrupt %s', (_name, mutate, message) => {
    expectSaveError(() => deserialize(corrupt(mutate)), 'invalid-data', message)
  })
})
