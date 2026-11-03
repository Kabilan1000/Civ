// Long-run balance & reliability sweep. Skipped in the normal test run (it
// takes minutes); run with `npm run sweep`. Every tick it checks invariants;
// at the end it prints a report. Assertions here are hard invariants only —
// balance figures are reported, not forced.

import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { CARRY_CAPACITY, MAX_EVENTS, MAX_MEMORIES, SHELTER_CAPACITY, TICKS_PER_DAY } from '../constants.ts'
import { isAdjacent4, isPassable, toIndex } from '../grid.ts'
import { getCivStats } from '../selectors.ts'
import { deserialize, serialize } from '../serialize.ts'
import type { WorldState } from '../types.ts'
import { createWorld, step, stepN } from '../world.ts'

const RUN = process.env.LW_SWEEP === '1'
const SEEDS = Number(process.env.LW_SEEDS ?? 30)
const DAYS = Number(process.env.LW_DAYS ?? 30)
const LONG_DAYS = Number(process.env.LW_LONG_DAYS ?? 100)

function totals(s: WorldState) {
  let food = s.stockpile.food + s.ledger.foodEaten + s.ledger.foodLost - s.ledger.foodRegrown
  let wood = s.stockpile.wood + s.ledger.woodLost - s.ledger.woodRegrown
  for (const r of s.map.resources) {
    if (r?.kind === 'berries') food += r.amount
    else if (r) wood += r.amount
  }
  for (const c of s.citizens) {
    if (c.carrying?.kind === 'berries') food += c.carrying.amount
    else if (c.carrying) wood += c.carrying.amount
  }
  for (const st of s.structures) wood += st.woodDelivered
  return { food, wood }
}

interface Report {
  seed: string
  days: number
  deaths: number
  deathCauses: string[]
  min: { satiety: number; energy: number; social: number; health: number }
  avgSocial: number
  housed: number
  shelters: number
  firstAllHousedDay: number | null
  abandoned: number
  foodGathered: number
  foodEaten: number
  foodRegrown: number
  woodGathered: number
  stockFood: number
  stockWood: number
  lowestFoodAfterDay3: number
  exploredPct: number
  friendships: number
  rivalries: number
  arguments: number
  shares: number
  chatsRemembered: number
  longestTask: { kind: string; ticks: number }
  idleStreak: number
  msPerTick: number
  saveBytes: number
  historyLength: number
}

