// Golden-state hashing shared by scripts/capture-golden.ts (which records the
// baseline) and golden.test.ts (which checks it). Both must compute hashes in
// exactly the same way, so the logic lives only here.
import { createHash } from 'node:crypto'
import { serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, stepN } from '../world.ts'

/** Seeds and checkpoint ticks from docs/design/LIVING_WORLD_TDS.md §6.4 (D1, D6). */
export const GOLDEN_SEEDS = ['little-worlds', 'm9-check', 'sweep-0', 'sweep-13', 'golden-island'] as const
export const GOLDEN_TICKS = [0, 240, 2880, 11520, 28800] as const

export interface GoldenCheckpoint {
  tick: number
  sha256: string
  bytes: number
}

export interface GoldenSeed {
  seed: string
  /** D6: hash of the tick-0 terrain plus resource kinds and amounts. */
  tick0Map: string
  checkpoints: GoldenCheckpoint[]
}

export interface GoldenFixture {
  description: string
  schemaVersion: number
  sourceCommit: string
  seeds: GoldenSeed[]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function tick0MapHash(state: WorldState): string {
  const { terrain, resources } = state.map
  return sha256(JSON.stringify({ terrain, resources: resources.map((r) => (r ? [r.kind, r.amount] : null)) }))
}

/** One world per seed, stepped through every checkpoint in order. */
export function computeGolden(seed: string): GoldenSeed {
  const state = createWorld({ seed })
  const tick0Map = tick0MapHash(state)
  const checkpoints: GoldenCheckpoint[] = []
  for (const tick of GOLDEN_TICKS) {
    stepN(state, tick - state.tick)
    const json = serialize(state)
    checkpoints.push({ tick, sha256: sha256(json), bytes: json.length })
  }
  return { seed, tick0Map, checkpoints }
}
