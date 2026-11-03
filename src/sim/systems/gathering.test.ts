import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { CARRY_CAPACITY, GATHER_TICKS, TICKS_PER_DAY } from '../constants.ts'
import { isAdjacent4, isPassable, toIndex } from '../grid.ts'
import { discoveredOnly } from '../ai/travel.ts'
import { findPath } from '../path/astar.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'
import { advanceTasks } from './tasks.ts'

function totals(s: WorldState) {
  let mapFood = 0
  let mapWood = 0
  for (const r of s.map.resources) {
    if (r?.kind === 'berries') mapFood += r.amount
    else if (r?.kind === 'wood') mapWood += r.amount
  }
  let carriedFood = 0
  let carriedWood = 0
  for (const c of s.citizens) {
    if (c.carrying?.kind === 'berries') carriedFood += c.carrying.amount
    else if (c.carrying?.kind === 'wood') carriedWood += c.carrying.amount
  }
  const siteWood = s.structures.reduce((n, st) => n + st.woodDelivered, 0)
  return {
    food: mapFood + carriedFood + s.stockpile.food + s.ledger.foodEaten + s.ledger.foodLost - s.ledger.foodRegrown,
    wood: mapWood + carriedWood + s.stockpile.wood + siteWood + s.ledger.woodLost - s.ledger.woodRegrown,
  }
}

