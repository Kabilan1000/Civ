import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { ARCHIVE_MAX, MAX_MEMORIES, PLANT_SENESCENCE_ENABLED, MAX_OVERCROWD, MAX_POPULATION, SHELTER_CAPACITY, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants.ts'
import { isAdjacent4, isPassable } from '../grid.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, step } from '../world.ts'
import { conservationTotals, plantViolations } from './invariants.ts'

// Population V1 long-run sweep (TDS §8.5). Opt-in: `npm run sweep:population`.
//   LW_POP_SEEDS (12)  LW_POP_DAYS (2400 = 50 world years)  LW_POP_SHARD / LW_POP_SHARDS (0 / 1)
// Hard gates are asserted every tick; trajectories are printed, not forced.

const RUN = process.env.LW_POP_SWEEP === '1'
const SEEDS = Number(process.env.LW_POP_SEEDS ?? 12)
const DAYS = Number(process.env.LW_POP_DAYS ?? 2400)
const SHARD = Number(process.env.LW_POP_SHARD ?? 0)
const SHARDS = Number(process.env.LW_POP_SHARDS ?? 1)
const CHILD_ACTIONS = new Set(['eat', 'rest', 'socialize', 'wander'])

function generationOf(s: WorldState): Map<number, number> {
  const parents = new Map<number, [number, number] | null>()
  for (const c of s.citizens) parents.set(c.id, c.parentIds)
  for (const p of s.archive) parents.set(p.id, p.parentIds)
  const gen = new Map<number, number>()
  const of = (id: number): number => {
    if (gen.has(id)) return gen.get(id)!
    const ps = parents.get(id)
    const g = ps ? 1 + Math.max(...ps.map((p) => (parents.has(p) ? of(p) : 0))) : 0
    gen.set(id, g)
    return g
  }
  for (const id of parents.keys()) of(id)
  return gen
}

describe.skipIf(!RUN)('population sweep', () => {
  const seeds = Array.from({ length: SEEDS }, (_, i) => `pop-${i}`).filter((_, i) => i % SHARDS === SHARD)
  for (const seed of seeds) {
    it(`${seed}: ${DAYS} days`, () => {
      const s = createWorld({ seed })
      const founders = new Set(s.citizens.map((c) => c.id))
      const start = conservationTotals(s)
      const first = { partner: -1, birth: -1, adult: -1, oldAge: -1, foundersGone: -1 }
      const traj: string[] = []
      let peak = 12
      let low = 12
      let maxSave = 0
      let maxRel = 0
      let needsDeaths = 0
      let idleStreak = 0
      const idle = new Map<number, number>()
      let simMs = 0
      const bad: string[] = []
      for (let t = 1; t <= DAYS * TICKS_PER_DAY; t++) {
        const t0 = performance.now()
        step(s)
        simMs += performance.now() - t0
        // ── hard gates, every tick (collected cheaply, asserted once a day) ──
        const totals = conservationTotals(s)
        if (totals.food !== start.food || totals.wood !== start.wood) bad.push(`t${t}: conservation ${JSON.stringify(totals)} ≠ ${JSON.stringify(start)}`)
        const living = s.citizens.filter((c) => c.alive)
        if (living.length > MAX_POPULATION) bad.push(`t${t}: population ${living.length}`)
        const byId = new Map(s.citizens.map((c) => [c.id, c]))
        for (const c of living) {
          const tile = c.pos.y * s.map.width + c.pos.x
          if (!isPassable(s.map, tile) || s.map.discovered[tile] !== 1) bad.push(`t${t}: ${c.name} on bad tile ${tile}`)
          if (c.pathIndex > 0 && c.path.length) {
            const prev = c.path[c.pathIndex - 1]!
            const p = { x: prev % s.map.width, y: Math.floor(prev / s.map.width) }
            if ((p.x !== c.pos.x || p.y !== c.pos.y) && !isAdjacent4(p, c.pos)) bad.push(`t${t}: ${c.name} teleported`)
          }
          const n = c.needs
          if (!(n.satiety >= 0 && n.satiety <= 100 && n.energy >= 0 && n.energy <= 100 && n.social >= 0 && n.social <= 100 && n.health >= 0 && n.health <= 100)) bad.push(`t${t}: ${c.name} needs out of range`)
          if (c.memories.length > MAX_MEMORIES) bad.push(`t${t}: ${c.name} memories`)
          const age = Math.floor((s.tick - c.bornTick) / TICKS_PER_YEAR)
          if (age > s.population.profile.maxAge) bad.push(`t${t}: ${c.name} aged ${age}`)
          if (age < s.population.profile.adultAge && c.task && !CHILD_ACTIONS.has(c.task.kind)) bad.push(`t${t}: child ${c.name} doing ${c.task.kind}`)
          if (c.partnerId !== null && byId.get(c.partnerId)?.partnerId !== c.id) bad.push(`t${t}: ${c.name} partner not mutual`)
          const streak = c.task ? 0 : (idle.get(c.id) ?? 0) + 1
          idle.set(c.id, streak)
          if (streak > idleStreak) idleStreak = streak
        }
        for (const sh of s.structures) if (sh.residentIds.length > SHELTER_CAPACITY + MAX_OVERCROWD) bad.push(`t${t}: shelter ${sh.id} holds ${sh.residentIds.length}`)
        if (s.archive.length > ARCHIVE_MAX) bad.push(`t${t}: archive ${s.archive.length}`)
        if (t % TICKS_PER_DAY !== 0) continue
        // ── daily: assert everything collected, plus plant invariants ──
        bad.push(...plantViolations(s, PLANT_SENESCENCE_ENABLED))
        expect(bad.slice(0, 5)).toEqual([])
        const day = t / TICKS_PER_DAY
        const c = s.population.counters
        if (first.partner < 0 && c.partnerships > 0) first.partner = day
        if (first.birth < 0 && c.births > 0) first.birth = day
        if (first.adult < 0 && c.comingOfAge > 0) first.adult = day
        if (first.oldAge < 0 && c.oldAgeDeaths > 0) first.oldAge = day
        if (first.foundersGone < 0 && !living.some((x) => founders.has(x.id))) first.foundersGone = day
        peak = Math.max(peak, living.length)
        if (day > 48) low = Math.min(low, living.length)
        maxRel = Math.max(maxRel, ...living.map((x) => Object.keys(x.relationships).length), 0)
        if (day % 240 === 0) {
          maxSave = Math.max(maxSave, serialize(s).length)
          traj.push(`y${day / 48}:${living.length}`)
        }
      }
      needsDeaths = s.citizens.filter((x) => !x.alive && x.deathCause !== 'oldAge').length + s.archive.filter((x) => x.cause !== 'oldAge').length
      // save/resume across everything that happened
      const resumed = deserialize(serialize(s))
      for (let k = 0; k < 2 * TICKS_PER_DAY; k++) {
        step(s)
        step(resumed)
      }
      expect(serialize(resumed)).toBe(serialize(s))
      const gens = generationOf(s)
      const living = s.citizens.filter((x) => x.alive)
      const maxGen = Math.max(0, ...living.map((x) => gens.get(x.id) ?? 0))
      const counters = s.population.counters
      const at100x = (day: number) => (day < 0 ? 'never' : `${((day * TICKS_PER_DAY) / 500 / 60).toFixed(1)}min`)
      console.log(
        `${seed.padEnd(7)} first partner d${first.partner} birth d${first.birth} (${at100x(first.birth)}) adult d${first.adult} (${at100x(first.adult)}) ` +
          `old-age death d${first.oldAge} (${at100x(first.oldAge)}) founders gone d${first.foundersGone} (${at100x(first.foundersGone)})\n` +
          `        pop peak ${peak} low ${low} end ${living.length} | births ${counters.births} deaths ${counters.deaths} (old age ${counters.oldAgeDeaths}, needs ${needsDeaths}) ` +
          `| generation ${maxGen} | archive ${s.archive.length} | max rel/citizen ${maxRel} | max save ${(maxSave / 1024).toFixed(0)} KB ` +
          `| idle streak ${idleStreak} | ${(simMs / (DAYS * TICKS_PER_DAY)).toFixed(3)} ms/tick\n        ${traj.join(' ')}`,
      )
      void TICKS_PER_YEAR
    }, 7_200_000)
  }
})
