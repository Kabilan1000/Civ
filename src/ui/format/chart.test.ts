import { describe, expect, it } from 'vitest'
import { segments } from './chart.ts'

describe('gap-aware chart segments', () => {
  it('splits series at missing samples (recorded before a field existed)', () => {
    expect(segments([])).toEqual([])
    expect(segments([1, 2, 3])).toEqual([[0, 1, 2]])
    expect(segments([null, null, 4, 5])).toEqual([[2, 3]])
    expect(segments([1, null, 3, 4, null])).toEqual([[0], [2, 3]])
    expect(segments([null])).toEqual([])
  })
})
