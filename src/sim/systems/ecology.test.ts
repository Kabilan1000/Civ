import { describe, expect, it } from 'vitest'
import { conservationTotals, plantViolations } from '../__tests__/invariants.ts'
import { sandbox } from '../__tests__/sandbox.ts'
import {
  BERRY_MAX,
  BERRY_REGROW_INTERVAL,
  DEADWOOD_ROT_DAYS,
  GATHER_TICKS,
  PLANT_LIFESPAN_DAYS,
  PLANT_MATURE_AT_DAYS,
  PLANT_SENESCENCE_ENABLED,
  PLANT_SEEDLING_DAYS,
  PLANT_STAGE_MAX,
  TICKS_PER_DAY,
  TREE_REGROW_INTERVAL,
  TREE_WOOD_MAX,
} from '../constants.ts'
import { oldAtDays, plantAgeDays, plantNode, stageForAge } from '../ecology/flora.ts'
import type { ResourceNode, WorldState } from '../types.ts'
import { createWorld, step, stepWithRules } from '../world.ts'
import { clearingMask, safetyCap, suitability } from '../ecology/habitat.ts'
import { chooseSite } from '../structures.ts'
import { planShelter } from './construction.ts'
import { DEFAULT_ECOLOGY_RULES, updateEcology, type EcologyRules } from './ecology.ts'
import { advanceTasks } from './tasks.ts'

const ON: EcologyRules = { senescence: true, reproduction: false } // lifecycle tests: no seeds unless asked
const OFF: EcologyRules = { senescence: false, reproduction: false }
const dawn = (day: number) => (day - 1) * TICKS_PER_DAY // first tick of day `day`

/** A one-plant world: `rows` is a single sandbox row; the plant sits on tile 0. */
function onePlant(kind: 'berries' | 'wood', node: Partial<ResourceNode>): { state: WorldState; node: () => ResourceNode | null } {
  const { state } = sandbox([kind === 'berries' ? 'b...' : 'T...'], { camp: [3, 0], citizens: [{ x: 2, y: 0 }] })
  state.citizens[0]!.nextDecisionTick = Number.MAX_SAFE_INTEGER
  Object.assign(state.map.resources[0]!, node)
  return { state, node: () => state.map.resources[0] ?? null }
}

/** Run the ecology alone at `tick` (state.tick is set; nothing else advances). */
function ecologyAt(state: WorldState, tick: number, rules = ON): void {
  state.tick = tick
  updateEcology(state, rules)
}

describe('lifecycle tables', () => {
  it('stage thresholds are ordered for every lifespan in range', () => {
    for (const kind of ['berries', 'wood'] as const) {
      expect(PLANT_SEEDLING_DAYS[kind]).toBeLessThan(PLANT_MATURE_AT_DAYS[kind])
      expect(PLANT_MATURE_AT_DAYS[kind]).toBeLessThan(oldAtDays(kind, PLANT_LIFESPAN_DAYS[kind].min))
      expect(oldAtDays(kind, PLANT_LIFESPAN_DAYS[kind].max)).toBeLessThan(PLANT_LIFESPAN_DAYS[kind].max)
    }
  })

  it('mature caps equal v0.1; senescence and reproduction are on together (M10c)', () => {
    expect(PLANT_STAGE_MAX.berries.mature).toBe(BERRY_MAX)
    expect(PLANT_STAGE_MAX.wood.mature).toBe(TREE_WOOD_MAX)
    expect(PLANT_SENESCENCE_ENABLED).toBe(true)
    expect(DEFAULT_ECOLOGY_RULES).toEqual({ senescence: true, reproduction: true })
  })

  it('stageForAge: bush with a 40-day life (old at day 32)', () => {
    const at = (age: number, s = true) => stageForAge('berries', age, 40, s)
    expect([0, 1].map((a) => at(a))).toEqual(['seedling', 'seedling'])
    expect([2, 4].map((a) => at(a))).toEqual(['young', 'young'])
    expect([5, 31].map((a) => at(a))).toEqual(['mature', 'mature'])
    expect([32, 39].map((a) => at(a))).toEqual(['old', 'old'])
    expect(at(40)).toBe('death')
    expect([32, 40, 1000].map((a) => at(a, false))).toEqual(['mature', 'mature', 'mature']) // senescence off
  })

  it('stageForAge: pioneer tree with a 100-day life (old at day 75)', () => {
    const at = (age: number) => stageForAge('wood', age, 100, true)
    expect([0, 5, 6, 19, 20, 74, 75, 99, 100].map(at)).toEqual([
      'seedling', 'seedling', 'young', 'young', 'mature', 'mature', 'old', 'old', 'death',
    ])
  })
})

