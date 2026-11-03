// Decision system (utility AI).
//
// A citizen decides when `tick >= nextDecisionTick`: immediately after a task
// ends, otherwise every DECISION_INTERVAL ticks while busy (staggered per
// citizen since creation). Each decision scores all actions and stores them
// in `lastScores` (the inspector's "why").
//
// Intention persistence (hysteresis): a running task is only abandoned when
// another action beats the current task's own score by SWITCH_MARGIN. The
// margin is waived when the challenger is eat/rest and that need is critical
// or its score is at maximum urgency (≥ URGENT_SCORE) — but between two
// survival tasks (eat ↔ rest) only a *critical* need that the current task
// does not address may cut in, so they never thrash back and forth.

import { ACTIONS } from '../ai/actions/index.ts'
import { buildContext } from '../ai/context.ts'
import { scoreActions } from '../ai/utility.ts'
import {
  CONVERSATION_COMMITMENT,
  CRITICAL_ENERGY,
  CRITICAL_SATIETY,
  DECISION_INTERVAL,
  URGENT_SCORE,
  SWITCH_MARGIN,
  WANDER_RETRY_TICKS,
} from '../constants.ts'
import type { ActionKind, Citizen, WorldState } from '../types.ts'
import { clearPath } from './movement.ts'

const isSurvival = (kind: ActionKind) => kind === 'eat' || kind === 'rest'

function isCritical(c: Citizen, kind: ActionKind): boolean {
  return (kind === 'eat' && c.needs.satiety < CRITICAL_SATIETY) || (kind === 'rest' && c.needs.energy < CRITICAL_ENERGY)
}

function waivesMargin(c: Citizen, challenger: ActionKind, score: number, current: ActionKind): boolean {
  if (!isSurvival(challenger)) return false
  if (isSurvival(current)) return isCritical(c, challenger) && !isCritical(c, current)
  return score >= URGENT_SCORE || isCritical(c, challenger)
}

export function decide(state: WorldState): void {
  for (const c of state.citizens) {
    if (!c.alive || state.tick < c.nextDecisionTick) continue

    const ctx = buildContext(state, c)
    const scores = scoreActions(ctx)
    c.lastScores = scores
    c.nextDecisionTick = state.tick + DECISION_INTERVAL

    if (c.task) {
      const best = scores[0]!
      if (best.kind === c.task.kind) continue
      let current = scores.find((s) => s.kind === c.task!.kind)?.score ?? 0
      // A conversation or hand-over in progress is worth finishing; only real urgency breaks it.
      if (['talk', 'listen', 'give'].includes(c.task.phase)) current = Math.max(current, CONVERSATION_COMMITMENT)
      const margin = waivesMargin(c, best.kind, best.score, c.task.kind) ? 0 : SWITCH_MARGIN
      if (best.score <= current + margin) continue
      c.task = null // interrupted; carried goods stay carried
      clearPath(c)
    }

    for (const s of scores) {
      if (s.score <= 0) break
      if (ACTIONS.find((a) => a.kind === s.kind)!.start(ctx)) break
    }
    if (!c.task) c.nextDecisionTick = state.tick + WANDER_RETRY_TICKS
  }
}
