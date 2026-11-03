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
  getCivStats,
  getClockTime,
  getDayNumber,
  getDayPhase,
  stepN,
  type CivStats,
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
  /** Read-only village figures (sim selector getCivStats). */
  stats: CivStats
  /** Id of the newest stored event (changes only when events are added). */
  lastEventId: number
  /** Number of history samples (changes only when a sample is recorded). */
  historyLength: number
  /** Increments whenever the world object is replaced (load / restart). */
  worldId: number
  seed: string
  /** True when the world has advanced since it was created, loaded or last saved. */
  unsaved: boolean
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
  private worldId = 1
  /** Tick at which the current world was last saved, loaded or created. */
  private savedTick = 0

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

  /**
   * Replace the running world with `next` (already validated/deserialized).
   * Atomic: one assignment, so there is never a half-replaced world. Pauses
   * (the user presses Play to resume), resets the timing accumulator and
   * bumps worldId so the renderer and UI rebuild everything. The frame loop
   * is untouched — no second loop is ever started.
   */
  loadWorld(next: WorldState): void {
    this.world = next
    this.worldId++
    this.savedTick = next.tick
    this.paused = true
    this.accumulatorMs = 0
    this.renderer?.render(this.world, 0)
    this.publish()
  }

  /** Start a fresh world from a seed (same seed ⇒ identical world). Paused until Play. */
  restart(config: Partial<WorldConfig>): void {
    this.loadWorld(createWorld(config))
  }

  /** Record that the current world was saved at its current tick (clears "unsaved"). */
  markSaved(): void {
    this.savedTick = this.world.tick
    this.publish()
  }

  get currentWorldId(): number {
    return this.worldId
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
      stats: getCivStats(this.world),
      lastEventId: this.world.events.at(-1)?.id ?? 0,
      historyLength: this.world.history.length,
      worldId: this.worldId,
      seed: this.world.config.seed,
      unsaved: this.world.tick !== this.savedTick,
    }
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const l of this.listeners) l()
  }
}
