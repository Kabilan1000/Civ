import { describe, expect, it } from 'vitest'
import { sandbox } from './__tests__/sandbox.ts'
import { remember } from './citizens/memory.ts'
import { interact } from './citizens/relationships.ts'
import { MAX_EVENTS, SHELTER_CAPACITY, TICKS_PER_DAY } from './constants.ts'
import { pushEvent } from './events.ts'
import { toIndex } from './grid.ts'
import {
  EVENT_CATEGORIES,
  explainDecision,
  getCitizenDetail,
  getCivStats,
  getEvents,
  getMemories,
  getRelationships,
} from './selectors.ts'
import { serialize } from './serialize.ts'
import { decide } from './systems/decide.ts'
import { killCitizen } from './systems/death.ts'
import type { Structure } from './types.ts'
import { createWorld, step } from './world.ts'

const OPEN = Array.from({ length: 9 }, () => '.........')
const shelter = (id: number, x: number, stage: Structure['stage']): Structure => ({
  id, kind: 'shelter', tile: toIndex(x, 8, 9), stage, buildProgress: 0, buildCost: 60,
  woodDelivered: 0, woodRequired: 12, lastWorkTick: 0, residentIds: [],
})

describe('dashboard selectors', () => {
  it('report population (living only), stockpile, housing and exploration exactly', () => {
    const { state, citizens } = sandbox(OPEN, {
      camp: [4, 4], citizens: Array.from({ length: 5 }, (_, i) => ({ x: i + 1, y: 1 })), food: 17, wood: 9,
      discovered: (x) => x < 3,
    })
    killCitizen(state, citizens[4]!, 'starvation')
    const home = shelter(900, 1, 'complete')
    home.residentIds = [citizens[0]!.id, citizens[1]!.id]
    state.structures.push(home, shelter(901, 5, 'underConstruction'), shelter(902, 7, 'planned'))
    state.nextId = 903
    citizens[0]!.homeId = 900
    citizens[1]!.homeId = 900
    citizens[0]!.needs = { satiety: 40, energy: 60, social: 20, health: 100 }
    for (const c of citizens.slice(1, 4)) c.needs = { satiety: 80, energy: 80, social: 60, health: 80 }

    const stats = getCivStats(state)
    expect(stats.population).toBe(4)
    expect(stats.dead).toBe(1)
    expect(stats.food).toBe(state.stockpile.food)
    expect(stats.wood).toBe(9)
    expect(stats.shelters).toEqual({ complete: 1, underConstruction: 1, planned: 1 })
    expect(stats.housing).toEqual({ capacity: SHELTER_CAPACITY, occupied: 2, homeless: 2 })
    expect(stats.discoveredTiles).toBe(27)
    expect(stats.exploredPercent).toBe(Math.round((27 / 81) * 1000) / 10)
    expect(stats.avgNeeds).toEqual({ satiety: 70, energy: 75, social: 50, health: 85 }) // the dead are excluded
  })

  it('count friendships as mutual and rivalries as either side', () => {
    const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [0, 1, 2, 3].map((i) => ({ x: i, y: 1 })) })
    const [a, b, c, d] = citizens
    interact(state, a!, b!, 10, 60, 60) // mutual friends
    interact(state, a!, c!, 10, 60, 10) // one-sided fondness: not a friendship
    interact(state, c!, d!, 10, -45, 5) // one-sided grudge: a rivalry
    expect(getCivStats(state)).toMatchObject({ friendships: 1, rivalries: 1 })
    killCitizen(state, b!, 'starvation')
    expect(getCivStats(state).friendships).toBe(0) // only living pairs count
  })

  it('match a running world', () => {
    const s = createWorld({ seed: 'dash' })
    for (let t = 0; t < TICKS_PER_DAY * 3; t++) step(s)
    const stats = getCivStats(s)
    const living = s.citizens.filter((c) => c.alive)
    expect(stats.population).toBe(living.length)
    expect(stats.housing.occupied).toBe(living.filter((c) => c.homeId !== null).length)
    expect(stats.housing.capacity).toBe(
      s.structures.filter((x) => x.kind === 'shelter' && x.stage === 'complete').length * SHELTER_CAPACITY,
    )
    expect(stats.food).toBe(s.stockpile.food)
    expect(stats.avgNeeds.satiety).toBeCloseTo(living.reduce((n, c) => n + c.needs.satiety, 0) / living.length, 9)
  })

  it('never modify the world', () => {
    const s = createWorld({ seed: 'readonly' })
    for (let t = 0; t < 600; t++) step(s)
    const before = serialize(s)
    getCivStats(s)
    for (const c of s.citizens) {
      getCitizenDetail(s, c.id)
      explainDecision(s, c.id)
      getRelationships(s, c.id, 'familiarity')
      getMemories(s, c.id)
    }
    getEvents(s, ['social'])
    expect(serialize(s)).toBe(before)
  })
})

