import type { ReactNode } from 'react'
import { DEFAULT_WORLD_CONFIG, SPEEDS, TICKS_PER_DAY } from '../sim/index.ts'

const TILE_SIZE = 24

// M0 application shell: static layout only. Live data arrives with the
// SimulationController (M3) and the panels (M7).
export default function App() {
  const { width, height, citizenCount, seed } = DEFAULT_WORLD_CONFIG

  return (
    <div className="app">
      <header className="topbar">
        <h1>Little Worlds</h1>
        <div className="controls" aria-label="Simulation controls">
          <button disabled>Pause</button>
          {SPEEDS.map((s) => (
            <button key={s} disabled>
              {s}x
            </button>
          ))}
          <input aria-label="Seed" defaultValue={seed} disabled />
          <button disabled>Restart</button>
          <button disabled>Save</button>
          <button disabled>Load</button>
        </div>
      </header>

      <main className="layout">
        <section
          className="map"
          style={{ aspectRatio: `${width * TILE_SIZE} / ${height * TILE_SIZE}` }}
          aria-label="World map"
        >
          <p>
            {width}×{height} world · {citizenCount} citizens · {TICKS_PER_DAY} ticks per day
          </p>
          <p className="muted">Map renderer arrives in M3.</p>
        </section>

        <aside className="sidebar">
          <Panel title="Civilization">Dashboard arrives in M7.</Panel>
          <Panel title="Citizen">Select a citizen to inspect them.</Panel>
          <Panel title="Events">No events yet.</Panel>
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
