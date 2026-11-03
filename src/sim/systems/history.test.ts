import { describe, expect, it } from 'vitest'
import { HISTORY_INTERVAL, HISTORY_MAX, SHELTER_CAPACITY } from '../constants.ts'
import { getCivStats } from '../selectors.ts'
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
