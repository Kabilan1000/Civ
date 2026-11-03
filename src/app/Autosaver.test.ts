import { describe, expect, it } from 'vitest'
import { AUTOSAVE_SLOT, KEY_PREFIX, SaveStore, type StorageLike } from '../persistence/storage.ts'
import { AUTOSAVE_INTERVAL_MS, Autosaver, CHECK_MS, type TimerApi } from './Autosaver.ts'
import { SimulationController, type FrameScheduler } from './SimulationController.ts'

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>()
  fail = false
  writes: string[] = []
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) {
    if (this.fail) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e }
    this.writes.push(k)
    this.data.set(k, v)
  }
  removeItem(k: string) { this.data.delete(k) }
}

function setup() {
  let frame = 1
  const frames = new Map<number, (t: number) => void>()
  let time = 0
  const scheduler: FrameScheduler = {
    request: (cb) => { frames.set(frame, cb); return frame++ },
    cancel: (id) => void frames.delete(id),
    now: () => time,
  }
  const runFor = (ms: number) => {
    for (let t = 0; t < ms; t += 20) {
      time += 20
      const cbs = [...frames.values()]
      frames.clear()
      for (const cb of cbs) cb(time)
    }
  }
  const controller = new SimulationController({ seed: 'autosave' }, scheduler)
  const mem = new MemoryStorage()
  const store = new SaveStore(mem)
  let interval: (() => void) | null = null
  const timers: TimerApi = {
    setInterval: (cb) => { interval = cb; return 1 },
    clearInterval: () => { interval = null },
    now: () => new Date(1_700_000_000_000),
  }
  const autosaver = new Autosaver(controller, store, timers)
  const elapse = (ms: number) => {
    for (let t = 0; t < ms; t += CHECK_MS) {
      runFor(CHECK_MS) // the simulation advances in real time too
      interval?.()
    }
  }
  return { controller, mem, store, autosaver, elapse }
}

describe('Autosaver', () => {
  it('saves to the autosave slot after 5 minutes of running time, never to manual slots', () => {
    const { controller, mem, autosaver, elapse } = setup()
    controller.start()
    autosaver.start()
    elapse(AUTOSAVE_INTERVAL_MS - CHECK_MS)
    expect(mem.writes).toEqual([])
    elapse(CHECK_MS)
    expect(mem.writes).toEqual([KEY_PREFIX + AUTOSAVE_SLOT])
    elapse(AUTOSAVE_INTERVAL_MS)
    expect(mem.writes.every((k) => k === KEY_PREFIX + AUTOSAVE_SLOT)).toBe(true)
    expect(mem.writes).toHaveLength(2)
    expect(autosaver.getStatus().lastSavedTick).toBe(controller.state.tick)
  })

  it('does not count paused time and skips when the world has not advanced', () => {
    const { controller, mem, autosaver, elapse } = setup()
    controller.start()
    autosaver.start()
    controller.setPaused(true)
    elapse(AUTOSAVE_INTERVAL_MS * 3)
    expect(mem.writes).toEqual([])
    expect(autosaver.saveNow()).toBe(true)
    expect(autosaver.saveNow()).toBe(false) // same world, same tick: nothing new to save
    expect(mem.writes).toHaveLength(1)
  })

  it('reports failures without stopping the simulation', () => {
    const { controller, mem, autosaver, elapse } = setup()
    controller.start()
    autosaver.start()
    mem.fail = true
    let notified = 0
    autosaver.subscribe(() => notified++)
    elapse(AUTOSAVE_INTERVAL_MS)
    expect(autosaver.getStatus().lastError).toMatchObject({ code: 'quota' })
    expect(notified).toBe(1)
    const tick = controller.state.tick
    elapse(CHECK_MS)
    expect(controller.state.tick).toBeGreaterThan(tick)
    expect(controller.isRunning).toBe(true)
  })

  it('never runs two timers', () => {
    const { autosaver } = setup()
    autosaver.start()
    autosaver.start()
    expect(autosaver.isRunning).toBe(true)
    autosaver.stop()
    expect(autosaver.isRunning).toBe(false)
  })

  it('saves a newly loaded world even at the same tick number', () => {
    const { controller, autosaver, store } = setup()
    expect(autosaver.saveNow()).toBe(true)
    controller.restart({ seed: 'other' }) // tick 0 again, but a different world
    expect(autosaver.saveNow()).toBe(true)
    const r = store.load(AUTOSAVE_SLOT)
    expect(r.ok && r.value.meta.seed).toBe('other')
  })
})
