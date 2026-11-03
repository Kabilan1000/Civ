// Controlled scenarios for interactions that are rare in normal play (M9).
// Everything happens through the real interaction code — nothing is injected
// into the event feed directly.

import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { interact } from '../citizens/relationships.ts'
import {
  CHAT_AFFINITY_BASE,
  CHAT_AFFINITY_CHARM,
  FOOD_SATIETY,
  FRIENDSHIP_AFFINITY,
  GRUDGE_HEALING,
  RIVALRY_AFFINITY,
  SHARE_TICKS,
} from '../constants.ts'
import { seedRng } from '../rng.ts'
import { getCivStats } from '../selectors.ts'
import type { Citizen } from '../types.ts'
import { decide } from './decide.ts'
import { argueChance, resolveConversation } from './social.ts'
import { advanceTasks } from './tasks.ts'

const OPEN = Array.from({ length: 9 }, () => '.........')
const pair = () => {
  const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }, { x: 3, y: 2 }], food: 50 })
  return { state, a: citizens[0]!, b: citizens[1]! }
}

/** Resolve conversations (seeded) until `outcome` happens `times` times; returns the attempts used. */
function conversationsUntil(state: ReturnType<typeof pair>['state'], a: Citizen, b: Citizen, outcome: 'chat' | 'argument', times: number) {
  let hits = 0
  let attempts = 0
  while (hits < times && attempts < 500) {
    state.rng = seedRng(`rare-${attempts}`)
    if (resolveConversation(state, a, b) === outcome) hits++
    attempts++
  }
  return attempts
}

describe('rare social interactions (controlled scenarios)', () => {
  it('repeated arguments between touchy, unsociable citizens produce a rivalry event once', () => {
    const { state, a, b } = pair()
    for (const c of [a, b]) c.personality = { sociability: 0, diligence: 0.5, curiosity: 0.5, resilience: 0 }
    expect(argueChance(a, b)).toBeGreaterThan(0.2)
    let argued = 0
    for (let i = 0; i < 400 && a.relationships[b.id]?.affinity !== undefined ? a.relationships[b.id]!.affinity > RIVALRY_AFFINITY : i < 400; i++) {
      state.rng = seedRng(`rivals-${i}`)
      if (resolveConversation(state, a, b) === 'argument') argued++
    }
    expect(a.relationships[b.id]!.affinity).toBeLessThanOrEqual(RIVALRY_AFFINITY)
    expect(argued).toBeGreaterThanOrEqual(2)
    const rivalryEvents = state.events.filter((e) => e.kind === 'rivalry' && e.citizenIds[0] === a.id)
    expect(rivalryEvents).toHaveLength(1) // once per crossing, not on every later argument
    expect(getCivStats(state).rivalries).toBe(1)
  })

  it('grudges heal slowly: a chat warms a resentful citizen only half as much', () => {
    const { state, a, b } = pair()
    interact(state, a, b, 0, -30, 20) // a resents b; b likes a
    state.rng = seedRng('x')
    a.personality.sociability = 1
    b.personality.sociability = 1
    conversationsUntil(state, a, b, 'chat', 1)
    const full = CHAT_AFFINITY_BASE + CHAT_AFFINITY_CHARM * 1
    expect(b.relationships[a.id]!.affinity).toBeCloseTo(20 + full, 9) // no grudge on b's side
    // a's affinity went up by half the usual warmth for each chat (arguments may have intervened, so check the last chat).
    const before = a.relationships[b.id]!.affinity
    if (before < -10) {
      conversationsUntil(state, a, b, 'chat', 1)
      expect(a.relationships[b.id]!.affinity).toBeCloseTo(before + full * GRUDGE_HEALING, 9)
    }
  })

  it('repeated warm chats produce a mutual friendship (counted once in the dashboard)', () => {
    const { state, a, b } = pair()
    for (const c of [a, b]) c.personality = { sociability: 1, diligence: 0.5, curiosity: 0.5, resilience: 1 }
    conversationsUntil(state, a, b, 'chat', 8)
    expect(a.relationships[b.id]!.affinity).toBeGreaterThanOrEqual(FRIENDSHIP_AFFINITY)
    expect(b.relationships[a.id]!.affinity).toBeGreaterThanOrEqual(FRIENDSHIP_AFFINITY)
    // A friendship event per direction (re-emitted only if an argument drops it below and a chat re-crosses).
    const fr = state.events.filter((e) => e.kind === 'friendship')
    expect(fr.some((e) => e.citizenIds[0] === a.id && e.citizenIds[1] === b.id)).toBe(true)
    expect(fr.some((e) => e.citizenIds[0] === b.id && e.citizenIds[1] === a.id)).toBe(true)
    expect(getCivStats(state).friendships).toBe(1)
  })

  it('a well-fed carrier decides on its own to share food with a hungry neighbour, conserving food', () => {
    const { state, a: giver, b: hungry } = pair() // stockpile stocked: delivering is not urgent
    giver.carrying = { kind: 'berries', amount: 3 }
    giver.needs.satiety = 85
    giver.personality.sociability = 0.9
    hungry.needs.satiety = 20
    hungry.nextDecisionTick = Number.MAX_SAFE_INTEGER // keep the receiver where it is
    decide(state)
    expect(giver.task).toMatchObject({ kind: 'share', targetId: hungry.id })
    const before = giver.carrying.amount + state.ledger.foodEaten
    for (let i = 0; i < 20 && giver.task; i++) advanceTasks(state)
    expect(state.events.at(-1)).toMatchObject({ kind: 'sharedFood', citizenIds: [giver.id, hungry.id] })
    const units = state.events.at(-1)!.data!.units as number
    expect(hungry.needs.satiety).toBe(20 + units * FOOD_SATIETY)
    expect((giver.carrying?.amount ?? 0) + state.ledger.foodEaten).toBe(before)
    expect(SHARE_TICKS).toBeGreaterThan(0)
  })

  it('survival still comes first: a hungry or exhausted citizen does not choose a social action', () => {
    const { state, a, b } = pair()
    a.needs = { satiety: 20, energy: 90, social: 0, health: 100 }
    b.needs.satiety = 30
    a.carrying = { kind: 'berries', amount: 3 }
    decide(state)
    expect(['eat', 'rest']).toContain(a.task?.kind)
  })
})
