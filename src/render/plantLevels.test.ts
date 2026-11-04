import { describe, expect, it } from 'vitest'
import { plantNode } from '../sim/ecology/flora.ts'
import type { ResourceNode } from '../sim/index.ts'
import { ALL_KEYS, levelKey, parseKey } from './plantLevels.ts'

const node = (kind: 'berries' | 'wood', stage: ResourceNode['stage'], amount: number, max = amount): ResourceNode => ({
  ...plantNode(kind),
  stage,
  amount,
  max,
  diedTick: stage === 'dead' ? 0 : null,
})

describe('plant sprite levels', () => {
  it('maps every stage and fill level to a pre-rendered texture', () => {
    const samples: ResourceNode[] = [
      node('berries', 'seedling', 0), node('berries', 'young', 3, 3), node('berries', 'mature', 6, 6), node('berries', 'mature', 0, 6),
      node('berries', 'old', 4, 4), node('wood', 'seedling', 0), node('wood', 'young', 4, 4), node('wood', 'mature', 8, 8),
      node('wood', 'mature', 1, 8), node('wood', 'old', 8, 8), node('wood', 'dead', 5, 5), node('wood', 'dead', 0, 5),
    ]
    for (const n of samples) expect(ALL_KEYS).toContain(levelKey(n))
    expect(new Set(samples.map(levelKey)).size).toBe(samples.length) // all visually distinct
  })

  it('shows one berry per berry and tree levels against a full tree', () => {
    expect(parseKey(levelKey(node('berries', 'mature', 4, 6)))).toEqual({ kind: 'berries', stage: 'mature', level: 4 })
    expect(parseKey(levelKey(node('wood', 'young', 4, 4))).level).toBe(2) // a young tree is half a full one
    expect(parseKey(levelKey(node('wood', 'dead', 0, 6))).level).toBe(0) // chopped-out deadwood: a stump
  })
})
