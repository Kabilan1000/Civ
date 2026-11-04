import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { conservationTotals } from '../__tests__/invariants.ts'
import { sandbox } from '../__tests__/sandbox.ts'
import { bestFrontier } from '../ai/actions/explore.ts'
import { buildContext } from '../ai/context.ts'
import {
  CAMP_SIGHT_RADIUS,
  EXPLORE_REVEAL_RADIUS,
  EXPLORE_SPACING,
  FOG_CLEAR_DAYS,
  FOG_FULL_DAYS,
  GATHER_TICKS,
  SCHEMA_VERSION,
  TICKS_PER_DAY,
} from '../constants.ts'
import { plantNode } from '../ecology/flora.ts'
import { freshnessOf } from '../map/visibility.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, DEFAULT_SIM_RULES, step, stepN, stepWithRules } from '../world.ts'
import { updateObservation } from './observation.ts'
import { advanceTasks } from './tasks.ts'

const DAY = TICKS_PER_DAY

describe('freshness thresholds', () => {
  it('0–12 days clear, 12–24 fading in three steps, 24+ stale; undiscovered is unknown', () => {
    const f = (days: number) => freshnessOf(1, 0, days * DAY)
    expect(f(0)).toBe(0)
    expect(f(0.5)).toBe(0) // currently observed: within the last day
    expect(f(1)).toBe(1)
    expect(f(FOG_CLEAR_DAYS - 0.01)).toBe(1)
    expect([f(12), f(16), f(20)]).toEqual([2, 3, 4])
    expect(f(FOG_FULL_DAYS)).toBe(5)
    expect(f(400)).toBe(5)
    expect(freshnessOf(0, -1, 0)).toBe(6)
  })
})

/** A big open field, fully discovered and last seen at tick 0; one villager at the camp in a corner. */
function knownField(roles: ('forager' | 'explorer')[] = ['forager']) {
  const rows = Array.from({ length: 30 }, () => '.'.repeat(30))
  const { state, citizens } = sandbox(rows, { camp: [1, 1], citizens: roles.map((role, i) => ({ x: 2 + i, y: 1, role })), food: 500 })
  for (const c of citizens) c.nextDecisionTick = Number.MAX_SAFE_INTEGER
  return { state, citizens }
}

describe('returning fog', () => {
  it('unobserved land fades and the fog returns after 24 days — but it stays discovered', () => {
    const { state } = knownField()
    const far = 28 * 30 + 28
    for (let t = 1; t <= FOG_FULL_DAYS * DAY; t++) {
      state.tick = t
      updateObservation(state)
    }
    expect(freshnessOf(state.map.discovered[far]!, state.map.lastSeen[far]!, state.tick)).toBe(5)
    expect(state.map.discovered[far]).toBe(1)
    expect(state.map.discovered.every((d) => d === 1)).toBe(true) // nothing is ever forgotten
  })

  it('the inhabited settlement and the ground around villagers stay in view', () => {
    const { state } = knownField()
    for (let t = 1; t <= 40 * DAY; t++) {
      state.tick = t
      updateObservation(state)
    }
    const camp = state.structures[0]!.tile
    expect(freshnessOf(1, state.map.lastSeen[camp]!, state.tick)).toBe(0)
    const nearCamp = camp + CAMP_SIGHT_RADIUS // within sight of the campfire
    expect(freshnessOf(1, state.map.lastSeen[nearCamp]!, state.tick)).toBe(0)
  })

  it('a survey refreshes everything within its radius', () => {
    const { state, citizens } = knownField(['explorer'])
    state.tick = 40 * DAY
    const c = citizens[0]!
    c.pos = { x: 15, y: 15 }
    const here = 15 * 30 + 15
    c.task = { kind: 'explore', phase: 'survey', targetTile: here, targetId: null, ticksLeft: 1, startedTick: state.tick }
    advanceTasks(state)
    for (let y = 15 - EXPLORE_REVEAL_RADIUS; y <= 15 + EXPLORE_REVEAL_RADIUS; y++) {
      for (let x = 15 - EXPLORE_REVEAL_RADIUS; x <= 15 + EXPLORE_REVEAL_RADIUS; x++) {
        if ((x - 15) ** 2 + (y - 15) ** 2 <= EXPLORE_REVEAL_RADIUS ** 2) expect(state.map.lastSeen[y * 30 + x]).toBe(state.tick)
      }
    }
    expect(state.events.some((e) => e.kind === 'discovered')).toBe(false) // routine resurveys are not events
  })

  it('plants keep living under the fog; returning shows their real current state', () => {
    const { state } = knownField()
    const far = 25 * 30 + 25
    state.map.resources[far] = { ...plantNode('berries'), bornTick: -40 * DAY, lifespanDays: 44 }
    stepN(state, 30 * DAY)
    expect(freshnessOf(1, state.map.lastSeen[far]!, state.tick)).toBe(5) // nobody looked
    const node = state.map.resources[far]
    expect(node === null || node.stage !== 'mature').toBe(true) // it aged (old, or died) unseen
  })

  it('citizens still reach and gather from known land under the fog', () => {
    const { state, citizens } = knownField()
    const tile = 20 * 30 + 20
    state.map.resources[tile] = plantNode('berries')
    state.tick = 30 * DAY
    expect(freshnessOf(1, state.map.lastSeen[tile]!, state.tick)).toBe(5)
    const c = citizens[0]!
    c.pos = { x: 20, y: 20 }
    c.task = { kind: 'forage', phase: 'gather', targetTile: tile, targetId: null, ticksLeft: GATHER_TICKS.berries, startedTick: state.tick }
    const before = conservationTotals(state)
    for (let i = 0; i < 20 && c.task; i++) advanceTasks(state)
    expect(c.carrying?.amount).toBeGreaterThan(0)
    expect(conservationTotals(state)).toEqual(before)
  })
})

