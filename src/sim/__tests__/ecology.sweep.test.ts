import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { getCampTile } from '../ai/context.ts'
import { safetyCap } from '../ecology/habitat.ts'
import { isPassable } from '../grid.ts'
import { distanceField } from '../path/flood.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'
import { conservationTotals, plantViolations } from './invariants.ts'

// M10c ecology sweep (TDS §7.5–7.6). Opt-in: `npm run sweep:ecology`.
//   LW_ECO_SEEDS (8 new worlds)  LW_ECO_DAYS (120)  LW_ECO_SHARD / LW_ECO_SHARDS
// Plus three population checkpoints: 12 (a new world at day 12), 30 and 60
// (real Population V1 saves, migrated v7 → v8). Hard gates are asserted;
// balance figures are printed, not forced.

const RUN = process.env.LW_ECO_SWEEP === '1'
const SEEDS = Number(process.env.LW_ECO_SEEDS ?? 8)
const DAYS = Number(process.env.LW_ECO_DAYS ?? 120)
const SHARD = Number(process.env.LW_ECO_SHARD ?? 0)
const SHARDS = Number(process.env.LW_ECO_SHARDS ?? 1)
const NEAR_CAMP_STEPS = 10

interface Case {
  name: string
  make: () => WorldState
}

const fixture = (file: string) => () => deserialize(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const cases: Case[] = [
  ...Array.from({ length: SEEDS }, (_, i) => ({ name: `eco-${i}`, make: () => createWorld({ seed: `eco-${i}` }) })),
  { name: 'pop-12', make: () => { const s = createWorld({ seed: 'pop-0' }); stepN(s, 11 * 240); return s } },
  { name: 'pop-30 (v7)', make: fixture('popv1-save-v7-30.json') },
  { name: 'pop-60 (v7)', make: fixture('popv1-save-v7-60.json') },
].filter((_, i) => i % SHARDS === SHARD)

function census(s: WorldState) {
  const out = { bushes: 0, trees: 0, seedlings: 0, deadwood: 0, standingFood: 0 }
  for (const r of s.map.resources) {
    if (!r) continue
    if (r.stage === 'seedling') out.seedlings++
    if (r.kind === 'berries') {
      out.bushes++
      out.standingFood += r.amount
    } else if (r.stage === 'dead') out.deadwood++
    else out.trees++
  }
  return out
}

describe.skipIf(!RUN)('ecology sweep', () => {
  for (const c of cases) {
    it(`${c.name}: ${DAYS} days`, () => {
      const s = c.make()
      const start = conservationTotals(s)
      const c0 = census(s)
      const pop0 = s.citizens.filter((x) => x.alive).length
      const deaths0 = s.population.counters.deaths
      const old0 = s.population.counters.oldAgeDeaths
      const eco0 = JSON.parse(JSON.stringify(s.ecology.counters))
      const bad: string[] = []
      const traj: string[] = []
      let worstDawnDeathShare = 0
      let capHit = false
      let minFood = s.stockpile.food
      let minSatiety = 100
      let zeroRun = 0
      let longestZero = 0
      let zeroEpisodes = 0
      const tripSteps: number[] = []
      const tripByDecade: number[][] = []
      let steps: Int32Array = new Int32Array(0)
      let simMs = 0
      const camp = getCampTile(s)!
      for (let t = 1; t <= DAYS * 240; t++) {
        const before = s.ecology.counters.deaths.berries + s.ecology.counters.deaths.wood
        const t0 = performance.now()
        step(s)
        simMs += performance.now() - t0
        const totals = conservationTotals(s)
        if (totals.food !== start.food || totals.wood !== start.wood) bad.push(`t${s.tick}: conservation`)
        for (const x of s.citizens) {
          if (!x.alive) continue
          if (!isPassable(s.map, x.pos.y * s.map.width + x.pos.x)) bad.push(`t${s.tick}: ${x.name} off land`)
          if (x.needs.satiety < minSatiety) minSatiety = x.needs.satiety
          // Foraging distance: walk steps from camp to each newly chosen bush.
          if (x.task?.kind === 'forage' && x.task.startedTick === s.tick && x.task.targetTile !== null && steps.length) {
            const d = steps[x.task.targetTile]!
            if (d >= 0) {
              tripSteps.push(d)
              ;(tripByDecade[Math.floor((t / 240) / 10)] ??= []).push(d)
            }
          }
        }
        if (s.stockpile.food < minFood) minFood = s.stockpile.food
        if (s.tick % 240 !== 0) continue
        // ── dawn ──
        const plants = census(s)
        const died = s.ecology.counters.deaths.berries + s.ecology.counters.deaths.wood - before
        worstDawnDeathShare = Math.max(worstDawnDeathShare, died / Math.max(1, plants.bushes + plants.trees + died))
        if (plants.bushes >= safetyCap(s.map, 'berries') || plants.trees + plants.deadwood >= safetyCap(s.map, 'wood')) capHit = true
        bad.push(...plantViolations(s, true))
        steps = distanceField(s.map, camp, (i) => s.map.discovered[i] === 1)
        let near = 0
        s.map.resources.forEach((r, i) => {
          if (r?.kind === 'berries' && s.map.discovered[i] === 1 && steps[i]! >= 0 && steps[i]! <= NEAR_CAMP_STEPS) near += r.amount
        })
        if (near === 0) {
          if (zeroRun === 0) zeroEpisodes++
          zeroRun++
          longestZero = Math.max(longestZero, zeroRun)
        } else zeroRun = 0
        const day = s.tick / 240
        if (day % 20 === 0) traj.push(`d${day % 1 === 0 ? Math.round(day - (c.name.startsWith('pop-') ? 0 : 0)) : day}:b${plants.bushes}/t${plants.trees}/f${s.stockpile.food}/p${s.citizens.filter((x) => x.alive).length}`)
        expect(bad.slice(0, 5)).toEqual([])
      }
      const resumed = deserialize(serialize(s))
      stepN(s, 240)
      stepN(resumed, 240)
      expect(serialize(resumed)).toBe(serialize(s))
      const c1 = census(s)
      const eco = s.ecology.counters
      const living = s.citizens.filter((x) => x.alive).length
      const needsDeaths = s.population.counters.deaths - deaths0 - (s.population.counters.oldAgeDeaths - old0)
      const mean = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—')
      console.log(
        `${c.name.padEnd(12)} pop ${pop0}→${living} (needs deaths ${needsDeaths}, old age ${s.population.counters.oldAgeDeaths - old0}) | min satiety ${minSatiety.toFixed(0)} | food min ${minFood}\n` +
          `             bushes ${c0.bushes}→${c1.bushes} trees ${c0.trees}→${c1.trees} deadwood ${c1.deadwood} | plant births b${eco.births.berries - eco0.births.berries}/t${eco.births.wood - eco0.births.wood} deaths b${eco.deaths.berries - eco0.deaths.berries}/t${eco.deaths.wood - eco0.deaths.wood} fallen ${eco.fallenFruitSprouts - eco0.fallenFruitSprouts} | worst dawn deaths ${(worstDawnDeathShare * 100).toFixed(0)}% | cap hit ${capHit}\n` +
          `             forage trip steps mean ${mean(tripSteps)} by decade [${tripByDecade.map(mean).join(' ')}] | forage-near-camp zero episodes ${zeroEpisodes}, longest ${longestZero}d | ${(simMs / (DAYS * 240)).toFixed(3)} ms/tick\n` +
          `             ${traj.join(' ')}`,
      )
      expect(capHit).toBe(false)
    }, 7_200_000)
  }
})
