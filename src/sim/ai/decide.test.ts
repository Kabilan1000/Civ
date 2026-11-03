import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { DECISION_INTERVAL } from '../constants.ts'
import { toIndex } from '../grid.ts'
import { decide } from '../systems/decide.ts'
import { createWorld, step } from '../world.ts'

// Camp at (1,1). A berry bush at (6,1) and a tree at (1,6), equidistant.
const ROWS = [
  '........',
  '......b.',
  '........',
  '........',
  '........',
  '........',
  '.T......',
  '........',
]

describe('utility decisions', () => {
  it('a hungry citizen eats when food is accessible', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 3, y: 3 }], food: 10 })
    c!.needs.satiety = 15
    decide(state)
    expect(c!.task?.kind).toBe('eat')
    expect(c!.task?.targetTile).toBe(toIndex(1, 1, 8))
    expect(c!.lastScores[0]!.kind).toBe('eat')
  })

  it('eats carried berries on the spot without walking', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 5, y: 5 }] })
    c!.needs.satiety = 15
    c!.carrying = { kind: 'berries', amount: 2 }
    decide(state)
    expect(c!.task).toMatchObject({ kind: 'eat', phase: 'eat' })
    expect(c!.path).toEqual([])
  })

  it('a hungry citizen with no food anywhere goes foraging instead', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 3, y: 3 }], food: 0 })
    c!.needs.satiety = 15
    decide(state)
    expect(c!.lastScores.find((s) => s.kind === 'eat')!.score).toBe(0)
    expect(c!.task?.kind).toBe('forage')
  })

  it('an exhausted citizen rests', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 3, y: 3 }], food: 50 })
    c!.needs.energy = 5
    decide(state)
    expect(c!.task?.kind).toBe('rest')
  })

  it('roles steer work: with equal demand, foragers forage and builders chop', () => {
    // Empty stockpile: food and wood are both maximally in demand.
    const { state, citizens } = sandbox(ROWS, {
      camp: [1, 1],
      citizens: [{ x: 1, y: 1, role: 'forager' }, { x: 1, y: 1, role: 'builder' }],
      food: 0,
    })
    decide(state)
    expect(citizens[0]!.task?.kind).toBe('forage')
    expect(citizens[1]!.task?.kind).toBe('chop')
  })

  it('village needs can outweigh role: a forager chops when food is stocked but wood is not', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 1, y: 1, role: 'forager' }], food: 50 })
    decide(state)
    expect(c!.task?.kind).toBe('chop')
  })

  it('records all action scores, best first, to explain the decision', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 3, y: 3 }], food: 5 })
    decide(state)
    const kinds = c!.lastScores.map((s) => s.kind).sort()
    expect(kinds).toEqual(['build', 'chop', 'deliver', 'eat', 'explore', 'forage', 'rest', 'share', 'socialize', 'wander'])
    for (let i = 1; i < c!.lastScores.length; i++) {
      expect(c!.lastScores[i - 1]!.score).toBeGreaterThanOrEqual(c!.lastScores[i]!.score)
    }
    expect(c!.task?.kind).toBe(c!.lastScores[0]!.kind)
  })

  it('keeps its intention unless something is clearly better (hysteresis)', () => {
    const { state, citizens: [c] } = sandbox(ROWS, { camp: [1, 1], citizens: [{ x: 3, y: 3 }], food: 500, wood: 500 })
    c!.task = { kind: 'wander', phase: 'linger', targetTile: toIndex(3, 3, 8), targetId: null, ticksLeft: 50, startedTick: 0 }
    const wander = c!.task
    decide(state) // with a full stockpile, foraging is only marginally attractive
    expect(c!.task).toBe(wander)
    expect(c!.nextDecisionTick).toBe(state.tick + DECISION_INTERVAL)

    state.stockpile.food = 0 // now food is urgently needed
    c!.nextDecisionTick = 0
    decide(state)
    expect(c!.task?.kind).toBe('forage')
  })

  it('does not consider resources in the fog or across water', () => {
    // Bush at (6,0) is undiscovered; bush at (2,2) is discovered but walled off by water.
    const rows = ['......b', '.~~~...', '.~b~...', '.~~~...', '.......']
    const { state, citizens: [c] } = sandbox(rows, {
      camp: [0, 4],
      citizens: [{ x: 0, y: 4 }],
      discovered: (x) => x < 5,
    })
    decide(state)
    expect(c!.lastScores.find((s) => s.kind === 'forage')!.score).toBe(0)
    expect(c!.task?.kind).not.toBe('forage')
  })

  it('does not constantly switch goals in a running colony', () => {
    const s = createWorld({ seed: 'no-thrash' })
    const interruptions = s.citizens.map(() => 0)
    const prev = s.citizens.map((c) => c.task)
    for (let t = 0; t < 240 * 4; t++) {
      step(s)
      s.citizens.forEach((c, i) => {
        const before = prev[i]
        // A task replaced directly by another (no null in between) was interrupted.
        if (before && c.task && c.task !== before) {
          interruptions[i]!++
          expect(s.tick - before.startedTick).toBeGreaterThanOrEqual(1)
        }
        prev[i] = c.task
      })
    }
    const perCitizenPerDay = interruptions.map((n) => n / 4)
    expect(Math.max(...perCitizenPerDay)).toBeLessThan(6)
  })
})
