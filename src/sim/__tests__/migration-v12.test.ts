import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLASSIC_PROFILE, FAST_PROFILE, SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { deserialize, SaveError, serialize } from '../serialize.ts'
import { createWorld, stepN } from '../world.ts'

// v11 → v12: the carrying-capacity birth check (birthBushesPerPersonPermille).
// Fixtures fast-save-v10/v11.json are GENUINE saves written by the code before
// the change (commits 0f5a8dc, schema v10, and adbfa2c, schema v11 — both on
// the accelerated profile, which then had no bush check). Each has a
// `.continued.sha256`: a fingerprint of that same OLD code's world one
// world year (48 days) later (canonical JSON, without schemaVersion, generations and the new
// field). A migrated save must continue exactly as the old code did.

const read = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v)
const fingerprint = (json: string) => {
  const w = JSON.parse(json)
  delete w.schemaVersion
  delete w.generations
  delete w.population.profile.birthBushesPerPersonPermille
  delete w.ecoHistory // v13 observability record (added after these saves' code)
  delete w.activity
  return createHash('sha256').update(canon(w)).digest('hex')
}

describe('v11 → v12: existing worlds keep the birth rules they were created with', () => {
  for (const [file, version] of [['fast-save-v10.json', 10], ['fast-save-v11.json', 11]] as const) {
    describe(`${file} (genuine schema v${version} save, accelerated profile)`, () => {
      const json = read(file)
      const raw = JSON.parse(json)

      it('is a real pre-change save without the field', () => {
        expect(raw.schemaVersion).toBe(version)
        expect(raw.population.profile.id).toBe('fast-v1')
        expect('birthBushesPerPersonPermille' in raw.population.profile).toBe(false)
      })

      it('loads with no bush check (its previous behaviour); everything else untouched', () => {
        const w = deserialize(json)
        expect(w.schemaVersion).toBe(SCHEMA_VERSION)
        expect(w.population.profile).toEqual({ ...raw.population.profile, birthBushesPerPersonPermille: 0 })
        const { profile: _p, ...population } = w.population
        const { profile: _q, ...rawPopulation } = raw.population
        expect(population).toEqual(rawPopulation) // counters and RNG state
        for (const k of ['citizens', 'archive', 'structures', 'stockpile', 'ledger', 'events', 'history', 'ecology', 'rng', 'tick', 'nextId', 'nextEventId'] as const) {
          expect(w[k], k).toEqual(raw[k])
        }
        expect(w.map.resources).toEqual(raw.map.resources) // plant ages, stages, amounts
        expect(w.map.lastSeen).toEqual(raw.map.lastSeen)
        expect(w.generations).toEqual(version === 11 ? raw.generations : [])
      })

      it('continues for a world year exactly as the code that wrote it did (births, a death, partnerships, comings of age)', () => {
        const w = deserialize(json)
        const before = { ...w.population.counters }
        stepN(w, 48 * TICKS_PER_DAY)
        const c = w.population.counters
        expect(c.births - before.births).toBeGreaterThan(0) // the window covers real demographic events
        expect(c.deaths - before.deaths).toBeGreaterThan(0)
        expect(c.comingOfAge - before.comingOfAge).toBeGreaterThan(0)
        expect(fingerprint(serialize(w))).toBe(read(file.replace('.json', '.continued.sha256')).trim())
      })

      it('save/resume after migration is exact', () => {
        const a = deserialize(json)
        const b = deserialize(serialize(a))
        stepN(a, 2 * TICKS_PER_DAY)
        stepN(b, 2 * TICKS_PER_DAY)
        expect(serialize(b)).toBe(serialize(a))
      })
    })
  }

  it('older saves (v2–v8) arrive with the classic profile and no bush check', () => {
    for (const f of ['m4-save-v2.json', 'm5-save-v3.json', 'm6-save-v4.json', 'm9-save-v5.json', 'm10b-save-v6.json', 'popv1-save-v7-30.json', 'popv1-save-v7-60.json', 'm10c-save-v8.json']) {
      const w = deserialize(read(f))
      expect(w.schemaVersion, f).toBe(SCHEMA_VERSION)
      expect(w.population.profile, f).toEqual(CLASSIC_PROFILE)
      expect(w.population.profile.birthBushesPerPersonPermille, f).toBe(0)
    }
  })

  it('new worlds use the tuned check, and it survives save/load', () => {
    const s = createWorld({ seed: 'v12-new' })
    expect(s.population.profile.birthBushesPerPersonPermille).toBe(FAST_PROFILE.birthBushesPerPersonPermille)
    expect(FAST_PROFILE.birthBushesPerPersonPermille).toBe(1000)
    expect(deserialize(serialize(s)).population.profile).toEqual(s.population.profile)
  })

  it('a v12 save must carry the field (no silent default at the current version)', () => {
    const d = JSON.parse(serialize(createWorld({ seed: 'v12-strict' })))
    delete d.population.profile.birthBushesPerPersonPermille
    expect(() => deserialize(JSON.stringify(d))).toThrow(SaveError)
    d.population.profile.birthBushesPerPersonPermille = -1
    expect(() => deserialize(JSON.stringify(d))).toThrow(SaveError)
  })
})
