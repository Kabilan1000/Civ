import { describe, expect, it } from 'vitest'
import { deserialize, serialize } from '../serialize.ts'
import { createWorld, stepN } from '../world.ts'

function run(seed: string, ticks: number): string {
  const s = createWorld({ seed })
  stepN(s, ticks)
  return serialize(s)
}

describe('determinism', () => {
  it('saving and resuming at every point of a walk matches an uninterrupted run', () => {
    const straight = createWorld({ seed: 'walk-resume' })
    stepN(straight, 300)
    for (const at of [1, 2, 3, 7, 50, 151, 299]) {
      const a = createWorld({ seed: 'walk-resume' })
      stepN(a, at)
      const b = deserialize(serialize(a))
      stepN(b, 300 - at)
      expect(serialize(b)).toBe(serialize(straight))
    }
  })

  it('two runs with the same seed produce identical state after 5000 ticks', () => {
    expect(run('determinism', 5000)).toBe(run('determinism', 5000))
  })

  it('different seeds produce different state', () => {
    expect(run('seed-a', 1000)).not.toBe(run('seed-b', 1000))
  })

  it('citizens actually move, so determinism covers movement', () => {
    const start = createWorld({ seed: 'determinism' })
    const after = deserialize(run('determinism', 500))
    const moved = after.citizens.filter((c, i) => c.pos.x !== start.citizens[i]!.pos.x || c.pos.y !== start.citizens[i]!.pos.y)
    expect(moved.length).toBeGreaterThan(6)
  })

  it('save → load → continue equals an uninterrupted run', () => {
    const straight = createWorld({ seed: 'resume' })
    stepN(straight, 2000)

    const first = createWorld({ seed: 'resume' })
    stepN(first, 1000)
    // The save point must land mid-walk for this test to mean something.
    expect(first.citizens.some((c) => c.path.length > 0 && c.moveTicksLeft > 0)).toBe(true)
    const resumed = deserialize(serialize(first))
    stepN(resumed, 1000)

    expect(serialize(resumed)).toBe(serialize(straight))
  })

  it('a loaded world shares no references with the saved one', () => {
    const s = createWorld({ seed: 'isolation' })
    const copy = deserialize(serialize(s))
    expect(copy.rng).not.toBe(s.rng)
    expect(copy.citizens[0]).not.toBe(s.citizens[0])
    stepN(copy, 10)
    copy.citizens[0]!.pos.x += 1
    expect(s.tick).toBe(0)
    expect(s.citizens[0]!.pos).not.toEqual(copy.citizens[0]!.pos)
  })
})
