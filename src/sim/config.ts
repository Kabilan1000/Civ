import { CITIZEN_NAMES } from './citizens/names.ts'
import { MAX_MAP_SIZE, MIN_MAP_SIZE } from './constants.ts'
import type { WorldConfig } from './types.ts'

export const DEFAULT_WORLD_CONFIG: Readonly<WorldConfig> = {
  seed: 'little-worlds',
  width: 36,
  height: 24,
  citizenCount: 12,
}

/** Merge overrides onto defaults and validate. Throws on invalid config. */
export function resolveConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, ...overrides }
  const { seed, width, height, citizenCount } = config
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('WorldConfig.seed must be a non-empty string')
  }
  for (const [key, value] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(value) || value < MIN_MAP_SIZE || value > MAX_MAP_SIZE) {
      throw new Error(`WorldConfig.${key} must be an integer in [${MIN_MAP_SIZE}, ${MAX_MAP_SIZE}]`)
    }
  }
  if (!Number.isInteger(citizenCount) || citizenCount < 1 || citizenCount > CITIZEN_NAMES.length) {
    throw new Error(`WorldConfig.citizenCount must be an integer in [1, ${CITIZEN_NAMES.length}]`)
  }
  return config
}
