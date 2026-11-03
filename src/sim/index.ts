// Public API of the simulation engine. Other layers import from here only.

export * from './constants.ts'
export type * from './types.ts'
export { DEFAULT_WORLD_CONFIG, resolveConfig } from './config.ts'
export { createWorld, step, stepN } from './world.ts'
export { serialize, deserialize, SaveError } from './serialize.ts'
export type { SaveErrorCode } from './serialize.ts'
export * from './selectors.ts'
export { dayIndexAt, dayNumberAt, dayPhaseAt, isDayStart, minuteOfDayAt, tickOfDayAt } from './systems/time.ts'
export {
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
export type { CalendarDate } from './calendar.ts'
export { toIndex, toPoint } from './grid.ts'
