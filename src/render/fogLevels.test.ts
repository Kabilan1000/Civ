import { describe, expect, it } from 'vitest'
import { FOG_ALPHA, remembersAt, spriteView } from './fogLevels.ts'

describe('fog levels', () => {
  it('get steadily thicker from observed to stale, with unknown land the darkest', () => {
    for (let i = 1; i < FOG_ALPHA.length; i++) expect(FOG_ALPHA[i]).toBeGreaterThan(FOG_ALPHA[i - 1]!)
    expect(FOG_ALPHA[0]).toBe(0)
  })

  it('stale land shows what was last seen; fresher land shows the real state', () => {
    expect(spriteView(5, 'b:old:2', 'b:mature:6')).toEqual({ key: 'b:mature:6', alpha: 1 - FOG_ALPHA[5]! })
    expect(spriteView(5, null, 'b:mature:6').key).toBe('b:mature:6') // died unseen: still remembered
    expect(spriteView(5, 'b:seedling:0', null).key).toBeNull() // sprouted unseen: not shown yet
    expect(spriteView(5, 'b:mature:3', undefined).key).toBe('b:mature:3') // nothing remembered: real state
    expect(spriteView(3, 'b:old:2', 'b:mature:6').key).toBe('b:old:2')
    expect(remembersAt(4)).toBe(true)
    expect(remembersAt(5)).toBe(false)
  })
})