describe('inspector selectors', () => {
  it('expose the actual recorded action scores and when they were computed', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }], food: 30 })
    c!.needs.satiety = 15
    decide(state)
    const detail = getCitizenDetail(state, c!.id)!
    expect(detail.scores).toEqual(c!.lastScores)
    expect(detail.scores.length).toBe(10)
    expect(detail.lastDecisionTick).toBe(state.tick)
    const why = explainDecision(state, c!.id)!
    expect(why.chosen).toEqual(c!.lastScores[0])
    expect(why.chosen!.kind).toBe('eat')
    expect(why.current).toBe('eat')
    expect(why.persisted).toBe(false)
    expect(why.runnerUp).toEqual(c!.lastScores.slice(1).find((s) => s.score > 0) ?? null)
    expect(why.impossible).toEqual(c!.lastScores.filter((s) => s.score === 0).map((s) => s.kind))
  })

  it('flags intention persistence only when the task predates the decision', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 2, y: 2 }], food: 500, wood: 500 })
    c!.task = { kind: 'wander', phase: 'linger', targetTile: 0, targetId: null, ticksLeft: 50, startedTick: 0 }
    state.tick = 5
    c!.needs.social = 10 // socialising would score, but nobody is around; something else may top wander slightly
    decide(state)
    const why = explainDecision(state, c!.id)!
    if (why.chosen!.kind !== 'wander') {
      expect(why.persisted).toBe(true)
      expect(c!.task!.kind).toBe('wander')
    } else {
      expect(why.persisted).toBe(false)
    }
  })

  it('show relationships from the inspected citizen\'s side, with the other side alongside', () => {
    const { state, citizens: [mira, theo, ada] } = sandbox(OPEN, {
      camp: [4, 4], citizens: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
    })
    interact(state, mira!, theo!, 20, 30, -10) // Mira likes Theo; Theo is cool towards Mira
    interact(state, mira!, ada!, 40, 5, 5)
    const fromMira = getRelationships(state, mira!.id)
    expect(fromMira.map((r) => r.name)).toEqual([theo!.name, ada!.name]) // by affinity
    expect(fromMira[0]).toMatchObject({ affinity: 30, theirAffinity: -10, familiarity: 20 })
    expect(getRelationships(state, theo!.id)[0]).toMatchObject({ otherId: mira!.id, affinity: -10, theirAffinity: 30 })
    expect(getRelationships(state, mira!.id, 'familiarity').map((r) => r.name)).toEqual([ada!.name, theo!.name])
  })

  it('list memories newest first with names resolved', () => {
    const { state, citizens: [a, b] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }, { x: 2, y: 1 }] })
    remember(state, a!, 'chat', 0.3, { subjectId: b!.id })
    state.tick = 30
    remember(state, a!, 'foundResource', 0.15, { tile: toIndex(3, 4, 9) })
    const ms = getMemories(state, a!.id)
    expect(ms.map((m) => m.kind)).toEqual(['foundResource', 'chat'])
    expect(ms[1]).toMatchObject({ subjectName: b!.name, tick: 0 })
    expect(ms[0]!.place).toEqual({ x: 3, y: 4 })
    for (let i = 1; i < ms.length; i++) expect(ms[i - 1]!.tick).toBeGreaterThanOrEqual(ms[i]!.tick)
  })

  it('report dead citizens without failing', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }] })
    killCitizen(state, c!, 'exhaustion')
    expect(getCitizenDetail(state, c!.id)).toMatchObject({ alive: false, deathCause: 'exhaustion', task: null, home: null })
    expect(getCitizenDetail(state, 9999)).toBeNull()
  })
})

describe('event selectors', () => {
  it('return the stored events, newest first, filtered by category', () => {
    const s = createWorld({ seed: 'events-sel' })
    for (let t = 0; t < TICKS_PER_DAY * 4; t++) step(s)
    const all = getEvents(s)
    expect(all.map((e) => e.id)).toEqual([...s.events].reverse().map((e) => e.id))
    expect(all.length).toBeLessThanOrEqual(MAX_EVENTS)
    const social = getEvents(s, ['social', 'survival'])
    expect(social.every((e) => ['social', 'survival'].includes(EVENT_CATEGORIES[e.kind]))).toBe(true)
    expect(social.length).toBe(s.events.filter((e) => ['social', 'survival'].includes(EVENT_CATEGORIES[e.kind])).length)
    expect(getEvents(s, ['time']).every((e) => e.kind === 'dayStarted' || e.kind === 'worldCreated')).toBe(true)
    expect(getEvents(s, [], 3)).toEqual(all.slice(0, 3))
  })

  it('categorise every event kind', () => {
    const { state } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }] })
    for (const kind of Object.keys(EVENT_CATEGORIES) as (keyof typeof EVENT_CATEGORIES)[]) pushEvent(state, kind)
    expect(getEvents(state).every((e) => EVENT_CATEGORIES[e.kind] !== undefined)).toBe(true)
  })
})
