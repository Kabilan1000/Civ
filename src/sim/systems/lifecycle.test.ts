import { describe, expect, it } from 'vitest'
import { conservationTotals } from '../__tests__/invariants.ts'
import { sandbox } from '../__tests__/sandbox.ts'
import { allowedFor } from '../ai/utility.ts'
import { ageYears, areKin, isBirthday, lifeStageAt, oldAgeHazardPermille } from '../citizens/life.ts'
import {
  ADULT_AGE,
  ARCHIVE_AFTER_DAYS,
  BIRTH_FOOD_PER_CAPITA,
  ELDER_AGE,
  FOUNDER_AGE,
  MAX_AGE,
  MAX_OVERCROWD,
  MAX_POPULATION,
  SHELTER_CAPACITY,
  SHELTER_WOOD,
  SHELTER_WORK_TICKS,
  TICKS_PER_DAY,
  TICKS_PER_YEAR,
} from '../constants.ts'
import { allocateId } from '../ids.ts'
import { getPersonName } from '../selectors.ts'
import { deserialize, serialize } from '../serialize.ts'
import { housingDeficit } from '../structures.ts'
import type { Citizen, Structure, WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'
import { createCitizen } from '../citizens/create.ts'
import { assignHomes, planShelter } from './construction.ts'
import { updateLifeCycle } from './lifecycle.ts'

const dawn = (day: number) => (day - 1) * TICKS_PER_DAY

/** Make `c` exactly `age` years old at `tick`, with today `daysAgo` days after their birthday. */
function setAge(c: Citizen, age: number, tick: number, daysAgo = 10): void {
  c.bornTick = tick - age * TICKS_PER_YEAR - daysAgo * TICKS_PER_DAY
}

function befriend(a: Citizen, b: Citizen, affinity = 60, familiarity = 60): void {
  a.relationships[b.id] = { affinity, familiarity, lastTick: 0 }
  b.relationships[a.id] = { affinity, familiarity, lastTick: 0 }
}

function shelter(state: WorldState, tile: number): Structure {
  const s: Structure = {
    id: allocateId(state),
    kind: 'shelter',
    tile,
    stage: 'complete',
    buildProgress: SHELTER_WORK_TICKS,
    buildCost: SHELTER_WORK_TICKS,
    woodDelivered: SHELTER_WOOD,
    woodRequired: SHELTER_WOOD,
    lastWorkTick: 0,
    residentIds: [],
  }
  state.structures.push(s)
  return s
}

const ROWS = Array.from({ length: 9 }, () => '.........')

/** Two adults (partnered unless told otherwise) in a shelter, plenty of food. */
function family(opts: { partnered?: boolean; food?: number; extra?: number } = {}) {
  const { state, citizens } = sandbox(ROWS, {
    camp: [4, 4],
    citizens: Array.from({ length: 2 + (opts.extra ?? 0) }, (_, i) => ({ x: 1 + i, y: 1 })),
    food: opts.food ?? 500,
  })
  state.tick = dawn(30)
  const [a, b] = citizens as [Citizen, Citizen]
  for (const c of citizens) setAge(c, 25, state.tick)
  const home = shelter(state, 7 * 9 + 7)
  if (opts.partnered ?? true) {
    a.partnerId = b.id
    b.partnerId = a.id
  }
  assignHomes(state)
  return { state, a, b, home, citizens }
}

/** Run the life cycle on `days` consecutive dawns (only the life cycle; nothing else advances). */
function dawns(state: WorldState, days: number, each?: () => void): void {
  for (let d = 0; d < days; d++) {
    state.tick += TICKS_PER_DAY
    updateLifeCycle(state)
    each?.()
  }
}

const childrenOf = (s: WorldState) => s.citizens.filter((c) => c.parentIds !== null)

describe('ages and stages', () => {
  it('maps ages to life stages and rolls the old-age hazard with integers only', () => {
    expect([0, 13, 14, 49, 50, 64].map(lifeStageAt)).toEqual(['child', 'child', 'adult', 'adult', 'elder', 'elder'])
    expect([ELDER_AGE - 1, ELDER_AGE, 55, 60, MAX_AGE - 1, MAX_AGE].map(oldAgeHazardPermille)).toEqual([0, 3, 140, 472, 878, 1000])
  })

  it('birthdays fall on the dawn that completes another 48-day year', () => {
    const c = { bornTick: dawn(10) }
    expect(isBirthday(c, dawn(10))).toBe(false) // the day of birth
    expect(isBirthday(c, dawn(10) + TICKS_PER_YEAR)).toBe(true)
    expect(isBirthday(c, dawn(10) + TICKS_PER_YEAR + 1)).toBe(false)
    expect(ageYears(c, dawn(10) + TICKS_PER_YEAR)).toBe(1)
  })

  it('founders are adults aged 18–36 born on a dawn; the founding is otherwise unchanged', () => {
    for (const seed of ['ages-1', 'ages-2', 'little-worlds']) {
      const s = createWorld({ seed })
      for (const c of s.citizens) {
        const age = ageYears(c, 0)
        expect(age).toBeGreaterThanOrEqual(FOUNDER_AGE.min)
        expect(age).toBeLessThanOrEqual(FOUNDER_AGE.max)
        expect(Math.abs(c.bornTick % TICKS_PER_DAY)).toBe(0)
        expect(c.parentIds).toBeNull()
      }
    }
  })

  it('kin are parents, children and siblings', () => {
    const p = { id: 1, parentIds: null }
    const k1 = { id: 5, parentIds: [1, 2] as [number, number] }
    const k2 = { id: 6, parentIds: [2, 3] as [number, number] }
    const stranger = { id: 7, parentIds: [8, 9] as [number, number] }
    expect(areKin(p, k1)).toBe(true)
    expect(areKin(k1, k2)).toBe(true) // half-siblings
    expect(areKin(k1, stranger)).toBe(false)
  })

  it('children may only eat, rest, play and chat; elders do not explore', () => {
    expect(['eat', 'rest', 'socialize', 'wander'].every((k) => allowedFor('child', k as never))).toBe(true)
    expect(['forage', 'chop', 'deliver', 'build', 'share', 'explore'].some((k) => allowedFor('child', k as never))).toBe(false)
    expect(allowedFor('elder', 'explore')).toBe(false)
    expect(allowedFor('elder', 'forage')).toBe(true)
    expect(allowedFor('adult', 'explore')).toBe(true)
  })
})

describe('partnerships', () => {
  it('adults with mutual affinity and familiarity ≥ 30 partner at dawn', () => {
    const { state, a, b } = family({ partnered: false })
    befriend(a, b, 30, 30)
    dawns(state, 1)
    expect([a.partnerId, b.partnerId]).toEqual([b.id, a.id])
    expect(state.events.at(-1)?.kind === 'partnered' || state.events.some((e) => e.kind === 'partnered')).toBe(true)
    expect(a.memories.some((m) => m.kind === 'partnered' && m.subjectId === b.id)).toBe(true)
  })

  it('one-sided feelings, low familiarity, kin and children never partner', () => {
    const cases: ((a: Citizen, b: Citizen, s: WorldState) => void)[] = [
      (a, b) => befriend(a, b, 29, 60),
      (a, b) => { befriend(a, b); b.relationships[a.id]!.affinity = 10 },
      (a, b) => befriend(a, b, 60, 29),
      (a, b) => { befriend(a, b); b.parentIds = [a.id, 999] },
      (a, b, s) => { befriend(a, b); setAge(b, ADULT_AGE - 1, s.tick) },
    ]
    for (const make of cases) {
      const { state, a, b } = family({ partnered: false })
      make(a, b, state)
      dawns(state, 1)
      expect(a.partnerId).toBeNull()
      expect(b.partnerId).toBeNull()
    }
  })

  it('the strongest bonds pair first; nobody has two partners', () => {
    const { state, citizens } = family({ partnered: false, extra: 1 })
    const [a, b, c] = citizens as [Citizen, Citizen, Citizen]
    befriend(a, b, 40)
    befriend(a, c, 90)
    befriend(b, c, 50)
    dawns(state, 1)
    expect(a.partnerId).toBe(c.id)
    expect(b.partnerId).toBeNull()
  })
})

describe('births', () => {
  it('a housed couple with food in the village has a child: a real, housed, fed citizen', () => {
    const { state, a, b, home } = family()
    const before = conservationTotals(state)
    dawns(state, 400, () => {})
    const kids = childrenOf(state)
    expect(kids.length).toBeGreaterThan(0)
    const k = kids[0]!
    expect(k.parentIds).toEqual([Math.min(a.id, b.id), Math.max(a.id, b.id)])
    expect(k.homeId).toBe(home.id)
    expect(home.residentIds).toContain(k.id)
    expect(k.alive).toBe(true)
    expect(ageYears(k, k.bornTick)).toBe(0)
    expect(a.childIds).toContain(k.id)
    expect(a.memories.some((m) => m.kind === 'childBorn' && m.subjectId === k.id)).toBe(true)
    expect(state.events.some((e) => e.kind === 'born' && e.citizenIds[0] === k.id)).toBe(true)
    expect(new Set(state.citizens.map((c) => c.name)).size).toBe(state.citizens.length) // unique names
    expect(conservationTotals(state)).toEqual(before) // births create no resources
  })

  it('children are spaced at least a year apart per parent', () => {
    const { state, a } = family()
    dawns(state, 600)
    const born = childrenOf(state).map((k) => k.bornTick).sort((x, y) => x - y)
    expect(born.length).toBeGreaterThan(1)
    for (let i = 1; i < born.length; i++) expect(born[i]! - born[i - 1]!).toBeGreaterThanOrEqual(48 * TICKS_PER_DAY)
    expect(a.childIds.length).toBe(born.length)
  })

  it.each([
    ['no partner', (f: ReturnType<typeof family>) => { f.a.partnerId = null; f.b.partnerId = null }],
    ['no home', (f: ReturnType<typeof family>) => { f.state.structures = f.state.structures.filter((s) => s.kind !== 'shelter'); f.a.homeId = null; f.b.homeId = null }],
    ['too little food', (f: ReturnType<typeof family>) => { f.state.stockpile.food = BIRTH_FOOD_PER_CAPITA * 2 - 1 }],
    ['too young', (f: ReturnType<typeof family>) => setAge(f.a, 15, f.state.tick)],
    ['too old', (f: ReturnType<typeof family>) => setAge(f.b, 43, f.state.tick)],
  ])('no births when blocked by %s alone', (_name, block) => {
    const f = family()
    block(f)
    // Keep the blocking condition true on every dawn (ages advance, nothing else does).
    const ages = f.state.citizens.map((c) => c.bornTick)
    dawns(f.state, 300, () => f.state.citizens.forEach((c, i) => (c.bornTick = ages[i]! + (f.state.tick - dawn(30)))))
    expect(childrenOf(f.state)).toHaveLength(0)
  })

  it('no births when the home is overcrowded to the limit (their own children fill it)', () => {
    const { state, a, b, home, citizens } = family({ extra: SHELTER_CAPACITY + MAX_OVERCROWD - 2 })
    for (const kid of citizens.slice(2)) {
      setAge(kid, 5, state.tick)
      kid.parentIds = [a.id, b.id]
    }
    assignHomes(state)
    expect(home.residentIds).toHaveLength(SHELTER_CAPACITY + MAX_OVERCROWD)
    const ages = state.citizens.map((c) => c.bornTick)
    dawns(state, 300, () => state.citizens.forEach((c, i) => (c.bornTick = ages[i]! + (state.tick - dawn(30)))))
    expect(state.population.counters.births).toBe(0)
  })

  it('no births at the population cap', () => {
    const { state } = family()
    while (state.citizens.length < MAX_POPULATION) {
      const id = allocateId(state)
      const c = createCitizen(id, `Filler ${id}`, 'forager', { sociability: 0.5, diligence: 0.5, curiosity: 0.5, resilience: 0.5 }, { x: 4, y: 7 }, id)
      setAge(c, 30, state.tick)
      state.citizens.push(c)
    }
    expect(state.citizens.filter((c) => c.alive)).toHaveLength(MAX_POPULATION)
    dawns(state, 300)
    expect(childrenOf(state)).toHaveLength(0)
  })
})

describe('growing up and growing old', () => {
  it('a child comes of age at 14, joins the workforce and decides immediately', () => {
    const { state, citizens } = family({ partnered: false, extra: 1 })
    const kid = citizens[2]!
    kid.parentIds = [citizens[0]!.id, citizens[1]!.id]
    kid.bornTick = state.tick + TICKS_PER_DAY - ADULT_AGE * TICKS_PER_YEAR // 14 at tomorrow's dawn
    expect(ageYears(kid, state.tick)).toBe(ADULT_AGE - 1)
    dawns(state, 1)
    expect(ageYears(kid, state.tick)).toBe(ADULT_AGE)
    expect(state.events.some((e) => e.kind === 'cameOfAge' && e.citizenIds[0] === kid.id)).toBe(true)
    expect(kid.nextDecisionTick).toBe(state.tick)
    expect(state.population.counters.comingOfAge).toBe(1)
  })

  it('everyone dies of old age by 65; their partner becomes free', () => {
    const { state, a, b } = family()
    a.bornTick = state.tick + TICKS_PER_DAY - MAX_AGE * TICKS_PER_YEAR // 65 at tomorrow's dawn
    dawns(state, 1)
    expect(a.alive).toBe(false)
    expect(a.deathCause).toBe('oldAge')
    expect(b.partnerId).toBeNull()
    expect(state.events.some((e) => e.kind === 'died' && e.data?.cause === 'oldAge' && e.data?.age === MAX_AGE)).toBe(true)
    expect(state.population.counters.oldAgeDeaths).toBe(1)
  })

  it('nobody under 50 dies of old age', () => {
    const { state, a, b } = family()
    a.bornTick = state.tick + TICKS_PER_DAY - (ELDER_AGE - 1) * TICKS_PER_YEAR
    dawns(state, 1)
    expect(a.alive && b.alive).toBe(true)
  })
})

describe('households and housing', () => {
  it('a couple living apart reunites in one home', () => {
    const { state, a, b, home } = family({ partnered: false })
    const other = shelter(state, 1 * 9 + 7)
    home.residentIds = [a.id]
    a.homeId = home.id
    other.residentIds = [b.id]
    b.homeId = other.id
    a.partnerId = b.id
    b.partnerId = a.id
    assignHomes(state)
    expect(a.homeId).toBe(b.homeId)
  })

  it('a couple living apart counts as housing demand', () => {
    // Six people, two full shelters (six beds), the couple in different homes, no prosperity headroom.
    const { state, a, b, home, citizens } = family({ partnered: false, extra: 4 })
    state.stockpile.food = 0
    const other = shelter(state, 1 * 9 + 7)
    const [c3, c4, c5, c6] = citizens.slice(2)
    home.residentIds = [a.id, c3!.id, c4!.id].sort((x, y) => x - y)
    other.residentIds = [b.id, c5!.id, c6!.id].sort((x, y) => x - y)
    for (const c of [a, c3!, c4!]) c.homeId = home.id
    for (const c of [b, c5!, c6!]) c.homeId = other.id
    expect(housingDeficit(state)).toBe(0)
    a.partnerId = b.id
    b.partnerId = a.id
    expect(housingDeficit(state)).toBe(1)
  })

  it('a birth into a full home overcrowds it and creates housing demand — no deadlock', () => {
    const { state, a, b, home, citizens } = family({ extra: 1 })
    expect(home.residentIds).toHaveLength(SHELTER_CAPACITY) // couple + lodger: full, no spare bed anywhere
    state.stockpile.food = 0 // not prosperous: no headroom, so demand comes from the birth alone
    expect(housingDeficit(state)).toBe(0)
    state.stockpile.food = 500
    let n = 0
    dawns(state, 400, () => (n = childrenOf(state).length))
    expect(n).toBeGreaterThan(0)
    expect(home.residentIds.length).toBeGreaterThan(SHELTER_CAPACITY)
    state.stockpile.food = 0
    expect(housingDeficit(state)).toBeGreaterThan(0)
    expect(planShelter(state)).not.toBeNull()
    void a
    void b
    void citizens
  })

  it('a lodger moves out of an overcrowded home when a bed frees up elsewhere', () => {
    const { state, citizens, home } = family({ extra: 1 })
    const lodger = citizens[2]!
    dawns(state, 400) // children arrive; the home overcrowds
    expect(home.residentIds.length).toBeGreaterThan(SHELTER_CAPACITY)
    shelter(state, 1 * 9 + 7)
    assignHomes(state)
    expect(lodger.homeId).not.toBe(home.id)
  })
})

describe('the archive', () => {
  it('compacts the dead a year after death, prunes relationships and keeps names resolvable', () => {
    const { state, a, b } = family()
    befriend(a, b)
    a.bornTick = state.tick + TICKS_PER_DAY - MAX_AGE * TICKS_PER_YEAR
    dawns(state, 1)
    expect(a.alive).toBe(false)
    dawns(state, ARCHIVE_AFTER_DAYS)
    expect(state.citizens.some((c) => c.id === a.id)).toBe(false)
    expect(state.archive.map((p) => p.id)).toEqual([a.id])
    expect(state.archive[0]).toMatchObject({ name: a.name, cause: 'oldAge', partnerId: b.id })
    expect(b.relationships[a.id]).toBeUndefined()
    expect(getPersonName(state, a.id)).toBe(a.name)
    expect(() => deserialize(serialize(state))).not.toThrow()
  })
})

describe('whole-village determinism across births, birthdays and deaths', () => {
  it('save/resume at a dawn reproduces births, a coming of age and an old-age death exactly', () => {
    const s = createWorld({ seed: 'pop-resume' })
    stepN(s, 60 * TICKS_PER_DAY - 1) // just before the dawn of day 61
    // Stage the next days so they contain a death of old age and a coming of age.
    const [old, young] = s.citizens.filter((c) => c.alive)
    old!.bornTick = s.tick + 1 + TICKS_PER_DAY - MAX_AGE * TICKS_PER_YEAR
    young!.bornTick = s.tick + 1 + 2 * TICKS_PER_DAY - ADULT_AGE * TICKS_PER_YEAR // an adult founder made a teenager
    const resumed = deserialize(serialize(s))
    stepN(s, 30 * TICKS_PER_DAY)
    stepN(resumed, 30 * TICKS_PER_DAY)
    expect(serialize(resumed)).toBe(serialize(s))
    expect(s.population.counters.oldAgeDeaths).toBeGreaterThanOrEqual(1)
    expect(s.population.counters.comingOfAge).toBeGreaterThanOrEqual(1)
    expect(s.population.counters.births).toBeGreaterThan(0)
  })

  it('a growing village keeps every invariant: conservation every tick, bounds, homes', () => {
    const s = createWorld({ seed: 'pop-invariants' })
    const start = conservationTotals(s)
    for (let t = 0; t < 120 * TICKS_PER_DAY; t++) {
      step(s)
      expect(conservationTotals(s)).toEqual(start)
      if (t % TICKS_PER_DAY !== 0) continue
      const living = s.citizens.filter((c) => c.alive)
      expect(living.length).toBeLessThanOrEqual(MAX_POPULATION)
      for (const c of living) {
        expect(ageYears(c, s.tick)).toBeLessThanOrEqual(MAX_AGE)
        if (c.partnerId !== null) expect(s.citizens.find((o) => o.id === c.partnerId)?.partnerId).toBe(c.id)
        if (ageYears(c, s.tick) < ADULT_AGE && c.task) expect(['eat', 'rest', 'socialize', 'wander']).toContain(c.task.kind)
      }
      for (const sh of s.structures) expect(sh.residentIds.length).toBeLessThanOrEqual(SHELTER_CAPACITY + MAX_OVERCROWD)
    }
    expect(s.population.counters.births).toBeGreaterThan(0)
    expect(s.ledger.foodEaten).toBeGreaterThan(0)
  })
})
