export interface WorldConfig {
  seed: string
  width: number
  height: number
  citizenCount: number
}

export const DEFAULT_WORLD_CONFIG: Readonly<WorldConfig> = {
  seed: 'little-worlds',
  width: 36,
  height: 24,
  citizenCount: 12,
}