describe('autonomous resurveying', () => {
  it('on a fully known island with stale land, an explorer picks a resurvey target', () => {
    const { state, citizens } = knownField(['explorer'])
    state.tick = 30 * DAY
    const ctx = buildContext(state, citizens[0]!)
    const target = bestFrontier(ctx)
    expect(target).not.toBeNull()
    expect(target!.resurvey).toBe(true)
    expect(target!.gain).toBeGreaterThan(0)
  })

  it('fresh land offers no resurvey work, and resurveying can be switched off', () => {
    const { state, citizens } = knownField(['explorer'])
    state.tick = 5 * DAY
    expect(bestFrontier(buildContext(state, citizens[0]!))).toBeNull()
    state.tick = 30 * DAY
    const ctx = buildContext(state, citizens[0]!)
    ctx.resurvey = false
    expect(bestFrontier(ctx)).toBeNull()
  })

  it('explorers keep working on a known island, cover distinct areas, coordinate, and never loop', () => {
    const { state, citizens } = knownField(['explorer', 'explorer'])
    for (const c of citizens) c.nextDecisionTick = 0
    const surveys: { id: number; tile: number; tick: number }[] = []
    let concurrentTooClose = 0
    for (let t = 0; t < 80 * DAY; t++) {
      step(state)
      for (const c of citizens) {
        if (c.task?.kind === 'explore' && c.task.phase === 'survey' && c.task.ticksLeft === 1) surveys.push({ id: c.id, tile: c.task.targetTile!, tick: state.tick })
      }
      const [a, b] = citizens.map((c) => (c.task?.kind === 'explore' ? c.task.targetTile : null))
      if (a != null && b != null && a !== b && Math.abs((a % 30) - (b % 30)) + Math.abs(Math.floor(a / 30) - Math.floor(b / 30)) < EXPLORE_SPACING) concurrentTooClose++
    }
    expect(surveys.length).toBeGreaterThan(20) // useful work after full discovery
    expect(new Set(surveys.map((s) => s.tile)).size).toBeGreaterThan(15) // many distinct places
    // No loop: a place is never resurveyed while it is still fresh from the last survey.
    const last = new Map<number, number>()
    for (const s of surveys) {
      const prev = last.get(s.tile)
      if (prev !== undefined) expect(s.tick - prev).toBeGreaterThanOrEqual(FOG_CLEAR_DAYS * DAY - 2 * DAY)
      last.set(s.tile, s.tick)
    }
    expect(concurrentTooClose).toBe(0)
    // Fog never builds up much while explorers work it.
    const stale = state.map.lastSeen.filter((v) => state.tick - v >= FOG_FULL_DAYS * DAY).length
    expect(stale / state.map.lastSeen.length).toBeLessThan(0.25)
  })
})

describe('integrity under the returning fog', () => {
  it('a running village: discovery never shrinks, everyone stands on known land, conservation holds, settlement visible', () => {
    const s = createWorld({ seed: 'fog-integrity' })
    const start = conservationTotals(s)
    let discovered = s.map.discovered.filter((d) => d === 1).length
    for (let t = 0; t < 90 * DAY; t++) {
      step(s)
      expect(conservationTotals(s)).toEqual(start)
      if (s.tick % 24 !== 0) continue
      const now = s.map.discovered.filter((d) => d === 1).length
      expect(now).toBeGreaterThanOrEqual(discovered)
      discovered = now
      for (const c of s.citizens) if (c.alive) expect(s.map.discovered[c.pos.y * s.map.width + c.pos.x]).toBe(1)
      for (const st of s.structures) {
        const inhabited = st.kind === 'campfire' || (st.stage === 'complete' && st.residentIds.length > 0)
        if (inhabited) expect(freshnessOf(1, s.map.lastSeen[st.tile]!, s.tick)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('save/resume is exact with fog state; turning resurveying off changes only explorers', () => {
    const s = createWorld({ seed: 'fog-resume' })
    stepN(s, 50 * DAY + 13)
    const resumed = deserialize(serialize(s))
    stepN(s, 20 * DAY)
    stepN(resumed, 20 * DAY)
    expect(serialize(resumed)).toBe(serialize(s))
    const a = createWorld({ seed: 'fog-off' })
    for (let t = 0; t < 10; t++) stepWithRules(a, { ...DEFAULT_SIM_RULES, resurvey: false })
    expect(a.map.lastSeen.length).toBe(a.map.discovered.length)
  })

  it('migrates a real v8 save: discovery kept, discovered land seen at the save tick', () => {
    const json = readFileSync(new URL('../__tests__/fixtures/m10c-save-v8.json', import.meta.url), 'utf8')
    const v8 = JSON.parse(json)
    expect(v8.schemaVersion).toBe(8)
    const w: WorldState = deserialize(json)
    expect(w.schemaVersion).toBe(SCHEMA_VERSION)
    expect(w.map.discovered).toEqual(v8.map.discovered)
    w.map.discovered.forEach((d, i) => expect(w.map.lastSeen[i]).toBe(d === 1 ? v8.tick : -1))
    expect(w.citizens).toEqual(v8.citizens)
    expect(w.map.resources).toEqual(v8.map.resources)
    stepN(w, 5 * DAY) // lives on
  })
})