describe('senescence off (M10b default): plants never decline', () => {
  it('a plant far past its lifespan stays mature and regrows at the v0.1 rate', () => {
    const { state, node } = onePlant('berries', { bornTick: -1000 * TICKS_PER_DAY, lifespanDays: 30, amount: 0 })
    let grown = 0
    for (let t = 1; t <= 3 * TICKS_PER_DAY; t++) {
      ecologyAt(state, t, OFF)
      if (t % BERRY_REGROW_INTERVAL === 0 && grown < BERRY_MAX) grown++
    }
    expect(node()!.stage).toBe('mature')
    expect(node()!.amount).toBe(grown)
    expect(state.ledger.foodDecayed).toBe(0)
    expect(state.ecology.counters.deaths.berries).toBe(0)
  })
})

describe('bush lifecycle (senescence on)', () => {
  it('seedling → young → mature → old → death at the right dawns, with caps and decay', () => {
    const { state, node } = onePlant('berries', { stage: 'seedling', amount: 0, max: 0, bornTick: 0, lifespanDays: 40 })
    const stageOn = (day: number) => {
      ecologyAt(state, dawn(day))
      return node() && { stage: node()!.stage, max: node()!.max }
    }
    expect(stageOn(2)).toEqual({ stage: 'seedling', max: 0 }) // age 1
    expect(stageOn(3)).toEqual({ stage: 'young', max: 3 }) // age 2
    expect(stageOn(6)).toEqual({ stage: 'mature', max: 6 }) // age 5
    node()!.amount = 6
    const before = state.ledger.foodDecayed
    expect(stageOn(33)).toEqual({ stage: 'old', max: 4 }) // age 32: cap drops 6 → 4
    expect(node()!.amount).toBe(4)
    expect(state.ledger.foodDecayed - before).toBe(2)
    expect(stageOn(40)).toEqual({ stage: 'old', max: 4 }) // age 39
    node()!.amount = 3
    expect(stageOn(41)).toBeNull() // age 40: dies, berries decay
    expect(state.ledger.foodDecayed - before).toBe(5)
    expect(state.ecology.counters.deaths.berries).toBe(1)
  })
})

describe('pioneer tree lifecycle and deadwood (senescence on)', () => {
  it('a dying tree becomes harvestable deadwood that never regrows and rots one unit every 4 days', () => {
    const { state, node } = onePlant('wood', { bornTick: 0, lifespanDays: 100, amount: 5 })
    ecologyAt(state, dawn(76)) // age 75: old
    expect(node()!.stage).toBe('old')
    expect(node()!.max).toBe(TREE_WOOD_MAX)
    ecologyAt(state, dawn(101)) // age 100: dies
    expect(node()).toMatchObject({ stage: 'dead', amount: 5, max: 5, diedTick: dawn(101) })
    expect(state.ecology.counters.deaths.wood).toBe(1)
    // No regrowth for deadwood, at any regrowth tick.
    for (let t = dawn(101) + 1; t < dawn(101) + DEADWOOD_ROT_DAYS * TICKS_PER_DAY; t++) ecologyAt(state, t)
    expect(node()!.amount).toBe(5)
    expect(state.ledger.woodDecayed).toBe(0)
    ecologyAt(state, dawn(101 + DEADWOOD_ROT_DAYS))
    expect(node()!.amount).toBe(4)
    expect(state.ledger.woodDecayed).toBe(1)
    for (let k = 2; k <= 4; k++) ecologyAt(state, dawn(101 + k * DEADWOOD_ROT_DAYS))
    expect(node()!.amount).toBe(1)
    ecologyAt(state, dawn(101 + 5 * DEADWOOD_ROT_DAYS))
    expect(node()).toBeNull() // fully rotted
    expect(state.ledger.woodDecayed).toBe(5)
  })

  it('old trees grow no wood; a tree that dies holding none simply disappears', () => {
    const { state, node } = onePlant('wood', { stage: 'old', bornTick: 0, lifespanDays: 100, amount: 2 })
    for (let t = dawn(80); t <= dawn(80) + 4 * TREE_REGROW_INTERVAL; t++) ecologyAt(state, t)
    expect(node()!.amount).toBe(2)
    node()!.amount = 0
    ecologyAt(state, dawn(101))
    expect(node()).toBeNull()
    expect(state.ecology.counters.deaths.wood).toBe(1)
    expect(state.ledger.woodDecayed).toBe(0)
  })

  it('deadwood can be chopped like a tree; chopped-out deadwood is cleared at the next dawn', () => {
    const { state, node } = onePlant('wood', { stage: 'dead', amount: 2, max: 6, diedTick: dawn(3), bornTick: -100 * TICKS_PER_DAY })
    const c = state.citizens[0]!
    c.pos = { x: 0, y: 0 }
    c.task = { kind: 'chop', phase: 'gather', targetTile: 0, targetId: null, ticksLeft: GATHER_TICKS.wood, startedTick: 0 }
    const before = conservationTotals(state)
    for (let i = 0; i < 50 && c.task; i++) advanceTasks(state)
    expect(c.carrying).toEqual({ kind: 'wood', amount: 2 })
    expect(node()).toMatchObject({ stage: 'dead', amount: 0 })
    expect(conservationTotals(state)).toEqual(before)
    ecologyAt(state, dawn(4))
    expect(node()).toBeNull()
    expect(state.ledger.woodDecayed).toBe(0) // nothing was left to rot
  })
})

