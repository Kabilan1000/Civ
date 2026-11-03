import { describe, expect, it } from 'vitest'
import {
  calendarAt,
  dayOfSeasonAt,
  dayOfYearAt,
  isSeasonStart,
  isYearStart,
  seasonAt,
  seasonIndexAt,
  seasonStartTickAt,
  seasonStartsBetween,
  yearAt,
} from './calendar.ts'
import { DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR } from './constants.ts'
import { serialize } from './serialize.ts'
import { dayNumberAt, isDayStart, minuteOfDayAt } from './systems/time.ts'
import { createWorld, stepN } from './world.ts'

const day = (n: number) => (n - 1) * TICKS_PER_DAY // first tick of day n

describe('calendar constants', () => {
  it('uses the approved calendar: 240-tick days, 12-day seasons, 48-day years', () => {
    expect(TICKS_PER_DAY).toBe(240)
    expect(DAYS_PER_SEASON).toBe(12)
    expect(SEASONS).toEqual(['spring', 'summer', 'autumn', 'winter'])
    expect(DAYS_PER_YEAR).toBe(48)
    expect(TICKS_PER_SEASON).toBe(2880)
    expect(TICKS_PER_YEAR).toBe(11520)
  })
})

describe('calendarAt', () => {
  it('tick 0 is Spring 1, Year 1, 06:00', () => {
    expect(calendarAt(0)).toEqual({ year: 1, season: 'spring', seasonIndex: 0, dayOfSeason: 1, dayOfYear: 1, day: 1 })
    expect(minuteOfDayAt(0)).toBe(6 * 60)
  })

  it('season boundaries fall on day starts: ticks 2879 / 2880', () => {
    expect(calendarAt(2879)).toMatchObject({ season: 'spring', dayOfSeason: 12, day: 12, year: 1 })
    expect(calendarAt(2880)).toMatchObject({ season: 'summer', dayOfSeason: 1, day: 13, year: 1 })
    expect(dayNumberAt(2880)).toBe(13)
    expect(isDayStart(2880)).toBe(true)
  })

  it('walks through all four seasons of year 1', () => {
    expect(seasonAt(day(1))).toBe('spring')
    expect(seasonAt(day(13))).toBe('summer')
    expect(seasonAt(day(25))).toBe('autumn')
    expect(seasonAt(day(37))).toBe('winter')
    expect(seasonAt(day(48) + 239)).toBe('winter')
    expect(seasonIndexAt(day(37))).toBe(3)
  })

  it('year boundary: ticks 11519 / 11520 (day 48 → day 49 = Spring 1, Year 2)', () => {
    expect(calendarAt(11519)).toEqual({ year: 1, season: 'winter', seasonIndex: 3, dayOfSeason: 12, dayOfYear: 48, day: 48 })
    expect(calendarAt(11520)).toEqual({ year: 2, season: 'spring', seasonIndex: 0, dayOfSeason: 1, dayOfYear: 1, day: 49 })
  })

  it('later years keep counting: day 97 is Spring 1, Year 3; day 120 is Summer 12, Year 3', () => {
    expect(calendarAt(day(97))).toMatchObject({ year: 3, season: 'spring', dayOfSeason: 1, dayOfYear: 1 })
    expect(calendarAt(day(120))).toMatchObject({ year: 3, season: 'summer', dayOfSeason: 12, dayOfYear: 24 })
    expect(yearAt(28800)).toBe(3) // day 121
    expect(dayOfYearAt(28800)).toBe(25)
    expect(seasonAt(28800)).toBe('autumn')
  })

  it('late night belongs to the previous day — and so to the previous season and year', () => {
    // Day 12, 02:00 is tick 11*240 + 200 (20 hours after 06:00): still Spring 12.
    const lateSpring = day(12) + 200
    expect(minuteOfDayAt(lateSpring)).toBe(2 * 60)
    expect(calendarAt(lateSpring)).toMatchObject({ season: 'spring', dayOfSeason: 12, day: 12 })
    // Day 48, 05:54 (the last tick of the year) is still Winter, Year 1.
    expect(minuteOfDayAt(11519)).toBe(5 * 60 + 54)
    expect(calendarAt(11519)).toMatchObject({ year: 1, season: 'winter' })
    // Midnight itself (tick-of-day 180) is in the same day as the evening before.
    expect(minuteOfDayAt(day(24) + 180)).toBe(0)
    expect(calendarAt(day(24) + 180)).toMatchObject({ season: 'summer', dayOfSeason: 12 })
  })

  it('day-of-season and day-of-year stay in range over three years', () => {
    for (let t = 0; t < 3 * TICKS_PER_YEAR; t += 37) {
      const d = calendarAt(t)
      expect(d.dayOfSeason).toBeGreaterThanOrEqual(1)
      expect(d.dayOfSeason).toBeLessThanOrEqual(12)
      expect(d.dayOfYear).toBe(d.seasonIndex * 12 + d.dayOfSeason)
      expect(dayOfSeasonAt(t)).toBe(d.dayOfSeason)
      expect(d.day).toBe(dayNumberAt(t))
      expect(d.day).toBe((d.year - 1) * 48 + d.dayOfYear)
    }
  })
})

describe('season and year starts', () => {
  it('isSeasonStart: every 2880 ticks, never at tick 0 (like isDayStart)', () => {
    expect(isSeasonStart(0)).toBe(false)
    expect(isSeasonStart(2879)).toBe(false)
    expect(isSeasonStart(2880)).toBe(true)
    expect(isSeasonStart(2881)).toBe(false)
    expect(isSeasonStart(11520)).toBe(true)
  })

  it('isYearStart: every 11520 ticks, never at tick 0', () => {
    expect(isYearStart(0)).toBe(false)
    expect(isYearStart(2880)).toBe(false)
    expect(isYearStart(11520)).toBe(true)
    expect(isYearStart(23040)).toBe(true)
  })

  it('seasonStartTickAt', () => {
    expect(seasonStartTickAt(0)).toBe(0)
    expect(seasonStartTickAt(2879)).toBe(0)
    expect(seasonStartTickAt(2880)).toBe(2880)
    expect(seasonStartTickAt(9000)).toBe(8640)
  })

  it('seasonStartsBetween: boundaries in (from, to]', () => {
    expect(seasonStartsBetween(0, 2879)).toEqual([])
    expect(seasonStartsBetween(0, 2880)).toEqual([2880])
    expect(seasonStartsBetween(2880, 2880)).toEqual([])
    expect(seasonStartsBetween(2879, 5760)).toEqual([2880, 5760])
    expect(seasonStartsBetween(100, 12000)).toEqual([2880, 5760, 8640, 11520])
    expect(seasonStartsBetween(5000, 100)).toEqual([])
  })
})

describe('calendar is derived only (M10a adds no simulation state)', () => {
  it('reading the calendar does not touch the world', () => {
    const s = createWorld({ seed: 'calendar-pure' })
    stepN(s, 3000)
    const before = serialize(s)
    for (let t = 0; t <= s.tick; t += 97) calendarAt(t)
    calendarAt(s.tick)
    expect(serialize(s)).toBe(before)
  })

  it('stepping across a season boundary emits no calendar events', () => {
    const s = createWorld({ seed: 'calendar-events' })
    stepN(s, TICKS_PER_SEASON + 5)
    const kinds = new Set(s.events.map((e) => e.kind))
    expect([...kinds].some((k) => /season|year/i.test(k))).toBe(false)
  })
})