describe('gathering', () => {
  it('takes GATHER_TICKS per unit, fills the inventory and depletes the bush', () => {
    const { state, citizens: [c] } = sandbox(['b...'], { camp: [3, 0], citizens: [{ x: 0, y: 0 }] })
    c!.nextDecisionTick = Number.MAX_SAFE_INTEGER
    c!.task = { kind: 'forage', phase: 'gather', targetTile: 0, targetId: null, ticksLeft: GATHER_TICKS.berries, startedTick: 0 }
    const node = state.map.resources[0]!
    const version = state.map.version
    advanceTasks(state)
    advanceTasks(state)
    expect(c!.carrying).toBeNull() // still working on the first unit
    advanceTasks(state)
    expect(c!.carrying).toEqual({ kind: 'berries', amount: 1 })
    expect(node.amount).toBe(node.max - 1)
    expect(state.map.version).toBe(version + 1) // renderer must redraw the bush
    for (let i = 0; i < 100 && c!.task; i++) advanceTasks(state)
    expect(c!.carrying!.amount).toBe(Math.min(CARRY_CAPACITY.berries, node.max))
    expect(state.ledger.foodGathered).toBe(c!.carrying!.amount)
  })

  it('stops safely when the source is emptied or removed by someone else', () => {
    const { state, citizens: [c] } = sandbox(['b...'], { camp: [3, 0], citizens: [{ x: 0, y: 0 }] })
    c!.nextDecisionTick = Number.MAX_SAFE_INTEGER
    c!.task = { kind: 'forage', phase: 'gather', targetTile: 0, targetId: null, ticksLeft: 1, startedTick: 0 }
    state.map.resources[0]!.amount = 0
    advanceTasks(state)
    expect(c!.task).toBeNull()
    expect(c!.carrying).toBeNull()
    expect(state.map.resources[0]!.amount).toBe(0)

    c!.task = { kind: 'forage', phase: 'gather', targetTile: 0, targetId: null, ticksLeft: 1, startedTick: 0 }
    state.map.resources[0] = null
    advanceTasks(state)
    expect(c!.task).toBeNull()
  })

  it('deposits the whole load into the stockpile at camp', () => {
    const { state, citizens: [c] } = sandbox(['....'], { camp: [1, 0], citizens: [{ x: 0, y: 0 }], food: 3 })
    c!.nextDecisionTick = Number.MAX_SAFE_INTEGER
    c!.carrying = { kind: 'berries', amount: 4 }
    c!.task = { kind: 'deliver', phase: 'deposit', targetTile: 1, targetId: null, ticksLeft: 0, startedTick: 0 }
    advanceTasks(state)
    expect(state.stockpile.food).toBe(7)
    expect(c!.carrying).toBeNull()
  })

  it('eats from the stockpile only at camp, and carried food first', () => {
    const far = sandbox(['.....'], { camp: [0, 0], citizens: [{ x: 4, y: 0 }], food: 5 })
    const c = far.citizens[0]!
    c.nextDecisionTick = Number.MAX_SAFE_INTEGER
    c.task = { kind: 'eat', phase: 'eat', targetTile: 4, targetId: null, ticksLeft: 1, startedTick: 0 }
    advanceTasks(far.state)
    expect(far.state.stockpile.food).toBe(5) // too far from camp: nothing eaten
    expect(c.task).toBeNull()

    c.carrying = { kind: 'berries', amount: 1 }
    c.needs.satiety = 10
    c.task = { kind: 'eat', phase: 'eat', targetTile: 4, targetId: null, ticksLeft: 1, startedTick: 0 }
    advanceTasks(far.state)
    expect(c.carrying).toBeNull()
    expect(far.state.stockpile.food).toBe(5)
    expect(far.state.ledger.foodEaten).toBe(1)
  })

  it('only targets discovered, reachable resources of the right kind', () => {
    for (const seed of ['targets-a', 'targets-b', 'targets-c']) {
      const s = createWorld({ seed })
      const seen = new Set<object>()
      for (let t = 0; t < TICKS_PER_DAY * 3; t++) {
        step(s)
        for (const c of s.citizens) {
          const task = c.task
          if (!task || seen.has(task) || (task.kind !== 'forage' && task.kind !== 'chop')) continue
          seen.add(task)
          const tile = task.targetTile!
          const node = s.map.resources[tile]
          expect(s.map.discovered[tile]).toBe(1)
          expect(node?.kind).toBe(task.kind === 'forage' ? 'berries' : 'wood')
          expect(node!.amount).toBeGreaterThan(0)
          const here = toIndex(c.pos.x, c.pos.y, s.map.width)
          expect(findPath(s.map, here, tile, { canEnter: discoveredOnly(s.map) })).not.toBeNull()
        }
      }
      expect(seen.size).toBeGreaterThan(20)
    }
  })

  it('conserves food and wood exactly and never goes negative', () => {
    for (const seed of ['ledger-a', 'ledger-b', 'ledger-c', 'ledger-d']) {
      const s = createWorld({ seed })
      const start = totals(s)
      for (let t = 0; t < TICKS_PER_DAY * 5; t++) {
        step(s)
        expect(totals(s)).toEqual(start)
        expect(s.stockpile.food).toBeGreaterThanOrEqual(0)
        expect(s.stockpile.wood).toBeGreaterThanOrEqual(0)
        for (const c of s.citizens) {
          if (!c.carrying) continue
          expect(c.carrying.amount).toBeGreaterThan(0)
          expect(c.carrying.amount).toBeLessThanOrEqual(CARRY_CAPACITY[c.carrying.kind])
        }
      }
      for (const r of s.map.resources) if (r) expect(r.amount >= 0 && r.amount <= r.max && Number.isInteger(r.amount)).toBe(true)
      expect(s.ledger.foodGathered).toBeGreaterThan(0)
      expect(s.ledger.woodGathered).toBeGreaterThan(0)
      expect(s.ledger.foodEaten).toBeGreaterThan(0)
    }
  })

  it('roles shape who gathers what in a running colony', () => {
    const byRole = { forager: { berries: 0, wood: 0 }, builder: { berries: 0, wood: 0 }, explorer: { berries: 0, wood: 0 } }
    for (const seed of ['roles-a', 'roles-b', 'roles-c']) {
      const s = createWorld({ seed })
      for (let t = 0; t < TICKS_PER_DAY * 4; t++) {
        const before = s.citizens.map((c) => (c.carrying ? { ...c.carrying } : null))
        step(s)
        s.citizens.forEach((c, i) => {
          const b = before[i]
          if (c.carrying && (!b || b.kind === c.carrying.kind) && c.carrying.amount > (b?.amount ?? 0)) {
            byRole[c.role][c.carrying.kind] += c.carrying.amount - (b?.amount ?? 0)
          }
        })
      }
    }
    expect(byRole.forager.berries).toBeGreaterThan(byRole.builder.berries * 2)
    expect(byRole.builder.wood).toBeGreaterThan(byRole.forager.wood * 2)
  })

  it('keeps movement adjacent and on passable tiles while working', () => {
    const s = createWorld({ seed: 'work-moves' })
    const prev = s.citizens.map((c) => ({ ...c.pos }))
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      step(s)
      s.citizens.forEach((c, i) => {
        const p = prev[i]!
        if (p.x !== c.pos.x || p.y !== c.pos.y) expect(isAdjacent4(p, c.pos)).toBe(true)
        expect(isPassable(s.map, toIndex(c.pos.x, c.pos.y, s.map.width))).toBe(true)
        prev[i] = { ...c.pos }
      })
    }
  })

  it('saving and resuming mid-gather is exactly deterministic', () => {
    const s = createWorld({ seed: 'gather-resume' })
    let at = 0
    for (let t = 0; t < 2000; t++) {
      step(s)
      if (s.citizens.some((c) => c.task?.phase === 'gather' && c.carrying) && s.citizens.some((c) => c.task?.phase === 'moveTo')) {
        at = s.tick
        break
      }
    }
    expect(at).toBeGreaterThan(0)
    const resumed = deserialize(serialize(s))
    const straight = createWorld({ seed: 'gather-resume' })
    stepN(straight, at)
    expect(serialize(straight)).toBe(serialize(s))
    stepN(resumed, 1500)
    stepN(straight, 1500)
    expect(serialize(resumed)).toBe(serialize(straight))
  })
})
