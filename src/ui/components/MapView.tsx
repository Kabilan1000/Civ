import { useEffect, useRef } from 'react'
import type { SimulationController } from '../../app/SimulationController.ts'
import type { WorldRenderer } from '../../render/WorldRenderer.ts'

export function MapView({ controller, aspect }: { controller: SimulationController; aspect: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    // PixiJS is code-split: the renderer module loads on first mount.
    const mount: { renderer: WorldRenderer | null; unmounted: boolean } = { renderer: null, unmounted: false }
    import('../../render/WorldRenderer.ts')
      .then(async ({ WorldRenderer }) => {
        if (mount.unmounted) return
        const r = new WorldRenderer(host)
        mount.renderer = r
        const ready = await r.init()
        // A StrictMode/unmount cleanup may have destroyed it while initialising.
        if (ready && !r.isDestroyed) controller.setRenderer(r)
      })
      .catch((err: unknown) => console.error('Renderer failed to initialise', err))
    return () => {
      mount.unmounted = true
      if (mount.renderer) {
        controller.detachRenderer(mount.renderer)
        mount.renderer.destroy()
      }
    }
  }, [controller])

  return <section ref={ref} className="map" style={{ aspectRatio: aspect }} aria-label="World map" />
}
