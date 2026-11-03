import { describe, expect, it } from 'vitest'
import { asciiMap } from '../__tests__/asciiMap.ts'
import { labelRegions, reachableMask } from './flood.ts'

describe('flood fill', () => {
  const map = asciiMap(['..~.', '..~.', '~~~#'])

  it('marks tiles reachable by 4-directional moves', () => {
    expect([...reachableMask(map, 0)]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])
    expect([...reachableMask(map, 3)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0])
    expect([...reachableMask(map, 2)].every((v) => v === 0)).toBe(true)
  })

  it('labels regions in order of lowest tile index', () => {
    const { labels, sizes } = labelRegions(map)
    expect([...labels]).toEqual([1, 1, 0, 2, 1, 1, 0, 2, 0, 0, 0, 0])
    expect(sizes).toEqual([0, 4, 2])
  })
})
