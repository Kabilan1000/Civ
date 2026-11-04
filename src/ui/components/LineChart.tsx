import { useState, type PointerEvent } from 'react'
import { layoutMarkers } from '../format/calendar.ts'
import { niceMax, segments } from '../format/chart.ts'

export interface Series {
  label: string
  /** CSS colour (a categorical slot variable). */
  color: string
  /** One per sample; null = not recorded (e.g. before a save gained this field) — drawn as a gap. */
  values: (number | null)[]
}

const show = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '—' : `${v}${unit}`)
const lastValue = (values: readonly (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i]
  return null
}

interface Props {
  title: string
  /** X values (ticks), one per sample. */
  ticks: number[]
  series: Series[]
  /** Fixed y maximum (e.g. 100 for percentages); otherwise derived from data. */
  yMax?: number
  /** Y minimum (default 0); negative for series that can fall below zero (net change). */
  yMin?: number
  unit?: string
  /** Axis labels (short). */
  formatX: (tick: number) => string
  /** Tooltip heading; defaults to formatX. */
  formatTooltip?: (tick: number) => string
  /** Season starts inside the span: `at` is a fractional sample index (see ui/format/calendar.ts). */
  markers?: readonly { at: number; label: string; short: string }[]
}

const W = 320
const H = 132
const M = { top: 8, right: 10, bottom: 18, left: 30 }


/** Lightweight SVG line chart: one axis, 2px lines, legend, crosshair tooltip. */
export function LineChart({ title, ticks, series, yMax, yMin = 0, unit = '', formatX, formatTooltip = formatX, markers = [] }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const n = ticks.length
  const max = yMax ?? niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))))
  const iw = W - M.left - M.right
  const ih = H - M.top - M.bottom
  const x = (i: number) => M.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const min = Math.min(0, yMin)
  const y = (v: number) => M.top + ih - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * ih
  const gridValues = min < 0 ? [min, 0, max] : [0, max / 2, max]
  const seasonLines = layoutMarkers(markers.map((m) => ({ ...m, x: x(m.at) })), W - M.right)
  const seasonsText = markers.length ? `. Seasons begin: ${markers.map((m) => m.label).join(', ')}` : ''

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = n <= 1 ? 0 : Math.round(((px - M.left) / iw) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const shown = hover ?? n - 1

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <span className="legend">
          {series.map((s) => (
            <span key={s.label} className="legend-item">
              <span className="swatch" style={{ background: s.color }} aria-hidden />
              {s.label}
              {n > 0 && <span className="num legend-value">{show(s.values[shown], unit)}</span>}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${series.map((s) => `${s.label} ${show(lastValue(s.values), unit)}`).join(', ')}${seasonsText}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {gridValues.map((g) => (
            <g key={g}>
              <line x1={M.left} x2={W - M.right} y1={y(g)} y2={y(g)} className="grid" />
              <text x={M.left - 5} y={y(g) + 3} className="axis-label" textAnchor="end">
                {Number.isInteger(g) ? g : g.toFixed(1)}
              </text>
            </g>
          ))}
          {seasonLines.map((m) => (
            <g key={m.label} className="season-marker">
              <title>{`${m.label} begins`}</title>
              <line x1={m.x} x2={m.x} y1={M.top} y2={M.top + ih} className="season-line" />
              {m.labelled && (
                <text x={m.x + 3} y={M.top + 8} className="season-label">
                  {m.short}
                </text>
              )}
            </g>
          ))}
          {n > 0 && (
            <>
              <text x={M.left} y={H - 4} className="axis-label">{formatX(ticks[0]!)}</text>
              <text x={W - M.right} y={H - 4} className="axis-label" textAnchor="end">{formatX(ticks[n - 1]!)}</text>
            </>
          )}
          {series.flatMap((s) => segments(s.values).map((run) => (
            <polyline
              key={`${s.label}-${run[0]}`}
              points={run.map((i) => `${x(i).toFixed(1)},${y(s.values[i]!).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} className="crosshair" />
              {series.map((s) => s.values[hover] === null ? null : (
                <circle key={s.label} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} className="marker" />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <div className="tooltip-title num">{formatTooltip(ticks[hover]!)}</div>
            {series.map((s) => (
              <div key={s.label} className="tooltip-row">
                <span className="swatch" style={{ background: s.color }} aria-hidden />
                <span>{s.label}</span>
                <span className="num">{show(s.values[hover], unit)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
