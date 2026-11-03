import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorldConfig } from '../sim/index.ts'
import { SimulationController, type SimulationSnapshot } from './SimulationController.ts'

/**
 * Create one SimulationController for the component's lifetime, run its loop
 * while mounted, and expose a throttled snapshot for rendering UI.
 */
export function useSimulation(config: Partial<WorldConfig> = {}): {
  controller: SimulationController
  snapshot: SimulationSnapshot
} {
  const [controller] = useState(() => new SimulationController(config))
  useEffect(() => {
    controller.start()
    return () => controller.stop()
  }, [controller])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { controller, snapshot }
}