function runSeed(seed: string, days: number): Report {
  const s = createWorld({ seed })
  const start = totals(s)
  const min = { satiety: 100, energy: 100, social: 100, health: 100 }
  let socialSum = 0
  let socialN = 0
  let lowestFood = Infinity
  let firstAllHousedDay: number | null = null
  let args = 0
  let shares = 0
  let lastEventId = 0
  const taskSince = new Map<number, { task: object | null; since: number }>()
  const idleSince = new Map<number, number>()
  let longestTask = { kind: '-', ticks: 0 }
  let idleStreak = 0
  const prevPos = s.citizens.map((c) => ({ ...c.pos }))
  let simMs = 0

  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    const t0 = performance.now()
    step(s)
    simMs += performance.now() - t0

    // ── Invariants (every tick) ──
    expect(totals(s)).toEqual(start)
    expect(s.stockpile.food >= 0 && s.stockpile.wood >= 0).toBe(true)
    expect(s.events.length).toBeLessThanOrEqual(MAX_EVENTS)
    for (const [i, c] of s.citizens.entries()) {
      const tile = toIndex(c.pos.x, c.pos.y, s.map.width)
      expect(isPassable(s.map, tile)).toBe(true)
      expect(s.map.discovered[tile]).toBe(1)
      const p = prevPos[i]!
      if (p.x !== c.pos.x || p.y !== c.pos.y) expect(isAdjacent4(p, c.pos)).toBe(true)
      prevPos[i] = { ...c.pos }
      expect(c.memories.length).toBeLessThanOrEqual(MAX_MEMORIES)
      for (const v of Object.values(c.needs)) expect(v >= 0 && v <= 100).toBe(true)
      if (c.carrying) expect(c.carrying.amount > 0 && c.carrying.amount <= CARRY_CAPACITY[c.carrying.kind]).toBe(true)
      for (const r of Object.values(c.relationships)) {
        expect(r.affinity >= -100 && r.affinity <= 100 && r.familiarity >= 0 && r.familiarity <= 100).toBe(true)
      }
      if (!c.alive) {
        expect(c.task === null && c.homeId === null).toBe(true)
        continue
      }
      // Task durations (deadlock detection) and idle streaks.
      const ts = taskSince.get(c.id)
      if (!ts || ts.task !== c.task) taskSince.set(c.id, { task: c.task, since: s.tick })
      else if (c.task && s.tick - ts.since > longestTask.ticks) longestTask = { kind: `${c.task.kind}:${c.task.phase}`, ticks: s.tick - ts.since }
      if (c.task) idleSince.delete(c.id)
      else {
        const since = idleSince.get(c.id) ?? s.tick
        idleSince.set(c.id, since)
        idleStreak = Math.max(idleStreak, s.tick - since)
      }
      for (const k of ['satiety', 'energy', 'social', 'health'] as const) min[k] = Math.min(min[k], c.needs[k])
      if (s.tick > TICKS_PER_DAY * 2) {
        socialSum += c.needs.social
        socialN++
      }
    }
    for (const sh of s.structures) {
      expect(sh.residentIds.length).toBeLessThanOrEqual(SHELTER_CAPACITY)
      expect(sh.woodDelivered).toBeLessThanOrEqual(sh.woodRequired)
    }
    for (const e of s.events) {
      if (e.id <= lastEventId) continue
      if (e.kind === 'argument') args++
      if (e.kind === 'sharedFood') shares++
    }
    lastEventId = s.events.at(-1)?.id ?? lastEventId

    const stats = getCivStats(s)
    if (firstAllHousedDay === null && stats.population > 0 && stats.housing.homeless === 0) firstAllHousedDay = stats.day
    if (s.tick > TICKS_PER_DAY * 3) lowestFood = Math.min(lowestFood, s.stockpile.food)
  }

  const stats = getCivStats(s)
  const json = serialize(s)
  return {
    seed,
    days,
    deaths: stats.dead,
    deathCauses: s.citizens.filter((c) => !c.alive).map((c) => `${c.deathCause}@d${Math.floor((c.diedTick ?? 0) / TICKS_PER_DAY) + 1}`),
    min,
    avgSocial: socialN ? socialSum / socialN : 0,
    housed: stats.housing.occupied,
    shelters: stats.shelters.complete,
    firstAllHousedDay,
    abandoned: s.events.filter((e) => e.kind === 'shelterAbandoned').length,
    foodGathered: s.ledger.foodGathered,
    foodEaten: s.ledger.foodEaten,
    foodRegrown: s.ledger.foodRegrown,
    woodGathered: s.ledger.woodGathered,
    stockFood: s.stockpile.food,
    stockWood: s.stockpile.wood,
    lowestFoodAfterDay3: lowestFood,
    exploredPct: stats.exploredPercent,
    friendships: stats.friendships,
    rivalries: stats.rivalries,
    arguments: args,
    shares,
    chatsRemembered: s.citizens.reduce((n, c) => n + c.memories.filter((m) => m.kind === 'chat').length, 0),
    longestTask,
    idleStreak,
    msPerTick: simMs / (days * TICKS_PER_DAY),
    saveBytes: json.length,
    historyLength: s.history.length,
  }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const fmt = (x: number, d = 1) => x.toFixed(d)

