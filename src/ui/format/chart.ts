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
