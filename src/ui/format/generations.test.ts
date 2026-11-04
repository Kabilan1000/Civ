import { describe, expect, it } from 'vitest'
import { generationLabel, generationYear, populationMarks } from './generations.ts'

describe('Generations history labels', () => {
  it('a summary taken at a season start describes the season that ended', () => {
    expect(generationLabel(2880)).toBe('Spring, Year 1')
    expect(generationLabel(11520)).toBe('Winter, Year 1')
    expect(generationLabel(11520 + 2880)).toBe('Spring, Year 2')
    expect(generationYear(11520)).toBe('Year 1')
    expect(generationYear(11520 + 2880)).toBe('Year 2')
  })
})

describe('population peaks and declines', () => {
  it('finds the highest point and the largest meaningful fall', () => {
    const marks = populationMarks([12, 20, 30, 41, 38, 30, 33, 45, 44])
    expect(marks.peak).toEqual({ at: 7, value: 45 })
    expect(marks.decline).toEqual({ from: 3, to: 5, high: 41, low: 30 })
  })

  it('ignores small wobbles and handles empty data', () => {
    expect(populationMarks([60, 59, 60, 58, 60]).decline).toBeNull()
    expect(populationMarks([])).toEqual({ peak: null, decline: null })
  })
})
