import { describe, expect, it } from 'vitest'
import { GENERATIONS_MAX, HISTORY_INTERVAL, HISTORY_MAX, SHELTER_CAPACITY, TICKS_PER_SEASON } from '../constants.ts'
import { getCivStats, getGenerations } from '../selectors.ts'
import { deserialize, serialize } from '../serialize.ts'
import { createWorld, step, stepN } from '../world.ts'

describe('history', () => {
  it('records genuine samples at tick 0 and every HISTORY_INTERVAL ticks', () => {
    const s = createWorld({ seed: 'history' })
    expect(s.history.map((h) => h.tick)).toEqual([0])
    for (let t = 1; t <= HISTORY_INTERVAL * 30; t++) {
      step(s)
      if (t % HISTORY_INTERVAL === 0) {
        const sample = s.history.at(-1)!
        const stats = getCivStats(s)
        expect(sample).toEqual({
          tick: t,
          population: stats.population,
          food: stats.food,
          wood: stats.wood,
          housed: stats.housing.occupied,
          capacity: stats.housing.capacity,
          discovered: stats.discoveredTiles,
          satiety: Math.round(stats.avgNeeds.satiety),
          energy: Math.round(stats.avgNeeds.energy),
          health: Math.round(stats.avgNeeds.health),
          social: Math.round(stats.avgNeeds.social),
          // Population V1: the same figures the dashboard shows.
          children: stats.people.children,
          adults: stats.people.adults,
          elders: stats.people.elders,
          births: stats.people.births,
          deaths: stats.people.deaths,
        })
        expect(sample.capacity % SHELTER_CAPACITY).toBe(0)
      }
    }
    expect(s.history).toHaveLength(31)
  })

  it('is deterministic and survives save/resume', () => {
    const a = createWorld({ seed: 'history-det' })
    stepN(a, 1000)
    const b = deserialize(serialize(a))
    expect(b.history).toEqual(a.history)
    stepN(a, 700)
    stepN(b, 700)
    expect(b.history).toEqual(a.history)
    expect(serialize(b)).toBe(serialize(a))
  })

  it('stays bounded, dropping the oldest samples', () => {
    const s = createWorld({ seed: 'history-cap' })
    s.history = Array.from({ length: HISTORY_MAX }, (_, i) => ({ ...s.history[0]!, tick: i }))
    s.tick = HISTORY_MAX
    s.history = s.history.map((h, i) => ({ ...h, tick: i })) // ticks 0..HISTORY_MAX-1, all < tick
    stepN(s, HISTORY_INTERVAL * 3)
    expect(s.history).toHaveLength(HISTORY_MAX)
    expect(s.history[0]!.tick).toBe(3)
    expect(s.history.at(-1)!.tick % HISTORY_INTERVAL).toBe(0)
  })
})

describe('generations (long-term history, schema v11)', () => {
  const SEASON = TICKS_PER_SEASON

  it('records one real summary at the start of each season, from that moment and its season', () => {
    const s = createWorld({ seed: 'generations' })
    expect(s.generations).toEqual([])
    for (let k = 1; k <= 3; k++) {
      stepN(s, SEASON - (s.tick % SEASON) - 1)
      expect(s.generations).toHaveLength(k - 1)
      step(s)
      expect(s.generations).toHaveLength(k)
      const g = s.generations.at(-1)!
      const last = s.history.at(-1)!
      expect(last.tick).toBe(s.tick)
      const season = s.history.filter((h) => h.tick > s.tick - SEASON).map((h) => h.population)
      expect(g).toEqual({
        tick: k * SEASON,
        population: last.population,
        children: last.children,
        adults: last.adults,
        elders: last.elders,
        peak: Math.max(...season),
        low: Math.min(...season),
        housed: last.housed,
        capacity: last.capacity,
        food: last.food,
        births: s.population.counters.births,
        deaths: s.population.counters.deaths,
        // v13: the same dawn's ecology census.
        bearing: s.ecoHistory.at(-1)!.bearing,
        nearBushes: s.ecoHistory.at(-1)!.nearBushes,
        held: s.activity.birthsHeldByLand,
      })
      expect(s.ecoHistory.at(-1)!.tick).toBe(s.tick)
      expect(g.children + g.adults + g.elders).toBe(g.population)
    }
  })

  it('per-season births and deaths are differences of the cumulative counts; the first season counts from 0', () => {
    const s = createWorld({ seed: 'generations-rows' })
    stepN(s, 4 * SEASON)
    const rows = getGenerations(s)
    expect(rows).toHaveLength(4)
    expect(rows[0]!.seasonBirths).toBe(rows[0]!.births)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.seasonBirths).toBe(rows[i]!.births - rows[i - 1]!.births)
      expect(rows[i]!.seasonDeaths).toBe(rows[i]!.deaths - rows[i - 1]!.deaths)
      expect(rows[i]!.net).toBe(rows[i]!.seasonBirths! - rows[i]!.seasonDeaths!)
    }
    expect(rows.reduce((n, r) => n + r.seasonBirths!, 0)).toBe(s.population.counters.births)
  })

  it('a world that started summarising mid-life shows no per-season figures for its first row (no invented data)', () => {
    const s = createWorld({ seed: 'generations-late' })
    stepN(s, 3 * SEASON)
    s.generations = s.generations.slice(1) // as if loaded after the first season
    const rows = getGenerations(s)
    expect(rows[0]).toMatchObject({ seasonBirths: null, seasonDeaths: null, net: null })
    expect(rows[1]!.seasonBirths).not.toBeNull()
  })

  it('is bounded at GENERATIONS_MAX (100 world years); the oldest are dropped', () => {
    const s = createWorld({ seed: 'generations-bound' })
    stepN(s, 2 * SEASON)
    const template = s.generations[0]!
    // A full record of GENERATIONS_MAX summaries before the next season (synthetic, increasing ticks).
    s.generations = Array.from({ length: GENERATIONS_MAX }, (_, i) => ({ ...template, tick: i + 1 }))
    stepN(s, SEASON)
    expect(s.generations).toHaveLength(GENERATIONS_MAX)
    expect(s.generations[0]!.tick).toBe(2) // the oldest one dropped
    expect(s.generations.at(-1)!.tick).toBe(3 * SEASON)
    expect(deserialize(serialize(s)).generations).toEqual(s.generations)
  })

  it('save/resume across a season boundary replays exactly', () => {
    const s = createWorld({ seed: 'generations-replay' })
    stepN(s, SEASON - 50)
    const resumed = deserialize(serialize(s))
    stepN(s, 100)
    stepN(resumed, 100)
    expect(serialize(resumed)).toBe(serialize(s))
    expect(resumed.generations).toHaveLength(1)
  })
})