describe.runIf(RUN)('long-run sweep', () => {
  it(`${SEEDS} seeds × ${DAYS} days`, () => {
    const reports = Array.from({ length: SEEDS }, (_, i) => runSeed(`sweep-${i}`, DAYS))
    const lines = reports.map((r) =>
      `${r.seed.padEnd(9)} dead ${r.deaths} ${r.deathCauses.join(',').padEnd(12)} min sat ${fmt(r.min.satiety, 0).padStart(3)} en ${fmt(r.min.energy, 0).padStart(3)} hp ${fmt(r.min.health, 0).padStart(3)} soc ${fmt(r.min.social, 0).padStart(3)} | housed ${r.housed} (all by d${r.firstAllHousedDay ?? '-'}) | food ${r.stockFood} (low ${r.lowestFoodAfterDay3}) wood ${r.stockWood} | expl ${fmt(r.exploredPct, 0)}% | fr ${r.friendships} riv ${r.rivalries} arg ${r.arguments} share ${r.shares} | longest ${r.longestTask.kind}=${r.longestTask.ticks} idle ${r.idleStreak}`,
    )
    console.log(lines.join('\n'))
    console.log(`\nSUMMARY ${SEEDS}×${DAYS}d: deaths ${reports.reduce((n, r) => n + r.deaths, 0)} (villages with deaths: ${reports.filter((r) => r.deaths).length})`)
    console.log(`  worst satiety ${fmt(Math.min(...reports.map((r) => r.min.satiety)))} energy ${fmt(Math.min(...reports.map((r) => r.min.energy)))} health ${fmt(Math.min(...reports.map((r) => r.min.health)))}; avg social ${fmt(avg(reports.map((r) => r.avgSocial)))}`)
    console.log(`  fully housed: ${reports.filter((r) => r.firstAllHousedDay !== null).length}/${SEEDS}, median day ${[...reports.map((r) => r.firstAllHousedDay ?? 99)].sort((a, b) => a - b)[Math.floor(SEEDS / 2)]}; abandoned sites ${reports.reduce((n, r) => n + r.abandoned, 0)}`)
    console.log(`  per village per day: food gathered ${fmt(avg(reports.map((r) => r.foodGathered / DAYS)))}, eaten ${fmt(avg(reports.map((r) => r.foodEaten / DAYS)))}, regrown ${fmt(avg(reports.map((r) => r.foodRegrown / DAYS)))}; wood gathered ${fmt(avg(reports.map((r) => r.woodGathered / DAYS)))}`)
    console.log(`  explored ${fmt(avg(reports.map((r) => r.exploredPct)))}% avg; friendships ${fmt(avg(reports.map((r) => r.friendships)))} rivalries ${fmt(avg(reports.map((r) => r.rivalries)))} arguments ${fmt(avg(reports.map((r) => r.arguments)))} shares ${fmt(avg(reports.map((r) => r.shares)))} per village`)
    console.log(`  longest single task ${Math.max(...reports.map((r) => r.longestTask.ticks))} ticks (${reports.sort((a, b) => b.longestTask.ticks - a.longestTask.ticks)[0]!.longestTask.kind}); longest idle streak ${Math.max(...reports.map((r) => r.idleStreak))}`)
    console.log(`  sim ${fmt(avg(reports.map((r) => r.msPerTick)), 3)} ms/tick; save ${fmt(avg(reports.map((r) => r.saveBytes)) / 1024)} KB avg, max ${fmt(Math.max(...reports.map((r) => r.saveBytes)) / 1024)} KB; history ${reports[0]!.historyLength} samples`)
  }, 3_600_000)

  it(`3 long runs × ${LONG_DAYS} days with save/resume`, () => {
    for (const seed of ['long-a', 'long-b', 'long-c']) {
      const r = runSeed(seed, LONG_DAYS)
      console.log(`${seed}: ${LONG_DAYS}d dead ${r.deaths} ${r.deathCauses.join(',')} | min sat ${fmt(r.min.satiety, 0)} en ${fmt(r.min.energy, 0)} hp ${fmt(r.min.health, 0)} | housed ${r.housed} | food ${r.stockFood} wood ${r.stockWood} | expl ${fmt(r.exploredPct, 0)}% | fr ${r.friendships} riv ${r.rivalries} arg ${r.arguments} share ${r.shares} | longest task ${r.longestTask.kind}=${r.longestTask.ticks} | ${fmt(r.msPerTick, 3)} ms/tick | save ${fmt(r.saveBytes / 1024)} KB, history ${r.historyLength}`)
    }
    // Deterministic save/resume after a long run.
    const a = createWorld({ seed: 'long-resume' })
    stepN(a, LONG_DAYS * TICKS_PER_DAY)
    const b = deserialize(serialize(a))
    stepN(a, 2000)
    stepN(b, 2000)
    expect(serialize(b)).toBe(serialize(a))
    console.log('long-resume: save/resume after', LONG_DAYS, 'days is exact')
  }, 3_600_000)
})
