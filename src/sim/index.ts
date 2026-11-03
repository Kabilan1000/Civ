// Public API of the simulation engine. Other layers import from here only.
// The engine itself (createWorld, step, serialize, ...) arrives in M1.

export { BASE_TICKS_PER_SECOND, MINUTES_PER_TICK, SPEEDS, TICKS_PER_DAY } from './constants.ts'
export type { Speed } from './constants.ts'
export { DEFAULT_WORLD_CONFIG } from './config.ts'
export type { WorldConfig } from './config.ts'

/** Bumped whenever the serialized WorldState shape changes. */
export const SCHEMA_VERSION = 1
