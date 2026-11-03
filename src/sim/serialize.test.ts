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
    v1.citizens = v1.citizens.map(({ deathCause: _d, ...c }: any) => c)
    const loaded = deserialize(JSON.stringify(v1))
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION)
    expect(loaded.ledger).toEqual({ foodGathered: 0, woodGathered: 0, foodRegrown: 0, woodRegrown: 0, foodEaten: 0, foodLost: 0, woodLost: 0 })
    expect(loaded.citizens).toEqual(s.citizens)
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
  ])('rejects corrupt %s', (_name, mutate, message) => {
    expectSaveError(() => deserialize(corrupt(mutate)), 'invalid-data', message)
  })
})
