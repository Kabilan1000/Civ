// Utility scoring: every action scores itself in [0, 1] from the citizen's
// needs, inventory, role, personality, resource availability and distance.
// A small seeded jitter (drawn in fixed action order) adds variety.

import { SCORE_JITTER } from '../constants.ts'
import { nextFloat } from '../rng.ts'
import type { ActionScore } from '../types.ts'
import { ACTIONS } from './actions/index.ts'
import type { DecisionContext } from './context.ts'

/** Scores rounded to 3 decimals for readable `lastScores`; never affects ordering ties. */
const round = (x: number) => Math.round(x * 1000) / 1000

/** All actions, best first (ties keep ACTIONS order). Impossible actions score 0 and get no jitter. */
export function scoreActions(ctx: DecisionContext): ActionScore[] {
  const scored = ACTIONS.map((a, order) => {
    const base = a.score(ctx)
    const jitter = nextFloat(ctx.state.rng) * SCORE_JITTER
    return { kind: a.kind, score: base > 0 ? base + jitter : 0, order }
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map(({ kind, score }) => ({ kind, score: round(score) }))
}
