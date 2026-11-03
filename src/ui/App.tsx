import type { ReactNode } from 'react'
import { useSimulation } from '../app/useSimulation.ts'
import { Controls } from './components/Controls.tsx'
import { MapView } from './components/MapView.tsx'

export default function App() {
  const { controller, snapshot } = useSimulation()
  const { width, height } = controller.state.config

  return (
    <div className="app">
      <header className="topbar">
        <h1>Little Worlds</h1>
        <Controls controller={controller} snapshot={snapshot} />
      </header>

      <main className="layout">
        <MapView controller={controller} aspect={`${width} / ${height}`} />

        <aside className="sidebar">
          <Panel title="Civilization">
            <span data-testid="stockpile">
              Population {snapshot.population} · Housed {snapshot.housed} · Shelters {snapshot.shelters}
              <br />
              Food {snapshot.food} · Wood {snapshot.wood}
              <br />
              Explored {snapshot.explored}% · Social {snapshot.social} · Friendships {snapshot.friendships}
            </span>
            <br />
            Full dashboard arrives in M7.
          </Panel>
          <Panel title="Citizen">Citizen inspector arrives in M7.</Panel>
          <Panel title="Events">Event feed arrives in M7.</Panel>
        </aside>
      </main>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="muted">{children}</p>
    </section>
  )
}
