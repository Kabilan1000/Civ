import type { ActionKind } from '../../types.ts'
import type { DecisionContext } from '../context.ts'
import { scoreBuild, startBuild } from './build.ts'
import { scoreDeliver, startDeliver } from './deliver.ts'
import { scoreEat, startEat } from './eat.ts'
import { scoreChop, scoreForage, startChop, startForage } from './gather.ts'
import { scoreRest, startRest } from './rest.ts'
import { scoreWander, startWander } from './wander.ts'

export interface ActionDef {
  kind: ActionKind
  score(ctx: DecisionContext): number
  /** Assign the task; false if it turned out impossible (e.g. unreachable). */
  start(ctx: DecisionContext): boolean
}

/** Fixed order: also the tie-break order for equal scores. */
export const ACTIONS: readonly ActionDef[] = [
  { kind: 'eat', score: scoreEat, start: startEat },
  { kind: 'rest', score: scoreRest, start: startRest },
  { kind: 'deliver', score: scoreDeliver, start: startDeliver },
  { kind: 'forage', score: scoreForage, start: startForage },
  { kind: 'chop', score: scoreChop, start: startChop },
  { kind: 'build', score: scoreBuild, start: startBuild },
  { kind: 'wander', score: scoreWander, start: startWander },
]
