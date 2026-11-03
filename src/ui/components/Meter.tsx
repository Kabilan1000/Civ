/** A labelled 0..100 bar. `tone` picks a status colour for low values. */
export function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const v = Math.max(0, Math.min(100, value))
  const tone = v < 20 ? 'critical' : v < 40 ? 'warning' : 'good'
  return (
    <div className="meter" title={hint ?? `${label}: ${v.toFixed(0)} / 100`}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">{v.toFixed(0)}</span>
      </div>
      <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
        <div className={`meter-fill ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}
