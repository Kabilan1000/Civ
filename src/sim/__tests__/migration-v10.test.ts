import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ageYears } from '../citizens/life.ts'
import { CLASSIC_PROFILE, FAST_PROFILE, SCHEMA_VERSION, TICKS_PER_DAY } from '../constants.ts'
import { deserialize, SaveError, serialize } from '../serialize.ts'
import { createWorld, stepN } from '../world.ts'

// v9 → v10: per-world demographic profiles. Existing saves keep the classic
// rules they were simulated under; only new worlds use the accelerated one.

const fixtures = ['popv1-save-v7-60.json', 'popv1-save-v7-30.json', 'm10c-save-v8.json']

describe('demographic profiles (schema v10)', () => {
  for (const file of fixtures) {
    it(`${file}: keeps the classic profile; no citizen history rewritten, nobody removed`, () => {
      const json = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
      const raw = JSON.parse(json)
      const w = deserialize(json)
      expect(w.schemaVersion).toBe(SCHEMA_VERSION)
      expect(w.population.profile).toEqual(CLASSIC_PROFILE)
      expect(w.citizens.map((c) => [c.id, c.bornTick, c.alive, c.role, c.parentIds, c.partnerId])).toEqual(
        raw.citizens.map((c: Record<string, unknown>) => [c.id, c.bornTick, c.alive, c.role, c.parentIds ?? null, c.partnerId ?? null]),
      )
      // Under the accelerated thresholds these adults would be far past the maximum age;
      // under their own profile nobody is, and the first days kill nobody of old age.
      const living = w.citizens.filter((c) => c.alive)
      expect(Math.max(...living.map((c) => ageYears(c, w.tick)))).toBeLessThanOrEqual(CLASSIC_PROFILE.maxAge)
      if (living.some((c) => ageYears(c, w.tick) > FAST_PROFILE.maxAge)) {
        const old = w.population.counters.oldAgeDeaths
        stepN(w, 3 * TICKS_PER_DAY)
        expect(w.population.counters.oldAgeDeaths - old).toBeLessThanOrEqual(1)
      }
    })
  }

  it('new worlds use the accelerated profile, and it survives save/load', () => {
    const s = createWorld({ seed: 'profile-new' })
    expect(s.population.profile).toEqual(FAST_PROFILE)
    expect(deserialize(serialize(s)).population.profile).toEqual(FAST_PROFILE)
  })

  it.each([
    ['missing profile', (r: Record<string, any>) => delete r.population.profile],
    ['elder before adult', (r: Record<string, any>) => (r.population.profile.elderAge = r.population.profile.adultAge)],
    ['max before elder', (r: Record<string, any>) => (r.population.profile.maxAge = r.population.profile.elderAge)],
    ['inverted fertile range', (r: Record<string, any>) => (r.population.profile.fertileAge = { min: 9, max: 8 })],
    ['birth chance', (r: Record<string, any>) => (r.population.profile.birthChancePermille = 2000)],
  ])('rejects a save with a damaged profile: %s', (_name, mutate) => {
    const r = JSON.parse(serialize(createWorld({ seed: 'profile-bad' })))
    mutate(r)
    expect(() => deserialize(JSON.stringify(r))).toThrow(SaveError)
  })
})
