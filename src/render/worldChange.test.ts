import { describe, expect, it } from 'vitest'
import { createWorld, deserialize, serialize } from '../sim/index.ts'
import { WorldChangeTracker } from './worldChange.ts'

describe('WorldChangeTracker', () => {
  it('flags a different world even when its map.version equals the previous one', () => {
    const a = createWorld({ seed: 'a' })
    const b = createWorld({ seed: 'b' })
    expect(a.map.version).toBe(b.map.version) // the trap: version counters coincide
    const t = new WorldChangeTracker()
    expect(t.changed(a)).toBe(true)
    expect(t.changed(a)).toBe(false)
    expect(t.changed(b)).toBe(true)
    // A reloaded copy of the same save is still a new object → full refresh.
    const copy = deserialize(serialize(b))
    expect(t.changed(copy)).toBe(true)
  })
})
