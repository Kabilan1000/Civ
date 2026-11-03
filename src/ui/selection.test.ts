import { describe, expect, it } from 'vitest'
import { selectedIn } from './selection.ts'

describe('selection across worlds', () => {
  it('applies only to the world it was made in', () => {
    const sel = { worldId: 3, citizenId: 7 }
    expect(selectedIn(sel, 3)).toBe(7)
    expect(selectedIn(sel, 4)).toBeNull() // a loaded/restarted world resets it
    expect(selectedIn(null, 3)).toBeNull()
  })
})
