// Social interactions (M6).
//
// A conversation is started by an initiator who walked to a partner
// (ai/actions/socialize.ts). On the first 'talk' tick the partner is
// recruited into a matching 'listen' task — only if still alive, awake,
// within INTERACT_RADIUS and available (idle, wandering, or merely walking
// to a job). Nobody ever waits for an absent partner: if recruiting fails,
// or either side leaves, dies or drifts out of range, the conversation ends
// immediately with no effects.
//
// After CHAT_TICKS the initiator resolves the outcome (seeded):
//   argue  with P = ARGUE_BASE + 0.2·(1 − mean sociability) + 0.3·stress
//          + 0.25·bad blood (negative mean affinity), capped at ARGUE_MAX
//   chat   otherwise
// and both tasks end together. Food sharing ('give') hands up to
// SHARE_MAX_UNITS carried berries to a hungry neighbour, who eats them on
// the spot: carried − n, satiety + n·FOOD_SATIETY, ledger.foodEaten + n.

import {
  ARGUE_AFFINITY_BASE,
  ARGUE_AFFINITY_TOUCHY,
  ARGUE_BASE,
  ARGUE_FAMILIARITY,
  ARGUE_MAX,
  ARGUE_SOCIAL,
  CHAT_AFFINITY_BASE,
  CHAT_AFFINITY_CHARM,
  CHAT_FAMILIARITY,
  CHAT_SOCIAL,
  CHAT_TICKS,
  CRITICAL_ENERGY,
  GRUDGE_AFFINITY,
  GRUDGE_HEALING,
  CRITICAL_SATIETY,
  EAT_STOP_SATIETY,
  FOOD_SATIETY,
  INTERACT_RADIUS,
  SHARE_AFFINITY_GIVER,
  SHARE_AFFINITY_RECEIVER,
  SHARE_FAMILIARITY,
  SHARE_MAX_UNITS,
  SHARE_SOCIAL,
  SHARE_TICKS,
} from '../constants.ts'
import { remember } from '../citizens/memory.ts'
import { affinityOf, interact } from '../citizens/relationships.ts'
import { pushEvent } from '../events.ts'
import { manhattan } from '../grid.ts'
import { nextFloat } from '../rng.ts'
import type { Citizen, WorldState } from '../types.ts'
import { clearPath } from './movement.ts'
import { clampNeed } from './needs.ts'

export function findCitizen(state: WorldState, id: number | null): Citizen | undefined {
  return id === null ? undefined : state.citizens.find((c) => c.id === id)
}

export function inReach(a: Citizen, b: Citizen): boolean {
  return manhattan(a.pos, b.pos) <= INTERACT_RADIUS
}

/** Can `c` be drawn into a conversation right now? */
export function isAvailableForChat(c: Citizen): boolean {
  if (!c.alive || c.needs.satiety < CRITICAL_SATIETY || c.needs.energy < CRITICAL_ENERGY) return false
  const t = c.task
  if (!t) return true
  if (t.kind === 'wander') return true
  return t.phase === 'moveTo' && (t.kind === 'forage' || t.kind === 'chop' || t.kind === 'deliver')
}

function endBoth(state: WorldState, a: Citizen, b: Citizen | undefined, end: (s: WorldState, c: Citizen) => void) {
  end(state, a)
  if (b && b.task?.phase === 'listen' && b.task.targetId === a.id) end(state, b)
}

/** Initiator's 'talk' tick. `end` is tasks.endTask (passed in to avoid an import cycle). */
export function talk(state: WorldState, c: Citizen, end: (s: WorldState, c: Citizen) => void): void {
  const task = c.task!
  const partner = findCitizen(state, task.targetId)
  if (!partner || partner === c || !partner.alive || !inReach(c, partner)) {
    endBoth(state, c, partner, end)
    return
  }
  if (task.ticksLeft === 0) {
    // First tick: recruit the partner, or give up at once (no waiting).
    if (!isAvailableForChat(partner)) {
      end(state, c)
      return
    }
    partner.task = {
      kind: 'socialize',
      phase: 'listen',
      targetTile: partner.pos.y * state.map.width + partner.pos.x,
      targetId: c.id,
      ticksLeft: CHAT_TICKS,
      startedTick: state.tick,
    }
    clearPath(partner)
    task.ticksLeft = CHAT_TICKS
    return
  }
  if (partner.task?.phase !== 'listen' || partner.task.targetId !== c.id) {
    end(state, c) // partner was called away
    return
  }
  if (--task.ticksLeft > 0) return
  resolveConversation(state, c, partner)
  endBoth(state, c, partner, end)
}

