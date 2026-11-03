import { describe, expect, it } from 'vitest'
import { createWorld, getVisualPosition, serialize, step } from '../sim/index.ts'
import { fitWorld } from './layout.ts'
import { TILE_SIZE } from './palette.ts'
import { pickCitizen, screenToWorld, type RenderedCitizen } from './selection.ts'

const rendered = (state: ReturnType<typeof createWorld>, alpha: number): RenderedCitizen[] =>
  state.citizens
    .filter((c) => c.alive)
    .map((c) => {
      const p = getVisualPosition(state, c, alpha)
      return { id: c.id, x: p.x * TILE_SIZE + TILE_SIZE / 2, y: p.y * TILE_SIZE + TILE_SIZE / 2 }
    })

describe('citizen picking', () => {
  it('maps screen to world through the current fit', () => {
    const fit = fitWorld(432, 576, 864, 576) // scale 0.5, y offset 144
    expect(screenToWorld(fit, 216, 288)).toEqual({ x: 432, y: 288 })
  })

  it('picks the nearest citizen within the radius, or nothing', () => {
    const list = [{ id: 1, x: 100, y: 100 }, { id: 2, x: 110, y: 100 }]
    expect(pickCitizen(list, 103, 100, 9)).toBe(1)
    expect(pickCitizen(list, 108, 100, 9)).toBe(2)
    expect(pickCitizen(list, 300, 300, 9)).toBeNull()
    expect(pickCitizen([], 0, 0, 9)).toBeNull()
  })

  it('finds a citizen at its interpolated position while it moves, without touching the world', () => {
    const s = createWorld({ seed: 'pick' })
    let checked = 0
    for (let t = 0; t < 300; t++) {
      step(s)
      const before = serialize(s)
      for (const alpha of [0, 0.5, 0.9]) {
        const list = rendered(s, alpha)
        for (const c of s.citizens) {
          if (c.path.length === 0) continue
          const p = getVisualPosition(s, c, alpha)
          const at = { x: p.x * TILE_SIZE + TILE_SIZE / 2, y: p.y * TILE_SIZE + TILE_SIZE / 2 }
          const picked = pickCitizen(list, at.x, at.y, 1)
          // Another citizen may be drawn exactly there too; the picked one must be at that spot.
          const hit = list.find((r) => r.id === picked)!
          expect(Math.hypot(hit.x - at.x, hit.y - at.y)).toBeLessThanOrEqual(1)
          checked++
        }
      }
      expect(serialize(s)).toBe(before) // picking never mutates the simulation
    }
    expect(checked).toBeGreaterThan(200)
  })
})