describe('stage-dependent regrowth', () => {
  const grownOver = (kind: 'berries' | 'wood', stage: ResourceNode['stage'], ticks: number) => {
    const max = stage === 'dead' ? 5 : PLANT_STAGE_MAX[kind][stage]
    const { state, node } = onePlant(kind, { stage, max, amount: 0, bornTick: -10_000 * TICKS_PER_DAY, lifespanDays: 1000, diedTick: stage === 'dead' ? 0 : null })
    // Avoid dawns so only regrowth runs: start just after a dawn and stay within the day.
    for (let t = 1; t <= ticks; t++) if (t % TICKS_PER_DAY !== 0) ecologyAt(state, t, OFF)
    return node()!.amount
  }

  it('berries: full when mature, half when young or old, none as a seedling', () => {
    expect(grownOver('berries', 'mature', 192)).toBe(4) // ticks 48, 96, 144, 192
    expect(grownOver('berries', 'young', 192)).toBe(2) // 96, 192
    expect(grownOver('berries', 'old', 192)).toBe(2)
    expect(grownOver('berries', 'seedling', 192)).toBe(0)
  })

  it('trees: full when mature, half when young, none when old, seedling or dead', () => {
    // The helper skips dawn ticks (240, 480): mature trees grow at 160 and 320 only.
    expect(grownOver('wood', 'mature', 639)).toBe(2)
    // Half rate grows on tick % 320: 320 and 640 (neither is a dawn).
    expect(grownOver('wood', 'young', 640)).toBe(2)
    expect(grownOver('wood', 'old', 640)).toBe(0)
    expect(grownOver('wood', 'seedling', 640)).toBe(0)
    expect(grownOver('wood', 'dead', 640)).toBe(0)
  })
})

describe('ecology isolation', () => {
  it('draws no random numbers from either stream in M10b (D4)', () => {
    const s = createWorld({ seed: 'eco-rng' })
    const ai = [...s.rng]
    const eco = [...s.ecology.rng]
    for (let t = 1; t <= 30 * TICKS_PER_DAY; t++) ecologyAt(s, t)
    expect(s.rng).toEqual(ai)
    expect(s.ecology.rng).toEqual(eco)
  })

  it('never reads colony need: stockpile and hunger do not change what the ecology does (D5, no rescue)', () => {
    const a = createWorld({ seed: 'no-rescue' })
    const b = createWorld({ seed: 'no-rescue' })
    a.stockpile.food = 0
    b.stockpile.food = 500
    for (const c of a.citizens) c.needs.satiety = 5
    for (const c of b.citizens) c.needs.satiety = 95
    for (let t = 1; t <= 60 * TICKS_PER_DAY; t++) {
      ecologyAt(a, t)
      ecologyAt(b, t)
    }
    expect(b.map.resources).toEqual(a.map.resources)
    expect(b.ecology).toEqual(a.ecology)
    const eco = (s: WorldState) => [s.ledger.foodRegrown, s.ledger.woodRegrown, s.ledger.foodDecayed, s.ledger.woodDecayed]
    expect(eco(b)).toEqual(eco(a))
    expect(a.ecology.counters.deaths.berries).toBeGreaterThan(0) // the run really exercised deaths
  })
})

