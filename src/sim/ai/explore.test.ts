import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { EXPLORE_REVEAL_RADIUS, TICKS_PER_DAY } from '../constants.ts'
import { isPassable, toIndex } from '../grid.ts'
import { deserialize, serialize } from '../serialize.ts'
import { createWorld, step, stepN } from '../world.ts'
import { bestFrontier, scoreExplore } from './actions/explore.ts'
import { buildContext } from './context.ts'

// 20x7 meadow; only x < 6 starts discovered. A berry bush hides at (15, 3).
const ROWS = Array.from({ length: 7 }, (_, y) => (y === 3 ? '...............b....' : '....................'))
const explorerWorld = () =>
  sandbox(ROWS, { camp: [1, 3], citizens: [{ x: 2, y: 3, role: 'explorer' }], food: 100, discovered: (x) => x < 6 })

const discoveredCount = (d: (0 | 1)[]) => d.reduce<number>((n, v) => n + v, 0)

describe('exploration', () => {
  it('an explorer with satisfied needs walks to the frontier and reveals hidden terrain', () => {
    const { state, citizens: [c] } = explorerWorld()
    c!.personality.curiosity = 1
    const before = discoveredCount(state.map.discovered)
    const version = state.map.version
    expect(scoreExplore(buildContext(state, c!))).toBeGreaterThan(0)
    for (let t = 0; t < 400; t++) step(state)
    expect(discoveredCount(state.map.discovered)).toBeGreaterThan(before)
    expect(state.map.version).toBeGreaterThan(version)
    expect(c!.memories.some((m) => m.kind === 'discovered')).toBe(true)
  })

  it('never walks through undiscovered or blocked tiles', () => {
    for (const seed of ['explore-a', 'explore-b', 'explore-c']) {
      const s = createWorld({ seed })
      const prev = s.citizens.map((c) => ({ ...c.pos }))
      for (let t = 0; t < TICKS_PER_DAY * 4; t++) {
        // Every planned step lies on a discovered, passable tile at the moment it is taken.
        step(s)
        s.citizens.forEach((c, i) => {
          const tile = toIndex(c.pos.x, c.pos.y, s.map.width)
          if (prev[i]!.x !== c.pos.x || prev[i]!.y !== c.pos.y) {
            expect(isPassable(s.map, tile)).toBe(true)
            expect(s.map.discovered[tile]).toBe(1)
          }
          prev[i] = { ...c.pos }
        })
      }
      expect(discoveredCount(s.map.discovered)).toBeGreaterThan(300) // the island opens up
    }
  })

  it('makes newly discovered resources available to gathering', () => {
    const { state, citizens: [c] } = explorerWorld()
    const bush = toIndex(15, 3, 20)
    expect(buildContext(state, c!).berries).toBeNull() // hidden in the fog
    let found = false
    for (let t = 0; t < 1500 && !found; t++) {
      step(state)
      found = state.map.discovered[bush] === 1
    }
    expect(found).toBe(true)
    expect(buildContext(state, c!).berries?.tile).toBe(bush)
  })

  it('ignores unreachable frontiers and does not reselect surveyed ones', () => {
    // A discovered pocket at x 10..12 sits behind water: its fog edge is unreachable.
    const rows = ['......~...........', '......~...........', '......~...........']
    const { state, citizens: [c] } = sandbox(rows, {
      camp: [1, 1], citizens: [{ x: 2, y: 1, role: 'explorer' }], food: 100,
      discovered: (x) => x < 6 || (x >= 10 && x <= 12),
    })
    // The near side has no fog left within reach: the only frontiers are beyond the water.
    state.map.discovered = state.map.discovered.map((d, i) => (i % 18 <= 6 ? 1 : d))
    expect(bestFrontier(buildContext(state, c!))).toBeNull()
    expect(scoreExplore(buildContext(state, c!))).toBe(0)

    const open = explorerWorld()
    const first = bestFrontier(buildContext(open.state, open.citizens[0]!))!
    open.citizens[0]!.pos = { x: first.tile % 20, y: Math.floor(first.tile / 20) }
    open.citizens[0]!.task = { kind: 'explore', phase: 'survey', targetTile: first.tile, targetId: null, ticksLeft: 1, startedTick: 0 }
    open.citizens[0]!.nextDecisionTick = Number.MAX_SAFE_INTEGER
    step(open.state)
    const next = bestFrontier(buildContext(open.state, open.citizens[0]!))
    expect(next?.tile).not.toBe(first.tile)
    // Everything within the reveal radius of the surveyed spot is now known.
    expect(open.state.map.discovered[first.tile + EXPLORE_REVEAL_RADIUS]).toBe(1)
  })

  it.each([
    ['a survey', ['survey']],
    ['a conversation', ['talk', 'listen']],
    ['a food hand-over or conversation', ['give', 'talk']],
  ])('is exactly deterministic through save/resume during %s', (_name, phases) => {
    const s = createWorld({ seed: 'social-explore-resume' })
    let saved: string | null = null
    for (let t = 0; t < TICKS_PER_DAY * 6 && !saved; t++) {
      step(s)
      if (s.citizens.some((c) => c.task && phases.includes(c.task.phase) && c.task.ticksLeft > 1)) saved = serialize(s)
    }
    expect(saved).not.toBeNull()
    const resumed = deserialize(saved!)
    const straight = createWorld({ seed: 'social-explore-resume' })
    stepN(straight, resumed.tick)
    expect(serialize(straight)).toBe(saved)
    stepN(resumed, 1000)
    stepN(straight, 1000)
    expect(serialize(resumed)).toBe(serialize(straight))
  })
})
