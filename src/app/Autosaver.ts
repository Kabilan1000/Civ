// Autosave: writes the running world to the dedicated 'autosave' slot —
// never a manual slot — after every AUTOSAVE_INTERVAL_MS of *running*
// (unpaused) real time, and only if the world has advanced since the last
// autosave. A check runs every CHECK_MS; a `busy` flag prevents overlapping
// saves. Failures are reported to listeners and never stop the simulation.
//
// Best effort on tab close: a 'pagehide' attempt is made, but browsers may
// not finish it, so nothing relies on it.

import { AUTOSAVE_SLOT, type SaveStore, type StoreFailure } from '../persistence/storage.ts'
import type { SimulationController } from './SimulationController.ts'

export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000
export const CHECK_MS = 10 * 1000

export interface AutosaveStatus {
  /** Browser time of the last successful autosave (UI only). */
  lastSavedAt: Date | null
  lastSavedTick: number | null
  lastError: StoreFailure | null
}

export interface TimerApi {
  setInterval(cb: () => void, ms: number): number
  clearInterval(id: number): void
  now(): Date
}

export const browserTimers: TimerApi = {
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: (id) => window.clearInterval(id),
  now: () => new Date(),
}

export class Autosaver {
  private readonly controller: SimulationController
  private readonly store: SaveStore
  private readonly timers: TimerApi
  private readonly intervalMs: number
  private timer: number | null = null
  private runningMs = 0
  private busy = false
  private lastWorldId = -1
  private lastTick = -1
  private status: AutosaveStatus = { lastSavedAt: null, lastSavedTick: null, lastError: null }
  private readonly listeners = new Set<() => void>()

  constructor(controller: SimulationController, store: SaveStore, timers: TimerApi = browserTimers, intervalMs = AUTOSAVE_INTERVAL_MS) {
    this.controller = controller
    this.store = store
    this.timers = timers
    this.intervalMs = intervalMs
  }

  /** Start periodic checks. Idempotent (never two timers). */
  start(): void {
    if (this.timer !== null) return
    this.timer = this.timers.setInterval(() => this.check(), CHECK_MS)
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer)
    this.timer = null
  }

  get isRunning(): boolean {
    return this.timer !== null
  }

  /** One periodic check (exposed for tests). */
  check(): void {
    if (this.controller.getSnapshot().paused || !this.controller.isRunning) return
    this.runningMs += CHECK_MS
    if (this.runningMs >= this.intervalMs) {
      this.runningMs = 0
      this.saveNow()
    }
  }

  /** Save immediately if the world advanced since the last autosave. Returns true if written. */
  saveNow(): boolean {
    if (this.busy) return false
    const state = this.controller.state
    const worldId = this.controller.currentWorldId
    if (worldId === this.lastWorldId && state.tick === this.lastTick) return false
    this.busy = true
    try {
      const result = this.store.save(AUTOSAVE_SLOT, state, this.timers.now())
      if (result.ok) {
        this.lastWorldId = worldId
        this.lastTick = state.tick
        this.status = { lastSavedAt: this.timers.now(), lastSavedTick: state.tick, lastError: null }
      } else {
        this.status = { ...this.status, lastError: result }
      }
      for (const l of this.listeners) l()
      return result.ok
    } finally {
      this.busy = false
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getStatus = (): AutosaveStatus => this.status
}