describe('initial plant ages (new worlds)', () => {
  it('every plant starts mature, full, with a staggered age inside the mature window', () => {
    for (const seed of ['ages-a', 'ages-b', 'little-worlds']) {
      const s = createWorld({ seed })
      for (const n of s.map.resources) {
        if (!n) continue
        const age = plantAgeDays(n, 0)
        expect(n.stage).toBe('mature')
        expect(n.amount).toBe(n.max)
        expect(Math.abs(n.bornTick % TICKS_PER_DAY)).toBe(0) // ages advance exactly at dawn
        expect(age).toBeGreaterThanOrEqual(PLANT_MATURE_AT_DAYS[n.kind])
        expect(age).toBeLessThan(oldAtDays(n.kind, n.lifespanDays))
        expect(n.lifespanDays).toBeGreaterThanOrEqual(PLANT_LIFESPAN_DAYS[n.kind].min)
        expect(n.lifespanDays).toBeLessThanOrEqual(PLANT_LIFESPAN_DAYS[n.kind].max)
      }
    }
  })

  it('initial deaths are staggered: no dawn in the first 60 days kills more than 10% of a kind (H6)', () => {
    for (let i = 0; i < 30; i++) {
      const s = createWorld({ seed: `stagger-${i}` })
      for (const kind of ['berries', 'wood'] as const) {
        const plants = s.map.resources.filter((n): n is ResourceNode => n?.kind === kind)
        const perDay = new Map<number, number>()
        for (const n of plants) {
          const deathDay = n.lifespanDays - plantAgeDays(n, 0)
          if (deathDay <= 60) perDay.set(deathDay, (perDay.get(deathDay) ?? 0) + 1)
        }
        const worst = Math.max(0, ...perDay.values())
        expect(worst, `${kind} on stagger-${i}`).toBeLessThanOrEqual(Math.max(1, Math.floor(plants.length * 0.1)))
      }
    }
  })
})

describe('whole simulation with senescence on (the M10c configuration, minus reproduction)', () => {
  for (const seed of ['senescence-a', 'senescence-b']) {
    it(`${seed}: conservation and plant invariants hold every tick for 60 days`, () => {
      const s = createWorld({ seed })
      const start = conservationTotals(s)
      let sawDeadwood = false
      let deadwoodChopped = 0
      for (let t = 0; t < 60 * TICKS_PER_DAY; t++) {
        const deadBefore = s.map.resources.reduce((n, r) => n + (r?.stage === 'dead' ? r.amount : 0), 0)
        const rotBefore = s.ledger.woodDecayed
        stepWithRules(s, { ecology: ON, population: true, resurvey: true })
        expect(conservationTotals(s)).toEqual(start)
        const violations = plantViolations(s, true)
        expect(violations, `tick ${s.tick}`).toEqual([])
        const deadAfter = s.map.resources.reduce((n, r) => n + (r?.stage === 'dead' ? r.amount : 0), 0)
        if (deadAfter > 0) sawDeadwood = true
        // Deadwood units that disappeared without rotting were chopped by citizens.
        const rotted = s.ledger.woodDecayed - rotBefore
        if (deadAfter < deadBefore) deadwoodChopped += deadBefore - deadAfter - Math.min(rotted, deadBefore - deadAfter)
      }
      expect(s.ecology.counters.deaths.berries).toBeGreaterThan(0)
      expect(s.ecology.counters.deaths.wood).toBeGreaterThan(0)
      expect(sawDeadwood).toBe(true)
      expect(s.ledger.foodDecayed).toBeGreaterThan(0)
      // Without reproduction (M10c) the initial cohort of bushes is gone within its lifespans —
      // exactly why senescence stays off until M10c.
      expect(s.map.resources.filter((r) => r?.kind === 'berries').length).toBe(0)
      void deadwoodChopped
    })
  }
})

// ── M10c: reproduction, habitat, clearing, recovery ──────────────────────────

const FULL: EcologyRules = { senescence: true, reproduction: true }
const GRASS = (w: number, h: number) => Array.from({ length: h }, () => '.'.repeat(w))

