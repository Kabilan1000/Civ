// Explore: walk to a frontier and survey it, revealing the fog around it.
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

import { EXPLORE_MIN_NEED, EXPLORE_REVEAL_RADIUS, EXPLORE_SPACING, ROLE_WEIGHTS } from '../../constants.ts'
import { recentMemories } from '../../citizens/memory.ts'
import { manhattan, neighbors4, toPoint } from '../../grid.ts'
import type { TileIndex, TileMap } from '../../types.ts'
import { clamp01, distanceFactor } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

export interface Frontier {
  tile: TileIndex
  steps: number
  gain: number
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

export function bestFrontier(ctx: DecisionContext): Frontier | null {
  if (ctx.frontierMemo !== undefined) return ctx.frontierMemo
  const { state, citizen: c, steps } = ctx
  const { map } = state
  const otherTargets = state.citizens
    .filter((o) => o !== c && o.alive && o.task?.kind === 'explore' && o.task.targetTile !== null)
    .map((o) => toPoint(o.task!.targetTile!, map.width))

  let best: (Frontier & { value: number }) | null = null
  for (const { tile, gain } of mapFrontiers(map)) {
    const d = steps[tile]! // -1 for fog, solid or unreachable tiles
    if (d < 0) continue
    const p = toPoint(tile, map.width)
    if (otherTargets.some((q) => manhattan(p, q) < EXPLORE_SPACING)) continue
    const value = gain / (d + 5)
    if (!best || value > best.value) best = { tile, steps: d, gain, value }
  }
  ctx.frontierMemo = best && { tile: best.tile, steps: best.steps, gain: best.gain }
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
  return clamp01(
    (0.25 + 0.3 * c.personality.curiosity) * role * Math.min(1, frontier.gain / 20) * distanceFactor(frontier.steps) * momentum * night,
  )
}

export function startExplore(ctx: DecisionContext): boolean {
  const frontier = bestFrontier(ctx)
  return frontier !== null && beginTask(ctx.state, ctx.citizen, 'explore', frontier.tile)
}
