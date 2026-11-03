import { describe, expect, it } from 'vitest'
import { MinHeap } from './heap.ts'

describe('MinHeap', () => {
  it('pops in comparator order', () => {
    const heap = new MinHeap((a, b) => a < b)
    for (const v of [5, 3, 9, 1, 7, 3, 0]) heap.push(v)
    const out: number[] = []
    while (heap.size > 0) out.push(heap.pop()!)
    expect(out).toEqual([0, 1, 3, 3, 5, 7, 9])
    expect(heap.pop()).toBeUndefined()
  })
})
