import { memo, useMemo, useState } from 'react'
import type { SimulationController } from '../../app/SimulationController.ts'
import { HISTORY_INTERVAL, HISTORY_MAX, getHistory } from '../../sim/index.ts'
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
  /** Samples known to the latest snapshot, and the world id: the charts re-render only when these change. */
  historyLength: number
  worldId: number
}

/** Memoised: re-renders only when a history sample is recorded (or a different world is loaded). */
export const HistoryCharts = memo(function HistoryCharts({ controller, historyLength, worldId }: Props) {
  const [table, setTable] = useState(false)
  const state = controller.state
  void worldId
  const data = useMemo(() => {
    const h = getHistory(state).slice(0, historyLength)
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
  }, [state, historyLength])

  const formatX = (t: number) => formatTick(t).replace(' · ', ' ')
  const common = { ticks: data.ticks, formatX, formatTooltip: formatCalendarTick, markers: data.seasons }

  return (
    <section className="panel history" aria-label="History">
      <div className="panel-title-row">
        <h2>History</h2>
        <button type="button" className="chip" aria-pressed={table} onClick={() => setTable(!table)} title="Show the latest samples as a table">
          Table
        </button>
      </div>
      {data.samples.length < 2 ? (
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
      <p className="muted small">
        {data.samples.length} snapshots, one every {HISTORY_INTERVAL} ticks (10 per day); the last {HISTORY_MAX} are kept.
      </p>
    </section>
  )
})
