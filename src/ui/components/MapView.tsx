import { useEffect, useRef } from 'react'
import type { SimulationController } from '../../app/SimulationController.ts'
import { WorldRenderer } from '../../render/WorldRenderer.ts'

export function MapView({ controller, aspect }: { controller: SimulationController; aspect: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    const renderer = new WorldRenderer(host)
    renderer
      .init()
      .then((ready) => {
        // A StrictMode/unmount cleanup may have destroyed it while initialising.
        if (ready && !renderer.isDestroyed) controller.setRenderer(renderer)
      })
      .catch((err: unknown) => console.error('Renderer failed to initialise', err))
    return () => {
      controller.detachRenderer(renderer)
      renderer.destroy()
    }
  }, [controller])

  return <section ref={ref} className="map" style={{ aspectRatio: aspect }} aria-label="World map" />
}
