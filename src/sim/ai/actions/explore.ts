// Explore: walk to a frontier and survey it, revealing the fog around it.
// Once no reachable frontier is left, explorers RESURVEY (schema v9): they go
// where the most discovered land has faded (unseen for FOG_CLEAR_DAYS) and
// survey it, refreshing it. The unknown always comes first.
//
// Frontier = a tile we can walk to (discovered, not solid, reachable) with
// at least one undiscovered 4-neighbour. Its gain = undiscovered tiles within
// EXPLORE_REVEAL_RADIUS. We pick the best gain / (steps + 5) (ties by index),
// skipping frontiers near another explorer's target. Unreachable frontiers
// never appear (BFS), and surveyed ones stop being frontiers, so nothing is
// selected twice in vain. Interrupted explorers simply pick again later.
// Score: (0.25 + 0.3·curiosity) × role × min(1, gain/20) × distance, ×1.15
// after a recent discovery (memory), 0 unless satiety and energy ≥
// EXPLORE_MIN_NEED, ×0.3 at night.

import { EXPLORE_MIN_NEED, EXPLORE_REVEAL_RADIUS, EXPLORE_SPACING, FOG_CLEAR_DAYS, OBSERVE_INTERVAL, RESURVEY_MIN_GAIN, RESURVEY_WEIGHT, ROLE_WEIGHTS, TICKS_PER_DAY } from '../../constants.ts'
import { recentMemories } from '../../citizens/memory.ts'
import { manhattan, neighbors4, toPoint } from '../../grid.ts'
import type { TileIndex, TileMap } from '../../types.ts'
import { clamp01, distanceFactor } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

export interface Frontier {
  tile: TileIndex
  steps: number
  /** Undiscovered tiles a survey there would reveal — or, for a resurvey, faded tiles it would refresh. */
  gain: number
  /** True when the target is stale known land rather than the unknown. */
  resurvey: boolean
}

/** Undiscovered tiles within EXPLORE_REVEAL_RADIUS of `tile`. */
export function revealGain(map: TileMap, tile: TileIndex): number {
  const c = toPoint(tile, map.width)
  const r = EXPLORE_REVEAL_RADIUS
  let gain = 0
  for (let y = Math.max(0, c.y - r); y <= Math.min(map.height - 1, c.y + r); y++) {
    for (let x = Math.max(0, c.x - r); x <= Math.min(map.width - 1, c.x + r); x++) {
      const dx = x - c.x
      const dy = y - c.y
      if (dx * dx + dy * dy <= r * r && map.discovered[y * map.width + x] === 0) gain++
    }
  }
  return gain
}

/**
 * Passable discovered tiles bordering the fog, with their reveal gain, in
 * tile order. Depends only on terrain and `discovered`; terrain is fixed and
 * discovery only ever grows, so the discovered-tile count identifies the fog
 * state exactly. Cached on that (a derived cache, never serialized — results
 * are identical with or without it). map.version is not used because every
 * gathered berry bumps it.
 */
const frontierCache = new WeakMap<TileMap, { discovered: number; frontiers: { tile: TileIndex; gain: number }[] }>()

export function mapFrontiers(map: TileMap): { tile: TileIndex; gain: number }[] {
  let discovered = 0
  for (const d of map.discovered) discovered += d
  const cached = frontierCache.get(map)
  if (cached && cached.discovered === discovered) return cached.frontiers
  const frontiers: { tile: TileIndex; gain: number }[] = []
  for (let i = 0; i < map.terrain.length; i++) {
    if (map.discovered[i] !== 1 || !neighbors4(map, i).some((n) => map.discovered[n] === 0)) continue
    const gain = revealGain(map, i)
    if (gain > 0) frontiers.push({ tile: i, gain })
  }
  frontierCache.set(map, { discovered, frontiers })
  return frontiers
}

/**
 * Faded discovered tiles within EXPLORE_REVEAL_RADIUS of every tile. "Faded"
 * is judged at the start of the current observation interval (observation
 * refreshes land only on those ticks, so this is when freshness meaningfully
 * changes). A derived cache keyed on everything it reads — that interval, the
 * discovered count and a checksum of lastSeen (surveys refresh land mid-
 * interval) — never serialized; identical results without it.
 */
const staleCache = new WeakMap<TileMap, { key: string; gain: Int32Array }>()

