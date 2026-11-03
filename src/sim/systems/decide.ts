// Decision system (utility AI).
//
// A citizen decides when `tick >= nextDecisionTick`: immediately after a task
// ends, otherwise every DECISION_INTERVAL ticks while busy (staggered per
// citizen since creation). Each decision scores all actions and stores them
// in `lastScores` (the inspector's "why").
//
// Intention persistence (hysteresis): a running task is only abandoned when
// another action beats the current task's own score by SWITCH_MARGIN. The
// margin is waived when the challenger is eat/rest and that need is critical.

import { ACTIONS } from '../ai/actions/index.ts'
import { buildContext } from '../ai/context.ts'
import { scoreActions } from '../ai/utility.ts'
import { CRITICAL_ENERGY, CRITICAL_SATIETY, DECISION_INTERVAL, SWITCH_MARGIN, WANDER_RETRY_TICKS } from '../constants.ts'
import type { ActionKind, Citizen, WorldState } from '../types.ts'
import { clearPath } from './movement.ts'

function isCritical(c: Citizen, kind: ActionKind): boolean {
  return (kind === 'eat' && c.needs.satiety < CRITICAL_SATIETY) || (kind === 'rest' && c.needs.energy < CRITICAL_ENERGY)
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
      const current = scores.find((s) => s.kind === c.task!.kind)?.score ?? 0
      const margin = isCritical(c, best.kind) ? 0 : SWITCH_MARGIN
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
