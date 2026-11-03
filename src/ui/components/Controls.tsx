import type { SimulationController, SimulationSnapshot } from '../../app/SimulationController.ts'
import { SPEEDS } from '../../sim/index.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const PHASE_LABEL = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' } as const

export function Controls({ controller, snapshot }: { controller: SimulationController; snapshot: SimulationSnapshot }) {
  return (
    <div className="controls" aria-label="Simulation controls">
      <span className="clock" aria-live="off" data-testid="clock">
        Day {snapshot.day} · {pad(snapshot.hour)}:{pad(snapshot.minute)} · {PHASE_LABEL[snapshot.phase]}
      </span>
      <button className="primary" onClick={() => controller.togglePause()} aria-pressed={snapshot.paused}>
        {snapshot.paused ? 'Play' : 'Pause'}
      </button>
      <div className="segmented" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => controller.setSpeed(s)} aria-pressed={snapshot.speed === s}>
            {s}x
          </button>
        ))}
      </div>
      <input aria-label="Seed" value={controller.state.config.seed} readOnly disabled title="Restart with seed arrives in M8" />
      <button disabled title="Arrives in M8">Restart</button>
      <button disabled title="Arrives in M8">Save</button>
      <button disabled title="Arrives in M8">Load</button>
    </div>
  )
}
