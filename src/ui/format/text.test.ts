import { describe, expect, it } from 'vitest'
import { createWorld, explainDecision, getEvents, stepN, type SimEvent } from '../../sim/index.ts'
import { describeEvent, explainText, formatTick, segmentsToText } from './text.ts'

describe('presentation text', () => {
  it('formats ticks with the sim clock (tick 0 = Day 1 06:00)', () => {
    expect(formatTick(0)).toBe('Day 1 · 06:00')
    expect(formatTick(240 + 10)).toBe('Day 2 · 07:00')
  })

  it('describes every stored event of a real run, keeping citizens as references', () => {
    const s = createWorld({ seed: 'event-text' })
    stepN(s, 240 * 5)
    const nameOf = (id: number) => s.citizens.find((c) => c.id === id)!.name
    const events = getEvents(s)
    expect(events.length).toBeGreaterThan(10)
    for (const e of events) {
      const segments = describeEvent(e, nameOf)
      const text = segmentsToText(segments)
      expect(text.length).toBeGreaterThan(5)
      expect(text).not.toMatch(/undefined|NaN/)
      const refs = segments.filter((x) => typeof x !== 'string') as { citizenId: number }[]
      for (const r of refs) expect(e.citizenIds).toContain(r.citizenId) // only real participants
    }
  })

  it('keeps direction in relationship events', () => {
    const e: SimEvent = { id: 1, tick: 0, kind: 'friendship', citizenIds: [7, 9] }
    expect(segmentsToText(describeEvent(e, (id) => (id === 7 ? 'Mira' : 'Theo')))).toBe('Mira now counts Theo as a friend.')
  })

  it('explains decisions only from recorded data', () => {
    const s = createWorld({ seed: 'why' })
    stepN(s, 400)
    for (const c of s.citizens) {
      const x = explainDecision(s, c.id)!
      const lines = explainText(x)
      expect(lines.length).toBeGreaterThan(0)
      if (x.chosen) expect(lines[0]).toContain(x.chosen.score.toFixed(2))
    }
    expect(explainText({ decidedTick: null, chosen: null, runnerUp: null, current: null, currentScore: null, persisted: false, fellBack: false, recruited: false, recruitedBy: null, impossible: [] })[0]).toMatch(/No decision/)
  })
})
