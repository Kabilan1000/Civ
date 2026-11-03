// Time conventions
// ────────────────
// • `state.tick` counts ticks simulated so far. A new world is at tick 0:
//   day 1, 06:00 (dawn). No tick has run yet.
// • step() increments `tick` FIRST, then runs the other systems, so every
//   system in a step sees the tick it is simulating (1, 2, 3, ...).
// • 1 tick = 6 minutes; 240 ticks = 1 day. Day N begins at
//   tick (N - 1) * 240, which is always 06:00.
// • When a step advances `tick` to a multiple of 240 (240, 480, ...), a
//   'dayStarted' event is emitted for the new day. Tick 0 emits
//   'worldCreated' instead.

import {
  DAY_PHASES,
  DAY_START_MINUTE,
  MINUTES_PER_TICK,
  TICKS_PER_DAY,
  type DayPhase,
} from '../constants.ts'
import { pushEvent } from '../events.ts'
import type { WorldState } from '../types.ts'

const MINUTES_PER_DAY = 24 * 60

/** Zero-based day index: 0 for ticks 0..239. */
export function dayIndexAt(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY)
}

/** One-based day number shown to players: day 1 for ticks 0..239. */
export function dayNumberAt(tick: number): number {
  return dayIndexAt(tick) + 1
}

/** Tick within the current day, 0..239. */
export function tickOfDayAt(tick: number): number {
  return tick % TICKS_PER_DAY
}

/** Clock minutes since midnight, 0..1439. Tick-of-day 0 is 06:00. */
export function minuteOfDayAt(tick: number): number {
  return (DAY_START_MINUTE + tickOfDayAt(tick) * MINUTES_PER_TICK) % MINUTES_PER_DAY
}

export function dayPhaseAt(tick: number): DayPhase {
  const t = tickOfDayAt(tick)
  let phase: DayPhase = DAY_PHASES[0]!.phase
  for (const p of DAY_PHASES) if (t >= p.startTick) phase = p.phase
  return phase
}

export function isDayStart(tick: number): boolean {
  return tick > 0 && tickOfDayAt(tick) === 0
}

/** Time system: always the first system in step(). */
export function advanceTime(state: WorldState): void {
  state.tick++
  if (isDayStart(state.tick)) {
    pushEvent(state, 'dayStarted', [], { day: dayNumberAt(state.tick) })
  }
}
