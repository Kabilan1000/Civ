import { describe, expect, it } from 'vitest'
import type { EcoDay, HistorySample } from '../../sim/index.ts'
import { arrow, forageTrend, recentTotal, villageChange, windowChange } from './land.ts'

const day = (nearBerries: number, nearBushes: number, tripSteps: number | null): EcoDay =>
  ({ nearBerries, nearBushes, tripSteps }) as EcoDay
const sample = (tick: number, population: number, food: number, births?: number, deaths?: number): HistorySample =>
  ({ tick, population, food, births, deaths }) as HistorySample

describe('land trends', () => {
  it('windowChange: means of the last n vs the n before, skipping gaps; null if too little data', () => {
    expect(windowChange([1, 2, 3, 4, 5, 6], 3)).toEqual({ before: 2, after: 5 })
    expect(windowChange([1, null, 3, 4, null, 6], 3)).toEqual({ before: 2, after: 5 })
    expect(windowChange([null, null, 3, 4, 5, 6], 3)).toBeNull() // only 1 real value before
    expect(windowChange([4, 5], 3)).toBeNull()
  })

  it('forageTrend: improving, deteriorating, mixed, steady, unknown', () => {
    const run = (a: EcoDay, b: EcoDay) => forageTrend([a, a, a, a, a, b, b, b, b, b], 5).direction
    expect(run(day(20, 10, 6), day(30, 10, 6))).toBe('improving') // more berries nearby
    expect(run(day(30, 10, 6), day(30, 10, 8))).toBe('deteriorating') // longer trips
    expect(run(day(30, 10, 6), day(40, 10, 8))).toBe('mixed') // berries up, trips longer
    expect(run(day(30, 10, 6), day(31, 10, 6.2))).toBe('steady') // within the noise thresholds
    expect(forageTrend([day(1, 1, 1)], 5).direction).toBe('unknown')
  })

  it('forageTrend ignores days without forage trips for the distance', () => {
    const t = forageTrend([day(20, 10, null), day(20, 10, 6), day(20, 10, 6), day(20, 10, 6), day(20, 10, null), day(20, 10, 9), day(20, 10, 9), day(20, 10, 9)], 4)
    expect(t.steps).toEqual({ before: 6, after: 9 })
    expect(t.direction).toBe('deteriorating')
  })

  it('villageChange: real samples only; births and deaths need both ends', () => {
    const h = [sample(0, 12, 60, 0, 0), sample(240, 13, 50, 1, 0), sample(5 * 240, 15, 30, 4, 1)]
    expect(villageChange(h, 4)).toEqual({ days: 4, people: { before: 13, after: 15 }, births: 3, deaths: 1, foodPerPerson: { before: 50 / 13, after: 2 } })
    expect(villageChange(h, 9)).toBeNull() // no sample that old
    expect(villageChange([sample(0, 12, 60), sample(1200, 12, 60, 2, 0)], 5)!.births).toBeNull() // pre-v7 sample
  })

  it('recentTotal and arrow', () => {
    expect(recentTotal([null, 1, 2, null, 3], 3)).toBe(5)
    expect(recentTotal([null, null], 3)).toBeNull()
    expect(arrow({ before: 41, after: 44 })).toBe('41 → 44')
    expect(arrow({ before: 3.25, after: 2.9 })).toBe('3.3 → 2.9')
    expect(arrow({ before: 5, after: 12.4 })).toBe('5 → 12')
  })
})
