import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { deserialize, SaveError, serialize } from '../serialize.ts'
import { createWorld, stepN } from '../world.ts'

// v12 → v13 (M10d observability): an empty daily ecology record and zeroed
// activity tallies; nothing that drives the simulation changes.
// fast-save-v12.json is a GENUINE save written by commit 6d04365 (the
// published version 6), day 700, with the carrying-capacity check active.
// Its `.continued.sha256` fingerprints that same code's world one world year
// later (canonical JSON without schemaVersion).

const read = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v)
/** The world without the v13 observability record: what the v12 code would have stored. */
const withoutObservability = (json: string) => {
  const w = JSON.parse(json)
  delete w.schemaVersion
  delete w.ecoHistory
  delete w.activity
  for (const g of w.generations) {
    delete g.bearing
    delete g.nearBushes
    delete g.held
  }
  return w
}

describe('v12 → v13: the observability record starts empty; the world is untouched', () => {
  const json = read('fast-save-v12.json')
  const raw = JSON.parse(json)

  it('is a genuine v12 save with the carrying-capacity check and long-term history', () => {
    expect(raw.schemaVersion).toBe(12)
    expect(raw.population.profile.birthBushesPerPersonPermille).toBe(1000)
    expect(raw.generations.length).toBeGreaterThan(50)
    expect('ecoHistory' in raw || 'activity' in raw).toBe(false)
  })

  it('loads with an empty ecology record and zero tallies; nothing else changes', () => {
    const w = deserialize(json)
    expect(w.schemaVersion).toBe(SCHEMA_VERSION)
    expect(w.ecoHistory).toEqual([])
    expect(w.activity).toEqual({ forageTrips: 0, forageSteps: 0, resurveys: 0, birthsHeldByLand: 0 })
    const { schemaVersion: _a, ...rest } = raw
    expect(withoutObservability(serialize(w))).toEqual(rest)
    // Old season summaries keep their shape: the new fields are simply absent (shown as gaps).
    expect(w.generations.every((g) => g.bearing === undefined && g.held === undefined)).toBe(true)
  })

  it('continues for a world year exactly as the published version did, while the record fills', () => {
    const w = deserialize(json)
    const before = { ...w.population.counters }
    stepN(w, 48 * TICKS_PER_DAY)
    expect(w.population.counters.births - before.births).toBeGreaterThan(0) // 7 births that year (no deaths)
    const fp = createHash('sha256').update(canon(withoutObservability(serialize(w)))).digest('hex')
    expect(fp).toBe(read('fast-save-v12.continued.sha256').trim())
    expect(w.ecoHistory.length).toBe(48)
    expect(w.generations.at(-1)!.bearing).toBeGreaterThan(0) // new summaries carry the new fields
  })

  it('save/resume after migration is exact', () => {
    const a = deserialize(json)
    stepN(a, 3 * TICKS_PER_DAY)
    const b = deserialize(serialize(a))
    stepN(a, 2 * TICKS_PER_DAY)
    stepN(b, 2 * TICKS_PER_DAY)
    expect(serialize(b)).toBe(serialize(a))
  })

  it('every older save format still loads, with an empty record', () => {
    for (const f of ['m4-save-v2.json', 'm9-save-v5.json', 'm10b-save-v6.json', 'popv1-save-v7-60.json', 'm10c-save-v8.json', 'fast-save-v10.json', 'fast-save-v11.json']) {
      const w = deserialize(read(f))
      expect(w.schemaVersion, f).toBe(SCHEMA_VERSION)
      expect(w.ecoHistory, f).toEqual([])
      expect(w.activity.forageTrips, f).toBe(0)
    }
  })

  it('rejects corrupt observability data', () => {
    const s = createWorld({ seed: 'v13-corrupt' })
    stepN(s, 3 * TICKS_PER_DAY)
    const bad = (f: (d: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const d = JSON.parse(serialize(s))
      f(d)
      return () => deserialize(JSON.stringify(d))
    }
    expect(bad(() => {})).not.toThrow()
    expect(bad((d) => delete d.activity)).toThrow(SaveError)
    expect(bad((d) => (d.activity.forageTrips = -1))).toThrow(SaveError)
    expect(bad((d) => (d.ecoHistory[1].tick = d.ecoHistory[0].tick))).toThrow(SaveError)
    expect(bad((d) => (d.ecoHistory[0].nearBerries = d.ecoHistory[0].nearCapacity + 1))).toThrow(SaveError)
    expect(bad((d) => delete d.ecoHistory[0].bushes.mature)).toThrow(SaveError)
    expect(bad((d) => (d.generations = [{ ...d.generations[0], held: 1.5 }]))).toThrow(SaveError)
  })
})
