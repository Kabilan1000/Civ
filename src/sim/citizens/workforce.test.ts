import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { conservationTotals } from '../__tests__/invariants.ts'
import { revealGain } from '../ai/actions/explore.ts'
import { FOG_FULL_DAYS, MAX_EXPLORERS, MIN_BUILDERS, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants.ts'
import { deserialize, serialize } from '../serialize.ts'
import { updateLifeCycle } from '../systems/lifecycle.ts'
import type { Citizen, Role, WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'
import { lifeStage } from './life.ts'
import { adultRoles, chooseReplacementExplorer, minForagers, roleAtAdulthood } from './workforce.ts'

const DAY = TICKS_PER_DAY
const village60 = () => deserialize(readFileSync(new URL('../__tests__/fixtures/popv1-save-v7-60.json', import.meta.url), 'utf8'))
const staleShare = (s: WorldState) => {
  const known = s.map.discovered.filter((d) => d === 1).length
  return s.map.lastSeen.filter((v, i) => s.map.discovered[i] === 1 && s.tick - v >= FOG_FULL_DAYS * DAY).length / known
}

describe('the reported 60-citizen village with no adult explorer', () => {
  it('starts with no adult explorer, two explorer children, and stale land', () => {
    const s = village60()
    expect(s.citizens.filter((c) => c.alive)).toHaveLength(60)
    expect(adultRoles(s).explorer).toBe(0)
    expect(s.citizens.filter((c) => c.alive && c.role === 'explorer' && lifeStage(c, s.tick) === 'child')).toHaveLength(2)
  })

  it('gains a working explorer at the next dawn, resumes surveying, and refreshes the stale land', () => {
    const s = village60()
    // Land awaiting resurvey: everything known was last seen 30 days ago.
    s.map.lastSeen = s.map.lastSeen.map((v) => (v >= 0 ? s.tick - 30 * DAY : -1))
    const start = conservationTotals(s)
    const stale0 = staleShare(s)
    expect(stale0).toBeGreaterThan(0.9)
    const before = new Map(s.citizens.map((c) => [c.id, c.role]))
    stepN(s, DAY - (s.tick % DAY)) // to the next dawn
    const ev = s.events.filter((e) => e.kind === 'roleChanged')
    expect(ev).toHaveLength(1)
    const explorer = s.citizens.find((c) => c.id === ev[0]!.citizenIds[0])!
    expect(explorer.role).toBe('explorer')
    expect(lifeStage(explorer, s.tick)).toBe('adult')
    // The most curious of those who could be spared, food and building staffed.
    const after = adultRoles(s)
    expect(after.forager).toBeGreaterThanOrEqual(minForagers(after.forager + after.builder + after.explorer))
    expect(after.builder).toBeGreaterThanOrEqual(MIN_BUILDERS)
    let resurveys = 0
    for (let t = 0; t < 40 * DAY; t++) {
      step(s)
      expect(conservationTotals(s)).toEqual(start)
      const task = explorer.task
      if (task?.kind === 'explore' && task.startedTick === s.tick && revealGain(s.map, task.targetTile!) === 0) resurveys++
    }
    expect(resurveys).toBeGreaterThan(5)
    expect(staleShare(s)).toBeLessThan(stale0 - 0.3) // progressively refreshed
    // Only that one switch happened; nobody else changed profession.
    const switched = s.citizens.filter((c) => before.has(c.id) && before.get(c.id) !== c.role && c.id !== explorer.id && lifeStage(c, s.tick) !== 'adult')
    expect(switched.filter((c) => s.events.some((e) => e.kind === 'roleChanged' && e.citizenIds[0] === c.id))).toHaveLength(0)
    expect(s.events.filter((e) => e.kind === 'roleChanged')).toHaveLength(1)
  })
})

describe('explorer staffing rules', () => {
  /** A world of `n` adult citizens with given roles (ages adult). */
  function workforce(roles: Role[], curiosity: number[] = []): WorldState {
    const s = createWorld({ seed: 'workforce', citizenCount: roles.length })
    s.tick = 30 * DAY
    s.citizens.forEach((c, i) => {
      c.role = roles[i]!
      c.personality.curiosity = curiosity[i] ?? 0.5
      c.bornTick = s.tick - 25 * TICKS_PER_YEAR
    })
    return s
  }

  it('picks the most curious spare adult; ties go to the lower id', () => {
    const s = workforce(['forager', 'forager', 'forager', 'forager', 'builder', 'builder', 'builder'], [0.2, 0.9, 0.9, 0.1, 0.95, 0.3, 0.3])
    // builders: 3 → can spare one (≥ 2 left); foragers: 4 of 7 adults need ≥ 2.
    expect(chooseReplacementExplorer(s)!.id).toBe(s.citizens[4]!.id) // the 0.95 builder
    s.citizens[4]!.personality.curiosity = 0.9
    expect(chooseReplacementExplorer(s)!.id).toBe(s.citizens[1]!.id) // tie at 0.9: lowest id
  })

  it('never takes someone food gathering or construction cannot spare', () => {
    expect(chooseReplacementExplorer(workforce(['forager', 'forager', 'builder', 'builder']))).toBeNull()
    expect(chooseReplacementExplorer(workforce(['forager', 'forager', 'forager', 'builder', 'builder']))).not.toBeNull()
  })

  it('does nothing while an adult explorer exists; elders and children do not count as explorers', () => {
    const s = workforce(['explorer', 'forager', 'forager', 'forager', 'builder', 'builder', 'builder'])
    expect(chooseReplacementExplorer(s)).toBeNull()
    s.citizens[0]!.bornTick = s.tick - 55 * TICKS_PER_YEAR // the explorer is now an elder
    expect(adultRoles(s).explorer).toBe(0)
    expect(chooseReplacementExplorer(s)).not.toBeNull()
  })

  it('at coming of age: explorer if there is none, a second only if curious, never beyond the cap', () => {
    const s = workforce(['forager', 'forager', 'builder', 'builder'])
    const kid = s.citizens[0]!
    kid.bornTick = s.tick - 14 * TICKS_PER_YEAR
    kid.personality.curiosity = 0.1
    expect(roleAtAdulthood(s, kid)).toBe('explorer') // none yet
    s.citizens[1]!.role = 'explorer'
    expect(roleAtAdulthood(s, kid)).toBe('forager') // one exists, not curious: the scarcer of forager (0) / builder (2)
    kid.personality.curiosity = 0.8
    expect(roleAtAdulthood(s, kid)).toBe('explorer') // curious: a second explorer
    s.citizens[2]!.role = 'explorer'
    expect(adultRoles(s, kid).explorer).toBe(MAX_EXPLORERS)
    expect(roleAtAdulthood(s, kid)).not.toBe('explorer') // cap reached
  })

  it('retirement by natural death: when the only explorer dies, the next dawn finds a replacement', () => {
    const s = workforce(['explorer', 'forager', 'forager', 'forager', 'builder', 'builder', 'builder'], [0.5, 0.2, 0.3, 0.8, 0.1, 0.1, 0.1])
    const explorer = s.citizens[0]!
    explorer.bornTick = s.tick + DAY - 65 * TICKS_PER_YEAR // dies of old age at the next dawn
    s.tick += DAY
    updateLifeCycle(s)
    expect(explorer.alive).toBe(false)
    expect(s.citizens[3]!.role).toBe('explorer') // the most curious spare forager
  })
})

describe('a self-renewing workforce over generations (no rapid switching)', () => {
  // Explorer losses over generations are measured by the population sweep; this checks switching and replay.
  it('2 seeds × 2 years: roles change at most at adulthood and once on replacement; never without an adult explorer for long', () => {
    for (const seed of ['crew-a', 'crew-b']) {
      const s = createWorld({ seed })
      const changes = new Map<number, number>()
      const seen = new Map<number, Role>(s.citizens.map((c) => [c.id, c.role]))
      let daysWithout = 0
      let longestWithout = 0
      for (let d = 0; d < 2 * 48; d++) {
        stepN(s, DAY)
        for (const c of s.citizens as Citizen[]) {
          if (!c.alive) continue
          const prev = seen.get(c.id)
          if (prev !== undefined && prev !== c.role) changes.set(c.id, (changes.get(c.id) ?? 0) + 1)
          seen.set(c.id, c.role)
        }
        const adults = s.citizens.filter((c) => c.alive && lifeStage(c, s.tick) === 'adult').length
        if (adults >= 5 && adultRoles(s).explorer === 0) daysWithout++
        else daysWithout = 0
        longestWithout = Math.max(longestWithout, daysWithout)
      }
      for (const n of changes.values()) expect(n).toBeLessThanOrEqual(2)
      expect(longestWithout, seed).toBeLessThanOrEqual(1)
      const resumed = deserialize(serialize(s))
      stepN(s, 2 * DAY)
      stepN(resumed, 2 * DAY)
      expect(serialize(resumed)).toBe(serialize(s))
    }
  }, 180_000)
})
