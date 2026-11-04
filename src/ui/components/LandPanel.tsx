import { memo, useMemo } from 'react'
import type { SimulationController } from '../../app/SimulationController.ts'
import {
  dayNumberAt,
  ECO_HISTORY_MAX,
  FOG_CLEAR_DAYS,
  FOG_FULL_DAYS,
  getEcoDays,
  getEcologyNow,
  getHistory,
  NEAR_CAMP_TILES,
  type EcoDay,
} from '../../sim/index.ts'
import { formatCalendarTick } from '../format/calendar.ts'
import { arrow, forageTrend, recentTotal, villageChange, type Direction } from '../format/land.ts'
import { LineChart } from './LineChart.tsx'

// Land & ecology (M10d): the environment the village lives in, from the
// dawn ecology record (state.ecoHistory) and the same census taken live.
// Statements are comparisons of real figures; none names a single cause.

const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'
const S3 = 'var(--series-3)'
const S4 = 'var(--series-4)'
const TREND_DAYS = 5

const DIRECTION: Record<Direction, string> = {
  improving: 'improving',
  deteriorating: 'getting worse',
  mixed: 'mixed signals',
  steady: 'steady',
  unknown: 'not enough days recorded yet',
}

function Stat({ label, value, sub, hint }: { label: string; value: string | number; sub?: string; hint: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

interface Props {
  controller: SimulationController
  /** Newest history sample tick and the world id: the panel re-renders only when these change (≤ 10 times a world day). */
  historyTick: number
  worldId: number
}

export const LandPanel = memo(function LandPanel({ controller, historyTick, worldId }: Props) {
  const state = controller.state
  void worldId
  const lastDawn = state.ecoHistory.at(-1)?.tick ?? -1
  const days = useMemo(() => getEcoDays(state), [state, lastDawn]) // eslint-disable-line react-hooks/exhaustive-deps
  const now = useMemo(() => getEcologyNow(state), [state, historyTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const village = useMemo(() => villageChange(getHistory(state), TREND_DAYS), [state, historyTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const forage = useMemo(() => forageTrend(days, TREND_DAYS), [days])
  const profile = state.population.profile
  const landRule = profile.birthBushesPerPersonPermille > 0
  const known = now.recent + now.fading + now.stale
  const total = state.map.discovered.length
  const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n * 100) / of))
  const recentTrips = recentTotal(days.map((d) => d.trips), 2)
  const recentSteps = (() => {
    const ds = days.slice(-2).filter((d) => d.trips !== null && d.trips > 0)
    const trips = ds.reduce((n, d) => n + d.trips!, 0)
    return trips === 0 ? null : ds.reduce((n, d) => n + d.tripSteps! * d.trips!, 0) / trips
  })()
  const resurveys2 = recentTotal(days.map((d) => d.resurveysToday), 2)
  const held = recentTotal(days.map((d) => d.heldToday), TREND_DAYS)
  const bearingBushes = now.bushes.young + now.bushes.mature + now.bushes.old
  const grownTrees = now.trees.young + now.trees.mature + now.trees.old
  const needBushes = Math.ceil(((now.population + 1) * profile.birthBushesPerPersonPermille) / 1000)

  return (
    <section className="panel land" aria-label="Land and ecology">
      <div className="panel-title-row">
        <h2>Land &amp; ecology</h2>
        <span className="muted small">dawn census · last {Math.min(days.length, ECO_HISTORY_MAX)} days</span>
      </div>

      <div className="trends" aria-label={`Changes over the last ${TREND_DAYS} days`}>
        <h3>Last {TREND_DAYS} days, compared with the {TREND_DAYS} before</h3>
        <ul>
          <li>
            <span className="trend-label">People</span>
            {village ? (
              <span className="num">
                {arrow(village.people)}
                {village.births !== null && ` (${village.births} born, ${village.deaths} died)`}
              </span>
            ) : (
              <span className="muted">not enough history yet</span>
            )}
          </li>
          <li>
            <span className="trend-label">Food per person</span>
            {village && village.foodPerPerson.before !== null && village.foodPerPerson.after !== null ? (
              <span className="num">{arrow({ before: village.foodPerPerson.before, after: village.foodPerPerson.after })} in the stockpile</span>
            ) : (
              <span className="muted">—</span>
            )}
          </li>
          <li>
            <span className="trend-label">Forage near camp</span>
            <span>
              <strong className={`dir dir-${forage.direction}`}>{DIRECTION[forage.direction]}</strong>
              {forage.berries && <span className="num"> · berries {arrow(forage.berries)}</span>}
              {forage.steps && <span className="num"> · trip {arrow(forage.steps)} steps</span>}
              {now.nearBushes === 0 && <span> · no bearing bushes within {NEAR_CAMP_TILES} tiles of the campfire</span>}
            </span>
          </li>
          {landRule && (
            <li>
              <span className="trend-label" title="Couple-days on which a couple met every other condition for a child (partner, fertile ages, spacing, village food, a home with room) but the land had too few bearing berry bushes per person, so that day's chance of a birth never came.">
                Birth opportunities blocked by land
              </span>
              {held === null ? (
                <span className="muted">counting from the next dawn</span>
              ) : (
                <span className="num">
                  {held === 0 ? 'none' : `${held} couple-day${held === 1 ? '' : 's'}`} · now {now.bearing} bearing bushes for {now.population} people
                  {now.bearing < needBushes && ` (a birth needs ${needBushes})`}
                </span>
              )}
            </li>
          )}
        </ul>
        <p className="muted small">These figures change together; on their own they don't show which change caused another.</p>
      </div>

      <div className="stat-grid">
        <Stat
          label="Berry bushes"
          value={bearingBushes}
          sub={`${now.bushes.young} young · ${now.bushes.mature} mature · ${now.bushes.old} old · ${now.bushes.seedling} sprouting`}
          hint="Living berry bushes on the whole island by growth stage. Young, mature and old bushes bear fruit (old ones less); seedlings bear nothing yet."
        />
        <Stat
          label="Trees"
          value={grownTrees}
          sub={`${now.trees.seedling} sprouting · ${now.deadwood} deadwood (${now.deadwoodWood} wood)`}
          hint={`Grown trees on the whole island: ${now.trees.young} young, ${now.trees.mature} mature, ${now.trees.old} old, plus ${now.trees.seedling} seedlings. Dead trees stand as deadwood that builders can still chop until it rots.`}
        />
        <Stat
          label="Near camp"
          value={`${now.nearBerries}/${now.nearCapacity}`}
          sub={`berries on ${now.nearBushes} bushes`}
          hint={`Ripe berries on the bearing bushes within ${NEAR_CAMP_TILES} tiles of the campfire (on known land), out of what those bushes can hold.`}
        />
        <Stat
          label="Foraging"
          value={recentSteps === null ? '—' : `${recentSteps.toFixed(1)} steps`}
          sub={recentTrips === null ? 'no trips recorded yet' : `average trip · ${recentTrips} trips in 2 days`}
          hint="Average walking distance from a forager to the bush they set out for, over the last two days. Longer trips mean food is getting scarcer close by."
        />
        <Stat
          label="Land seen"
          value={`${pct(now.recent, known)}%`}
          sub={`${pct(now.fading, known)}% fading · ${pct(now.stale, known)}% stale`}
          hint={`Of the ${known} tiles ever discovered (${pct(known, total)}% of the island, never forgotten): seen within ${FOG_CLEAR_DAYS} days, fading, or not seen for ${FOG_FULL_DAYS}+ days (the fog has returned).`}
        />
        <Stat
          label="Resurveys"
          value={resurveys2 ?? '—'}
          sub="explorer trips in 2 days"
          hint="Explorer trips to land that had faded from view (rather than to undiscovered land), over the last two days."
        />
      </div>

      <div className="landbar" role="img" aria-label={`Known land: ${now.recent} tiles seen recently, ${now.fading} fading, ${now.stale} stale; ${total - known} undiscovered`}>
        <span className="lb-recent" style={{ flexGrow: now.recent }} />
        <span className="lb-fading" style={{ flexGrow: now.fading }} />
        <span className="lb-stale" style={{ flexGrow: now.stale }} />
        <span className="lb-unknown" style={{ flexGrow: total - known }} />
      </div>
      <div className="legend landbar-legend">
        <span className="legend-item"><span className="swatch lb-recent" aria-hidden />seen recently</span>
        <span className="legend-item"><span className="swatch lb-fading" aria-hidden />fading</span>
        <span className="legend-item"><span className="swatch lb-stale" aria-hidden />stale</span>
        <span className="legend-item"><span className="swatch lb-unknown" aria-hidden />undiscovered</span>
      </div>

      <EcoCharts days={days} landRule={landRule} />
    </section>
  )
})

function EcoCharts({ days, landRule }: { days: EcoDay[]; landRule: boolean }) {
  if (days.length < 2) {
    return (
      <p className="empty">
        The ecology record builds up one dawn at a time (up to {ECO_HISTORY_MAX} days). Worlds loaded from older saves start recording at the next dawn;
        earlier days were never recorded, so they stay blank.
      </p>
    )
  }
  const ticks = days.map((d) => d.tick)
  const common = { ticks, formatX: (t: number) => `Day ${dayNumberAt(t)}`, formatTooltip: (t: number) => `${formatCalendarTick(t)} (dawn)` }
  return (
    <div className="charts">
      <LineChart
        title="People and land"
        {...common}
        series={[
          { label: 'People', color: S1, values: days.map((d) => d.population) },
          { label: 'Bearing bushes', color: S3, values: days.map((d) => d.bearing) },
          ...(landRule ? [{ label: 'Birth opportunities blocked by land', color: S2, values: days.map((d) => d.heldToday) }] : []),
        ]}
      />
      <LineChart
        title="Near the campfire"
        {...common}
        series={[
          { label: 'Berries', color: S3, values: days.map((d) => d.nearBerries) },
          { label: 'Bushes', color: S4, values: days.map((d) => d.nearBushes) },
          { label: 'Trip steps', color: S2, values: days.map((d) => d.tripSteps) },
        ]}
      />
      <LineChart
        title="Berries per day"
        {...common}
        series={[
          { label: 'Picked', color: S1, values: days.map((d) => d.picked) },
          { label: 'Regrown', color: S3, values: days.map((d) => d.regrownToday) },
          { label: 'Lost', color: S2, values: days.map((d) => d.lost) },
        ]}
      />
      <LineChart
        title="Plants on the island"
        {...common}
        series={[
          { label: 'Bushes', color: S3, values: days.map((d) => d.bushes.young + d.bushes.mature + d.bushes.old) },
          { label: 'Sprouting', color: S4, values: days.map((d) => d.bushes.seedling + d.trees.seedling) },
          { label: 'Trees', color: S1, values: days.map((d) => d.trees.young + d.trees.mature + d.trees.old) },
          { label: 'Deadwood', color: S2, values: days.map((d) => d.deadwood) },
        ]}
      />
      <LineChart
        title="Plant births & deaths per day"
        {...common}
        series={[
          { label: 'Bushes born', color: S3, values: days.map((d) => d.bushBirths) },
          { label: 'Bushes died', color: S2, values: days.map((d) => d.bushDeaths) },
          { label: 'Trees born', color: S1, values: days.map((d) => d.treeBirths) },
          { label: 'Trees died', color: S4, values: days.map((d) => d.treeDeaths) },
        ]}
      />
      <LineChart
        title="Land out of view"
        {...common}
        series={[
          { label: 'Fading tiles', color: S4, values: days.map((d) => d.fading) },
          { label: 'Stale tiles', color: S2, values: days.map((d) => d.stale) },
          { label: 'Resurveys', color: S1, values: days.map((d) => d.resurveysToday) },
        ]}
      />
    </div>
  )
}
