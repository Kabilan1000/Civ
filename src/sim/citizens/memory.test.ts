import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { bestChatPartner } from '../ai/actions/socialize.ts'
import { scoreEat } from '../ai/actions/eat.ts'
import { scoreShare } from '../ai/actions/share.ts'
import { buildContext } from '../ai/context.ts'
import { MAX_MEMORIES, TICKS_PER_DAY } from '../constants.ts'
import { toIndex } from '../grid.ts'
import { createWorld, step } from '../world.ts'
import { remember } from './memory.ts'

const OPEN = Array.from({ length: 9 }, () => '.........')

describe('memory storage', () => {
  it('gives each memory a unique id and merges repeats instead of duplicating', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }] })
    const a = remember(state, c!, 'foundResource', 0.15, { tile: 5 })
    const b = remember(state, c!, 'foundResource', 0.15, { tile: 6 })
    expect(a.id).not.toBe(b.id)
    state.tick += 10
    const again = remember(state, c!, 'foundResource', 0.3, { tile: 5 })
    expect(again).toBe(a)
    expect(a).toMatchObject({ tick: state.tick, valence: 0.3 })
    expect(c!.memories).toHaveLength(2)
  })

  it('stays bounded, forgetting the least salient memory first', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }] })
    remember(state, c!, 'sawDeath', -0.8, { subjectId: c!.id })
    for (let i = 0; i < MAX_MEMORIES * 3; i++) {
      state.tick++
      remember(state, c!, 'foundResource', 0.1 + (i % 5) * 0.01, { tile: i })
    }
    expect(c!.memories).toHaveLength(MAX_MEMORIES)
    expect(c!.memories.some((m) => m.kind === 'sawDeath')).toBe(true) // strong memories survive
    expect(new Set(c!.memories.map((m) => m.id)).size).toBe(MAX_MEMORIES)
  })

  it('only records events that really happened, and stays bounded in a long run', () => {
    const s = createWorld({ seed: 'real-memories' })
    for (let t = 0; t < TICKS_PER_DAY * 8; t++) step(s)
    const byId = new Map(s.citizens.map((c) => [c.id, c]))
    const kinds = new Set<string>()
    for (const c of s.citizens) {
      expect(c.memories.length).toBeLessThanOrEqual(MAX_MEMORIES)
      for (const m of c.memories) {
        kinds.add(m.kind)
        expect(m.tick).toBeLessThanOrEqual(s.tick)
        if (m.kind === 'chat' || m.kind === 'argument') {
          // Both sides took part, so they share the relationship record.
          expect(c.relationships[m.subjectId!]).toBeDefined()
          expect(byId.get(m.subjectId!)!.relationships[c.id]).toBeDefined()
        }
        if (m.kind === 'receivedFood') expect(c.relationships[m.subjectId!]).toBeDefined()
        if (m.kind === 'discovered') expect(s.map.discovered[m.tile!]).toBe(1)
        if (m.kind === 'foundResource' || m.kind === 'resourceDepleted') expect(s.map.resources[m.tile!]).not.toBeNull()
        if (m.kind === 'builtShelter') expect(s.structures.some((x) => x.tile === m.tile && x.stage === 'complete')).toBe(true)
        if (m.kind === 'sawDeath') expect(byId.get(m.subjectId!)!.alive).toBe(false)
      }
    }
    for (const k of ['chat', 'foundResource', 'discovered', 'builtShelter']) expect(kinds).toContain(k)
  })
})

describe('memories influence decisions', () => {
  it('a recent argument steers partner choice away from that person', () => {
    const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 5, y: 2 }] })
    const [me, near, far] = citizens
    me!.needs.social = 10
    expect(bestChatPartner(buildContext(state, me!))?.citizen).toBe(near)
    remember(state, me!, 'argument', -0.6, { subjectId: near!.id })
    expect(bestChatPartner(buildContext(state, me!))?.citizen).toBe(far)
  })

  it('having been fed by someone makes a citizen more willing to feed them', () => {
    const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }, { x: 3, y: 2 }] })
    const [me, friend] = citizens
    me!.carrying = { kind: 'berries', amount: 3 }
    friend!.needs.satiety = 30
    const before = scoreShare(buildContext(state, me!))
    remember(state, me!, 'receivedFood', 0.8, { subjectId: friend!.id })
    expect(scoreShare(buildContext(state, me!))).toBeGreaterThan(before)
  })

  it('witnessing a death makes a citizen eat earlier', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 4, y: 5 }], food: 20 })
    c!.needs.satiety = 72
    const before = scoreEat(buildContext(state, c!))
    remember(state, c!, 'sawDeath', -0.8, { subjectId: c!.id })
    expect(scoreEat(buildContext(state, c!))).toBeGreaterThan(before)
  })

  it('a remembered productive bush is preferred over an equally near one', () => {
    const rows = ['b.......b', '.........', '.........']
    const { state, citizens: [c] } = sandbox(rows, { camp: [4, 2], citizens: [{ x: 4, y: 0 }] })
    expect(buildContext(state, c!).berries!.tile).toBe(0) // tie → lower index
    remember(state, c!, 'foundResource', 0.15, { tile: toIndex(8, 0, 9) })
    expect(buildContext(state, c!).berries!.tile).toBe(toIndex(8, 0, 9))
  })
})
