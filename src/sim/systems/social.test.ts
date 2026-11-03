import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { bestChatPartner, scoreSocialize } from '../ai/actions/socialize.ts'
import { buildContext } from '../ai/context.ts'
import { interact } from '../citizens/relationships.ts'
import {
  CHAT_AFFINITY_BASE,
  CHAT_AFFINITY_CHARM,
  CHAT_FAMILIARITY,
  CHAT_SOCIAL,
  CHAT_TICKS,
  FOOD_SATIETY,
  PAIR_COOLDOWN,
  SHARE_TICKS,
  SOCIAL_COOLDOWN,
  SOCIAL_MIN_NEED,
  TICKS_PER_DAY,
} from '../constants.ts'
import { seedRng } from '../rng.ts'
import type { Citizen, WorldState } from '../types.ts'
import { createWorld, step } from '../world.ts'
import { killCitizen } from './death.ts'
import { decide } from './decide.ts'
import { resolveConversation } from './social.ts'
import { advanceTasks } from './tasks.ts'

const OPEN = Array.from({ length: 9 }, () => '.........')

function pair() {
  const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }, { x: 3, y: 2 }], food: 50 })
  for (const c of citizens) c.nextDecisionTick = Number.MAX_SAFE_INTEGER // drive tasks by hand
  return { state, a: citizens[0]!, b: citizens[1]! }
}

/** Put `a` at the start of a conversation with `b` (as if it had just walked over). */
function startTalk(state: WorldState, a: Citizen, b: Citizen) {
  a.task = { kind: 'socialize', phase: 'talk', targetTile: null, targetId: b.id, ticksLeft: 0, startedTick: state.tick }
}

describe('relationships', () => {
  it('are clamped, keyed by the other id, and never self-referential', () => {
    const { state, a, b } = pair()
    for (let i = 0; i < 50; i++) interact(state, a, b, 30, 40, -40)
    expect(Object.keys(a.relationships)).toEqual([String(b.id)])
    expect(a.relationships[b.id]).toMatchObject({ familiarity: 100, affinity: 100 })
    expect(b.relationships[a.id]).toMatchObject({ familiarity: 100, affinity: -100 })
    expect(() => interact(state, a, a, 1, 1, 1)).toThrow()
  })

  it('stay valid in a running colony', () => {
    const s = createWorld({ seed: 'rel-ranges' })
    for (let t = 0; t < TICKS_PER_DAY * 5; t++) step(s)
    const ids = new Set(s.citizens.map((c) => c.id))
    let records = 0
    for (const c of s.citizens) {
      for (const [key, r] of Object.entries(c.relationships)) {
        records++
        expect(ids.has(Number(key)) && Number(key) !== c.id).toBe(true)
        expect(r.familiarity >= 0 && r.familiarity <= 100).toBe(true)
        expect(r.affinity >= -100 && r.affinity <= 100).toBe(true)
        // Familiarity is applied to both sides equally.
        expect(s.citizens.find((o) => o.id === Number(key))!.relationships[c.id]!.familiarity).toBe(r.familiarity)
      }
    }
    expect(records).toBeGreaterThan(20)
  })
})

