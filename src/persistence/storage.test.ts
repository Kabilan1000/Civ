import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, createWorld, serialize, step, stepN, type WorldState } from '../sim/index.ts'
import { AUTOSAVE_SLOT, KEY_PREFIX, MANUAL_SLOTS, SaveStore, buildMeta, type StorageLike } from './storage.ts'

/** In-memory Web Storage with an optional byte quota. */
class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>()
  quota = Infinity
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    const used = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0)
    if (used + v.length > this.quota) {
      const e = new Error('The quota has been exceeded.')
      e.name = 'QuotaExceededError'
      throw e
    }
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

const world = (seed = 'store', ticks = 500): WorldState => {
  const s = createWorld({ seed })
  stepN(s, ticks)
  return s
}
const FIXTURES = join(import.meta.dirname, '../sim/__tests__/fixtures')

describe('SaveStore', () => {
  it('stores and retrieves a complete world exactly, with metadata', () => {
    const mem = new MemoryStorage()
    const store = new SaveStore(mem)
    const s = world()
    const now = new Date('2026-11-03T12:00:00Z')
    expect(store.save('slot2', s, now).ok).toBe(true)
    const loaded = store.load('slot2')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(serialize(loaded.value.state)).toBe(serialize(s)) // citizens, relationships, memories, history, RNG…
    expect(loaded.value.meta).toEqual({
      seed: 'store', tick: 500, day: 3, hour: 8, minute: 0, // tick 500 = day 3, tick-of-day 20 = 08:00
      population: 12, schemaVersion: SCHEMA_VERSION,
      savedAt: '2026-11-03T12:00:00.000Z',
    })
    expect(JSON.stringify(loaded.value.state)).not.toContain('2026-11-03') // browser time never enters the sim
  })

  it('a loaded world continues deterministically, including a save taken mid-task', () => {
    const store = new SaveStore(new MemoryStorage())
    const s = createWorld({ seed: 'mid-task' })
    for (let t = 0; t < 2000; t++) {
      step(s)
      if (t > 300 && s.citizens.some((c) => c.task?.phase === 'gather') && s.citizens.some((c) => c.path.length > 0 && c.moveTicksLeft > 0)) break
    }
    store.save('slot1', s)
    const loaded = store.load('slot1')
    if (!loaded.ok) throw new Error(loaded.message)
    stepN(s, 800)
    stepN(loaded.value.state, 800)
    expect(serialize(loaded.value.state)).toBe(serialize(s))
  })

  it('lists empty, occupied and damaged slots', () => {
    const mem = new MemoryStorage()
    const store = new SaveStore(mem)
    store.save('slot1', world())
    mem.setItem(KEY_PREFIX + 'slot3', '{"format":"little-worlds-save", not json')
    const list = store.list()
    expect(list.map((s) => [s.id, s.status])).toEqual([
      ['slot1', 'ok'], ['slot2', 'empty'], ['slot3', 'corrupt'], ['autosave', 'empty'],
    ])
  })

  it('rejects damaged saves safely with a helpful message', () => {
    const mem = new MemoryStorage()
    const store = new SaveStore(mem)
    const good = world()
    store.save('slot1', good)
    const file = JSON.parse(mem.getItem(KEY_PREFIX + 'slot1')!)

    mem.setItem(KEY_PREFIX + 'slot2', 'garbage')
    expect(store.load('slot2')).toMatchObject({ ok: false, code: 'corrupt' })

    file.world.citizens[0].needs.health = 400
    mem.setItem(KEY_PREFIX + 'slot3', JSON.stringify(file))
    const bad = store.load('slot3')
    expect(bad).toMatchObject({ ok: false, code: 'corrupt' })
    if (!bad.ok) expect(bad.message).toMatch(/needs\.health/)
    // The damaged slot keeps its details visible so the user can tell which world it was.
    expect(store.list()[2]).toMatchObject({ status: 'corrupt', meta: { seed: 'store' } })

    expect(store.load('slot2').ok).toBe(false)
    expect(store.load('autosave')).toMatchObject({ ok: false, code: 'empty' })
  })

  it('reports unsupported future saves clearly', () => {
    const mem = new MemoryStorage()
    const store = new SaveStore(mem)
    store.save('slot1', world())
    const file = JSON.parse(mem.getItem(KEY_PREFIX + 'slot1')!)
    file.world.schemaVersion = SCHEMA_VERSION + 1
    mem.setItem(KEY_PREFIX + 'slot1', JSON.stringify(file))
    const r = store.load('slot1')
    expect(r).toMatchObject({ ok: false, code: 'unsupported' })
    if (!r.ok) expect(r.message).toMatch(/newer than supported/)

    file.fileVersion = 99
    mem.setItem(KEY_PREFIX + 'slot1', JSON.stringify(file))
    expect(store.load('slot1')).toMatchObject({ ok: false, code: 'unsupported' })
  })

  it('survives a full or unavailable storage without throwing', () => {
    const mem = new MemoryStorage()
    mem.quota = 1000
    const store = new SaveStore(mem)
    const r = store.save('slot1', world())
    expect(r).toMatchObject({ ok: false, code: 'quota' })
    expect(mem.data.size).toBe(0) // nothing half-written

    const none = new SaveStore(null)
    expect(none.available).toBe(false)
    expect(none.save('slot1', world())).toMatchObject({ ok: false, code: 'unavailable' })
    expect(none.load('slot1')).toMatchObject({ ok: false, code: 'unavailable' })
    expect(none.list().every((s) => s.status === 'empty')).toBe(true)

    const throwing = new SaveStore({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } })
    expect(throwing.save('slot1', world()).ok).toBe(false)
    expect(throwing.load('slot1').ok).toBe(false)
    expect(throwing.delete('slot1').ok).toBe(false)
    expect(() => throwing.list()).not.toThrow()
  })

  it('deletes slots independently', () => {
    const store = new SaveStore(new MemoryStorage())
    for (const id of MANUAL_SLOTS) store.save(id, world(id, 10))
    store.save(AUTOSAVE_SLOT, world('auto', 10))
    store.delete('slot2')
    expect(store.list().map((s) => s.status)).toEqual(['ok', 'empty', 'ok', 'ok'])
  })

  it.each([
    ['v2 (M4)', 'm4-save-v2.json'],
    ['v3 (M5)', 'm5-save-v3.json'],
    ['v4 (M6)', 'm6-save-v4.json'],
  ])('loads an older %s world through the migrations', (_name, file) => {
    const mem = new MemoryStorage()
    const store = new SaveStore(mem)
    const old = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
    const meta = { seed: old.config.seed, tick: old.tick, day: 1, hour: 6, minute: 0, population: 12, schemaVersion: old.schemaVersion, savedAt: '2026-01-01T00:00:00Z' }
    mem.setItem(KEY_PREFIX + 'slot1', JSON.stringify({ format: 'little-worlds-save', fileVersion: 1, meta, world: old }))
    const r = store.load('slot1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.schemaVersion).toBe(SCHEMA_VERSION)
      expect(r.value.state.map.terrain).toEqual(old.map.terrain) // complete map
      expect(r.value.state.tick).toBe(old.tick)
    }
  })

  it('builds metadata from the world without touching it', () => {
    const s = world('meta', 250)
    const before = serialize(s)
    expect(buildMeta(s, new Date(0))).toMatchObject({ seed: 'meta', tick: 250, day: 2 })
    expect(serialize(s)).toBe(before)
  })
})
