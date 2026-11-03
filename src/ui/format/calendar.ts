// Calendar presentation (M10a). Everything here is derived from stored ticks
// with the sim's pure calendar functions — seasons and years are never
// stored as simulation state or events (docs/design/LIVING_WORLD_TDS.md §6.4).

import {
  calendarAt,
  dayNumberAt,
  minuteOfDayAt,
  seasonAt,
  seasonStartsBetween,
  yearAt,
  type Season,
} from '../../sim/index.ts'

export const SEASON_LABELS: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "Spring 3, Year 1" */
export function formatDate(tick: number): string {
  const d = calendarAt(tick)
  return `${SEASON_LABELS[d.season]} ${d.dayOfSeason}, Year ${d.year}`
}

/** "14:42" */
export function formatClockTime(tick: number): string {
  const m = minuteOfDayAt(tick)
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** "Spring 3, Year 1 · 14:42", with " (late night)" after midnight (still the same day). */
export function formatCalendarTick(tick: number): string {
  const late = minuteOfDayAt(tick) < 6 * 60 ? ' (late night)' : ''
  return `${formatDate(tick)} · ${formatClockTime(tick)}${late}`
}

/** "Summer, Year 1" — the season that begins at a season-start tick. */
export function formatSeasonStart(tick: number): string {
  return `${SEASON_LABELS[seasonAt(tick)]}, Year ${yearAt(tick)}`
}

/** Short season name for tight spaces (chart markers): "Sum". */
export function seasonAbbrev(tick: number): string {
  return SEASON_LABELS[seasonAt(tick)].slice(0, 3)
}

/** Tooltip for the clock: absolute day plus how the calendar works. */
export function calendarHint(tick: number): string {
  return (
    `Day ${dayNumberAt(tick)} of this world. Seasons last 12 days; a year is 4 seasons (48 days). ` +
    'Days — and so seasons and years — begin at dawn (06:00); times after midnight still belong to the same day.'
  )
}

export type FeedItem<T> = { type: 'event'; event: T } | { type: 'season'; tick: number; label: string }

/**
 * Insert a separator wherever a season begins between two consecutive
 * listed events. `newestFirst` must be ordered by tick descending, as the
 * feed shows it. A separator sits above the older event and below the newer
 * one; several boundaries between two events each get one (newest first).
 * Nothing is added above the newest or below the oldest event.
 */
export function withSeasonSeparators<T extends { tick: number }>(newestFirst: readonly T[]): FeedItem<T>[] {
  const out: FeedItem<T>[] = []
  newestFirst.forEach((event, i) => {
    if (i > 0) {
      const newer = newestFirst[i - 1]!.tick
      const starts = seasonStartsBetween(event.tick, newer)
      for (let k = starts.length - 1; k >= 0; k--) {
        out.push({ type: 'season', tick: starts[k]!, label: formatSeasonStart(starts[k]!) })
      }
    }
    out.push({ type: 'event', event })
  })
  return out
}

export interface SeasonMarker {
  tick: number
  /** Fractional sample index where the season begins (for x placement). */
  at: number
  label: string
  short: string
}

/**
 * Season boundaries that fall within a chart's sampled span. `ticks` are the
 * sample ticks, ascending. A boundary between two samples is placed by linear
 * interpolation of its tick between them.
 */
export function seasonMarkers(ticks: readonly number[]): SeasonMarker[] {
  if (ticks.length < 2) return []
  const out: SeasonMarker[] = []
  let i = 0
  for (const t of seasonStartsBetween(ticks[0]!, ticks[ticks.length - 1]!)) {
    while (i < ticks.length - 2 && ticks[i + 1]! < t) i++
    const a = ticks[i]!
    const b = ticks[i + 1]!
    const at = b === a ? i : i + (t - a) / (b - a)
    out.push({ tick: t, at, label: formatSeasonStart(t), short: seasonAbbrev(t) })
  }
  return out
}

/**
 * Chart label layout for season markers: a marker gets a text label only if
 * it is ≥ MARKER_LABEL_GAP after the previous label and clear of the right
 * edge; every marker keeps its line.
 */
export const MARKER_LABEL_GAP = 26
const MARKER_LABEL_WIDTH = 14
export function layoutMarkers<T extends { x: number }>(markers: readonly T[], right: number): (T & { labelled: boolean })[] {
  const out: (T & { labelled: boolean })[] = []
  let lastLabelX = -Infinity
  for (const m of markers) {
    const labelled = m.x - lastLabelX >= MARKER_LABEL_GAP && m.x <= right - MARKER_LABEL_WIDTH
    if (labelled) lastLabelX = m.x
    out.push({ ...m, labelled })
  }
  return out
}
