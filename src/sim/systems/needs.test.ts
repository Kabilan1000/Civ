import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import {
  ENERGY_RATES,
  EXHAUSTED_HEALTH_LOSS,
  HEALTH_RECOVERY,
  SATIETY_DECAY,
  SOCIAL_DECAY,
  SOCIAL_RECOVERY,
  STARVING_HEALTH_LOSS,
  TICKS_PER_DAY,
} from '../constants.ts'
import { createWorld, step } from '../world.ts'
import { activityOf, updateNeeds } from './needs.ts'
import { setPath } from './movement.ts'

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

describe('needs', () => {
  const lone = () => sandbox(['.....', '.....'], { camp: [0, 0], citizens: [{ x: 2, y: 1 }] })

  it('satiety decays every tick', () => {
    const { state, citizens: [c] } = lone()
    updateNeeds(state)
    close(c!.needs.satiety, 80 - SATIETY_DECAY)
  })

  it('energy use depends on activity', () => {
    const { state, citizens: [c] } = lone()
    expect(activityOf(c!)).toBe('idle')
    updateNeeds(state)
    close(c!.needs.energy, 90 + ENERGY_RATES.idle)

    c!.task = { kind: 'wander', phase: 'moveTo', targetTile: 1, targetId: null, ticksLeft: 0, startedTick: 0 }
    setPath(state.map, c!, [8])
    expect(activityOf(c!)).toBe('walking')
    c!.task.phase = 'gather'
    expect(activityOf(c!)).toBe('working')
    c!.task.phase = 'sleep'
    expect(activityOf(c!)).toBe('resting')
    const before = c!.needs.energy
    updateNeeds(state)
    close(c!.needs.energy, before + ENERGY_RATES.resting)
    expect(ENERGY_RATES.working).toBeLessThan(ENERGY_RATES.walking)
    expect(ENERGY_RATES.walking).toBeLessThan(ENERGY_RATES.idle)
  })

  it('social decays alone and recovers with company', () => {
    const alone = lone()
    updateNeeds(alone.state)
    close(alone.citizens[0]!.needs.social, 70 - SOCIAL_DECAY)

    const pair = sandbox(['.....'], { camp: [0, 0], citizens: [{ x: 0, y: 0 }, { x: 2, y: 0 }] })
    updateNeeds(pair.state)
    for (const c of pair.citizens) close(c.needs.social, 70 + SOCIAL_RECOVERY)
  })

  it('health falls when starving or exhausted (softened by resilience) and recovers when well', () => {
    const { state, citizens: [c] } = lone()
    c!.needs = { satiety: 0, energy: 0, social: 50, health: 50 }
    c!.personality.resilience = 0
    updateNeeds(state)
    close(c!.needs.health, 50 - STARVING_HEALTH_LOSS - EXHAUSTED_HEALTH_LOSS)

    c!.personality.resilience = 1
    c!.needs = { satiety: 0, energy: 50, social: 50, health: 50 }
    updateNeeds(state)
    close(c!.needs.health, 50 - STARVING_HEALTH_LOSS * 0.5)

    c!.needs = { satiety: 80, energy: 80, social: 50, health: 50 }
    updateNeeds(state)
    close(c!.needs.health, 50 + HEALTH_RECOVERY)
  })

  it('clamps every need to 0..100', () => {
    const { state, citizens: [c] } = lone()
    c!.needs = { satiety: 0.05, energy: 0.05, social: 0.05, health: 0.01 }
    updateNeeds(state)
    for (const v of Object.values(c!.needs)) expect(v).toBe(0)
    c!.needs = { satiety: 100, energy: 99.9, social: 100, health: 100 }
    c!.task = { kind: 'rest', phase: 'sleep', targetTile: 0, targetId: null, ticksLeft: 0, startedTick: 0 }
    updateNeeds(state)
    expect(c!.needs.energy).toBe(100)
    expect(c!.needs.health).toBe(100)
  })

  it('stays within 0..100 for every citizen over many days of full simulation', () => {
    for (const seed of ['needs-a', 'needs-b']) {
      const s = createWorld({ seed })
      for (let t = 0; t < TICKS_PER_DAY * 6; t++) {
        step(s)
        for (const c of s.citizens) {
          for (const v of Object.values(c.needs)) expect(v >= 0 && v <= 100).toBe(true)
        }
      }
    }
  })

  it('is balanced for a 240-tick day: nobody starves or collapses over a week', () => {
    for (let i = 0; i < 12; i++) {
      const s = createWorld({ seed: `balance-${i}` })
      let minSatiety = 100
      let minEnergy = 100
      let minHealth = 100
      for (let t = 0; t < TICKS_PER_DAY * 7; t++) {
        step(s)
        for (const c of s.citizens) {
          minSatiety = Math.min(minSatiety, c.needs.satiety)
          minEnergy = Math.min(minEnergy, c.needs.energy)
          minHealth = Math.min(minHealth, c.needs.health)
        }
      }
      expect(minSatiety, `seed balance-${i}`).toBeGreaterThan(10)
      expect(minEnergy, `seed balance-${i}`).toBeGreaterThan(20)
      expect(minHealth, `seed balance-${i}`).toBeGreaterThan(90)
    }
  })
})
