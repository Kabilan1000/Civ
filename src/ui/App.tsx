import { useCallback, useEffect, useState } from 'react'
import { useSimulation } from '../app/useSimulation.ts'
import { Controls } from './components/Controls.tsx'
import { Dashboard } from './components/Dashboard.tsx'
import { EventFeed } from './components/EventFeed.tsx'
import { HistoryCharts } from './components/HistoryCharts.tsx'
import { Inspector } from './components/Inspector.tsx'
import { MapView } from './components/MapView.tsx'

export default function App() {
  const { controller, snapshot } = useSimulation()
  const { width, height } = controller.state.config
  // UI-only state: which citizen is inspected. Never stored in the simulation.
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const select = useCallback((id: number | null) => setSelectedId(id), [])

  // Dev-only handle for automated browser checks (stripped from production builds).
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __littleWorlds?: unknown }).__littleWorlds = controller
  }, [controller])

  return (
    <div className="app">
      <header className="topbar">
        <h1>Little Worlds</h1>
        <Controls controller={controller} snapshot={snapshot} />
      </header>

      <main className="layout">
        <div className="world-col">
          <MapView controller={controller} aspect={`${width} / ${height}`} selectedId={selectedId} onSelect={select} />
          <div className="below-map">
            <EventFeed controller={controller} snapshot={snapshot} onSelect={select} />
            <HistoryCharts controller={controller} snapshot={snapshot} />
          </div>
        </div>
        <aside className="sidebar">
          <Dashboard snapshot={snapshot} />
          <Inspector controller={controller} snapshot={snapshot} selectedId={selectedId} onSelect={select} />
        </aside>
      </main>
    </div>
  )
}