/** Listener's tick: stays while the initiator is still talking to them. */
export function listen(state: WorldState, c: Citizen, end: (s: WorldState, c: Citizen) => void): void {
  const task = c.task!
  const speaker = findCitizen(state, task.targetId)
  task.ticksLeft--
  const stillTalking = speaker?.alive && speaker.task?.phase === 'talk' && speaker.task.targetId === c.id
  if (!stillTalking || !inReach(c, speaker!) || task.ticksLeft < -1) end(state, c)
}

export function argueChance(a: Citizen, b: Citizen): number {
  const sociability = (a.personality.sociability + b.personality.sociability) / 2
  const lowest = Math.min(a.needs.satiety, a.needs.energy, b.needs.satiety, b.needs.energy)
  const stress = Math.max(0, (50 - lowest) / 50)
  const badBlood = Math.max(0, -(affinityOf(a, b.id) + affinityOf(b, a.id)) / 2) / 100
  return Math.min(ARGUE_MAX, ARGUE_BASE + 0.2 * (1 - sociability) + 0.3 * stress + 0.25 * badBlood)
}

export function resolveConversation(state: WorldState, a: Citizen, b: Citizen): 'chat' | 'argument' {
  const argued = nextFloat(state.rng) < argueChance(a, b)
  if (argued) {
    interact(
      state, a, b, ARGUE_FAMILIARITY,
      -(ARGUE_AFFINITY_BASE + ARGUE_AFFINITY_TOUCHY * (1 - a.personality.resilience)),
      -(ARGUE_AFFINITY_BASE + ARGUE_AFFINITY_TOUCHY * (1 - b.personality.resilience)),
    )
    for (const [self, other] of [[a, b], [b, a]] as const) {
      self.needs.social = clampNeed(self.needs.social + ARGUE_SOCIAL)
      remember(state, self, 'argument', -0.6, { subjectId: other.id })
    }
    pushEvent(state, 'argument', [a.id, b.id])
  } else {
    // Grudges heal slowly: someone who resents the other warms up only half as fast.
    const warmth = (self: Citizen, other: Citizen) =>
      (CHAT_AFFINITY_BASE + CHAT_AFFINITY_CHARM * other.personality.sociability) *
      (affinityOf(self, other.id) < GRUDGE_AFFINITY ? GRUDGE_HEALING : 1)
    interact(state, a, b, CHAT_FAMILIARITY, warmth(a, b), warmth(b, a))
    for (const [self, other] of [[a, b], [b, a]] as const) {
      self.needs.social = clampNeed(self.needs.social + CHAT_SOCIAL)
      remember(state, self, 'chat', 0.3, { subjectId: other.id })
    }
  }
  a.lastSocialTick = state.tick
  b.lastSocialTick = state.tick
  return argued ? 'argument' : 'chat'
}

/** Units the giver would hand over now (0 = nothing to do). */
export function shareUnits(giver: Citizen, receiver: Citizen): number {
  const carried = giver.carrying?.kind === 'berries' ? giver.carrying.amount : 0
  const wanted = Math.ceil(Math.max(0, EAT_STOP_SATIETY - receiver.needs.satiety) / FOOD_SATIETY)
  return Math.min(carried, SHARE_MAX_UNITS, wanted)
}

/** Giver's 'give' tick: after SHARE_TICKS hand over food if the receiver is still close and hungry. */
export function give(state: WorldState, c: Citizen, end: (s: WorldState, c: Citizen) => void): void {
  const task = c.task!
  const receiver = findCitizen(state, task.targetId)
  if (!receiver || receiver === c || !receiver.alive || !inReach(c, receiver) || shareUnits(c, receiver) <= 0) {
    end(state, c)
    return
  }
  if (task.ticksLeft === 0) task.ticksLeft = SHARE_TICKS
  if (--task.ticksLeft > 0) return

  const units = shareUnits(c, receiver)
  c.carrying!.amount -= units
  if (c.carrying!.amount === 0) c.carrying = null
  receiver.needs.satiety = clampNeed(receiver.needs.satiety + units * FOOD_SATIETY)
  state.ledger.foodEaten += units
  interact(state, c, receiver, SHARE_FAMILIARITY, SHARE_AFFINITY_GIVER, SHARE_AFFINITY_RECEIVER)
  c.needs.social = clampNeed(c.needs.social + SHARE_SOCIAL)
  receiver.needs.social = clampNeed(receiver.needs.social + SHARE_SOCIAL)
  remember(state, receiver, 'receivedFood', 0.8, { subjectId: c.id })
  remember(state, c, 'gaveFood', 0.4, { subjectId: receiver.id })
  c.lastSocialTick = state.tick
  pushEvent(state, 'sharedFood', [c.id, receiver.id], { units })
  end(state, c)
}