/** A grass field with the campfire in a far corner (its clearing covers only that corner). */
function field(w = 15, h = 15) {
  const { state } = sandbox(GRASS(w, h), { camp: [0, 0], citizens: [{ x: 0, y: 1 }] })
  state.citizens[0]!.nextDecisionTick = Number.MAX_SAFE_INTEGER
  return state
}
const at = (s: WorldState, x: number, y: number) => y * s.map.width + x
function putBush(s: WorldState, x: number, y: number, opts: Partial<ResourceNode> = {}) {
  s.map.resources[at(s, x, y)] = { ...plantNode('berries'), bornTick: 0, lifespanDays: 44, ...opts }
}
const bushes = (s: WorldState) => s.map.resources.filter((r) => r?.kind === 'berries')

describe('habitat suitability', () => {
  it('bushes like grass, tolerate forest shade poorly, need grass beside sand; trees like forest and forest edges', () => {
    const { state: s } = sandbox(['.fs~#', '.....', 'TTT..'], { camp: [4, 1], citizens: [{ x: 3, y: 1 }] })
    expect(suitability(s.map, 'berries', at(s, 0, 0))).toBe(100)
    expect(suitability(s.map, 'berries', at(s, 1, 0))).toBe(30)
    expect(suitability(s.map, 'berries', at(s, 2, 0))).toBe(15) // sand next to grass
    expect(suitability(s.map, 'berries', at(s, 3, 0))).toBe(0)
    expect(suitability(s.map, 'berries', at(s, 4, 0))).toBe(0)
    expect(suitability(s.map, 'berries', at(s, 1, 1))).toBe(40) // grass shaded by 3 trees
    expect(suitability(s.map, 'wood', at(s, 1, 0))).toBe(100)
    expect(suitability(s.map, 'wood', at(s, 4, 1))).toBe(15) // open grass
    expect(suitability(s.map, 'wood', at(s, 2, 1))).toBe(40) // forest edge (2 tree neighbours)
    expect(suitability(s.map, 'wood', at(s, 2, 0))).toBe(0)
  })
})

