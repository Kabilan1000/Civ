import { describe, expect, it } from 'vitest'
import { chance, nextFloat, nextInt, nextUint32, pick, seedRng, shuffle } from './rng.ts'

const draw = (seed: string, n: number) => {
  const s = seedRng(seed)
  return Array.from({ length: n }, () => nextUint32(s))
}

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draw('alpha', 100)).toEqual(draw('alpha', 100))
  })

  it('produces different sequences for different seeds', () => {
    expect(draw('alpha', 10)).not.toEqual(draw('beta', 10))
    expect(draw('a', 10)).not.toEqual(draw('b', 10))
  })

  it('is pinned to known values (guards against accidental algorithm changes)', () => {
    expect(seedRng('little-worlds')).toMatchInlineSnapshot(`
      [
        128946401,
        2646271039,
        412275887,
        3530127536,
      ]
    `)
    expect(draw('little-worlds', 3)).toMatchInlineSnapshot(`
      [
        2010377680,
        1300704293,
        723544262,
      ]
    `)
  })

  it('keeps state as four uint32 words that survive a JSON round-trip', () => {
    const s = seedRng('save-me')
    for (let i = 0; i < 37; i++) nextUint32(s)
    expect(s).toHaveLength(4)
    for (const w of s) expect(Number.isInteger(w) && w >= 0 && w <= 0xffffffff).toBe(true)

    const restored = JSON.parse(JSON.stringify(s)) as typeof s
    const a = Array.from({ length: 50 }, () => nextUint32(s))
    const b = Array.from({ length: 50 }, () => nextUint32(restored))
    expect(b).toEqual(a)
  })

  it('nextFloat stays in [0, 1)', () => {
    const s = seedRng('floats')
    for (let i = 0; i < 10_000; i++) {
      const f = nextFloat(s)
      expect(f >= 0 && f < 1).toBe(true)
    }
  })

  it('nextInt is inclusive, in range, and roughly uniform', () => {
    const s = seedRng('ints')
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 60_000; i++) {
      const v = nextInt(s, 1, 6)
      expect(v >= 1 && v <= 6).toBe(true)
      counts[v - 1]!++
    }
    for (const c of counts) expect(c).toBeGreaterThan(9_000)
    expect(nextInt(s, 4, 4)).toBe(4)
    expect(() => nextInt(s, 5, 4)).toThrow()
  })

  it('chance respects probability edges', () => {
    const s = seedRng('chance')
    expect(chance(s, 0)).toBe(false)
    expect(chance(s, 1)).toBe(true)
  })

  it('pick and shuffle are deterministic and shuffle is a permutation', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const a = shuffle(seedRng('shuf'), [...items])
    const b = shuffle(seedRng('shuf'), [...items])
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(items)
    expect(pick(seedRng('p'), items)).toBe(pick(seedRng('p'), items))
    expect(() => pick(seedRng('p'), [])).toThrow()
  })
})