export function staleGains(map: TileMap, tick: number): Int32Array {
  let discovered = 0
  let seenSum = 0
  for (let i = 0; i < map.discovered.length; i++) {
    discovered += map.discovered[i]!
    seenSum = (seenSum + map.lastSeen[i]! * (i + 1)) % 2147483647
  }
  const at = tick - (tick % OBSERVE_INTERVAL)
  const key = `${at}:${discovered}:${seenSum}`
  const cached = staleCache.get(map)
  if (cached && cached.key === key) return cached.gain
  const { width, height } = map
  const old = FOG_CLEAR_DAYS * TICKS_PER_DAY
  const faded = new Uint8Array(width * height)
  for (let i = 0; i < faded.length; i++) faded[i] = map.discovered[i] === 1 && (map.lastSeen[i]! < 0 || at - map.lastSeen[i]! >= old) ? 1 : 0
  const r = EXPLORE_REVEAL_RADIUS
  const gain = new Int32Array(width * height)
  for (let i = 0; i < gain.length; i++) {
    if (map.discovered[i] !== 1) continue
    const cx = i % width
    const cy = Math.floor(i / width)
    let g = 0
    for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= r * r) g += faded[y * width + x]!
      }
    }
    gain[i] = g
  }
  staleCache.set(map, { key, gain })
  return gain
}

export function bestFrontier(ctx: DecisionContext): Frontier | null {
  if (ctx.frontierMemo !== undefined) return ctx.frontierMemo
  const { state, citizen: c, steps } = ctx
  const { map } = state
  const otherTargets = state.citizens
    .filter((o) => o !== c && o.alive && o.task?.kind === 'explore' && o.task.targetTile !== null)
    .map((o) => toPoint(o.task!.targetTile!, map.width))
  const spaced = (tile: TileIndex) => {
    const p = toPoint(tile, map.width)
    return !otherTargets.some((q) => manhattan(p, q) < EXPLORE_SPACING)
  }

  let best: (Frontier & { value: number }) | null = null
  for (const { tile, gain } of mapFrontiers(map)) {
    const d = steps[tile]! // -1 for fog, solid or unreachable tiles
    if (d < 0 || !spaced(tile)) continue
    const value = gain / (d + 5)
    if (!best || value > best.value) best = { tile, steps: d, gain, value, resurvey: false }
  }
  // Nothing worth discovering within reach — frontiers near the coast keep a few unknown
  // water tiles in range forever, so a frontier counts only if it reveals RESURVEY_MIN_GAIN —
  // revisit the most faded known land instead. The unknown always wins when it is worth it.
  if ((!best || best.gain < RESURVEY_MIN_GAIN) && (ctx.resurvey ?? true)) {
    const gains = staleGains(map, state.tick)
    let stale: (Frontier & { value: number }) | null = null
    for (let tile = 0; tile < gains.length; tile++) {
      const gain = gains[tile]!
      const d = steps[tile]!
      if (gain < RESURVEY_MIN_GAIN || d < 0 || !spaced(tile)) continue
      const value = gain / (d + 5)
      if (!stale || value > stale.value) stale = { tile, steps: d, gain, value, resurvey: true }
    }
    if (stale) best = stale
  }
  ctx.frontierMemo = best && { tile: best.tile, steps: best.steps, gain: best.gain, resurvey: best.resurvey }
  return ctx.frontierMemo
}

export function scoreExplore(ctx: DecisionContext): number {
  const c = ctx.citizen
  if (c.needs.satiety < EXPLORE_MIN_NEED || c.needs.energy < EXPLORE_MIN_NEED) return 0
  const role = ROLE_WEIGHTS[c.role].explore ?? 1
  const frontier = bestFrontier(ctx)
  if (!frontier) return 0
  const momentum = recentMemories(ctx.state, c, 'discovered').length > 0 ? 1.15 : 1
  const night = ctx.night ? 0.3 : 1
  const kind = frontier.resurvey ? RESURVEY_WEIGHT : 1
  return clamp01(
    (0.25 + 0.3 * c.personality.curiosity) * role * Math.min(1, frontier.gain / 20) * distanceFactor(frontier.steps) * momentum * night * kind,
  )
}

export function startExplore(ctx: DecisionContext): boolean {
  const frontier = bestFrontier(ctx)
  return frontier !== null && beginTask(ctx.state, ctx.citizen, 'explore', frontier.tile)
}
