import { describe, expect, it } from 'vitest'
import { createWorld, deserialize, serialize, stepN } from '../sim/index.ts'
import { MAX_TICKS_PER_FRAME, SimulationController, type FrameScheduler } from './SimulationController.ts'

/** Manual frame scheduler: frames fire only when the test calls runFrame(). */
function fakeScheduler() {
  let nextId = 1
  let time = 0
  const pending = new Map<number, (t: number) => void>()
  const scheduler: FrameScheduler = {
    request: (cb) => {
      pending.set(nextId, cb)
      return nextId++
    },
    cancel: (id) => void pending.delete(id),
    now: () => time,
  }
  return {
    scheduler,
    pending,
    runFrame(dt: number) {
      time += dt
      const callbacks = [...pending.values()]
      pending.clear()
      for (const cb of callbacks) cb(time)
    },
    runFor(ms: number, frameMs = 20) {
      for (let t = 0; t < ms - 1e-9; t += frameMs) this.runFrame(frameMs)
    },
  }
}

const make = () => {
  const fake = fakeScheduler()
  const ctrl = new SimulationController({ seed: 'controller' }, fake.scheduler)
  return { fake, ctrl }
}

describe('SimulationController', () => {
  it.each([
    [1, 5],
    [3, 15],
    [10, 50],
    [100, 500],
  ] as const)('runs %ix speed at %i ticks per second', (speed, perSecond) => {
    const { fake, ctrl } = make()
    ctrl.setSpeed(speed)
    ctrl.start()
    fake.runFor(10_000)
    expect(Math.abs(ctrl.state.tick - perSecond * 10)).toBeLessThanOrEqual(1)
  })

  it('never runs two loops: start() is idempotent', () => {
    const { fake, ctrl } = make()
    ctrl.start()
    ctrl.start()
    ctrl.start()
    expect(fake.pending.size).toBe(1)
    fake.runFor(1000)
    expect(fake.pending.size).toBe(1)
    expect(ctrl.state.tick).toBe(5)
  })

  it('stop() cancels the loop and it can restart cleanly', () => {
    const { fake, ctrl } = make()
    ctrl.start()
    fake.runFor(1000)
    ctrl.stop()
    ctrl.stop()
    expect(fake.pending.size).toBe(0)
    expect(ctrl.isRunning).toBe(false)
    fake.runFor(1000)
    expect(ctrl.state.tick).toBe(5)
    ctrl.start()
    expect(fake.pending.size).toBe(1)
  })

  it('pause halts ticks but keeps rendering; resume continues', () => {
    const { fake, ctrl } = make()
    let renders = 0
    ctrl.setRenderer({ render: () => void renders++ })
    ctrl.start()
    fake.runFor(1000)
    ctrl.togglePause()
    const tick = ctrl.state.tick
    const rendersBefore = renders
    fake.runFor(2000)
    expect(ctrl.state.tick).toBe(tick)
    expect(renders).toBeGreaterThan(rendersBefore)
    ctrl.togglePause()
    fake.runFor(1000)
    expect(ctrl.state.tick).toBe(tick + 5)
  })

  it('caps work after a long stall instead of spiking', () => {
    const { fake, ctrl } = make()
    ctrl.setSpeed(10)
    ctrl.start()
    fake.runFrame(16)
    const before = ctrl.state.tick
    fake.runFrame(60_000) // tab was in the background for a minute
    expect(ctrl.state.tick - before).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME)
    expect(ctrl.advance(1e9)).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME)
  })

  it('renders with alpha in [0, 1) and never steps from render', () => {
    const { fake, ctrl } = make()
    const alphas: number[] = []
    ctrl.setRenderer({ render: (_s, a) => void alphas.push(a) })
    ctrl.start()
    fake.runFor(500)
    expect(alphas.length).toBeGreaterThan(20)
    for (const a of alphas) expect(a >= 0 && a < 1).toBe(true)
  })

  it('publishes stable snapshots, throttled, and on control changes', () => {
    const { fake, ctrl } = make()
    let notified = 0
    const unsubscribe = ctrl.subscribe(() => void notified++)
    const first = ctrl.getSnapshot()
    expect(ctrl.getSnapshot()).toBe(first)
    expect(first).toMatchObject({ tick: 0, day: 1, hour: 6, minute: 0, paused: false, speed: 1 })

    ctrl.start()
    fake.runFor(1000)
    expect(notified).toBeGreaterThan(0)
    expect(notified).toBeLessThanOrEqual(6) // ≈5 Hz, not every frame
    expect(ctrl.getSnapshot().tick).toBeGreaterThan(0)

    const n = notified
    ctrl.setSpeed(3)
    ctrl.setPaused(true)
    expect(notified).toBe(n + 2)
    expect(ctrl.getSnapshot()).toMatchObject({ speed: 3, paused: true })

    unsubscribe()
    ctrl.setPaused(false)
    expect(notified).toBe(n + 2)
  })

  it('dispose() stops the loop and drops listeners and renderer', () => {
    const { fake, ctrl } = make()
    let renders = 0
    ctrl.setRenderer({ render: () => void renders++ })
    ctrl.subscribe(() => {})
    ctrl.start()
    ctrl.dispose()
    const r = renders
    fake.runFor(500)
    expect(fake.pending.size).toBe(0)
    expect(renders).toBe(r)
  })

  it('restart with the same seed recreates the same world; different seeds differ', () => {
    const { fake, ctrl } = make()
    ctrl.restart({ seed: 'again' })
    const first = serialize(ctrl.state)
    ctrl.start()
    ctrl.setPaused(false)
    fake.runFor(2000)
    ctrl.restart({ seed: 'again' })
    expect(serialize(ctrl.state)).toBe(first)
    expect(ctrl.state.tick).toBe(0)
    ctrl.restart({ seed: 'something else' })
    expect(serialize(ctrl.state)).not.toBe(first)
  })

  it('loading replaces the world atomically, pauses, bumps worldId and keeps one loop', () => {
    const { fake, ctrl } = make()
    const renders: unknown[] = []
    ctrl.setRenderer({ render: (s) => void renders.push(s) })
    ctrl.start()
    fake.runFor(1000)
    const saved = createWorld({ seed: 'saved' })
    stepN(saved, 333)
    const incoming = deserialize(serialize(saved))
    const id = ctrl.getSnapshot().worldId

    ctrl.loadWorld(incoming)
    expect(ctrl.state).toBe(incoming)
    expect(ctrl.getSnapshot()).toMatchObject({ paused: true, worldId: id + 1, seed: 'saved', tick: 333, unsaved: false })
    expect(renders.at(-1)).toBe(incoming) // the renderer is handed the new world immediately
    expect(fake.pending.size).toBe(1) // still exactly one frame loop

    fake.runFor(1000)
    expect(ctrl.state.tick).toBe(333) // paused until Play
    ctrl.togglePause()
    fake.runFor(1000)
    expect(ctrl.state.tick).toBe(338)
    expect(fake.pending.size).toBe(1)
    // The loaded world continues exactly as the original would.
    stepN(saved, 5)
    expect(serialize(ctrl.state)).toBe(serialize(saved))
  })

  it('tracks unsaved progress', () => {
    const { fake, ctrl } = make()
    expect(ctrl.getSnapshot().unsaved).toBe(false)
    ctrl.start()
    fake.runFor(1000)
    expect(ctrl.getSnapshot().unsaved).toBe(true)
    ctrl.markSaved()
    expect(ctrl.getSnapshot().unsaved).toBe(false)
    ctrl.restart({ seed: 'fresh' })
    expect(ctrl.getSnapshot().unsaved).toBe(false)
  })
})
