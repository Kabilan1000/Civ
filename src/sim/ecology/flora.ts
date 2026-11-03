// Plant life stages and ages (M10b, docs/design/LIVING_WORLD_TDS.md §6.4–7.1).
// Pure helpers; the system that applies them each dawn is systems/ecology.ts.

import {
  PLANT_LIFESPAN_DAYS,
  PLANT_MATURE_AT_DAYS,
  PLANT_OLD_AT_PERMILLE,
  PLANT_SEEDLING_DAYS,
  PLANT_STAGE_MAX,
  TICKS_PER_DAY,
} from '../constants.ts'
import { nextInt, seedRng } from '../rng.ts'
import type { PlantStage, ResourceKind, ResourceNode, TileMap } from '../types.ts'

export type LivingStage = Exclude<PlantStage, 'dead'>

/** Whole days since germination at `tick` (bornTick may be negative). */
export function plantAgeDays(node: Pick<ResourceNode, 'bornTick'>, tick: number): number {
  return Math.floor((tick - node.bornTick) / TICKS_PER_DAY)
}

/** First day of old age: floor(lifespan × OLD_AT‰ / 1000). */
export function oldAtDays(kind: ResourceKind, lifespanDays: number): number {
  return Math.floor((lifespanDays * PLANT_OLD_AT_PERMILLE[kind]) / 1000)
}

/**
 * The living stage a plant of this age should be in, or 'death' once its
 * lifespan is reached. With senescence off (the M10b default) a plant never
 * grows past mature — it neither ages into 'old' nor dies.
 */
export function stageForAge(kind: ResourceKind, ageDays: number, lifespanDays: number, senescence: boolean): LivingStage | 'death' {
  if (ageDays < PLANT_SEEDLING_DAYS[kind]) return 'seedling'
  if (ageDays < PLANT_MATURE_AT_DAYS[kind]) return 'young'
  if (ageDays < oldAtDays(kind, lifespanDays) || !senescence) return 'mature'
  return ageDays < lifespanDays ? 'old' : 'death'
}

export function stageCap(kind: ResourceKind, stage: LivingStage): number {
  return PLANT_STAGE_MAX[kind][stage]
}

/** A living plant node. `amount` defaults to the stage cap (a full plant). */
export function plantNode(
  kind: ResourceKind,
  opts: { stage?: LivingStage; amount?: number; bornTick?: number; lifespanDays?: number } = {},
): ResourceNode {
  const stage = opts.stage ?? 'mature'
  const max = stageCap(kind, stage)
  return {
    kind,
    amount: opts.amount ?? max,
    max,
    stage,
    bornTick: opts.bornTick ?? 0,
    lifespanDays: opts.lifespanDays ?? PLANT_LIFESPAN_DAYS[kind].max,
    diedTick: null,
  }
}

/** At most this share (‰) of a kind's plants may be scheduled to die on the same day (TDS H6). */
export const MAX_SAME_DAY_DEATHS_PERMILLE = 100
/** Redraws allowed per plant before its last draw is accepted (deterministic either way). */
const STAGGER_ATTEMPTS = 24

type AgeDraw = (kind: ResourceKind, tile: number, attempt: number) => { lifespanDays: number; ageDays: number }

/**
 * Assign lifespans and ages to every plant on `map`, in ascending tile order,
 * so that the initial cohort's deaths are staggered: a draw that would put more
 * than MAX_SAME_DAY_DEATHS‰ of a kind's plants on one death day is redrawn.
 * Every age lies in the mature window, so every plant starts (and stays, with
 * senescence off) mature. `draw` must be deterministic.
 */
function staggeredAges(map: TileMap, draw: AgeDraw, apply: (node: ResourceNode, lifespanDays: number, ageDays: number) => void): void {
  const count: Record<ResourceKind, number> = { berries: 0, wood: 0 }
  for (const n of map.resources) if (n) count[n.kind]++
  const cap = (kind: ResourceKind) => Math.max(1, Math.floor((count[kind] * MAX_SAME_DAY_DEATHS_PERMILLE) / 1000))
  const perDeathDay: Record<ResourceKind, Map<number, number>> = { berries: new Map(), wood: new Map() }
  map.resources.forEach((node, tile) => {
    if (!node) return
    const used = perDeathDay[node.kind]
    let pick = draw(node.kind, tile, 0)
    for (let attempt = 1; attempt < STAGGER_ATTEMPTS && (used.get(pick.lifespanDays - pick.ageDays) ?? 0) >= cap(node.kind); attempt++) {
      pick = draw(node.kind, tile, attempt)
    }
    const deathDay = pick.lifespanDays - pick.ageDays
    used.set(deathDay, (used.get(deathDay) ?? 0) + 1)
    apply(node, pick.lifespanDays, pick.ageDays)
  })
}

/** A lifespan, and an age inside that lifespan's mature window, from a uniform source. */
function lifeFrom(kind: ResourceKind, pickInt: (min: number, max: number) => number): { lifespanDays: number; ageDays: number } {
  const span = PLANT_LIFESPAN_DAYS[kind]
  const lifespanDays = pickInt(span.min, span.max)
  return { lifespanDays, ageDays: pickInt(PLANT_MATURE_AT_DAYS[kind], oldAtDays(kind, lifespanDays) - 1) }
}

/**
 * Give every plant of a freshly generated map a staggered age (new worlds).
 * Uses a creation-only stream derived from the seed (`seed#flora`), never the
 * map or AI stream, so terrain and resource placement for every existing seed
 * stay exactly as in v0.1. Every plant starts mature with its v0.1 amount.
 */
export function assignInitialAges(map: TileMap, seed: string): void {
  const rng = seedRng(`${seed}#flora`)
  staggeredAges(
    map,
    (kind) => lifeFrom(kind, (min, max) => nextInt(rng, min, max)),
    (node, lifespanDays, ageDays) => {
      node.stage = 'mature'
      node.lifespanDays = lifespanDays
      node.bornTick = -ageDays * TICKS_PER_DAY
      node.diedTick = null
    },
  )
}

/**
 * Lifespans and ages for the plants of a v5 map being migrated (TDS §6.5):
 * derived from hashes of seed, tile and attempt — staggered like new worlds,
 * with no RNG state. bornTick is aligned to the start of the save's current
 * day so ages advance at dawn like every other plant's. Plants are only given
 * ages: none is removed, moved or changed in amount.
 */
export function assignMigratedAges(map: TileMap, seed: string, tick: number): void {
  const dayStart = tick - (tick % TICKS_PER_DAY)
  staggeredAges(
    map,
    (kind, tile, attempt) => {
      let h = fnv1a32(`${seed}:${tile}:${attempt}`)
      return lifeFrom(kind, (min, max) => {
        const v = min + (h % (max - min + 1))
        h = fnv1a32(`${h}`)
        return v
      })
    },
    (node, lifespanDays, ageDays) => {
      node.stage = 'mature'
      node.lifespanDays = lifespanDays
      node.bornTick = dayStart - ageDays * TICKS_PER_DAY
      node.diedTick = null
    },
  )
}

/** 32-bit FNV-1a hash of a string (deterministic, no RNG state). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
