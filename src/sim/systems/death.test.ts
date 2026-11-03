import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import { EXHAUSTED_HEALTH_LOSS, HEALTH_RESILIENCE_FACTOR, STARVING_HEALTH_LOSS } from '../constants.ts'
import { toIndex } from '../grid.ts'
import { getCivStats } from '../selectors.ts'
import { deserialize, serialize } from '../serialize.ts'
import { siteWorkers } from '../structures.ts'
import type { Structure } from '../types.ts'
import { step, stepN } from '../world.ts'
import { assignHomes, planShelter } from './construction.ts'
import { killCitizen } from './death.ts'

const OPEN = Array.from({ length: 9 }, () => '.........')

describe('survival', () => {
  it('starvation drains health at the documented rate and kills', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }], food: 0 })
    c!.nextDecisionTick = Number.MAX_SAFE_INTEGER // no AI: nothing to eat anyway
    c!.personality.resilience = 0
    c!.needs = { satiety: 0, energy: 100, social: 100, health: 30 }
    step(state)
    expect(c!.needs.health).toBeCloseTo(30 - STARVING_HEALTH_LOSS, 9)
    const expectedTicks = Math.ceil((30 - STARVING_HEALTH_LOSS) / STARVING_HEALTH_LOSS)
    for (let i = 0; i < expectedTicks + 5 && c!.alive; i++) step(state)
    expect(c!.alive).toBe(false)
    expect(c!.deathCause).toBe('starvation')
    expect(c!.diedTick).toBeGreaterThan(0)
    expect(state.events.at(-1)).toMatchObject({ kind: 'died', citizenIds: [c!.id], data: { cause: 'starvation' } })
  })

  it('exhaustion also harms health; resilience softens it', () => {
    const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }, { x: 7, y: 7 }], food: 0 })
    const [weak, tough] = citizens
    for (const c of citizens) {
      c.nextDecisionTick = Number.MAX_SAFE_INTEGER
      c.needs = { satiety: 100, energy: 0, social: 100, health: 50 }
    }
    weak!.personality.resilience = 0
    tough!.personality.resilience = 1
    step(state)
    expect(weak!.needs.health).toBeCloseTo(50 - EXHAUSTED_HEALTH_LOSS, 9)
    expect(tough!.needs.health).toBeCloseTo(50 - EXHAUSTED_HEALTH_LOSS * (1 - HEALTH_RESILIENCE_FACTOR), 9)
    weak!.needs.health = 0.05
    step(state)
    expect(weak!.alive).toBe(false)
    expect(weak!.deathCause).toBe('exhaustion')
  })

  it('the dead stop acting entirely and leave the living statistics', () => {
    const { state, citizens } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }, { x: 2, y: 2 }], food: 50 })
    const [dead] = citizens
    killCitizen(state, dead!, 'starvation')
    const frozen = JSON.stringify(dead)
    stepN(state, 500)
    expect(JSON.stringify(dead)).toBe(frozen) // never moves, eats, decides or changes needs
    expect(getCivStats(state).population).toBe(1)
  })

  it('death releases the home, task reservations and carried goods (counted as lost)', () => {
    const { state, citizens } = sandbox(OPEN, {
      camp: [4, 4],
      citizens: [{ x: 1, y: 1, role: 'builder' }, { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }],
      food: 50,
      wood: 20,
    })
    const home: Structure = {
      id: 900, kind: 'shelter', tile: toIndex(1, 7, 9), stage: 'complete', buildProgress: 60, buildCost: 60,
      woodDelivered: 12, woodRequired: 12, lastWorkTick: 0, residentIds: [],
    }
    state.structures.push(home)
    state.nextId = 901
    assignHomes(state)
    const [victim, , , waiting] = citizens
    expect(home.residentIds).toContain(victim!.id)
    expect(waiting!.homeId).toBeNull()

    const site = planShelter(state)!
    victim!.task = { kind: 'build', phase: 'moveTo', targetTile: site.tile, targetId: site.id, ticksLeft: 0, startedTick: 0 }
    victim!.carrying = { kind: 'wood', amount: 3 }
    expect(siteWorkers(state, site)).toBe(1)

    killCitizen(state, victim!, 'exhaustion')
    expect(victim!.task).toBeNull()
    expect(victim!.carrying).toBeNull()
    expect(state.ledger.woodLost).toBe(3)
    expect(siteWorkers(state, site)).toBe(0)
    expect(home.residentIds).not.toContain(victim!.id)
    expect(victim!.homeId).toBeNull()
    expect(waiting!.homeId).toBe(home.id) // the freed slot is re-filled
    expect(home.residentIds.length).toBeLessThanOrEqual(3)
  })

  it('death is preserved through save and load', () => {
    const { state, citizens: [c] } = sandbox(OPEN, { camp: [4, 4], citizens: [{ x: 1, y: 1 }] })
    killCitizen(state, c!, 'starvation')
    const loaded = deserialize(serialize(state))
    expect(loaded.citizens[0]).toMatchObject({ alive: false, deathCause: 'starvation', diedTick: state.tick })
  })
})
