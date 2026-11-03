import { describe, expect, it } from 'vitest'
import { MAX_EVENTS } from './constants.ts'
import { pushEvent } from './events.ts'
import { createWorld } from './world.ts'

describe('events', () => {
  it('stamps events with the current tick and unique ids', () => {
    const state = createWorld()
    state.tick = 42
    const a = pushEvent(state, 'chat', [2, 3])
    const b = pushEvent(state, 'argument', [3, 2], { reason: 'hungry' })
    expect(a.tick).toBe(42)
    expect(b.id).toBe(a.id + 1)
    expect(b.data).toEqual({ reason: 'hungry' })
    expect('data' in a).toBe(false)
  })

  it(`keeps at most ${MAX_EVENTS} events, dropping the oldest`, () => {
    const state = createWorld()
    for (let i = 0; i < MAX_EVENTS + 50; i++) pushEvent(state, 'chat', [], { i })
    expect(state.events).toHaveLength(MAX_EVENTS)
    expect(state.events.at(-1)!.data).toEqual({ i: MAX_EVENTS + 49 })
    expect(state.events[0]!.data).toEqual({ i: 50 })
  })
})
