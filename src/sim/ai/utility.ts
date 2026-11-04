// Utility scoring: every action scores itself in [0, 1] from the citizen's
// needs, inventory, role, personality, resource availability and distance.
// A small seeded jitter (drawn in fixed action order) adds variety.

import { SCORE_JITTER } from '../constants.ts'
import { nextFloat } from '../rng.ts'
import { lifeStage, type LifeStage } from '../citizens/life.ts'
import type { ActionKind, ActionScore } from '../types.ts'
import { ACTIONS } from './actions/index.ts'
import type { DecisionContext } from './context.ts'

/** Children only eat, rest, play (wander near camp) and chat; elders do everything but explore. */
const CHILD_ACTIONS: ReadonlySet<ActionKind> = new Set(['eat', 'rest', 'socialize', 'wander'])
export function allowedFor(stage: LifeStage, kind: ActionKind): boolean {
  if (stage === 'child') return CHILD_ACTIONS.has(kind)
  if (stage === 'elder') return kind !== 'explore'
  return true
}

/** Scores rounded to 3 decimals for readable `lastScores`; never affects ordering ties. */
const round = (x: number) => Math.round(x * 1000) / 1000

/** All actions, best first (ties keep ACTIONS order). Impossible actions score 0 and get no jitter. */
export function scoreActions(ctx: DecisionContext): ActionScore[] {
  const stage = lifeStage(ctx.state, ctx.citizen)
  const scored = ACTIONS.map((a, order) => {
    // Life stage limits what a citizen may do (Population V1). The jitter is
    // drawn for every action regardless, so the RNG draw count never changes.
    const base = allowedFor(stage, a.kind) ? a.score(ctx) : 0
    const jitter = nextFloat(ctx.state.rng) * SCORE_JITTER
    return { kind: a.kind, score: base > 0 ? base + jitter : 0, order }
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map(({ kind, score }) => ({ kind, score: round(score) }))
}
