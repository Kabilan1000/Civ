import { describe, expect, it } from 'vitest'
import { sandbox } from '../__tests__/sandbox.ts'
import {
  SITE_OUTER_CAMP_DISTANCE,
  ENERGY_RATES,
  HOUSING_HEADROOM,
  SHELTER_CAPACITY,
  SHELTER_WOOD,
  SHELTER_WORK_TICKS,
  SITE_ABANDON_TICKS,
  SITE_MAX_CAMP_DISTANCE,
  SITE_MIN_CAMP_DISTANCE,
  TICKS_PER_DAY,
} from '../constants.ts'
import { manhattan, toIndex, toPoint } from '../grid.ts'
import { reachableMask } from '../path/flood.ts'
import { deserialize, serialize } from '../serialize.ts'
import { chooseSite, getOpenSite, getShelters, solidTiles } from '../structures.ts'
import type { Structure, WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'
import { assignHomes, planShelter, supplySite, workOnSite } from './construction.ts'
import { decide } from './decide.ts'
import { updateNeeds } from './needs.ts'

const OPEN = Array.from({ length: 11 }, () => '...........')

/** A world with one builder, food to stay fed, `wood` in the stockpile and no trees. */
function buildYard(wood: number) {
  const { state, citizens } = sandbox(OPEN, {
    camp: [5, 5],
    citizens: [{ x: 5, y: 6, role: 'builder' }],
    food: 200,
    wood,
  })
  return { state, builder: citizens[0]! }
}

const reachableFromCamp = (s: WorldState) => {
  const camp = s.structures.find((x) => x.kind === 'campfire')!.tile
  const solid = solidTiles(s)
  return reachableMask(s.map, camp, (t) => s.map.discovered[t] === 1 && !solid.has(t))
}

describe('construction rules', () => {
  it('plans one shelter at a time, only while housing is short', () => {
    const { state } = buildYard(0)
    const site = planShelter(state)!
    expect(site).toMatchObject({ kind: 'shelter', stage: 'planned', woodRequired: SHELTER_WOOD, buildCost: SHELTER_WORK_TICKS })
    expect(planShelter(state)).toBeNull() // one open site at a time
    expect(state.events.at(-1)).toMatchObject({ kind: 'shelterStarted', data: { structureId: site.id } })
    site.stage = 'complete'
    expect(planShelter(state)).toBeNull() // 1 citizen, 3 slots: no deficit
  })

  it('accepts exactly woodRequired and needs exactly buildCost labour ticks', () => {
    const { state } = buildYard(0)
    const site = planShelter(state)!
    expect(supplySite(state, site, 5)).toBe(5)
    expect(site.stage).toBe('planned')
    expect(workOnSite(state, site)).toBe(false) // no labour before all wood is in
    expect(site.buildProgress).toBe(0)
    expect(supplySite(state, site, 100)).toBe(SHELTER_WOOD - 5) // never over-accepts
    expect(site.stage).toBe('underConstruction')
    for (let i = 1; i < SHELTER_WORK_TICKS; i++) expect(workOnSite(state, site)).toBe(false)
    expect(site.stage).toBe('underConstruction')
    expect(workOnSite(state, site)).toBe(true)
    expect(site.stage).toBe('complete')
    expect(site.buildProgress).toBe(SHELTER_WORK_TICKS)
  })

  it('a builder completes a shelter using exactly SHELTER_WOOD from the stockpile', () => {
    const { state, builder } = buildYard(30)
    planShelter(state)
    const site = getOpenSite(state)!
    let ticks = 0
    while (site.stage !== 'complete' && ticks < 2000) {
      step(state)
      ticks++
    }
    expect(site.stage).toBe('complete')
    const leftover = builder.carrying?.kind === 'wood' ? builder.carrying.amount : 0
    expect(state.stockpile.wood + leftover).toBe(30 - SHELTER_WOOD)
    expect(site.woodDelivered).toBe(SHELTER_WOOD)
    expect(builder.homeId).toBe(site.id)
    expect(site.residentIds).toEqual([builder.id])
    expect(state.events.some((e) => e.kind === 'shelterCompleted')).toBe(true)
  })

  it('resumes unfinished construction after an interruption without losing progress', () => {
    const { state, builder } = buildYard(30)
    const site = planShelter(state)!
    supplySite(state, site, SHELTER_WOOD)
    let guard = 0
    while (site.buildProgress < 20 && guard++ < 500) step(state)
    expect(builder.task?.kind).toBe('build')
    // Interrupt: the builder is called away (task dropped mid-construction).
    builder.task = null
    builder.path = []
    builder.nextDecisionTick = state.tick + 50
    const progress = site.buildProgress
    stepN(state, 40)
    expect(site.buildProgress).toBe(progress) // nothing lost, nothing gained
    while (site.stage !== 'complete' && guard++ < 2000) step(state)
    expect(site.stage).toBe('complete')
    expect(site.buildProgress).toBe(SHELTER_WORK_TICKS)
  })

  it('abandons a stale site and refunds its wood', () => {
    const { state, builder } = buildYard(0)
    builder.nextDecisionTick = Number.MAX_SAFE_INTEGER
    const site = planShelter(state)!
    supplySite(state, site, 7)
    stepN(state, SITE_ABANDON_TICKS + 1)
    expect(state.structures.includes(site)).toBe(false)
    expect(state.stockpile.wood).toBe(7)
    expect(state.events.some((e) => e.kind === 'shelterAbandoned')).toBe(true)
  })

  it('never cuts off a route: a chokepoint tile is rejected', () => {
    // A 1-wide corridor leads from camp (0,2) to the east, longer than the outer site ring:
    // every candidate tile (3..SITE_OUTER_CAMP_DISTANCE from camp) lies on it and would cut it.
    const W = SITE_OUTER_CAMP_DISTANCE + 4
    const rows = ['~'.repeat(W), '~'.repeat(W), '.'.repeat(W), '~'.repeat(W), '~'.repeat(W)]
    const { state } = sandbox(rows, { camp: [0, 2], citizens: [{ x: 1, y: 2 }] })
    expect(chooseSite(state)).toBeNull()
    // Widen the corridor and a site becomes possible.
    state.map.terrain = state.map.terrain.map((t, i) => (Math.floor(i / W) === 1 ? 'grass' : t))
    const tile = chooseSite(state)
    expect(tile).not.toBeNull()
  })

  it('assigns homes deterministically, at most SHELTER_CAPACITY each, and keeps them stable', () => {
    const { state, citizens } = sandbox(OPEN, {
      camp: [5, 5],
      citizens: Array.from({ length: 7 }, (_, i) => ({ x: i + 2, y: 1 })),
    })
    const mk = (id: number, x: number): Structure => ({
      id, kind: 'shelter', tile: toIndex(x, 8, 11), stage: 'complete', buildProgress: 60, buildCost: 60,
      woodDelivered: 12, woodRequired: 12, lastWorkTick: 0, residentIds: [],
    })
    state.structures.push(mk(1000, 2), mk(1001, 6))
    state.nextId = 1002
    assignHomes(state)
    const [a, b] = getShelters(state)
    expect(a!.residentIds).toEqual(citizens.slice(0, 3).map((c) => c.id))
    expect(b!.residentIds).toEqual(citizens.slice(3, 6).map((c) => c.id))
    expect(citizens[6]!.homeId).toBeNull()
    const before = JSON.stringify(state.structures)
    assignHomes(state)
    expect(JSON.stringify(state.structures)).toBe(before) // no reshuffling without reason
  })
})

describe('construction regressions (M9)', () => {
  // Camp at (1,4); a rock wall at x=3 (rows 1..6) with gaps only at the top and bottom edges.
  const RIDGE = [
    '..........',
    '...#......',
    '...#......',
    '...#......',
    '...#......',
    '...#......',
    '...#......',
    '..........',
  ]

  it('ranks sites by walking distance from camp, not straight-line distance', () => {
    const { state } = sandbox(RIDGE, { camp: [1, 4], citizens: [{ x: 0, y: 0 }] })
    const tile = chooseSite(state)!
    const p = toPoint(tile, 10)
    // (4,4) is only 3 tiles away in a straight line but a long walk round the ridge; a same-side tile wins.
    expect(p.x).toBeLessThan(3)
  })

  it('a builder hauling wood on a long detour delivers it to the site instead of looping back to camp', () => {
    // A wall at x=3 from y=1 down to the bottom: from camp (1,12) to the site at (5,12) is a ~26-step walk
    // round the top, although they are 4 tiles apart. (M9 bug: deliver outscored the long haul and the
    // builder carried the wood back to camp, forever.)
    const rows = Array.from({ length: 14 }, (_, y) => (y === 0 ? '........' : '...#....'))
    const { state, citizens: [b] } = sandbox(rows, { camp: [1, 12], citizens: [{ x: 1, y: 12, role: 'builder' }], food: 300, wood: 30 })
    const site: Structure = {
      id: 950, kind: 'shelter', tile: toIndex(5, 12, 8), stage: 'planned', buildProgress: 0, buildCost: SHELTER_WORK_TICKS,
      woodDelivered: 0, woodRequired: SHELTER_WOOD, lastWorkTick: 0, residentIds: [],
    }
    state.structures.push(site)
    state.nextId = 951
    let woodTakenBackToCamp = 0
    for (let t = 0; t < 2000 && site.stage !== 'complete'; t++) {
      const before = b!.task
      step(state)
      if (b!.task && b!.task !== before && b!.task.kind === 'deliver' && b!.carrying?.kind === 'wood') woodTakenBackToCamp++
    }
    expect(woodTakenBackToCamp).toBe(0)
    expect(site.stage).toBe('complete')
  })
})

describe('sleeping', () => {
  it('restores energy faster at home than outdoors, and outdoor rest still works', () => {
    expect(ENERGY_RATES.restingHome).toBeGreaterThan(ENERGY_RATES.resting)
    const { state, builder } = buildYard(0)
    const home: Structure = {
      id: 999, kind: 'shelter', tile: toIndex(8, 8, 11), stage: 'complete', buildProgress: 60, buildCost: 60,
      woodDelivered: 12, woodRequired: 12, lastWorkTick: 0, residentIds: [],
    }
    state.structures.push(home)
    state.nextId = 1000
    builder.needs.energy = 20
    builder.task = { kind: 'rest', phase: 'sleep', targetTile: toIndex(5, 6, 11), targetId: null, ticksLeft: 0, startedTick: 0 }
    updateNeeds(state)
    expect(builder.needs.energy).toBeCloseTo(20 + ENERGY_RATES.resting, 9) // homeless: outdoors

    assignHomes(state)
    builder.pos = { x: 8, y: 8 }
    builder.task.targetTile = home.tile
    builder.needs.energy = 20
    updateNeeds(state)
    expect(builder.needs.energy).toBeCloseTo(20 + ENERGY_RATES.restingHome, 9)
  })

  it('a tired resident walks home to sleep; a homeless one rests by the campfire', () => {
    const { state, citizens } = sandbox(OPEN, {
      camp: [5, 5],
      citizens: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
      food: 100,
    })
    const home: Structure = {
      id: 999, kind: 'shelter', tile: toIndex(9, 9, 11), stage: 'complete', buildProgress: 60, buildCost: 60,
      woodDelivered: 12, woodRequired: 12, lastWorkTick: 0, residentIds: [citizens[0]!.id],
    }
    state.structures.push(home)
    state.nextId = 1000
    citizens[0]!.homeId = home.id
    for (const c of citizens) c.needs.energy = 15
    decide(state)
    expect(citizens[0]!.task).toMatchObject({ kind: 'rest', targetTile: home.tile })
    expect(citizens[1]!.task?.kind).toBe('rest')
    const spot = toPoint(citizens[1]!.task!.targetTile!, 11)
    expect(manhattan(spot, { x: 5, y: 5 })).toBeLessThanOrEqual(2)
    expect(citizens[1]!.task!.targetTile).not.toBe(home.tile)
  })
})

describe('construction in a running colony', () => {
  it('builders house the whole village in four valid shelters that never block routes', () => {
    for (const seed of ['houses-a', 'houses-b', 'houses-c', 'houses-d', 'houses-e']) {
      const s = createWorld({ seed })
      const camp = s.structures[0]!.tile
      const campPoint = toPoint(camp, s.map.width)
      let reachable = reachableFromCamp(s)
      let shelters = 0
      for (let t = 0; t < TICKS_PER_DAY * 8; t++) {
        step(s)
        const all = getShelters(s)
        if (all.length > shelters) {
          shelters = all.length
          const site = all.at(-1)!
          const p = toPoint(site.tile, s.map.width)
          const d = manhattan(p, campPoint)
          expect(d).toBeGreaterThanOrEqual(SITE_MIN_CAMP_DISTANCE)
          expect(d).toBeLessThanOrEqual(SITE_MAX_CAMP_DISTANCE)
          expect(s.map.discovered[site.tile]).toBe(1)
          expect(s.map.resources[site.tile]).toBeNull()
          expect(['grass', 'sand', 'forest']).toContain(s.map.terrain[site.tile])
          for (const other of all.slice(0, -1)) {
            const q = toPoint(other.tile, s.map.width)
            expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeGreaterThan(1)
          }
          // Nothing that was reachable from camp became unreachable (apart from the site).
          const after = reachableFromCamp(s)
          reachable.forEach((v, i) => {
            if (v === 1 && i !== site.tile) expect(after[i]).toBe(1)
          })
          reachable = after
        }
        for (const sh of all) {
          expect(sh.residentIds.length).toBeLessThanOrEqual(SHELTER_CAPACITY)
          for (const id of sh.residentIds) {
            const c = s.citizens.find((x) => x.id === id)!
            expect(c.alive).toBe(true)
            expect(c.homeId).toBe(sh.id)
          }
        }
      }
      const complete = getShelters(s).filter((x) => x.stage === 'complete')
      // Four shelters house twelve; one more is the Population V1 headroom shelter,
      // built only once a couple exists (structures.housingDeficit).
      const couples = s.citizens.filter((c) => c.alive && c.partnerId !== null).length / 2
      expect(complete.length, seed).toBe(couples > 0 ? complete.length : 4)
      expect(complete.length, seed).toBeGreaterThanOrEqual(4)
      expect(complete.length, seed).toBeLessThanOrEqual(4 + HOUSING_HEADROOM / SHELTER_CAPACITY)
      expect(s.citizens.filter((c) => c.alive && c.homeId === null).length, seed).toBe(0)
      for (const sh of complete) expect(sh.woodDelivered).toBe(SHELTER_WOOD)
    }
  })

  it('save/resume during construction is exactly deterministic', () => {
    const s = createWorld({ seed: 'build-resume' })
    let saved: string | null = null
    for (let t = 0; t < TICKS_PER_DAY * 4 && !saved; t++) {
      step(s)
      if (s.citizens.some((c) => c.task?.phase === 'construct') && s.citizens.some((c) => c.carrying?.kind === 'wood')) {
        saved = serialize(s)
      }
    }
    expect(saved).not.toBeNull()
    const resumed = deserialize(saved!)
    const straight = createWorld({ seed: 'build-resume' })
    stepN(straight, resumed.tick)
    expect(serialize(straight)).toBe(saved)
    stepN(resumed, 800)
    stepN(straight, 800)
    expect(serialize(resumed)).toBe(serialize(straight))
  })
})

describe('settlement growth beyond the inner ring (Population V1)', () => {
  it('fills the inner ring first, then builds further out — never cutting routes', () => {
    const rows = Array.from({ length: 23 }, () => '.......................')
    const { state } = sandbox(rows, { camp: [11, 11], citizens: [{ x: 11, y: 12 }] })
    const camp = state.structures[0]!.tile
    const dist = (t: number) => Math.abs((t % 23) - 11) + Math.abs(Math.floor(t / 23) - 11)
    const distances: number[] = []
    for (let k = 0; k < 40; k++) {
      const tile = chooseSite(state)
      if (tile === null) break
      distances.push(dist(tile))
      state.structures.push({ id: 1000 + k, kind: 'shelter', tile, stage: 'complete', buildProgress: 60, buildCost: 60, woodDelivered: 12, woodRequired: 12, lastWorkTick: 0, residentIds: [] })
      const solid = solidTiles(state)
      const reach = reachableMask(state.map, camp, (t) => state.map.discovered[t] === 1 && !solid.has(t))
      const open = state.map.terrain.filter((_t, i) => !solid.has(i)).length
      expect(reach.reduce((n, v) => n + v, 0)).toBe(open) // every open tile still reachable
    }
    const firstOuter = distances.findIndex((d) => d > SITE_MAX_CAMP_DISTANCE)
    expect(firstOuter).toBeGreaterThan(5) // a decent inner village first…
    expect(distances.slice(firstOuter).every((d) => d > SITE_MAX_CAMP_DISTANCE && d <= SITE_OUTER_CAMP_DISTANCE)).toBe(true) // …then the outer ring only
    expect(distances.length).toBeGreaterThanOrEqual(20) // room for a 60-citizen village
  })
})
