import { describe, expect, it } from 'vitest'
import {
  calendarHint,
  formatCalendarTick,
  formatClockTime,
  formatDate,
  formatSeasonStart,
  layoutMarkers,
  seasonAbbrev,
  seasonMarkers,
  withSeasonSeparators,
} from './calendar.ts'

const day = (n: number) => (n - 1) * 240

describe('calendar formatting', () => {
  it('formats dates from ticks', () => {
    expect(formatDate(0)).toBe('Spring 1, Year 1')
    expect(formatDate(day(3) + 87)).toBe('Spring 3, Year 1')
    expect(formatDate(2880)).toBe('Summer 1, Year 1')
    expect(formatDate(day(48))).toBe('Winter 12, Year 1')
    expect(formatDate(11520)).toBe('Spring 1, Year 2')
  })

  it('formats the clock and the late-night convention', () => {
    expect(formatClockTime(0)).toBe('06:00')
    expect(formatCalendarTick(day(3) + 87)).toBe('Spring 3, Year 1 · 14:42')
    // Day 12 at 02:00 is still Spring 12 (days begin at dawn), labelled late night.
    expect(formatCalendarTick(day(12) + 200)).toBe('Spring 12, Year 1 · 02:00 (late night)')
    // The last tick of year 1 (day 48, 05:54) is still Winter, Year 1.
    expect(formatCalendarTick(11519)).toBe('Winter 12, Year 1 · 05:54 (late night)')
    expect(formatCalendarTick(11520)).toBe('Spring 1, Year 2 · 06:00')
  })

  it('names seasons that begin at a boundary', () => {
    expect(formatSeasonStart(2880)).toBe('Summer, Year 1')
    expect(formatSeasonStart(8640)).toBe('Winter, Year 1')
    expect(formatSeasonStart(11520)).toBe('Spring, Year 2')
    expect(seasonAbbrev(5760)).toBe('Aut')
  })

  it('the clock hint gives the absolute day', () => {
    expect(calendarHint(day(49))).toMatch(/^Day 49 of this world\./)
    expect(calendarHint(0)).toContain('begin at dawn (06:00)')
  })
})

describe('event feed season separators', () => {
  const ev = (tick: number) => ({ tick, id: tick })

  it('adds nothing within one season, and nothing for an empty or single list', () => {
    expect(withSeasonSeparators([])).toEqual([])
    expect(withSeasonSeparators([ev(10)])).toEqual([{ type: 'event', event: ev(10) }])
    const items = withSeasonSeparators([ev(2879), ev(100), ev(0)])
    expect(items.every((i) => i.type === 'event')).toBe(true)
  })

  it('puts a separator between the newer and the older event of a boundary', () => {
    const items = withSeasonSeparators([ev(2900), ev(2880), ev(2870)])
    expect(items.map((i) => (i.type === 'event' ? i.event.tick : `| ${i.label}`))).toEqual([2900, 2880, '| Summer, Year 1', 2870])
  })

  it('an event exactly at a season start belongs to the new season', () => {
    const items = withSeasonSeparators([ev(2880), ev(2879)])
    expect(items.map((i) => i.type)).toEqual(['event', 'season', 'event'])
  })

  it('a long gap (or a filter) crossing several boundaries gets one separator each, newest first', () => {
    const items = withSeasonSeparators([ev(12000), ev(100)])
    expect(items.filter((i) => i.type === 'season').map((i) => (i.type === 'season' ? i.label : ''))).toEqual([
      'Spring, Year 2',
      'Winter, Year 1',
      'Autumn, Year 1',
      'Summer, Year 1',
    ])
  })

  it('equal ticks never produce a separator', () => {
    expect(withSeasonSeparators([ev(2880), ev(2880)]).some((i) => i.type === 'season')).toBe(false)
  })
})

describe('chart season markers', () => {
  const every24 = (from: number, to: number) => {
    const out: number[] = []
    for (let t = from; t <= to; t += 24) out.push(t)
    return out
  }

  it('none for fewer than two samples or a span inside one season', () => {
    expect(seasonMarkers([])).toEqual([])
    expect(seasonMarkers([2880])).toEqual([])
    expect(seasonMarkers(every24(0, 2856))).toEqual([])
  })

  it('places a boundary on the sample at its tick', () => {
    const ticks = every24(0, 4800)
    const [m, ...rest] = seasonMarkers(ticks)
    expect(rest).toEqual([])
    expect(m).toEqual({ tick: 2880, at: 120, label: 'Summer, Year 1', short: 'Sum' })
    expect(ticks[m!.at]).toBe(2880)
  })

  it('interpolates a boundary between samples, and handles uneven spacing', () => {
    expect(seasonMarkers([2800, 2900])[0]!.at).toBeCloseTo(0.8)
    expect(seasonMarkers([0, 1000, 3000, 6000]).map((m) => m.at)).toEqual([1 + 1880 / 2000, 2 + 2760 / 3000])
  })

  it('a 60-day history window (600 samples) shows each season start once, ascending', () => {
    const ticks = every24(14400, 14400 + 599 * 24)
    const marks = seasonMarkers(ticks)
    expect(marks.map((m) => m.tick)).toEqual([14400 + 2880, 14400 + 5760, 14400 + 8640, 14400 + 11520].filter((t) => t <= ticks.at(-1)!))
    expect(marks.map((m) => m.label)).toEqual(['Autumn, Year 2', 'Winter, Year 2', 'Spring, Year 3', 'Summer, Year 3'].slice(0, marks.length))
    for (let k = 1; k < marks.length; k++) expect(marks[k]!.at).toBeGreaterThan(marks[k - 1]!.at)
  })
})

describe('chart season marker labels', () => {
  it('labels markers that have room and skips crowded or edge ones', () => {
    const out = layoutMarkers([{ x: 40 }, { x: 50 }, { x: 70 }, { x: 300 }, { x: 305 }], 310)
    expect(out.map((m) => m.labelled)).toEqual([true, false, true, false, false])
  })

  it('every marker keeps its line even when unlabelled', () => {
    expect(layoutMarkers([{ x: 10 }, { x: 11 }], 310)).toHaveLength(2)
  })
})
