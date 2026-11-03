// Detects that the renderer has been handed a different world (load or
// restart). Keyed on object identity — NOT map.version, which restarts from
// similar small numbers in every world, so two worlds can share a version.

export class WorldChangeTracker<T extends object> {
  private current: T | null = null

  /** True when `world` is not the world seen last time (the first call is a change). */
  changed(world: T): boolean {
    if (world === this.current) return false
    this.current = world
    return true
  }

  reset(): void {
    this.current = null
  }
}