describe('seed dispersal and germination', () => {
  it('a mature bush with berries spreads seedlings nearby; a stripped one never does', () => {
    // Five dawns: no seedling is old enough to seed itself, so every new plant is the parent's.
    let born = 0
    for (let k = 0; k < 20; k++) {
      const s = field()
      s.ecology.rng = [k + 11, 3, 5, 7]
      putBush(s, 7, 7, { bornTick: -10 * TICKS_PER_DAY })
      for (let d = 1; d <= 5; d++) ecologyAt(s, dawn(d), FULL)
      const kids = s.map.resources.map((r, i) => (r && i !== at(s, 7, 7) ? i : -1)).filter((i) => i >= 0)
      born += kids.length
      for (const i of kids) {
        expect(Math.abs((i % 15) - 7)).toBeLessThanOrEqual(3)
        expect(Math.abs(Math.floor(i / 15) - 7)).toBeLessThanOrEqual(3)
      }
    }
    expect(born).toBeGreaterThan(0)
    const t = field()
    putBush(t, 7, 7, { bornTick: -10 * TICKS_PER_DAY })
    for (let d = 1; d <= 30; d++) {
      t.map.resources[at(t, 7, 7)]!.amount = 0 // picked bare every day
      ecologyAt(t, dawn(d), FULL)
    }
    expect(bushes(t)).toHaveLength(1)
    expect(t.ecology.counters.births.berries).toBe(0)
  })

  it('seedlings start empty, grow up and begin to fruit — births add no resources', () => {
    const s = field()
    putBush(s, 7, 7, { bornTick: -10 * TICKS_PER_DAY })
    const before = conservationTotals(s)
    let firstSeedling = -1
    for (let t = 1; t <= 40 * TICKS_PER_DAY; t++) {
      ecologyAt(s, t, FULL)
      expect(conservationTotals(s)).toEqual(before)
      if (firstSeedling < 0 && s.map.resources.some((r) => r?.stage === 'seedling')) firstSeedling = t
    }
    expect(firstSeedling).toBeGreaterThan(0)
    expect(s.map.resources.some((r, i) => r && i !== at(s, 7, 7) && r.stage === 'mature' && r.amount > 0)).toBe(true)
  })

  it.each([
    ['inside the settled clearing', (s: WorldState) => {
      // Structures whose clearings cover the bush's whole dispersal square (radius 3).
      const tiles = [[5, 5], [9, 5], [5, 9], [9, 9], [7, 4], [7, 10], [4, 7], [10, 7]].map(([x, y]) => at(s, x!, y!))
      s.structures.push(...tiles.map((tile, k) => ({ ...s.structures[0]!, id: 900 + k, kind: 'shelter' as const, tile, residentIds: [] })))
    }],
    ['when every neighbour tile is occupied or crowded', (s: WorldState) => {
      for (let y = 4; y <= 10; y++) for (let x = 4; x <= 10; x++) if (!(x === 7 && y === 7)) s.map.resources[at(s, x, y)] = { ...plantNode('wood'), bornTick: -30 * TICKS_PER_DAY, lifespanDays: 150 }
    }],
    ['on unsuitable ground (rock all around)', (s: WorldState) => {
      s.map.terrain = s.map.terrain.map((t, i) => (i === at(s, 7, 7) ? t : 'rock'))
    }],
    ['at the safety cap', (s: WorldState) => {
      const cap = safetyCap(s.map, 'berries')
      for (let i = 0, n = 1; n < cap && i < s.map.resources.length; i++) if (!s.map.resources[i] && Math.abs((i % 15) - 7) + Math.abs(Math.floor(i / 15) - 7) > 4) { s.map.resources[i] = { ...plantNode('berries'), amount: 0, bornTick: -10 * TICKS_PER_DAY, lifespanDays: 44 }; n++ }
    }],
  ])('no germination %s', (_name, block) => {
    const s = field()
    putBush(s, 7, 7, { bornTick: -10 * TICKS_PER_DAY })
    block(s)
    const before = bushes(s).length
    for (let d = 1; d <= 30; d++) {
      ecologyAt(s, dawn(d), FULL)
      for (const r of s.map.resources) if (r?.kind === 'berries' && r !== s.map.resources[at(s, 7, 7)]) r.amount = 0 // only the test bush may seed
    }
    expect(s.ecology.counters.births.berries).toBe(0)
    expect(bushes(s).length).toBe(before)
  })

  it('germination never lands in the clearing, but plants already there are kept', () => {
    const s = field()
    s.structures[0]!.tile = at(s, 7, 9)
    putBush(s, 7, 7, { bornTick: -10 * TICKS_PER_DAY }) // inside the clearing (distance 2)
    putBush(s, 7, 4, { bornTick: -10 * TICKS_PER_DAY }) // outside
    for (let d = 1; d <= 30; d++) {
      const mask = clearingMask(s)
      const before = s.map.resources.map((r) => r !== null)
      ecologyAt(s, dawn(d), FULL)
      s.map.resources.forEach((r, i) => {
        if (r && !before[i]) expect(mask[i], `germinated at ${i}`).toBe(0)
      })
    }
    expect(s.map.resources[at(s, 7, 7)]).not.toBeNull() // the existing bush lives on
  })

  it('a dying bush full of berries may re-sprout as fallen fruit; a stripped one leaves nothing', () => {
    let sprouts = 0
    let strippedSprouts = 0
    for (let k = 0; k < 20; k++) {
      const s = field()
      s.ecology.rng = [k + 1, 7, 99, 1234]
      putBush(s, 7, 7, { stage: 'old', max: 4, amount: 4, bornTick: dawn(1) - 39 * TICKS_PER_DAY, lifespanDays: 40 })
      ecologyAt(s, dawn(2), { senescence: true, reproduction: true })
      sprouts += s.ecology.counters.fallenFruitSprouts
      expect(s.map.resources[at(s, 7, 7)] === null || s.map.resources[at(s, 7, 7)]!.stage === 'seedling').toBe(true)
      const t = field()
      t.ecology.rng = [k + 1, 7, 99, 1234]
      putBush(t, 7, 7, { stage: 'old', max: 4, amount: 0, bornTick: dawn(1) - 39 * TICKS_PER_DAY, lifespanDays: 40 })
      ecologyAt(t, dawn(2), FULL)
      strippedSprouts += t.ecology.counters.fallenFruitSprouts
      expect(t.ledger.foodDecayed).toBe(0)
    }
    expect(sprouts).toBeGreaterThan(0)
    expect(strippedSprouts).toBe(0)
  })
})

