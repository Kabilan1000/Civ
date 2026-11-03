import type { SimulationSnapshot } from '../../app/SimulationController.ts'
import { Meter } from './Meter.tsx'

const pad = (n: number) => String(n).padStart(2, '0')
const PHASE = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' } as const

function Stat({ label, value, sub, hint }: { label: string; value: string | number; sub?: string; hint: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Dashboard({ snapshot }: { snapshot: SimulationSnapshot }) {
  const s = snapshot.stats
  const building = s.shelters.underConstruction + s.shelters.planned
  return (
    <section className="panel dashboard" aria-label="Civilization">
      <div className="panel-title-row">
        <h2>Civilization</h2>
        <span className="muted num">
          Day {snapshot.day} · {pad(snapshot.hour)}:{pad(snapshot.minute)} · {PHASE[snapshot.phase]}
        </span>
      </div>
      <div className="stat-grid">
        <Stat label="Population" value={s.population} sub={s.dead > 0 ? `${s.dead} died` : 'all alive'} hint="Living citizens (the dead are not counted)" />
        <Stat label="Food" value={s.food} sub="in stockpile" hint="Food units in the campfire stockpile" />
        <Stat label="Wood" value={s.wood} sub="in stockpile" hint="Wood units in the campfire stockpile (shelter sites hold their own)" />
        <Stat
          label="Housed"
          value={`${s.housing.occupied}/${s.housing.capacity}`}
          sub={`${s.shelters.complete} shelters${building ? ` · ${building} building` : ''}`}
          hint="Citizens with a home / beds in completed shelters"
        />
        <Stat label="Explored" value={`${s.exploredPercent.toFixed(0)}%`} sub={`${s.discoveredTiles} of ${s.totalTiles} tiles`} hint="Share of the map that has been discovered" />
        <Stat label="Bonds" value={`${s.friendships} · ${s.rivalries}`} sub="friends · rivals" hint="Friendships: both like each other (affinity ≥ 50). Rivalries: either resents the other (≤ −40)." />
      </div>
      <div className="meters" aria-label="Average needs of the living">
        <Meter label="Satiety" value={s.avgNeeds.satiety} hint="Average satiety (100 = full; hunger is the inverse)" />
        <Meter label="Energy" value={s.avgNeeds.energy} />
        <Meter label="Health" value={s.avgNeeds.health} />
        <Meter label="Social" value={s.avgNeeds.social} />
      </div>
    </section>
  )
}
