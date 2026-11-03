import { describe, expect, it } from 'vitest'
import { CITIZEN_NAMES } from './citizens/names.ts'
import { ROLES, SCHEMA_VERSION, SPAWN_RADIUS, START_DISCOVERY_RADIUS } from './constants.ts'
import { isPassable, manhattan, toIndex, toPoint } from './grid.ts'
import { serialize } from './serialize.ts'
import { createWorld } from './world.ts'

describe('createWorld', () => {
  const state = createWorld({ seed: 'spawn-test' })
  const camp = state.structures.find((s) => s.kind === 'campfire')!
  const campPos = toPoint(camp.tile, state.map.width)

  it('starts at tick 0 with the default 36x24 map and current schema', () => {
    expect(state.tick).toBe(0)
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(state.map.width).toBe(36)
    expect(state.map.height).toBe(24)
    expect(state.map.terrain).toHaveLength(36 * 24)
  })

  it('is fully deterministic for the same seed', () => {
    expect(serialize(createWorld({ seed: 'same' }))).toBe(serialize(createWorld({ seed: 'same' })))
  })

  it('differs between seeds', () => {
    expect(serialize(createWorld({ seed: 'one' }))).not.toBe(serialize(createWorld({ seed: 'two' })))
  })

  it('places a complete campfire at the map centre', () => {
    expect(state.structures).toHaveLength(1)
    expect(camp.complete).toBe(true)
    expect(camp.tile).toBe(toIndex(18, 12, 36))
  })

  it('creates 12 citizens with unique ids and names', () => {
    const { citizens } = state
    expect(citizens).toHaveLength(12)
    expect(new Set(citizens.map((c) => c.id)).size).toBe(12)
    expect(new Set(citizens.map((c) => c.name)).size).toBe(12)
    for (const c of citizens) expect(CITIZEN_NAMES).toContain(c.name)
    const ids = citizens.map((c) => c.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })

  it('balances roles evenly', () => {
    for (const role of ROLES) expect(state.citizens.filter((c) => c.role === role)).toHaveLength(4)
  })

  it('gives every citizen personality traits in [0, 1] and full health', () => {
    for (const c of state.citizens) {
      for (const v of Object.values(c.personality)) expect(v >= 0 && v <= 1).toBe(true)
      expect(c.needs.health).toBe(100)
      expect(c.alive).toBe(true)
      expect(c.task).toBeNull()
    }
  })

  it('spawns citizens on distinct, passable, discovered tiles near the campfire', () => {
    const tiles = new Set<number>()
    for (const c of state.citizens) {
      const t = toIndex(c.pos.x, c.pos.y, state.map.width)
      expect(isPassable(state.map, t)).toBe(true)
      expect(state.map.discovered[t]).toBe(1)
      expect(t).not.toBe(camp.tile)
      expect(manhattan(c.pos, campPos)).toBeLessThanOrEqual(SPAWN_RADIUS)
      tiles.add(t)
    }
    expect(tiles.size).toBe(12)
  })

  it('reveals the start area around the campfire only', () => {
    state.map.discovered.forEach((d, i) => {
      const p = toPoint(i, state.map.width)
      const dx = p.x - campPos.x
      const dy = p.y - campPos.y
      expect(d).toBe(dx * dx + dy * dy <= START_DISCOVERY_RADIUS ** 2 ? 1 : 0)
    })
  })

  it('records a worldCreated event at tick 0', () => {
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ kind: 'worldCreated', tick: 0, data: { seed: 'spawn-test' } })
    expect(state.events[0]!.citizenIds).toHaveLength(12)
  })

  it('hands out ids from a single counter', () => {
    const all = [...state.structures.map((s) => s.id), ...state.citizens.map((c) => c.id), ...state.events.map((e) => e.id)]
    expect(new Set(all).size).toBe(all.length)
    expect(Math.max(...all)).toBe(state.nextId - 1)
  })

  it('produces valid spawns across many seeds', () => {
    for (let i = 0; i < 50; i++) {
      const w = createWorld({ seed: `seed-${i}` })
      expect(w.citizens).toHaveLength(12)
      expect(new Set(w.citizens.map((c) => `${c.pos.x},${c.pos.y}`)).size).toBe(12)
      for (const c of w.citizens) expect(isPassable(w.map, toIndex(c.pos.x, c.pos.y, w.map.width))).toBe(true)
    }
  })

  it('rejects invalid configs', () => {
    expect(() => createWorld({ seed: '' })).toThrow(/seed/)
    expect(() => createWorld({ width: 4 })).toThrow(/width/)
    expect(() => createWorld({ height: 10.5 })).toThrow(/height/)
    expect(() => createWorld({ citizenCount: 0 })).toThrow(/citizenCount/)
    expect(() => createWorld({ citizenCount: CITIZEN_NAMES.length + 1 })).toThrow(/citizenCount/)
  })
})
