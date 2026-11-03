import { describe, expect, it } from 'vitest'
import { fitWorld } from './layout.ts'

describe('fitWorld', () => {
  it('fits by the limiting dimension and centres the world', () => {
    expect(fitWorld(864, 576, 864, 576)).toEqual({ scale: 1, x: 0, y: 0 })
    expect(fitWorld(432, 576, 864, 576)).toEqual({ scale: 0.5, x: 0, y: 144 })
    expect(fitWorld(2000, 576, 864, 576)).toEqual({ scale: 1, x: 568, y: 0 })
  })

  it('is safe for zero-size viewports', () => {
    expect(fitWorld(0, 0, 864, 576)).toEqual({ scale: 1, x: 0, y: 0 })
  })
})
