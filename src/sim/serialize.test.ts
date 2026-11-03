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
    const v1 = JSON.parse(serialize(s))
    delete v1.ledger
    v1.schemaVersion = 1
    const loaded = deserialize(JSON.stringify(v1))
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION)
    expect(loaded.ledger).toEqual({ foodGathered: 0, woodGathered: 0, foodRegrown: 0, woodRegrown: 0, foodEaten: 0 })
    expect(loaded.citizens).toEqual(s.citizens)
    stepN(loaded, 200)
    expect(loaded.tick).toBe(400)
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
