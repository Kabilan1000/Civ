// Chart helpers (pure, testable in Node).

/** Runs of consecutive non-null indices, for gap-aware polylines. */
export function segments(values: readonly (number | null)[]): number[][] {
  const out: number[][] = []
  let run: number[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) out.push(run)
      run = []
    } else run.push(i)
  })
  if (run.length) out.push(run)
  return out
}

/** "Nice" round maximum for an axis. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
