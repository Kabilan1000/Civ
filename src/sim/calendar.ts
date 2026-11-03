// World calendar (M10a, docs/design/LIVING_WORLD_TDS.md §7.1).
//
// Pure functions of `tick`. The calendar adds no WorldState, no events and
// no ids: it only names the days the time system already counts.
//
// • A day is 240 ticks and begins at 06:00 (systems/time.ts). Seasons and
//   years begin with their first day, so they also turn over at dawn: a
//   late-night time such as 02:00 still belongs to the previous day, and so
//   to the previous season or year.
// • 12 days per season; Spring, Summer, Autumn, Winter; 48 days per year.
// • Tick 0 = Spring 1, Year 1, 06:00.

import { DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, TICKS_PER_SEASON, TICKS_PER_YEAR, type Season } from './constants.ts'
import { dayIndexAt } from './systems/time.ts'

export interface CalendarDate {
  /** 1-based. */
  year: number
  season: Season
  /** 0 spring … 3 winter. */
  seasonIndex: number
  /** 1..DAYS_PER_SEASON. */
  dayOfSeason: number
  /** 1..DAYS_PER_YEAR. */
  dayOfYear: number
  /** Absolute 1-based day number (as dayNumberAt). */
  day: number
}

/** 1-based world year. */
export function yearAt(tick: number): number {
  return Math.floor(dayIndexAt(tick) / DAYS_PER_YEAR) + 1
}

/** 1-based day within the year, 1..48. */
export function dayOfYearAt(tick: number): number {
  return (dayIndexAt(tick) % DAYS_PER_YEAR) + 1
}

/** 0 spring, 1 summer, 2 autumn, 3 winter. */
export function seasonIndexAt(tick: number): number {
  return Math.floor((dayIndexAt(tick) % DAYS_PER_YEAR) / DAYS_PER_SEASON)
}

export function seasonAt(tick: number): Season {
  return SEASONS[seasonIndexAt(tick)]!
}

/** 1-based day within the season, 1..12. */
export function dayOfSeasonAt(tick: number): number {
  return (dayIndexAt(tick) % DAYS_PER_SEASON) + 1
}

export function calendarAt(tick: number): CalendarDate {
  return {
    year: yearAt(tick),
    season: seasonAt(tick),
    seasonIndex: seasonIndexAt(tick),
    dayOfSeason: dayOfSeasonAt(tick),
    dayOfYear: dayOfYearAt(tick),
    day: dayIndexAt(tick) + 1,
  }
}

/** True at the first tick of every season after the first (like isDayStart, never at tick 0). */
export function isSeasonStart(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_SEASON === 0
}

/** True at the first tick of every year after the first. */
export function isYearStart(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_YEAR === 0
}

/** Tick at which the season containing `tick` began (0 for the first season). */
export function seasonStartTickAt(tick: number): number {
  return Math.floor(Math.max(0, tick) / TICKS_PER_SEASON) * TICKS_PER_SEASON
}

/**
 * Season-start ticks t with from < t ≤ to (each a boundary a span of time
 * crosses). Ascending; empty when to ≤ from.
 */
export function seasonStartsBetween(from: number, to: number): number[] {
  const out: number[] = []
  for (let t = seasonStartTickAt(from) + TICKS_PER_SEASON; t <= to; t += TICKS_PER_SEASON) {
    if (t > from) out.push(t)
  }
  return out
}