describe('collapse and natural recovery (TDS H8)', () => {
  it('a patch stripped every day cannot reproduce and dies out within one lifetime', () => {
    const s = field()
    for (const [x, y] of [[6, 6], [8, 6], [6, 8], [8, 8]] as const) putBush(s, x, y, { bornTick: -10 * TICKS_PER_DAY, lifespanDays: 30 })
    for (let d = 1; d <= 45; d++) {
      for (const r of s.map.resources) if (r) r.amount = 0
      ecologyAt(s, dawn(d), FULL)
    }
    expect(bushes(s)).toHaveLength(0)
    expect(s.ecology.counters.births.berries).toBe(0)
  })

  it('once harvesting stops, an unharvested ring recolonises the emptied patch', () => {
    const s = field(21, 21)
    const ring = [[10, 5], [15, 10], [10, 15], [5, 10], [6, 6], [14, 14]] as const
    for (const [x, y] of ring) putBush(s, x, y, { bornTick: -10 * TICKS_PER_DAY, lifespanDays: 44 })
    for (let d = 1; d <= 60; d++) ecologyAt(s, dawn(d), FULL)
    const inPatch = () => s.map.resources.filter((r, i) => r?.kind === 'berries' && r.stage !== 'seedling' && Math.abs((i % 21) - 10) <= 2 && Math.abs(Math.floor(i / 21) - 10) <= 2)
    expect(inPatch().length).toBeGreaterThanOrEqual(2)
  })

  it('the ecology ignores colony need: same plants whatever the stockpile and hunger (no rescue)', () => {
    const a = createWorld({ seed: 'no-rescue-m10c' })
    const b = createWorld({ seed: 'no-rescue-m10c' })
    a.stockpile.food = 0
    b.stockpile.food = 800
    for (const c of a.citizens) c.needs.satiety = 1
    for (let t = 1; t <= 90 * TICKS_PER_DAY; t++) {
      ecologyAt(a, t, FULL)
      ecologyAt(b, t, FULL)
    }
    expect(b.map.resources).toEqual(a.map.resources)
    expect(b.ecology).toEqual(a.ecology)
    expect(a.ecology.counters.births.berries).toBeGreaterThan(0)
  })

  it('draws only from the ecology stream, never the AI stream', () => {
    const s = createWorld({ seed: 'eco-stream' })
    const ai = [...s.rng]
    for (let t = 1; t <= 30 * TICKS_PER_DAY; t++) ecologyAt(s, t, FULL)
    expect(s.rng).toEqual(ai)
  })
})

describe('shelters and seedlings', () => {
  it('a shelter site may be built over a seedling, which is cleared (it holds nothing)', () => {
    const { state: s } = sandbox(GRASS(11, 11), { camp: [5, 5], citizens: [{ x: 5, y: 6 }] })
    s.stockpile.food = 0
    const first = chooseSite(s)!
    s.map.resources[first] = plantNode('berries', { stage: 'seedling', bornTick: 0 })
    expect(chooseSite(s)).toBe(first)
    s.map.resources[first] = plantNode('berries', { stage: 'young', bornTick: -3 * TICKS_PER_DAY })
    expect(chooseSite(s)).not.toBe(first) // anything bigger than a seedling still blocks the site
    s.map.resources[first] = plantNode('berries', { stage: 'seedling', bornTick: 0 })
    const before = conservationTotals(s)
    const site = planShelter(s)!
    expect(site.tile).toBe(first)
    expect(s.map.resources[first]).toBeNull()
    expect(conservationTotals(s)).toEqual(before)
  })
})

describe('whole simulation under M10c (default rules)', () => {
  for (const seed of ['m10c-a', 'm10c-b']) {
    it(`${seed}: conservation and plant invariants every tick for 120 days; plants keep reproducing`, () => {
      const s = createWorld({ seed })
      const start = conservationTotals(s)
      for (let t = 0; t < 120 * TICKS_PER_DAY; t++) {
        step(s)
        expect(conservationTotals(s)).toEqual(start)
        if (s.tick % TICKS_PER_DAY === 0) expect(plantViolations(s, true), `tick ${s.tick}`).toEqual([])
      }
      expect(s.ecology.counters.births.berries).toBeGreaterThan(0)
      expect(s.ecology.counters.deaths.berries).toBeGreaterThan(0)
      expect(bushes(s).length).toBeGreaterThan(0)
      expect(s.map.resources.some((r) => r?.kind === 'wood')).toBe(true)
    })
  }
})