describe('conversations', () => {
  it('chat and argue update both sides as documented', () => {
    const outcomes = new Set<string>()
    for (let seed = 0; seed < 40 && outcomes.size < 2; seed++) {
      const { state, a, b } = pair()
      state.rng = seedRng(`talk-${seed}`)
      a.needs.social = 20
      b.needs.social = 20
      const kind = resolveConversation(state, a, b)
      outcomes.add(kind)
      if (kind === 'chat') {
        expect(a.relationships[b.id]).toMatchObject({ familiarity: CHAT_FAMILIARITY, affinity: CHAT_AFFINITY_BASE + CHAT_AFFINITY_CHARM * 0.5 })
        expect(a.needs.social).toBe(20 + CHAT_SOCIAL)
        expect(a.memories.at(-1)).toMatchObject({ kind: 'chat', subjectId: b.id, tick: state.tick })
        expect(b.memories.at(-1)).toMatchObject({ kind: 'chat', subjectId: a.id, tick: state.tick })
      } else {
        expect(a.relationships[b.id]!.affinity).toBeLessThan(0)
        expect(b.relationships[a.id]!.affinity).toBeLessThan(0)
        expect(a.memories.at(-1)).toMatchObject({ kind: 'argument', subjectId: b.id })
        expect(state.events.at(-1)).toMatchObject({ kind: 'argument', citizenIds: [a.id, b.id] })
      }
      expect(a.lastSocialTick).toBe(state.tick)
      expect(b.lastSocialTick).toBe(state.tick)
    }
    expect(outcomes).toEqual(new Set(['chat', 'argument']))
  })

  it('takes exactly CHAT_TICKS after the partner joins, for both participants', () => {
    const { state, a, b } = pair()
    startTalk(state, a, b)
    advanceTasks(state) // recruitment tick
    expect(b.task).toMatchObject({ kind: 'socialize', phase: 'listen', targetId: a.id })
    for (let i = 1; i < CHAT_TICKS; i++) {
      advanceTasks(state)
      expect(a.task?.phase).toBe('talk')
      expect(b.task?.phase).toBe('listen')
    }
    advanceTasks(state)
    expect(a.task).toBeNull()
    expect(b.task).toBeNull()
    expect(a.relationships[b.id]).toBeDefined()
  })

  it('never waits for an unavailable, distant or dead partner', () => {
    const asleep = pair()
    asleep.b.task = { kind: 'rest', phase: 'sleep', targetTile: null, targetId: null, ticksLeft: 0, startedTick: 0 }
    startTalk(asleep.state, asleep.a, asleep.b)
    advanceTasks(asleep.state)
    expect(asleep.a.task).toBeNull() // gave up at once
    expect(asleep.b.task?.phase).toBe('sleep') // not woken

    const far = pair()
    far.b.pos = { x: 8, y: 8 }
    startTalk(far.state, far.a, far.b)
    advanceTasks(far.state)
    expect(far.a.task).toBeNull()

    const dying = pair()
    startTalk(dying.state, dying.a, dying.b)
    advanceTasks(dying.state)
    killCitizen(dying.state, dying.b, 'exhaustion')
    advanceTasks(dying.state)
    expect(dying.a.task).toBeNull()
    expect(dying.a.relationships[dying.b.id]).toBeUndefined() // the chat never completed
  })

  it('the dead are never chosen as partners and cannot listen', () => {
    const { state, a, b } = pair()
    a.needs.social = 10
    a.nextDecisionTick = 0
    expect(bestChatPartner(buildContext(state, a))?.citizen).toBe(b)
    killCitizen(state, b, 'starvation')
    expect(bestChatPartner(buildContext(state, a))).toBeNull()
    expect(scoreSocialize(buildContext(state, a))).toBe(0)
  })

  it('respects personal and pair cooldowns, and is off while hungry or tired', () => {
    const { state, a, b } = pair()
    a.needs.social = 10
    expect(scoreSocialize(buildContext(state, a))).toBeGreaterThan(0)
    a.lastSocialTick = state.tick
    expect(scoreSocialize(buildContext(state, a))).toBe(0)
    state.tick += SOCIAL_COOLDOWN
    interact(state, a, b, 1, 1, 1) // they just talked
    expect(bestChatPartner(buildContext(state, a))).toBeNull()
    state.tick += PAIR_COOLDOWN
    expect(bestChatPartner(buildContext(state, a))?.citizen).toBe(b)
    a.needs.satiety = SOCIAL_MIN_NEED - 1
    expect(scoreSocialize(buildContext(state, a))).toBe(0)
  })

  it('urgent hunger breaks off a conversation', () => {
    const { state, a, b } = pair()
    startTalk(state, a, b)
    advanceTasks(state)
    b.needs.satiety = 8
    b.nextDecisionTick = 0
    decide(state)
    expect(b.task?.kind).toBe('eat')
    advanceTasks(state)
    expect(a.task).toBeNull() // partner left: conversation over, no waiting
  })
})

describe('food sharing', () => {
  it('hands over carried berries after SHARE_TICKS and conserves food exactly', () => {
    const { state, a, b } = pair()
    a.carrying = { kind: 'berries', amount: 3 }
    b.needs.satiety = 30
    a.task = { kind: 'share', phase: 'give', targetTile: null, targetId: b.id, ticksLeft: 0, startedTick: 0 }
    const before = 3 + state.ledger.foodEaten
    for (let i = 1; i < SHARE_TICKS; i++) {
      advanceTasks(state)
      expect(a.carrying!.amount).toBe(3)
    }
    advanceTasks(state)
    expect(a.carrying).toEqual({ kind: 'berries', amount: 1 }) // ceil((90-30)/25)=3, capped at 2
    expect(b.needs.satiety).toBe(30 + 2 * FOOD_SATIETY)
    expect(state.ledger.foodEaten).toBe(2)
    expect((a.carrying?.amount ?? 0) + state.ledger.foodEaten).toBe(before)
    expect(b.memories.at(-1)).toMatchObject({ kind: 'receivedFood', subjectId: a.id })
    expect(a.memories.at(-1)).toMatchObject({ kind: 'gaveFood', subjectId: b.id })
    expect(b.relationships[a.id]!.affinity).toBeGreaterThan(a.relationships[b.id]!.affinity) // directional
    expect(state.events.at(-1)).toMatchObject({ kind: 'sharedFood', citizenIds: [a.id, b.id], data: { units: 2 } })
  })

  it('gives nothing to the dead or the distant', () => {
    const { state, a, b } = pair()
    a.carrying = { kind: 'berries', amount: 3 }
    b.needs.satiety = 30
    killCitizen(state, b, 'starvation')
    a.task = { kind: 'share', phase: 'give', targetTile: null, targetId: b.id, ticksLeft: 0, startedTick: 0 }
    advanceTasks(state)
    expect(a.task).toBeNull()
    expect(a.carrying!.amount).toBe(3)
  })
})
