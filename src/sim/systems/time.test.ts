import { describe, expect, it } from 'vitest'
import { TICKS_PER_DAY } from '../constants.ts'
import { getClockTime, getDayNumber, getDayPhase, getTickOfDay, isNight } from '../selectors.ts'
import { createWorld, step, stepN } from '../world.ts'
import { dayIndexAt, dayNumberAt, dayPhaseAt, isDayStart, minuteOfDayAt, tickOfDayAt } from './time.ts'

describe('time conventions', () => {
  it('a new world is tick 0: day 1 at 06:00, dawn', () => {
    const s = createWorld()
    expect(s.tick).toBe(0)
    expect(getDayNumber(s)).toBe(1)
    expect(getClockTime(s)).toEqual({ hour: 6, minute: 0 })
    expect(getDayPhase(s)).toBe('dawn')
  })

  it('each step advances exactly one tick (6 minutes)', () => {
    const s = createWorld()
    step(s)
    expect(s.tick).toBe(1)
    expect(getClockTime(s)).toEqual({ hour: 6, minute: 6 })
  })

  it('has 240 ticks per day; day N starts at tick (N-1)*240', () => {
    expect(TICKS_PER_DAY).toBe(240)
    expect(dayNumberAt(239)).toBe(1)
    expect(dayNumberAt(240)).toBe(2)
    expect(dayIndexAt(480)).toBe(2)
    expect(tickOfDayAt(479)).toBe(239)
    expect(minuteOfDayAt(240)).toBe(6 * 60)
    expect(isDayStart(0)).toBe(false)
    expect(isDayStart(240)).toBe(true)
    expect(isDayStart(241)).toBe(false)
  })

  it('wraps the clock past midnight', () => {
    // tick-of-day 180 = 06:00 + 18h = 00:00
    expect(minuteOfDayAt(180)).toBe(0)
    expect(minuteOfDayAt(239)).toBe(5 * 60 + 54)
  })

  it('assigns day phases at the documented boundaries', () => {
    expect(dayPhaseAt(19)).toBe('dawn')
    expect(dayPhaseAt(20)).toBe('day')
    expect(dayPhaseAt(139)).toBe('day')
    expect(dayPhaseAt(140)).toBe('dusk')
    expect(dayPhaseAt(170)).toBe('night')
    expect(dayPhaseAt(239)).toBe('night')
    expect(dayPhaseAt(240)).toBe('dawn')
  })

  it('emits dayStarted exactly once per new day, at the day boundary', () => {
    const s = createWorld()
    stepN(s, TICKS_PER_DAY - 1)
    expect(s.events.filter((e) => e.kind === 'dayStarted')).toHaveLength(0)
    step(s)
    expect(s.tick).toBe(240)
    expect(getTickOfDay(s)).toBe(0)
    // Other events (e.g. a discovery) may follow in the same tick.
    expect(s.events.find((e) => e.kind === 'dayStarted')).toMatchObject({ tick: 240, data: { day: 2 } })

    stepN(s, TICKS_PER_DAY * 3)
    const days = s.events.filter((e) => e.kind === 'dayStarted')
    expect(days.map((e) => e.tick)).toEqual([240, 480, 720, 960])
    expect(days.map((e) => e.data!.day)).toEqual([2, 3, 4, 5])
  })

  it('isNight selector follows the night phase', () => {
    const s = createWorld()
    stepN(s, 169)
    expect(isNight(s)).toBe(false)
    step(s)
    expect(isNight(s)).toBe(true)
  })

  it('stepN rejects invalid counts', () => {
    expect(() => stepN(createWorld(), -1)).toThrow()
    expect(() => stepN(createWorld(), 1.5)).toThrow()
  })
})
