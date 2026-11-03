// Owns the running world and the real-time loop. Plain TypeScript, no React.
//
// Loop: one requestAnimationFrame chain drives both simulation and rendering.
// Each frame adds elapsed real time to an accumulator and runs as many whole
// ticks as fit (fixed timestep), then renders with `alpha` = the fraction of
// the next tick already elapsed, for smooth interpolation. Rendering never
// advances the simulation.
//
// Spike protection: a single frame counts at most MAX_FRAME_MS of real time
// and runs at most MAX_TICKS_PER_FRAME ticks; any excess is dropped (the
// simulation slows down instead of freezing the tab after a long stall).

import {
  BASE_TICKS_PER_SECOND,
  createWorld,
  getClockTime,
  getDayNumber,
  getDayPhase,
  stepN,
  type DayPhase,
  type Speed,
  type WorldConfig,
  type WorldState,
} from '../sim/index.ts'

export const MAX_FRAME_MS = 250
export const MAX_TICKS_PER_FRAME = 20
/** React-facing snapshots are published at most this often while running. */
export const SNAPSHOT_INTERVAL_MS = 200

export interface FrameScheduler {
  request(cb: (time: number) => void): number
  cancel(id: number): void
  now(): number
}

export const browserScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
}

/** Anything that can draw the world; implemented by render/WorldRenderer. */
export interface FrameRenderer {
  render(state: WorldState, alpha: number): void
}

export interface SimulationSnapshot {
  tick: number
  day: number
  hour: number
  minute: number
  phase: DayPhase
  paused: boolean
  speed: Speed
  food: number
  wood: number
}

export class SimulationController {
  private world: WorldState
  private speed: Speed = 1
  private paused = false
  private frameId: number | null = null
  private lastFrameTime = 0
  private accumulatorMs = 0
  private lastSnapshotTime = -Infinity
  private renderer: FrameRenderer | null = null
  private readonly listeners = new Set<() => void>()
  private snapshot: SimulationSnapshot
  private readonly scheduler: FrameScheduler

  constructor(config: Partial<WorldConfig> = {}, scheduler: FrameScheduler = browserScheduler) {
    this.scheduler = scheduler
    this.world = createWorld(config)
    this.snapshot = this.buildSnapshot()
  }

  get state(): WorldState {
    return this.world
  }

  get isRunning(): boolean {
    return this.frameId !== null
  }

  /** Start the loop. Calling start() while running is a no-op (never two loops). */
  start(): void {
    if (this.frameId !== null) return
    this.lastFrameTime = this.scheduler.now()
    this.accumulatorMs = 0
    this.frameId = this.scheduler.request(this.frame)
  }

  /** Stop the loop and cancel the pending frame. Safe to call repeatedly. */
  stop(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId)
    this.frameId = null
  }

  /** Stop and drop all external references. */
  dispose(): void {
    this.stop()
    this.renderer = null
    this.listeners.clear()
  }

  setRenderer(renderer: FrameRenderer | null): void {
    this.renderer = renderer
    renderer?.render(this.world, this.alpha)
  }

  /** Detach `renderer` only if it is the current one (safe for overlapping React effects). */
  detachRenderer(renderer: FrameRenderer): void {
    if (this.renderer === renderer) this.renderer = null
  }

  setSpeed(speed: Speed): void {
    if (speed === this.speed) return
    this.speed = speed
    this.publish()
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    this.accumulatorMs = 0
    this.publish()
  }

  togglePause(): void {
    this.setPaused(!this.paused)
  }

  get msPerTick(): number {
    return 1000 / (BASE_TICKS_PER_SECOND * this.speed)
  }

  /** Advance by `elapsedMs` of real time; returns ticks run. Exposed for tests. */
  advance(elapsedMs: number): number {
    if (this.paused) return 0
    this.accumulatorMs += Math.min(Math.max(0, elapsedMs), MAX_FRAME_MS)
    let ticks = Math.floor(this.accumulatorMs / this.msPerTick)
    if (ticks > MAX_TICKS_PER_FRAME) {
      ticks = MAX_TICKS_PER_FRAME
      this.accumulatorMs = 0 // drop the backlog instead of spiralling
    } else {
      this.accumulatorMs -= ticks * this.msPerTick
    }
    if (ticks > 0) stepN(this.world, ticks)
    return ticks
  }

  /** Fraction of the next tick already elapsed, in [0, 1). */
  get alpha(): number {
    return this.paused ? 0 : Math.min(this.accumulatorMs / this.msPerTick, 0.999)
  }

  private readonly frame = (time: number): void => {
    if (this.frameId === null) return // stopped between scheduling and firing
    const elapsed = time - this.lastFrameTime
    this.lastFrameTime = time
    const ticks = this.advance(elapsed)
    this.renderer?.render(this.world, this.alpha)
    if (ticks > 0 && time - this.lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotTime = time
      this.publish()
    }
    this.frameId = this.scheduler.request(this.frame)
  }

  // ── React bridge (useSyncExternalStore) ──────────────────────────────────

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Stable between publishes, as useSyncExternalStore requires. */
  readonly getSnapshot = (): SimulationSnapshot => this.snapshot

  private buildSnapshot(): SimulationSnapshot {
    const { hour, minute } = getClockTime(this.world)
    return {
      tick: this.world.tick,
      day: getDayNumber(this.world),
      hour,
      minute,
      phase: getDayPhase(this.world),
      paused: this.paused,
      speed: this.speed,
      food: this.world.stockpile.food,
      wood: this.world.stockpile.wood,
    }
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const l of this.listeners) l()
  }
}
