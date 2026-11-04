import type { SimulationSnapshot } from '../../app/SimulationController.ts'
import { FOG_CLEAR_DAYS, FOG_FULL_DAYS, MAX_POPULATION } from '../../sim/index.ts'
import { calendarHint, formatDate } from '../format/calendar.ts'
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
        <span className="muted num" title={calendarHint(snapshot.tick)}>
          {formatDate(snapshot.tick)} · {pad(snapshot.hour)}:{pad(snapshot.minute)} · {snapshot.hour < 6 ? 'Late night' : PHASE[snapshot.phase]}
        </span>
      </div>
      <div className="stat-grid">
        <Stat
          label="Population"
          value={s.population}
          sub={`${s.people.children} children${s.dead > 0 ? ` · ${s.dead} died` : ''}`}
          hint={`Living citizens (the dead are not counted). The village holds at most ${MAX_POPULATION}.`}
        />
        <Stat label="Food" value={s.food} sub="in stockpile" hint="Food units in the campfire stockpile" />
        <Stat label="Wood" value={s.wood} sub="in stockpile" hint="Wood units in the campfire stockpile (shelter sites hold their own)" />
        <Stat
          label="Housed"
          value={`${s.housing.occupied}/${s.housing.capacity}`}
          sub={`${s.shelters.complete} shelters${building ? ` · ${building} building` : ''}`}
          hint="Citizens with a home / beds in completed shelters"
        />
        <Stat
          label="Explored"
          value={`${s.exploredPercent.toFixed(0)}%`}
          sub={`${s.freshPercent}% fresh · ${s.stalePercent}% stale`}
          hint={`${s.discoveredTiles} of ${s.totalTiles} tiles discovered — the island's shape is never forgotten. Land nobody has seen for ${FOG_CLEAR_DAYS} days starts to fade, and after ${FOG_FULL_DAYS} days the fog returns: the map shows it as it was last seen, while it keeps changing underneath. Villagers keep their surroundings and the settlement in view; explorers resurvey stale land. Clear = in view, faint = seen recently, hazy = fading or stale, dark = never discovered.`}
        />
        <Stat label="Bonds" value={`${s.friendships} · ${s.rivalries}`} sub="friends · rivals" hint="Friendships: both like each other (affinity ≥ 50). Rivalries: either resents the other (≤ −40)." />
        <Stat
          label="Ages"
          value={`${s.people.children} · ${s.people.adults} · ${s.people.elders}`}
          sub="children · adults · elders"
          hint={`Children are under ${s.people.adultAge}, elders ${s.people.elderAge} or older (in world years of 48 days).`}
        />
        <Stat
          label="Plants"
          value={`${s.plants.bushes} · ${s.plants.trees}`}
          sub={`bushes · trees · ${s.plants.seedlings} sprouting`}
          hint={`Living berry bushes and trees on the island (seedlings included), plus ${s.plants.deadwood} dead trees left as deadwood. Plants grow, age, spread their seeds and die; a bush picked bare can't spread.`}
        />
        <Stat label="Couples" value={s.people.couples} sub="partnerships" hint="Living partners. Couples with a home and enough food in the village may have children." />
        <Stat
          label="Births · deaths"
          value={`${s.people.births} · ${s.people.deaths}`}
          sub={s.people.oldAgeDeaths > 0 ? `${s.people.oldAgeDeaths} of old age` : 'since founding'}
          hint="Every birth and death since the village was founded (or since this save was upgraded)."
        />
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
