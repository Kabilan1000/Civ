import { useState } from 'react'
import type { SimulationController, SimulationSnapshot } from '../../app/SimulationController.ts'
import { SPEEDS } from '../../sim/index.ts'
import { DAY_BOUNDARY_HINT } from '../format/text.ts'
import type { ConfirmRequest } from './Modal.tsx'

const pad = (n: number) => String(n).padStart(2, '0')
const PHASE_LABEL = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' } as const
const MAX_SEED = 40

interface Props {
  controller: SimulationController
  snapshot: SimulationSnapshot
  onOpenSaves: (mode: 'save' | 'load') => void
  confirm: (request: ConfirmRequest) => void
  notify: (kind: 'ok' | 'error', text: string) => void
}

/** A fresh random seed (UI only — the simulation itself never uses Math.random). */
function randomSeed(): string {
  const words = ['amber', 'birch', 'cove', 'dune', 'ember', 'fern', 'glade', 'heath', 'isle', 'juniper', 'kelp', 'larch', 'moss', 'nook', 'oak', 'pine']
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 9000 + 1000)}`
}

function SeedRestart({ controller, unsaved, initialSeed, confirm, notify }: { controller: SimulationController; unsaved: boolean; initialSeed: string } & Pick<Props, 'confirm' | 'notify'>) {
  const [seed, setSeed] = useState(initialSeed)
  const trimmed = seed.trim()
  const restart = () => {
    const go = () => {
      controller.restart({ seed: trimmed })
      notify('ok', `New world from seed “${trimmed}”. Paused: press Play to start.`)
    }
    if (unsaved) {
      confirm({
        title: 'Restart and discard progress?',
        message: 'The current world has progress that is not saved. Save it first if you want to keep it. Saved slots are never changed by restarting.',
        confirmLabel: 'Restart',
        danger: true,
        onConfirm: go,
      })
    } else go()
  }
  return (
    <form
      className="seed-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed) restart()
      }}
    >
      <input
        aria-label="Seed"
        title="World seed: the same seed always creates the same starting world"
        value={seed}
        maxLength={MAX_SEED}
        onChange={(e) => setSeed(e.target.value)}
        placeholder="seed"
      />
      <button type="button" onClick={() => setSeed(randomSeed())} title="Pick a random seed" aria-label="Random seed">
        🎲
      </button>
      <button type="submit" disabled={!trimmed} title="Create a fresh world from this seed">
        Restart
      </button>
    </form>
  )
}

export function Controls({ controller, snapshot, onOpenSaves, confirm, notify }: Props) {
  return (
    <div className="controls" aria-label="Simulation controls">
      <span className="clock" aria-live="off" data-testid="clock" title={DAY_BOUNDARY_HINT}>
        Day {snapshot.day} · {pad(snapshot.hour)}:{pad(snapshot.minute)} · {snapshot.hour < 6 ? 'Late night' : PHASE_LABEL[snapshot.phase]}
      </span>
      <button
        className="primary"
        onClick={() => controller.togglePause()}
        aria-pressed={snapshot.paused}
        aria-keyshortcuts="Space"
        title={snapshot.paused ? 'Resume the simulation (Space)' : 'Pause the simulation (Space)'}
      >
        {snapshot.paused ? 'Play' : 'Pause'}
      </button>
      <div className="segmented" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s, i) => (
          <button
            key={s}
            onClick={() => controller.setSpeed(s)}
            aria-pressed={snapshot.speed === s}
            aria-keyshortcuts={String(i + 1)}
            title={`${s}× speed (${i + 1})`}
            aria-label={`${s} times speed`}
          >
            {s}x
          </button>
        ))}
      </div>
      {/* Re-mounted per world so the field shows the loaded/restarted world's seed. */}
      <SeedRestart key={snapshot.worldId} controller={controller} unsaved={snapshot.unsaved} initialSeed={snapshot.seed} confirm={confirm} notify={notify} />
      <button onClick={() => onOpenSaves('save')} title="Save the current world to a slot">
        Save{snapshot.unsaved ? ' •' : ''}
      </button>
      <button onClick={() => onOpenSaves('load')} title="Load a saved world">
        Load
      </button>
    </div>
  )
}
