import { memo, useMemo, useState } from 'react'
import type { SimulationController } from '../../app/SimulationController.ts'
import { DAYS_PER_SEASON, GENERATIONS_MAX, HISTORY_INTERVAL, HISTORY_MAX, getGenerations, getHistory, type WorldState } from '../../sim/index.ts'
import { niceMax } from '../format/chart.ts'
import { generationLabel, generationYear, populationMarks } from '../format/generations.ts'
import { formatCalendarTick, seasonMarkers } from '../format/calendar.ts'
import { formatTick } from '../format/text.ts'
import { LineChart } from './LineChart.tsx'

// Categorical slots (validated for the dark surface; see styles.css --series-*), in fixed order.
const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'
const S3 = 'var(--series-3)'
const S4 = 'var(--series-4)'

interface Props {
  controller: SimulationController
  /** Newest sample tick known to the latest snapshot, and the world id: the charts re-render only when these change. */
  historyTick: number
  worldId: number
}

/** Memoised: re-renders only when a history sample is recorded (or a different world is loaded). */
export const HistoryCharts = memo(function HistoryCharts({ controller, historyTick, worldId }: Props) {
  const [table, setTable] = useState(false)
  const [view, setView] = useState<'recent' | 'generations'>('recent')
  const state = controller.state
  void worldId
  const data = useMemo(() => {
    const h = getHistory(state).filter((s) => s.tick <= historyTick)
    const total = state.map.discovered.length
    const ticks = h.map((s) => s.tick)
    return {
      samples: h,
      ticks,
      // Season starts within the sampled span, derived from the sample ticks.
      seasons: seasonMarkers(ticks),
      population: h.map((s) => s.population),
      housed: h.map((s) => s.housed),
      food: h.map((s) => s.food),
      wood: h.map((s) => s.wood),
      explored: h.map((s) => Math.round((s.discovered / total) * 100)),
      satiety: h.map((s) => s.satiety),
      energy: h.map((s) => s.energy),
      health: h.map((s) => s.health),
      social: h.map((s) => s.social),
      // Population V1 fields: null for samples recorded before the save reached schema v7.
      children: h.map((s) => s.children ?? null),
      elders: h.map((s) => s.elders ?? null),
      births: h.map((s) => s.births ?? null),
      deaths: h.map((s) => s.deaths ?? null),
    }
  }, [state, historyTick])

  const formatX = (t: number) => formatTick(t).replace(' · ', ' ')
  const common = { ticks: data.ticks, formatX, formatTooltip: formatCalendarTick, markers: data.seasons }

  return (
    <section className="panel history" aria-label="History">
      <div className="panel-title-row">
        <h2>History</h2>
        <div className="chips" role="group" aria-label="History range">
          <button type="button" className="chip" aria-pressed={view === 'recent'} onClick={() => setView('recent')} title="The last 60 days, ten snapshots a day">
            Recent
          </button>
          <button type="button" className="chip" aria-pressed={view === 'generations'} onClick={() => setView('generations')} title="One summary per season, up to 100 world years">
            Generations
          </button>
          {view === 'recent' && (
            <button type="button" className="chip" aria-pressed={table} onClick={() => setTable(!table)} title="Show the latest samples as a table">
              Table
            </button>
          )}
        </div>
      </div>
      {view === 'generations' ? (
        <GenerationsView state={state} version={historyTick} />
      ) : data.samples.length < 2 ? (
        <p className="empty">
          History builds up as the village lives: a snapshot is recorded every {HISTORY_INTERVAL} ticks.
          {data.samples.length === 0 && ' (Worlds loaded from older saves start recording from the next snapshot.)'}
        </p>
      ) : table ? (
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Time</th><th scope="col">Pop.</th><th scope="col">Housed</th><th scope="col">Food</th><th scope="col">Wood</th>
                <th scope="col">Explored</th><th scope="col">Sat.</th><th scope="col">En.</th><th scope="col">Hlth</th><th scope="col">Soc.</th>
              </tr>
            </thead>
            <tbody>
              {data.samples.slice(-12).reverse().map((s, i) => {
                const idx = data.samples.length - 1 - i
                return (
                  <tr key={s.tick}>
                    <td className="num" title={formatCalendarTick(s.tick)}>{formatTick(s.tick)}</td>
                    <td className="num">{s.population}</td>
                    <td className="num">{s.housed}/{s.capacity}</td>
                    <td className="num">{s.food}</td>
                    <td className="num">{s.wood}</td>
                    <td className="num">{data.explored[idx]}%</td>
                    <td className="num">{s.satiety}</td>
                    <td className="num">{s.energy}</td>
                    <td className="num">{s.health}</td>
                    <td className="num">{s.social}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="charts">
          <LineChart
            title="Population"
            {...common}
            series={[
              { label: 'Living', color: S1, values: data.population },
              { label: 'Housed', color: S2, values: data.housed },
              { label: 'Children', color: S3, values: data.children },
              { label: 'Elders', color: S4, values: data.elders },
            ]}
          />
          <LineChart
            title="Births & deaths"
            {...common}
            series={[
              { label: 'Births', color: S3, values: data.births },
              { label: 'Deaths', color: S2, values: data.deaths },
            ]}
          />
          <LineChart title="Stockpile" {...common} series={[{ label: 'Food', color: S1, values: data.food }, { label: 'Wood', color: S2, values: data.wood }]} />
          <LineChart title="Explored" {...common} yMax={100} unit="%" series={[{ label: 'Map discovered', color: S1, values: data.explored }]} />
          <LineChart
            title="Average needs"
            {...common}
            yMax={100}
            series={[
              { label: 'Satiety', color: S1, values: data.satiety },
              { label: 'Energy', color: S2, values: data.energy },
              { label: 'Health', color: S3, values: data.health },
              { label: 'Social', color: S4, values: data.social },
            ]}
          />
        </div>
      )}
      {view === 'recent' && (
        <p className="muted small">
          {data.samples.length} snapshots, one every {HISTORY_INTERVAL} ticks (10 per day); the last {HISTORY_MAX} are kept.
        </p>
      )}
    </section>
  )
})

/** Long-term history: one real summary per season, up to 100 world years (schema v11). */
function GenerationsView({ state, version }: { state: WorldState; version: number }) {
  const rows = useMemo(() => getGenerations(state), [state, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (rows.length < 2) {
    return (
      <p className="empty">
        The long view builds up one season at a time — a summary every {DAYS_PER_SEASON} days, kept for up to {GENERATIONS_MAX / 4} world years.
        {rows.length === 0 && ' Worlds loaded from older saves start recording at their next season; earlier seasons were never summarised, so they stay blank.'}
      </p>
    )
  }
  const ticks = rows.map((r) => r.tick)
  const marks = populationMarks(rows.map((r) => r.population))
  const markers = [
    ...(marks.peak
      ? [{ at: marks.peak.at, label: 'Peak', title: `Peak: ${marks.peak.value} people (${generationLabel(ticks[marks.peak.at]!)})`, short: 'Peak' }]
      : []),
    ...(marks.decline
      ? [
          {
            at: marks.decline.to,
            label: 'Largest decline',
            title: `Largest decline: ${marks.decline.high} → ${marks.decline.low} people (${generationLabel(ticks[marks.decline.from]!)} to ${generationLabel(ticks[marks.decline.to]!)})`,
            short: 'Low',
          },
        ]
      : []),
  ].sort((a, b) => a.at - b.at)
  const nets = rows.map((r) => r.net)
  const minNet = Math.min(0, ...nets.filter((v): v is number => v !== null))
  const common = { ticks, formatX: generationYear, formatTooltip: generationLabel }
  const first = rows[0]!.tick
  return (
    <>
      <div className="charts">
        <LineChart
          title="Population by season"
          {...common}
          markers={markers}
          series={[
            { label: 'Living', color: S1, values: rows.map((r) => r.population) },
            { label: 'Children', color: S3, values: rows.map((r) => r.children) },
            { label: 'Adults', color: S2, values: rows.map((r) => r.adults) },
            { label: 'Elders', color: S4, values: rows.map((r) => r.elders) },
          ]}
        />
        <LineChart
          title="Births & deaths per season"
          {...common}
          yMin={minNet < 0 ? -niceMax(-minNet) : 0}
          series={[
            { label: 'Births', color: S3, values: rows.map((r) => r.seasonBirths) },
            { label: 'Deaths', color: S2, values: rows.map((r) => r.seasonDeaths) },
            { label: 'Net', color: S1, values: nets },
          ]}
        />
        <LineChart
          title="Housing"
          {...common}
          series={[
            { label: 'Housed', color: S1, values: rows.map((r) => r.housed) },
            { label: 'Beds', color: S2, values: rows.map((r) => r.capacity) },
          ]}
        />
        <LineChart title="Food at season's end" {...common} series={[{ label: 'Food', color: S1, values: rows.map((r) => r.food) }]} />
      </div>
      <p className="muted small">
        {rows.length} seasons ({(rows.length / 4).toFixed(1)} world years) from {generationLabel(first)}, one real summary per season; the last {GENERATIONS_MAX} (
        {GENERATIONS_MAX / 4} years) are kept. Births and deaths are counted per season.
      </p>
    </>
  )
}
